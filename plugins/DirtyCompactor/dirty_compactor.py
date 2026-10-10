"""DirtyCompactor: journaled, sequential media compaction through Stash."""
from __future__ import annotations

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
sys.path.insert(0, str(Path(__file__).resolve().parent))
from dirty_compactor_rules import (
    ENCODERS, PluginError, Cancelled, Skipped, digest, file_hash, identity, validate_settings, dimensions, target_mbps,
    quick_hash, container_video_bitrate,
)
import dirty_compactor_quality as quality
import dirty_compactor_store as records
from dirty_compactor_workflow import Run, OperationJournal, transition_run
import dirty_plugins_protocol as protocol

PLUGIN_ID = "dirtyCompactor"
ROOT = Path(__file__).resolve().parent
PREVIEWS = ROOT / "runtime" / "previews"
PRIVATE = ROOT / "runtime" / "private"
TERMINAL = {"completed", "cancelled", "failed"}
FIELDS = "id title files{id path size width height duration video_codec bit_rate}"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # Windows: no console flash for tools


def settings():
    return validate_settings(storage.get_plugin_settings(PLUGIN_ID))


class Client(BaseClient):
    def scenes(self, condition=None):
        condition = condition or {}
        page = 1
        while True:
            find = dict(condition.get("find") or {})
            find.update(page=page, per_page=100, sort="id", direction="ASC")
            data = self.call("query($filter:FindFilterType,$scene:SceneFilterType){findScenes(filter:$filter,scene_filter:$scene){scenes{" + FIELDS + "}}}",
                             {"filter": find, "scene": condition.get("scene") or {}})["findScenes"]["scenes"]
            yield from data
            if len(data) < 100:
                break
            page += 1

    def scene(self, scene_id):
        return self.call("query($id:ID!){findScene(id:$id){" + FIELDS + "}}", {"id": str(scene_id)})["findScene"]

    def has_shared_files(self, scene_id, file_ids):
        # Stash's explicit IDs bypass filters. Keep the ID inside scene_filter
        # so it is combined with the file-owner criterion in the database.
        result = self.call("query($id:ID!,$scene:SceneFilterType!){findScene(id:$id){files{id}} findScenes(scene_filter:$scene,filter:{per_page:1}){count}}", {
            "id": str(scene_id),
            "scene": {"id": {"value": int(scene_id), "modifier": "EQUALS"},
                      "files_filter": {"scene_count": {"value": 1, "modifier": "GREATER_THAN"}}},
        })
        current = result["findScene"]
        if current is None or sorted(str(file["id"]) for file in current["files"]) != sorted(file_ids):
            raise PluginError("Scene files changed since preview")
        return result["findScenes"]["count"] > 0

    def matches_scene(self, scene_id, condition):
        scene = {"id": {"value": int(scene_id), "modifier": "EQUALS"}}
        if condition.get("scene"):
            scene["AND"] = condition["scene"]
        result = self.call("query($filter:FindFilterType,$scene:SceneFilterType!){findScenes(filter:$filter,scene_filter:$scene){count}}", {
            "filter": dict(condition.get("find") or {}, per_page=1), "scene": scene,
        })["findScenes"]
        return result["count"] > 0

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


def packet_video_bitrate(executable, path, duration, stop=lambda: None, *, timeout=120):
    """Sum packets without retaining output or blocking cancellation on a pipe read."""
    process = subprocess.Popen([executable, "-v", "error", "-select_streams", "v:0", "-show_entries",
                                "packet=size", "-of", "csv=p=0", str(path)],
                               stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=NO_WINDOW)
    total = 0
    cleanup = lambda: None
    reader = None
    def read():
        nonlocal total
        incomplete = False
        for line in iter(lambda: process.stdout.readline(256), b""):
            complete = line.endswith(b"\n") or len(line) < 256
            if not incomplete and complete:
                value = line.strip().split(b",", 1)[0]
                if value.isdigit():
                    total += int(value)
            incomplete = not complete
    try:
        cleanup = contain_child_process(process)
        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        deadline = time.monotonic() + timeout
        while process.poll() is None:
            stop()
            if time.monotonic() >= deadline:
                raise PluginError("Video packet scan timed out")
            try:
                process.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                pass
        stop()
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        cleanup()
        if reader:
            reader.join(timeout=2)
        process.stdout.close()
    if process.returncode:
        raise PluginError("Video packet scan failed")
    return total * 8 / duration


def probe(executable, path, stop=lambda: None):
    stop()
    result = subprocess.run([executable, "-v", "error", "-show_streams", "-show_format", "-show_chapters", "-of", "json", str(path)],
                            capture_output=True, timeout=120, creationflags=NO_WINDOW)
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
    rate = plausible_bitrate(v.get("bit_rate") or v.get("tags", {}).get("BPS") or v.get("tags", {}).get("BPS-eng"),
                             data.get("format", {}).get("bit_rate"))
    if not rate:
        rate = container_video_bitrate(streams, data.get("format", {}).get("bit_rate"))
    if not rate:
        # Matroska often omits stream bitrate. Sum compressed packet bytes,
        # not container bitrate (which includes audio and attachments).
        rate = packet_video_bitrate(executable, path, duration, stop)
    try:
        numerator, denominator = (v.get("avg_frame_rate") or "0/1").split("/")
        fps = float(numerator) / float(denominator) if float(denominator) else 0
    except ValueError:
        fps = 0
    return {"width": int(v["width"]), "height": int(v["height"]), "duration": duration, "fps": fps,
            "bitrate": rate, "codec": v.get("codec_name"), "streams": streams,
            "chapters": data.get("chapters", []), "format": data.get("format", {})}


def plausible_bitrate(stream_rate, format_rate):
    """Return the reported video bitrate, or 0 when it cannot be right.

    ASF/WMV (VC-1) streams are commonly reported as 1 bit/s, which would make
    every file look already compressed. Rates far below any real video, or
    above the whole container's rate, fall back to measuring packets.
    """
    try:
        rate = float(stream_rate or 0)
        total = float(format_rate or 0)
    except (TypeError, ValueError):
        return 0
    if rate < 10_000 or (total and rate > total * 1.5):
        return 0
    return rate


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
    updated = records.put(kind, record["id"], record, expected=record.get("_revision"))
    record.update(updated)
    return record


def get(kind, record_id):
    value = records.get(kind, str(record_id))
    if value is None:
        raise PluginError("Record not found")
    return value


def report(run_id, stage, progress=0):
    previous = records.get("progress", run_id) or {}
    records.put("progress", run_id, {"id": run_id, "stage": stage, "progress": progress, "heartbeat": time.time(),
                                               "pid": os.getpid(), "started": previous.get("started") or time.time()})
    print("\x01p\x02" + str(max(0, min(1, progress))), file=sys.stderr, flush=True)


def check_cancel(run_id):
    if records.get("cancel", run_id):
        raise Cancelled("Cancelled; original retained")


def run_process(command, run_id, stage, duration=1):
    PRIVATE.mkdir(parents=True, exist_ok=True)
    log_path = PRIVATE / (uuid.uuid4().hex + ".log")
    events = queue.Queue()
    try:
        with log_path.open("wb") as errors:
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors, stdin=subprocess.DEVNULL, creationflags=NO_WINDOW)
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
    # NVENC rejects frames below its minimum size (128x128 fails on RTX 40
    # cards), which silently sent every "Auto" encode to the CPU.
    command = [ffmpeg, "-hide_banner", "-v", "error", "-f", "lavfi", "-i", "color=size=320x240:rate=25",
               "-t", "0.2", "-pix_fmt", "yuv420p", "-c:v", ENCODERS[codec][kind], "-b:v", "500000", "-f", "null", "-"]
    try:
        result = subprocess.run(command, capture_output=True, timeout=20, creationflags=NO_WINDOW)
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def pick_encoder(ffmpeg, codec, preference):
    """First usable encoder kind for a rule's preference, CPU last."""
    kinds = ["nvenc", "qsv", "amf", "cpu"] if preference == "auto" else [preference] + (["cpu"] if preference != "cpu" else [])
    selected = next((kind for kind in kinds if encoder_usable(ffmpeg, codec, kind)), None)
    if selected is None:
        raise PluginError("No usable encoder for the selected codec")
    return selected


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
    ffprobe = ffmpeg = None
    kinds = {}
    enabled = [rule for rule in snapshot["rules"] if rule.get("enabled")]
    for rule_number, rule in enumerate(enabled, 1):
        scenes = list(client.scenes(rule["condition"]))
        for scene_number, scene in enumerate(scenes, 1):
            check_cancel(preview["id"])
            stage = ("Rule %d of %d · " % (rule_number, len(enabled)) if len(enabled) > 1 else "") + \
                "scene %d of %d" % (scene_number, len(scenes))
            def overall(within=0.0):
                # One 0-100% across every rule, so Stash's ETA stays meaningful.
                return (rule_number - 1 + (scene_number - 1 + within) / max(1, len(scenes))) / max(1, len(enabled))
            report(preview["id"], "Checking files · " + stage, overall())
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
                            # The full SHA-256 is taken when a run starts (revalidate).
                            op["quickHash"] = quick_hash(op["source"])
                        if rule["action"] == "delete":
                            op["deleteFiles"] = [{"id": str(f["id"]), "path": f["path"], "identity": identity(f["path"]), "quickHash": quick_hash(f["path"])} for f in files]
                            op["savings"] = sum(f["identity"]["size"] for f in op["deleteFiles"])
                        else:
                            ffprobe = ffprobe or client.tool("ffprobe")
                            media = probe(ffprobe, op["source"], lambda: check_cancel(preview["id"]))
                            op["media"] = media
                            op["dimensions"] = list(dimensions(media["width"], media["height"], rule))
                            op["mbps"] = target_mbps(rule, op["dimensions"][0], op["dimensions"][1], media.get("fps"), media["bitrate"])
                            if rule.get("quality") in quality.CRF["h264"]:
                                op["crf"] = quality.CRF[rule["codec"]][rule["quality"]]
                            suffix, muxer = container_for(op["source"], rule, media)
                            op.update(destination=str(Path(op["source"]).with_suffix(suffix)), muxer=muxer)
                            if op["destination"] != op["source"] and Path(op["destination"]).exists():
                                raise PluginError("Destination already exists")
                            completed = records.get("completed", completed_key(op))
                            action_key = digest({k: v for k, v in rule.items() if k not in ("name", "mode", "enabled", "condition")})
                            op["actionKey"] = action_key
                            if completed and completed.get("actionKey") == action_key and same_file(completed, op):
                                op.update(status="unchanged", reason="Would not get smaller with these settings" if completed.get("notSmaller")
                                          else "This output was already processed with these settings")
                            elif rule["action"] == "resize" and op["dimensions"] == [media["width"], media["height"]]:
                                op.update(status="unchanged", reason="Already within the requested resolution")
                            elif rule.get("quality") == "visual":
                                # Quality is measured during the run, right before encoding.
                                # Preview uses typical figures, or an earlier run's measurement.
                                ffmpeg = ffmpeg or client.tool("ffmpeg")
                                kinds.setdefault(rule["id"], pick_encoder(ffmpeg, rule["codec"], rule["encoder"]))
                                choice = records.get("qualitySearch", search_key(op, rule, ENCODERS[rule["codec"]][kinds[rule["id"]]]))
                                if choice:
                                    op.update(crf=choice["crf"], vmaf=choice["vmaf"], mbps=choice["mbps"])
                                    skip = visual_skip_reason(choice, media, rule)
                                    if skip:
                                        op.update(status="unchanged", reason=skip)
                            elif rule.get("quality") == "source" and rule["action"] == "reencode" and media["codec"] == rule["codec"]:
                                op.update(status="unchanged", reason="Already uses " + {"h264": "H.264", "hevc": "H.265"}[rule["codec"]])
                            elif rule.get("quality") != "source" and media["bitrate"] and media["bitrate"] <= op["mbps"] * 1e6:
                                # Never raise a file's bitrate. A codec change still runs at
                                # the original rate; anything else could not save space.
                                if rule["action"] == "reencode" and media["codec"] != rule["codec"]:
                                    op.update(mbps=round(media["bitrate"] / 1e6, 3), convert=True)
                                else:
                                    op.update(status="unchanged", reason="Already at or below target bitrate")
                            elif rule["action"] == "reencode" and not media["bitrate"]:
                                raise PluginError("Video bitrate is unknown; cannot prove a bitrate reduction")
                            estimated = op["mbps"] * 1e6 * media["duration"] / 8
                            other = sum(float(s.get("bit_rate") or 0) for s in media["streams"] if s["codec_type"] != "video") * media["duration"] / 8
                            op["savings"] = max(0, op["identity"]["size"] - int((estimated + other) * 1.02))
                except Cancelled:
                    raise
                except (OSError, ValueError, PluginError) as error:
                    op.update(status="blocked", reason=str(error))
                operations.append(op)
    preview.update(status="ready", operations=operations)
    save("preview", preview)
    return preview


def completed_key(op):
    """Remembers a file's outcome under one rule, so unchanged files are skipped later."""
    return digest([op["fileId"], op["rule"]["id"]])


def search_key(op, rule, encoder):
    """Identifies a quality measurement: same file, output size, encoder, and target."""
    return digest([quality.SEARCH_VERSION, op["quickHash"], op["identity"]["size"], op["dimensions"], encoder,
                   rule["vmaf"], quality.CRF_RANGE[rule["codec"]], quality.SAMPLE_SECONDS, quality.SAMPLE_POINTS])


def visual_skip_reason(choice, media, rule):
    if not choice["reached"]:
        return "Cannot reach VMAF %d in the quality search range" % rule["vmaf"]
    if media["bitrate"] and choice["mbps"] * 1e6 >= media["bitrate"] * 0.95:
        return "Would not get smaller at this visual quality"
    return None


def measure_quality(ffmpeg, run, op, encoder):
    """Find the constant-quality value for a "Match visual quality" file.

    Reuses an earlier measurement of the same file and settings. Raises
    Skipped when the file would not get meaningfully smaller at the target.
    """
    rule, media, key = op["rule"], op["media"], search_key(op, op["rule"], encoder)
    choice = records.get("qualitySearch", key)
    if not choice:
        tests = [0]

        def step():
            check_cancel(run["id"])
            tests[0] += 1
            report(run["id"], "Measuring quality · test %d" % tests[0], min(0.95, (tests[0] - 1) / quality.SEARCH_STEPS))
        choice = quality.search(ffmpeg, op["source"], media, op["dimensions"], rule["codec"], encoder, rule["vmaf"],
                                PRIVATE / ("quality-" + op["id"]), step, lambda: check_cancel(run["id"]))
        # Same file and settings give the same answer; later previews and runs reuse it.
        records.put("qualitySearch", key, {k: choice[k] for k in ("crf", "vmaf", "mbps", "reached")})
    op.update(crf=choice["crf"], vmaf=choice["vmaf"], mbps=choice["mbps"])
    save("run", run)
    reason = visual_skip_reason(choice, media, rule)
    if reason:
        raise Skipped(reason)


def same_file(completed, op):
    """Whether a remembered outcome belongs to this exact source file."""
    return bool(completed.get("quickHash")) and completed["quickHash"] == op["quickHash"]


def revalidate(client, run, op):
    if digest(settings()["rules"]) != run["rulesDigest"]:
        raise PluginError("Rules changed. Discard this output and generate a new preview.")
    scene = client.scene(op["sceneId"])
    if not scene or sorted(str(f["id"]) for f in scene["files"]) != op["sceneFiles"]:
        raise PluginError("Scene files changed since preview")
    current = next((f for f in scene["files"] if str(f["id"]) == op["fileId"]), None)
    if op["sceneFiles"]:
        changed = (not current or current["path"] != op["source"] or identity(op["source"]) != op["identity"]
                   or (op.get("quickHash") and quick_hash(op["source"]) != op["quickHash"]))
        if not changed and op.get("sourceHash"):
            changed = file_hash(op["source"]) != op["sourceHash"]
        if changed:
            raise PluginError("Original changed since preview; it has been retained")
        if not op.get("sourceHash"):
            # First check in a run: fingerprint the whole original now, before
            # anything is encoded or replaced; replacement and recovery use it.
            op["sourceHash"] = file_hash(op["source"])
            save("run", run)
    for rule in run["settings"]["rules"]:
        if rule.get("enabled") and client.matches_scene(op["sceneId"], rule["condition"]):
            if rule["id"] != op["rule"]["id"]:
                raise PluginError("Winning rule changed since preview")
            break
    else:
        raise PluginError("Scene no longer matches its rule")
    # Refresh ownership immediately before a destructive operation.
    if client.has_shared_files(op["sceneId"], op["sceneFiles"]):
        raise PluginError("A file is now shared with another scene")


def op_mbps(op):
    # Runs planned before quality presets stored only the rule's custom Mbps.
    return float(op.get("mbps") or op["rule"]["mbps"])


def command_for(ffmpeg, op, output, encoder):
    rule, media = op["rule"], op["media"]
    command = [ffmpeg, "-hide_banner", "-v", "error", "-nostdin", "-n", "-noautorotate", "-i", op["source"],
               "-map", "0", "-map_metadata", "0", "-map_chapters", "0", "-c", "copy", "-c:v:0", encoder]
    if op.get("crf") is not None:
        # Constant quality, capped at the source bitrate so it never grows.
        command += quality.quality_args(encoder, op["crf"], media.get("bitrate") or None)
    else:
        command += ["-b:v:0", str(int(op_mbps(op) * 1e6))]
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
    codec, preference = op["rule"]["codec"], op["rule"]["encoder"]
    selected = pick_encoder(ffmpeg, codec, preference)
    if op["rule"].get("quality") == "visual" and op.get("crf") is None:
        measure_quality(ffmpeg, run, op, ENCODERS[codec][selected])
    needed = max(op["identity"]["size"], int(op_mbps(op) * 1e6 * op["media"]["duration"] / 8 * 1.2))
    if shutil.disk_usage(output.parent).free < needed + 64 * 1024 * 1024:
        raise PluginError("Insufficient temporary disk space")
    op.update(output=str(output), status="encoding")
    save("run", run)
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
    result = probe(ffprobe, output, lambda: check_cancel(run["id"]))
    original = op["media"]
    if [result["width"], result["height"]] != op["dimensions"] or abs(result["duration"] - original["duration"]) > max(0.25, original["duration"] * 0.001):
        raise PluginError("Output dimensions or duration failed validation")
    def streams(media):
        return [(s["codec_type"], s.get("codec_name") if s["codec_type"] != "video" else "video") for s in media["streams"]]
    if streams(result) != streams(original) or len(result["chapters"]) != len(original["chapters"]):
        raise PluginError("Output stream/chapters preservation failed validation")
    # Conversions at the original bitrate ("Same bitrate", or a target above
    # the original) are not required to shrink.
    converting = op["rule"].get("quality") == "source" or op.get("convert")
    if not converting and output.stat().st_size >= op["identity"]["size"]:
        # Constant-quality sizes are only known after encoding; remember the
        # outcome so later previews skip this file with the same settings.
        records.put("completed", completed_key(op),
                              {"hash": op["sourceHash"], "quickHash": op.get("quickHash"), "actionKey": op["actionKey"], "notSmaller": True})
        raise PluginError("Output is not smaller; original retained")
    if not converting and op["rule"]["action"] == "reencode" and (not result["bitrate"] or result["bitrate"] >= original["bitrate"]):
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


def discard_outputs(op):
    """Remove an unfinished operation's outputs and staged copy; the original stays."""
    cleanup_output(op)
    if op.get("staged"):
        Path(op["staged"]).unlink(missing_ok=True)


def commit(client, run: Run, op: OperationJournal):
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
    transition_run(run, "reconciling", save)
    op["scanJob"] = str(client.scan(destination))
    save("run", run)
    client.queue(PLUGIN_ID, {"mode": "finalize", "id": run["id"]}, "DirtyCompactor: reconcile replacement")


def complete_run(client, run, status="completed"):
    transition_run(run, status, save)
    pending = records.get("control", "pending")
    if pending and pending.get("trigger") and not settings()["automationPaused"]:
        records.put("control", "pending", {"trigger": None})
        client.queue(PLUGIN_ID, {"mode": "pendingAutomatic", "trigger": pending["trigger"]}, "DirtyCompactor: pending automatic evaluation")


def worker(client, run_id, accept=False) -> Run:
    run = get("run", run_id)
    expected = "acceptQueued" if accept else "queued"
    if not transition_run(run, "running", save, expected=expected):
        return run  # compare-and-swap: only one worker can enter
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
                        if identity(f["path"]) != f["identity"] or (quick_hash(f["path"]) != f["quickHash"] if "quickHash" in f
                                                                     else file_hash(f["path"]) != f["hash"]):
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
                        transition_run(run, "awaitingReview", save)
                        return run
                commit(client, run, op)
                return run
            except Cancelled:
                raise
            except Skipped as skipped:
                op.update(status="unchanged", reason=str(skipped))
                save("run", run)
            except Exception as error:
                op["reason"] = str(error)
                if op["status"] in ("installing", "reconciling", "deleting"):
                    transition_run(run, "recovery", save)
                    return run
                if op["status"] == "awaitingReview":
                    transition_run(run, "awaitingReview", save)
                    return run
                discard_outputs(op)
                op["status"] = "failed"
                save("run", run)
        complete_run(client, run)
    except Cancelled as error:
        for op in run["operations"]:
            if op["status"] in ("ready", "encoding", "validated", "awaitingReview", "staging"):
                discard_outputs(op)
                op.update(status="cancelled", reason=str(error))
        complete_run(client, run, "cancelled")
    return run


def finalize(client, run_id):
    run = get("run", run_id)
    if not transition_run(run, "finalizing", save, expected="reconciling"):
        return run
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
            records.put("completed", completed_key(op),
                                  {"hash": op["outputHash"], "quickHash": quick_hash(target), "actionKey": op["actionKey"]})
        cleanup_output(op)
        op.update(status="restored" if restoring else "completed", actualSavings=0 if restoring else op["identity"]["size"] - op["outputSize"])
        transition_run(run, "queued", save)
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
            "destination": op["destination"], "reason": op.get("reason"), "title": op["title"],
            "crf": op.get("crf"), "vmaf": op.get("vmaf")}


def skip_reasons(operations):
    """Count why files were not planned, across every page of the record."""
    counts = {}
    for o in operations:
        if o["status"] in ("blocked", "unchanged", "manual"):
            # Probe errors append tool output after a colon; group by the summary.
            reason = str(o.get("reason") or o["status"]).split(":", 1)[0].strip()
            counts[reason] = counts.get(reason, 0) + 1
    return sorted(([reason, count] for reason, count in counts.items()), key=lambda item: (-item[1], item[0]))


def eta(progress, now=None):
    """Seconds left in a preview from its pace so far, once there is enough to go on.

    Preview progress is one 0-1 fraction for the whole plan. Run progress
    restarts for every file, so runs do not get an overall estimate.
    """
    fraction, started = progress.get("progress") or 0, progress.get("started")
    elapsed = (now or time.time()) - (started or 0)
    # Half a percent and half a minute: rough at first, but it tightens as it goes.
    if not started or fraction < 0.005 or elapsed < 30:
        return None
    return round(elapsed * (1 - fraction) / fraction)


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
                  skipReasons=skip_reasons(operations),
                  operations=[{k: o.get(k) for k in ("id", "sceneId", "title", "fileId", "source", "destination", "status", "reason", "savings", "dimensions", "mbps", "crf", "vmaf", "convert", "identity", "media", "rule", "actualSavings")} for o in operations[(page - 1) * 25:page * 25]])
    if "reviewOutputs" in record:
        result["review"] = output_review(record)
    result["progress"] = records.get("progress", record["id"]) if record["status"] in ("running", "planning", "reconciling", "finalizing") else None
    if result["progress"] and "reviewOutputs" not in record:
        result["progress"]["eta"] = eta(result["progress"])
    if "reviewOutputs" not in record and record["status"] in ("queued", "planning"):
        result["cancelRequested"] = bool(records.get("cancel", record["id"]))
    return result


def start_run(client, preview, args, automatic=False, trigger=None):
    if preview["status"] != "ready" or digest(settings()["rules"]) != digest(preview["settings"]["rules"]):
        raise PluginError("Preview is not ready or rules changed")
    excluded = set(str(x) for x in args.get("excludedScenes", []))
    run = {"id": uuid.uuid4().hex, "status": "queued", "created": time.time(), "settings": preview["settings"],
           "rulesDigest": digest(preview["settings"]["rules"]), "automatic": automatic,
           "reviewOutputs": bool(args.get("reviewOutputs")) and not automatic,
           "operations": [dict(o) for o in preview["operations"] if o["status"] == "ready" and o["sceneId"] not in excluded]}
    result = records.claim_run(run, trigger)
    if result.get("duplicate") or result.get("coalesced"):
        return result
    # A used preview is not offered again when the panel reopens.
    preview["runId"] = run["id"]
    save("preview", preview)
    try:
        client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyCompactor: apply rules")
    except Exception:
        stored = get("run", run["id"])
        transition_run(stored, "failed", save)
        raise
    return result


def tasks_active(client):
    """Whether any DirtyCompactor task is queued or running in Stash.

    Stash prefixes task descriptions, e.g. "Running plugin task: DirtyCompactor: ...".
    """
    jobs = client.call("{jobQueue{id description status}}").get("jobQueue") or []
    return any(j.get("status") in ("RUNNING", "READY") and "DirtyCompactor:" in str(j.get("description", "")) for j in jobs)


def recover(client, run: Run, restore=False):
    if run["status"] not in ("recovery", "running", "finalizing", "reconciling", "queued", "acceptQueued", "discarding"):
        raise PluginError("This run does not need recovery")
    progress = records.get("progress", run["id"])
    if progress and time.time() - progress.get("heartbeat", 0) < 30 and run["status"] in ("running", "finalizing"):
        raise PluginError("Worker is still active")
    # A live Stash task remains authoritative even during long hashing/probing
    # phases which produce no FFmpeg progress events.
    if tasks_active(client):
        raise PluginError("DirtyCompactor tasks are still queued or running")
    if run["status"] == "acceptQueued":
        transition_run(run, "awaitingReview", save)
        return
    if run["status"] == "discarding":
        for item in run["operations"]:
            if item["status"] == "awaitingReview":
                cleanup_output(item)
                item["status"] = "discarded"
        transition_run(run, "queued", save)
        client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyCompactor: resume after discard")
        return
    op = next((o for o in run["operations"] if o["status"] in ("installing", "reconciling", "restoring", "staging", "encoding", "validated", "deleting")), None)
    if not op:
        transition_run(run, "queued", save)
        client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyCompactor: resume")
        return
    if op["status"] == "deleting":
        if client.scene(op["sceneId"]):
            raise PluginError("Deletion outcome is uncertain; inspect the scene before retrying")
        op.update(status="completed", libraryBytesRemoved=op["savings"], actualSavings=0)
        transition_run(run, "queued", save)
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
        transition_run(run, "queued", save)
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
    transition_run(run, "reconciling", save)
    op["scanJob"] = str(client.scan(scan_path))
    save("run", run)
    client.queue(PLUGIN_ID, {"mode": "finalize", "id": run["id"]}, "DirtyCompactor: reconcile recovery")


def capabilities_handler(client, args):
    return capabilities(client)


def queue_preview(client, args):
    preview = {
        "id": uuid.uuid4().hex,
        "status": "queued",
        "settings": settings(),
        "automatic": bool(args.get("automatic")),
        "created": time.time(),
    }
    save("preview", preview)
    client.queue(PLUGIN_ID, {"mode": "plan", "id": preview["id"]}, "DirtyCompactor: calculate preview")
    return {"id": preview["id"]}


def plan_preview(client, args):
    preview = get("preview", args["id"])
    try:
        preview["status"] = "planning"
        save("preview", preview)
        build_preview(client, preview)
    except Cancelled:
        preview = get("preview", args["id"])
        preview["status"] = "cancelled"
        save("preview", preview)
    except Exception as error:
        preview.update(status="failed", error=str(error))
        save("preview", preview)
    return {"id": preview["id"]}


def latest_preview(client, args):
    for preview in records.list_records("preview", limit=20):
        if preview.get("automatic"):
            continue
        if preview.get("runId") or preview.get("status") in ("discarded", "cancelled", "failed"):
            return None
        return {"id": preview["id"]} if digest(preview["settings"]["rules"]) == digest(settings()["rules"]) else None
    return None


def discard_preview(client, args):
    preview = get("preview", args["id"])
    if preview["status"] in ("queued", "planning"):
        raise PluginError("Cancel the preview before discarding it")
    preview["status"] = "discarded"
    save("preview", preview)
    return {"id": preview["id"]}


def reconcile_stopped_preview(client, preview):
    if preview["status"] in ("queued", "planning") and not tasks_active(client):
        # Stash restarted or the task was stopped from its task queue.
        preview.update(status="failed", error="The preview task stopped before finishing. Run Preview again.")
        save("preview", preview)


def get_preview(client, args):
    preview = get("preview", args["id"])
    reconcile_stopped_preview(client, preview)
    return public_record(preview, args.get("page", 1))


def start_run_handler(client, args):
    return start_run(client, get("preview", args["id"]), args)


def handle_automatic_trigger(client, args):
    mode = args.get("mode")
    if settings()["automationPaused"] or not any(r.get("enabled") and r["mode"] == "automatic" for r in settings()["rules"]):
        return {"paused": True}
    if mode == "startAutomaticRun":
        if storage.internal_scan_check(args.get("jobId"), args.get("startTime")):
            return {"internal": True}
        if not args.get("startTime") or not args.get("jobId"):
            raise PluginError("Scan identity is required")
        trigger = digest([str(args["jobId"]), args["startTime"]])
        previous_trigger = records.get("trigger", trigger)
        if previous_trigger and previous_trigger.get("queued") is not False:
            return {"duplicate": True}
        # Queue planning, never do expensive probing in the browser request.
        claim = records.put("trigger", trigger, {"queued": True}, expected=previous_trigger["_revision"] if previous_trigger else -1)
        try:
            client.queue(PLUGIN_ID, {"mode": "pendingAutomatic", "trigger": trigger}, "DirtyCompactor: automatic evaluation")
        except Exception:
            records.put("trigger", trigger, {"queued": False, "error": "Queue failed"})
            raise
        return claim
    active = records.get("control", "active")
    if active:
        current = get("run", active["id"])
        if current["status"] not in TERMINAL:
            records.put("control", "pending", {"trigger": args["trigger"]})
            return {"coalesced": True}
    preview = {
        "id": uuid.uuid4().hex,
        "status": "planning",
        "settings": settings(),
        "automatic": True,
        "created": time.time(),
    }
    save("preview", preview)
    build_preview(client, preview)
    return start_run(client, preview, {}, automatic=True)


def run_worker(client, args):
    mode = args.get("mode")
    return public_record(worker(client, args["id"], mode == "acceptWorker"))


def finalize_handler(client, args):
    return public_record(finalize(client, args["id"]))


def get_run(client, args):
    return public_record(get("run", args["id"]), args.get("page", 1))


def list_runs(client, args):
    return [
        {
            "id": run["id"],
            "status": run["status"],
            "created": run["created"],
            "automatic": run["automatic"],
            "actualSavings": sum(operation.get("actualSavings", 0) for operation in run["operations"]),
        }
        for run in records.list_records("run")
    ]


def get_output_review(client, args):
    return output_review(get("run", args["id"]))


def decide_output(client, args):
    mode = args.get("mode")
    run = get("run", args["id"])
    op = next((o for o in run["operations"] if o["id"] == args.get("operationId")), None)
    if not op or op["status"] != "awaitingReview" or run["status"] != "awaitingReview":
        return {"alreadyDecided": True}
    transition_run(run, "acceptQueued" if mode == "acceptOutput" else "discarding", save)
    if mode == "discardOutput":
        try:
            cleanup_output(op)
            op["status"] = "discarded"
            transition_run(run, "queued", save)
        except Exception:
            transition_run(run, "awaitingReview", save)
            raise
    try:
        worker_mode = "acceptWorker" if mode == "acceptOutput" else "worker"
        action = "accept output" if mode == "acceptOutput" else "next file"
        client.queue(PLUGIN_ID, {"mode": worker_mode, "id": run["id"]}, "DirtyCompactor: " + action)
    except Exception:
        transition_run(run, "awaitingReview" if mode == "acceptOutput" else "recovery", save)
        raise
    return {"id": run["id"]}


def cancel_preview(client, args):
    records.put("cancel", args["id"], {"requested": True})
    return {"requested": True}


def cancel_run(client, args):
    run = get("run", args["id"])
    records.put("cancel", run["id"], {"requested": True})
    if run["status"] == "awaitingReview":
        transition_run(run, "queued", save)
        client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyCompactor: cancel")
    return {"requested": True}


def recover_run(client, args):
    mode = args.get("mode")
    recover(client, get("run", args["id"]), mode == "restoreOriginal")
    return {"id": args["id"]}


HANDLERS = {
    'capabilities': capabilities_handler,
    'preview': queue_preview,
    'plan': plan_preview,
    'latestPreview': latest_preview,
    'discardPreview': discard_preview,
    'getPreview': get_preview,
    'startRun': start_run_handler,
    'startAutomaticRun': handle_automatic_trigger,
    'pendingAutomatic': handle_automatic_trigger,
    'worker': run_worker,
    'acceptWorker': run_worker,
    'finalize': finalize_handler,
    'getRun': get_run,
    'listRuns': list_runs,
    'getOutputReview': get_output_review,
    'acceptOutput': decide_output,
    'discardOutput': decide_output,
    'cancelPreview': cancel_preview,
    'cancelRun': cancel_run,
    'retryRecovery': recover_run,
    'restoreOriginal': recover_run,
}

def dispatch(client, args):
    handler = HANDLERS.get(args.get("mode"))
    if handler is None:
        raise PluginError("Unknown operation")
    return handler(client, args)


def run(payload, _reporter=None):
    return dispatch(Client(payload.get("server_connection") or {}), payload.get("args") or {})


def main():
    # The settings page polls run and preview status; only failures are logged.
    return protocol.serve("DirtyCompactor", run, quiet=True)


if __name__ == "__main__":
    sys.exit(main())
