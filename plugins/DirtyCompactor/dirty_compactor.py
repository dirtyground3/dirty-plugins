"""DirtyCompactor: journaled, sequential media compaction through Stash."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import queue
import shutil
import subprocess
import sys
import threading
import time
import uuid

for folder in ("dirtyPlugins", "DirtyPlugins"):
    shared = Path(__file__).resolve().parent.parent / folder
    if (shared / "dirty_plugins_storage.py").is_file():
        sys.path.insert(0, str(shared))
        break
import dirty_plugins_storage as storage
from dirty_plugins_client import StashClient as BaseClient, contain_child_process

PLUGIN_ID = "dirtyCompactor"
ROOT = Path(__file__).resolve().parent
PREVIEWS = ROOT / "runtime" / "previews"
PRIVATE = ROOT / "runtime" / "private"
TERMINAL = {"completed", "cancelled", "failed"}
FIELDS = "id title files{id path size width height duration video_codec bit_rate}"
ENCODERS = {"h264": {"cpu": "libx264", "nvenc": "h264_nvenc", "qsv": "h264_qsv", "amf": "h264_amf"},
            "hevc": {"cpu": "libx265", "nvenc": "hevc_nvenc", "qsv": "hevc_qsv", "amf": "hevc_amf"}}


class PluginError(RuntimeError):
    pass


class Cancelled(PluginError):
    pass


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def file_hash(path):
    result = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(4 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def identity(path):
    path = Path(path)
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
        raise PluginError("Symbolic links are not supported")
    info = path.stat()
    if not path.is_file() or info.st_nlink != 1:
        raise PluginError("Only unshared regular files are supported")
    return {"size": info.st_size, "mtime": info.st_mtime_ns, "device": info.st_dev, "inode": info.st_ino}


def validate_settings(value):
    if not isinstance(value, dict) or not isinstance(value.get("rules", []), list):
        raise PluginError("Rules must be a list")
    if value.get("schemaVersion", 1) != 1:
        raise PluginError("Unsupported rule schema version")
    ids = set()
    rules = []
    for rule in value.get("rules", []):
        if not isinstance(rule, dict) or not rule.get("id") or rule["id"] in ids:
            raise PluginError("Each rule needs a unique ID")
        ids.add(rule["id"])
        if rule.get("mode") not in ("manual", "automatic") or rule.get("action") not in ("resize", "reencode", "delete"):
            raise PluginError("Invalid rule mode or action")
        condition = rule.get("condition") or {}
        if not isinstance(condition.get("scene", {}), dict) or not isinstance(condition.get("find", {}), dict):
            raise PluginError("Invalid native scene filter")
        if rule.get("enabled"):
            if not str(rule.get("name", "")).strip():
                raise PluginError("Enabled rules need a name")
            if not condition.get("all") and not condition.get("scene") and not condition.get("find", {}).get("q"):
                raise PluginError("Choose a scene filter or explicitly select All scenes")
        if rule["action"] != "delete":
            if rule.get("codec") not in ENCODERS or rule.get("encoder") not in ("auto", "cpu", "nvenc", "qsv", "amf"):
                raise PluginError("Invalid codec or encoder")
            if rule.get("format") not in ("keep", "allow"):
                raise PluginError("Invalid format policy")
            try:
                rate = float(rule.get("mbps", 0))
                sizes = [float(rule.get(key, 0)) for key in ("width", "height")] if rule["action"] == "resize" else [2, 2]
            except (ValueError, TypeError):
                raise PluginError("Enter valid bitrate and dimensions")
            if not math.isfinite(rate) or not 0.05 <= rate <= 1000 or any(not math.isfinite(v) or not 2 <= v <= 16384 or v != int(v) for v in sizes):
                raise PluginError("Bitrate must be 0.05–1000 Mbps; dimensions must be 2–16384")
        rules.append(rule)
    return {"schemaVersion": 1, "rules": rules, "automationPaused": bool(value.get("automationPaused", True))}


def settings():
    return validate_settings(storage.get_plugin_settings(PLUGIN_ID))


def dimensions(width, height, rule):
    if rule["action"] != "resize":
        return width, height
    bw, bh = int(rule["width"]), int(rule["height"])
    if height > width and bw > bh:
        bw, bh = bh, bw
    factor = min(1, bw / width, bh / height)
    if factor == 1:
        return width, height
    return max(2, int(width * factor) // 2 * 2), max(2, int(height * factor) // 2 * 2)


class Client(BaseClient):
    def scenes(self, condition=None, ids=None):
        condition = condition or {}
        page = 1
        while True:
            find = dict(condition.get("find") or {})
            find.update(page=page, per_page=100, sort="id", direction="ASC")
            data = self.call("query($filter:FindFilterType,$scene:SceneFilterType,$ids:[Int!]){findScenes(filter:$filter,scene_filter:$scene,scene_ids:$ids){scenes{" + FIELDS + "}}}",
                             {"filter": find, "scene": condition.get("scene") or {}, "ids": [int(x) for x in ids] if ids is not None else None})["findScenes"]["scenes"]
            yield from data
            if len(data) < 100:
                break
            page += 1

    def scene(self, scene_id):
        return self.call("query($id:ID!){findScene(id:$id){" + FIELDS + "}}", {"id": str(scene_id)})["findScene"]

    def tool(self, name):
        general = self.call("{configuration{general{ffmpegPath ffprobePath}}}")["configuration"]["general"]
        path = general.get(name + "Path") or shutil.which(name)
        if not path:
            raise PluginError(name + " is unavailable. Configure its path in Stash.")
        return path

    def scan(self, path):
        job = self.call("mutation($input:ScanMetadataInput!){metadataScan(input:$input)}", {"input": {
            "paths": [str(path)], "rescan": True, "scanGenerateCovers": False,
            "scanGeneratePreviews": False, "scanGenerateImagePreviews": False,
            "scanGenerateSprites": False, "scanGeneratePhashes": False}})["metadataScan"]
        storage.internal_scan_register(job)
        return job

    def move(self, file_id, destination):
        result = self.call("mutation($input:MoveFilesInput!){moveFiles(input:$input)}", {"input": {
            "ids": [str(file_id)], "destination_folder": str(Path(destination).parent), "destination_basename": Path(destination).name}})
        if not result.get("moveFiles"):
            raise PluginError("Stash did not confirm the rename")

    def delete(self, scene_id):
        if not self.call("mutation($input:SceneDestroyInput!){sceneDestroy(input:$input)}", {"input": {
            "id": str(scene_id), "delete_file": True, "delete_generated": True, "destroy_file_entry": True}}).get("sceneDestroy"):
            raise PluginError("Stash did not confirm deletion")


def probe(executable, path):
    result = subprocess.run([executable, "-v", "error", "-show_streams", "-show_format", "-show_chapters", "-of", "json", str(path)],
                            capture_output=True, timeout=120, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise PluginError("Could not probe media: " + result.stderr.decode(errors="replace")[-1000:])
    data = json.loads(result.stdout)
    streams = data.get("streams", [])
    video = [s for s in streams if s["codec_type"] == "video" and not s.get("disposition", {}).get("attached_pic")]
    if len(video) != 1:
        raise PluginError("Exactly one video stream is required")
    v = video[0]
    duration = float(data.get("format", {}).get("duration") or v.get("duration") or 0)
    if duration <= 0:
        raise PluginError("Unknown media duration")
    if v.get("color_transfer") in ("smpte2084", "arib-std-b67"):
        raise PluginError("HDR tone mapping is not supported")
    if int(v.get("width", 0)) % 2 or int(v.get("height", 0)) % 2:
        raise PluginError("Odd video dimensions are not supported without changing resolution")
    # Unknown bitrates must not masquerade as a reliable reduction estimate.
    rate = float(v.get("bit_rate") or v.get("tags", {}).get("BPS") or v.get("tags", {}).get("BPS-eng") or 0)
    if not rate:
        # Matroska often omits stream bitrate. Sum compressed packet bytes,
        # not container bitrate (which includes audio and attachments).
        packet_process = subprocess.Popen([executable, "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=size", "-of", "csv=p=0", str(path)],
                                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            total = 0
            for line in packet_process.stdout:
                value = line.strip().split(b",", 1)[0]
                if value.isdigit():
                    total += int(value)
            if packet_process.wait() == 0:
                rate = total * 8 / duration
        finally:
            packet_process.stdout.close()
            if packet_process.poll() is None:
                packet_process.kill()
                packet_process.wait()
    return {"width": int(v["width"]), "height": int(v["height"]), "duration": duration,
            "bitrate": rate, "codec": v.get("codec_name"), "streams": streams,
            "chapters": data.get("chapters", []), "format": data.get("format", {})}


def container_for(path, rule, media):
    suffix = Path(path).suffix.lower()
    # Stream-copy compatibility is deliberately conservative.
    types = {s.get("codec_type") for s in media["streams"]}
    if not types.issubset({"video", "audio", "subtitle", "attachment"}):
        raise PluginError("Unsupported data streams; no streams will be silently discarded")
    audio = {s.get("codec_name") for s in media["streams"] if s.get("codec_type") == "audio"}
    subtitles = {s.get("codec_name") for s in media["streams"] if s.get("codec_type") == "subtitle"}
    mp4 = audio.issubset({"aac", "mp3", "ac3", "eac3", "alac"}) and subtitles.issubset({"mov_text"}) and "attachment" not in types
    if suffix in (".mkv", ".mk3d"):
        return suffix, "matroska"
    if suffix in (".mp4", ".m4v", ".mov") and mp4:
        return suffix, "mov" if suffix == ".mov" else "mp4"
    if rule["format"] == "keep":
        raise PluginError("Container/stream combination cannot retain the selected codec; allow format change")
    return (".mp4", "mp4") if mp4 else (".mkv", "matroska")


def save(kind, record):
    updated = storage.compactor_put(kind, record["id"], record, expected=record.get("_revision"))
    record.update(updated)
    return record


def get(kind, record_id):
    value = storage.compactor_get(kind, str(record_id))
    if value is None:
        raise PluginError("Record not found")
    return value


def report(run_id, stage, progress=0):
    storage.compactor_put("progress", run_id, {"id": run_id, "stage": stage, "progress": progress, "heartbeat": time.time(), "pid": os.getpid()})
    print("\x01p\x02" + str(max(0, min(1, progress))), file=sys.stderr, flush=True)


def check_cancel(run_id):
    if storage.compactor_get("cancel", run_id):
        raise Cancelled("Cancelled; original retained")


def run_process(command, run_id, stage, duration=1):
    PRIVATE.mkdir(parents=True, exist_ok=True)
    log_path = PRIVATE / (uuid.uuid4().hex + ".log")
    events = queue.Queue()
    try:
        with log_path.open("wb") as errors:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors, stdin=subprocess.DEVNULL,
                                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            close_job = contain_child_process(process)
            def read():
                for line in process.stdout:
                    events.put(line.decode(errors="replace").strip())
            reader = threading.Thread(target=read, daemon=True)
            reader.start()
            last = 0
            progress = 0
            try:
                while process.poll() is None:
                    if time.monotonic() - last > 1:
                        check_cancel(run_id)
                        report(run_id, stage, progress)
                        last = time.monotonic()
                    try:
                        line = events.get(timeout=0.2)
                        if line.startswith("out_time_us="):
                            progress = min(1, float(line.split("=", 1)[1]) / 1e6 / max(duration, 1))
                    except (queue.Empty, ValueError):
                        pass
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()
                reader.join(timeout=2)
                process.stdout.close()
                close_job()
        if process.returncode:
            raise PluginError(log_path.read_text(errors="replace")[-2000:] or "FFmpeg failed")
    finally:
        log_path.unlink(missing_ok=True)


def encoder_usable(ffmpeg, codec, kind):
    command = [ffmpeg, "-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=size=128x128:rate=25",
               "-t", "0.2", "-c:v", ENCODERS[codec][kind], "-b:v", "500000", "-f", "null", "-"]
    try:
        result = subprocess.run(command, capture_output=True, timeout=20, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def capabilities(client):
    ffmpeg, ffprobe = client.tool("ffmpeg"), client.tool("ffprobe")
    result = {"ffmpeg": ffmpeg, "ffprobe": ffprobe, "encoders": {}}
    for codec in ENCODERS:
        result["encoders"][codec] = [kind for kind in ENCODERS[codec] if encoder_usable(ffmpeg, codec, kind)]
    return result


def build_preview(client, preview):
    snapshot = preview["settings"]
    library = list(client.scenes())
    owners = {}
    for scene in library:
        for file in scene["files"]:
            owners.setdefault(str(file["id"]), set()).add(str(scene["id"]))
    won = set()
    operations = []
    ffprobe = None
    for rule in snapshot["rules"]:
        if not rule.get("enabled"):
            continue
        for scene in client.scenes(rule["condition"]):
            check_cancel(preview["id"])
            sid = str(scene["id"])
            if sid in won:
                continue
            won.add(sid)
            files = scene.get("files") or []
            base = {"sceneId": sid, "title": scene.get("title") or "Scene " + sid, "rule": rule,
                    "sceneFiles": sorted(str(f["id"]) for f in files)}
            for file in ((files[:1] or [{"id": "", "path": ""}]) if rule["action"] == "delete" else files):
                op = dict(base, id=uuid.uuid4().hex, fileId=str(file["id"]), source=file["path"], status="ready", savings=0)
                try:
                    if preview.get("automatic") and rule["mode"] == "manual":
                        op.update(status="manual", reason="First matching rule is Manual")
                    elif any(len(owners.get(str(f["id"]), set())) > 1 for f in files):
                        raise PluginError("Scene has files shared with another scene")
                    else:
                        if files:
                            op["identity"] = identity(op["source"])
                            op["sourceHash"] = file_hash(op["source"])
                        if rule["action"] == "delete":
                            op["deleteFiles"] = [{"id": str(f["id"]), "path": f["path"], "identity": identity(f["path"]), "hash": file_hash(f["path"])} for f in files]
                            op["savings"] = sum(f["identity"]["size"] for f in op["deleteFiles"])
                        else:
                            ffprobe = ffprobe or client.tool("ffprobe")
                            media = probe(ffprobe, op["source"])
                            op["media"] = media
                            op["dimensions"] = list(dimensions(media["width"], media["height"], rule))
                            suffix, muxer = container_for(op["source"], rule, media)
                            op.update(destination=str(Path(op["source"]).with_suffix(suffix)), muxer=muxer)
                            if op["destination"] != op["source"] and Path(op["destination"]).exists():
                                raise PluginError("Destination already exists")
                            completed = storage.compactor_get("completed", digest([op["fileId"], rule["id"]]))
                            action_key = digest({k: v for k, v in rule.items() if k not in ("name", "mode", "enabled", "condition")})
                            op["actionKey"] = action_key
                            if completed and completed.get("hash") == op["sourceHash"] and completed.get("actionKey") == action_key:
                                op.update(status="unchanged", reason="This output was already processed with these settings")
                            elif rule["action"] == "resize" and op["dimensions"] == [media["width"], media["height"]]:
                                op.update(status="unchanged", reason="Already within the requested resolution")
                            elif rule["action"] == "reencode" and media["bitrate"] and media["bitrate"] <= float(rule["mbps"]) * 1e6:
                                op.update(status="unchanged", reason="Already at or below target bitrate")
                            elif rule["action"] == "reencode" and not media["bitrate"]:
                                raise PluginError("Video bitrate is unknown; cannot prove a bitrate reduction")
                            estimated = float(rule["mbps"]) * 1e6 * media["duration"] / 8
                            other = sum(float(s.get("bit_rate") or 0) for s in media["streams"] if s["codec_type"] != "video") * media["duration"] / 8
                            op["savings"] = max(0, op["identity"]["size"] - int((estimated + other) * 1.02))
                except (OSError, ValueError, PluginError) as error:
                    op.update(status="blocked", reason=str(error))
                operations.append(op)
                report(preview["id"], "Planning", len(won) / max(1, len(library)))
    preview.update(status="ready", operations=operations)
    save("preview", preview)
    return preview


def revalidate(client, run, op):
    if digest(settings()["rules"]) != run["rulesDigest"]:
        raise PluginError("Rules changed. Discard this output and generate a new preview.")
    scene = client.scene(op["sceneId"])
    if not scene or sorted(str(f["id"]) for f in scene["files"]) != op["sceneFiles"]:
        raise PluginError("Scene files changed since preview")
    current = next((f for f in scene["files"] if str(f["id"]) == op["fileId"]), None)
    if op["sceneFiles"] and (not current or current["path"] != op["source"] or identity(op["source"]) != op["identity"] or file_hash(op["source"]) != op["sourceHash"]):
        raise PluginError("Original changed since preview; it has been retained")
    for rule in run["settings"]["rules"]:
        if rule.get("enabled") and next(iter(client.scenes(rule["condition"], [op["sceneId"]])), None):
            if rule["id"] != op["rule"]["id"]:
                raise PluginError("Winning rule changed since preview")
            break
    else:
        raise PluginError("Scene no longer matches its rule")
    # Refresh ownership immediately before a destructive operation.
    for other in client.scenes({"scene": {"file_count": {"value": 0, "modifier": "GREATER_THAN"}}}):
        if str(other["id"]) != op["sceneId"] and any(str(f["id"]) in op["sceneFiles"] for f in other["files"]):
            raise PluginError("A file is now shared with another scene")


def command_for(ffmpeg, op, output, encoder):
    rule, media = op["rule"], op["media"]
    command = [ffmpeg, "-hide_banner", "-v", "error", "-nostdin", "-n", "-noautorotate", "-i", op["source"],
               "-map", "0", "-map_metadata", "0", "-map_chapters", "0", "-c", "copy", "-c:v:0", encoder,
               "-b:v:0", str(int(float(rule["mbps"]) * 1e6))]
    if op["dimensions"] != [media["width"], media["height"]]:
        command += ["-filter:v:0", "scale={}:{}".format(*op["dimensions"])]
    if encoder.startswith("lib"):
        command += ["-preset", "medium"]
    if op["muxer"] in ("mp4", "mov"):
        command += ["-movflags", "+faststart"]
    return command + ["-progress", "pipe:1", "-f", op["muxer"], str(output)]


def encode(client, run, op):
    ffmpeg, ffprobe = client.tool("ffmpeg"), client.tool("ffprobe")
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    suffix = Path(op["destination"]).suffix
    PRIVATE.mkdir(parents=True, exist_ok=True)
    output = PRIVATE / (op["id"] + suffix) if run["reviewOutputs"] else Path(op["source"]).with_name(".dirty-compactor-" + op["id"] + ".tmp")
    needed = max(op["identity"]["size"], int(float(op["rule"]["mbps"]) * 1e6 * op["media"]["duration"] / 8 * 1.2))
    if shutil.disk_usage(output.parent).free < needed + 64 * 1024 * 1024:
        raise PluginError("Insufficient temporary disk space")
    op.update(output=str(output), status="encoding")
    save("run", run)
    codec, preference = op["rule"]["codec"], op["rule"]["encoder"]
    kinds = ["nvenc", "qsv", "amf", "cpu"] if preference == "auto" else [preference] + (["cpu"] if preference != "cpu" else [])
    selected = next((kind for kind in kinds if encoder_usable(ffmpeg, codec, kind)), None)
    if selected is None:
        raise PluginError("No usable encoder for the selected codec")
    op["encoder"] = ENCODERS[codec][selected]
    op["fallback"] = preference not in ("cpu", "auto") and selected == "cpu"
    try:
        run_process(command_for(ffmpeg, op, output, op["encoder"]), run["id"], "Encoding", op["media"]["duration"])
    except Cancelled:
        raise
    except PluginError as error:
        message = str(error).lower()
        hardware_failure = any(word in message for word in ("device", "nvenc", "cuda", "amf", "mfx", "qsv", "encoder"))
        if selected == "cpu" or not hardware_failure or any(word in message for word in ("no space", "permission denied", "invalid data")):
            raise
        output.unlink(missing_ok=True)
        op.update(encoder=ENCODERS[codec]["cpu"], fallback=True)
        run_process(command_for(ffmpeg, op, output, op["encoder"]), run["id"], "Encoding (CPU fallback)", op["media"]["duration"])
    result = probe(ffprobe, output)
    original = op["media"]
    if [result["width"], result["height"]] != op["dimensions"] or abs(result["duration"] - original["duration"]) > max(0.25, original["duration"] * 0.001):
        raise PluginError("Output dimensions or duration failed validation")
    def streams(media):
        return [(s["codec_type"], s.get("codec_name") if s["codec_type"] != "video" else "video") for s in media["streams"]]
    if streams(result) != streams(original) or len(result["chapters"]) != len(original["chapters"]):
        raise PluginError("Output stream/chapters preservation failed validation")
    if output.stat().st_size >= op["identity"]["size"]:
        raise PluginError("Output is not smaller; original retained")
    if op["rule"]["action"] == "reencode" and (not result["bitrate"] or result["bitrate"] >= original["bitrate"]):
        raise PluginError("Could not validate a lower video bitrate")
    run_process([ffmpeg, "-v", "error", "-xerror", "-nostdin", "-i", str(output), "-map", "0:v", "-map", "0:a?", "-f", "null", "-"], run["id"], "Validating", original["duration"])
    op.update(outputHash=file_hash(output), outputMedia=result, outputSize=output.stat().st_size, status="validated")
    save("run", run)
    if run["reviewOutputs"]:
        published = PREVIEWS / output.name
        # Publish only fully validated files. Journal both sides of the rename
        # so an interrupted publish can be recovered without an orphan.
        op["published"] = str(published)
        save("run", run)
        os.replace(output, published)
        op["output"] = str(published)
        save("run", run)


def cleanup_output(op):
    for name in ("output", "published"):
        if not op.get(name):
            continue
        path = Path(op[name])
        # Only journal-owned files with generated names may be removed.
        if op["id"] not in path.name:
            raise PluginError("Unrecognized temporary output")
        path.unlink(missing_ok=True)


def commit(client, run, op):
    revalidate(client, run, op)
    check_cancel(run["id"])
    output = Path(op["output"])
    if file_hash(output) != op["outputHash"]:
        raise PluginError("Reviewed output changed; original retained")
    destination = Path(op["destination"])
    if str(destination) != op["source"] and destination.exists():
        raise PluginError("Destination now exists; original retained")
    staged = destination.with_name(".dirty-compactor-" + op["id"] + ".stage")
    backup = destination.with_name(".dirty-compactor-" + op["id"] + ".backup")
    if staged.exists() or backup.exists():
        raise PluginError("Recovery files already exist; resolve recovery first")
    op.update(staged=str(staged), backup=str(backup), status="staging")
    save("run", run)
    if shutil.disk_usage(destination.parent).free < output.stat().st_size + 64 * 1024 * 1024:
        raise PluginError("Insufficient space to stage the reviewed output")
    shutil.copyfile(output, staged)
    if file_hash(staged) != op["outputHash"]:
        raise PluginError("Staging verification failed")
    revalidate(client, run, op)
    check_cancel(run["id"])
    op["status"] = "installing"
    save("run", run)
    if str(destination) != op["source"]:
        client.move(op["fileId"], destination)
    os.replace(destination, backup)
    os.replace(staged, destination)
    op["status"] = "reconciling"
    run["status"] = "reconciling"
    save("run", run)
    op["scanJob"] = str(client.scan(destination))
    save("run", run)
    client.queue(PLUGIN_ID, {"mode": "finalize", "id": run["id"]}, "DirtyCompactor: reconcile replacement")


def complete_run(client, run, status="completed"):
    run["status"] = status
    save("run", run)
    pending = storage.compactor_get("control", "pending")
    if pending and pending.get("trigger") and not settings()["automationPaused"]:
        storage.compactor_put("control", "pending", {"trigger": None})
        client.queue(PLUGIN_ID, {"mode": "pendingAutomatic", "trigger": pending["trigger"]}, "DirtyCompactor: pending automatic evaluation")


def worker(client, run_id, accept=False):
    run = get("run", run_id)
    expected = "acceptQueued" if accept else "queued"
    if run["status"] != expected:
        return run
    run["status"] = "running"
    save("run", run)  # compare-and-swap: only one worker can enter
    try:
        for op in run["operations"]:
            if op["status"] not in ("ready", "awaitingReview"):
                continue
            check_cancel(run_id)
            if run["automatic"] and settings()["automationPaused"]:
                raise Cancelled("Automation paused")
            try:
                revalidate(client, run, op)
                if op["rule"]["action"] == "delete":
                    for f in op["deleteFiles"]:
                        if identity(f["path"]) != f["identity"] or file_hash(f["path"]) != f["hash"]:
                            raise PluginError("Scene files changed before deletion")
                    op["status"] = "deleting"
                    save("run", run)
                    client.delete(op["sceneId"])
                    op.update(status="completed", libraryBytesRemoved=op["savings"], actualSavings=0,
                              reason="Deleted through Stash; reclaimed space depends on Stash trash settings")
                    save("run", run)
                    continue
                if op["status"] != "awaitingReview":
                    encode(client, run, op)
                    if run["reviewOutputs"]:
                        op["status"] = "awaitingReview"
                        run["status"] = "awaitingReview"
                        save("run", run)
                        return run
                commit(client, run, op)
                return run
            except Cancelled:
                raise
            except Exception as error:
                op["reason"] = str(error)
                if op["status"] in ("installing", "reconciling", "deleting"):
                    run["status"] = "recovery"
                    save("run", run)
                    return run
                if op["status"] == "awaitingReview":
                    run["status"] = "awaitingReview"
                    save("run", run)
                    return run
                cleanup_output(op)
                if op.get("staged"):
                    Path(op["staged"]).unlink(missing_ok=True)
                op["status"] = "failed"
                save("run", run)
        complete_run(client, run)
    except Cancelled as error:
        for op in run["operations"]:
            if op["status"] in ("ready", "encoding", "validated", "awaitingReview", "staging"):
                cleanup_output(op)
                if op.get("staged"):
                    Path(op["staged"]).unlink(missing_ok=True)
                op.update(status="cancelled", reason=str(error))
        complete_run(client, run, "cancelled")
    return run


def finalize(client, run_id):
    run = get("run", run_id)
    if run["status"] != "reconciling":
        return run
    run["status"] = "finalizing"
    save("run", run)
    op = next(o for o in run["operations"] if o["status"] in ("reconciling", "restoring"))
    try:
        scene = client.scene(op["sceneId"])
        file = next((f for f in (scene or {}).get("files", []) if str(f["id"]) == op["fileId"]), None)
        restoring = op["status"] == "restoring"
        target = op["source"] if restoring else op["destination"]
        wanted_hash = op["sourceHash"] if restoring else op["outputHash"]
        if not file or file["path"] != target or file_hash(target) != wanted_hash or int(file["size"]) != Path(target).stat().st_size:
            raise PluginError("Stash did not reconcile the expected file and scene")
        if not restoring and [int(file["width"]), int(file["height"])] != op["dimensions"]:
            raise PluginError("Stash resolution is not reconciled yet")
        if not restoring:
            Path(op["backup"]).unlink(missing_ok=True)
            storage.compactor_put("completed", digest([op["fileId"], op["rule"]["id"]]), {"hash": op["outputHash"], "actionKey": op["actionKey"]})
        cleanup_output(op)
        op.update(status="restored" if restoring else "completed", actualSavings=0 if restoring else op["identity"]["size"] - op["outputSize"])
        run["status"] = "queued"
        save("run", run)
        client.queue(PLUGIN_ID, {"mode": "worker", "id": run_id}, "DirtyCompactor: next file")
    except Exception as error:
        run["status"] = "recovery"
        op["reason"] = str(error)
        save("run", run)
    return run


def output_review(run):
    op = next((o for o in run["operations"] if o["status"] == "awaitingReview"), None)
    if op is None:
        return None
    return {"operationId": op["id"], "url": "/plugin/dirtyCompactor/assets/previews/" + Path(op["output"]).name,
            "originalSize": op["identity"]["size"], "outputSize": op["outputSize"], "original": op["media"],
            "output": op["outputMedia"], "encoder": op["encoder"], "fallback": op.get("fallback"),
            "destination": op["destination"], "reason": op.get("reason"), "title": op["title"]}


def public_record(record, page=1):
    result = {k: v for k, v in record.items() if k not in ("operations", "settings", "_revision")}
    operations = record.get("operations", [])
    page = max(1, int(page))
    result.update(total=len(operations), page=page, pages=max(1, math.ceil(len(operations) / 25)),
                  counts={state: sum(o["status"] == state for o in operations) for state in set(o["status"] for o in operations)},
                  estimatedSavings=sum(o.get("savings", 0) for o in operations if o["status"] == "ready"),
                  readyActions={action: sum(o["status"] == "ready" and o["rule"]["action"] == action for o in operations) for action in ("resize", "reencode", "delete")},
                  actualSavings=sum(o.get("actualSavings", 0) for o in operations),
                  libraryBytesRemoved=sum(o.get("libraryBytesRemoved", 0) for o in operations),
                  operations=[{k: o.get(k) for k in ("id", "sceneId", "title", "fileId", "source", "destination", "status", "reason", "savings", "dimensions", "identity", "media", "rule", "actualSavings")} for o in operations[(page - 1) * 25:page * 25]])
    if "reviewOutputs" in record:
        result["review"] = output_review(record)
    result["progress"] = storage.compactor_get("progress", record["id"]) if record["status"] in ("running", "planning", "reconciling", "finalizing") else None
    return result


def start_run(client, preview, args, automatic=False, trigger=None):
    if preview["status"] != "ready" or digest(settings()["rules"]) != digest(preview["settings"]["rules"]):
        raise PluginError("Preview is not ready or rules changed")
    excluded = set(str(x) for x in args.get("excludedScenes", []))
    run = {"id": uuid.uuid4().hex, "status": "queued", "created": time.time(), "settings": preview["settings"],
           "rulesDigest": digest(preview["settings"]["rules"]), "automatic": automatic,
           "reviewOutputs": bool(args.get("reviewOutputs")) and not automatic,
           "operations": [dict(o) for o in preview["operations"] if o["status"] == "ready" and o["sceneId"] not in excluded]}
    result = storage.compactor_claim_run(run, trigger)
    if result.get("duplicate") or result.get("coalesced"):
        return result
    try:
        client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyCompactor: apply rules")
    except Exception:
        stored = get("run", run["id"])
        stored["status"] = "failed"
        save("run", stored)
        raise
    return result


def recover(client, run, restore=False):
    if run["status"] not in ("recovery", "running", "finalizing", "reconciling", "queued", "acceptQueued", "discarding"):
        raise PluginError("This run does not need recovery")
    progress = storage.compactor_get("progress", run["id"])
    if progress and time.time() - progress.get("heartbeat", 0) < 30 and run["status"] in ("running", "finalizing"):
        raise PluginError("Worker is still active")
    # A live Stash task remains authoritative even during long hashing/probing
    # phases which produce no FFmpeg progress events.
    jobs = client.call("{jobQueue{id description status}}") .get("jobQueue") or []
    if any(j.get("status") in ("RUNNING", "READY") and str(j.get("description", "")).startswith("DirtyCompactor:") for j in jobs):
        raise PluginError("DirtyCompactor tasks are still queued or running")
    if run["status"] == "acceptQueued":
        run["status"] = "awaitingReview"
        save("run", run)
        return
    if run["status"] == "discarding":
        for item in run["operations"]:
            if item["status"] == "awaitingReview":
                cleanup_output(item)
                item["status"] = "discarded"
        run["status"] = "queued"
        save("run", run)
        client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyCompactor: resume after discard")
        return
    op = next((o for o in run["operations"] if o["status"] in ("installing", "reconciling", "restoring", "staging", "encoding", "validated", "deleting")), None)
    if not op:
        run["status"] = "queued"
        save("run", run)
        client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyCompactor: resume")
        return
    if op["status"] == "deleting":
        if client.scene(op["sceneId"]):
            raise PluginError("Deletion outcome is uncertain; inspect the scene before retrying")
        op.update(status="completed", libraryBytesRemoved=op["savings"], actualSavings=0)
        run["status"] = "queued"
        save("run", run)
        client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyCompactor: resume")
        return
    backup = Path(op["backup"]) if op.get("backup") else None
    if op["status"] == "restoring" and Path(op["source"]).exists() and file_hash(op["source"]) == op["sourceHash"]:
        # Restoration may have finished before its follow-up scan was queued.
        scan_path = op["source"]
    elif restore or op["status"] == "restoring":
        target = Path(op["destination"])
        # Crash between Stash rename and backup creation: the original itself
        # is still at the destination and can be renamed back without deletion.
        original_at_destination = target.exists() and file_hash(target) == op["sourceHash"]
        if (not backup or not backup.exists()) and not original_at_destination:
            raise PluginError("Verified original backup is unavailable")
        if backup and backup.exists() and file_hash(backup) != op["sourceHash"]:
            raise PluginError("Original backup changed")
        if str(target) != op["source"] and Path(op["source"]).exists():
            raise PluginError("Original path is occupied")
        if target.exists() and file_hash(target) not in (op.get("outputHash"), op["sourceHash"]):
            raise PluginError("Destination was changed externally; automatic restoration refused")
        op["status"] = "restoring"
        save("run", run)
        if backup and backup.exists():
            os.replace(backup, target)
        if str(target) != op["source"]:
            client.move(op["fileId"], op["source"])
        scan_path = op["source"]
    elif op["status"] in ("encoding", "validated", "staging"):
        cleanup_output(op)
        if op.get("staged"):
            Path(op["staged"]).unlink(missing_ok=True)
        op["status"] = "ready"
        run["status"] = "queued"
        save("run", run)
        client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyCompactor: retry interrupted encode")
        return
    else:
        if not Path(op["destination"]).exists() and op.get("staged") and Path(op["staged"]).exists() and backup and backup.exists():
            if file_hash(op["staged"]) != op["outputHash"]:
                raise PluginError("Staged output changed")
            os.replace(op["staged"], op["destination"])
        if file_hash(op["destination"]) != op["outputHash"]:
            raise PluginError("Replacement incomplete; restore original")
        op["status"] = "reconciling"
        scan_path = op["destination"]
    run["status"] = "reconciling"
    save("run", run)
    op["scanJob"] = str(client.scan(scan_path))
    save("run", run)
    client.queue(PLUGIN_ID, {"mode": "finalize", "id": run["id"]}, "DirtyCompactor: reconcile recovery")


def dispatch(client, args):
    mode = args.get("mode")
    if mode == "capabilities":
        return capabilities(client)
    if mode == "preview":
        preview = {"id": uuid.uuid4().hex, "status": "queued", "settings": settings(), "automatic": bool(args.get("automatic")), "created": time.time()}
        save("preview", preview)
        client.queue(PLUGIN_ID, {"mode": "plan", "id": preview["id"]}, "DirtyCompactor: calculate preview")
        return {"id": preview["id"]}
    if mode == "plan":
        preview = get("preview", args["id"])
        try:
            preview["status"] = "planning"
            save("preview", preview)
            build_preview(client, preview)
        except Exception as error:
            preview.update(status="failed", error=str(error))
            save("preview", preview)
        return {"id": preview["id"]}
    if mode == "getPreview":
        return public_record(get("preview", args["id"]), args.get("page", 1))
    if mode == "startRun":
        return start_run(client, get("preview", args["id"]), args)
    if mode in ("startAutomaticRun", "pendingAutomatic"):
        if settings()["automationPaused"] or not any(r.get("enabled") and r["mode"] == "automatic" for r in settings()["rules"]):
            return {"paused": True}
        if mode == "startAutomaticRun":
            if storage.internal_scan_check(args.get("jobId"), args.get("startTime")):
                return {"internal": True}
            if not args.get("startTime") or not args.get("jobId"):
                raise PluginError("Scan identity is required")
            trigger = digest([str(args["jobId"]), args["startTime"]])
            previous_trigger = storage.compactor_get("trigger", trigger)
            if previous_trigger and previous_trigger.get("queued") is not False:
                return {"duplicate": True}
            # Queue planning, never do expensive probing in the browser request.
            claim = storage.compactor_put("trigger", trigger, {"queued": True}, expected=previous_trigger["_revision"] if previous_trigger else -1)
            try:
                client.queue(PLUGIN_ID, {"mode": "pendingAutomatic", "trigger": trigger}, "DirtyCompactor: automatic evaluation")
            except Exception:
                storage.compactor_put("trigger", trigger, {"queued": False, "error": "Queue failed"})
                raise
            return claim
        active = storage.compactor_get("control", "active")
        if active:
            current = get("run", active["id"])
            if current["status"] not in TERMINAL:
                storage.compactor_put("control", "pending", {"trigger": args["trigger"]})
                return {"coalesced": True}
        preview = {"id": uuid.uuid4().hex, "status": "planning", "settings": settings(), "automatic": True, "created": time.time()}
        save("preview", preview)
        build_preview(client, preview)
        return start_run(client, preview, {}, automatic=True)
    if mode in ("worker", "acceptWorker"):
        return public_record(worker(client, args["id"], mode == "acceptWorker"))
    if mode == "finalize":
        return public_record(finalize(client, args["id"]))
    if mode == "getRun":
        return public_record(get("run", args["id"]), args.get("page", 1))
    if mode == "listRuns":
        return [{"id": r["id"], "status": r["status"], "created": r["created"], "automatic": r["automatic"],
                 "actualSavings": sum(o.get("actualSavings", 0) for o in r["operations"])} for r in storage.compactor_list("run")]
    if mode == "getOutputReview":
        return output_review(get("run", args["id"]))
    if mode in ("acceptOutput", "discardOutput"):
        run = get("run", args["id"])
        op = next((o for o in run["operations"] if o["id"] == args.get("operationId")), None)
        if not op or op["status"] != "awaitingReview" or run["status"] != "awaitingReview":
            return {"alreadyDecided": True}
        run["status"] = "acceptQueued" if mode == "acceptOutput" else "discarding"
        save("run", run)
        if mode == "discardOutput":
            try:
                cleanup_output(op)
                op["status"] = "discarded"
                run["status"] = "queued"
                save("run", run)
            except Exception:
                run["status"] = "awaitingReview"
                save("run", run)
                raise
        try:
            client.queue(PLUGIN_ID, {"mode": "acceptWorker" if mode == "acceptOutput" else "worker", "id": run["id"]}, "DirtyCompactor: " + ("accept output" if mode == "acceptOutput" else "next file"))
        except Exception:
            run["status"] = "awaitingReview" if mode == "acceptOutput" else "recovery"
            save("run", run)
            raise
        return {"id": run["id"]}
    if mode == "cancelRun":
        run = get("run", args["id"])
        storage.compactor_put("cancel", run["id"], {"requested": True})
        if run["status"] == "awaitingReview":
            run["status"] = "queued"
            save("run", run)
            client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyCompactor: cancel")
        return {"requested": True}
    if mode in ("retryRecovery", "restoreOriginal"):
        recover(client, get("run", args["id"]), mode == "restoreOriginal")
        return {"id": args["id"]}
    raise PluginError("Unknown operation")


def main():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        payload = json.load(sys.stdin)
        result = dispatch(Client(payload.get("server_connection") or {}), payload.get("args") or {})
        json.dump({"output": result}, sys.stdout, ensure_ascii=True)
    except Exception as error:
        json.dump({"error": str(error)}, sys.stdout, ensure_ascii=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
