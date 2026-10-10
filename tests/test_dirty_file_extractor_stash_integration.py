"""Opt-in Extractor acceptance with isolated Stash and synthetic media only.

Run after npm run build. --serve --stop-file leaves the fixture for UI review.
Never connects to the live port 9999 or reads its media/database.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import time
from unittest import mock

from plugin_paths import runtime_path
from test_dirty_compactor_stash_integration import Fixture, wait_for, add_build_mode_argument, select_build_mode, verify_served_bundle


def set_settings(fixture, **settings):
    args = {"mode": "setSettings", "pluginId": "extractScenes", "settings": settings}
    return fixture.gql('mutation($args:Map!){runPluginOperation(plugin_id:"dirtyPlugins",args:$args)}', {"args": args})


def job(fixture, job_id):
    return fixture.gql('query($id:ID!){findJob(input:{id:$id}){id status progress error}}', {"id": job_id})["findJob"]


def queue(fixture, selection):
    return fixture.gql('mutation($args:Map!){runPluginTask(plugin_id:"extractScenes",description:"Controlled synthetic extraction",args_map:$args)}',
                       {"args": selection})["runPluginTask"]


def finish(fixture, job_id):
    value = wait_for(lambda: (value if value and value["status"] not in ("READY", "RUNNING", "STOPPING") else None)
                     if (value := job(fixture, job_id)) else None)
    assert value["status"] == "FINISHED", value
    assert not value["error"], value
    return value


def verify_frontend(fixture):
    detail = verify_served_bundle(fixture, "DirtyFileExtractor", "extractScenes", "extractScenes.js",
                                  {"ExtractionAction": "ExtractionAction"}, required=("/picker.ts",))
    print("PASS: " + detail, flush=True)


def verify_selection_batches(fixture, scene_id, marker_id, image_id):
    spec = importlib.util.spec_from_file_location("extractor_selection_fixture", runtime_path("DirtyFileExtractor", "extract_scenes.py"))
    backend = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(backend)
    client = backend.StashClient({"Host": "127.0.0.1", "Port": fixture.port})
    missing = [str(n) for n in range(100000, 100999)]
    selections = backend.selections_from_args({"scene_ids": missing[:500] + [scene_id, scene_id] + missing[500:],
                                               "marker_ids": [marker_id], "image_ids": [image_id]})
    with mock.patch.object(client, "call", wraps=client.call) as calls:
        items, absent = backend.resolve_selected_items(client, selections)
    assert calls.call_count == 42, "Forty scene batches plus one marker and one image batch"
    assert [(item["kind"], item["id"]) for item in items] == [("scene", scene_id), ("marker", marker_id), ("image", image_id)]
    assert [item["scene_id"] for item in absent] == missing
    print("PASS: 1,000 selected scene IDs use forty real Stash requests, missing/duplicate/mixed selection order preserved", flush=True)


def exercise(fixture):
    scene_file = fixture.root / "media" / "synthetic.mp4"
    image_file = fixture.root / "media" / "synthetic.png"
    subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-t", "6", "-c:v", "libx264", "-crf", "5", str(scene_file)], check=True)
    subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "color=c=blue:size=160x90", "-frames:v", "1", str(image_file)], check=True)
    original = {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in (scene_file, image_file)}
    fixture.scan()
    scene = fixture.gql("{findScenes{scenes{id files{id path}}}}") ["findScenes"]["scenes"][0]
    image = fixture.gql("{findImages{images{id}}}") ["findImages"]["images"][0]
    fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}', {"input": {"id": scene["id"], "title": "Synthetic Extractor fixture", "details": "Preserve original metadata"}})
    tag = fixture.gql('mutation{tagCreate(input:{name:"Synthetic interval"}){id}}')["tagCreate"]["id"]
    marker = fixture.gql('mutation($input:SceneMarkerCreateInput!){sceneMarkerCreate(input:$input){id}}',
                         {"input": {"title": "Synthetic clip", "seconds": .7, "end_seconds": 2.3, "scene_id": scene["id"], "primary_tag_id": tag}})["sceneMarkerCreate"]
    performer = fixture.gql('mutation{performerCreate(input:{name:"Synthetic performer"}){id}}')["performerCreate"]["id"]
    fixture.gql('mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}', {"input": {"id": scene["id"], "performer_ids": [performer]}})
    selection = {"scene_ids": [scene["id"]], "marker_ids": [marker["id"]], "image_ids": [image["id"]]}
    verify_selection_batches(fixture, scene["id"], marker["id"], image["id"])
    dry = fixture.root / "dry-run-output"
    set_settings(fixture, destinationFolder=str(dry), dryRun=True, createSceneFolders=True, collisionPolicy="rename", maxCopySpeedMBps=0)
    finish(fixture, queue(fixture, selection)); assert not dry.exists()
    print("PASS: mixed selection planning/dry run creates no folders or output", flush=True)

    output = fixture.root / "output"
    settings = {"destinationFolder": str(output), "dryRun": False, "createSceneFolders": False, "collisionPolicy": "rename", "maxCopySpeedMBps": 0}
    set_settings(fixture, **settings); completed = finish(fixture, queue(fixture, selection))
    assert completed["progress"] == 1, completed
    assert (output / scene_file.name).read_bytes() == scene_file.read_bytes()
    assert (output / image_file.name).read_bytes() == image_file.read_bytes()
    clips = [path for path in output.glob("*.mp4") if path.name != scene_file.name]; assert len(clips) == 1, clips
    duration = float(subprocess.check_output([shutil.which("ffprobe"), "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(clips[0])]))
    assert abs(duration - 1.6) < .12, duration
    print("PASS: real scene/image byte copies, accurately bounded 1.6s marker clip, completed Tasks progress", flush=True)
    scene_selection = {"scene_ids": [scene["id"]]}
    finish(fixture, queue(fixture, scene_selection)); assert (output / "synthetic (2).mp4").read_bytes() == scene_file.read_bytes()
    settings["collisionPolicy"] = "skip"; set_settings(fixture, **settings)
    before = {path.name: path.read_bytes() for path in output.iterdir()}; finish(fixture, queue(fixture, scene_selection))
    assert before == {path.name: path.read_bytes() for path in output.iterdir()}
    settings["collisionPolicy"] = "overwrite"; set_settings(fixture, **settings)
    (output / scene_file.name).write_bytes(b"synthetic collision sentinel"); finish(fixture, queue(fixture, scene_selection))
    assert (output / scene_file.name).read_bytes() == scene_file.read_bytes()
    settings.update(destinationFolder=str(fixture.root / "title-output"), collisionPolicy="rename", createSceneFolders=True)
    set_settings(fixture, **settings); finish(fixture, queue(fixture, scene_selection))
    assert (fixture.root / "title-output" / "Synthetic Extractor fixture" / scene_file.name).read_bytes() == scene_file.read_bytes()
    print("PASS: rename/skip/overwrite collisions and title folders", flush=True)

    cancel_output = fixture.root / "cancel-output"
    settings.update(destinationFolder=str(cancel_output), createSceneFolders=False, maxCopySpeedMBps=.001)
    set_settings(fixture, **settings)
    job_id = queue(fixture, {"scene_ids": [scene["id"]], "image_ids": [image["id"]]})
    active = wait_for(lambda: (value if value and value["status"] == "RUNNING" and value["progress"] and value["progress"] > 0 else None)
                      if (value := job(fixture, job_id)) else None)
    assert 0 < active["progress"] < 1, active
    fixture.gql('mutation($id:ID!){stopJob(job_id:$id)}', {"id": job_id})
    stopped = wait_for(lambda: (value if value and value["status"] not in ("RUNNING", "STOPPING", "READY") else None)
                       if (value := job(fixture, job_id)) else None)
    assert stopped["status"] == "CANCELLED", stopped
    assert not (cancel_output / image_file.name).exists(), "Cancellation must not process later selected items"
    assert not (cancel_output / scene_file.name).exists() or (cancel_output / scene_file.name).stat().st_size == 0
    remnants = sorted(path.name for path in cancel_output.iterdir())
    print("PASS: live byte progress and Stash task cancellation prevents finalized/later copies; cancellation remnants=" + json.dumps(remnants), flush=True)
    assert original == {path: hashlib.sha256(path.read_bytes()).hexdigest() for path in original}
    current = fixture.gql('query($id:ID!){findScene(id:$id){id details files{id path}}}', {"id": scene["id"]})["findScene"]
    assert current["files"] == scene["files"] and current["details"] == "Preserve original metadata"
    print("PASS: original media hashes, scene/file identity and metadata unchanged", flush=True)
    # Safe browser actions can queue only dry-run jobs into this named fixture.
    settings.update(destinationFolder=str(fixture.root / "browser-output"), dryRun=True, maxCopySpeedMBps=0)
    set_settings(fixture, **settings)
    return {"scene": scene["id"], "image": image["id"], "marker": marker["id"], "performer": performer}


def main():
    parser = argparse.ArgumentParser(description=__doc__); parser.add_argument("--binary", required=True)
    parser.add_argument("--serve", action="store_true"); parser.add_argument("--stop-file", type=Path)
    add_build_mode_argument(parser)
    args = parser.parse_args(); select_build_mode(args); fixture = Fixture(args.binary)
    try:
        shutil.copytree(runtime_path("DirtyFileExtractor"), fixture.root / "plugins" / "extractScenes")
        fixture.gql("mutation{reloadPlugins}"); fixture.gql("mutation{setPluginsEnabled(enabledMap:{dirtyPlugins:true,extractScenes:true})}")
        print("FIXTURE " + fixture.url + " " + str(fixture.root), flush=True)
        verify_frontend(fixture); ids = exercise(fixture)
        print("FIXTURE_IDS " + json.dumps(ids), flush=True)
        if args.serve:
            print("UI " + fixture.url + "/plugins/dirty-plugins?plugin=extractScenes&docsCapture=1", flush=True)
            while not args.stop_file or not args.stop_file.exists(): time.sleep(1)
    except Exception:
        fixture.log.flush(); print((fixture.root / "stash.log").read_text(errors="replace")[-3000:], flush=True); raise
    finally:
        fixture.close()


if __name__ == "__main__": main()
