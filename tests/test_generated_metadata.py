"""Staged Python settings metadata equals its schema and keeps Python's number types."""
from plugin_paths import ROOT, runtime_path
import importlib.util
import json
import unittest


def load(path):
    spec = importlib.util.spec_from_file_location(path.stem, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GeneratedMetadataTests(unittest.TestCase):
    def test_staged_modules_match_their_schemas(self):
        registry = json.loads((ROOT / "scripts" / "plugin-registry.json").read_text(encoding="utf-8"))
        generated = [(plugin, name) for plugin in registry for name in plugin.get("generatedFiles", [])]
        self.assertEqual(sorted(name for _plugin, name in generated), ["dirty_compactor_metadata.py", "dirty_plugins_metadata.py", "dirty_rank_metadata.py", "dirty_tidy_metadata.py"])
        for plugin, name in generated:
            with self.subTest(module=name):
                schema = json.loads((ROOT / "schemas" / (plugin["id"] + ".settings.json")).read_text(encoding="utf-8"))
                module = load(runtime_path(plugin["directory"], name))
                settings = schema["settings"]
                defaults = {key: value["default"] for key, value in settings.items() if "default" in value}
                limits = {key: {bound: value[bound] for bound in ("min", "max", "step") if bound in value}
                          for key, value in settings.items() if any(bound in value for bound in ("min", "max", "step"))}
                self.assertEqual(module.DEFAULTS, defaults)
                self.assertEqual(list(module.DEFAULTS), list(defaults))
                self.assertEqual(module.LIMITS, limits)
                self.assertEqual(module.OPTIONS, {key: value["options"] for key, value in settings.items() if "options" in value})
                self.assertEqual(module.CONSTANTS, schema.get("constants", {}))
                for key, setting in settings.items():
                    if setting["type"] != "NUMBER":
                        continue
                    expected = int if setting.get("integer") else float
                    for value in [module.DEFAULTS.get(key), *module.LIMITS.get(key, {}).values()]:
                        if value is not None:
                            self.assertIs(type(value), expected, key)

    def test_rank_backend_keeps_float_defaults(self):
        rank = load(runtime_path("DirtyRank", "dirty_rank_metadata.py"))
        self.assertEqual(repr(rank.DEFAULTS["initialRating"]), "1000.0")
        self.assertEqual(repr(rank.LIMITS["initialDeviation"]), "{'min': 30.0, 'max': 1000.0, 'step': 1.0}")
        self.assertEqual(repr(rank.DEFAULTS["confidenceTopN"]), "20")


if __name__ == "__main__":
    unittest.main()
