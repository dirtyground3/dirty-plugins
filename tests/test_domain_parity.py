from plugin_paths import runtime_path
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
for plugin in ("DirtyRank", "DirtyTasks"):
    sys.path.insert(0, str(runtime_path(plugin)))
import dirty_rank as rank
import dirty_compactor_rules as compactor
import dirty_compactor_quality as quality


class DomainParityTests(unittest.TestCase):
    def test_shared_fixtures(self):
        fixture = json.loads((ROOT / "tests" / "fixtures" / "domain-parity.json").read_text(encoding="utf-8"))
        for example in fixture["rank"]:
            with self.subTest(example=example["name"]):
                normalized = rank.normalize_settings(example["input"])
                # The backend stores an explicit order; browser arrays encode it.
                for categories in normalized["categoriesByCohort"].values():
                    for index, category in enumerate(categories):
                        self.assertEqual(category.pop("order"), index)
                self.assertEqual({key: normalized[key] for key in example["expected"]}, example["expected"])
        for example in fixture["compactor"]:
            with self.subTest(example=example["name"]):
                size = compactor.dimensions(example["width"], example["height"], example["rule"])
                self.assertEqual(list(size), example["expected"]["size"])
                self.assertAlmostEqual(compactor.target_mbps(example["rule"], *size, example.get("fps"), example.get("sourceBitrate")), example["expected"]["mbps"])
        for example in fixture["presets"]:
            self.assertEqual(compactor.visual_preset(example["vmaf"]), example["preset"])
            self.assertEqual(quality.CRF[example["codec"]][example["preset"]], example["crf"])
