"""Check packaged Python provenance and the Python 3.9 syntax floor."""
import ast
import json
import subprocess
import sys
import unittest

from plugin_paths import ROOT, runtime_path


class StagedBackendTests(unittest.TestCase):
    def test_python_syntax_floor(self):
        registry = json.loads((ROOT / "scripts/plugin-registry.json").read_text(encoding="utf-8"))
        for plugin in registry:
            for path in runtime_path(plugin["directory"]).glob("*.py"):
                with self.subTest(path=path.name):
                    ast.parse(path.read_text(encoding="utf-8"), filename=str(path), feature_version=(3, 9))

    def test_same_directory_and_shared_imports_resolve_to_staging(self):
        entries = {
            "DirtyCaptions": "dirty_captions", "DirtyTasks": "dirty_tasks",
            "DirtyFileExtractor": "extract_scenes", "DirtyPlugins": "dirty_plugins",
            "DirtyRank": "dirty_rank", "DirtyStats": "dirty_stats",
        }
        code = """
import importlib, pathlib, sys
staging = pathlib.Path(sys.argv[1]).resolve()
sys.path.insert(0, sys.argv[2])
importlib.import_module(sys.argv[3])
for name, module in list(sys.modules.items()):
    if name.startswith(('dirty_', 'extract_scenes')) and getattr(module, '__file__', None):
        assert staging in pathlib.Path(module.__file__).resolve().parents, (name, module.__file__)
"""
        for plugin, entry in entries.items():
            with self.subTest(plugin=plugin):
                result = subprocess.run([sys.executable, "-B", "-c", code, str(ROOT / ".build/plugins"),
                                         str(runtime_path(plugin)), entry], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
