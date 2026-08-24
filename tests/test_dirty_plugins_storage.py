import importlib.util
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
        self.assertEqual(all_settings, {"revision": 1, "settings": {"example": first}})

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


if __name__ == "__main__":
    unittest.main()
