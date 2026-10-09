from plugin_paths import runtime_path
import copy
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("dirty_compactor_test", runtime_path("DirtyCompactor", "dirty_compactor.py"))
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

    def scenes(self, condition=None, ids=None):
        return iter(copy.deepcopy([s for s in self.data if ids is None or s["id"] in ids]))

    def scene(self, scene_id):
        return copy.deepcopy(next((s for s in self.data if s["id"] == str(scene_id)), None))

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

    def delete(self, scene_id):
        for scene in self.data:
            if scene["id"] == scene_id:
                for file in scene["files"]:
                    Path(file["path"]).unlink()
        self.data = [s for s in self.data if s["id"] != scene_id]
        self.deleted.append(scene_id)

    def call(self, query, variables=None):
        if "jobQueue" in query:
            return {"jobQueue": []}
        raise AssertionError(query)


class CompactorRulesTests(unittest.TestCase):
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
        self.paths = patch.multiple(compactor, PREVIEWS=self.folder / "previews", PRIVATE=self.folder / "private")
        self.paths.start()
        self.client = FakeClient(self.source)
        self.set_rules([rule()])

    def tearDown(self):
        self.paths.stop()
        self.env.stop()
        self.temp.cleanup()

    def set_rules(self, rules):
        compactor.storage.set_plugin_settings(compactor.PLUGIN_ID, {"rules": rules, "automationPaused": False})

    def preview(self, automatic=False):
        value = {"id": "preview", "status": "planning", "settings": compactor.settings(), "automatic": automatic}
        compactor.save("preview", value)
        return compactor.build_preview(self.client, value)

    def start(self, review=True):
        result = compactor.start_run(self.client, self.preview(), {"reviewOutputs": review})
        return compactor.worker(self.client, result["id"])

    def test_review_leaves_original_unchanged_and_accepts_exact_output(self):
        run = self.start()
        self.assertEqual(run["status"], "awaitingReview")
        self.assertEqual(self.source.read_bytes(), self.original)
        op = run["operations"][0]
        expected = Path(op["output"]).read_bytes()
        self.assertLess(len(expected), len(self.original))
        args = {"mode": "acceptOutput", "id": run["id"], "operationId": op["id"]}
        compactor.dispatch(self.client, args)
        self.assertTrue(compactor.dispatch(self.client, args)["alreadyDecided"])
        with patch.object(compactor, "encode", side_effect=AssertionError("must not encode twice")):
            result = compactor.worker(self.client, run["id"], accept=True)
        self.assertEqual(result["status"], "reconciling")
        self.assertEqual(self.source.read_bytes(), expected)
        self.assertTrue(Path(op.get("backup", result["operations"][0]["backup"])).exists())
        compactor.finalize(self.client, run["id"])
        final = compactor.worker(self.client, run["id"])
        self.assertEqual(final["status"], "completed")
        self.assertEqual(final["operations"][0]["actualSavings"], len(self.original) - len(expected))
        self.assertFalse(Path(op["output"]).exists())

    def test_discard_removes_output_only(self):
        run = self.start()
        op = run["operations"][0]
        compactor.dispatch(self.client, {"mode": "discardOutput", "id": run["id"], "operationId": op["id"]})
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertFalse(Path(op["output"]).exists())
        self.assertEqual(compactor.worker(self.client, run["id"])["status"], "completed")

    def test_cancel_pending_review_keeps_original(self):
        run = self.start()
        compactor.dispatch(self.client, {"mode": "cancelRun", "id": run["id"]})
        self.assertEqual(compactor.worker(self.client, run["id"])["status"], "cancelled")
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_source_changed_during_review_is_not_replaced(self):
        run = self.start()
        self.source.write_bytes(self.original + b"changed")
        compactor.dispatch(self.client, {"mode": "acceptOutput", "id": run["id"], "operationId": run["operations"][0]["id"]})
        result = compactor.worker(self.client, run["id"], accept=True)
        self.assertEqual(result["status"], "awaitingReview")
        self.assertIn("changed", result["operations"][0]["reason"])
        self.assertEqual(self.source.read_bytes(), self.original + b"changed")

    def test_tampered_output_is_not_installed(self):
        run = self.start()
        op = run["operations"][0]
        Path(op["output"]).write_bytes(b"changed")
        compactor.dispatch(self.client, {"mode": "acceptOutput", "id": run["id"], "operationId": op["id"]})
        result = compactor.worker(self.client, run["id"], accept=True)
        self.assertEqual(result["status"], "awaitingReview")
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_earlier_manual_rule_protects_from_automatic_delete(self):
        self.set_rules([rule(), rule(id="delete", mode="automatic", action="delete")])
        preview = self.preview(automatic=True)
        self.assertEqual([o["status"] for o in preview["operations"]], ["manual"])
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_all_files_are_planned_and_shared_files_blocked(self):
        second = self.folder / "second.mp4"
        shutil.copyfile(self.source, second)
        self.client.data[0]["files"].append({"id": "8", "path": str(second)})
        self.assertEqual(len(self.preview()["operations"]), 2)
        self.client.data.append({"id": "2", "title": "Shared", "files": [{"id": "7", "path": str(self.source)}]})
        self.assertTrue(all(o["status"] == "blocked" for o in self.preview()["operations"]))

    def test_restore_after_reconciliation_failure(self):
        run = self.start(review=False)
        op = run["operations"][0]
        self.client.data[0]["files"][0]["size"] = 0
        self.assertEqual(compactor.finalize(self.client, run["id"])["status"], "recovery")
        compactor.recover(self.client, compactor.get("run", run["id"]), restore=True)
        compactor.finalize(self.client, run["id"])
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_delete_runs_once_and_removes_scene_and_files(self):
        self.set_rules([rule(action="delete")])
        run = self.start()
        self.assertEqual(run["status"], "completed")
        self.assertFalse(self.source.exists())
        compactor.worker(self.client, run["id"])
        self.assertEqual(self.client.deleted, ["1"])
        self.assertEqual(compactor.public_record(run)["libraryBytesRemoved"], len(self.original))

    def test_delete_scene_without_files(self):
        self.client.data[0]["files"] = []
        self.set_rules([rule(action="delete")])
        run = self.start()
        self.assertEqual(run["status"], "completed")
        self.assertEqual(self.client.deleted, ["1"])
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_recovery_after_original_restored_before_scan(self):
        run = self.start(review=False)
        op = run["operations"][0]
        os.replace(op["backup"], op["source"])
        op["status"] = "restoring"
        run["status"] = "recovery"
        compactor.save("run", run)
        compactor.recover(self.client, compactor.get("run", run["id"]))
        compactor.finalize(self.client, run["id"])
        final = compactor.worker(self.client, run["id"])
        self.assertEqual(final["operations"][0]["status"], "restored")
        self.assertEqual(self.source.read_bytes(), self.original)

    def test_recovery_preserves_interrupted_restore_intent(self):
        run = self.start(review=False)
        op = run["operations"][0]
        op["status"] = "restoring"
        run["status"] = "recovery"
        compactor.save("run", run)
        compactor.recover(self.client, compactor.get("run", run["id"]))
        compactor.finalize(self.client, run["id"])
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertEqual(compactor.get("run", run["id"])["operations"][0]["status"], "restored")

    def test_recovery_cleans_interrupted_partial_encode(self):
        result = compactor.start_run(self.client, self.preview(), {"reviewOutputs": True})
        run = compactor.get("run", result["id"])
        op = run["operations"][0]
        partial = self.folder / (op["id"] + ".mp4")
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

    def test_rule_change_during_review_requires_new_preview(self):
        run = self.start()
        self.set_rules([rule(mbps=.3)])
        compactor.dispatch(self.client, {"mode": "acceptOutput", "id": run["id"], "operationId": run["operations"][0]["id"]})
        result = compactor.worker(self.client, run["id"], accept=True)
        self.assertEqual(result["status"], "awaitingReview")
        self.assertIn("Rules changed", result["operations"][0]["reason"])
        self.assertEqual(self.source.read_bytes(), self.original)

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

    def test_reencode_preserves_dimensions_and_reduces_bitrate(self):
        self.set_rules([rule(action="reencode")])
        run = self.start()
        self.assertEqual(run["status"], "awaitingReview")
        media = run["operations"][0]["outputMedia"]
        self.assertEqual((media["width"], media["height"]), (640, 360))
        self.assertLess(media["bitrate"], run["operations"][0]["media"]["bitrate"])

    def test_same_as_source_converts_without_requiring_a_smaller_file(self):
        # The fixture is a tiny, very high quality H.264 file; an H.265 conversion
        # at the same bitrate is not guaranteed to be smaller, and that is allowed.
        self.set_rules([rule(action="reencode", quality="source", codec="hevc")])
        run = self.start()
        op = run["operations"][0]
        self.assertAlmostEqual(op["mbps"] * 1e6, op["media"]["bitrate"], delta=1000)
        self.assertEqual(run["status"], "awaitingReview")
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
        self.assertEqual(run["status"], "awaitingReview")
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
        live = {"jobQueue": [{"id": "1", "status": "RUNNING", "description": "Running plugin task: DirtyCompactor: calculate preview"}]}
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
        started = compactor.storage.compactor_get("progress", "eta-test")["started"]
        compactor.report("eta-test", "Checking files", 0.2)
        self.assertEqual(compactor.storage.compactor_get("progress", "eta-test")["started"], started, "start time is kept")

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
        compactor.storage.compactor_put("completed", compactor.digest([first["fileId"], first["rule"]["id"]]),
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
        self.assertEqual(run["status"], "awaitingReview")
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
        self.assertEqual(run["status"], "awaitingReview", "conversions at the original bitrate need not shrink")
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
