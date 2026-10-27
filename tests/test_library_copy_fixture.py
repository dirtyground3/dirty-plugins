"""Path redirection that keeps the opt-in library copy away from real media."""
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from library_copy_fixture import pause_automation, redirect_database, stray_paths

MISSING = "C:\\fixture\\missing"


class LibraryCopyRedirectTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / "copy.sqlite"
        connection = sqlite3.connect(self.path)
        connection.executescript("""
            CREATE TABLE folders (id INTEGER PRIMARY KEY, path TEXT UNIQUE);
            CREATE TABLE scenes (id INTEGER PRIMARY KEY, details TEXT);
            CREATE TABLE dirty_plugin_settings (plugin_id TEXT, setting_key TEXT, value_json TEXT,
                                                PRIMARY KEY (plugin_id, setting_key));
        """)
        connection.executemany("INSERT INTO folders(path) VALUES (?)",
                               [("P:\\Data\\hard",), ("E:\\h\\a",), ("\\\\nas\\share\\b",)])
        connection.executemany("INSERT INTO scenes(details) VALUES (?)",
                               [("Shot at 12:30, see https://example.test/a",), ("plain text",)])
        connection.executemany("INSERT INTO dirty_plugin_settings VALUES (?, ?, ?)", [
            ("extractScenes", "destination", json.dumps("C:\\Users\\someone\\Downloads")),
            ("dirtyCompactor", "rules", json.dumps([{"source": {"path": "P:\\Data\\hard\\x.mp4"}, "mode": "manual"}])),
            ("dirtyCompactor", "automationPaused", "false"),
            ("dirtyTidy", "automationMode", json.dumps("scan")),
            ("dirtyTidy", "tagUpdateEnabled", "true"),
            ("dirtyTasks", "organization", json.dumps({"automationMode": "scan", "tagUpdateEnabled": True})),
            ("dirtyTasks", "encoding", json.dumps({"automationPaused": False})),
            ("dirtyTasks", "execution", json.dumps({"move": "scan", "rename": "generate", "tags": "scan", "encoding": {"rule-1": "generate"}})),
            ("dirtyStats", "route", json.dumps("/plugins/dirty-stats")),
        ])
        connection.commit()
        connection.close()

    def tearDown(self):
        self.directory.cleanup()

    def rows(self, query):
        connection = sqlite3.connect(self.path)
        try:
            return connection.execute(query).fetchall()
        finally:
            connection.close()

    def test_every_stored_path_moves_below_the_missing_root(self):
        self.assertEqual(stray_paths(self.path, MISSING), ["dirty_plugin_settings.value_json", "folders.path"])
        self.assertEqual(redirect_database(self.path, MISSING), 5)
        self.assertEqual(self.rows("SELECT path FROM folders ORDER BY id"), [
            (MISSING + "\\P\\Data\\hard",), (MISSING + "\\E\\h\\a",), (MISSING + "\\nas\\share\\b",)])
        settings = dict(self.rows("SELECT setting_key, value_json FROM dirty_plugin_settings"))
        self.assertEqual(json.loads(settings["destination"]), MISSING + "\\C\\Users\\someone\\Downloads")
        self.assertEqual(json.loads(settings["rules"]), [{"source": {"path": MISSING + "\\P\\Data\\hard\\x.mp4"}, "mode": "manual"}])
        self.assertEqual(settings["route"], json.dumps("/plugins/dirty-stats"))
        self.assertEqual(self.rows("SELECT details FROM scenes ORDER BY id"),
                         [("Shot at 12:30, see https://example.test/a",), ("plain text",)])
        self.assertEqual(stray_paths(self.path, MISSING), [])
        self.assertEqual(redirect_database(self.path, MISSING), 0)

    def test_paths_inside_longer_text_are_reported_not_ignored(self):
        connection = sqlite3.connect(self.path)
        connection.execute("INSERT INTO scenes(details) VALUES (?)", ("Moved from P:\\Data\\old",))
        connection.commit()
        connection.close()
        redirect_database(self.path, MISSING)
        self.assertEqual(stray_paths(self.path, MISSING), ["scenes.details"])

    def test_scans_in_the_copy_cannot_start_compactor_or_tidy_runs(self):
        pause_automation(self.path)
        settings = dict(self.rows("SELECT setting_key, value_json FROM dirty_plugin_settings"))
        self.assertEqual((settings["automationPaused"], settings["automationMode"]), ("true", '"manual"'))
        self.assertEqual(settings["tagUpdateEnabled"], "false")
        self.assertEqual(json.loads(settings["organization"]), {"automationMode": "manual", "tagUpdateEnabled": False})
        self.assertEqual(json.loads(settings["encoding"]), {"automationPaused": True})
        self.assertEqual(json.loads(settings["execution"]), {"move": "manual", "rename": "manual", "tags": "manual", "encoding": {"rule-1": "manual"}})


if __name__ == "__main__":
    unittest.main()
