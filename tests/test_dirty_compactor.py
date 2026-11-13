from plugin_paths import runtime_path
import copy
import hashlib
import importlib.util
import io
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stderr
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("dirty_compactor_test", runtime_path("DirtyTasks", "dirty_compactor.py"))
compactor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compactor)


def rule(**changes):
    value = {"id": "rule-1", "name": "Reduce", "enabled": True, "mode": "manual", "condition": {"all": True, "scene": {}, "find": {}},
             "action": "resize", "width": 320, "height": 180, "mbps": .2, "codec": "h264", "encoder": "cpu", "format": "keep"}
    value.update(changes)
    return value


class FakeClient:
    def __init__(self, source):
        self.data = [{"id": "1", "title": "Synthetic scene", "files": [{"id": "7", "path": str(source)}]}]
        self.jobs = []
        self.deleted = []

    def scenes(self, condition=None):
        return iter(copy.deepcopy(self.data))

    def scene(self, scene_id):
        return copy.deepcopy(next((s for s in self.data if s["id"] == str(scene_id)), None))

    def file_action_scenes(self, scene_ids):
        for scene_id in scene_ids:
            scene = self.scene(scene_id)
            if scene:
                yield scene

    def set_primary(self, scene_id, file_id):
        scene = next(s for s in self.data if s["id"] == str(scene_id))
        file = next(f for f in scene["files"] if f["id"] == str(file_id))
        scene["files"].remove(file)
        scene["files"].insert(0, file)

    def delete_file(self, file_id):
        for scene in self.data:
            for file in list(scene["files"]):
                if file["id"] == str(file_id):
                    if scene["files"][0] is file:
                        raise RuntimeError("Cannot delete a primary file")
                    Path(file["path"]).unlink()
                    scene["files"].remove(file)
                    self.deleted.append(str(file_id))

    def has_shared_files(self, scene_id, file_ids):
        scene = self.scene(scene_id)
        if scene is None or sorted(file["id"] for file in scene["files"]) != sorted(file_ids):
            raise compactor.PluginError("Scene files changed since preview")
        files = {file["id"] for file in scene["files"]}
        return any(other["id"] != str(scene_id) and any(file["id"] in files for file in other["files"]) for other in self.data)

    def matches_scene(self, scene_id, condition):
        scene = self.scene(scene_id)
        query = (condition.get("find") or {}).get("q", "")
        return bool(scene and query.lower() in scene["title"].lower())

    def tool(self, name):
        return shutil.which(name)

    def queue(self, plugin_id, args, description):
        self.jobs.append(dict(args))
        return str(len(self.jobs))

    def scan(self, path):
        media = compactor.probe(self.tool("ffprobe"), path)
        for s in self.data:
            for f in s["files"]:
                if f["path"] == str(path):
                    f.update(width=media["width"], height=media["height"], size=Path(path).stat().st_size)
        return "scan-1"

    def move(self, file_id, destination):
        for s in self.data:
            for f in s["files"]:
                if f["id"] == file_id:
                    Path(f["path"]).rename(destination)
                    f["path"] = str(destination)

    def attach(self, scene_id, path):
        scene = next(s for s in self.data if s["id"] == str(scene_id))
        current = next((f for f in scene["files"] if f["path"] == str(path)), None)
        if current:
            return current
        media = compactor.probe(self.tool("ffprobe"), path)
        file = {"id": str(100 + len(scene["files"])), "path": str(path), "size": Path(path).stat().st_size,
                "width": media["width"], "height": media["height"]}
        scene["files"].append(file)
        return copy.deepcopy(file)

    def call(self, query, variables=None):
        if "jobQueue" in query:
            return {"jobQueue": []}
        raise AssertionError(query)


class CompactorFileActionTests(unittest.TestCase):
    def test_deletion_reports_progress_while_verifying_both_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            original, replacement = folder / "original.mp4", folder / "replacement.mp4"
            original.write_bytes(b"original")
            replacement.write_bytes(b"replacement")
            client = FakeClient(original)
            client.data[0]["files"].append({"id": "8", "path": str(replacement)})
            hash_contents = compactor.file_hash
            candidate = {"status": "completed", "sceneId": "1", "fileId": "7", "outputFileId": "8",
                         "identity": compactor.identity(original), "outputSize": replacement.stat().st_size,
                         "sourceHash": hash_contents(original), "outputHash": hash_contents(replacement)}
            run = {"id": "run", "status": "completed", "operations": [dict(candidate, fileId="6"), candidate]}
            args = {"id": "run"}
            snapshots = []

            def read_contents(path, progress):
                progress(.5)
                snapshots.append((Path(path), compactor.get_run(client, args)["fileAction"]["progress"]))
                return hash_contents(path)

            stderr = io.StringIO()
            with patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(folder / "settings.sqlite3")}):
                compactor.save("run", run)
                queued = compactor.queue_file_action(client, dict(args, mode="deleteOriginals", confirmed=True))
                with patch.object(compactor, "file_hash", side_effect=read_contents), \
                        patch.object(compactor.time, "monotonic", side_effect=[0, 2, 2, 4]), redirect_stderr(stderr):
                    result = compactor.run_file_action(client, dict(args, actionId=queued["fileAction"]["id"]))
                self.assertNotIn("progress", compactor.get_run(client, args)["fileAction"])

            self.assertEqual(snapshots, [
                (replacement, {"current": 2, "total": 2, "stage": "Checking encoded replacement", "progress": .5}),
                (original, {"current": 2, "total": 2, "stage": "Checking original file", "progress": .5}),
            ])
            action = result["fileAction"]
            self.assertEqual((action["status"], action["changed"], action["skipped"], action["failed"]),
                             ("completed", 1, 1, 0))
            self.assertEqual(client.deleted, ["7"])
            self.assertEqual(replacement.read_bytes(), b"replacement")
            stash_progress = [float(line.removeprefix("\x01p\x02")) for line in stderr.getvalue().splitlines()]
            self.assertEqual(stash_progress, sorted(stash_progress))
            self.assertGreater(len({value for value in stash_progress if 0 < value < 1}), 2)
            self.assertEqual(stash_progress[-1], 1)


class CompactorRulesTests(unittest.TestCase):
    def test_hash_progress_preserves_the_complete_content_digest(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "hash.bin"
            content = b"synthetic hash fixture" * 450000
            path.write_bytes(content)
            fractions = []
            self.assertEqual(compactor.file_hash(path, progress=fractions.append), hashlib.sha256(content).hexdigest())
            self.assertTrue(any(0 < value < 1 for value in fractions))
            self.assertEqual(fractions, sorted(fractions))
            self.assertEqual(fractions[-1], 1)
            path.write_bytes(b"")
            self.assertEqual(compactor.file_hash(path, progress=fractions.append), hashlib.sha256(b"").hexdigest())

    def test_reported_hash_progress_is_throttled_and_never_completes_a_failed_read(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "hash.bin"
            content = b"synthetic hash fixture" * 450000
            path.write_bytes(content)
            clock = iter([0, 0.1, 1.2, 1.3])
            updates = []
            with patch.object(compactor.time, "monotonic", side_effect=lambda: next(clock)), \
                    patch.object(compactor, "report", side_effect=lambda _id, stage, progress: updates.append((stage, progress))):
                result = compactor.hash_file("run", path, "Checking file")
            self.assertEqual(result, hashlib.sha256(content).hexdigest())
            self.assertEqual(updates[0], ("Checking file", 0))
            self.assertEqual(updates[-1], ("Checking file", 1))
            self.assertEqual(len(updates), 3, "frequent byte callbacks do not write progress on every block")
            updates.clear()
            with patch.object(compactor, "file_hash", side_effect=OSError("read failed")), \
                    patch.object(compactor, "report", side_effect=lambda _id, stage, progress: updates.append(progress)):
                with self.assertRaises(OSError):
                    compactor.hash_file("run", path, "Checking file")
            self.assertEqual(updates, [0])

    def test_dimensions_never_upscale_and_keep_portrait_orientation(self):
        self.assertEqual(compactor.dimensions(1920, 1080, rule()), (320, 180))
        self.assertEqual(compactor.dimensions(1080, 1920, rule()), (180, 320))
        self.assertEqual(compactor.dimensions(160, 90, rule()), (160, 90))
        self.assertEqual(compactor.dimensions(1920, 1080, rule(action="reencode")), (1920, 1080))

    def test_empty_filter_needs_explicit_all_scenes(self):
        with self.assertRaisesRegex(compactor.PluginError, "explicitly"):
            compactor.validate_settings({"rules": [rule(condition={})]})
        compactor.validate_settings({"rules": [rule(enabled=False, condition={})]})

    def test_nan_bitrate_and_duplicate_rule_ids_rejected(self):
        for rules in ([rule(mbps=float("nan"))], [rule(), rule()]):
            with self.assertRaises(compactor.PluginError):
                compactor.validate_settings({"rules": rules})

    def test_quality_presets_scale_bitrate_per_output(self):
        preset = rule(quality="balanced", mbps="ignored")
        compactor.validate_settings({"rules": [preset]})
        self.assertEqual(compactor.target_mbps(preset, 1920, 1080), 5)
        self.assertEqual(compactor.target_mbps(dict(preset, codec="hevc"), 3840, 2160), 8.49)
        self.assertEqual(compactor.target_mbps(dict(preset, quality="small", codec="hevc"), 854, 480), 0.53)
        self.assertGreater(compactor.target_mbps(preset, 1920, 1080, 60), 5)
        self.assertEqual(compactor.target_mbps(rule(), 1920, 1080), .2, "rules without a preset keep their custom Mbps")
        self.assertEqual(compactor.target_mbps(rule(quality="source"), 1920, 1080, 30, 7_500_000), 7.5)
        with self.assertRaises(compactor.PluginError):
            compactor.target_mbps(rule(quality="source"), 1920, 1080, 30, 0)
        compactor.validate_settings({"rules": [rule(action="reencode", quality="source", mbps="ignored")]})
        with self.assertRaisesRegex(compactor.PluginError, "Reencode only"):
            compactor.validate_settings({"rules": [rule(action="resize", quality="source")]})
        with self.assertRaises(compactor.PluginError):
            compactor.validate_settings({"rules": [rule(quality="ultra")]})
        with self.assertRaises(compactor.PluginError):
            compactor.validate_settings({"rules": [rule(quality="custom", mbps="bad")]})

    def test_constant_quality_arguments_per_encoder(self):
        q = compactor.quality
        self.assertEqual(q.quality_args("libx265", 24, 8e6), ["-crf:v:0", "24", "-maxrate:v:0", "8000000", "-bufsize:v:0", "16000000"])
        self.assertEqual(q.quality_args("h264_nvenc", 22), ["-rc:v:0", "vbr", "-cq:v:0", "22", "-b:v:0", "0"])
        self.assertEqual(q.quality_args("hevc_qsv", 24, 8e6), ["-global_quality:v:0", "24"], "ICQ ignores the VBV cap")
        self.assertEqual(q.quality_args("hevc_amf", 24), ["-rc:v:0", "cqp", "-qp_i:v:0", "24", "-qp_p:v:0", "24"])
        self.assertEqual(q.sample_windows(2), [(0.0, 2)])
        self.assertEqual(q.sample_windows(100), [(18.0, 4.0), (48.0, 4.0), (78.0, 4.0)])

    def test_quality_search_interpolates_toward_the_target(self):
        step = compactor.quality.next_value
        self.assertEqual(step({24: 97.0}, 95, (16, 36)), 26, "passing: move up by the typical slope")
        self.assertEqual(step({24: 92.0}, 95, (16, 36)), 21, "failing: move down")
        self.assertEqual(step({24: 97.0, 30: 91.0}, 95, (16, 36)), 26, "interpolate between measurements")
        self.assertIsNone(step({24: 95.5, 25: 94.0}, 95, (16, 36)), "adjacent pass and fail: done")
        self.assertIsNone(step({16: 90.0}, 95, (16, 36)), "cannot go below the range")
        self.assertIsNone(step({36: 96.0}, 95, (16, 36)), "top of the range passes")

    def test_hardware_detection_uses_a_frame_nvenc_accepts(self):
        commands = []
        with patch.object(compactor.subprocess, "run", side_effect=lambda command, **_: commands.append(command) or
                          type("Result", (), {"returncode": 0})()):
            self.assertTrue(compactor.encoder_usable("ffmpeg", "hevc", "nvenc"))
        size = next(arg for arg in commands[0] if arg.startswith("color=size="))
        width, height = (int(part) for part in size.split("=")[2].split(":")[0].split("x"))
        self.assertGreaterEqual(width * height, 256 * 200, "128x128 is below NVENC's minimum frame size")

    def test_quality_samples_bound_encoder_decoder_filters_and_metric_threads(self):
        commands = []
        with tempfile.TemporaryDirectory() as temporary:
            clip = Path(temporary) / "sample.mkv"
            def run(command, stop):
                commands.append(command)
                if "matroska" in command:
                    clip.write_bytes(b"sample")
                return "VMAF score: 96.5"
            with patch.object(compactor.quality, "_run", side_effect=run):
                self.assertEqual(compactor.quality.measure("ffmpeg", "source.mp4", (0, 4), (640, 360), "libx264", 24,
                    clip, threads=5), (96.5, 6))
            encode, metric = commands
            self.assertEqual(encode[encode.index("-threads:v:0") + 1], "5")
            self.assertEqual(encode[encode.index("-filter_threads") + 1], "1")
            self.assertEqual(metric[metric.index("-filter_complex_threads") + 1], "1")
            for command in commands:
                for index, value in enumerate(command):
                    if value == "-i":
                        self.assertEqual(command[index - 2:index], ["-threads", "1"])
            self.assertIn("libvmaf=n_threads=5", metric[metric.index("-lavfi") + 1])

    def test_quality_workers_respect_small_cpu_counts(self):
        quality = compactor.quality
        with tempfile.TemporaryDirectory() as temporary:
            for cores in (1, 2, 16):
                pools = []
                original_pool = quality.ThreadPoolExecutor
                def pool(*args, **kwargs):
                    pools.append(kwargs["max_workers"])
                    return original_pool(*args, **kwargs)
                budgets = []
                def measure(*args):
                    budgets.append(args[-1])
                    return (99, 100)
                with patch.object(quality.os, "cpu_count", return_value=cores), patch.object(quality, "ThreadPoolExecutor", side_effect=pool), patch.object(quality, "measure", side_effect=measure):
                    result = quality.search("ffmpeg", "source.mp4", {"duration": 100}, (640, 360), "h264", "libx264", 95, Path(temporary) / str(cores))
                self.assertGreaterEqual(result["vmaf"], 95)
                self.assertTrue(all(workers == min(3, cores) for workers in pools))
                self.assertTrue(all(budget == max(1, cores // min(3, cores)) for budget in budgets))

    def test_visual_quality_needs_a_known_target(self):
        compactor.validate_settings({"rules": [rule(action="reencode", quality="visual", vmaf=95)]})
        for target in (None, 80, "95"):
            with self.assertRaisesRegex(compactor.PluginError, "visual quality target"):
                compactor.validate_settings({"rules": [rule(action="reencode", quality="visual", vmaf=target)]})
        self.assertEqual(compactor.target_mbps(rule(quality="visual", vmaf=97), 1920, 1080),
                         compactor.target_mbps(rule(quality="high"), 1920, 1080), "estimates follow the nearest preset")

    def test_quick_fingerprint_reads_only_the_ends_of_a_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "video.bin"
            data = bytearray(os.urandom(3 * 1024 * 1024))
            path.write_bytes(data)
            original = compactor.quick_hash(path)
            self.assertEqual(compactor.quick_hash(path), original)
            for offset in (0, len(data) - 1):
                changed = bytearray(data)
                changed[offset] ^= 0xFF
                path.write_bytes(changed)
                self.assertNotEqual(compactor.quick_hash(path), original, "start and end are covered")
            path.write_bytes(data + b"x")
            self.assertNotEqual(compactor.quick_hash(path), original, "size is covered")
            small = Path(folder) / "small.bin"
            small.write_bytes(b"abc")
            self.assertEqual(len(compactor.quick_hash(small)), 64)

    def test_video_bitrate_from_container_minus_audio(self):
        streams = [{"codec_type": "video", "bit_rate": "1"}, {"codec_type": "audio", "bit_rate": "192000"}, {"codec_type": "subtitle"}]
        self.assertEqual(compactor.container_video_bitrate(streams, "12143072"), 12143072 - 192000)
        self.assertEqual(compactor.container_video_bitrate([{"codec_type": "audio"}], "12000000"), 0, "unknown audio bitrate")
        self.assertEqual(compactor.container_video_bitrate(streams, None), 0)

    def test_implausible_stream_bitrates_fall_back_to_packet_measurement(self):
        self.assertEqual(compactor.plausible_bitrate("1", "12143072"), 0, "WMV/VC-1 reports 1 bit/s")
        self.assertEqual(compactor.plausible_bitrate("40000000", "12000000"), 0, "above the whole container")
        self.assertEqual(compactor.plausible_bitrate(None, "12000000"), 0)
        self.assertEqual(compactor.plausible_bitrate("bad", None), 0)
        self.assertEqual(compactor.plausible_bitrate("11500000", "12143072"), 11500000)
        self.assertEqual(compactor.plausible_bitrate("11500000", None), 11500000, "container rate is optional")

    def test_skip_reasons_are_grouped_across_all_operations(self):
        operations = [{"status": "unchanged", "reason": "Already at or below target bitrate"}] * 3 + [
            {"status": "blocked", "reason": "Could not probe media: C:/private/path.mp4 invalid"},
            {"status": "blocked", "reason": "Could not probe media: other output"},
            {"status": "manual", "reason": "First matching rule is Manual"},
            {"status": "ready", "reason": None}]
        self.assertEqual(compactor.skip_reasons(operations), [
            ["Already at or below target bitrate", 3], ["Could not probe media", 2], ["First matching rule is Manual", 1]])

    def test_resize_dimensions_are_integral_and_reencode_ignores_them(self):
        for value in (320.5, "", float("nan"), float("inf")):
            with self.assertRaises(compactor.PluginError):
                compactor.validate_settings({"rules": [rule(width=value)]})
        compactor.validate_settings({"rules": [rule(action="reencode", width="")]})

    def test_format_policy_preserves_streams(self):
        media = {"streams": [{"codec_type": "video"}, {"codec_type": "subtitle", "codec_name": "subrip"}]}
        with self.assertRaises(compactor.PluginError):
            compactor.container_for("a.avi", rule(), media)
        self.assertEqual(compactor.container_for("a.avi", rule(format="allow"), media), (".mkv", "matroska"))

    def test_format_policy_preserves_known_timecode_and_blocks_other_data(self):
        video = {"codec_type": "video", "avg_frame_rate": "25/1", "start_time": "0.000000",
                 "tags": {"timecode": "01:00:00:00"}}
        timecode = {"codec_type": "data", "codec_tag_string": "tmcd", "nb_frames": "1",
                    "avg_frame_rate": "12800/512", "start_time": "0.000000", "tags": {"timecode": "01:00:00:00"}}
        media = {"streams": [video, timecode]}
        for suffix, muxer in ((".mp4", "mp4"), (".m4v", "mp4"), (".mov", "mov")):
            with self.subTest(suffix=suffix):
                self.assertEqual(compactor.container_for("a" + suffix, rule(), media), (suffix, muxer))
        self.assertEqual(compactor.container_for("a.avi", rule(format="allow"), media), (".mov", "mov"))
        with self.assertRaisesRegex(compactor.PluginError, "Timecode tracks require"):
            compactor.container_for("a.mkv", rule(), media)
        media["streams"].append({"codec_type": "data", "codec_tag_string": "gpmd"})
        with self.assertRaisesRegex(compactor.PluginError, "Unsupported data streams.*gpmd"):
            compactor.container_for("a.mp4", rule(format="allow"), media)

    def test_mp4_timecode_regeneration_requires_a_continuous_matching_track(self):
        video = {"codec_type": "video", "avg_frame_rate": "25/1", "start_time": "0",
                 "tags": {"timecode": "01:00:00:00"}}
        timecode = {"codec_type": "data", "codec_tag_string": "tmcd", "nb_frames": "1",
                    "avg_frame_rate": "25/1", "start_time": "0", "tags": {"timecode": "01:00:00:00"}}
        self.assertEqual(compactor.mp4_timecode({"streams": [video, timecode]}), ("01:00:00:00", 25))
        for change in ({"nb_frames": "2"}, {"nb_frames": None}, {"tags": {}},
                       {"tags": {"timecode": "02:00:00:00"}}, {"avg_frame_rate": "24/1"},
                       {"avg_frame_rate": "0/0"}, {"start_time": "1"}):
            with self.subTest(change=change), self.assertRaisesRegex(compactor.PluginError, "timecode"):
                compactor.container_for("a.mp4", rule(), {"streams": [video, dict(timecode, **change)]})
        with self.assertRaisesRegex(compactor.PluginError, "one continuous track"):
            compactor.container_for("a.mp4", rule(), {"streams": [video, timecode, dict(timecode)]})


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg/FFprobe required")
class CompactorPipelineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture_dir = tempfile.TemporaryDirectory()
        cls.fixture = Path(cls.fixture_dir.name) / "source.mp4"
        subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25",
                        "-t", "2", "-c:v", "libx264", "-crf", "5", str(cls.fixture)], check=True, capture_output=True)

    @classmethod
    def tearDownClass(cls):
        cls.fixture_dir.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.folder = Path(self.temp.name)
        self.source = self.folder / "original.mp4"
        shutil.copyfile(self.fixture, self.source)
        self.original = self.source.read_bytes()
        self.env = patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(self.folder / "settings.sqlite3")})
        self.env.start()
        self.paths = patch.multiple(compactor, PRIVATE=self.folder / "private")
        self.paths.start()
        self.client = FakeClient(self.source)
        self.set_rules([rule()])

    def tearDown(self):
        self.paths.stop()
        self.env.stop()
        self.temp.cleanup()

    def set_rules(self, rules):
        compactor.storage.set_plugin_settings(compactor.PLUGIN_ID, {"encoding": {"rules": rules}, "execution": {"move": "manual", "rename": "manual", "tags": "manual", "encoding": {str(r["id"]): r.get("trigger", "scan") for r in rules}}})

    def preview(self, automatic=False):
        value = {"id": "preview", "status": "planning", "settings": compactor.settings(), "automatic": automatic}
        compactor.save("preview", value)
        return compactor.build_preview(self.client, value)

    def start(self, review=True):
        result = compactor.start_run(self.client, self.preview(), {"reviewOutputs": review})
        return compactor.worker(self.client, result["id"])

    def test_validation_reports_decode_progress_and_distinct_following_steps(self):
        stages = []
        original_process = compactor.run_process
        original_report = compactor.report
        def process(command, run_id, stage, duration):
            if stage == "Validating":
                # Slow only this synthetic decode so intermediate telemetry is observable.
                command = list(command)
                command.insert(command.index("-i"), "-re")
            return original_process(command, run_id, stage, duration)
        def report(run_id, stage, progress=0):
            stages.append((stage, progress))
            return original_report(run_id, stage, progress)
        with patch.object(compactor, "run_process", side_effect=process), patch.object(compactor, "report", side_effect=report):
            run = self.start()
        progress = [fraction for stage, fraction in stages if stage == "Validating"]
        self.assertEqual(progress[0], 0)
        self.assertTrue(any(0 < fraction < 1 for fraction in progress), "the real validator emits progress while decoding")
        self.assertEqual(progress[-1], 1)
        self.assertIn(("Checking encoded file details", None), stages)
        self.assertIn(("Checking encoded file contents", 1), stages)
        self.assertIn(("Rechecking encoded file contents", 1), stages)
        self.assertEqual(stages[-1], ("Indexing encoded file", None))
        public = compactor.public_record(run)
        self.assertIsNone(public["progress"]["progress"])








    def test_all_files_are_planned_and_shared_files_blocked(self):
        second = self.folder / "second.mp4"
        shutil.copyfile(self.source, second)
        self.client.data[0]["files"].append({"id": "8", "path": str(second)})
        self.assertEqual(len(self.preview()["operations"]), 2)
        self.client.data.append({"id": "2", "title": "Shared", "files": [{"id": "7", "path": str(self.source)}]})
        self.assertTrue(all(o["status"] == "blocked" for o in self.preview()["operations"]))

    def share_source(self):
        self.client.data.append({"id": "2", "title": "New owner", "files": [{"id": "7", "path": str(self.source)}]})

    def test_new_owner_after_preview_blocks_encoding(self):
        result = compactor.start_run(self.client, self.preview(), {"reviewOutputs": False})
        self.share_source()
        with patch.object(compactor, "encode", side_effect=AssertionError("Shared files must not be encoded")):
            run = compactor.worker(self.client, result["id"])
        self.assertIn("shared", run["operations"][0]["reason"])
        self.assertEqual(self.source.read_bytes(), self.original)









    def test_recovery_cleans_interrupted_partial_encode(self):
        result = compactor.start_run(self.client, self.preview(), {"reviewOutputs": True})
        run = compactor.get("run", result["id"])
        op = run["operations"][0]
        partial = self.folder / (".dirty-tasks-" + op["id"] + ".tmp")
        partial.write_bytes(b"partial encode")
        op.update(status="encoding", output=str(partial))
        run["status"] = "running"
        compactor.save("run", run)
        compactor.recover(self.client, compactor.get("run", run["id"]))
        self.assertFalse(partial.exists())
        self.assertEqual(compactor.get("run", run["id"])["status"], "queued")
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_single_active_run_and_revision_guards(self):
        run = self.start()
        with self.assertRaisesRegex(RuntimeError, "active"):
            compactor.start_run(self.client, self.preview(), {})
        stale = compactor.get("run", run["id"])
        newer = copy.deepcopy(stale)
        compactor.save("run", newer)
        with self.assertRaisesRegex(RuntimeError, "another session"):
            compactor.save("run", stale)


    def test_gpu_failure_falls_back_once_to_same_codec_cpu(self):
        self.set_rules([rule(encoder="nvenc")])
        process = compactor.run_process
        encoders = []
        def invoke(command, *args):
            if "-c:v:0" in command:
                encoder = command[command.index("-c:v:0") + 1]
                encoders.append(encoder)
                if encoder == "h264_nvenc":
                    raise compactor.PluginError("NVENC device initialization failed")
            return process(command, *args)
        with patch.object(compactor, "encoder_usable", return_value=True), patch.object(compactor, "run_process", side_effect=invoke):
            run = self.start()
        self.assertEqual(encoders, ["h264_nvenc", "libx264"])
        self.assertTrue(run["operations"][0]["fallback"])

    def test_cancel_during_encode_never_replaces_original(self):
        with patch.object(compactor, "run_process", side_effect=compactor.Cancelled("cancel test")):
            run = self.start()
        self.assertEqual(run["status"], "cancelled")
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_pause_discards_the_current_encode_and_resume_encodes_it_again(self):
        run_id = compactor.start_run(self.client, self.preview(), {})["id"]
        def pause_midway(command, current, *args):
            Path(command[-1]).write_bytes(b"partial encode")
            # Stash lists the running worker, so the pause is a request the encoder sees.
            with patch.object(compactor, "tasks_active", return_value=True):
                compactor.pause_run(self.client, {"id": current})
            self.assertTrue(compactor.public_record(compactor.get("run", current))["pauseRequested"])
            compactor.check_stop(current)
        with patch.object(compactor, "run_process", side_effect=pause_midway):
            run = compactor.worker(self.client, run_id)
        op = run["operations"][0]
        self.assertEqual((run["status"], op["status"]), ("paused", "ready"))
        self.assertFalse(Path(op["output"]).exists())
        self.assertNotIn("pauseRequested", compactor.public_record(run))
        self.assertIsNone(compactor.storage.get_metadata(compactor.reservation.NAMESPACE, "active"),
                          "a paused run lets organization use the files")
        self.assertEqual(self.source.read_bytes(), self.original)
        compactor.resume_run(self.client, {"id": run_id})
        self.assertEqual(self.client.jobs[-1], {"mode": "worker", "id": run_id})
        run = compactor.worker(self.client, run_id)
        self.assertEqual((run["status"], run["operations"][0]["status"]), ("reconciling", "reconciling"))

    def test_pause_waits_for_recovery_and_a_paused_run_can_be_cancelled(self):
        run_id = compactor.start_run(self.client, self.preview(), {})["id"]
        run = compactor.get("run", run_id)
        run["status"] = "recovery"
        compactor.save("run", run)
        with self.assertRaisesRegex(compactor.PluginError, "recovery"):
            compactor.pause_run(self.client, {"id": run_id})
        run["status"] = "queued"
        compactor.save("run", run)
        # The worker's task is still queued in Stash, so the request waits for it.
        with patch.object(compactor, "tasks_active", return_value=True):
            compactor.pause_run(self.client, {"id": run_id})
        self.assertEqual(compactor.get("run", run_id)["status"], "queued")
        with patch.object(compactor, "encode", side_effect=AssertionError("a pause before the file must not encode")):
            self.assertEqual(compactor.worker(self.client, run_id)["status"], "paused")
        compactor.cancel_run(self.client, {"id": run_id})
        run = compactor.get("run", run_id)
        self.assertEqual((run["status"], run["operations"][0]["status"]), ("cancelled", "cancelled"))
        with self.assertRaisesRegex(compactor.PluginError, "not paused"):
            compactor.resume_run(self.client, {"id": run_id})
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_reencode_preserves_dimensions_and_reduces_bitrate(self):
        self.set_rules([rule(action="reencode")])
        run = self.start()
        self.assertEqual(run["status"], "reconciling")
        media = run["operations"][0]["outputMedia"]
        self.assertEqual((media["width"], media["height"]), (640, 360))
        self.assertLess(media["bitrate"], run["operations"][0]["media"]["bitrate"])

    def add_timecode(self, suffix=".mp4"):
        source = self.folder / ("with-timecode" + suffix)
        subprocess.run([shutil.which("ffmpeg"), "-v", "error", "-i", str(self.source),
                        "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000", "-t", "2",
                        "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac",
                        "-timecode", "01:00:00:00", "-f", "mov" if suffix == ".mov" else "mp4", str(source)],
                       check=True, capture_output=True)
        self.source = source
        self.original = source.read_bytes()
        self.client = FakeClient(source)

    def assert_timecode_output(self, suffix):
        run = self.start()
        self.assertEqual(run["status"], "reconciling")
        op = run["operations"][0]
        self.assertEqual(Path(op["destination"]).suffix, suffix)
        self.assertEqual([s["codec_type"] for s in op["outputMedia"]["streams"]], ["video", "audio", "data"])
        for media in (op["media"], op["outputMedia"]):
            track = compactor.timecode_streams(media)[0]
            self.assertEqual(track["tags"]["timecode"], "01:00:00:00")
        def packets(path):
            return subprocess.run([shutil.which("ffprobe"), "-v", "error", "-select_streams", "d",
                                   "-show_packets", "-show_data_hash", "sha256", "-show_entries", "packet=data_hash",
                                   "-of", "json", str(path)], check=True, capture_output=True).stdout
        self.assertEqual(packets(self.source), packets(op["destination"]), "timecode packet contents are retained")
        self.assertEqual(self.source.read_bytes(), self.original)
        return op

    def test_mp4_timecode_survives_a_lower_bitrate_hevc_encode(self):
        self.add_timecode()
        self.set_rules([rule(action="reencode", codec="hevc")])
        op = self.assert_timecode_output(".mp4")
        self.assertEqual(op["outputMedia"]["codec"], "hevc")
        self.assertLess(op["outputMedia"]["bitrate"], op["media"]["bitrate"])

    def test_m4v_timecode_survives_resize(self):
        self.add_timecode(".m4v")
        self.assert_timecode_output(".m4v")

    def test_mov_timecode_is_copied_during_resize(self):
        self.add_timecode(".mov")
        self.assert_timecode_output(".mov")

    def test_changed_output_timecode_is_rejected_before_publication(self):
        self.add_timecode()
        original_probe = compactor.probe
        def probe(executable, path, stop=lambda: None):
            media = original_probe(executable, path, stop)
            if str(path).endswith(".tmp"):
                compactor.timecode_streams(media)[0]["tags"]["timecode"] = "02:00:00:00"
            return media
        with patch.object(compactor, "probe", side_effect=probe):
            run = self.start()
        op = run["operations"][0]
        self.assertEqual(op["status"], "failed")
        self.assertIn("preservation failed validation", op["reason"])
        self.assertFalse(Path(op["destination"]).exists())
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_same_as_source_converts_without_requiring_a_smaller_file(self):
        # The fixture is a tiny, very high quality H.264 file; an H.265 conversion
        # at the same bitrate is not guaranteed to be smaller, and that is allowed.
        self.set_rules([rule(action="reencode", quality="source", codec="hevc")])
        run = self.start()
        op = run["operations"][0]
        self.assertAlmostEqual(op["mbps"] * 1e6, op["media"]["bitrate"], delta=1000)
        self.assertEqual(run["status"], "reconciling")
        self.assertEqual(op["outputMedia"]["codec"], "hevc")
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_quality_presets_encode_with_constant_quality_capped_at_the_source(self):
        self.set_rules([rule(action="reencode", quality="balanced")])
        commands = []
        process = compactor.run_process
        def invoke(command, *args):
            commands.append(command)
            return process(command, *args)
        with patch.object(compactor, "run_process", side_effect=invoke):
            run = self.start()
        op = run["operations"][0]
        self.assertEqual(op["crf"], 22)
        encode = next(command for command in commands if "-c:v:0" in command)
        self.assertEqual(encode[encode.index("-crf:v:0") + 1], "22")
        self.assertEqual(int(encode[encode.index("-maxrate:v:0") + 1]), int(op["media"]["bitrate"]))
        self.assertNotIn("-b:v:0", encode)
        self.assertEqual(run["status"], "reconciling")
        self.assertLess(op["outputSize"], op["identity"]["size"])

    def test_latest_preview_reopens_until_used_discarded_or_stale(self):
        latest = lambda: compactor.dispatch(self.client, {"mode": "latestPreview"})
        self.assertIsNone(latest())
        preview = self.preview()
        self.assertEqual(latest(), {"id": preview["id"]})
        compactor.dispatch(self.client, {"mode": "discardPreview", "id": preview["id"]})
        self.assertIsNone(latest(), "discarded")
        preview = self.preview()
        self.set_rules([rule(mbps=.3)])
        self.assertIsNone(latest(), "rules changed since")
        self.set_rules([rule()])
        preview = self.preview()
        compactor.start_run(self.client, compactor.get("preview", preview["id"]), {"reviewOutputs": True})
        self.assertIsNone(latest(), "already run")

    def test_orphaned_preview_is_reported_as_failed(self):
        preview = {"id": "orphan", "status": "planning", "settings": compactor.settings(), "automatic": False}
        compactor.save("preview", preview)
        live = {"jobQueue": [{"id": "1", "status": "RUNNING", "description": "Running plugin task: DirtyTasks: encoding: calculate preview"}]}
        with patch.object(self.client, "call", return_value=live):
            self.assertTrue(compactor.tasks_active(self.client), "Stash prefixes task descriptions")
            self.assertEqual(compactor.dispatch(self.client, {"mode": "getPreview", "id": "orphan"})["status"], "planning")
        record = compactor.dispatch(self.client, {"mode": "getPreview", "id": "orphan"})
        self.assertEqual(record["status"], "failed")
        self.assertIn("stopped before finishing", record["error"])

    def test_preview_eta_follows_the_pace_so_far(self):
        self.assertEqual(compactor.eta({"progress": 0.25, "started": 1000}, now=1600), 1800, "10 min for 25% leaves 30 min")
        self.assertEqual(compactor.eta({"progress": 0.0125, "started": 1000}, now=1060), 4740, "one visual-quality test in")
        self.assertIsNone(compactor.eta({"progress": 0.001, "started": 1000}, now=1600), "too early to tell")
        self.assertIsNone(compactor.eta({"progress": 0.5, "started": 1000}, now=1020), "too soon")
        self.assertIsNone(compactor.eta({"progress": 0.5}, now=1600), "progress from an older version")
        compactor.report("eta-test", "Checking files", 0.1)
        started = compactor.records.get("progress", "eta-test")["started"]
        compactor.report("eta-test", "Checking files", 0.2)
        self.assertEqual(compactor.records.get("progress", "eta-test")["started"], started, "start time is kept")

    def test_cancel_stops_a_running_quality_sample_immediately(self):
        started = time.monotonic()
        checks = []

        def stop():
            checks.append(1)
            if len(checks) >= 2:
                raise compactor.Cancelled("cancel test")
        command = [sys.executable, "-c", "import time; time.sleep(30)"]
        with self.assertRaises(compactor.Cancelled):
            compactor.quality._run(command, stop)
        self.assertLess(time.monotonic() - started, 10, "the sample process is killed, not waited for")

    def test_preview_can_be_cancelled(self):
        preview = {"id": "cancel-me", "status": "queued", "settings": compactor.settings(), "automatic": False}
        compactor.save("preview", preview)
        compactor.dispatch(self.client, {"mode": "cancelPreview", "id": "cancel-me"})
        compactor.dispatch(self.client, {"mode": "plan", "id": "cancel-me"})
        self.assertEqual(compactor.get("preview", "cancel-me")["status"], "cancelled")

    def test_cancellation_inside_last_scene_packet_scan_cancels_preview(self):
        preview = {"id": "cancel-packets", "status": "queued", "settings": compactor.settings(), "automatic": False}
        compactor.save("preview", preview)
        def packets(executable, path, duration, stop):
            compactor.records.put("cancel", preview["id"], {"requested": True})
            stop()
            self.fail("The packet scan must observe cancellation")
        with patch.object(compactor, "plausible_bitrate", return_value=0), \
                patch.object(compactor, "container_video_bitrate", return_value=0), \
                patch.object(compactor, "packet_video_bitrate", side_effect=packets):
            compactor.dispatch(self.client, {"mode": "plan", "id": preview["id"]})
        self.assertEqual(compactor.get("preview", preview["id"])["status"], "cancelled")
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_preview_reports_progress_per_rule(self):
        stages = []
        with patch.object(compactor, "report", side_effect=lambda _id, stage, progress: stages.append((stage, progress))):
            self.preview()
        self.assertEqual(stages[-1], ("Checking files · scene 1 of 1", 0.0), "progress counts completed scenes")
        self.set_rules([rule(), dict(rule(), id="rule-2", name="Second")])
        stages.clear()
        with patch.object(compactor, "report", side_effect=lambda _id, stage, progress: stages.append((stage, progress))):
            self.preview()
        self.assertEqual(stages[-1], ("Checking files · Rule 2 of 2 · scene 1 of 1", 0.5), "one overall percentage across rules")

    def test_outputs_that_could_not_shrink_are_skipped_next_time(self):
        self.set_rules([rule(action="reencode", quality="balanced")])
        first = self.preview()["operations"][0]
        compactor.records.put("completed", compactor.completed_key(first),
                                        {"hash": "", "quickHash": first["quickHash"], "actionKey": first["actionKey"], "notSmaller": True})
        op = self.preview()["operations"][0]
        self.assertEqual((op["status"], op["reason"]), ("unchanged", "Would not get smaller with these settings"))

    def test_preview_uses_quick_fingerprints_and_runs_take_the_full_hash(self):
        self.set_rules([rule(action="reencode", quality="balanced")])
        with patch.object(compactor, "file_hash", side_effect=AssertionError("Preview must not read whole files")):
            op = self.preview()["operations"][0]
        self.assertEqual(op["quickHash"], compactor.quick_hash(self.source))
        self.assertNotIn("sourceHash", op)
        run = self.start()
        self.assertEqual(run["operations"][0]["sourceHash"], compactor.file_hash(self.source), "full hash taken when the run starts")

    def test_source_changed_between_preview_and_run_is_not_replaced(self):
        self.set_rules([rule(action="reencode", quality="balanced")])
        preview = self.preview()
        # Same size, same modification time, different content at the start.
        info = self.source.stat()
        data = bytearray(self.source.read_bytes())
        data[100] ^= 0xFF
        self.source.write_bytes(data)
        os.utime(self.source, ns=(info.st_atime_ns, info.st_mtime_ns))
        self.assertEqual(compactor.identity(self.source), preview["operations"][0]["identity"], "identity alone would miss this")
        result = compactor.start_run(self.client, preview, {"reviewOutputs": True})
        run = compactor.worker(self.client, result["id"])
        op = run["operations"][0]
        self.assertEqual(op["status"], "failed")
        self.assertIn("Original changed since preview", op["reason"])
        self.assertEqual(self.source.read_bytes(), bytes(data), "the changed file is left alone")

    @unittest.skipUnless(shutil.which("ffmpeg") and "libvmaf" in subprocess.run([shutil.which("ffmpeg") or "ffmpeg", "-hide_banner", "-filters"],
                         capture_output=True, text=True).stdout, "FFmpeg with libvmaf required")
    def test_visual_quality_is_measured_during_the_run(self):
        self.set_rules([rule(action="reencode", quality="visual", vmaf=93)])
        with patch.object(compactor.quality, "search", side_effect=AssertionError("Preview must not measure")):
            planned = self.preview()["operations"][0]
        self.assertEqual(planned["status"], "ready")
        self.assertNotIn("crf", planned)
        run = self.start()
        op = run["operations"][0]
        self.assertIn(op["crf"], range(compactor.quality.CRF_RANGE["h264"][0], compactor.quality.CRF_RANGE["h264"][1] + 1))
        self.assertGreaterEqual(op["vmaf"], 93)
        self.assertEqual(run["status"], "reconciling")
        self.assertFalse(list((self.folder / "private").glob("quality-*")), "sample clips are removed")
        # A stricter target never picks a higher (lower quality) value.
        media = op["media"]
        stricter = compactor.quality.search(shutil.which("ffmpeg"), self.source, media, op["dimensions"], "h264", "libx264", 97,
                                            self.folder / "private" / "strict")
        self.assertLessEqual(stricter["crf"], op["crf"])

    def test_measured_quality_is_reused_by_later_previews(self):
        self.set_rules([rule(action="reencode", quality="visual", vmaf=95)])
        choice = {"crf": 23, "vmaf": 95.4, "mbps": 0.4, "reached": True}
        with patch.object(compactor, "pick_encoder", return_value="cpu"), \
                patch.object(compactor.quality, "search", return_value=choice) as search:
            run = self.start()
            self.assertEqual(run["operations"][0]["crf"], 23)
            later = self.preview()["operations"][0]
        self.assertEqual(search.call_count, 1, "measured once, during the run")
        self.assertEqual((later["crf"], later["vmaf"]), (23, 95.4), "the next preview shows the measurement")

    def test_run_skips_files_that_would_not_shrink_at_the_visual_target(self):
        self.set_rules([rule(action="reencode", quality="visual", vmaf=97)])
        choice = {"crf": 16, "vmaf": 97.2, "mbps": 1000, "reached": True}
        with patch.object(compactor, "pick_encoder", return_value="cpu"), \
                patch.object(compactor.quality, "search", return_value=choice):
            run = self.start()
            op = run["operations"][0]
            self.assertEqual((op["status"], op["reason"]), ("unchanged", "Would not get smaller at this visual quality"))
            self.assertEqual(run["status"], "completed")
            self.assertEqual(self.source.read_bytes(), self.original)
            skipped = self.preview()["operations"][0]
        self.assertEqual((skipped["status"], skipped["reason"]), ("unchanged", "Would not get smaller at this visual quality"))

    def test_target_above_original_keeps_the_original_bitrate(self):
        self.set_rules([rule(action="reencode", codec="hevc", quality="custom", mbps=1000)])
        op = self.preview()["operations"][0]
        self.assertEqual(op["status"], "ready", "a codec change still runs")
        self.assertTrue(op["convert"])
        self.assertAlmostEqual(op["mbps"] * 1e6, op["media"]["bitrate"], delta=1000)
        run = self.start()
        self.assertEqual(run["status"], "reconciling", "conversions at the original bitrate need not shrink")
        for changes in ({"action": "reencode", "codec": "h264"}, {"action": "resize"}):
            self.set_rules([rule(quality="custom", mbps=1000, **changes)])
            op = self.preview()["operations"][0]
            self.assertEqual((op["status"], op["reason"]), ("unchanged", "Already at or below target bitrate"))

    def test_same_as_source_skips_files_already_in_the_target_codec(self):
        self.set_rules([rule(action="reencode", quality="source", codec="h264")])
        preview = self.preview()
        self.assertEqual(preview["operations"][0]["status"], "unchanged")
        self.assertEqual(preview["operations"][0]["reason"], "Already uses H.264")

    def test_internal_scans_do_not_queue_automatic_work(self):
        from datetime import datetime, timezone
        self.set_rules([rule(mode="automatic")])
        compactor.storage.internal_scan_register("10")
        result = compactor.dispatch(self.client, {"mode": "startAutomaticRun", "jobId": "10", "startTime": datetime.now(timezone.utc).isoformat()})
        self.assertEqual(result, {"internal": True})
        self.assertEqual(self.client.jobs, [])

    def test_automatic_event_is_deduplicated_across_tabs(self):
        self.set_rules([rule(mode="automatic")])
        event = {"mode": "startAutomaticRun", "jobId": "10", "startTime": "2026-09-27T20:00:00Z"}
        compactor.dispatch(self.client, event)
        self.assertTrue(compactor.dispatch(self.client, event)["duplicate"])
        self.assertEqual(len(self.client.jobs), 1)

    def test_disk_full_retains_original(self):
        with patch.object(compactor.shutil, "disk_usage", return_value=shutil._ntuple_diskusage(100, 100, 0)):
            run = self.start()
        self.assertEqual(run["operations"][0]["status"], "failed")
        self.assertEqual(self.source.read_bytes(), self.original)


if __name__ == "__main__":
    unittest.main()
