import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest import mock

ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("caption_index_entry_tests", ROOT / "plugins/DirtyCaptions/dirty_captions.py")
entry = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(entry)
index = entry.caption_index
storage = index.storage


class Client:
    def __init__(self, scenes):
        self.scenes = {str(scene["id"]): copy.deepcopy(scene) for scene in scenes}
        self.queued = []
        self.writes = []

    def call(self, query, variables=None):
        variables = variables or {}
        if "sceneUpdate" in query:
            value = variables["input"]
            self.writes.append(copy.deepcopy(value))
            scene = self.scenes[value["id"]]
            fields = scene.setdefault("custom_fields", {})
            fields.update(value["custom_fields"]["partial"])
            for key in value["custom_fields"]["remove"]:
                fields.pop(key, None)
            # Mirror Stash: our own mutation would invoke the post hook.
            index.hook(self, {"type": "Scene.Update.Post", "id": value["id"], "input": value, "inputFields": list(value)})
            return {"sceneUpdate": {"id": scene["id"]}}
        if "findScenes" in query:
            cursor = variables["scene"]["id"]["value"]
            scenes = sorted((scene for scene in self.scenes.values() if int(scene["id"]) > cursor), key=lambda scene: int(scene["id"]))
            return {"findScenes": {"count": len(scenes), "scenes": copy.deepcopy(scenes[:100])}}
        if "findScene" in query:
            return {"findScene": copy.deepcopy(self.scenes.get(variables["id"]))}
        if "configuration" in query:
            return {"configuration": {"general": {"ffprobePath": "probe"}}}
        if "jobQueue" in query:
            return {"jobQueue": [{"id": str(number + 1), "status": "READY"} for number in range(len(self.queued))]}
        raise AssertionError(query)

    def queue(self, plugin_id, args, description):
        self.queued.append(copy.deepcopy(args))
        return str(len(self.queued))


class CaptionIndexTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        self.environment = mock.patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(self.root / "shared.sqlite3")})
        self.environment.start()
        self.probe = mock.patch.object(index, "probe_subtitles", return_value=[]).start()
        self.addCleanup(mock.patch.stopall)
        self.addCleanup(self.folder.cleanup)

    def scene(self, scene_id, files=1):
        entries = []
        for number in range(files):
            path = self.root / (str(scene_id) + "-" + str(number) + ".mp4")
            path.write_bytes(b"fixture")
            file = {"id": str(scene_id * 10 + number), "path": str(path)}
            self.file_metadata(file)
            entries.append(file)
        return {"id": str(scene_id), "files": entries, "custom_fields": {"personal": "keep"}}

    def file_metadata(self, file):
        """Mirror metadata Stash stores after scanning a fixture file."""
        path = Path(file["path"])
        stat = path.stat()
        seconds, nanos = divmod(stat.st_mtime_ns, 1000000000)
        file.update(size=stat.st_size, mod_time=datetime.fromtimestamp(seconds, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
                    + ".{:09d}Z".format(nanos), fingerprints=[{"type": "md5", "value": hashlib.md5(path.read_bytes()).hexdigest()}])

    def execute(self, client):
        return index.worker(client, client.queued[-1]["token"])

    def test_initial_scan_indexes_every_file_and_preserves_other_fields(self):
        scene = self.scene(1, 2)
        client = Client([scene])
        self.probe.side_effect = [[], [{"index": 3, "codec_name": "mov_text"}]]
        index.bootstrap(client)
        result = self.execute(client)
        self.assertEqual(result["status"], "Finished")
        self.assertEqual(result["probed"], 2)
        fields = client.scenes["1"]["custom_fields"]
        self.assertEqual(fields[index.ANY_FIELD], "Yes")
        self.assertEqual(fields[index.TEXT_FIELD], "Yes")
        self.assertEqual(fields["personal"], "keep")
        self.assertEqual(len(client.queued), 1, "Own mutations must not enqueue recursive work")
        index.request_refresh(client)
        result = self.execute(client)
        self.assertEqual(self.probe.call_count, 2, "Unchanged files reuse fingerprints")
        self.assertEqual(result["checked"], 0)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(len(client.writes), 1, "Unchanged scene fields are not rewritten")

    def test_bitmap_and_absence_are_distinct(self):
        client = Client([self.scene(1), self.scene(2)])
        self.probe.side_effect = [[{"codec_name": "hdmv_pgs_subtitle"}], []]
        index.request_refresh(client)
        self.execute(client)
        bitmap, absent = [client.scenes[str(n)]["custom_fields"] for n in (1, 2)]
        self.assertEqual(bitmap[index.ANY_FIELD], "Yes")
        self.assertEqual(bitmap[index.TEXT_FIELD], "No")
        self.assertEqual(absent[index.ANY_FIELD], "No")

    def test_unchanged_scan_uses_saved_map_without_stat_probe_or_scene_queries(self):
        client = Client([self.scene(1), self.scene(2)])
        index.request_refresh(client)
        self.execute(client)
        storage.set_plugin_settings("dirtyCaptions", {"refreshAfterScan": True})
        with mock.patch.object(index, "fingerprint", side_effect=AssertionError("Media was accessed")) as stat, \
             mock.patch.object(index, "tool_path", side_effect=AssertionError("Probe was configured")) as tool, \
             mock.patch.object(client, "call", wraps=client.call) as call:
            index.after_scan(client, {"jobId": "20", "startTime": "2026-10-02T08:00:00Z"})
            result = self.execute(client)
        stat.assert_not_called()
        tool.assert_not_called()
        self.assertFalse(any("findScene(" in item.args[0] or "sceneUpdate" in item.args[0] for item in call.call_args_list))
        self.assertEqual((result["checked"], result["probed"], result["skipped"]), (0, 0, 2))
        self.assertEqual(self.probe.call_count, 2)

    def test_new_scene_only_probes_new_file_and_retains_map_across_workers(self):
        client = Client([self.scene(1)])
        index.request_refresh(client)
        self.execute(client)
        client.scenes["2"] = self.scene(2)
        previous = index.fingerprint
        def check(path):
            self.assertEqual(Path(path), Path(client.scenes["2"]["files"][0]["path"]), "Known media must not be accessed")
            return previous(path)
        with mock.patch.object(index, "fingerprint", side_effect=check):
            index.request_refresh(client)
            result = self.execute(client)
        self.assertEqual((result["checked"], result["probed"], result["skipped"]), (1, 1, 1))
        self.assertEqual(self.probe.call_count, 2)
        self.assertEqual(len(storage.list_metadata(index.FILES)), 2)

    def test_attaching_known_file_repairs_scene_without_media_access(self):
        client = Client([self.scene(1), self.scene(2)])
        self.probe.side_effect = [[{"codec_name": "mov_text"}], []]
        index.request_refresh(client)
        self.execute(client)
        client.scenes["2"]["files"].append(copy.deepcopy(client.scenes["1"]["files"][0]))
        with mock.patch.object(index, "fingerprint") as stat:
            index.request_refresh(client)
            result = self.execute(client)
        stat.assert_not_called()
        self.assertEqual((result["checked"], result["probed"], result["skipped"]), (1, 0, 1))
        self.assertEqual(client.scenes["2"]["custom_fields"][index.ANY_FIELD], "Yes")

    def test_renames_and_added_phash_do_not_probe_known_content(self):
        client = Client([self.scene(1)])
        index.request_refresh(client)
        self.execute(client)
        file = client.scenes["1"]["files"][0]
        file["path"] = str(self.root / "renamed.mp4")
        file["fingerprints"].append({"type": "phash", "value": "new generated hash"})
        with mock.patch.object(index, "fingerprint") as stat:
            index.request_refresh(client)
            result = self.execute(client)
        stat.assert_not_called()
        self.assertEqual((result["checked"], result["probed"], result["skipped"]), (0, 0, 1))

    def test_content_hash_detects_replacement_with_same_size_and_mtime(self):
        client = Client([self.scene(1)])
        index.request_refresh(client)
        self.execute(client)
        file = client.scenes["1"]["files"][0]
        before = Path(file["path"]).stat()
        Path(file["path"]).write_bytes(b"newfile")
        os.utime(file["path"], ns=(before.st_atime_ns, before.st_mtime_ns))
        self.file_metadata(file)
        self.probe.return_value = [{"codec_name": "subrip"}]
        index.request_refresh(client)
        result = self.execute(client)
        self.assertEqual(result["probed"], 1)
        self.assertEqual(client.scenes["1"]["custom_fields"][index.ANY_FIELD], "Yes")

    def test_legacy_map_upgrades_from_stored_metadata_without_media_access(self):
        client = Client([self.scene(1)])
        index.request_refresh(client)
        self.execute(client)
        record = index.read_record(index.FILES, "10")
        record.pop("stash")
        storage.set_metadata(index.FILES, "10", json.dumps(record))
        snapshot = index.read_record(index.SCENES, "1")
        snapshot.pop("files")
        storage.set_metadata(index.SCENES, "1", json.dumps(snapshot))
        with mock.patch.object(index, "fingerprint") as stat:
            index.request_refresh(client)
            result = self.execute(client)
        stat.assert_not_called()
        self.assertEqual(result["skipped"], 1)
        self.assertIn("stash", index.read_record(index.FILES, "10"))
        self.assertEqual(index.read_record(index.SCENES, "1")["files"], ["10"])
        self.assertEqual(index.timestamp_ns("2026-10-02T13:31:20.123456789+02:00"),
                         index.timestamp_ns("2026-10-02T11:31:20.123456789Z"))

    def test_failed_unchanged_file_is_skipped_until_forced_or_changed(self):
        client = Client([self.scene(1)])
        self.probe.side_effect = index.CaptionError("cannot read file")
        index.request_refresh(client)
        self.execute(client)
        self.probe.side_effect = None
        with mock.patch.object(index, "fingerprint") as stat:
            index.request_refresh(client)
            result = self.execute(client)
        stat.assert_not_called()
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(self.probe.call_count, 1)
        index.request_refresh(client, force=True)
        result = self.execute(client)
        self.assertEqual(result["probed"], 1)
        self.assertEqual(self.probe.call_count, 2)
        self.assertEqual(client.scenes["1"]["custom_fields"][index.STATUS_FIELD], "Ready")

    def test_force_probes_shared_file_once_even_with_pending_hooks(self):
        client = Client([self.scene(1), self.scene(2, 0)])
        client.scenes["2"]["files"] = copy.deepcopy(client.scenes["1"]["files"])
        index.request_refresh(client)
        self.execute(client)
        self.assertEqual(self.probe.call_count, 1)
        index.enqueue_scene(client, "1", start=False)
        index.request_refresh(client, force=True)
        result = self.execute(client)
        self.assertTrue(result["forceRun"])
        self.assertEqual(result["probed"], 1)
        self.assertEqual(self.probe.call_count, 2)

    def test_new_pending_scene_is_not_checked_again_during_discovery(self):
        client = Client([self.scene(1)])
        index.enqueue_scene(client, "1")
        index.request_refresh(client)
        result = self.execute(client)
        self.assertEqual((result["checked"], result["probed"], result["skipped"]), (1, 1, 1))

    def test_file_change_before_field_publication_invalidates_successful_probe(self):
        client = Client([self.scene(1)])
        original = client.call
        def replace_on_recheck(query, variables=None):
            if "findScene(" in query:
                Path(client.scenes["1"]["files"][0]["path"]).write_bytes(b"changed before publish")
            return original(query, variables)
        self.probe.return_value = [{"codec_name": "mov_text"}]
        with mock.patch.object(client, "call", side_effect=replace_on_recheck):
            result = index.inspect_scene(client, client.scenes["1"], "probe")
        self.assertTrue(result["error"])
        self.assertTrue(index.read_record(index.FILES, "10")["failed"])
        self.assertNotIn(index.ANY_FIELD, client.scenes["1"]["custom_fields"])

    def test_newly_available_hash_is_saved_without_probe_then_detects_change(self):
        client = Client([self.scene(1)])
        file = client.scenes["1"]["files"][0]
        file["fingerprints"] = []
        index.request_refresh(client)
        self.execute(client)
        file["fingerprints"] = [{"type": "oshash", "value": "original"}]
        with mock.patch.object(index, "fingerprint") as stat:
            index.request_refresh(client)
            self.execute(client)
        stat.assert_not_called()
        file["fingerprints"][0]["value"] = "replacement"
        index.request_refresh(client)
        result = self.execute(client)
        self.assertEqual(result["probed"], 1)

    def test_missing_file_clears_stale_negative_flags_and_stays_unverified(self):
        scene = self.scene(1, 2)
        scene["custom_fields"].update({index.ANY_FIELD: "No", index.TEXT_FIELD: "No"})
        Path(scene["files"][1]["path"]).unlink()
        client = Client([scene])
        result = index.inspect_scene(client, scene, "probe")
        self.assertTrue(result["error"])
        fields = client.scenes["1"]["custom_fields"]
        self.assertNotIn(index.ANY_FIELD, fields)
        self.assertNotIn(index.TEXT_FIELD, fields)
        self.assertEqual(fields[index.STATUS_FIELD], "Error")

    def test_positive_result_survives_an_unknown_second_file(self):
        scene = self.scene(1, 2)
        Path(scene["files"][1]["path"]).unlink()
        self.probe.return_value = [{"codec_name": "subrip"}]
        client = Client([scene])
        index.inspect_scene(client, scene, "probe")
        self.assertEqual(client.scenes["1"]["custom_fields"][index.ANY_FIELD], "Yes")
        self.assertEqual(client.scenes["1"]["custom_fields"][index.STATUS_FIELD], "Error")

    def test_hooks_deduplicate_workers_and_recheck_replaced_files(self):
        scene = self.scene(1)
        client = Client([scene])
        context = {"id": "1", "type": "Scene.Create.Post"}
        index.hook(client, context)
        index.hook(client, context)
        self.assertEqual(len(client.queued), 1)
        self.execute(client)
        Path(scene["files"][0]["path"]).write_bytes(b"changed fixture")
        self.file_metadata(client.scenes["1"]["files"][0])
        self.probe.return_value = [{"codec_name": "mov_text"}]
        index.hook(client, {"id": "1", "type": "Scene.Update.Post", "input": None})
        self.execute(client)
        self.assertEqual(self.probe.call_count, 2)
        self.assertEqual(client.scenes["1"]["custom_fields"][index.ANY_FIELD], "Yes")

    def test_scan_completion_detects_external_changes_without_periodic_checks(self):
        scene = self.scene(1)
        client = Client([scene])
        index.bootstrap(client)
        self.execute(client)
        storage.set_plugin_settings("dirtyCaptions", {"refreshAfterScan": True, "reconcileHours": 1})
        storage.update_json_metadata(index.NAMESPACE, "state", lambda state: dict(state, lastFullScan=1))
        Path(scene["files"][0]["path"]).write_bytes(b"external replacement")
        self.file_metadata(client.scenes["1"]["files"][0])
        index.bootstrap(client)
        self.assertEqual(len(client.queued), 1, "Elapsed time and legacy hour settings do not trigger checks")
        self.probe.return_value = [{"codec_name": "mov_text"}]
        event = {"mode": "indexAfterScan", "jobId": "1", "startTime": "2026-10-02T08:00:00Z"}
        index.run(client, event)
        self.execute(client)
        self.assertEqual(self.probe.call_count, 2)
        self.assertEqual(client.scenes["1"]["custom_fields"][index.ANY_FIELD], "Yes")
        index.run(client, event)
        self.assertEqual(len(client.queued), 2)
        index.run(client, dict(event, startTime="2026-10-03T08:00:00Z"))
        self.execute(client)
        self.assertEqual(len(client.queued), 3, "Job IDs reused after restart identify a new Scan")
        self.assertEqual(self.probe.call_count, 2, "Scan completion reuses unchanged file fingerprints")

    def test_scan_refresh_requires_opt_in_and_automatic_maintenance(self):
        client = Client([self.scene(1)])
        event = {"jobId": "1", "startTime": "2026-10-02T08:00:00Z"}
        self.assertEqual(index.after_scan(client, event)["skipped"], "disabled")
        for settings in ({"refreshAfterScan": False}, {"refreshAfterScan": "false"},
                         {"refreshAfterScan": True, "indexEnabled": False}):
            storage.set_plugin_settings("dirtyCaptions", settings)
            self.assertEqual(index.after_scan(client, event)["skipped"], "disabled")
        self.assertEqual(client.queued, [])
        storage.set_plugin_settings("dirtyCaptions", {"refreshAfterScan": True})
        index.after_scan(client, event)
        self.assertEqual(len(client.queued), 1, "Disabled events must not consume the Scan identity")

    def test_scan_events_from_multiple_tabs_request_only_one_pass(self):
        client = Client([self.scene(1)])
        storage.set_plugin_settings("dirtyCaptions", {"refreshAfterScan": True})
        event = {"jobId": "1", "startTime": "2026-10-02T08:00:00Z"}
        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(lambda unused: index.after_scan(client, event), range(12)))
        self.assertEqual(len(client.queued), 1)
        # Replay a completion while the same full check is already running.
        self.probe.side_effect = lambda *unused: (index.after_scan(client, event), [])[1]
        self.execute(client)
        self.assertEqual(len(client.queued), 1)
        self.assertEqual(len(client.writes), 1)
        self.assertEqual(index.status()["checked"], 1)

    def test_scan_completion_during_active_worker_requests_a_full_check(self):
        client = Client([self.scene(1), self.scene(2)])
        storage.set_plugin_settings("dirtyCaptions", {"refreshAfterScan": True})
        index.enqueue_scene(client, "1")
        index.after_scan(client, {"jobId": "2", "startTime": "2026-10-02T08:00:00Z"})
        self.execute(client)
        self.assertEqual(len(client.queued), 1)
        self.assertEqual(len(client.writes), 2)
        self.assertEqual(self.probe.call_count, 2)

    def test_internal_scan_and_paused_index_do_not_trigger_refresh(self):
        client = Client([self.scene(1)])
        storage.set_plugin_settings("dirtyCaptions", {"refreshAfterScan": True})
        event = {"jobId": "1", "startTime": "2026-10-02T08:00:00Z"}
        with mock.patch.object(storage, "internal_scan_check", return_value=True) as check:
            self.assertEqual(index.after_scan(client, event)["skipped"], "internal")
            check.assert_called_once_with("1", event["startTime"])
        index.run(client, {"mode": "indexCancel"})
        index.after_scan(client, event)
        self.assertEqual(client.queued, [])

    def test_replayed_scan_can_retry_queue_failure(self):
        client = Client([self.scene(1)])
        storage.set_plugin_settings("dirtyCaptions", {"refreshAfterScan": True})
        event = {"jobId": "1", "startTime": "2026-10-02T08:00:00Z"}
        with mock.patch.object(client, "queue", side_effect=RuntimeError("queue failed")):
            with self.assertRaisesRegex(RuntimeError, "queue failed"):
                index.after_scan(client, event)
        index.after_scan(client, event)
        self.execute(client)
        self.assertEqual(len(client.queued), 1)
        self.assertEqual(self.probe.call_count, 1)

    def test_scan_identity_requires_job_id_and_start_time(self):
        client = Client([self.scene(1)])
        storage.set_plugin_settings("dirtyCaptions", {"refreshAfterScan": True})
        for event in ({}, {"jobId": "1"}, {"jobId": "1", "startTime": 123},
                      {"jobId": "invalid", "startTime": "2026-10-02T08:00:00Z"}):
            with self.assertRaises(index.CaptionError):
                index.after_scan(client, event)
        self.assertEqual(client.queued, [])

    def test_disabled_maintenance_and_playback_only_updates_use_probe_metadata(self):
        scene = self.scene(1)
        client = Client([scene])
        storage.set_plugin_settings("dirtyCaptions", {"indexEnabled": False})
        index.bootstrap(client)
        index.hook(client, {"id": "1", "type": "Scene.Create.Post"})
        self.assertEqual(client.queued, [])
        storage.set_plugin_settings("dirtyCaptions", {"indexEnabled": True})
        index.record_playback(client, scene, scene["files"][0], [{"codec_name": "mov_text", "vtt": "PRIVATE DIALOGUE"}], index.file_identity(scene["files"][0]["path"]))
        self.execute(client)
        self.assertEqual(self.probe.call_count, 0)
        self.assertNotIn("PRIVATE DIALOGUE", storage.get_metadata(index.FILES, scene["files"][0]["id"]))
        self.assertEqual(client.scenes["1"]["custom_fields"][index.ANY_FIELD], "Yes")

    def test_force_reprobe_and_cancel_resume(self):
        client = Client([self.scene(1)])
        index.request_refresh(client)
        index.run(client, {"mode": "indexCancel"})
        self.execute(client)
        index.bootstrap(client)
        self.assertEqual(self.probe.call_count, 0)
        self.assertEqual(len(client.queued), 1)
        self.assertIsNone(index.read_record(index.NAMESPACE, "state").get("token"))
        index.request_refresh(client)
        self.execute(client)
        index.request_refresh(client, force=True)
        self.execute(client)
        self.assertEqual(self.probe.call_count, 2)

    def test_failed_probe_never_becomes_no_captions(self):
        scene = self.scene(1)
        self.probe.side_effect = index.CaptionError("probe failed")
        client = Client([scene])
        index.inspect_scene(client, scene, "probe")
        self.assertNotIn(index.ANY_FIELD, client.scenes["1"]["custom_fields"])

    def test_destroy_and_playback_updates_do_not_schedule_work(self):
        client = Client([self.scene(1)])
        storage.set_metadata(index.SCENES, "1", "{}")
        index.hook(client, {"id": "1", "type": "Scene.Update.Post", "inputFields": ["id", "resume_time"]})
        index.hook(client, {"id": "1", "type": "Scene.Destroy.Post"})
        self.assertFalse(storage.list_metadata(index.SCENES))
        self.assertEqual(client.queued, [])

    def test_revision_delete_preserves_new_work(self):
        storage.set_metadata(index.PENDING, "1", "old")
        storage.set_metadata(index.PENDING, "1", "new")
        self.assertFalse(storage.delete_metadata(index.PENDING, "1", expected="old"))
        self.assertEqual(storage.get_metadata(index.PENDING, "1"), "new")

    def test_changed_file_during_probe_is_not_cached(self):
        scene = self.scene(1)
        def replace(*args):
            Path(scene["files"][0]["path"]).write_bytes(b"replacement")
            return [{"codec_name": "mov_text"}]
        self.probe.side_effect = replace
        client = Client([scene])
        index.inspect_scene(client, scene, "probe")
        record = index.read_record(index.FILES, scene["files"][0]["id"])
        self.assertTrue(record["failed"])
        self.assertNotIn("any", record, "Unstable probe results must not enter the map")
        self.assertNotIn(index.ANY_FIELD, client.scenes["1"]["custom_fields"])

    def test_concurrent_hooks_claim_only_one_worker(self):
        client = Client([self.scene(1)])
        storage.set_metadata(index.NAMESPACE, "state", "{}")
        with ThreadPoolExecutor(max_workers=6) as pool:
            list(pool.map(lambda unused: index.enqueue_scene(client, "1"), range(12)))
        self.assertEqual(len(client.queued), 1)
        self.execute(client)
        self.assertEqual(self.probe.call_count, 1)

    def test_queue_failure_releases_lease_without_losing_work(self):
        client = Client([self.scene(1)])
        with mock.patch.object(client, "queue", side_effect=RuntimeError("queue failed")):
            with self.assertRaisesRegex(RuntimeError, "queue failed"):
                index.enqueue_scene(client, "1")
        self.assertIsNone(index.read_record(index.NAMESPACE, "state").get("token"))
        self.assertIn("1", storage.list_metadata(index.PENDING))
        index.schedule(client)
        self.execute(client)
        self.assertEqual(client.scenes["1"]["custom_fields"][index.ANY_FIELD], "No")

    def test_interrupted_stash_job_is_recovered_before_lease_expires(self):
        client = Client([self.scene(1)])
        index.request_refresh(client)
        old_token = client.queued[-1]["token"]
        storage.update_json_metadata(index.NAMESPACE, "state", lambda state: dict(state, queued=time.time() - 60))
        with mock.patch.object(client, "call", wraps=client.call) as call:
            call.side_effect = lambda query, variables=None: {"jobQueue": []} if "jobQueue" in query else Client.call(client, query, variables)
            index.bootstrap(client)
        self.assertNotEqual(client.queued[-1]["token"], old_token)
        self.execute(client)
        self.assertEqual(index.status()["status"], "Finished")

    def test_full_scan_paginates_without_skipping_updated_scenes(self):
        client = Client([self.scene(number) for number in range(1, 103)])
        index.request_refresh(client)
        result = self.execute(client)
        self.assertEqual(result["checked"], 102)
        self.assertEqual(len(client.writes), 102)
        self.assertEqual(self.probe.call_count, 102)

    def test_cancellation_during_scan_and_manual_resume_reuse_completed_files(self):
        client = Client([self.scene(1), self.scene(2)])
        def cancel(*args):
            index.run(client, {"mode": "indexCancel"})
            return []
        self.probe.side_effect = cancel
        index.request_refresh(client)
        result = self.execute(client)
        self.assertEqual(result["status"], "Cancelled")
        self.assertEqual(len(client.writes), 0)
        self.probe.side_effect = None
        index.request_refresh(client)
        result = self.execute(client)
        self.assertEqual(result["status"], "Finished")
        self.assertEqual(result["checked"], 2)
        self.assertEqual(self.probe.call_count, 2)

    def test_no_attached_files_are_unknown(self):
        scene = self.scene(1, 0)
        client = Client([scene])
        index.inspect_scene(client, scene, "probe")
        self.assertEqual(client.scenes["1"]["custom_fields"][index.STATUS_FIELD], "Unknown")
        self.assertNotIn(index.ANY_FIELD, client.scenes["1"]["custom_fields"])

    def test_atomic_metadata_callback_failure_rolls_back(self):
        storage.set_metadata(index.NAMESPACE, "test", '{"value":1}')
        def fail(state):
            state["value"] = 2
            raise RuntimeError("interrupted")
        with self.assertRaises(RuntimeError):
            storage.update_json_metadata(index.NAMESPACE, "test", fail)
        self.assertEqual(index.read_record(index.NAMESPACE, "test"), {"value": 1})


if __name__ == "__main__":
    unittest.main()
