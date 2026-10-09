"""Opt-in Captions acceptance with isolated Stash and synthetic subtitles only.

Run after npm run build; add --serve --stop-file for browser review.
Never uses the live port 9999, personal media, or the live database.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time

from plugin_paths import runtime_path
from test_dirty_compactor_stash_integration import Fixture, wait_for, add_build_mode_argument, select_build_mode, verify_served_bundle
from test_dirty_file_extractor_stash_integration import finish
from test_dirty_tidy_stash_integration import operation


def op(fixture, mode, **args):
    return operation(fixture, "dirtyCaptions", mode=mode, **args)


def settings(fixture, values=None):
    if values is None:
        return operation(fixture, "dirtyPlugins", mode="getSettings", pluginId="dirtyCaptions")["settings"]
    return operation(fixture, "dirtyPlugins", mode="setSettings", pluginId="dirtyCaptions", settings=values)


def all_scenes(fixture):
    return fixture.gql('{findScenes(filter:{per_page:-1}){scenes{id title custom_fields files{id path}}}}')["findScenes"]["scenes"]


def settled(fixture):
    wait_for(lambda: not fixture.gql("{jobQueue{id}}") ["jobQueue"])
    value = op(fixture, "indexStatus")
    assert value["status"] == "Finished", value
    return value


def verify_frontend(fixture):
    detail = verify_served_bundle(fixture, "DirtyCaptions", "dirtyCaptions", "dirtyCaptions.js",
                                  {"CaptionsController": "CaptionsController", "IndexSettings": "IndexSettings", "IndexMonitor": "IndexMonitor"})
    print("PASS: " + detail, flush=True)


def exercise(fixture):
    values = {"enabled": True, "showByDefault": True, "preferredLanguage": "eng", "indexEnabled": False, "refreshAfterScan": False}
    settings(fixture, values)
    inputs = fixture.root / "synthetic-subtitle-inputs"
    inputs.mkdir()
    for name, line in (("english", "Hello synthetic caption"), ("french", "Bonjour scène synthétique")):
        (inputs / (name + ".srt")).write_text("1\n00:00:01,000 --> 00:00:03,000\n" + line + "\n\n2\n00:00:04,000 --> 00:00:06,000\n" + line + " again\n", encoding="utf-8")
    video = fixture.root / "media" / "synthetic-captions.mp4"
    subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=25",
                    "-i", str(inputs / "english.srt"), "-i", str(inputs / "french.srt"), "-map", "0:v", "-map", "1:0", "-map", "2:0",
                    "-c:v", "libx264", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", "-metadata:s:s:1", "language=fra",
                    "-disposition:s:0", "0", "-disposition:s:1", "default", "-t", "8", str(video)], check=True)
    empty = fixture.root / "media" / "synthetic-empty.mp4"
    subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "color=c=green:size=160x90:rate=25",
                    "-t", "2", "-c:v", "libx264", str(empty)], check=True)
    hashes = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in (video, empty)}
    fixture.scan()
    scenes = all_scenes(fixture)
    captions = next(scene for scene in scenes if Path(scene["files"][0]["path"]) == video)
    no_captions = next(scene for scene in scenes if Path(scene["files"][0]["path"]) == empty)
    for scene in scenes:
        fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}', {"input": {
            "id": scene["id"], "title": "Synthetic " + ("captions" if scene["id"] == captions["id"] else "without captions"),
            "custom_fields": {"partial": {"personal": "keep"}}}})
    before_files = sorted(str(path.relative_to(fixture.root)) for path in (fixture.root / "media").rglob("*"))
    result = op(fixture, "captions", sceneId=captions["id"], fileId=captions["files"][0]["id"])
    assert [track["language"] for track in result["tracks"]] == ["eng", "fra"]
    assert all(track["vtt"].startswith("WEBVTT") for track in result["tracks"])
    assert "scène synthétique" in result["tracks"][1]["vtt"] and result["tracks"][1]["default"]
    assert not op(fixture, "captions", sceneId=no_captions["id"])["tracks"]
    assert before_files == sorted(str(path.relative_to(fixture.root)) for path in (fixture.root / "media").rglob("*"))
    assert not any(path.suffix in (".vtt", ".srt") for path in (fixture.root / "plugins").rglob("*"))
    print("PASS: real FFmpeg stdout WebVTT, two languages/Unicode/default flags, empty media, no generated subtitle sidecars", flush=True)

    values["indexEnabled"] = True
    settings(fixture, values)
    op(fixture, "indexRefresh")
    first = settled(fixture)
    assert first["probed"] == 2 and first["errors"] == 0, first
    indexed = {scene["id"]: scene for scene in all_scenes(fixture)}
    assert indexed[captions["id"]]["custom_fields"] == {"personal": "keep", "Contains embedded captions": "Yes", "Contains embedded text captions": "Yes", "Caption index status": "Ready"}
    assert indexed[no_captions["id"]]["custom_fields"]["Contains embedded captions"] == "No"
    # Physically unavailable but unchanged media proves the fast path skips file
    # access based on Stash's stored map. This is confined to this fixture.
    held = fixture.root / "held-synthetic.mp4"
    video.rename(held)
    try:
        op(fixture, "indexRefresh")
        skipped = settled(fixture)
        assert skipped["probed"] == 0 and skipped["errors"] == 0 and skipped["skipped"] == 2, skipped
        op(fixture, "indexRefresh", force=True)
        failed = settled(fixture)
        assert failed["errors"] == 1, failed
        fields = next(scene for scene in all_scenes(fixture) if scene["id"] == captions["id"])["custom_fields"]
        assert fields == {"personal": "keep", "Caption index status": "Error"}, fields
    finally:
        held.rename(video)
    op(fixture, "indexRefresh", force=True)
    forced = settled(fixture)
    assert forced["forceRun"] and forced["probed"] == 2 and forced["errors"] == 0, forced
    print("PASS: partial owned fields preserve personal metadata; file-ID map skips unavailable unchanged media, forced errors stay unverified, forced reprobe recovers", flush=True)

    job_id = fixture.gql('mutation($input:ScanMetadataInput!){metadataScan(input:$input)}',
                         {"input": {"paths": [str(fixture.root / "media")], "scanGenerateCovers": False}})["metadataScan"]
    finish(fixture, job_id)
    start = fixture.gql('query($id:ID!){findJob(input:{id:$id}){startTime}}', {"id": job_id})["findJob"]["startTime"]
    assert op(fixture, "indexAfterScan", jobId=job_id, startTime=start)["skipped"] == "disabled"
    values["refreshAfterScan"] = True
    settings(fixture, values)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: op(fixture, "indexAfterScan", jobId=job_id, startTime=start), range(2)))
    # A client can see the claimed Queued state before the owner publishes its
    # Stash job ID. Verify the published ID and actual completed task.
    queued = {str(result["jobId"]) for result in results if result["jobId"]}
    assert len(queued) == 1 and job_id not in queued, results
    final = settled(fixture)
    assert str(final["jobId"]) == str(int(job_id) + 1)
    finish(fixture, final["jobId"])
    assert final["probed"] == 0 and final["skipped"] == 2
    replay = op(fixture, "indexAfterScan", jobId=job_id, startTime=start)
    assert replay["jobId"] == final["jobId"] and replay["lastFullScan"] == final["lastFullScan"]
    sys.path.insert(0, str(fixture.root / "plugins" / "dirtyPlugins"))
    import dirty_plugins_storage as storage
    storage.internal_scan_register("98765", path=fixture.root / "plugins" / "dirtyPlugins" / "dirty_plugins.sqlite3")
    assert op(fixture, "indexAfterScan", jobId="98765", startTime=datetime.now(timezone.utc).isoformat())["skipped"] == "internal"
    print("PASS: opt-in completed Scan, two-client deduplication/replay and internal-scan exclusion; unchanged media never reprobed", flush=True)
    for scene in all_scenes(fixture):
        path = Path(scene["files"][0]["path"])
        assert hashlib.sha256(path.read_bytes()).hexdigest() == hashes[path.name]
        original = next(item for item in scenes if item["id"] == scene["id"])
        assert scene["files"] == original["files"] and scene["custom_fields"]["personal"] == "keep"
    print("PASS: media bytes, file/scene identity and unrelated fields preserved; hook workers settle without recursion", flush=True)
    return {"captions": captions["id"], "empty": no_captions["id"], "captionFile": captions["files"][0]["id"]}


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
        shutil.copytree(runtime_path("DirtyCaptions"), fixture.root / "plugins" / "dirtyCaptions")
        fixture.gql("mutation{reloadPlugins}")
        fixture.gql("mutation{setPluginsEnabled(enabledMap:{dirtyPlugins:true,dirtyCaptions:true})}")
        print("FIXTURE " + fixture.url + " " + str(fixture.root), flush=True)
        verify_frontend(fixture)
        ids = exercise(fixture)
        print("FIXTURE_IDS " + json.dumps(ids), flush=True)
        if args.serve:
            print("UI " + fixture.url + "/scenes/" + ids["captions"], flush=True)
            while not args.stop_file or not args.stop_file.exists():
                time.sleep(1)
    except Exception:
        fixture.log.flush()
        print((fixture.root / "stash.log").read_text(encoding="utf-8", errors="replace")[-3500:], flush=True)
        raise
    finally:
        fixture.close()


if __name__ == "__main__":
    main()
