"""Opt-in integration against an isolated Stash; never contacts port 9999.

python -B tests/test_dirty_compactor_stash_integration.py --binary /path/to/stash
Add --serve to leave the synthetic fixture open for browser review until Ctrl+C.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

REPO = Path(__file__).resolve().parents[1]


def wait_for(function, timeout=90):
    deadline = time.monotonic() + timeout
    last = None
    while time.monotonic() < deadline:
        try:
            result = function()
            if result:
                return result
        except Exception as error:
            last = error
        time.sleep(.25)
    raise RuntimeError("Timed out: " + str(last))


class Fixture:
    def __init__(self, binary):
        self.directory = tempfile.TemporaryDirectory(prefix="dirty-compactor-stash-", ignore_cleanup_errors=True)
        self.root = Path(self.directory.name)
        self.process = None
        self.log = None
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]
        self.url = "http://127.0.0.1:" + str(self.port)
        assert self.port != 9999
        for name in ("media", "generated", "metadata", "cache", "blobs", "plugins", "scrapers"):
            (self.root / name).mkdir()
        for name, installed in (("DirtyPlugins", "dirtyPlugins"), ("DirtyCompactor", "dirtyCompactor")):
            shutil.copytree(REPO / "plugins" / name, self.root / "plugins" / installed,
                            ignore=shutil.ignore_patterns("runtime", "__pycache__", "*.sqlite*", "*.pyc"))
        config = {"database": str(self.root / "stash.sqlite"), "generated": str(self.root / "generated"),
                  "metadata": str(self.root / "metadata"), "cache": str(self.root / "cache"),
                  "blobs_path": str(self.root / "blobs"), "plugins_path": str(self.root / "plugins"),
                  "scrapers_path": str(self.root / "scrapers"), "ffmpeg_path": shutil.which("ffmpeg"),
                  "ffprobe_path": shutil.which("ffprobe"), "python_path": sys.executable}
        lines = [key + ": " + json.dumps(value) for key, value in config.items()]
        lines += ["stash:", "  - path: " + json.dumps(str(self.root / "media")), "    excludeimage: false", "    excludevideo: false"]
        (self.root / "config.yml").write_text("\n".join(lines), encoding="utf-8")
        self.log = (self.root / "stash.log").open("wb")
        self.process = subprocess.Popen([str(binary), "--config", str(self.root / "config.yml"), "--host", "127.0.0.1", "--port", str(self.port), "--nobrowser"],
                                        cwd=self.root, stdout=self.log, stderr=self.log,
                                        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        wait_for(lambda: self.gql("{version{version}}"))

    def gql(self, query, variables=None):
        request = urllib.request.Request(self.url + "/graphql", json.dumps({"query": query, "variables": variables or {}}).encode(), {"Content-Type": "application/json"})
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.load(response)
        if result.get("errors"):
            raise RuntimeError(str(result["errors"]))
        return result["data"]

    def op(self, mode, **args):
        args["mode"] = mode
        value = self.gql("mutation($args:Map!){runPluginOperation(plugin_id:\"dirtyCompactor\",args:$args)}", {"args": args})["runPluginOperation"]
        for _ in range(4):
            if isinstance(value, str):
                value = json.loads(value)
            elif isinstance(value, dict) and "error" in value:
                raise RuntimeError(value["error"])
            elif isinstance(value, dict) and "output" in value:
                value = value["output"]
            else:
                break
        return value

    def settings(self, rules, paused=True):
        args = {"mode": "setSettings", "pluginId": "dirtyCompactor", "settings": {"rules": rules, "automationPaused": paused}}
        return self.gql("mutation($args:Map!){runPluginOperation(plugin_id:\"dirtyPlugins\",args:$args)}", {"args": args})

    def scan(self):
        self.gql("mutation($input:ScanMetadataInput!){metadataScan(input:$input)}", {"input": {"paths": [str(self.root / "media")], "scanGenerateCovers": False}})
        wait_for(lambda: not self.gql("{jobQueue{id}}") ["jobQueue"])

    def wait_record(self, mode, record_id, statuses):
        def poll():
            value = self.op(mode, id=record_id)
            if value["status"] in ("failed", "recovery"):
                raise AssertionError(json.dumps(value))
            return value if value["status"] in statuses else None
        return wait_for(poll)

    def close(self):
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()
        if self.log:
            self.log.close()
        # Only this freshly-created, named fixture tree is ever cleaned up.
        assert self.root.name.startswith("dirty-compactor-stash-")
        self.directory.cleanup()


def exercise(fixture):
    fixture.gql("mutation{reloadPlugins}")
    fixture.gql("mutation{setPluginsEnabled(enabledMap:{dirtyPlugins:true,dirtyCompactor:true})}")
    source = fixture.root / "media" / "synthetic.mp4"
    subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-t", "3", "-c:v", "libx264", "-crf", "5", str(source)], check=True)
    original = source.read_bytes()
    fixture.scan()
    scene = fixture.gql("{findScenes{scenes{id files{id}}}}") ["findScenes"]["scenes"][0]
    fixture.gql("mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}", {"input": {"id": scene["id"], "title": "Synthetic review fixture", "rating100": 80, "details": "Preserve this metadata"}})
    rule = {"id": "reduce", "name": "Synthetic resize", "enabled": True, "mode": "manual", "condition": {"all": True, "scene": {}, "find": {}, "query": ""},
            "action": "resize", "width": 320, "height": 180, "mbps": .2, "codec": "h264", "encoder": "cpu", "format": "keep"}
    fixture.settings([rule])
    preview = fixture.op("preview")
    preview = fixture.wait_record("getPreview", preview["id"], {"ready"})
    assert preview["counts"].get("ready") == 1, preview
    run = fixture.op("startRun", id=preview["id"], reviewOutputs=True)
    run = fixture.wait_record("getRun", run["id"], {"awaitingReview"})
    assert source.read_bytes() == original
    review = run["review"]
    request = urllib.request.Request(fixture.url + review["url"], headers={"Range": "bytes=0-127"})
    with urllib.request.urlopen(request) as response:
        assert response.status == 206, response.status
        assert len(response.read()) == 128
    with urllib.request.urlopen(fixture.url + review["url"]) as response:
        reviewed = response.read()
    fixture.op("acceptOutput", id=run["id"], operationId=review["operationId"])
    final = fixture.wait_record("getRun", run["id"], {"completed"})
    assert hashlib.sha256(source.read_bytes()).digest() == hashlib.sha256(reviewed).digest()
    scenes = fixture.gql("{findScenes{scenes{id title rating100 details files{id width height}}}}") ["findScenes"]["scenes"]
    assert len(scenes) == 1 and scenes[0]["id"] == scene["id"], scenes
    assert scenes[0]["rating100"] == 80 and scenes[0]["details"] == "Preserve this metadata"
    assert scenes[0]["files"][0]["id"] == scene["files"][0]["id"]
    assert scenes[0]["files"][0]["width"] == 320
    assert final["actualSavings"] == len(original) - len(reviewed)
    print("PASS: complete review, HTTP seeking, exact-byte acceptance, scene/file identity, metadata preservation, actual savings", flush=True)
    # Changing AVI to MP4 exercises Stash moveFiles before replacement.
    avi = fixture.root / "media" / "format-change.avi"
    subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
                    "-t", "2", "-c:v", "mpeg4", "-q:v", "1", str(avi)], check=True)
    fixture.scan()
    all_scenes = fixture.gql("{findScenes{scenes{id files{id path}}}}") ["findScenes"]["scenes"]
    original_scene = next(s for s in all_scenes if s["files"][0]["path"] == str(avi))
    rule.update(format="allow")
    fixture.settings([rule])
    preview = fixture.op("preview")
    preview = fixture.wait_record("getPreview", preview["id"], {"ready"})
    assert preview["counts"].get("ready") == 1, preview
    run = fixture.op("startRun", id=preview["id"], reviewOutputs=False)
    final = fixture.wait_record("getRun", run["id"], {"completed"})
    assert final["counts"].get("completed") == 1, final
    assert not avi.exists() and avi.with_suffix(".mp4").exists()
    same = fixture.gql("query($id:ID!){findScene(id:$id){id files{id path}}}", {"id": original_scene["id"]}) ["findScene"]
    assert same["files"][0]["id"] == original_scene["files"][0]["id"]
    assert same["files"][0]["path"] == str(avi.with_suffix(".mp4"))
    print("PASS: container change retains Stash scene and file IDs", flush=True)
    # Delete only a named synthetic fixture, through the automatic queue path.
    doomed = fixture.root / "media" / "delete-fixture.mp4"
    subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "color=blue:size=160x90:rate=25",
                    "-t", "1", "-c:v", "libx264", str(doomed)], check=True)
    fixture.scan()
    delete_rule = dict(rule, id="delete-synthetic", mode="automatic", action="delete",
                       condition={"all": False, "find": {"q": "delete-fixture"}, "scene": {}})
    fixture.settings([delete_rule], paused=False)
    event = {"jobId": "integration-scan", "startTime": datetime.now(timezone.utc).isoformat()}
    fixture.op("startAutomaticRun", **event)
    assert fixture.op("startAutomaticRun", **event).get("duplicate")
    automatic = wait_for(lambda: next((r for r in fixture.op("listRuns") if r["automatic"]), None))
    deleted = fixture.wait_record("getRun", automatic["id"], {"completed"})
    assert deleted["counts"].get("completed") == 1, deleted
    assert deleted["libraryBytesRemoved"] > 0 and deleted["actualSavings"] == 0
    assert not doomed.exists() and source.exists() and avi.with_suffix(".mp4").exists()
    assert fixture.gql("{findScenes{count}}") ["findScenes"]["count"] == 2
    print("PASS: automatic Delete, native filter, event deduplication, library byte accounting", flush=True)
    # Leave one meaningful pending review for visual checks.
    rule.update(width=160, height=90, mbps=.08)
    fixture.settings([rule])
    preview = fixture.op("preview")
    preview = fixture.wait_record("getPreview", preview["id"], {"ready"})
    run = fixture.op("startRun", id=preview["id"], reviewOutputs=True)
    fixture.wait_record("getRun", run["id"], {"awaitingReview"})
    return rule


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True)
    parser.add_argument("--serve", action="store_true")
    args = parser.parse_args()
    fixture = Fixture(args.binary)
    try:
        print("FIXTURE " + fixture.url + " " + str(fixture.root), flush=True)
        exercise(fixture)
        if args.serve:
            print("UI " + fixture.url + "/plugins/dirty-plugins?plugin=dirtyCompactor", flush=True)
            while True:
                time.sleep(1)
    except Exception as error:
        fixture.log.flush()
        print((fixture.root / "stash.log").read_text(errors="replace")[-2500:], flush=True)
        print("INTEGRATION FAILURE: " + repr(error), flush=True)
        raise
    finally:
        fixture.close()


if __name__ == "__main__":
    main()
