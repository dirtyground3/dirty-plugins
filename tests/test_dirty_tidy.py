import importlib.util
import io
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock


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
        "stash_ids": [],
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
    def test_grade_maps_rating_to_alphabetically_sorted_letters(self):
        expected = {
            100: "A",
            90: "A",
            89: "B",
            80: "B",
            79: "C",
            70: "C",
            69: "D",
            60: "D",
            59: "E",
            50: "E",
            49: "F",
            0: "F",
            None: "Unknown",
        }

        for rating, grade in expected.items():
            with self.subTest(rating=rating):
                self.assertEqual(dirty_tidy._grade(rating), grade)

    def test_grade_can_be_used_in_folder_hierarchy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "video.mp4"
            source.write_bytes(b"video")

            operation = dirty_tidy.build_plan(
                [str(root)],
                [scene(source, rating100=94)],
                {
                    "moveEnabled": True,
                    "hierarchyLevels": ["{grade}"],
                    "renameEnabled": False,
                },
            )["operations"][0]

            self.assertEqual(Path(operation["destination_folder"]), root / "A")

    def test_stash_id_variable_uses_the_first_sorted_external_id(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "video.mp4"
            source.write_bytes(b"video")
            value = scene(
                source,
                stash_ids=[
                    {"stash_id": "z-id"},
                    {"stash_id": "a-id"},
                    {"stash_id": "a-id"},
                ],
            )

            variables = dirty_tidy.scene_variables(
                value,
                value["files"][0],
                str(root),
                ", ",
            )
            self.assertEqual(variables["stash_id"], "a-id")

            operation = dirty_tidy.build_plan(
                [str(root)],
                [value],
                {
                    "moveEnabled": False,
                    "renameEnabled": True,
                    "renamePattern": "{stash_id} - {title}",
                },
            )["operations"][0]
            self.assertEqual(
                operation["destination_basename"],
                "a-id - Example Scene.mp4",
            )

    def test_parent_studio_falls_back_to_studio_name(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "video.mp4"
            source.write_bytes(b"video")
            value = scene(source, studio={"name": "Independent Studio", "parent_studio": None})

            variables = dirty_tidy.scene_variables(
                value,
                value["files"][0],
                str(root),
                ", ",
            )

            self.assertEqual(variables["studio"], "Independent Studio")
            self.assertEqual(variables["parent_studio"], "Independent Studio")

    def test_parent_studio_prefers_the_actual_parent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "video.mp4"
            source.write_bytes(b"video")
            value = scene(
                source,
                studio={
                    "name": "Child Studio",
                    "parent_studio": {"name": "Parent Studio"},
                },
            )

            variables = dirty_tidy.scene_variables(
                value,
                value["files"][0],
                str(root),
                ", ",
            )

            self.assertEqual(variables["parent_studio"], "Parent Studio")

    def test_missing_stash_id_is_omitted_from_filename(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "video.mp4"
            source.write_bytes(b"video")

            operation = dirty_tidy.build_plan(
                [str(root)],
                [scene(source)],
                {
                    "moveEnabled": False,
                    "renameEnabled": True,
                    "renamePattern": "{stash_id} - {title}",
                },
            )["operations"][0]

            self.assertEqual(operation["destination_basename"], "Example Scene.mp4")
            self.assertIn(
                "Skipped empty filename variables: stash_id",
                operation["warnings"],
            )

    def test_plugin_output_is_safe_on_legacy_windows_code_pages(self):
        buffer = io.BytesIO()
        stream = io.TextIOWrapper(buffer, encoding="cp1252", errors="strict")
        expected = "日本語のシーン 🎬"

        dirty_tidy.emit_output({"scene_title": expected}, stream)
        stream.flush()
        decoded = json.loads(buffer.getvalue().decode("ascii"))

        self.assertEqual(decoded["output"]["scene_title"], expected)

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

    def test_rename_supports_gender_specific_performer_variables(self):
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
                    "renamePattern": "{female_performers} - {male_performers}",
                },
            )

            operation = plan["operations"][0]
            self.assertEqual(operation["status"], "ready")
            self.assertEqual(operation["destination_basename"], "Alice, Zoe - Bob.mp4")

            variables = dirty_tidy.scene_variables(
                scene(
                    source,
                    performers=[
                        {"name": "Zoe", "gender": "FEMALE"},
                        {"name": "Bob", "gender": "MALE"},
                        {"name": "Alice", "gender": "FEMALE"},
                    ],
                ),
                scene(source)["files"][0],
                str(root),
                ", ",
            )
            self.assertEqual(variables["female_performers"], "Alice, Zoe")
            self.assertEqual(variables["females_performers"], "Alice, Zoe")
            self.assertEqual(variables["male_performers"], "Bob")
            self.assertEqual(variables["first_female_performer"], "Alice")
            self.assertEqual(variables["first_male_performer"], "Bob")

    def test_all_missing_filename_variables_keep_the_original_name(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "original.mp4"
            source.write_bytes(b"video")

            operation = dirty_tidy.build_plan(
                [str(root)],
                [scene(source)],
                {
                    "moveEnabled": False,
                    "renameEnabled": True,
                    "renamePattern": "{studio}-{year}",
                },
            )["operations"][0]

            self.assertEqual(operation["status"], "unchanged")
            self.assertEqual(operation["destination_basename"], "original.mp4")
            self.assertIn(
                "Kept the original filename because all filename variables are missing.",
                operation["warnings"],
            )

    def test_missing_filename_variables_are_skipped_without_unknown_placeholders(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "original.mp4"
            source.write_bytes(b"video")

            operation = dirty_tidy.build_plan(
                [str(root)],
                [scene(source, date="2026-08-20")],
                {
                    "moveEnabled": False,
                    "renameEnabled": True,
                    "renamePattern": "{date} - {studio} - {title}",
                },
            )["operations"][0]

            self.assertEqual(
                operation["destination_basename"],
                "2026-08-20 - Example Scene.mp4",
            )
            self.assertNotIn("Unknown", operation["destination_basename"])
            self.assertIn(
                "Skipped empty filename variables: studio",
                operation["warnings"],
            )

    def test_rename_separator_cleanup_handles_common_template_styles(self):
        variables = {"title": "Example", "studio": "Unknown", "year": "2026"}
        expected = {
            "{title} - {studio} - {year}": "Example - 2026",
            "{title}-{studio}-{year}": "Example-2026",
            "{title}_{studio}_{year}": "Example_2026",
            "{title} [{studio}]": "Example",
            "{studio} - {title}": "Example",
        }

        for template, rendered in expected.items():
            with self.subTest(template=template):
                value, missing, invalid = dirty_tidy.render_rename_template(
                    template, variables
                )
                self.assertEqual(value, rendered)
                self.assertEqual(missing, ["studio"])
                self.assertEqual(invalid, [])

    def test_move_and_rename_can_independently_require_a_stash_id(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "incoming" / "original.mp4"
            source.parent.mkdir()
            source.write_bytes(b"video")
            value = scene(source)
            common = {
                "moveEnabled": True,
                "hierarchyLevels": ["Organized"],
                "renameEnabled": True,
                "renamePattern": "{title}",
            }

            rename_only = dirty_tidy.build_plan(
                [str(root)],
                [value],
                dict(common, moveRequireStashId=True, renameRequireStashId=False),
            )["operations"][0]
            self.assertEqual(rename_only["actions"], ["rename"])
            self.assertIn("Skipped move because the scene has no Stash ID.", rename_only["warnings"])

            move_only = dirty_tidy.build_plan(
                [str(root)],
                [value],
                dict(common, moveRequireStashId=False, renameRequireStashId=True),
            )["operations"][0]
            self.assertEqual(move_only["actions"], ["move"])
            self.assertIn("Skipped rename because the scene has no Stash ID.", move_only["warnings"])

            neither = dirty_tidy.build_plan(
                [str(root)],
                [value],
                dict(common, moveRequireStashId=True, renameRequireStashId=True),
            )["operations"][0]
            self.assertEqual(neither["status"], "unchanged")
            self.assertEqual(neither["actions"], [])

            value["stash_ids"] = [{"stash_id": "external-scene-id"}]
            both = dirty_tidy.build_plan(
                [str(root)],
                [value],
                dict(common, moveRequireStashId=True, renameRequireStashId=True),
            )["operations"][0]
            self.assertEqual(both["actions"], ["move", "rename"])

    def test_first_tag_renames_tagged_scene_and_preserves_untagged_name(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tagged = root / "tagged.mp4"
            untagged = root / "untagged.mp4"
            tagged.write_bytes(b"tagged")
            untagged.write_bytes(b"untagged")
            tagged_scene = scene(
                tagged,
                tags=[{"name": "Zulu"}, {"name": "Alpha"}],
            )
            untagged_scene = scene(untagged)
            untagged_scene["id"] = "2"
            untagged_scene["files"][0]["id"] = "20"

            plan = dirty_tidy.build_plan(
                [str(root)],
                [tagged_scene, untagged_scene],
                {
                    "moveEnabled": False,
                    "renameEnabled": True,
                    "renamePattern": "{first_tag}",
                },
            )
            operations = {item["file_id"]: item for item in plan["operations"]}

            self.assertEqual(operations["10"]["destination_basename"], "Alpha.mp4")
            self.assertEqual(operations["10"]["status"], "ready")
            self.assertEqual(operations["20"]["destination_basename"], "untagged.mp4")
            self.assertEqual(operations["20"]["status"], "unchanged")

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
            self.assertTrue(
                all(
                    [scene["id"] for scene in item["blocked_scenes"]] == ["1", "2"]
                    for item in plan["operations"]
                )
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
        self.assertEqual(settings["approvedPlanDigest"], "")

    def test_automation_mode_and_plan_digest_are_normalized(self):
        digest = "b" * 64
        settings = dirty_tidy.normalize_settings(
            {
                "automationMode": "scan",
                "approvedStrategyHash": "A" * 64,
                "approvedPlanDigest": digest.upper(),
            }
        )

        self.assertEqual(settings["approvedStrategyHash"], "a" * 64)
        self.assertEqual(settings["approvedPlanDigest"], digest)
        self.assertEqual(
            dirty_tidy.normalize_settings({"approvedPlanDigest": "not-a-digest"})[
                "approvedPlanDigest"
            ],
            "",
        )


class DirtyTidyPlanIntegrityTests(unittest.TestCase):
    class SnapshotClient:
        def __init__(self, root, scenes):
            self.root = root
            self.scenes = scenes
            self.moves = []

        def library_snapshot(self):
            return [str(self.root)], self.scenes

        def move_file(self, operation):
            self.moves.append(operation)
            return True

    def _second_scene(self, path, title, scene_id, file_id):
        value = scene(path, id=scene_id, title=title)
        value["files"][0]["id"] = file_id
        return value

    def test_execute_applies_only_operations_from_the_confirmed_preview(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = root / "dirty_plugins.sqlite3"
            ready_file = root / "ready.mp4"
            late_file = root / "late.mp4"
            ready_file.write_bytes(b"ready")

            ready_scene = scene(ready_file, title="Ready Scene")
            late_scene = self._second_scene(late_file, "Late Scene", "2", "20")
            client = self.SnapshotClient(root, [ready_scene, late_scene])
            settings = {
                "moveEnabled": False,
                "renameEnabled": True,
                "renamePattern": "{title}",
            }

            with mock.patch.dict(
                os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(database)}
            ):
                preview = dirty_tidy.preview_plan(
                    client, settings, include_all=True, record_review=True
                )
                self.assertEqual(preview["summary"]["ready"], 1)
                self.assertEqual(preview["summary"]["warnings"], 1)

                # The previously missing file becomes available after the preview.
                late_file.write_bytes(b"late")
                result = dirty_tidy.execute_plan(
                    client, settings, preview["strategy_hash"], dirty_tidy.Reporter()
                )

            self.assertEqual(result["completed"], 1)
            self.assertEqual(result["unreviewed"], 1)
            self.assertEqual(
                [operation["source_path"] for operation in client.moves],
                [str(ready_file)],
            )

    def test_execute_requires_a_recorded_preview(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = root / "dirty_plugins.sqlite3"
            source = root / "video.mp4"
            source.write_bytes(b"video")
            client = self.SnapshotClient(root, [scene(source)])
            settings = {
                "moveEnabled": False,
                "renameEnabled": True,
                "renamePattern": "{title}",
            }

            with mock.patch.dict(
                os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(database)}
            ):
                plan = dirty_tidy.build_plan([str(root)], [scene(source)], settings)
                with self.assertRaises(dirty_tidy.PluginError):
                    dirty_tidy.execute_plan(
                        client, settings, plan["strategy_hash"], dirty_tidy.Reporter()
                    )

    def test_automation_rejects_a_plan_that_changed_after_approval(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = root / "dirty_plugins.sqlite3"
            approved_file = root / "approved.mp4"
            later_file = root / "later.mp4"
            approved_file.write_bytes(b"approved")

            approved_scene = scene(approved_file, title="Approved Scene")
            later_scene = self._second_scene(later_file, "Later Scene", "2", "20")
            settings = {
                "moveEnabled": False,
                "renameEnabled": True,
                "renamePattern": "{title}",
                "automationMode": "scan",
            }

            with mock.patch.dict(
                os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(database)}
            ):
                approved_plan = dirty_tidy.build_plan(
                    [str(root)], [approved_scene], settings
                )
                later_file.write_bytes(b"later")
                client = self.SnapshotClient(root, [approved_scene, later_scene])
                settings["approvedStrategyHash"] = approved_plan["strategy_hash"]
                settings["approvedPlanDigest"] = approved_plan["plan_digest"]

                with self.assertRaises(dirty_tidy.PluginError):
                    dirty_tidy.execute_plan(
                        client,
                        settings,
                        approved_plan["strategy_hash"],
                        dirty_tidy.Reporter(),
                        approved_plan["plan_digest"],
                    )

    def test_reviewed_plan_round_trips_through_shared_storage(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = root / "dirty_plugins.sqlite3"
            source = root / "video.mp4"
            source.write_bytes(b"video")
            settings = {
                "moveEnabled": False,
                "renameEnabled": True,
                "renamePattern": "{title}",
            }
            plan = dirty_tidy.build_plan([str(root)], [scene(source)], settings)

            with mock.patch.dict(
                os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(database)}
            ):
                self.assertIsNone(
                    dirty_tidy.load_reviewed_plan(plan["strategy_hash"])
                )
                dirty_tidy.save_reviewed_plan(plan)
                reviewed = dirty_tidy.load_reviewed_plan(plan["strategy_hash"])

            self.assertEqual(
                reviewed,
                {
                    dirty_tidy.operation_key(
                        next(
                            operation
                            for operation in plan["operations"]
                            if operation["status"] == "ready"
                        )
                    )
                },
            )


if __name__ == "__main__":
    unittest.main()
