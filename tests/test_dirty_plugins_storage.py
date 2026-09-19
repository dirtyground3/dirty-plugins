import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "plugins" / "DirtyPlugins" / "dirty_plugins_storage.py"
SPEC = importlib.util.spec_from_file_location("dirty_plugins_storage_tests", MODULE_PATH)
storage = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(storage)


class DirtyPluginsSettingsStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database = Path(self.temp_dir.name) / "dirty_plugins.sqlite3"

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_settings_round_trip_preserves_json_types_and_revision(self):
        first = {
            "enabled": True,
            "limit": 12,
            "ratio": 0.5,
            "name": "Café",
            "categories": ["one", {"weight": 2}],
        }
        result = storage.set_plugin_settings("example", first, self.database)
        self.assertEqual(result["revision"], 1)
        self.assertEqual(storage.get_plugin_settings("example", self.database), first)
        all_settings = storage.get_all_plugin_settings(self.database)
        self.assertEqual(all_settings, {
            "revision": 1,
            "pluginRevisions": {"example": 1},
            "settings": {"example": first},
        })

    def test_stale_writes_are_rejected_by_the_revision_precondition(self):
        storage.set_plugin_settings(
            "example", {"enabled": True}, self.database, expected_revision=0
        )
        self.assertEqual(storage.get_plugin_revision("example", self.database), 1)

        with self.assertRaises(storage.SettingsRevisionConflict):
            storage.set_plugin_settings(
                "example", {"enabled": False}, self.database, expected_revision=0
            )
        self.assertEqual(
            storage.get_plugin_settings("example", self.database), {"enabled": True}
        )

        result = storage.set_plugin_settings(
            "example", {"enabled": False}, self.database, expected_revision=1
        )
        self.assertEqual(result["revision"], 2)
        self.assertEqual(
            storage.get_plugin_settings("example", self.database), {"enabled": False}
        )

    def test_revisions_are_tracked_per_plugin(self):
        storage.set_plugin_settings("first", {"a": 1}, self.database)
        storage.set_plugin_settings("second", {"b": 2}, self.database)
        storage.set_plugin_settings("first", {"a": 2}, self.database)

        all_settings = storage.get_all_plugin_settings(self.database)
        self.assertEqual(all_settings["pluginRevisions"], {"first": 2, "second": 1})
        self.assertEqual(all_settings["revision"], 2)
        self.assertEqual(storage.get_plugin_revision("first", self.database), 2)
        self.assertEqual(storage.get_plugin_revision("second", self.database), 1)

        # A newer write to another plugin must not invalidate this plugin's token.
        storage.set_plugin_settings(
            "first", {"a": 3}, self.database, expected_revision=2
        )
        self.assertEqual(storage.get_plugin_revision("first", self.database), 3)

    def test_saving_replaces_removed_keys_atomically(self):
        storage.set_plugin_settings("example", {"old": 1, "keep": 2}, self.database)
        storage.set_plugin_settings("example", {"keep": 3}, self.database)
        self.assertEqual(storage.get_plugin_settings("example", self.database), {"keep": 3})
        self.assertEqual(storage.get_all_plugin_settings(self.database)["revision"], 2)

    def test_online_backup_contains_settings(self):
        storage.set_plugin_settings("example", {"enabled": True}, self.database)
        destination = Path(self.temp_dir.name) / "backup.sqlite3"
        storage.backup_database(destination, self.database)
        self.assertEqual(storage.get_plugin_settings("example", destination), {"enabled": True})

    def test_plugin_settings_snapshot_pairs_revision_and_values(self):
        storage.set_plugin_settings("example", {"enabled": True}, self.database)
        snapshot = storage.get_plugin_settings_snapshot("example", self.database)
        self.assertEqual(snapshot, {"revision": 1, "settings": {"enabled": True}})

    def test_metadata_round_trip_keeps_namespaces_separate(self):
        self.assertIsNone(storage.get_metadata("example.namespace", "plan", self.database))
        storage.set_metadata("example.namespace", "plan", "first", self.database)
        storage.set_metadata("other.namespace", "plan", "second", self.database)
        storage.set_metadata("example.namespace", "plan", "updated", self.database)

        self.assertEqual(
            storage.get_metadata("example.namespace", "plan", self.database), "updated"
        )
        self.assertEqual(
            storage.get_metadata("other.namespace", "plan", self.database), "second"
        )

    def test_settings_can_reuse_a_caller_owned_connection(self):
        storage.set_plugin_settings("example", {"enabled": True}, self.database)
        connection = storage.connect(self.database)
        try:
            self.assertEqual(
                storage.get_plugin_settings("example", connection=connection),
                {"enabled": True},
            )
            self.assertEqual(connection.execute("SELECT 1").fetchone()[0], 1)
        finally:
            connection.close()

    def _schema_version(self):
        connection = sqlite3.connect(self.database)
        try:
            row = connection.execute(
                "SELECT version FROM dirty_schema_versions WHERE plugin_id='dirtyPlugins'"
            ).fetchone()
            return row[0] if row else None
        finally:
            connection.close()

    def test_fresh_database_is_stamped_with_the_current_schema_version(self):
        connection = storage.connect(self.database)
        connection.close()

        self.assertEqual(
            self._schema_version(), storage.STORAGE_SCHEMA_VERSION
        )

    def test_older_schema_version_is_upgraded_in_place(self):
        # Simulate a database created before the current schema was stamped.
        connection = sqlite3.connect(self.database)
        connection.executescript(
            """
            CREATE TABLE dirty_schema_versions (
              plugin_id TEXT PRIMARY KEY, version INTEGER NOT NULL, applied_at TEXT NOT NULL
            );
            CREATE TABLE dirty_plugin_settings (
              plugin_id TEXT NOT NULL, setting_key TEXT NOT NULL, value_json TEXT NOT NULL,
              updated_at TEXT NOT NULL, PRIMARY KEY (plugin_id, setting_key)
            );
            INSERT INTO dirty_schema_versions VALUES ('dirtyPlugins', 0, '2020-01-01T00:00:00Z');
            """
        )
        connection.commit()
        connection.close()

        connection = storage.connect(self.database)
        connection.close()

        self.assertEqual(self._schema_version(), storage.STORAGE_SCHEMA_VERSION)
        # Upgrading must preserve existing settings rows.
        storage.set_plugin_settings("example", {"enabled": True}, self.database)
        self.assertEqual(
            storage.get_plugin_settings("example", self.database), {"enabled": True}
        )

    def test_newer_schema_version_is_rejected(self):
        connection = sqlite3.connect(self.database)
        connection.executescript(
            """
            CREATE TABLE dirty_schema_versions (
              plugin_id TEXT PRIMARY KEY, version INTEGER NOT NULL, applied_at TEXT NOT NULL
            );
            INSERT INTO dirty_schema_versions VALUES ('dirtyPlugins', 99, '2099-01-01T00:00:00Z');
            """
        )
        connection.commit()
        connection.close()

        with self.assertRaises(RuntimeError) as raised:
            storage.connect(self.database)
        self.assertIn("newer than this runtime supports", str(raised.exception))

    def test_corrupt_json_rows_fail_loudly_instead_of_returning_garbage(self):
        storage.set_plugin_settings("example", {"enabled": True}, self.database)
        connection = sqlite3.connect(self.database)
        connection.execute(
            "INSERT INTO dirty_plugin_settings(plugin_id, setting_key, value_json, updated_at) "
            "VALUES ('example', 'broken', '{not json', '2026-01-01T00:00:00Z')"
        )
        connection.commit()
        connection.close()

        # The snapshot must not silently drop or mis-report the corrupt row.
        with self.assertRaises(json.JSONDecodeError):
            storage.get_plugin_settings("example", self.database)
        with self.assertRaises(json.JSONDecodeError):
            storage.get_all_plugin_settings(self.database)


if __name__ == "__main__":
    unittest.main()
