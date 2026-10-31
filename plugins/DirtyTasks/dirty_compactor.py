"""DirtyTasks: encoding: journaled, sequential media compaction through Stash."""
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
    ENCODERS, PluginError, Cancelled, Paused, Skipped, digest, file_hash, identity, validate_settings, dimensions, target_mbps,
    quick_hash, container_video_bitrate,
)
import dirty_compactor_quality as quality
import dirty_compactor_store as records
from dirty_compactor_workflow import Run, OperationJournal, transition_run
from dirty_tasks_settings import get_section
import dirty_tasks_lock as reservation

PLUGIN_ID = "dirtyTasks"
ROOT = Path(__file__).resolve().parent
PRIVATE = ROOT / "runtime" / "private"
TERMINAL = {"completed", "cancelled", "failed"}
FIELDS = "id title files{id path size width height duration video_codec bit_rate}"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)  # Windows: no console flash for tools


def settings():
    return validate_settings(get_section("encoding"))


class Client(BaseClient):
    def queue(self, plugin_id, args, description):
        return super().queue(plugin_id, {"task": "encoding", **args}, description)

    def attach(self, scene_id, path):
        # Scan may associate matching bytes automatically, or create a fresh
        # scene. Merge only the fresh scene that exclusively owns our output.
        target = self.scene(scene_id)
        if not target:
            raise PluginError("Original scene no longer exists")
        existing = next((f for f in target["files"] if f["path"] == str(path)), None)
        if existing:
            return existing
        found = self.call("query($path:String!){findFile(path:$path){id ... on VideoFile{width height size}}}",
                          {"path": str(path)})["findFile"]
        owners = self.call("query($scene:SceneFilterType!){findScenes(scene_filter:$scene,filter:{per_page:2}){scenes{id files{id path}}}}",
                           {"scene": {"files_filter": {"path": {"value": str(path), "modifier": "EQUALS"}}}})["findScenes"]["scenes"]
        if len(owners) != 1 or len(owners[0]["files"]) != 1 or owners[0]["files"][0]["path"] != str(path):
            raise PluginError("Encoded file has unexpected scene associations; retry attachment after checking it")
        self.call("mutation($input:SceneMergeInput!){sceneMerge(input:$input){id}}",
                  {"input": {"source": [owners[0]["id"]], "destination": str(scene_id)}})
        result = self.scene(scene_id)
        attached = next((f for f in result["files"] if f["path"] == str(path)), None)
        if not attached:
            raise PluginError("Stash did not attach the encoded file")
        return attached

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


def check_stop(run_id):
    """Cancellation, or a pause that stops the current encode until resumed."""
    check_cancel(run_id)
    if (records.get("pause", run_id) or {}).get("requested"):
        raise Paused("Paused; the interrupted file starts over when resumed")


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
                        check_stop(run_id)
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
            for file in files:
                op = dict(base, id=uuid.uuid4().hex, fileId=str(file["id"]), source=file["path"], status="ready", savings=0)
                try:
                    if preview.get("automatic") and rule.get("trigger", "manual") != preview.get("automationTrigger", "scan"):
                        op.update(status="manual", reason="Winning rule uses a different trigger")
                    elif records.get("generated", str(file["id"])):
                        op.update(status="unchanged", reason="Generated encoding; original files only")
                    elif any(len(owners.get(str(f["id"]), set())) > 1 for f in files):
                        raise PluginError("Scene has files shared with another scene")
                    else:
                        if files:
                            op["identity"] = identity(op["source"])
                            # The full SHA-256 is taken when a run starts (revalidate).
                            op["quickHash"] = quick_hash(op["source"])
                        ffprobe = ffprobe or client.tool("ffprobe")
                        media = probe(ffprobe, op["source"], lambda: check_cancel(preview["id"]))
                        op["media"] = media
                        op["dimensions"] = list(dimensions(media["width"], media["height"], rule))
                        op["mbps"] = target_mbps(rule, op["dimensions"][0], op["dimensions"][1], media.get("fps"), media["bitrate"])
                        if rule.get("quality") in quality.CRF["h264"]:
                            op["crf"] = quality.CRF[rule["codec"]][rule["quality"]]
                        suffix, muxer = container_for(op["source"], rule, media)
                        action_key = digest({k: v for k, v in rule.items() if k not in ("id", "name", "mode", "trigger", "enabled", "condition")})
                        op["actionKey"] = action_key
                        completed = records.get("completed", completed_key(op))
                        original = Path(op["source"])
                        variant = ".dirtytasks-" + rule["codec"] + "-" + "x".join(map(str, op["dimensions"])) + "-" + action_key[:12]
                        op.update(destination=str(original.with_name(original.stem[:140] + variant + suffix)), muxer=muxer)
                        if completed and completed.get("actionKey") == action_key and same_file(completed, op) and (completed.get("notSmaller") or any(str(f["id"]) == completed.get("outputFileId") for f in files)):
                            op.update(status="unchanged", reason="Would not get smaller with these settings" if completed.get("notSmaller")
                                      else "An encoded version already exists for these settings")
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
    """Same source and encoding recipe, including rules recreated with a new ID."""
    return digest([op["fileId"], op["actionKey"]])


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
            check_stop(run["id"])
            tests[0] += 1
            report(run["id"], "Measuring quality · test %d" % tests[0], min(0.95, (tests[0] - 1) / quality.SEARCH_STEPS))
        choice = quality.search(ffmpeg, op["source"], media, op["dimensions"], rule["codec"], encoder, rule["vmaf"],
                                PRIVATE / ("quality-" + op["id"]), step, lambda: check_stop(run["id"]))
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
    suffix = Path(op["destination"]).suffix
    PRIVATE.mkdir(parents=True, exist_ok=True)
    output = Path(op["source"]).with_name(".dirty-tasks-" + op["id"] + ".tmp")
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
    result = probe(ffprobe, output, lambda: check_stop(run["id"]))
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

def cleanup_output(op):
    if not op.get("output"):
        return
    path = Path(op["output"])
    if path.name != ".dirty-tasks-" + op["id"] + ".tmp":
        raise PluginError("Unrecognized temporary output")
    path.unlink(missing_ok=True)


def discard_outputs(op):
    cleanup_output(op)


def commit(client, run, op):
    revalidate(client, run, op)
    check_cancel(run["id"])
    output, destination = Path(op["output"]), Path(op["destination"])
    if file_hash(output) != op["outputHash"]:
        raise PluginError("Encoded output changed; original retained")
    op["status"] = "publishing"
    save("run", run)
    # Windows rename is atomic and refuses an occupied destination. On POSIX,
    # link publishes exclusively (rename would replace an unrelated file).
    # Both names are journaled before publication for interrupted cleanup.
    if os.name == "nt":
        os.rename(output, destination)
    else:
        os.link(output, destination)
    cleanup_output(op)
    op["status"] = "reconciling"
    transition_run(run, "reconciling", save)
    op["scanJob"] = str(client.scan(destination))
    save("run", run)
    client.queue(PLUGIN_ID, {"mode": "finalize", "id": run["id"]}, "DirtyTasks: encoding: attach encoded file")


def complete_run(client, run, status="completed"):
    transition_run(run, status, save)
    reservation.release("encoding", run["id"])
    reservation.queue_pending(client)
    queue_pending(client)


def queue_pending(client):
    for key in ("pending", "pending:scan", "pending:generate"):
        pending = records.get("control", key)
        if pending and pending.get("trigger"):
            kind = pending.get("automationTrigger", "scan")
            if any(r.get("enabled") and r.get("trigger") == kind for r in settings()["rules"]):
                client.queue(PLUGIN_ID, {"mode": "pendingAutomatic", "trigger": pending["trigger"], "automationTrigger": kind}, "DirtyTasks: encoding: pending automatic evaluation")
            records.put("control", key, {"trigger": None}, expected=pending["_revision"])


def worker(client, run_id):
    run = get("run", run_id)
    if not transition_run(run, "running", save, expected="queued"):
        return run
    reservation.acquire("encoding", run_id)
    try:
        for op in run["operations"]:
            if op["status"] != "ready":
                continue
            check_stop(run_id)
            if run["automatic"] and get_section("execution")["encoding"].get(str(op["rule"]["id"]), "manual") != run.get("automationTrigger", "scan"):
                raise Cancelled("Rule trigger changed")
            try:
                revalidate(client, run, op)
                encode(client, run, op)
                commit(client, run, op)
                return run
            except Cancelled:
                raise
            except Skipped as skipped:
                op.update(status="unchanged", reason=str(skipped))
                save("run", run)
            except Exception as error:
                op["reason"] = str(error)
                if op["status"] in ("publishing", "reconciling", "attaching"):
                    transition_run(run, "recovery", save)
                    return run
                discard_outputs(op)
                op["status"] = "failed"
                save("run", run)
        complete_run(client, run)
    except Paused:
        # Nothing was published; the interrupted file is encoded again on resume.
        for op in run["operations"]:
            if op["status"] in ("encoding", "validated"):
                discard_outputs(op)
                op["status"] = "ready"
        transition_run(run, "paused", save)
        records.put("pause", run_id, {"requested": False})
        # Organization may run meanwhile; resuming revalidates every file.
        reservation.release("encoding", run_id)
    except Cancelled as error:
        for op in run["operations"]:
            if op["status"] in ("ready", "encoding", "validated"):
                discard_outputs(op)
                op.update(status="cancelled", reason=str(error))
        complete_run(client, run, "cancelled")
    return run


def finalize(client, run_id):
    run = get("run", run_id)
    if not transition_run(run, "finalizing", save, expected="reconciling"):
        return run
    op = next(o for o in run["operations"] if o["status"] in ("reconciling", "attaching"))
    try:
        target = Path(op["destination"])
        if not target.is_file() or file_hash(target) != op["outputHash"]:
            raise PluginError("Encoded file changed before attachment; original retained")
        # Preserve the original association as well as every pre-existing file.
        before = client.scene(op["sceneId"])
        if not before or not set(op["sceneFiles"]).issubset(str(f["id"]) for f in before["files"]):
            raise PluginError("Original scene associations changed before attachment")
        op["status"] = "attaching"
        save("run", run)
        attached = client.attach(op["sceneId"], target)
        if int(attached["size"]) != target.stat().st_size or [int(attached["width"]), int(attached["height"])] != op["dimensions"]:
            raise PluginError("Stash has not indexed the expected encoded file")
        file_id = str(attached["id"])
        records.put("generated", file_id, {"sourceFileId": op["fileId"], "actionKey": op["actionKey"], "outputHash": op["outputHash"]})
        records.put("completed", completed_key(op), {"hash": op["sourceHash"], "quickHash": op["quickHash"],
                    "actionKey": op["actionKey"], "outputFileId": file_id})
        op.update(status="completed", outputFileId=file_id, addedBytes=op["outputSize"], actualSavings=0)
        # Later original files in this same scene now legitimately include our output.
        for other in run["operations"]:
            if other["sceneId"] == op["sceneId"] and file_id not in other["sceneFiles"]:
                other["sceneFiles"] = sorted(other["sceneFiles"] + [file_id])
        transition_run(run, "queued", save)
        client.queue(PLUGIN_ID, {"mode": "worker", "id": run_id}, "DirtyTasks: encoding: next file")
    except Exception as error:
        run["status"] = "recovery"
        op["reason"] = str(error)
        save("run", run)
    return run


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
                  readyActions={action: sum(o["status"] == "ready" and o["rule"]["action"] == action for o in operations) for action in ("resize", "reencode")},
                  actualSavings=sum(o.get("actualSavings", 0) for o in operations),
                  addedBytes=sum(o.get("addedBytes", 0) for o in operations),
                  originalBytes=original_bytes(operations),
                  skipReasons=skip_reasons(operations),
                  operations=[{k: o.get(k) for k in ("id", "sceneId", "title", "fileId", "source", "destination", "status", "reason", "savings", "dimensions", "mbps", "crf", "vmaf", "convert", "identity", "media", "rule", "actualSavings", "outputSize", "addedBytes")} for o in operations[(page - 1) * 25:page * 25]])
    result["progress"] = records.get("progress", record["id"]) if record["status"] in ("running", "planning", "reconciling", "finalizing") else None
    if result["progress"] and "rulesDigest" not in record:
        result["progress"]["eta"] = eta(result["progress"])
    if "rulesDigest" not in record and record["status"] in ("queued", "planning"):
        result["cancelRequested"] = bool(records.get("cancel", record["id"]))
    if "rulesDigest" in record and record["status"] not in TERMINAL | {"paused"}:
        result["pauseRequested"] = bool((records.get("pause", record["id"]) or {}).get("requested"))
    return result


def original_bytes(operations):
    """Size of the originals that have an encoded version, to compare with addedBytes."""
    return sum((o.get("identity") or {}).get("size", 0) for o in operations if o.get("addedBytes"))


def start_run(client, preview, args, automatic=False, trigger=None):
    if preview["status"] != "ready" or digest(settings()["rules"]) != digest(preview["settings"]["rules"]):
        raise PluginError("Preview is not ready or rules changed")
    excluded = set(str(x) for x in args.get("excludedScenes", []))
    run = {"id": uuid.uuid4().hex, "status": "queued", "created": time.time(), "settings": preview["settings"],
           "rulesDigest": digest(preview["settings"]["rules"]), "automatic": automatic,
           "automationTrigger": preview.get("automationTrigger"),
           "operations": [dict(o) for o in preview["operations"] if o["status"] == "ready" and o["sceneId"] not in excluded]}
    reservation.acquire("encoding", run["id"])
    try:
        result = records.claim_run(run, trigger)
    except Exception:
        reservation.release("encoding", run["id"])
        raise
    if result.get("duplicate") or result.get("coalesced"):
        reservation.release("encoding", run["id"])
        return result
    # A used preview is not offered again when the panel reopens.
    preview["runId"] = run["id"]
    save("preview", preview)
    try:
        client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyTasks: encoding: apply rules")
    except Exception:
        stored = get("run", run["id"])
        transition_run(stored, "failed", save)
        reservation.release("encoding", run["id"])
        raise
    return result


def tasks_active(client):
    """Whether any DirtyCompactor task is queued or running in Stash.

    Stash prefixes task descriptions, e.g. "Running plugin task: DirtyCompactor: ...".
    """
    jobs = client.call("{jobQueue{id description status}}").get("jobQueue") or []
    return any(j.get("status") in ("RUNNING", "READY") and "DirtyTasks: encoding:" in str(j.get("description", "")) for j in jobs)


def recover(client, run):
    if run["status"] in TERMINAL:
        raise PluginError("This run does not need recovery")
    if tasks_active(client):
        raise PluginError("Encoding tasks are still queued or running")
    reservation.acquire("encoding", run["id"])
    op = next((o for o in run["operations"] if o["status"] in ("publishing", "reconciling", "attaching", "encoding", "validated")), None)
    if op and op["status"] in ("publishing", "reconciling", "attaching"):
        destination = Path(op["destination"])
        if destination.exists():
            if file_hash(destination) != op.get("outputHash"):
                raise PluginError("Destination is occupied by another file; it has been retained")
            cleanup_output(op)
            op["status"] = "reconciling"
            transition_run(run, "reconciling", save)
            op["scanJob"] = str(client.scan(destination))
            save("run", run)
            client.queue(PLUGIN_ID, {"mode": "finalize", "id": run["id"]}, "DirtyTasks: encoding: retry attachment")
            return run
    if op:
        cleanup_output(op)
        op["status"] = "ready"
    transition_run(run, "queued", save)
    client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyTasks: encoding: resume")
    return run


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
    client.queue(PLUGIN_ID, {"mode": "plan", "id": preview["id"]}, "DirtyTasks: encoding: calculate preview")
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
    kind = args.get("automationTrigger") or "scan"
    if kind not in ("scan", "generate"):
        raise PluginError("A Scan or Generate trigger is required")
    if not any(r.get("enabled") and r.get("trigger") == kind for r in settings()["rules"]):
        return {"paused": True}
    if mode == "startAutomaticRun":
        if storage.internal_scan_check(args.get("jobId"), args.get("startTime")):
            return {"internal": True}
        if not args.get("startTime") or not args.get("jobId"):
            raise PluginError("Completed job identity is required")
        trigger = digest([kind, str(args["jobId"]), args["startTime"]])
        previous_trigger = records.get("trigger", trigger)
        if previous_trigger and previous_trigger.get("queued") is not False:
            return {"duplicate": True}
        # Queue planning, never do expensive probing in the browser request.
        claim = records.put("trigger", trigger, {"queued": True}, expected=previous_trigger["_revision"] if previous_trigger else -1)
        try:
            client.queue(PLUGIN_ID, {"mode": "pendingAutomatic", "trigger": trigger, "automationTrigger": kind}, "DirtyTasks: encoding: automatic evaluation")
        except Exception:
            records.put("trigger", trigger, {"queued": False, "error": "Queue failed"})
            raise
        return claim
    file_work = storage.get_metadata(reservation.NAMESPACE, "active")
    if file_work and json.loads(file_work).get("kind") == "organization":
        records.put("control", "pending:" + kind, {"trigger": args["trigger"], "automationTrigger": kind})
        return {"coalesced": True}
    active = records.get("control", "active")
    if active:
        current = get("run", active["id"])
        if current["status"] not in TERMINAL:
            records.put("control", "pending:" + kind, {"trigger": args["trigger"], "automationTrigger": kind})
            return {"coalesced": True}
    preview = {
        "id": uuid.uuid4().hex,
        "status": "planning",
        "settings": settings(),
        "automatic": True,
        "automationTrigger": kind,
        "created": time.time(),
    }
    save("preview", preview)
    build_preview(client, preview)
    return start_run(client, preview, {}, automatic=True)


def run_worker(client, args):
    return public_record(worker(client, args["id"]))


def finalize_handler(client, args):
    return public_record(finalize(client, args["id"]))


def get_run(client, args):
    return public_record(get("run", args["id"]), args.get("page", 1))


def list_runs(client, args):
    return [{"id": run["id"], "status": run["status"], "created": run["created"], "automatic": run["automatic"],
             "addedBytes": sum(o.get("addedBytes", 0) for o in run["operations"]),
             "originalBytes": original_bytes(run["operations"]),
             "counts": {"completed": sum(o["status"] == "completed" for o in run["operations"])}}
            for run in records.list_records("run")]


def cancel_preview(client, args):
    records.put("cancel", args["id"], {"requested": True})
    return {"requested": True}


def cancel_run(client, args):
    run = get("run", args["id"])
    if run["status"] in TERMINAL:
        return {"requested": False}
    records.put("cancel", run["id"], {"requested": True})
    if run["status"] == "paused":
        for item in run["operations"]:
            if item["status"] == "ready":
                item.update(status="cancelled", reason="Cancelled; original retained")
        complete_run(client, run, "cancelled")
    elif run["status"] == "recovery" and not tasks_active(client):
        op = next((o for o in run["operations"] if o["status"] in ("publishing", "reconciling", "attaching")), None)
        if op and Path(op["destination"]).is_file() and file_hash(op["destination"]) == op.get("outputHash"):
            recover(client, run)
        else:
            for item in run["operations"]:
                if item["status"] != "completed":
                    cleanup_output(item)
                    item["status"] = "cancelled"
            complete_run(client, run, "cancelled")
    # Published files are retained and attachment finishes before stopping.
    return {"requested": True}


def pause_run(client, args):
    run = get("run", args["id"])
    if run["status"] in TERMINAL or run["status"] == "paused":
        return {"requested": False}
    if run["status"] == "recovery":
        raise PluginError("Retry recovery or cancel the run before pausing it")
    # The encoder stops at its next check; a published file finishes attaching first.
    records.put("pause", run["id"], {"requested": True})
    return {"requested": True}


def resume_run(client, args):
    run = get("run", args["id"])
    if run["status"] != "paused":
        raise PluginError("This run is not paused")
    reservation.acquire("encoding", run["id"])
    records.put("pause", run["id"], {"requested": False})
    transition_run(run, "queued", save)
    client.queue(PLUGIN_ID, {"mode": "worker", "id": run["id"]}, "DirtyTasks: encoding: resume")
    return {"id": run["id"]}


def recover_run(client, args):
    recover(client, get("run", args["id"]))
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
    'finalize': finalize_handler,
    'getRun': get_run,
    'listRuns': list_runs,
    'cancelPreview': cancel_preview,
    'cancelRun': cancel_run,
    'pauseRun': pause_run,
    'resumeRun': resume_run,
    'retryRecovery': recover_run,
}

def dispatch(client, args):
    handler = HANDLERS.get(args.get("mode"))
    if handler is None:
        raise PluginError("Unknown operation")
    return handler(client, args)


def run(payload, _reporter=None):
    return dispatch(Client(payload.get("server_connection") or {}), payload.get("args") or {})


