"""Workflow boundaries introduced by the readability refactor."""
from plugin_paths import runtime_path
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1] / "plugins"
sys.path.insert(0, str(runtime_path("DirtyCompactor")))
sys.path.insert(0, str(runtime_path("DirtyFileExtractor")))
from dirty_compactor_workflow import transition_run
import extract_scenes as extractor


class WorkflowBoundaryTests(unittest.TestCase):
    def test_worker_claim_skips_duplicates_and_propagates_persistence_failures(self):
        run = {"status": "queued", "id": "run", "_revision": 7}
        writes = []
        self.assertTrue(transition_run(run, "running", lambda kind, value: writes.append((kind, dict(value))), expected="queued"))
        self.assertFalse(transition_run(run, "running", lambda *_: self.fail("duplicate write"), expected="queued"))
        self.assertEqual(writes[0][1]["_revision"], 7, "CAS revision survives the transition")
        with self.assertRaisesRegex(RuntimeError, "conflict"):
            transition_run(run, "awaitingReview", lambda *_: (_ for _ in ()).throw(RuntimeError("conflict")))
        with self.assertRaisesRegex(RuntimeError, "Invalid"):
            transition_run({"status": "completed"}, "running", lambda *_: self.fail("terminal transition persisted"))

    def test_planning_never_creates_output_directories(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.mp4"
            source.write_bytes(b"media")
            destination = Path(directory) / "output"
            options = extractor._normalize_extraction_settings({"destinationFolder": str(destination), "createSceneFolders": True})
            plan = extractor._plan_extraction_items([{"kind": "scene", "id": "1", "title": "Scene", "files": [{"path": str(source)}]}], options)
            self.assertEqual(len(plan.operations), 1)
            self.assertFalse(destination.exists())
            self.assertEqual(source.read_bytes(), b"media")
