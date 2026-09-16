import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("dirty_stats", Path(__file__).resolve().parents[1] / "plugins/DirtyStats/dirty_stats.py")
stats = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stats)


class CapacityTests(unittest.TestCase):
    def test_shared_volume_and_inaccessible_source(self):
        def identity(path):
            if path == "offline":
                raise OSError("offline")
            return "one" if path.startswith("first") else "two"

        result = stats.capacities(["first/a", "first/b", "second", "offline", "second"],
                                  identity=identity, usage=lambda p: SimpleNamespace(total=100 if p.startswith("first") else 200))
        self.assertEqual(result["total"], 300)
        self.assertEqual(len(result["volumes"]), 2)
        self.assertEqual(result["volumes"][0]["sources"], ["first/a", "first/b"])
        self.assertEqual(result["errors"][0]["path"], "offline")

    def test_no_sources(self):
        self.assertEqual(stats.capacities([]), {"total": 0, "volumes": [], "errors": []})


if __name__ == "__main__":
    unittest.main()
