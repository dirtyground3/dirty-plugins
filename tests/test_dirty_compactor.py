import copy
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("dirty_compactor_test", ROOT / "plugins/DirtyCompactor/dirty_compactor.py")
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
        with self.assertRaises(compactor.PluginError):
            compactor.validate_settings({"rules": [rule(quality="ultra")]})
        with self.assertRaises(compactor.PluginError):
            compactor.validate_settings({"rules": [rule(quality="custom", mbps="bad")]})

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
