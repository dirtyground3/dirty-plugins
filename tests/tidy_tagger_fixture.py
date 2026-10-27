"""Synthetic stash-box server for DirtyTidy's opt-in isolated Stash checks."""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import sqlite3
import threading
import time


REMOTE_SCENE = "10000000-0000-4000-8000-000000000001"


def exercise_tag_updates(fixture, operation, settings):
    requests = []
    remote_tags = [{"id": "20000000-0000-4000-8000-000000000001", "name": "Fixture existing"},
                   {"id": "20000000-0000-4000-8000-000000000002", "name": "Fixture new"}]
    class Source(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert self.headers.get("ApiKey") == "fixture"
            assert "images" not in payload["query"] and "performers" not in payload["query"]
            requests.append(payload)
            if "fingerprints" in payload["variables"]:
                values = [[{"id": REMOTE_SCENE, "tags": remote_tags}] for _ in payload["variables"]["fingerprints"]]
                data = {"matches": values}
            else:
                assert "findScene(" in payload["query"], payload["query"]
                data = {"scene" + key.removeprefix("id"): {"id": value, "tags": remote_tags}
                        for key, value in payload["variables"].items()}
            body = json.dumps({"data": data}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Source)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    saved = settings(fixture)
    try:
        endpoint = "http://127.0.0.1:" + str(server.server_port) + "/graphql"
        fixture.gql('mutation($input:ConfigGeneralInput!){configureGeneral(input:$input){stashBoxes{endpoint}}}',
                    {"input": {"stashBoxes": [{"endpoint": endpoint, "name": "Synthetic tagger", "api_key": "fixture"}]}})
        existing = fixture.gql('mutation{tagCreate(input:{name:"Fixture existing"}){id}}')["tagCreate"]["id"]
        keep = fixture.gql('mutation{tagCreate(input:{name:"Fixture keep"}){id}}')["tagCreate"]["id"]
        rows = fixture.gql('{findScenes(filter:{per_page:-1}){scenes{id}}}')["findScenes"]["scenes"]
        for row in rows:
            fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}',
                        {"input": {"id": row["id"], "tag_ids": [keep],
                                   "stash_ids": [{"endpoint": endpoint,
                                                  "stash_id": "10000000-0000-4000-8000-" + row["id"].zfill(12)}]}})
        values = dict(saved, tagUpdateEnabled=True, taggerEndpoint=endpoint, automationMode="manual")
        settings(fixture, values)
        read = lambda: fixture.gql('''{findScenes(filter:{per_page:-1,sort:"id",direction:ASC}){scenes{
            id title details updated_at files{id path} tags{id name} stash_ids{endpoint stash_id}
        }}}''')["findScenes"]["scenes"]
        before = read()
        started = time.perf_counter()
        result = operation(fixture, "dirtyTasks", mode="updateTags")
        cold_duration = time.perf_counter() - started
        assert result["completed"] == len(rows) and result["failed"] == 0, result
        assert result["requests"] == 1 and len(requests) == 1, result
        assert len(requests[0]["variables"]) == len(rows), "different scene IDs must share a tag-only request"
        after = read()
        for previous, current in zip(before, after):
            assert {key: previous[key] for key in ("id", "title", "details", "files", "stash_ids")} == {
                key: current[key] for key in ("id", "title", "details", "files", "stash_ids")}
            assert {tag["name"] for tag in current["tags"]} == {"Fixture keep", "Fixture existing", "Fixture new"}
            assert existing in {tag["id"] for tag in current["tags"]}
        started = time.perf_counter()
        result = operation(fixture, "dirtyTasks", mode="updateTags")
        warm_duration = time.perf_counter() - started
        assert result["completed"] == 0 and result["cached"] == len(rows) and result["requests"] == 0, result
        assert len(requests) == 1, "a cached run must not contact the tagger"
        assert read() == after, "a no-op tag merge must not save scenes or change updated_at"
        remote_tags.append({"id": "20000000-0000-4000-8000-000000000003", "name": "Fixture later"})
        result = operation(fixture, "dirtyTasks", mode="updateTags", force=True)
        assert result["completed"] == len(rows) and result["requests"] == 1, result
        assert all("Fixture later" in {tag["name"] for tag in value["tags"]} for value in read())
        after = read()
        with sqlite3.connect(fixture.root / "plugins" / "dirtyPlugins" / "dirty_plugins.sqlite3") as connection:
            connection.execute("UPDATE dirty_tidy_tag_checks SET checked_at=checked_at-86401")
        result = operation(fixture, "dirtyTasks", mode="updateTags")
        assert result["unchanged"] == len(rows) and result["requests"] == 1, result
        assert read() == after, "refreshing expired checks without new tags must not save scenes"
        fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}',
                    {"input": {"id": rows[0]["id"], "stash_ids": []}})
        result = operation(fixture, "dirtyTasks", mode="updateTags")
        assert result["cached"] == len(rows) - 1 and result["unchanged"] == 1, result
        assert "fingerprints" in requests[-1]["variables"], "unlinked scenes must use stored fingerprint batches"
        print(f"PASS: tag-only batch read for {len(rows)} distinct scenes; cold {cold_duration:.3f}s / cached {warm_duration:.3f}s; no cached source requests or scene writes; forced/expired refresh and fingerprint matching verified", flush=True)
    finally:
        settings(fixture, saved)
        server.shutdown()
        worker.join(timeout=5)
        server.server_close()
