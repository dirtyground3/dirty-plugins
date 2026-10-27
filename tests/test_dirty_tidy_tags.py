"""Tag-only source batching and a persistent one-day cache; no real library is contacted."""
from plugin_paths import runtime_path
import copy
import io
import json
import os
import sys
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest import mock

for plugin in ("DirtyPlugins", "DirtyTasks"):
    sys.path.insert(0, str(runtime_path(plugin)))
import dirty_tidy_tags as tags
from dirty_tidy_tag_source import TagSource, TaggerError, BATCH_SIZE
from dirty_tidy_tag_store import TagCheckCache, CACHE_SECONDS

ENDPOINT = "https://stashdb.org/graphql"
OTHER_ENDPOINT = "https://other.example/graphql"


def scene(scene_id="1", existing=()):
    return {"id": str(scene_id), "tags": [{"id": tag_id} for tag_id in existing],
            "stash_ids": [{"endpoint": ENDPOINT, "stash_id": "remote-" + str(scene_id)}]}


def remote_scene(remote_id, *remote_tags):
    return {"id": remote_id, "tags": list(remote_tags)}


NEW = {"id": "remote-tag-new", "name": "New tag"}


class Remote:
    def __init__(self):
        self.scenes, self.fingerprints, self.errors = {}, {}, set()
        self.calls = []
        self.unavailable = False

    def call(self, source, query, variables):
        source.requests += 1
        self.calls.append((query, copy.deepcopy(variables)))
        if self.unavailable:
            raise TaggerError("Source temporarily unavailable.")
        if "fingerprints" in variables:
            return {"data": {"matches": [self.fingerprints.get(values[0]["hash"], []) for values in variables["fingerprints"]]}}
        data, errors = {}, []
        for name, remote_id in variables.items():
            alias = "scene" + name.removeprefix("id")
            data[alias] = self.scenes.get(remote_id)
            if remote_id in self.errors:
                errors.append({"path": [alias], "message": "source failure"})
        return {"data": data, "errors": errors}


class TagClient:
    def __init__(self, scenes):
        self.scenes, self.calls, self.writes, self.created = scenes, [], [], []
        self.local_tags = [{"id": "old", "name": "Keep", "aliases": [], "stash_ids": []},
                           {"id": "new", "name": "New tag", "aliases": [], "stash_ids": []}]
        self.patterns = []
        self.fail_save = False

    def call(self, query, variables=None):
        self.calls.append((query, copy.deepcopy(variables)))
        if "DirtyTidyTagSource" in query:
            return {"configuration": {"general": {"stashBoxes": [
                {"endpoint": endpoint, "api_key": "private-key", "max_requests_per_minute": 120}
                for endpoint in (ENDPOINT, OTHER_ENDPOINT)]},
                "scraping": {"excludeTagPatterns": self.patterns}}}
        if "DirtyTidyTagScenes" in query or "DirtyTidyLocalTags" in query:
            is_scene = "DirtyTidyTagScenes" in query
            rows = self.scenes if is_scene else self.local_tags
            values = variables["filter"]
            start = (values["page"] - 1) * values["per_page"]
            return {"findScenes" if is_scene else "findTags": {
                "count": len(rows), "scenes" if is_scene else "tags": copy.deepcopy(rows[start:start + values["per_page"]])}}
        if "DirtyTidyCreateTag" in query:
            values = variables["input"]
            self.created.append(copy.deepcopy(values))
            created = {**values, "id": str(100 + len(self.created)), "aliases": []}
            self.local_tags.append(created)
            return {"tagCreate": {"id": created["id"]}}
        if "DirtyTidyMergeTags" in query:
            if self.fail_save:
                raise RuntimeError("Save unavailable.")
            values = variables["input"]
            assert set(values) == {"ids", "tag_ids"} and values["tag_ids"]["mode"] == "ADD"
            row = next(row for row in self.scenes if row["id"] == values["ids"][0])
            current = {tag["id"] for tag in row.get("tags", [])} | {"concurrent"}
            current.update(values["tag_ids"]["ids"])
            row["tags"] = [{"id": tag_id} for tag_id in sorted(current)]
            self.writes.append(values)
            return {"bulkSceneUpdate": [{"id": row["id"]}]}
        raise AssertionError(query)


class DirtyTidyTagTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        environment = mock.patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(Path(directory.name) / "shared.sqlite3")})
        environment.start()
        self.addCleanup(environment.stop)
        self.remote = Remote()
        boundary = mock.patch.object(TagSource, "call", autospec=True, side_effect=self.remote.call)
        boundary.start()
        self.addCleanup(boundary.stop)
        self.now = 1000000.0
        clock = mock.patch.object(tags.time, "time", side_effect=lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)

    def update(self, client, **kwargs):
        return tags.update_scene_tags(client, kwargs.pop("endpoint", ENDPOINT), mock.Mock(), **kwargs)

    def prepare(self, rows):
        client = TagClient(rows)
        for row in rows:
            self.remote.scenes["remote-" + row["id"]] = remote_scene("remote-" + row["id"], NEW)
        return client

    def test_only_changed_scenes_saved_and_concurrent_tags_preserved(self):
        client = self.prepare([scene("1", ["old"]), scene("2", ["new"])])
        result = self.update(client)
        self.assertEqual((result["completed"], result["unchanged"]), (1, 1))
        self.assertEqual(client.writes, [{"ids": ["1"], "tag_ids": {"ids": ["new"], "mode": "ADD"}}])
        self.assertEqual({tag["id"] for tag in client.scenes[0]["tags"]}, {"old", "new", "concurrent"})
        self.assertEqual(self.update(client)["cached"], 2)
        self.assertEqual(len(self.remote.calls), 1)
        self.assertEqual(len(client.writes), 1)
        self.assertEqual(self.update(client, force=True)["unchanged"], 2)
        self.assertEqual(len(client.writes), 1)

    def test_different_scene_tags_are_fetched_together_without_cross_assignment(self):
        client = self.prepare([scene("1"), scene("2")])
        self.remote.scenes["remote-2"] = remote_scene("remote-2", {"id": "r-other", "name": "Other"})
        result = self.update(client)
        self.assertEqual(result["completed"], 2)
        self.assertEqual(len(self.remote.calls), 1)
        self.assertEqual(client.writes[0]["tag_ids"]["ids"], ["new"])
        self.assertEqual(client.writes[1]["tag_ids"]["ids"], ["101"])
        self.assertNotIn("new", {tag["id"] for tag in client.scenes[1]["tags"]})

    def test_exact_one_day_expiry_and_force_refresh(self):
        client = self.prepare([scene()])
        self.update(client)
        self.remote.scenes["remote-1"]["tags"].append({"id": "r-later", "name": "Later"})
        self.now += CACHE_SECONDS - 0.01
        self.assertEqual(self.update(client)["cached"], 1)
        self.now += 0.01
        self.assertEqual(self.update(client)["completed"], 1)
        self.assertEqual(len(self.remote.calls), 2)
        self.assertEqual(self.update(client, force=True)["unchanged"], 1)
        self.assertEqual(len(self.remote.calls), 3)

    def test_cache_persists_across_runs_and_isolated_by_source(self):
        client = self.prepare([scene()])
        self.update(client)
        self.assertEqual(self.update(client)["requests"], 0)
        self.assertEqual(TagCheckCache(ENDPOINT).fresh({"1": tags.check_identity(tags.scene_inputs(scene(), ENDPOINT), [])}), {"1"})
        self.assertEqual(TagCheckCache(OTHER_ENDPOINT).fresh({"1": tags.check_identity(tags.scene_inputs(scene(), ENDPOINT), [])}), set())

    def test_changed_links_and_exclusions_invalidate_cache_but_titles_do_not(self):
        client = self.prepare([scene()])
        self.update(client)
        client.scenes[0]["title"] = "Changed title"
        self.assertEqual(self.update(client)["cached"], 1)
        client.scenes[0]["stash_ids"][0]["stash_id"] = "changed"
        self.remote.scenes["changed"] = remote_scene("changed", NEW)
        self.assertEqual(self.update(client)["unchanged"], 1)
        client.patterns = ["^new"]
        self.assertEqual(self.update(client)["unchanged"], 1)
        self.assertEqual(len(self.remote.calls), 3)

    def test_batching_is_bounded_and_cache_hits_make_no_remote_or_tag_queries(self):
        client = self.prepare([scene(str(index), ["new"]) for index in range(205)])
        result = self.update(client)
        self.assertEqual(result["unchanged"], 205)
        self.assertEqual(result["requests"], 11)
        self.assertTrue(all(len(variables) <= BATCH_SIZE for _query, variables in self.remote.calls))
        self.assertTrue(all("findScene" in query and "tags { id name }" in query for query, _ in self.remote.calls))
        self.assertTrue(all("images" not in query and "performers" not in query for query, _ in self.remote.calls))
        client.calls.clear()
        result = self.update(client)
        self.assertEqual((result["cached"], result["requests"]), (205, 0))
        self.assertFalse(any("DirtyTidyLocalTags" in query for query, _ in client.calls))

    def test_missing_and_ambiguous_matches_are_cached_without_writes(self):
        client = TagClient([scene("1"), {"id": "2", "files": [{"fingerprints": [{"type": "md5", "value": "hash"}]}]}])
        self.remote.fingerprints["hash"] = [remote_scene("one", NEW), remote_scene("two", NEW)]
        result = self.update(client)
        self.assertEqual(result["skipped"], 2)
        self.assertEqual(client.writes, [])
        self.assertEqual(self.update(client)["cached"], 2)
        self.assertEqual(len(self.remote.calls), 2)

    def test_unlinked_scenes_use_stored_fingerprints_and_recheck_when_they_change(self):
        row = {"id": "1", "files": [{"path": "never read", "fingerprints": [
            {"type": "md5", "value": "md5hash"}, {"type": "phash", "value": "0123456789abcdef"},
            {"type": "unsupported", "value": "ignored"}]}]}
        client = TagClient([row])
        self.remote.fingerprints["md5hash"] = [remote_scene("fingerprint-match", NEW)]
        self.assertEqual(self.update(client)["completed"], 1)
        payload = self.remote.calls[0][1]["fingerprints"][0]
        self.assertEqual(payload, [{"algorithm": "MD5", "hash": "md5hash"}, {"algorithm": "PHASH", "hash": "0123456789abcdef"}])
        self.assertEqual(self.update(client)["cached"], 1)
        row["files"][0]["fingerprints"][0]["value"] = "newhash"
        self.assertEqual(self.update(client)["skipped"], 1)
        self.assertEqual(len(self.remote.calls), 2)

    def test_tag_ids_names_aliases_and_exclusions_are_preserved(self):
        client = self.prepare([scene("1"), scene("2")])
        client.local_tags += [
            {"id": "mapped", "name": "Local rename", "stash_ids": [{"endpoint": ENDPOINT, "stash_id": "r-mapped"}]},
            {"id": "named", "name": "Name match"}, {"id": "alias", "name": "Canonical", "aliases": ["Alias match"]}]
        found = [{"id": "r-mapped", "name": "Remote rename"}, {"id": "r-name", "name": "NAME MATCH"},
                 {"id": "r-alias", "name": "alias MATCH"}, {"id": "r-create", "name": "Created"},
                 {"id": "r-ignore", "name": "IGNORE this"}]
        client.patterns = ["^IGNORE"]
        for value in self.remote.scenes.values():
            value["tags"] = found
        result = self.update(client)
        self.assertEqual(result["tags_added"], 8)
        self.assertEqual(client.writes[0]["tag_ids"]["ids"], ["101", "alias", "mapped", "named"])
        self.assertEqual(client.created, [{"name": "Created", "stash_ids": [{"endpoint": ENDPOINT, "stash_id": "r-create"}]}])
        self.assertEqual(sum("DirtyTidyLocalTags" in query for query, _ in client.calls), 1)

    def test_partial_remote_errors_and_save_failures_are_not_cached(self):
        client = self.prepare([scene("1"), scene("2")])
        self.remote.errors.add("remote-1")
        result = self.update(client)
        self.assertEqual((result["failed"], result["completed"]), (1, 1))
        self.remote.errors.clear()
        client.fail_save = True
        result = self.update(client)
        self.assertEqual((result["failed"], result["cached"]), (1, 1))
        client.fail_save = False
        self.assertEqual(self.update(client)["completed"], 1)
        self.assertEqual(self.update(client)["cached"], 2)

    def test_transport_errors_and_malformed_data_are_retryable(self):
        client = self.prepare([scene()])
        self.remote.unavailable = True
        self.assertEqual(self.update(client)["failed"], 1)
        self.remote.unavailable = False
        self.remote.scenes["remote-1"] = {"id": "remote-1"}  # Missing tags is not an empty result.
        self.assertEqual(self.update(client)["failed"], 1)
        self.remote.scenes["remote-1"] = remote_scene("remote-1", NEW)
        self.assertEqual(self.update(client)["completed"], 1)

    def test_empty_tag_lists_are_successful_and_future_cache_stamps_are_ignored(self):
        client = self.prepare([scene()])
        self.remote.scenes["remote-1"]["tags"] = []
        self.assertEqual(self.update(client)["unchanged"], 1)
        self.now -= 1
        self.assertEqual(self.update(client)["unchanged"], 1)
        self.assertEqual(len(self.remote.calls), 2)

    def test_unconfigured_source_rejected_before_scene_access(self):
        client = self.prepare([])
        with self.assertRaisesRegex(TaggerError, "no longer configured"):
            self.update(client, endpoint="https://removed.example/graphql")
        self.assertEqual(len(client.calls), 1)


class TagTransportTests(unittest.TestCase):
    def source(self):
        return TagSource({"endpoint": ENDPOINT, "api_key": "private-key", "max_requests_per_minute": 120})

    def test_credentials_stay_in_headers_and_requests_obey_the_rate_limit(self):
        source = self.source()
        requests = []
        def response(request, timeout):
            requests.append(request)
            return io.BytesIO(b'{"data":{}}')
        source.opener = mock.Mock()
        source.opener.open.side_effect = response
        with mock.patch("dirty_tidy_tag_source.time.monotonic", return_value=100), \
                mock.patch("dirty_tidy_tag_source.time.sleep") as sleep:
            source.call("query { value }", {})
            source.call("query { value }", {})
        self.assertEqual(requests[0].get_header("Apikey"), "private-key")
        self.assertNotIn("private-key", requests[0].data.decode())
        sleep.assert_called_once_with(0.5)

    def test_transport_errors_do_not_expose_credentials(self):
        source = self.source()
        source.opener = mock.Mock()
        source.opener.open.side_effect = urllib.error.URLError("https://private-key@example.test")
        with self.assertRaises(TaggerError) as error:
            source.call("query {}", {})
        self.assertNotIn("private-key", str(error.exception))

    def test_wrong_scene_identity_and_partial_errors_never_become_valid_results(self):
        source = self.source()
        source.call = mock.Mock(return_value={"data": {"scene0": {"id": "wrong", "tags": []}, "scene1": None},
                                             "errors": [{"path": ["scene1"], "message": "failure"}]})
        values = source.by_ids(["expected", "failed"])
        self.assertTrue(all(isinstance(value, TaggerError) for value in values.values()))

    def test_fingerprint_response_length_must_match_the_batch(self):
        source = self.source()
        source.call = mock.Mock(return_value={"data": {"matches": []}})
        result = source.by_fingerprints([[{"algorithm": "MD5", "hash": "one"}]])
        self.assertIsInstance(result[0], TaggerError)


if __name__ == "__main__":
    unittest.main()
