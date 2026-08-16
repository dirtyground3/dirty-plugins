import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "plugins" / "DirtyTidy" / "dirty_tidy.py"
SPEC = importlib.util.spec_from_file_location("dirty_tidy", MODULE_PATH)
dirty_tidy = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(dirty_tidy)


def scene(file_path, **overrides):
    value = {
        "id": "1",
        "title": "Example Scene",
        "date": None,
        "rating100": None,
        "organized": True,
        "studio": None,
        "performers": [],
        "tags": [],
        "groups": [],
        "files": [
            {
                "id": "10",
                "path": str(file_path),
                "basename": file_path.name,
                "duration": 900,
                "width": 1920,
                "height": 1080,
                "video_codec": "h264",
            }
        ],
    }
    value.update(overrides)
    return value


class DirtyTidyTests(unittest.TestCase):
    def test_missing_values_render_as_unknown_and_move_preserves_basename(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "incoming" / "video.mp4"
            source.parent.mkdir()
            source.write_bytes(b"video")

            plan = dirty_tidy.build_plan(
                [str(root)],
                [scene(source)],
                {
                    "moveEnabled": True,
                    "hierarchyLevels": ["{studio}", "{year}"],
                    "renameEnabled": False,
                },
            )

            operation = plan["operations"][0]
            self.assertEqual(operation["status"], "ready")
            self.assertEqual(operation["destination_basename"], "video.mp4")
            self.assertEqual(
                Path(operation["destination_path"]),
                root / "Unknown" / "Unknown" / "video.mp4",
            )
            self.assertIn("Used Unknown for: studio, year", operation["warnings"])

    def test_rename_removes_invalid_characters_and_preserves_extension(self):
        filename, error = dirty_tidy.sanitize_filename(
            'Bad<>:"/\\|?* Name',
            ".mp4",
            16,
        )

        self.assertIsNone(error)
        self.assertEqual(filename, "Bad Name.mp4")
        self.assertLessEqual(len(filename), 16)

    def test_rename_supports_first_female_and_male_performer(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "video.mp4"
            source.write_bytes(b"video")

            plan = dirty_tidy.build_plan(
                [str(root)],
                [
                    scene(
                        source,
                        performers=[
                            {"name": "Zoe", "gender": "FEMALE"},
                            {"name": "Bob", "gender": "MALE"},
                            {"name": "Alice", "gender": "FEMALE"},
                        ],
                    )
                ],
                {
                    "moveEnabled": False,
                    "renameEnabled": True,
                    "renamePattern": "{first_female_performer} - {first_male_performer}",
                },
            )

            operation = plan["operations"][0]
            self.assertEqual(operation["status"], "ready")
            self.assertEqual(operation["destination_basename"], "Alice - Bob.mp4")

            variables = dirty_tidy.scene_variables(
                scene(source),
                scene(source)["files"][0],
                str(root),
                ", ",
            )
            self.assertEqual(variables["first_female_performer"], "Unknown")
            self.assertEqual(variables["first_male_performer"], "Unknown")

    def test_longest_matching_source_root_is_used(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            nested = root / "nested"
            nested.mkdir()
            source = nested / "video.mp4"
            source.write_bytes(b"video")

            self.assertEqual(
                dirty_tidy.find_source_root(str(source), [str(root), str(nested)]),
                str(nested),
            )

    def test_missing_file_record_is_a_warning_and_does_not_block_live_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            live = root / "live.mp4"
            missing = root / "old-location.mp4"
            live.write_bytes(b"video")
            scene_with_stale_record = scene(live)
            scene_with_stale_record["files"].append(
                {
                    "id": "20",
                    "path": str(missing),
                    "basename": missing.name,
                    "duration": 900,
                    "width": 1920,
                    "height": 1080,
                    "video_codec": "h264",
                }
            )

            plan = dirty_tidy.build_plan(
                [str(root)],
                [scene_with_stale_record],
                {
                    "moveEnabled": False,
                    "renameEnabled": True,
                    "renamePattern": "{title}",
                },
            )

            operations = {operation["file_id"]: operation for operation in plan["operations"]}
            self.assertEqual(operations["10"]["status"], "ready")
            self.assertEqual(operations["20"]["status"], "warning")
            self.assertIn("Skipped", operations["20"]["warnings"][0])
            self.assertEqual(plan["summary"]["warnings"], 1)
            self.assertEqual(plan["summary"]["blocked"], 0)

    def test_preview_filters_before_pagination(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            live = root / "live.mp4"
            missing = root / "missing.mp4"
            live.write_bytes(b"video")
            value = scene(live)
            value["files"].append(
                {
                    "id": "20",
                    "path": str(missing),
                    "basename": missing.name,
                    "duration": 900,
                    "width": 1920,
                    "height": 1080,
                    "video_codec": "h264",
                }
            )

            class SnapshotClient:
                def library_snapshot(self):
                    return [str(root)], [value]

            preview = dirty_tidy.preview_plan(
                SnapshotClient(),
                {
                    "moveEnabled": False,
                    "renameEnabled": True,
                    "renamePattern": "{title}",
                },
                page=1,
                per_page=1,
                status_filter="warning",
            )

            self.assertEqual(preview["filter"], "warning")
            self.assertEqual(preview["total"], 2)
            self.assertEqual(preview["filtered_total"], 1)
            self.assertEqual(preview["pages"], 1)
            self.assertEqual([item["status"] for item in preview["operations"]], ["warning"])

            complete_preview = dirty_tidy.preview_plan(
                SnapshotClient(),
                {
                    "moveEnabled": False,
                    "renameEnabled": True,
                    "renamePattern": "{title}",
                },
                page=1,
                per_page=1,
                include_all=True,
            )

            self.assertEqual(complete_preview["total"], 2)
            self.assertEqual(len(complete_preview["operations"]), 2)
            self.assertEqual(complete_preview["pages"], 1)

    def test_duplicate_destinations_are_blocked(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            first = root / "a" / "first.mp4"
            second = root / "b" / "second.mp4"
            first.parent.mkdir()
            second.parent.mkdir()
            first.write_bytes(b"first")
            second.write_bytes(b"second")
            first_scene = scene(first)
            second_scene = scene(second)
            second_scene["id"] = "2"
            second_scene["files"][0]["id"] = "20"

            plan = dirty_tidy.build_plan(
                [str(root)],
                [first_scene, second_scene],
                {
                    "moveEnabled": True,
                    "hierarchyLevels": ["Organized"],
                    "renameEnabled": True,
                    "renamePattern": "same-name",
                },
            )

            self.assertEqual(plan["summary"]["blocked"], 2)
            self.assertTrue(
                all("same destination" in item["warnings"][-1] for item in plan["operations"])
            )

    def test_unknown_template_variable_blocks_the_operation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "video.mp4"
            source.write_bytes(b"video")

            operation = dirty_tidy.build_plan(
                [str(root)],
                [scene(source)],
                {
                    "moveEnabled": True,
                    "hierarchyLevels": ["{not_a_variable}"],
                    "renameEnabled": False,
                },
            )["operations"][0]

            self.assertEqual(operation["status"], "blocked")
            self.assertIn("Unknown variables: not_a_variable", operation["warnings"])

    def test_strategy_hash_is_stable_after_normalization(self):
        left = dirty_tidy.normalize_settings({"hierarchyLevels": ["{studio}"]})
        right = dirty_tidy.normalize_settings({"hierarchyLevels": ["{studio}"]})
        self.assertEqual(dirty_tidy.strategy_hash(left), dirty_tidy.strategy_hash(right))

    def test_automation_mode_and_approval_do_not_change_strategy_hash(self):
        approved = "a" * 64
        manual = dirty_tidy.normalize_settings({"hierarchyLevels": ["{studio}"]})
        automated = dirty_tidy.normalize_settings(
            {
                "hierarchyLevels": ["{studio}"],
                "automationMode": "generate",
                "approvedStrategyHash": approved,
            }
        )

        self.assertEqual(automated["automationMode"], "generate")
        self.assertEqual(automated["approvedStrategyHash"], approved)
        self.assertEqual(dirty_tidy.strategy_hash(manual), dirty_tidy.strategy_hash(automated))

    def test_invalid_automation_settings_are_safe(self):
        settings = dirty_tidy.normalize_settings(
            {"automationMode": "anything", "approvedStrategyHash": "not-a-hash"}
        )

        self.assertEqual(settings["automationMode"], "manual")
        self.assertEqual(settings["approvedStrategyHash"], "")


if __name__ == "__main__":
    unittest.main()
