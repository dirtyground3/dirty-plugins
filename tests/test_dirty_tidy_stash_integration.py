"""Opt-in Tidy acceptance against disposable Stash and synthetic media only.

Run after npm run build. --serve --stop-file retains the fixture for UI review.
Never connects to live port 9999 or reads its media/database.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

from plugin_paths import runtime_path
from test_dirty_compactor_stash_integration import Fixture, add_build_mode_argument, select_build_mode, verify_served_bundle
from test_dirty_file_extractor_stash_integration import finish


def operation(fixture, plugin, **args):
    value = fixture.gql('mutation($plugin:ID!,$args:Map!){runPluginOperation(plugin_id:$plugin,args:$args)}',
                        {"plugin": plugin, "args": args})["runPluginOperation"]
    for _ in range(5):
        if isinstance(value, str):
            value = json.loads(value)
        elif isinstance(value, dict) and "error" in value:
            raise RuntimeError(value["error"])
        elif isinstance(value, dict) and "output" in value:
            value = value["output"]
        else:
            return value
    raise AssertionError(value)


def settings(fixture, values=None):
    if values is None:
        return operation(fixture, "dirtyPlugins", mode="getSettings", pluginId="dirtyTidy")["settings"]
    return operation(fixture, "dirtyPlugins", mode="setSettings", pluginId="dirtyTidy", settings=values)


def preview(fixture, values):
    return operation(fixture, "dirtyTidy", mode="preview", settings=values)


def scenes(fixture):
    return fixture.gql('{findScenes(filter:{per_page:-1}){scenes{id title details files{id path}}}}')["findScenes"]["scenes"]


def synthetic(fixture, name, color):
    path = fixture.root / "media" / (name + ".mp4")
    subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i",
                    "color=c=" + color + ":size=160x90:rate=25", "-t", "2", "-c:v", "libx264", str(path)], check=True)
    return path


def verify_frontend(fixture):
    detail = verify_served_bundle(fixture, "DirtyTidy", "dirtyTidy", "dirtyTidy.js",
                                  {"Settings": "Settings", "PreviewTable": "PreviewTable", "Confirmation": "Confirmation"})
    print("PASS: " + detail, flush=True)


def measure_snapshot_payload(fixture, values):
    sys.path.insert(0, str(runtime_path("DirtyTidy")))
    from dirty_tidy import StashClient, normalize_settings

    client = StashClient({"Port": fixture.port})
    client.call = fixture.gql
    _roots, selected = client.library_snapshot(normalize_settings(values))
    baseline = fixture.gql('''{findScenes(filter:{per_page:-1,sort:"id",direction:ASC}){scenes{
        id title date rating100 organized stash_ids{stash_id}
        studio{name parent_studio{name}} performers{name gender} tags{name}
        groups{scene_index group{name}} files{id path basename duration width height video_codec}
    }}}''')["findScenes"]["scenes"]
    assert len(selected) == len(baseline)
    for current, previous in zip(selected, baseline):
        assert {key: current[key] for key in ("id", "title", "date", "studio")} == {
            key: previous[key] for key in ("id", "title", "date", "studio")}
        assert current["files"] == [{key: file[key] for key in ("id", "path", "basename")}
                                    for file in previous["files"]]
    encoded = lambda rows: len(json.dumps(rows, separators=(",", ":")).encode("utf-8"))
    before, after = encoded(baseline), encoded(selected)
    assert after < before
    print(f"PASS: strategy snapshot retains plan inputs; synthetic decoded scene JSON {before} -> {after} bytes", flush=True)


def exercise(fixture):
    originals = [synthetic(fixture, name, color) for name, color in
                 (("manual", "blue"), ("unknown", "green"), ("collision", "red"), ("missing", "yellow"))]
    hashes = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in originals}
    fixture.scan()
    original_scenes = scenes(fixture)
    for scene in original_scenes:
        name = Path(scene["files"][0]["path"]).stem
        # The unknown scene deliberately has no date/studio/title.
        fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}',
                    {"input": {"id": scene["id"], "title": "" if name == "unknown" else name.title(),
                               "details": "Preserve synthetic " + name + " metadata"}})
    values = {"moveEnabled": True, "moveRequireStashId": False, "hierarchyLevels": ["Organized", "{studio}", "{year}"],
              "renameEnabled": True, "renameRequireStashId": False, "renamePattern": "{title}",
              "maxFilenameLength": 180, "multiValueSeparator": ", ", "automationMode": "manual",
              "approvedStrategyHash": "", "approvedPlanDigest": ""}
    settings(fixture, values)
    measure_snapshot_payload(fixture, values)
    destination = fixture.root / "media" / "Organized" / "Unknown" / "Unknown"
    destination.mkdir(parents=True)
    sentinel = destination / "Collision.mp4"
    sentinel.write_bytes(b"synthetic collision sentinel")
    missing = fixture.root / "media" / "missing.mp4"
    held = fixture.root / "held-missing.mp4"
    missing.rename(held)
    plan = preview(fixture, values)
    assert plan["summary"]["ready"] == 2 and plan["summary"]["blocked"] == 1 and plan["summary"]["warnings"] == 1, plan
    assert settings(fixture) == values
    assert all(path.exists() for path in originals if path != missing)
    assert not (destination / "Manual.mp4").exists()
    unknown = next(item for item in plan["operations"] if Path(item["source_path"]).stem == "unknown")
    assert Path(unknown["destination_path"]) == destination / "unknown.mp4"
    print("PASS: preview does not save/move; unknown folders, all-missing rename retention, missing-file warning and blocked collision", flush=True)

    changed = dict(values, maxFilenameLength=179)
    settings(fixture, changed)
    try:
        operation(fixture, "dirtyTidy", mode="execute", expectedStrategyHash=plan["strategy_hash"], expectedPlanDigest=plan["plan_digest"])
    except RuntimeError as error:
        assert "stale" in str(error), error
    else:
        raise AssertionError("Stale strategy must be rejected")
    assert (fixture.root / "media" / "manual.mp4").exists()
    settings(fixture, values)
    held.rename(missing)
    later = synthetic(fixture, "later", "purple")
    hashes[later.name] = hashlib.sha256(later.read_bytes()).hexdigest()
    fixture.scan()
    later_plan = preview(fixture, values)
    assert later_plan["strategy_hash"] == plan["strategy_hash"] and later_plan["plan_digest"] != plan["plan_digest"]
    assert later_plan["summary"]["ready"] == 4, later_plan
    result = operation(fixture, "dirtyTidy", mode="execute", expectedStrategyHash=plan["strategy_hash"], expectedPlanDigest=plan["plan_digest"])
    assert result["completed"] == 2 and result["failed"] == 0 and result["unreviewed"] == 2, result
    assert later.exists() and missing.exists() and sentinel.read_bytes() == b"synthetic collision sentinel"
    assert (destination / "Manual.mp4").exists() and (destination / "unknown.mp4").exists()
    assert not (fixture.root / "media" / "manual.mp4").exists()
    print("PASS: stale approval rejected; earlier preview stays immutable after a later preview; native confined move/rename skips restored/new unreviewed files and collisions", flush=True)

    automated = dict(values, hierarchyLevels=["Automated", "{studio}"], automationMode="scan")
    reviewed = preview(fixture, automated)
    automated.update(approvedStrategyHash=reviewed["strategy_hash"], approvedPlanDigest=reviewed["plan_digest"])
    settings(fixture, automated)
    future = synthetic(fixture, "future", "orange")
    hashes[future.name] = hashlib.sha256(future.read_bytes()).hexdigest()
    job_id = fixture.gql('mutation($input:ScanMetadataInput!){metadataScan(input:$input)}',
                         {"input": {"paths": [str(fixture.root / "media")], "scanGenerateCovers": False}})["metadataScan"]
    finish(fixture, job_id)
    source = fixture.gql('query($id:ID!){findJob(input:{id:$id}){id startTime}}', {"id": job_id})["findJob"]
    args = {"mode": "queueAutomation", "automationTrigger": "scan", "sourceJobId": job_id, "sourceStartTime": source["startTime"]}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: operation(fixture, "dirtyTidy", **args), range(2)))
    queued = [item["queuedJobId"] for item in results if item.get("queuedJobId")]
    assert len(queued) == 1 and any(item.get("reason") == "duplicate" for item in results), results
    finish(fixture, queued[0])
    assert not future.exists()
    assert (fixture.root / "media" / "Automated" / "Unknown" / "future.mp4").exists()
    assert operation(fixture, "dirtyTidy", **args)["reason"] == "duplicate"
    assert operation(fixture, "dirtyTidy", **dict(args, automationTrigger="generate"))["reason"] == "disabled"
    print("PASS: successful native Scan, atomic two-client deduplication/replay, approved rules apply to future scenes, wrong trigger skipped", flush=True)

    current = scenes(fixture)
    by_id = {scene["id"]: scene for scene in current}
    for original in original_scenes:
        scene = by_id[original["id"]]
        name = Path(original["files"][0]["path"]).stem
        assert scene["files"][0]["id"] == original["files"][0]["id"]
        assert scene["details"] == "Preserve synthetic " + name + " metadata"
    for scene in current:
        path = Path(scene["files"][0]["path"]).resolve()
        assert path.is_relative_to((fixture.root / "media").resolve())
        # A title-only rename changes case but preserves bytes.
        original_name = next(name for name in hashes if name.lower() == path.name.lower())
        assert hashlib.sha256(path.read_bytes()).hexdigest() == hashes[original_name]
    assert sentinel.read_bytes() == b"synthetic collision sentinel"
    print("PASS: all original file bytes, extensions, scene/file IDs and metadata preserved; every native destination confined to fixture source", flush=True)
    browser = dict(values, hierarchyLevels=["BrowserReview", "{studio}"], renamePattern="{title} - reviewed")
    settings(fixture, browser)
    return {"scenes": [scene["id"] for scene in current], "browserSettings": browser}


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
        shutil.copytree(runtime_path("DirtyTidy"), fixture.root / "plugins" / "dirtyTidy")
        fixture.gql("mutation{reloadPlugins}")
        fixture.gql("mutation{setPluginsEnabled(enabledMap:{dirtyPlugins:true,dirtyTidy:true})}")
        print("FIXTURE " + fixture.url + " " + str(fixture.root), flush=True)
        verify_frontend(fixture)
        ids = exercise(fixture)
        print("FIXTURE_IDS " + json.dumps(ids), flush=True)
        if args.serve:
            print("UI " + fixture.url + "/plugins/dirty-plugins?plugin=dirtyTidy&docsCapture=1", flush=True)
            while not args.stop_file or not args.stop_file.exists():
                time.sleep(1)
    except Exception:
        fixture.log.flush()
        print((fixture.root / "stash.log").read_text(encoding="utf-8", errors="replace")[-3000:], flush=True)
        raise
    finally:
        fixture.close()


if __name__ == "__main__":
    main()
