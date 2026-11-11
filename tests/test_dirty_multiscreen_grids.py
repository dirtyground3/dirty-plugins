"""DirtyMultiscreen's saved grids: its own table in a temporary shared database, and the raw JSON protocol."""
from plugin_paths import runtime_path
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

for plugin in ("DirtyPlugins", "DirtyMultiscreen"):
    sys.path.insert(0, str(runtime_path(plugin)))
import dirty_multiscreen as backend
import dirty_multiscreen_grids as grids

DATA = json.dumps({"settings": {"rows": 2, "columns": 3}, "session": {"seed": 4294967295, "now": 1794350017141}})


class SavedGridTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.database = Path(folder.name) / "shared.sqlite3"
        environment = mock.patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(self.database)})
        environment.start()
        self.addCleanup(environment.stop)

    def run_mode(self, **args):
        return backend.run({"args": args})

    def test_save_list_get_replace_rename_and_delete(self):
        self.assertEqual(self.run_mode(mode="gridList"), {"grids": []})
        first = self.run_mode(mode="gridSave", name="  Evening   mix ", rows=2, columns=3, data=DATA)
        self.assertEqual(first, {"id": first["id"], "name": "Evening mix", "rows": 2, "columns": 3,
                                 "updatedAt": first["updatedAt"], "recent": False})
        second = grids.save_grid("afternoon", 1, 1, DATA, now=5)
        # Names sort without regard to case, and the list carries no session.
        self.assertEqual([grid["name"] for grid in self.run_mode(mode="gridList")["grids"]],
                         ["afternoon", "Evening mix"])
        self.assertNotIn("data", self.run_mode(mode="gridList")["grids"][0])
        # The session comes back as the exact text that was stored.
        self.assertEqual(self.run_mode(mode="gridGet", id=first["id"])["data"], DATA)
        replaced = self.run_mode(mode="gridSave", id=first["id"], name="Evening mix", rows=1, columns=2,
                                 data='{"session": {}}')
        self.assertEqual((replaced["id"], replaced["rows"], replaced["columns"]), (first["id"], 1, 2))
        self.assertEqual(grids.get_grid(first["id"])["data"], '{"session": {}}')
        self.assertEqual(len(grids.list_grids()), 2)
        renamed = self.run_mode(mode="gridRename", id=second["id"], name="Late")
        self.assertEqual((renamed["name"], renamed["updatedAt"]), ("Late", 5), "a rename is not a new save")
        self.assertEqual(self.run_mode(mode="gridDelete", id=second["id"]), {"deleted": True})
        self.assertEqual(self.run_mode(mode="gridDelete", id=second["id"]), {"deleted": False})
        self.assertEqual([grid["name"] for grid in grids.list_grids()], ["Evening mix"])

    def test_rejected_requests_change_nothing(self):
        saved = grids.save_grid("Kept", 2, 2, DATA)
        for change, message in [
            ({"name": "  "}, "Enter a name"),
            ({"name": 7}, "Enter a name"),
            ({"name": "n" * 81}, "at most 80 characters"),
            ({"rows": 0}, "rows must be between 1 and 6"),
            ({"columns": 7}, "columns must be between 1 and 6"),
            ({"rows": 1.5}, "rows must be a whole number"),
            ({"rows": True}, "rows must be a whole number"),
            ({"data": {"session": {}}}, "must be JSON text"),
            ({"data": "{"}, "not valid JSON"),
            ({"data": "[]"}, "must be a JSON object"),
            ({"data": '{"pad": "' + "x" * grids.MAX_DATA_BYTES + '"}'}, "too large"),
            ({"id": 999}, "no longer exists"),
            ({"id": "1"}, "Unknown saved grid"),
        ]:
            with self.subTest(change=str(change)[:40]):
                request = {"mode": "gridSave", "name": "Other", "rows": 2, "columns": 2, "data": DATA, **change}
                with self.assertRaisesRegex(grids.GridError, message):
                    self.run_mode(**request)
        with self.assertRaisesRegex(grids.GridError, "no longer exists"):
            self.run_mode(mode="gridGet", id=999)
        with self.assertRaisesRegex(grids.GridError, "Enter a name"):
            self.run_mode(mode="gridRename", id=saved["id"], name="")
        with self.assertRaisesRegex(ValueError, "Unsupported DirtyMultiscreen operation"):
            self.run_mode(mode="other")
        self.assertEqual(grids.list_grids(), [saved])

    def test_grid_limit(self):
        with mock.patch.object(grids, "MAX_GRIDS", 2):
            grids.save_grid("One", 1, 1, DATA)
            kept = grids.save_grid("Two", 1, 1, DATA)
            with self.assertRaisesRegex(grids.GridError, "At most 2 grids"):
                grids.save_grid("Three", 1, 1, DATA)
            # Replacing a saved grid is always allowed.
            self.assertEqual(grids.save_grid("Two", 2, 2, DATA, kept["id"])["rows"], 2)

    def test_recent_grids_update_trim_and_keep(self):
        named = grids.save_grid("Evening", 1, 1, DATA, now=1)

        def recent(name, grid_id=None, keep=2):
            return self.run_mode(mode="gridRecent", name=name, rows=2, columns=2, data=DATA, keep=keep,
                                 id=grid_id)["grid"]

        first = recent("First")
        self.assertTrue(first["recent"])
        # The same ID updates that recent grid instead of adding one.
        self.assertEqual(recent("First again", first["id"])["id"], first["id"])
        recent("Second")
        # A third recent grid pushes out the oldest; named grids never count.
        recent("Third")
        listed = self.run_mode(mode="gridList")["grids"]
        self.assertEqual([(grid["name"], grid["recent"]) for grid in listed],
                         [("Third", True), ("Second", True), ("Evening", False)],
                         "recent grids come first, newest first")
        # A recent grid that is gone, or a named grid's ID, starts a new recent grid.
        self.assertNotEqual(recent("Again", first["id"])["id"], first["id"])
        self.assertNotEqual(recent("Not named", named["id"])["id"], named["id"])
        self.assertEqual(grids.get_grid(named["id"])["name"], "Evening")

        # Keeping a recent grid names it; one with the same name is replaced and the recent grid stops updating.
        latest = [grid for grid in grids.list_grids() if grid["recent"]][0]
        kept = self.run_mode(mode="gridKeep", id=latest["id"], name="  evening ")
        self.assertEqual((kept["id"], kept["name"], kept["recent"]), (latest["id"], "evening", False))
        self.assertEqual([grid["name"] for grid in grids.list_grids() if not grid["recent"]], ["evening"])
        self.assertNotEqual(recent("Later", kept["id"])["id"], kept["id"])
        with self.assertRaisesRegex(grids.GridError, "already saved"):
            self.run_mode(mode="gridKeep", id=kept["id"], name="Twice")

        # Listing with a smaller number trims; 0 saves nothing and drops every recent grid.
        self.assertEqual(len([grid for grid in self.run_mode(mode="gridList", keepRecent=1)["grids"]
                              if grid["recent"]]), 1)
        self.assertIsNone(recent("Off", keep=0))
        self.assertEqual([grid["name"] for grid in grids.list_grids()], ["evening"])
        for keep in (-1, 11, 1.5, True, "2"):
            with self.subTest(keep=keep), self.assertRaisesRegex(grids.GridError, "between 0 and 10"):
                recent("Bad", keep=keep)

    def test_recent_grids_leave_room_for_named(self):
        with mock.patch.object(grids, "MAX_GRIDS", 1):
            grids.save_grid("One", 1, 1, DATA)
            recent = grids.save_recent("Recent", 1, 1, DATA, keep=3)
            with self.assertRaisesRegex(grids.GridError, "At most 1 grids"):
                grids.keep_grid(recent["id"], "Two")
            # Replacing the one named grid by name is still allowed.
            self.assertEqual(grids.keep_grid(recent["id"], "one")["name"], "one")

    def test_protocol_and_public_errors(self):
        def serve(args):
            result = subprocess.run(
                [sys.executable, "-B", str(runtime_path("DirtyMultiscreen", "dirty_multiscreen.py"))],
                input=json.dumps({"args": args}), capture_output=True, text=True,
                env={**os.environ, "DIRTY_PLUGINS_DATABASE_PATH": str(self.database)})
            return result.returncode, json.loads(result.stdout)

        code, envelope = serve({"mode": "gridSave", "name": "Protocol", "rows": 1, "columns": 2, "data": DATA})
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(envelope["output"])["name"], "Protocol")
        # A validation message reaches the browser as written.
        code, envelope = serve({"mode": "gridSave", "name": "", "rows": 1, "columns": 2, "data": DATA})
        self.assertEqual((code, envelope), (1, {"error": "Enter a name for the grid"}))
        # Any other failure could name a private path, so the browser gets a fixed message.
        self.assertEqual(backend.public_error(OSError(str(self.database))),
                         "DirtyMultiscreen could not use its saved grids")
        self.assertEqual(serve({"mode": "other"})[1], {"error": "DirtyMultiscreen could not use its saved grids"})


if __name__ == "__main__":
    unittest.main()
