"""Opt-in Multiscreen acceptance using isolated Stash and synthetic media only.

Run after npm run build; --serve --stop-file keeps the fixture for browser review.
Never reads the live library or connects to port 9999.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request

from plugin_paths import runtime_path
from test_dirty_compactor_stash_integration import Fixture, add_build_mode_argument, select_build_mode, verify_served_bundle


def set_settings(fixture, **settings):
    args = {"mode": "setSettings", "pluginId": "multiscreen", "settings": settings}
    return fixture.gql('mutation($args:Map!){runPluginOperation(plugin_id:"dirtyPlugins",args:$args)}', {"args": args})


def verify_frontend(fixture):
    detail = verify_served_bundle(fixture, "DirtyMultiscreen", "multiscreen", "multiscreen.js",
                                  {"LoadedNativePlayer": "LoadedNativePlayer", "NativeMultiscreenGrid": "Grid", "VisibleOCounterButton": "Counter"})
    print("PASS: " + detail, flush=True)


def exercise(fixture, transcode=False):
    files = []
    for index, name in enumerate(("Alpha", "Beta", "Gamma", "Delta")):
        path = fixture.root / "media" / (name + (".mkv" if transcode else ".mp4"))
        video_options = ["-c:v", "ffv1"] if transcode else ["-c:v", "libx264", "-preset", "ultrafast", "-movflags", "+faststart"]
        subprocess.run([shutil.which("ffmpeg"), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=192x108:rate=15",
                        "-f", "lavfi", "-i", "sine=frequency=" + str(220 + index * 110), "-t", str(12 + index * 4), *video_options,
                        "-pix_fmt", "yuv420p", "-c:a", "aac", str(path)], check=True)
        files.append(path)
    hashes = {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in files}
    fixture.scan()
    scenes = fixture.gql('{findScenes(filter:{sort:"title",direction:ASC}){count scenes{id title files{id path duration} paths{stream}}}}')["findScenes"]
    assert scenes["count"] == 4
    ids = {}
    for scene in scenes["scenes"]:
        title = Path(scene["files"][0]["path"]).stem
        fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}', {"input": {"id": scene["id"], "title": title, "details": "Synthetic Multiscreen fixture; preserve identity"}})
        ids[title] = scene["id"]
    performer = fixture.gql('mutation{performerCreate(input:{name:"Synthetic Multiscreen performer"}){id}}')["performerCreate"]["id"]
    studio = fixture.gql('mutation{studioCreate(input:{name:"Synthetic Multiscreen studio"}){id}}')["studioCreate"]["id"]
    for name in ("Alpha", "Beta"):
        fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}', {"input": {"id": ids[name], "performer_ids": [performer], "studio_id": studio}})
    tag = fixture.gql('mutation{tagCreate(input:{name:"Synthetic interval"}){id}}')["tagCreate"]["id"]
    markers = []
    for title, seconds, end in (("Explicit", 1, 3), ("Fallback", 4, None)):
        markers.append(fixture.gql('mutation($input:SceneMarkerCreateInput!){sceneMarkerCreate(input:$input){id}}', {"input": {"title": title, "seconds": seconds, "end_seconds": end, "primary_tag_id": tag, "scene_id": ids["Alpha"]}})["sceneMarkerCreate"]["id"])
    ordered = fixture.gql('{findScenes(filter:{sort:"title",direction:ASC,per_page:-1}){count scenes{id title}}}')["findScenes"]
    assert [scene["title"] for scene in ordered["scenes"]] == ["Alpha", "Beta", "Delta", "Gamma"]
    for selected in (list(ids.values())[::-1], [ids["Gamma"], ids["Alpha"]]):
        found = fixture.gql('query($ids:[ID!]){findScenes(ids:$ids,filter:{per_page:-1}){scenes{id}}}', {"ids": selected})["findScenes"]["scenes"]
        assert {scene["id"] for scene in found} == set(selected)
    script = r'''
const assert = require('node:assert/strict');
const { requireSource } = require('./tests/plugin_paths');
const url = process.argv[1];
const graphql = async (query, variables) => {
  const response = await fetch(url + '/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const result = await response.json();
  if (result.errors) throw new Error(JSON.stringify(result.errors));
  return result.data;
};
const queries = requireSource('DirtyMultiscreen', 'src/queries.ts').createQueries({ graphql });
const settings = requireSource('DirtyMultiscreen', 'src/domain/settings.ts').normalizeSettings({ sceneOrder: 'random' });
(async () => {
  const variables = await queries.getSceneQueryVariables(settings, { source: 'filter', filter: {}, sceneFilter: {} });
  assert(variables.filter.per_page <= 240);
  assert.match(variables.filter.sort, /^random_\d+$/);
  const first = await graphql(queries.findScenesQuery, { ...variables, filter: { ...variables.filter, per_page: 2 } });
  const second = await graphql(queries.findScenesQuery, { ...variables, filter: { ...variables.filter, per_page: 2, page: 2 } });
  assert.equal(new Set([...first.findScenes.scenes, ...second.findScenes.scenes].map(scene => scene.id)).size, 4);
  const repeat = await graphql(queries.findScenesQuery, { ...variables, filter: { ...variables.filter, per_page: 2 } });
  assert.deepEqual(repeat.findScenes.scenes, first.findScenes.scenes);
  const scope = { ...variables, scene_filter: { title: { value: 'Alpha', modifier: 'INCLUDES' } } };
  const search = (await queries.searchSession(scope, false, '  Alpha  ', 1, new AbortController().signal)).findScenes;
  assert.equal(search.count, 1);
  assert.equal(search.scenes[0].title, 'Alpha');
  assert(search.scenes[0].paths.stream);
  const missing = (await queries.searchSession(scope, false, 'Beta', 1, new AbortController().signal)).findScenes;
  assert.equal(missing.count, 0);
  assert.throws(() => queries.searchSession({ filter: {}, ids: [search.scenes[0].id] }, false, 'Beta', 1, new AbortController().signal), /searched locally/);
  const textScope = { filter: { q: 'Alpha' } };
  assert.equal((await queries.searchSession(textScope, false, 'Beta', 1, new AbortController().signal)).findScenes.count, 0);
  assert.equal((await queries.searchSession(textScope, false, 'Alpha', 1, new AbortController().signal)).findScenes.count, 1);
  assert.equal((await queries.searchSession({ filter: {} }, false, 'Alpha Beta', 1, new AbortController().signal)).findScenes.count, 0, 'a phrase cannot match either word separately');
  assert.equal((await queries.searchSession({ filter: {} }, false, 'aLpHa', 1, new AbortController().signal)).findScenes.count, 1, 'title search is case insensitive');
  for (const literal of ['Alpha|Beta', 'Alpha.*', 'Alpha(', '.', '[Alpha]']) {
    assert.equal((await queries.searchSession({ filter: {} }, false, literal, 1, new AbortController().signal)).findScenes.count, 0, 'search punctuation is literal: ' + literal);
  }
  const alphaId = search.scenes[0].id;
  const rename = title => graphql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}', { input: { id: alphaId, title } });
  try {
    await rename('Alpha Beta (fixture).mp4');
    const phrase = (await queries.searchSession({ filter: {} }, false, 'alpha beta', 1, new AbortController().signal)).findScenes;
    assert.equal(phrase.count, 1, 'the entire phrase matches one scene despite other scenes containing individual words');
    assert.equal(phrase.scenes[0].id, alphaId);
    const punctuation = (await queries.searchSession({ filter: {} }, false, '(fixture).mp4', 1, new AbortController().signal)).findScenes;
    assert.equal(punctuation.count, 1);
    assert.equal(punctuation.scenes[0].id, alphaId);
  } finally {
    await rename('Alpha');
  }
  for (const entity of ['performer', 'studio']) {
    const related = await queries.getSceneQueryVariables(settings, { source: entity + '-detail', [entity + 'Id']: '1' });
    assert.equal((await queries.searchSession(related, false, 'Delta', 1, new AbortController().signal)).findScenes.count, 0);
    assert.equal((await queries.searchSession(related, false, 'Beta', 1, new AbortController().signal)).findScenes.count, 1);
  }
  const markerScope = queries.getMarkerQueryVariables(settings, { source: 'marker-filter', filter: { q: 'Explicit' }, markerFilter: { scene_filter: scope.scene_filter } });
  const markerSearch = (await queries.searchSession(markerScope, true, 'Alpha', 1, new AbortController().signal)).findSceneMarkers;
  assert.equal(markerSearch.count, 1);
  assert.equal(markerSearch.scene_markers[0].title, 'Explicit');
  assert.equal(markerSearch.scene_markers[0].seconds, 1);
  assert.equal((await queries.searchSession(markerScope, true, 'Beta', 1, new AbortController().signal)).findSceneMarkers.count, 0);
  assert.equal((await queries.searchSession(markerScope, true, 'Alpha Beta', 1, new AbortController().signal)).findSceneMarkers.count, 0, 'marker sessions match the full video-title phrase');
  process.stdout.write('PASS: compiled bounded contextual query and stable seeded random continuation\n');
  process.stdout.write('PASS: session search preserves selections, filters, original text, performer/studio membership and marker ranges\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
'''
    subprocess.run([shutil.which("node"), "-e", script, fixture.url], check=True)
    for key, value in (("performers", performer), ("studios", studio)):
        result = fixture.gql('query($filter:SceneFilterType){findScenes(scene_filter:$filter,filter:{per_page:0}){count}}', {"filter": {key: {"value": [value], "modifier": "INCLUDES", **({"depth": 0} if key == "studios" else {})}}})
        assert result["findScenes"]["count"] == 2
    for scene in scenes["scenes"]:
        url = scene["paths"]["stream"]
        if url.startswith("/"):
            url = fixture.url + url
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Range": "bytes=0-31"})) as response:
            assert response.status == 206
            assert len(response.read()) == 32
    set_settings(fixture, totalScreens=4, rows=2, columns=2, sceneOrder='list', splitScenes=True, startMuted=True,
                 randomStart=False, loopScenes=False, markerDuration=2, pauseWhenHidden=True)
    snapshot = fixture.gql('{findScenes(filter:{per_page:-1}){scenes{id title details files{id path} performers{id} studio{id}}}}')["findScenes"]["scenes"]
    (fixture.root / "acceptance.json").write_text(json.dumps({"hashes": hashes, "scenes": snapshot}), encoding="utf-8")
    print("PASS: synthetic scene/marker/performer/studio contexts, title order, selected IDs, exact counts, HTTP seeking and fixture settings", flush=True)
    return {"scenes": ids, "markers": markers, "performer": performer, "studio": studio}


def verify_unchanged(fixture):
    baseline = json.loads((fixture.root / "acceptance.json").read_text(encoding="utf-8"))
    assert baseline["hashes"] == {name: hashlib.sha256(Path(name).read_bytes()).hexdigest() for name in baseline["hashes"]}
    current = fixture.gql('{findScenes(filter:{per_page:-1}){scenes{id title details files{id path} performers{id} studio{id}}}}')["findScenes"]["scenes"]
    assert sorted(current, key=lambda scene: scene["id"]) == sorted(baseline["scenes"], key=lambda scene: scene["id"])
    print("PASS: original synthetic media hashes, file/scene IDs and metadata unchanged", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True)
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--stop-file", type=Path)
    parser.add_argument("--transcode", action="store_true", help="Use synthetic FFV1 media to exercise native source fallback and seek offsets")
    add_build_mode_argument(parser)
    args = parser.parse_args()
    select_build_mode(args)
    fixture = Fixture(args.binary)
    try:
        shutil.copytree(runtime_path("DirtyMultiscreen"), fixture.root / "plugins" / "multiscreen")
        fixture.gql("mutation{reloadPlugins}")
        fixture.gql("mutation{setPluginsEnabled(enabledMap:{dirtyPlugins:true,multiscreen:true,dirtyTasks:false})}")
        print("FIXTURE " + fixture.url + " " + str(fixture.root), flush=True)
        verify_frontend(fixture)
        ids = exercise(fixture, args.transcode)
        print("FIXTURE_IDS " + json.dumps(ids), flush=True)
        if args.serve:
            print("UI " + fixture.url + "/scenes", flush=True)
            while not args.stop_file or not args.stop_file.exists():
                time.sleep(1)
        verify_unchanged(fixture)
    except Exception:
        fixture.log.flush()
        print((fixture.root / "stash.log").read_text(errors="replace")[-3000:], flush=True)
        raise
    finally:
        fixture.close()


if __name__ == "__main__":
    main()
