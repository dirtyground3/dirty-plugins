"""Opt-in Stats acceptance using isolated Stash and generated synthetic media.

Run after npm run build. --serve --stop-file retains the fixture for browser QA.
Never connects to the live library on port 9999.
"""
import argparse
import base64
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import time

from plugin_paths import runtime_path
from test_dirty_compactor_stash_integration import Fixture, add_build_mode_argument, select_build_mode, verify_served_bundle


def shared(fixture, mode, **args):
    result = fixture.gql('mutation($args:Map!){runPluginOperation(plugin_id:"dirtyPlugins",args:$args)}',
                         {"args": {"mode": mode, **args}})["runPluginOperation"]
    for _ in range(5):
        if isinstance(result, str):
            result = json.loads(result)
        elif "output" in result:
            result = result["output"]
        else:
            break
    if result.get("error"):
        raise RuntimeError(result["error"])
    return result


def verify_frontend(fixture):
    expected_version = re.search(r"^version:\s*(\S+)", runtime_path("DirtyStats", "dirtyStats.yml").read_text(encoding="utf-8"), re.M).group(1)
    loaded = [plugin for plugin in fixture.gql('{plugins{id version enabled}}')["plugins"] if plugin["id"] == "dirtyStats"]
    assert len(loaded) == 1 and loaded[0]["enabled"] and loaded[0]["version"] == expected_version
    detail = verify_served_bundle(fixture, "DirtyStats", "dirtyStats", "dirtyStats.js",
                                  {"DirtyStatsRoute": "Route", "GrowthPage": "Growth", "DashboardPage": "src/dashboard/Page"},
                                  required=("src/echarts.ts", "vendor/world.js", "echarts/lib/chart/map/install.js"))
    print("PASS: enabled " + expected_version + "; " + detail, flush=True)


def exercise(fixture):
    files = []
    for index in range(6):
        path = fixture.root / "media" / ("Synthetic scene " + str(index + 1) + ".mp4")
        subprocess.run([shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                        "testsrc2=size=192x108:rate=15", "-t", str(index + 2), "-c:v", "libx264", "-preset", "ultrafast",
                        "-pix_fmt", "yuv420p", str(path)], check=True)
        files.append(path)
    fixture.scan()
    image = fixture.root / "synthetic.png"
    subprocess.run([shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "testsrc2=size=120x160:rate=1", "-frames:v", "1", str(image)], check=True)
    encoded = "data:image/png;base64," + base64.b64encode(image.read_bytes()).decode()
    people = []
    for index in range(32):
        birthday = (date.today() + timedelta(days=index % 16)).replace(year=1980 + index % 20)
        person = {"name": "Synthetic performer " + str(index + 1).zfill(2), "gender": "FEMALE" if index % 2 else "MALE",
                  "country": ("United States", "Canada", "France", "N/A")[index % 4], "birthdate": birthday.isoformat(),
                  "rating100": 50 + index % 11 * 5, "image": encoded}
        if index == 31:
            person["death_date"] = "2020-01-01"
        people.append(fixture.gql('mutation($input:PerformerCreateInput!){performerCreate(input:$input){id name}}', {"input": person})["performerCreate"])
    tags = [fixture.gql('mutation($input:TagCreateInput!){tagCreate(input:$input){id}}', {"input": {"name": name}})["tagCreate"]["id"]
            for name in ("Synthetic blue", "Synthetic green", "Synthetic gold")]
    studios = [fixture.gql('mutation($input:StudioCreateInput!){studioCreate(input:$input){id}}',
                           {"input": {"name": "Synthetic studio " + name, "image": encoded}})["studioCreate"]["id"] for name in ("A", "B")]
    scenes = fixture.gql('{findScenes(filter:{per_page:-1,sort:"id"}){scenes{id title files{id path size} paths{stream}}}}')["findScenes"]["scenes"]
    for index, scene in enumerate(scenes):
        fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}',
                     {"input": {"id": scene["id"], "title": "Synthetic scene " + str(index + 1), "date": "2026-" + str(index + 2).zfill(2) + "-01",
                                "rating100": 50 + index * 10, "performer_ids": [person["id"] for person in people],
                                "tag_ids": tags[:1 + index % 3], "studio_id": studios[index % 2]}})
        for _ in range(index + 1):
            fixture.gql('mutation($id:ID!){sceneAddPlay(id:$id){__typename}}', {"id": scene["id"]})
    snapshot = shared(fixture, "getSettings", pluginId="dirtyStats")
    settings = {**snapshot["settings"], "growthDateBasis": "scene_date", "growthGrouping": "month", "growthShowForecast": True,
                "growthShowCapacity": True, "scatterMinRating": 5, "scatterMaxScenes": 10}
    shared(fixture, "setSettings", pluginId="dirtyStats", settings=settings, expectedRevision=snapshot["revision"])
    media = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    snapshot_query = '{findScenes(filter:{per_page:-1,sort:"id"}){scenes{id title date rating100 play_count o_counter files{id path size} performers{id} studio{id} tags{id}}}findPerformers(filter:{per_page:-1,sort:"id"}){performers{id name country rating100 birthdate death_date}}}'
    (fixture.root / "acceptance.json").write_text(json.dumps({"hashes": media, "query": snapshot_query,
                                                             "metadata": fixture.gql(snapshot_query)}), encoding="utf-8")
    print("PASS: 32 synthetic portraits/performers, six seekable scenes, dates, ratings, studios, tags and real source capacity", flush=True)
    return {"people": people, "scenes": [scene["id"] for scene in scenes]}


def verify_unchanged(fixture):
    before = json.loads((fixture.root / "acceptance.json").read_text(encoding="utf-8"))
    assert before["hashes"] == {name: hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in before["hashes"]}
    assert fixture.gql(before["query"]) == before["metadata"]
    print("PASS: generated media, identities and native metadata unchanged", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True)
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--stop-file", type=Path)
    add_build_mode_argument(parser)
    args = parser.parse_args()
    select_build_mode(args)
    fixture = Fixture(args.binary)
    try:
        shutil.copytree(runtime_path("DirtyStats"), fixture.root / "plugins" / "dirtyStats")
        fixture.gql("mutation{reloadPlugins}")
        fixture.gql("mutation{setPluginsEnabled(enabledMap:{dirtyPlugins:true,dirtyStats:true,dirtyTasks:false})}")
        print("FIXTURE " + fixture.url + " " + str(fixture.root), flush=True)
        verify_frontend(fixture)
        print("FIXTURE_IDS " + json.dumps(exercise(fixture)), flush=True)
        print("UI " + fixture.url + "/plugins/dirty-stats/dashboard", flush=True)
        if args.serve:
            while not args.stop_file or not args.stop_file.exists():
                time.sleep(1)
        verify_frontend(fixture)
        verify_unchanged(fixture)
    finally:
        fixture.close()


if __name__ == "__main__":
    main()
