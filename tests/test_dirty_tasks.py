"""DirtyTasks migration, section isolation, and additive encoding behavior."""
import copy
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor

from plugin_paths import runtime_path
import sys
sys.path.insert(0, str(runtime_path("DirtyTasks")))
import dirty_tasks as tasks
import test_dirty_compactor as encoding_tests

storage = tasks.settings.storage
encoding = tasks.encoding


def triggers(mode="manual", rule_ids=("rule-1",)):
    return {"move": mode, "rename": mode, "tags": mode, "encoding": {key: mode for key in rule_ids}}



class TaskSettingsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        environment = patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(self.folder / "shared.sqlite3")})
        environment.start()
        self.addCleanup(environment.stop)

    def test_migration_preserves_settings_retires_delete_and_is_idempotent(self):
        organization = tasks.organization.normalize_settings({"renameEnabled": True})
        organization["approvedStrategyHash"] = tasks.organization.strategy_hash(organization)
        organization["approvedPlanDigest"] = "old-preview"
        storage.set_plugin_settings("dirtyTidy", organization)
        storage.set_plugin_settings("dirtyCompactor", {"rules": [encoding_tests.rule(), encoding_tests.rule(id="delete", action="delete")], "automationPaused": False})
        tasks.settings.migrate()
        saved = storage.get_plugin_settings("dirtyTasks")
        self.assertEqual(saved["organization"]["approvedStrategyHash"], "", "multi-file naming changes require a new approval")
        self.assertEqual(saved["organization"]["approvedPlanDigest"], "")
        self.assertEqual(len(saved["encoding"]["rules"]), 1)
        self.assertNotIn("automationPaused", saved["encoding"])
        self.assertEqual(saved["execution"], triggers())
        summary = json.loads(storage.get_metadata(tasks.settings.NAMESPACE, "migrated"))
        self.assertEqual(summary["removedDeleteRules"], 1)
        execution = tasks.settings.snapshot("execution")
        tasks.settings.save_section("execution", triggers("generate"), execution["revision"])
        tasks.settings.migrate()
        self.assertFalse(tasks.settings.get_section("encoding")["automationPaused"])
        self.assertEqual(storage.get_plugin_settings("dirtyTidy"), organization, "old data remains available for recovery")

    def test_dismissed_import_summary_stays_hidden(self):
        storage.set_plugin_settings("dirtyCompactor", {"rules": [encoding_tests.rule(id="delete", action="delete")]})
        tasks.settings.migrate()
        dismissed = tasks.settings.dismiss_migration_notice()
        tasks.settings.migrate()
        summary = json.loads(storage.get_metadata(tasks.settings.NAMESPACE, "migrated"))
        self.assertEqual(summary, dismissed)
        self.assertTrue(summary["dismissed"])
        self.assertEqual(summary["removedDeleteRules"], 1, "dismissal keeps the import summary")

    def test_shared_choice_migration_preserves_current_scan_approval_and_disabled_rules(self):
        organization = tasks.organization.normalize_settings({"automationMode": "scan", "tagUpdateEnabled": True})
        organization["approvedStrategyHash"] = tasks.organization.strategy_hash(organization)
        values = {"organization": organization, "encoding": {"rules": [encoding_tests.rule(enabled=False)], "automationPaused": True}, "execution": {"automationMode": "scan"}}
        storage.set_plugin_settings("dirtyTasks", values)
        storage.set_metadata(tasks.settings.NAMESPACE, "migrated", "{}")
        tasks.settings.migrate()
        current = storage.get_plugin_settings("dirtyTasks")
        self.assertEqual(current["execution"], triggers("scan"))
        self.assertEqual(current["organization"]["approvedStrategyHash"], organization["approvedStrategyHash"])
        self.assertNotIn("automationMode", current["organization"])
        self.assertNotIn("automationPaused", current["encoding"])
        self.assertNotIn("mode", current["encoding"]["rules"][0])
        self.assertFalse(current["encoding"]["rules"][0]["enabled"])
        self.assertTrue(tasks.settings.get_section("encoding")["automationPaused"])

    def test_triggers_are_the_only_persisted_schedule_and_stale_section_flags_cannot_change_it(self):
        tasks.settings.migrate()
        organization = tasks.settings.snapshot("organization")
        tasks.settings.save_section("organization", {"automationMode": "generate"}, organization["revision"])
        encoding_snapshot = tasks.settings.snapshot("encoding")
        tasks.settings.save_section("encoding", {"rules": [encoding_tests.rule()], "automationPaused": False}, encoding_snapshot["revision"])
        self.assertEqual(tasks.settings.get_section("organization")["automationMode"], "manual")
        self.assertTrue(tasks.settings.get_section("encoding")["automationPaused"])
        execution = tasks.settings.snapshot("execution")
        tasks.settings.save_section("execution", triggers("generate"), execution["revision"])
        self.assertEqual(tasks.settings.get_section("organization")["automationMode"], "generate")
        self.assertFalse(tasks.settings.get_section("encoding")["automationPaused"])
        with self.assertRaisesRegex(RuntimeError, "another session"):
            tasks.settings.save_section("execution", triggers("scan"), execution["revision"])
        with self.assertRaisesRegex(ValueError, "Choose"):
            tasks.settings.save_section("execution", triggers("invalid"), execution["revision"] + 1)

    def test_legacy_independent_triggers_are_imported_independently(self):
        storage.set_plugin_settings("dirtyTasks", {
            "organization": {"automationMode": "manual", "tagUpdateEnabled": True, "taggerEndpoint": "https://example.test/graphql"},
            "encoding": {"automationPaused": False, "rules": [encoding_tests.rule(mode="automatic")]},
        })
        tasks.settings.migrate_triggers()
        self.assertEqual(tasks.settings.get_section("execution"), {"move": "manual", "rename": "manual", "tags": "scan", "encoding": {"rule-1": "scan"}})

    def test_simultaneous_first_requests_all_observe_the_migrated_action_triggers(self):
        storage.set_plugin_settings("dirtyTidy", {"automationMode": "scan"})
        def load(_):
            tasks.settings.migrate()
            return tasks.settings.get_section("execution")["move"]
        with ThreadPoolExecutor(max_workers=8) as workers:
            self.assertEqual(list(workers.map(load, range(16))), ["scan"] * 16)

    def test_tags_and_organization_follow_generate_and_recheck_manual_before_queued_work(self):
        tasks.settings.migrate()
        organization = tasks.organization.normalize_settings({"tagUpdateEnabled": True, "taggerEndpoint": "https://example.test/graphql"})
        organization["approvedStrategyHash"] = tasks.organization.strategy_hash(organization)
        tasks.settings.save_section("organization", organization, tasks.settings.snapshot("organization")["revision"])
        tasks.settings.save_section("execution", triggers("generate"), tasks.settings.snapshot("execution")["revision"])
        client = unittest.mock.Mock()
        client.call.side_effect = [{"runPluginTask": "100"}, {"runPluginTask": "101"}]
        args = {"mode": "queueAutomation", "automationTrigger": "generate", "sourceJobId": "5", "sourceStartTime": "start"}
        with patch.object(tasks.organization, "StashClient", return_value=client):
            result = tasks.organization.run({"args": args})
        self.assertEqual(result["queuedJobIds"], ["100", "101"])
        self.assertEqual([call.args[1]["args"]["automationTrigger"] for call in client.call.call_args_list], ["generate", "generate"])
        tasks.settings.save_section("execution", triggers(), tasks.settings.snapshot("execution")["revision"])
        with patch.object(tasks.organization, "StashClient", return_value=client), patch.object(tasks.organization, "update_scene_tags") as update:
            skipped = tasks.organization.run({"args": {"mode": "updateTags", "automationTrigger": "generate"}})
            self.assertTrue(skipped["skipped"])
            update.assert_not_called()

    def test_scan_moves_and_generate_renames_using_the_same_approved_strategy(self):
        tasks.settings.migrate()
        source = self.folder / "original.mp4"
        source.write_bytes(b"preserve original")
        scene = {"id": "1", "title": "Renamed", "files": [{"id": "7", "path": str(source), "basename": source.name}]}
        class MovingClient:
            def library_snapshot(client, settings):
                return [str(self.folder)], [scene]
            def file_path(client, file_id):
                return scene["files"][0]["path"]
            def move_file(client, operation):
                target = Path(operation["destination_path"])
                target.parent.mkdir(parents=True, exist_ok=True)
                Path(operation["source_path"]).rename(target)
                scene["files"][0].update(path=str(target), basename=target.name)
                return True
        organization = tasks.organization.normalize_settings({"moveEnabled": True, "renameEnabled": True,
            "hierarchyLevels": ["Organized"], "renamePattern": "{title}"})
        organization["approvedStrategyHash"] = tasks.organization.strategy_hash(organization)
        tasks.settings.save_section("organization", organization, tasks.settings.snapshot("organization")["revision"])
        schedule = {**triggers(rule_ids=()), "move": "scan", "rename": "generate"}
        tasks.settings.save_section("execution", schedule, tasks.settings.snapshot("execution")["revision"])
        with patch.object(tasks.organization, "StashClient", return_value=MovingClient()):
            moved = tasks.organization.run({"args": {"mode": "automation", "automationTrigger": "scan"}})
            self.assertEqual(moved["completed"], 1)
            self.assertTrue((self.folder / "Organized" / "original.mp4").is_file())
            self.assertFalse((self.folder / "Organized" / "Renamed.mp4").exists())
            renamed = tasks.organization.run({"args": {"mode": "automation", "automationTrigger": "generate"}})
            self.assertEqual(renamed["completed"], 1)
            self.assertEqual((self.folder / "Organized" / "Renamed.mp4").read_bytes(), b"preserve original")
            self.assertEqual(moved["strategy_hash"], renamed["strategy_hash"])
            self.assertEqual(renamed["strategy_hash"], organization["approvedStrategyHash"])
        self.assertEqual(tasks.settings.get_section("execution"), schedule)

    def test_tags_can_run_after_generate_while_file_actions_are_manual(self):
        tasks.settings.migrate()
        tasks.settings.save_section("organization", {"tagUpdateEnabled": True, "taggerEndpoint": "https://example.test/graphql"}, tasks.settings.snapshot("organization")["revision"])
        tasks.settings.save_section("execution", {**triggers(rule_ids=()), "tags": "generate"}, tasks.settings.snapshot("execution")["revision"])
        client = unittest.mock.Mock()
        client.call.return_value = {"runPluginTask": "100"}
        args = {"mode": "queueAutomation", "sourceJobId": "7", "sourceStartTime": "start"}
        with patch.object(tasks.organization, "StashClient", return_value=client):
            self.assertNotIn("queuedJobId", tasks.organization.run({"args": {**args, "automationTrigger": "scan"}}))
            result = tasks.organization.run({"args": {**args, "automationTrigger": "generate"}})
        self.assertEqual(result["queuedJobIds"], ["100"])
        self.assertEqual(client.call.call_args.args[1]["args"]["mode"], "updateTags")

    def test_deferred_organization_preserves_both_job_kinds(self):
        client = unittest.mock.Mock()
        for kind in ("scan", "generate"):
            tasks.reservation.defer_organization({"task": "organization", "mode": "automation", "automationTrigger": kind})
        tasks.reservation.queue_pending(client)
        self.assertEqual([call.args[1]["automationTrigger"] for call in client.queue.call_args_list], ["scan", "generate"])
        tasks.reservation.queue_pending(client)
        self.assertEqual(client.queue.call_count, 2)

    def test_section_saves_do_not_overwrite_other_sections_and_reject_stale_writers(self):
        tasks.settings.migrate()
        organization = tasks.settings.snapshot("organization")
        encoding_snapshot = tasks.settings.snapshot("encoding")
        tasks.settings.save_section("encoding", {"rules": [encoding_tests.rule()], "automationPaused": True}, encoding_snapshot["revision"])
        draft = tasks.organization.normalize_settings({"renamePattern": "{title}"})
        tasks.settings.save_section("organization", draft, organization["revision"])
        self.assertEqual(len(tasks.settings.get_section("encoding")["rules"]), 1)
        with self.assertRaisesRegex(RuntimeError, "another session"):
            tasks.settings.save_section("organization", {**draft, "renamePattern": "stale"}, organization["revision"])
        self.assertEqual(tasks.settings.get_section("organization")["renamePattern"], "{title}")

    def test_delete_actions_are_rejected_even_when_disabled(self):
        with self.assertRaisesRegex(encoding.PluginError, "action"):
            tasks.settings.save_section("encoding", {"rules": [encoding_tests.rule(action="delete", enabled=False)]}, 0)

    def test_active_old_plugins_and_interrupted_replacement_block_migration(self):
        client = unittest.mock.Mock()
        client.call.return_value = {"plugins": [{"id": "dirtyCompactor", "enabled": True}]}
        with self.assertRaisesRegex(RuntimeError, "Disable"):
            tasks.settings.migrate(client)
        with storage.transaction() as connection:
            connection.execute("CREATE TABLE dirty_compactor_records(kind TEXT,id TEXT,value_json TEXT,revision INTEGER)")
            connection.execute("INSERT INTO dirty_compactor_records VALUES('run','old',?,0)", (json.dumps({"status": "recovery"}),))
        with self.assertRaisesRegex(RuntimeError, "interrupted replacement"):
            tasks.settings.migrate()
        self.assertIsNone(storage.get_metadata(tasks.settings.NAMESPACE, "migrated"))

    def test_pending_review_cannot_delete_an_unrecognized_file(self):
        original = self.folder / "original.mp4"
        original.write_bytes(b"keep")
        with storage.transaction() as connection:
            connection.execute("CREATE TABLE dirty_compactor_records(kind TEXT,id TEXT,value_json TEXT,revision INTEGER)")
            connection.execute("INSERT INTO dirty_compactor_records VALUES('run','old',?,0)",
                               (json.dumps({"status": "awaitingReview", "operations": [{"id": "original", "output": str(original)}]}),))
        with self.assertRaisesRegex(RuntimeError, "Discard"):
            tasks.settings.migrate()
        self.assertEqual(original.read_bytes(), b"keep")

    def test_reservation_survives_workers_and_blocks_organization_until_released(self):
        tasks.reservation.acquire("encoding", "run")
        tasks.reservation.acquire("encoding", "run")
        with self.assertRaisesRegex(RuntimeError, "active"):
            tasks.reservation.acquire("organization", "move")
        tasks.reservation.release("encoding", "another-run")
        with self.assertRaises(RuntimeError):
            tasks.reservation.acquire("organization", "move")
        tasks.reservation.release("encoding", "run")
        tasks.reservation.acquire("organization", "move")
        tasks.reservation.release("organization", "move")
        self.assertIsNone(storage.get_metadata(tasks.reservation.NAMESPACE, "active"))

    def test_recovery_is_hidden_without_an_organization_reservation(self):
        client = unittest.mock.Mock()
        self.assertEqual(tasks.reservation.organization_recovery_status(client), {"required": False})
        tasks.reservation.acquire("encoding", "encoding-run")
        self.assertEqual(tasks.reservation.organization_recovery_status(client), {"required": False})
        self.assertFalse(tasks.reservation.recover_organization(client))
        self.assertEqual(json.loads(storage.get_metadata(tasks.reservation.NAMESPACE, "active")), {"kind": "encoding", "owner": "encoding-run"})
        client.call.assert_not_called()

    def test_running_queued_and_stopping_organization_jobs_never_offer_recovery(self):
        tasks.reservation.acquire("organization", "moving")
        saved = storage.get_metadata(tasks.reservation.NAMESPACE, "active")
        client = unittest.mock.Mock()
        for status in ("READY", "RUNNING", "STOPPING"):
            with self.subTest(status=status):
                client.call.return_value = {"jobQueue": [{"id": "7", "status": status, "description": "Running plugin task: DirtyTasks: organization: apply confirmed file organization plan"}]}
                self.assertFalse(tasks.reservation.organization_recovery_status(client)["required"])
                self.assertFalse(tasks.reservation.recover_organization(client))
                self.assertEqual(storage.get_metadata(tasks.reservation.NAMESPACE, "active"), saved)

    def test_abandoned_organization_warns_without_writing_and_recovery_resumes_waiting_work_once(self):
        tasks.settings.migrate()
        tasks.reservation.acquire("organization", "interrupted")
        saved = storage.get_metadata(tasks.reservation.NAMESPACE, "active")
        client = unittest.mock.Mock()
        client.call.return_value = {"jobQueue": []}
        with patch.object(encoding, "Client", return_value=client), \
                patch.object(tasks.reservation, "queue_pending") as organization_pending, \
                patch.object(encoding, "queue_pending") as encoding_pending:
            self.assertEqual(tasks.run({"args": {"mode": "organizationRecoveryStatus"}}), {"required": True})
            self.assertEqual(storage.get_metadata(tasks.reservation.NAMESPACE, "active"), saved)
            organization_pending.assert_not_called()
            encoding_pending.assert_not_called()
            self.assertEqual(tasks.run({"args": {"mode": "recoverOrganization"}}), {"recovered": True})
            self.assertIsNone(storage.get_metadata(tasks.reservation.NAMESPACE, "active"))
            self.assertEqual(tasks.run({"args": {"mode": "organizationRecoveryStatus"}}), {"required": False})
            self.assertEqual(tasks.run({"args": {"mode": "recoverOrganization"}}), {"recovered": False})
            organization_pending.assert_called_once_with(client)
            encoding_pending.assert_called_once_with(client)

    def test_unavailable_queue_cannot_authorize_recovery(self):
        tasks.reservation.acquire("organization", "moving")
        saved = storage.get_metadata(tasks.reservation.NAMESPACE, "active")
        client = unittest.mock.Mock()
        for response in ({}, {"jobQueue": {}}):
            client.call.return_value = response
            with self.assertRaisesRegex(RuntimeError, "Could not check"):
                tasks.reservation.organization_recovery_status(client)
            with self.assertRaisesRegex(RuntimeError, "Could not check"):
                tasks.reservation.recover_organization(client)
        client.call.side_effect = RuntimeError("Stash is unavailable")
        with self.assertRaisesRegex(RuntimeError, "unavailable"):
            tasks.reservation.organization_recovery_status(client)
        self.assertEqual(storage.get_metadata(tasks.reservation.NAMESPACE, "active"), saved)

    def test_stash_null_queue_means_no_active_jobs(self):
        tasks.reservation.acquire("organization", "interrupted")
        client = unittest.mock.Mock()
        client.call.return_value = {"jobQueue": None}
        self.assertEqual(tasks.reservation.organization_recovery_status(client), {"required": True})
        self.assertTrue(tasks.reservation.recover_organization(client))

    def test_recovery_cannot_clear_a_reservation_that_changed_during_the_check(self):
        tasks.reservation.acquire("organization", "interrupted")
        client = unittest.mock.Mock()
        def changed_queue(*args):
            tasks.reservation.release("organization", "interrupted")
            tasks.reservation.acquire("encoding", "new-run")
            return {"jobQueue": []}
        client.call.side_effect = changed_queue
        self.assertFalse(tasks.reservation.organization_recovery_status(client)["required"])
        self.assertEqual(json.loads(storage.get_metadata(tasks.reservation.NAMESPACE, "active"))["owner"], "new-run")
        tasks.reservation.release("encoding", "new-run")
        tasks.reservation.acquire("organization", "old")
        expected = storage.get_metadata(tasks.reservation.NAMESPACE, "active")
        def changed_reservation(*args):
            tasks.reservation.release("organization", "old")
            tasks.reservation.acquire("organization", "new")
            return expected
        with patch.object(tasks.reservation, "interrupted_organization", side_effect=changed_reservation):
            self.assertFalse(tasks.reservation.recover_organization(client))
        self.assertEqual(json.loads(storage.get_metadata(tasks.reservation.NAMESPACE, "active"))["owner"], "new")

    def test_organization_queue_failure_does_not_prevent_encoding_automation(self):
        tasks.settings.migrate()
        with patch.object(tasks.organization, "run", side_effect=RuntimeError("Organization queue failed")), \
                patch.object(tasks.encoding, "dispatch", return_value={"queued": True}) as dispatch:
            with self.assertRaisesRegex(RuntimeError, "Organization queue failed"):
                tasks.run({"args": {"mode": "queueAutomation", "automationTrigger": "scan", "sourceJobId": "7", "sourceStartTime": "start"}})
        self.assertEqual(dispatch.call_args.args[1]["jobId"], "7")

    def stranded_run(self, run_id="stranded", status="queued", operations=("completed", "ready")):
        run = {"id": run_id, "status": status, "created": 1793565577.0, "automatic": False,
               "operations": [{"id": f"{run_id}-{index}", "status": value, "sceneId": str(index)}
                              for index, value in enumerate(operations)]}
        encoding.save("run", run)
        tasks.reservation.acquire("encoding", run_id)
        return run

    def organize(self, client):
        messages = []
        reporter = unittest.mock.Mock()
        reporter.info.side_effect = messages.append
        with patch.object(encoding, "Client", return_value=client), \
                patch.object(tasks.organization, "run", return_value={"completed": 0}) as organize, \
                patch.object(tasks.reservation, "queue_pending"), patch.object(encoding, "queue_pending"):
            result = tasks.run({"args": {"task": "organization", "mode": "automation", "automationTrigger": "scan",
                                         "sourceJobId": "20", "sourceStartTime": "start"}}, reporter)
        return result, organize, messages

    def test_an_encoding_run_without_a_stash_task_is_paused_instead_of_blocking_organization(self):
        tasks.settings.migrate()
        run = self.stranded_run(status="running", operations=("completed", "encoding", "ready"))
        partial = self.folder / ".dirty-tasks-stranded-1.tmp"
        partial.write_bytes(b"partial encode")
        run["operations"][1]["output"] = str(partial)
        encoding.save("run", run)
        client = unittest.mock.Mock()
        client.call.return_value = {"jobQueue": None}
        result, organize, messages = self.organize(client)
        self.assertEqual(result, {"completed": 0})
        organize.assert_called_once()
        stored = encoding.get("run", "stranded")
        self.assertEqual([stored["status"]] + [op["status"] for op in stored["operations"]],
                         ["paused", "completed", "ready", "ready"], "finished files stay; the rest can resume")
        self.assertFalse(partial.exists())
        self.assertIsNone(storage.get_metadata(tasks.reservation.NAMESPACE, "active"))
        self.assertRegex(messages[0], r"paused the encoding run started \d{4}-\d\d-\d\d \d\d:\d\d")

    def test_live_or_unattached_encoding_work_keeps_the_files_and_organization_says_it_waits(self):
        tasks.settings.migrate()
        busy = {"jobQueue": [{"id": "9", "status": "RUNNING", "description": "Running plugin task: DirtyTasks: encoding: apply rules"}]}
        cases = (("a task is encoding", "busy", "running", ("encoding",), busy),
                 ("a file is being published", "publishing", "running", ("publishing",), {"jobQueue": None}),
                 ("a file waits to be attached", "attaching", "reconciling", ("reconciling",), {"jobQueue": None}),
                 ("Stash cannot be asked", "unknown", "queued", ("ready",), {}))
        for name, run_id, status, operations, queue in cases:
            with self.subTest(name):
                self.stranded_run(run_id, status, operations)
                client = unittest.mock.Mock()
                client.call.return_value = queue
                result, organize, messages = self.organize(client)
                self.assertEqual(result, {"coalesced": True})
                organize.assert_not_called()
                self.assertEqual(encoding.get("run", run_id)["status"], status)
                self.assertEqual(json.loads(storage.get_metadata(tasks.reservation.NAMESPACE, "active"))["owner"], run_id)
                self.assertIn("organization is waiting", messages[-1])
                self.assertTrue(storage.get_metadata(tasks.reservation.NAMESPACE, "pendingOrganization:scan"))
                tasks.reservation.release("encoding", run_id)
        # A file action ("run:action") keeps its own explicit recovery.
        tasks.reservation.acquire("encoding", "done:action")
        client = unittest.mock.Mock()
        client.call.return_value = {"jobQueue": None}
        self.assertEqual(self.organize(client)[0], {"coalesced": True})

    def test_cancel_and_pause_act_at_once_on_a_run_without_a_stash_task(self):
        tasks.settings.migrate()
        client = unittest.mock.Mock()
        client.call.return_value = {"jobQueue": None}
        self.stranded_run("pause-me")
        waiting = {"task": "organization", "mode": "automation", "automationTrigger": "scan"}
        tasks.reservation.defer_organization(waiting)
        self.assertEqual(encoding.pause_run(client, {"id": "pause-me"}), {"requested": True})
        self.assertEqual(encoding.get("run", "pause-me")["status"], "paused")
        self.assertFalse(encoding.records.get("pause", "pause-me")["requested"])
        self.assertIsNone(storage.get_metadata(tasks.reservation.NAMESPACE, "active"))
        self.assertEqual(client.queue.call_args.args[1], waiting, "organization that waited starts now")
        self.stranded_run("cancel-me")
        encoding.cancel_run(client, {"id": "cancel-me"})
        stored = encoding.get("run", "cancel-me")
        self.assertEqual([stored["status"]] + [op["status"] for op in stored["operations"]], ["cancelled", "completed", "cancelled"])
        self.assertIsNone(storage.get_metadata(tasks.reservation.NAMESPACE, "active"))
        # With its Stash task still queued, a request is left for the worker as before.
        self.stranded_run("queued-task")
        client.call.return_value = {"jobQueue": [{"id": "3", "status": "READY", "description": "DirtyTasks: encoding: apply rules"}]}
        encoding.pause_run(client, {"id": "queued-task"})
        self.assertEqual(encoding.get("run", "queued-task")["status"], "queued")
        self.assertTrue(encoding.records.get("pause", "queued-task")["requested"])


class EncodingFileActionTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.folder = Path(temporary.name)
        environment = patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(self.folder / "shared.sqlite3")})
        environment.start()
        self.addCleanup(environment.stop)
        self.client = encoding_tests.FakeClient(self.folder / "original-1.mp4")
        self.client.data = []
        self.record = {"id": "file-actions", "status": "completed", "created": 1, "automatic": False,
                    "rulesDigest": "fixture", "operations": []}
        self.add_scene("1")
        self.persist()

    def add_scene(self, scene_id):
        source, output = (self.folder / (prefix + scene_id + ".mp4") for prefix in ("original-", "encoded-"))
        source.write_bytes(b"original bytes " + scene_id.encode())
        output.write_bytes(b"new " + scene_id.encode())
        op = {"id": scene_id, "sceneId": scene_id, "fileId": "old-" + scene_id, "outputFileId": "new-" + scene_id,
              "status": "completed", "source": str(source), "destination": str(output),
              "identity": encoding.identity(source), "sourceHash": encoding.file_hash(source),
              "outputSize": output.stat().st_size, "outputHash": encoding.file_hash(output), "rule": encoding_tests.rule()}
        self.record["operations"].append(op)
        self.client.data.append({"id": scene_id, "files": [{"id": op["fileId"], "path": str(source)},
                                                          {"id": op["outputFileId"], "path": str(output)}]})
        return op

    def persist(self):
        encoding.save("run", self.record)

    def queue(self, mode="makePrimary", **args):
        return encoding.dispatch(self.client, {"mode": mode, "id": self.record["id"], **args})

    def finish(self, mode="makePrimary", **args):
        self.queue(mode, **args)
        with patch.object(encoding, "queue_pending"), patch.object(encoding.reservation, "queue_pending"):
            return encoding.dispatch(self.client, self.client.jobs[-1])

    def test_primary_checks_live_state_and_processes_every_page(self):
        for number in range(2, 29):
            self.add_scene(str(number))
        self.persist()
        self.client.set_primary("2", "new-2")
        with patch.object(self.client, "set_primary", wraps=self.client.set_primary) as change:
            result = self.finish(page=2)
        self.assertEqual(result["fileAction"]["changed"], 27)
        self.assertEqual(result["fileAction"]["skipped"], 1)
        self.assertEqual(change.call_count, 27)
        self.assertTrue(all(scene["files"][0]["id"].startswith("new-") for scene in self.client.data))
        self.assertTrue(Path(self.record["operations"][0]["source"]).exists())
        self.assertFalse(encoding.get_run(self.client, {"id": self.record["id"], "page": 2})["fileActions"]["makePrimary"])
        with self.assertRaisesRegex(encoding.PluginError, "No eligible files"):
            self.queue()

    def test_multiple_outputs_prefer_current_primarys_replacement(self):
        second = self.add_scene("2")
        second["sceneId"] = "1"
        self.client.data[0]["files"].extend(self.client.data.pop()["files"])
        self.client.set_primary("1", "old-2")
        self.persist()
        self.finish()
        self.assertEqual(self.client.scene("1")["files"][0]["id"], "new-2")
        with self.assertRaisesRegex(encoding.PluginError, "No eligible files"):
            self.queue()

    def test_delete_promotes_originals_primary_and_is_idempotent(self):
        result = self.finish("deleteOriginals", confirmed=True)
        self.assertEqual(result["fileAction"]["changed"], 1)
        self.assertEqual(self.client.scene("1")["files"][0]["id"], "new-1")
        self.assertFalse(Path(self.record["operations"][0]["source"]).exists())
        self.assertTrue(Path(self.record["operations"][0]["destination"]).exists())
        self.assertEqual(encoding.get_run(self.client, {"id": self.record["id"]})["fileActions"],
                         {"makePrimary": False, "deleteOriginals": False})
        with self.assertRaisesRegex(encoding.PluginError, "No eligible files"):
            self.queue("deleteOriginals", confirmed=True)
        self.assertEqual(self.client.deleted, ["old-1"])

    def test_delete_uses_file_ids_after_organization_renames(self):
        for file in self.client.data[0]["files"]:
            destination = self.folder / (file["id"] + "-renamed.mp4")
            Path(file["path"]).rename(destination)
            file["path"] = str(destination)
        self.assertEqual(self.finish("deleteOriginals", confirmed=True)["fileAction"]["changed"], 1)

    def test_delete_retains_changed_shared_or_missing_replacements_and_continues(self):
        for number in range(2, 7):
            self.add_scene(str(number))
        self.persist()
        Path(self.record["operations"][0]["destination"]).write_bytes(b"bad 1")  # same length; hash must catch this
        Path(self.record["operations"][1]["source"]).write_bytes(b"changed")
        self.client.data[2]["files"].pop()
        self.client.data.append({"id": "shared", "files": [self.client.data[3]["files"][0].copy()]})
        Path(self.record["operations"][4]["destination"]).unlink()
        result = self.finish("deleteOriginals", confirmed=True)
        self.assertEqual(result["fileAction"]["changed"], 1)
        self.assertEqual(self.client.deleted, ["old-6"])
        self.assertTrue(all(Path(op["source"]).exists() for op in self.record["operations"][:5]))
        self.assertIsNone(storage.get_metadata(tasks.reservation.NAMESPACE, "active"))

    def test_delete_only_completed_originals_preserves_other_files_and_metadata(self):
        failed = self.add_scene("2")
        failed["status"] = "failed"
        self.client.data[0]["title"] = "Keep title"
        unrelated = self.folder / "unrelated.mp4"
        unrelated.write_bytes(b"unrelated")
        self.client.data[0]["files"].append({"id": "unrelated", "path": str(unrelated)})
        self.persist()
        self.finish("deleteOriginals", confirmed=True)
        self.assertEqual(self.client.deleted, ["old-1"])
        self.assertEqual(self.client.scene("1")["title"], "Keep title")
        self.assertTrue(unrelated.exists())
        self.assertTrue(Path(failed["source"]).exists())

    def test_delete_keeps_unrelated_primary_and_deletes_multiple_originals(self):
        second = self.add_scene("2")
        second["sceneId"] = "1"
        self.client.data[0]["files"].extend(self.client.data.pop()["files"])
        self.client.set_primary("1", "new-2")
        self.persist()
        self.assertEqual(self.finish("deleteOriginals", confirmed=True)["fileAction"]["changed"], 2)
        self.assertEqual(self.client.scene("1")["files"][0]["id"], "new-2")
        self.assertEqual(len(self.client.scene("1")["files"]), 2)

    def test_confirmation_finished_run_and_shared_reservation_are_required(self):
        with self.assertRaisesRegex(encoding.PluginError, "Confirm"):
            self.queue("deleteOriginals")
        self.record["status"] = "paused"
        self.persist()
        with self.assertRaisesRegex(encoding.PluginError, "Finish or cancel"):
            self.queue()
        self.record["status"] = "cancelled"
        self.persist()
        tasks.reservation.acquire("organization", "other-task")
        with self.assertRaisesRegex(RuntimeError, "Another file task"):
            self.queue()

    def test_recovery_checks_queue_and_stale_workers_cannot_replay(self):
        self.queue()
        old = self.client.jobs[-1]
        with self.assertRaisesRegex(encoding.PluginError, "still active"):
            self.queue()
        with patch.object(encoding, "tasks_active", return_value=True):
            with self.assertRaisesRegex(encoding.PluginError, "still active"):
                self.queue(retry=True)
        self.queue(retry=True)
        latest = self.client.jobs[-1]
        self.assertNotEqual(latest["actionId"], old["actionId"])
        encoding.dispatch(self.client, old)
        self.assertEqual(self.client.scene("1")["files"][0]["id"], "old-1")
        with patch.object(encoding, "queue_pending"), patch.object(encoding.reservation, "queue_pending"):
            result = encoding.dispatch(self.client, latest)
        self.assertEqual(result["fileAction"]["changed"], 1)

    def test_queue_failure_releases_only_its_own_reservation(self):
        with patch.object(self.client, "queue", side_effect=RuntimeError("offline")):
            with self.assertRaisesRegex(RuntimeError, "offline"):
                self.queue()
        self.assertIsNone(storage.get_metadata(tasks.reservation.NAMESPACE, "active"))
        self.assertEqual(encoding.get("run", self.record["id"])["fileAction"]["status"], "failed")

    def test_recovery_needs_a_valid_queue_answer_and_clears_completed_reservations(self):
        self.queue()
        with patch.object(self.client, "call", return_value={}):
            with self.assertRaisesRegex(encoding.PluginError, "Could not check"):
                self.queue(retry=True)
        stored = encoding.get("run", self.record["id"])
        stored["fileAction"]["status"] = "completed"
        encoding.save("run", stored)
        self.queue()
        self.assertNotEqual(self.client.jobs[-1]["actionId"], stored["fileAction"]["id"])

    def test_stash_mutations_use_only_recorded_ids_and_verify_responses(self):
        client = encoding.Client({})
        with patch.object(client, "call", return_value={"sceneUpdate": {"files": [{"id": "new-1"}]}}) as call:
            client.set_primary("1", "new-1")
            self.assertEqual(call.call_args.args[1], {"input": {"id": "1", "primary_file_id": "new-1"}})
        with patch.object(client, "call", return_value={"sceneUpdate": {"files": [{"id": "old-1"}]}}):
            with self.assertRaises(encoding.PluginError):
                client.set_primary("1", "new-1")
        with patch.object(client, "call", return_value={"deleteFiles": True}) as call:
            client.delete_file("old-1")
            self.assertEqual(call.call_args.args[1], {"ids": ["old-1"]})
        with patch.object(client, "call", return_value={"deleteFiles": False}):
            with self.assertRaises(encoding.PluginError):
                client.delete_file("old-1")

    def test_availability_uses_live_files_without_rereading_whole_media(self):
        availability = lambda: encoding.get_run(self.client, {"id": self.record["id"]})["fileActions"]
        with patch.object(encoding, "file_hash", side_effect=AssertionError("Polling must not hash media")):
            self.assertEqual(availability(), {"makePrimary": True, "deleteOriginals": True})
            self.client.set_primary("1", "new-1")
            self.assertEqual(availability(), {"makePrimary": False, "deleteOriginals": True})
            self.client.set_primary("1", "old-1")
            Path(self.record["operations"][0]["destination"]).unlink()
            self.assertEqual(availability(), {"makePrimary": False, "deleteOriginals": False})

    def test_availability_rejects_shared_changed_and_missing_originals_and_failed_lookups(self):
        availability = lambda: encoding.get_run(self.client, {"id": self.record["id"]})["fileActions"]
        self.client.data.append({"id": "other", "files": [self.client.data[0]["files"][0].copy()]})
        self.assertEqual(availability(), {"makePrimary": True, "deleteOriginals": False})
        self.client.data.pop()
        Path(self.record["operations"][0]["source"]).write_bytes(b"changed size")
        self.assertFalse(availability()["deleteOriginals"])
        self.client.data[0]["files"].pop(0)
        self.assertFalse(availability()["deleteOriginals"])
        with patch.object(self.client, "file_action_scenes", side_effect=RuntimeError("offline")):
            unavailable = availability()
        self.assertFalse(unavailable["makePrimary"])
        self.assertFalse(unavailable["deleteOriginals"])
        self.assertIn("Could not check", unavailable["error"])

    def test_known_invalid_contents_disable_actions_until_the_file_changes(self):
        output = Path(self.record["operations"][0]["destination"])
        output.write_bytes(b"bad 1")
        result = self.finish("deleteOriginals", confirmed=True)
        self.assertEqual(result["fileAction"]["changed"], 0)
        self.assertEqual(encoding.get_run(self.client, {"id": self.record["id"]})["fileActions"],
                         {"makePrimary": False, "deleteOriginals": False})
        output.write_bytes(b"new 1")
        self.assertTrue(encoding.get_run(self.client, {"id": self.record["id"]})["fileActions"]["deleteOriginals"])
        self.assertEqual(self.finish("deleteOriginals", confirmed=True)["fileAction"]["changed"], 1)

    def test_a_valid_alternate_remains_available_when_the_preferred_output_is_missing(self):
        second = self.add_scene("2")
        second["sceneId"] = "1"
        self.client.data[0]["files"].extend(self.client.data.pop()["files"])
        Path(self.record["operations"][0]["destination"]).unlink()
        self.persist()
        self.assertTrue(encoding.get_run(self.client, {"id": self.record["id"]})["fileActions"]["makePrimary"])
        self.assertEqual(self.finish()["fileAction"]["changed"], 1)
        self.assertEqual(self.client.scene("1")["files"][0]["id"], "new-2")

    def test_invalid_original_contents_disable_deletion_without_disabling_primary(self):
        source = Path(self.record["operations"][0]["source"])
        source.write_bytes(b"changed  bytes 1")
        self.assertEqual(source.stat().st_size, self.record["operations"][0]["identity"]["size"])
        self.assertEqual(self.finish("deleteOriginals", confirmed=True)["fileAction"]["changed"], 0)
        self.assertEqual(encoding.get_run(self.client, {"id": self.record["id"]})["fileActions"],
                         {"makePrimary": True, "deleteOriginals": False})

    def test_availability_scene_queries_are_bounded(self):
        client = encoding.Client({})
        def call(_query, variables):
            return {"findScenes": {"scenes": [{"id": scene_id, "files": []} for scene_id in variables["ids"]]}}
        with patch.object(client, "call", side_effect=call) as calls:
            scenes = list(client.file_action_scenes([str(number) for number in range(205)]))
        self.assertEqual(len(scenes), 205)
        self.assertEqual([len(call.args[1]["ids"]) for call in calls.call_args_list], [100, 100, 5])
        self.assertEqual([scene["id"] for scene in scenes], [str(number) for number in range(205)])

    def test_a_temporary_read_failure_does_not_mark_original_contents_invalid(self):
        source = Path(self.record["operations"][0]["source"])
        file_hash = encoding.file_hash
        def read(path, *args, **kwargs):
            if Path(path) == source:
                raise PermissionError("Temporary read failure")
            return file_hash(path, *args, **kwargs)
        with patch.object(encoding, "file_hash", side_effect=read):
            self.assertEqual(self.finish("deleteOriginals", confirmed=True)["fileAction"]["changed"], 0)
        self.assertTrue(encoding.get_run(self.client, {"id": self.record["id"]})["fileActions"]["deleteOriginals"])


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg tools required")
class AdditionalEncodingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        encoding_tests.CompactorPipelineTests.setUpClass()

    @classmethod
    def tearDownClass(cls):
        encoding_tests.CompactorPipelineTests.tearDownClass()

    def setUp(self):
        self.case = encoding_tests.CompactorPipelineTests()
        self.case.setUp()
        self.addCleanup(self.case.tearDown)

    def finish(self, run):
        while run["status"] not in encoding.TERMINAL:
            self.assertNotEqual(run["status"], "recovery", run)
            run = encoding.finalize(self.case.client, run["id"]) if run["status"] == "reconciling" else encoding.worker(self.case.client, run["id"])
        return run

    def test_both_files_stay_attached_and_repeated_runs_skip_original_and_generated_output(self):
        run = self.finish(self.case.start())
        self.assertEqual(run["status"], "completed")
        scene = self.case.client.scene("1")
        self.assertEqual(len(scene["files"]), 2)
        self.assertEqual(scene["files"][0]["id"], "7")
        self.assertEqual(self.case.source.read_bytes(), self.case.original)
        output = Path(run["operations"][0]["destination"])
        self.assertTrue(output.is_file())
        public = encoding.public_record(run)
        self.assertEqual(public["actualSavings"], 0)
        self.assertEqual(public["addedBytes"], output.stat().st_size)
        self.assertEqual(public["originalBytes"], len(self.case.original))
        listed = encoding.list_runs(self.case.client, {})[0]
        self.assertEqual((listed["originalBytes"], listed["counts"]), (len(self.case.original), {"completed": 1}))
        self.case.set_rules([encoding_tests.rule(id="recreated-rule", trigger="generate")])
        again = self.case.preview()
        self.assertTrue(all(op["status"] == "unchanged" for op in again["operations"]), again)
        self.assertEqual(len(list(self.case.folder.glob("*.mp4"))), 2)

    def test_attachment_retry_reuses_exact_encoded_bytes_and_is_idempotent(self):
        run = self.case.start()
        output = Path(run["operations"][0]["destination"])
        content = output.read_bytes()
        with patch.object(self.case.client, "attach", side_effect=RuntimeError("scan delayed")):
            run = encoding.finalize(self.case.client, run["id"])
        self.assertEqual(run["status"], "recovery")
        encoding.recover(self.case.client, run)
        with patch.object(encoding, "encode", side_effect=AssertionError("must not reencode")):
            run = self.finish(encoding.get("run", run["id"]))
        self.assertEqual(output.read_bytes(), content)
        self.assertEqual(len(self.case.client.scene("1")["files"]), 2)
        encoding.finalize(self.case.client, run["id"])
        self.assertEqual(len(self.case.client.scene("1")["files"]), 2)

    def test_multiple_originals_can_finish_after_new_associations_are_added(self):
        second = self.case.folder / "second.mp4"
        shutil.copyfile(self.case.source, second)
        self.case.client.data[0]["files"].append({"id": "8", "path": str(second)})
        run = self.finish(self.case.start())
        self.assertEqual(len(self.case.client.scene("1")["files"]), 4)
        self.assertEqual(second.read_bytes(), self.case.original)
        self.assertEqual([op["status"] for op in run["operations"]], ["completed", "completed"])

    def test_occupied_output_is_not_overwritten_and_cancellation_releases_the_reservation(self):
        preview = self.case.preview()
        destination = Path(preview["operations"][0]["destination"])
        destination.write_bytes(b"unrelated")
        result = encoding.start_run(self.case.client, preview, {})
        run = encoding.worker(self.case.client, result["id"])
        self.assertEqual(destination.read_bytes(), b"unrelated")
        self.assertEqual(run["status"], "recovery")
        encoding.cancel_run(self.case.client, {"id": run["id"]})
        self.assertEqual(encoding.get("run", run["id"])["status"], "cancelled")
        self.assertIsNone(storage.get_metadata(tasks.reservation.NAMESPACE, "active"))
        self.assertEqual(destination.read_bytes(), b"unrelated")

    def test_organization_renames_multiple_versions_to_distinct_names(self):
        run = self.finish(self.case.start())
        scene = self.case.client.scene("1")
        plan = tasks.organization.build_plan([str(self.case.folder)], [scene], {"moveEnabled": False, "renameEnabled": True, "renamePattern": "{title}"})
        self.assertEqual(plan["summary"]["blocked"], 0)
        self.assertEqual(len({op["destination_path"] for op in plan["operations"]}), 2)
        # A template keeping the current basename must not append the variant
        # again at every Scan. Tiny filename limits still include a stable ID.
        for file in scene["files"]:
            file["id"] = "12345678901234567890" + file["id"]
        plan = tasks.organization.build_plan([str(self.case.folder)], [scene], {"moveEnabled": False, "renameEnabled": True, "renamePattern": "{original_name}", "maxFilenameLength": 16})
        for op, file in zip(plan["operations"], scene["files"]):
            self.assertLessEqual(len(op["destination_basename"]), 16)
            Path(file["path"]).rename(op["destination_path"])
            file["path"] = op["destination_path"]
        again = tasks.organization.build_plan([str(self.case.folder)], [scene], plan["settings"])
        self.assertTrue(all(op["status"] == "unchanged" for op in again["operations"]), again)

    def test_automatic_encoding_is_deferred_while_organization_owns_file_work(self):
        self.case.set_rules([encoding_tests.rule(mode="automatic")])
        tasks.reservation.acquire("organization", "moving")
        result = encoding.handle_automatic_trigger(self.case.client, {"mode": "pendingAutomatic", "trigger": "scan"})
        self.assertTrue(result["coalesced"])
        self.assertFalse(self.case.client.jobs)
        tasks.reservation.release("organization", "moving")
        encoding.queue_pending(self.case.client)
        self.assertEqual(self.case.client.jobs[-1]["trigger"], "scan")
        self.assertIsNone(encoding.records.get("control", "pending:scan")["trigger"])

    def test_winning_rule_trigger_does_not_fall_through_to_later_rules(self):
        self.case.set_rules([encoding_tests.rule(trigger="manual"), encoding_tests.rule(id="second", trigger="scan")])
        with patch.object(encoding, "probe", side_effect=AssertionError("a manual winner must not probe automatically")):
            automatic = self.case.preview(automatic=True)
        self.assertEqual(len(automatic["operations"]), 1)
        self.assertEqual(automatic["operations"][0]["status"], "manual")
        self.assertEqual(automatic["operations"][0]["rule"]["id"], "rule-1")
        manual = self.case.preview()
        self.assertEqual(manual["operations"][0]["status"], "ready")
        self.assertEqual(manual["operations"][0]["rule"]["id"], "rule-1")

    def test_deferred_encoding_preserves_scan_and_generate_work(self):
        self.case.set_rules([encoding_tests.rule(trigger="scan"), encoding_tests.rule(id="second", trigger="generate")])
        tasks.reservation.acquire("organization", "moving")
        for kind in ("scan", "generate"):
            result = encoding.handle_automatic_trigger(self.case.client, {"mode": "pendingAutomatic", "trigger": kind, "automationTrigger": kind})
            self.assertTrue(result["coalesced"])
        tasks.reservation.release("organization", "moving")
        encoding.queue_pending(self.case.client)
        self.assertEqual([job["automationTrigger"] for job in self.case.client.jobs], ["scan", "generate"])
        encoding.queue_pending(self.case.client)
        self.assertEqual(len(self.case.client.jobs), 2)

    def test_encoding_rule_generate_trigger_and_pending_work_recheck(self):
        values = storage.get_plugin_settings("dirtyTasks")
        values["execution"] = triggers("generate")
        storage.set_plugin_settings("dirtyTasks", values)
        args = {"mode": "startAutomaticRun", "automationTrigger": "generate", "jobId": "7", "startTime": "start"}
        encoding.handle_automatic_trigger(self.case.client, args)
        self.assertEqual(self.case.client.jobs[-1]["automationTrigger"], "generate")
        self.assertTrue(encoding.handle_automatic_trigger(self.case.client, args)["duplicate"])
        values["execution"] = triggers()
        storage.set_plugin_settings("dirtyTasks", values)
        with patch.object(encoding, "build_preview", side_effect=AssertionError("must not plan")):
            self.assertTrue(encoding.handle_automatic_trigger(self.case.client, self.case.client.jobs[-1])["paused"])


if __name__ == "__main__":
    unittest.main()
