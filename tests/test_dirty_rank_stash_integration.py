"""Opt-in Rank acceptance against isolated Stash and generated fixture media.

Run after npm run build. --serve --stop-file keeps the instance for browser QA.
Never connects to the live library on port 9999.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request

from plugin_paths import runtime_path
from test_dirty_compactor_stash_integration import Fixture, add_build_mode_argument, select_build_mode, verify_served_bundle


def operation(fixture, mode, **args):
    result = fixture.gql('mutation($args:Map!){runPluginOperation(plugin_id:"dirtyRank",args:$args)}',
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
    detail = verify_served_bundle(fixture, "DirtyRank", "dirtyRank", "dirtyRank.js",
                                  {"DirtyRankSettings": "src/settingsPanel", "LoadedNativePreview": "Preview", "LeaderboardPodium": "Leaderboards"})
    print("PASS: " + detail, flush=True)


def exercise(fixture):
    files = []
    for index in range(2):
        path = fixture.root / "media" / ("Synthetic scene " + str(index + 1) + ".mp4")
        subprocess.run([shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                        "testsrc2=size=192x108:rate=15", "-f", "lavfi", "-i", "sine=frequency=" + str(220 + index * 220),
                        "-t", "15", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", str(path)], check=True)
        files.append(path)
    fixture.scan()
    people = []
    image = fixture.root / "synthetic.png"
    subprocess.run([shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "testsrc2=size=120x160:rate=1", "-frames:v", "1", str(image)], check=True)
    encoded = "data:image/png;base64," + base64.b64encode(image.read_bytes()).decode()
    for index, name in enumerate(("Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta", "Eta", "Theta", "Iota")):
        person = fixture.gql('mutation($input:PerformerCreateInput!){performerCreate(input:$input){id name}}',
                             {"input": {"name": "Synthetic " + name, "gender": "FEMALE" if index < 8 else "MALE", "image": encoded}})["performerCreate"]
        people.append(person)
    scenes = fixture.gql('{findScenes(filter:{per_page:-1}){scenes{id title files{id path} paths{stream}}}}')["findScenes"]["scenes"]
    for index, scene in enumerate(scenes):
        fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}',
                     {"input": {"id": scene["id"], "title": "Synthetic top scene " + str(index + 1), "rating100": 100 - index * 10,
                                "performer_ids": [person["id"] for person in people]}})
    tag = fixture.gql('mutation{tagCreate(input:{name:"Synthetic marker"}){id}}')["tagCreate"]["id"]
    marker = fixture.gql('mutation($input:SceneMarkerCreateInput!){sceneMarkerCreate(input:$input){id}}',
                         {"input": {"title": "Synthetic interval", "seconds": 2, "end_seconds": 4,
                                    "primary_tag_id": tag, "scene_id": scenes[0]["id"]}})["sceneMarkerCreate"]["id"]
    # Exercise the compiled media module's actual queries against native rating/null filters and marker sorting.
    fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}',
                {"input": {"id": scenes[1]["id"], "rating100": 100}})
    earlier = fixture.gql('mutation($input:SceneMarkerCreateInput!){sceneMarkerCreate(input:$input){id}}',
                         {"input": {"title": "Earlier tied scene", "seconds": 1, "end_seconds": 3,
                                    "primary_tag_id": tag, "scene_id": scenes[1]["id"]}})["sceneMarkerCreate"]["id"]
    script = r'''
const assert = require('node:assert/strict');
const { requireSource } = require('./tests/plugin_paths');
const url = process.argv[1], performer = process.argv[2], expected = process.argv[3];
const calls = [];
global.window = { PluginApi: {}, DirtyPlugins: { graphql: async (query, variables) => {
  calls.push(variables);
  const response = await fetch(url + '/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const result = await response.json();
  if (result.errors) throw new Error(JSON.stringify(result.errors));
  return result.data;
} } };
const media = requireSource('DirtyRank', 'src/domain/media.ts');
(async () => {
  const preferred = await media.loadPreferredMedia(performer, false);
  assert.equal(preferred.marker.id, expected);
  assert.equal(calls.length, 2);
  assert(calls.every(variables => variables.filter.per_page === 1));
  const full = await media.loadPreferredMedia(performer, true);
  assert.equal(full.rating100, 100);
  assert.equal(full.marker, undefined);
  media.invalidatePerformerMedia();
  process.stdout.write('PASS: compiled bounded preferred-media queries, tied rating and earliest marker\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
'''
    subprocess.run([shutil.which("node"), "-e", script, fixture.url, people[0]["id"], earlier], check=True)
    for scene in scenes:
        fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}',
                    {"input": {"id": scene["id"], "rating100": None}})
    subprocess.run([shutil.which("node"), "-e", script.replace("assert.equal(full.rating100, 100);", "assert.equal(full.rating100, null);"),
                    fixture.url, people[0]["id"], earlier], check=True)
    for index, scene in enumerate(scenes):
        fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}',
                    {"input": {"id": scene["id"], "rating100": 100 - index * 10}})
    snapshot = operation(fixture, "getSettings")
    settings = {**snapshot["settings"], "categories": json.dumps({"FEMALE": [{"id": "appearance", "name": "Appearance"}]}),
                "includePerformersWithoutImages": True, "autoPlayTopScenes": False, "showRatingsBeforeVote": True,
                "leaderboardTopCount": 3, "leaderboardPerformerCount": 6, "leaderboardView": "gallery"}
    operation(fixture, "saveSettings", settings=settings, expectedRevision=snapshot["revision"])
    for index in range(16):
        left, right = people[index % 8], people[(index + 1) % 8]
        operation(fixture, "record", leftId=left["id"], rightId=right["id"], battleId="fixture-seed-" + str(index),
                  categoryId="appearance", cohort="FEMALE", outcome="left" if index % 3 else "draw")
    before = operation(fixture, "loadAll")
    args = {"leftId": people[0]["id"], "rightId": people[1]["id"], "battleId": "fixture-roundtrip", "categoryId": "appearance", "cohort": "FEMALE"}
    operation(fixture, "record", **args, outcome="right")
    operation(fixture, "undo", **args)
    after = operation(fixture, "loadAll")
    assert {key: value["pools"] for key, value in before["states"].items()} == {
        key: value["pools"] for key, value in after["states"].items()}, "record/undo restores exact rating pools"
    assert after["revision"] > before["revision"], "undo publishes a fresh revision"
    for scene in scenes:
        stream = scene["paths"]["stream"]
        with urllib.request.urlopen(urllib.request.Request(stream if stream.startswith("http") else fixture.url + stream,
                                                          headers={"Range": "bytes=0-31"})) as response:
            assert response.status == 206 and len(response.read()) == 32
    snapshot = fixture.gql('{findScenes(filter:{per_page:-1}){scenes{id title files{id path} performers{id} rating100}}}')["findScenes"]["scenes"]
    (fixture.root / "acceptance.json").write_text(json.dumps({"hashes": {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in files},
                                                             "scenes": snapshot}), encoding="utf-8")
    print("PASS: synthetic performers/photos/scenes/marker, seeded independent ratings, exact record/undo round trip and seekable streams", flush=True)
    return {"people": people, "scenes": [scene["id"] for scene in scenes], "marker": marker}


def verify_unchanged(fixture):
    before = json.loads((fixture.root / "acceptance.json").read_text(encoding="utf-8"))
    assert before["hashes"] == {name: hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in before["hashes"]}
    current = fixture.gql('{findScenes(filter:{per_page:-1}){scenes{id title files{id path} performers{id} rating100}}}')["findScenes"]["scenes"]
    assert sorted(current, key=lambda item: item["id"]) == sorted(before["scenes"], key=lambda item: item["id"])
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
        shutil.copytree(runtime_path("DirtyRank"), fixture.root / "plugins" / "dirtyRank")
        fixture.gql("mutation{reloadPlugins}")
        fixture.gql("mutation{setPluginsEnabled(enabledMap:{dirtyPlugins:true,dirtyRank:true,dirtyCompactor:false})}")
        print("FIXTURE " + fixture.url + " " + str(fixture.root), flush=True)
        verify_frontend(fixture)
        print("FIXTURE_IDS " + json.dumps(exercise(fixture)), flush=True)
        print("UI " + fixture.url + "/plugins/dirty-rank", flush=True)
        if args.serve:
            while not args.stop_file or not args.stop_file.exists():
                time.sleep(1)
        verify_unchanged(fixture)
    finally:
        fixture.close()


if __name__ == "__main__":
    main()
