"""Opt-in integration against an isolated Stash; never contacts port 9999.

python -B tests/test_dirty_compactor_stash_integration.py --binary /path/to/stash
Add --serve to leave the synthetic fixture open for browser review until Ctrl+C.
Add --development after `npm run build:dev` to decode the served inline TSX maps.
"""
from plugin_paths import build_mode, runtime_path, use_build_mode
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
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
    def __init__(self, binary, prefix="dirty-compactor-stash-", prepare=None):
        self.prefix = prefix
        self.directory = tempfile.TemporaryDirectory(prefix=prefix, ignore_cleanup_errors=True)
        self.root = Path(self.directory.name)
        self.process = None
        self.log = None
        try:
            self._start(binary, prepare)
        except BaseException:
            self.close()
            raise

    def _start(self, binary, prepare):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            self.port = listener.getsockname()[1]
        self.url = "http://127.0.0.1:" + str(self.port)
        assert self.port != 9999
        for name in ("media", "generated", "metadata", "cache", "blobs", "plugins", "scrapers"):
            (self.root / name).mkdir()
        for name, installed in (("DirtyPlugins", "dirtyPlugins"), ("DirtyCompactor", "dirtyCompactor")):
            shutil.copytree(runtime_path(name), self.root / "plugins" / installed,
                            ignore=shutil.ignore_patterns("runtime", "__pycache__", "*.sqlite*", "*.pyc"))
        config = {"database": str(self.root / "stash.sqlite"), "generated": str(self.root / "generated"),
                  "metadata": str(self.root / "metadata"), "cache": str(self.root / "cache"),
                  "blobs_path": str(self.root / "blobs"), "plugins_path": str(self.root / "plugins"),
                  "scrapers_path": str(self.root / "scrapers"), "ffmpeg_path": shutil.which("ffmpeg"),
                  "ffprobe_path": shutil.which("ffprobe"), "python_path": sys.executable}
        lines = [key + ": " + json.dumps(value) for key, value in config.items()]
        lines += ["stash:", "  - path: " + json.dumps(str(self.root / "media")), "    excludeimage: false", "    excludevideo: false"]
        (self.root / "config.yml").write_text("\n".join(lines), encoding="utf-8")
        if prepare:
            prepare(self.root)
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
        assert self.root.name.startswith(self.prefix)
        self.directory.cleanup()


def add_build_mode_argument(parser):
    parser.add_argument("--development", action="store_true",
                        help="Check a development build (npm run build:dev) and decode its inline TSX maps")


def select_build_mode(args):
    use_build_mode("development" if args.development else "release")


def verify_served_bundle(fixture, directory, plugin_id, entry, components, required=()):
    """Check Stash's real aggregated endpoint, not individual assets.

    Release staging must be served byte-for-byte without a map, built only from
    the plugin's own inputs. A development build also decodes the inline map at
    the named components' compiled entry lines back to their embedded TSX.
    """
    staged = runtime_path(directory, entry).read_bytes()
    with urllib.request.urlopen(fixture.url + "/plugin/" + plugin_id + "/javascript") as response:
        served = response.read()
    assert served == staged + b"\n", "Stash must serve the exact sole compiled bundle plus its final newline"
    owner = "plugins/" + directory + "/"
    registry = json.loads((REPO / "scripts" / "plugin-registry.json").read_text(encoding="utf-8"))
    # Declared, pinned npm packages (Stats' modular ECharts) are the only other allowed inputs.
    packages = ["node_modules/" + name + "/" for item in registry if item["directory"] == directory
                for name in item.get("bundledPackages", [])]
    # Generated settings metadata the plugin declares is data, not another plugin's implementation.
    generated = [".build/generated/" + name + ".settings.ts" for item in registry if item["directory"] == directory
                 for name in item.get("generatedImports", [])]
    if build_mode() == "release":
        assert b"sourceMappingURL" not in served, "release bundles carry no source map"
        state = json.loads((REPO / ".build" / "build-state.json").read_text(encoding="utf-8"))
        inputs = list(state["plugins"][directory]["metafile"]["inputs"])
        assert inputs and all(name.startswith(owner) or name in generated or any(name.startswith(package) for package in packages)
                              for name in inputs), "only plugin-owned inputs; no React or hub copies"
        assert all(any(name.endswith(suffix) for name in inputs) for suffix in required)
        return "exact sole served release bundle without a map, " + directory + "-only inputs"
    assert served.count(b"sourceMappingURL=data:") == 1, "one bundle, one inline development map"
    encoded = re.search(rb"sourceMappingURL=data:application/json;base64,([^\s]+)", served).group(1)
    source_map = json.loads(base64.b64decode(encoded))
    assert source_map["version"] == 3 and source_map["mappings"]
    assert len(source_map["sources"]) == len(source_map["sourcesContent"])
    # Map sources are relative to the staged output (for example ../../../generated/<id>.settings.ts).
    assert all(owner in name or any(name.endswith(path[len(".build"):]) for path in generated) or any(package in name for package in packages)
               for name in source_map["sources"]), "only plugin-owned sources; no React or hub copies"
    assert all(isinstance(text, str) and text for text in source_map["sourcesContent"])
    assert all(any(name.endswith(suffix) for name in source_map["sources"]) for suffix in required)
    verify_component_mappings(served, source_map, components)
    return ("exact sole served development bundle, one inline map, " + directory + "-only sources, decoded "
            + "/".join(sorted(components)) + " TSX")


def verify_frontend(fixture):
    detail = verify_served_bundle(fixture, "DirtyCompactor", "dirtyCompactor", "dirtyCompactor.js",
                                  {"Settings": "Settings", "OutputReview": "OutputReview"})
    print("PASS: " + detail, flush=True)


def verify_component_mappings(served, source_map, components):

    # Decode standard base64 VLQ mappings at two compiled component entry lines.
    # This checks the real served offsets and embedded TSX, without fetching
    # authored source URLs (Stash intentionally serves only aggregated assets).
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    def vlq(segment):
        values, value, shift = [], 0, 0
        for char in segment:
            digit = alphabet.index(char)
            value |= (digit & 31) << shift
            if digit & 32:
                shift += 5
            else:
                values.append(-(value >> 1) if value & 1 else value >> 1)
                value, shift = 0, 0
        assert shift == 0
        return values

    lines = served.decode().splitlines()
    wanted = {next(i for i, line in enumerate(lines) if "function " + name + "(" in line): name
                for name in components}
    source, original_line, original_column = 0, 0, 0
    mapped = set()
    for line_number, line in enumerate(source_map["mappings"].split(";")):
        for segment in filter(None, line.split(",")):
            fields = vlq(segment)
            if len(fields) < 4:
                continue
            source += fields[1]
            original_line += fields[2]
            original_column += fields[3]
            if line_number in wanted:
                name = wanted[line_number]
                target = components[name]
                suffix = "/" + target + ".tsx" if "/" in target else "/components/" + target + ".tsx"
                assert source_map["sources"][source].endswith(suffix)
                authored = source_map["sourcesContent"][source].splitlines()[original_line]
                assert "function " + name + "(" in authored
                mapped.add(name)
                # Later tokens on this generated line may map to the body.
                del wanted[line_number]
    assert mapped == set(components)


def exercise(fixture):
    fixture.gql("mutation{reloadPlugins}")
    fixture.gql("mutation{setPluginsEnabled(enabledMap:{dirtyPlugins:true,dirtyCompactor:true})}")
    verify_frontend(fixture)
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
    add_build_mode_argument(parser)
    args = parser.parse_args()
    select_build_mode(args)
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
