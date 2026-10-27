from plugin_paths import runtime_path
import importlib.util
import io
import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import mock


MODULE_PATH = runtime_path("DirtyTasks", "dirty_tidy.py")
SPEC = importlib.util.spec_from_file_location("dirty_tidy", MODULE_PATH)
dirty_tidy = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(dirty_tidy)
import dirty_tidy_templates as templates  # noqa: E402  (on sys.path once dirty_tidy is loaded)


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
    def test_snapshot_fields_follow_only_enabled_strategy_inputs(self):
        settings = dirty_tidy.normalize_settings({"moveEnabled": False, "renameEnabled": True,
            "renameRequireStashId": False, "renamePattern": "{title}-{original_name}"})
        self.assertEqual(dirty_tidy.snapshot_fields(settings), "id title files { id path basename }")
        settings.update(moveEnabled=True, moveRequireStashId=True, hierarchyLevels=["{year}", "{first_performer}", "{parent_studio}"],
                        renamePattern="{group}-{grade}-{height}-{duration_bucket}-{video_codec}")
        fields = dirty_tidy.snapshot_fields(settings)
        for needed in ("date", "performers { name gender }", "studio { name parent_studio { name } }", "groups { scene_index group { name } }",
                       "rating100", "stash_ids { stash_id }", "height", "duration", "video_codec"):
            self.assertIn(needed, fields)
        self.assertNotIn("tags", fields)
        self.assertNotIn("width", fields)
        self.assertNotIn("organized", fields)

    def test_plan_reuses_normalized_paths_and_scene_values_without_changing_operations(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            value = scene(root / "first.mp4", performers=[{"name": "One", "gender": "FEMALE"}], tags=[{"name": "Tag"}])
            for index, name in enumerate(("second.mp4", "third.mp4"), 20):
                value["files"].append({**value["files"][0], "id": str(index), "path": str(root / name), "basename": name})
            for file in value["files"]:
                Path(file["path"]).write_bytes(b"synthetic media")
            settings = dirty_tidy.normalize_settings({"moveEnabled": True, "moveRequireStashId": False,
                "hierarchyLevels": ["{first_performer}"], "renameEnabled": True, "renameRequireStashId": False,
                "renamePattern": "{title}-{original_name}-{source}"})
            roots = [str(root), str(root / "unrelated")]
            with mock.patch.object(templates, "_normalized_path", wraps=templates._normalized_path) as baseline:
                expected = [dirty_tidy.build_operation(value, file, roots, settings) for file in value["files"]]
                previous_calls = baseline.call_count
            with mock.patch.object(dirty_tidy, "_normalized_path", wraps=dirty_tidy._normalized_path) as normalized, \
                 mock.patch.object(dirty_tidy, "scene_template_variables", wraps=dirty_tidy.scene_template_variables) as variables:
                plan = dirty_tidy.build_plan(roots, [value], settings)
                self.assertEqual(variables.call_count, 1)
                self.assertLess(normalized.call_count, previous_calls / 2)
                self.assertEqual(sum(call.args[0] == str(root) for call in normalized.call_args_list), 1)
            self.assertEqual(plan["operations"], expected)
            # A second plan recomputes filesystem identities instead of retaining the first cache.
            with mock.patch.object(dirty_tidy, "_normalized_path", wraps=dirty_tidy._normalized_path) as normalized:
                dirty_tidy.build_plan(roots, [value], settings)
                self.assertEqual(sum(call.args[0] == str(root) for call in normalized.call_args_list), 1)

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
                self.assertEqual(templates._grade(rating), grade)

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
        filename, error = templates.sanitize_filename(
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
                value, missing, invalid = templates.render_rename_template(
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

    def test_preview_returns_the_complete_plan(self):
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
                def library_snapshot(self, settings):
                    return [str(root)], [value]

            # The settings panel filters and pages locally; the backend returns everything.
            preview = dirty_tidy.preview_plan(
                SnapshotClient(),
                {
                    "moveEnabled": False,
                    "renameEnabled": True,
                    "renamePattern": "{title}",
                },
            )

            self.assertEqual(preview["total"], 2)
            self.assertEqual(sorted(item["status"] for item in preview["operations"]), ["ready", "warning"])

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
        self.assertFalse(settings["tagUpdateEnabled"])
        self.assertEqual(settings["taggerEndpoint"], "")

    def test_tag_settings_normalize_without_changing_file_approval(self):
        settings = dirty_tidy.normalize_settings({"tagUpdateEnabled": "yes",
                                                "taggerEndpoint": " https://stashdb.org/graphql "})
        self.assertTrue(settings["tagUpdateEnabled"])
        self.assertEqual(settings["taggerEndpoint"], "https://stashdb.org/graphql")
        self.assertEqual(dirty_tidy.strategy_hash(settings), dirty_tidy.strategy_hash({}))
        self.assertEqual(dirty_tidy.normalize_settings({"taggerEndpoint": []})["taggerEndpoint"], "")

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

    def test_normalize_settings_keeps_explicit_empty_levels_and_pattern(self):
        # An all-empty list must stay empty: the backend would plan with no
        # hierarchy levels, so silently restoring the defaults would make the
        # preview's strategy hash differ from the saved settings.
        settings = dirty_tidy.normalize_settings(
            {
                "hierarchyLevels": [],
                "renamePattern": "",
                "multiValueSeparator": None,
                "maxFilenameLength": None,
            }
        )

        self.assertEqual(settings["hierarchyLevels"], [])
        self.assertEqual(settings["renamePattern"], "")
        self.assertEqual(
            settings["multiValueSeparator"],
            dirty_tidy.DEFAULT_SETTINGS["multiValueSeparator"],
        )
        self.assertEqual(
            settings["maxFilenameLength"],
            dirty_tidy.DEFAULT_SETTINGS["maxFilenameLength"],
        )

    def test_normalize_settings_is_the_canonical_ui_contract(self):
        # Mirrored by dirtyTidy.js settingsFromConfiguration; keep both sides in
        # sync with tests/test_dirty_tidy_settings.js.
        settings = dirty_tidy.normalize_settings(
            {
                "hierarchyLevels": ["  {studio} ", "", " {year}"],
                "renamePattern": "  {title}  ",
                "maxFilenameLength": "250",
                "multiValueSeparator": "abcdefghijklmnop",
                "automationMode": " Scan ",
                "moveEnabled": "yes",
            }
        )

        self.assertEqual(settings["hierarchyLevels"], ["{studio}", "{year}"])
        self.assertEqual(settings["renamePattern"], "{title}")
        self.assertEqual(settings["maxFilenameLength"], 250)
        self.assertEqual(settings["multiValueSeparator"], "abcdefghij")
        self.assertEqual(settings["automationMode"], "scan")
        self.assertIs(settings["moveEnabled"], True)
        self.assertEqual(
            dirty_tidy.normalize_settings({"hierarchyLevels": None})["hierarchyLevels"],
            list(dirty_tidy.DEFAULT_SETTINGS["hierarchyLevels"]),
        )

    def test_empty_hierarchy_levels_move_files_to_the_source_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "nested" / "clip.mp4"
            source.parent.mkdir()
            source.write_bytes(b"x")
            settings = dirty_tidy.normalize_settings(
                {"hierarchyLevels": [], "moveEnabled": True, "renameEnabled": False}
            )
            scene_data = scene(source)

            operation = dirty_tidy.build_operation(
                scene_data, scene_data["files"][0], [str(root)], settings
            )

            self.assertEqual(operation["status"], "ready")
            self.assertEqual(operation["destination_folder"], str(root))
            self.assertEqual(operation["destination_path"], str(root / "clip.mp4"))
            self.assertIn("move", operation["actions"])

    def test_reserved_folder_names_block_the_operation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "clip.mp4"
            source.write_bytes(b"x")
            settings = dirty_tidy.normalize_settings(
                {"hierarchyLevels": ["{studio}"], "moveEnabled": True, "renameEnabled": False}
            )

            for reserved in ("CON", "aux", "NUL"):
                scene_data = scene(source, studio={"id": "1", "name": reserved})
                operation = dirty_tidy.build_operation(
                    scene_data, scene_data["files"][0], [str(root)], settings
                )

                self.assertEqual(
                    operation["status"], "blocked", f"{reserved} must not become a folder"
                )
                self.assertTrue(
                    any("reserved folder" in warning for warning in operation["warnings"]),
                    operation["warnings"],
                )

            safe_scene = scene(source, studio={"id": "1", "name": "Studio"})
            safe = dirty_tidy.build_operation(
                safe_scene, safe_scene["files"][0], [str(root)], settings
            )
            self.assertEqual(safe["status"], "ready")
            self.assertEqual(safe["destination_folder"], str(root / "Studio"))

    def test_reserved_filenames_are_still_blocked(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "clip.mp4"
            source.write_bytes(b"x")
            settings = dirty_tidy.normalize_settings(
                {"moveEnabled": False, "renameEnabled": True, "renamePattern": "NUL"}
            )
            scene_data = scene(source)

            operation = dirty_tidy.build_operation(
                scene_data, scene_data["files"][0], [str(root)], settings
            )

            self.assertEqual(operation["status"], "blocked")
            self.assertTrue(
                any("reserved filename" in warning for warning in operation["warnings"]),
                operation["warnings"],
            )

    def test_case_only_renames_are_unchanged_on_case_insensitive_filesystems(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "Clip.mp4"
            source.write_bytes(b"x")
            settings = dirty_tidy.normalize_settings(
                {"moveEnabled": False, "renameEnabled": True, "renamePattern": "{title}"}
            )
            scene_data = scene(source, title="clip")

            # Simulate Windows, where normcase folds case and the filesystem
            # cannot rename a file to a name that differs only by case.
            with mock.patch.object(dirty_tidy.os.path, "normcase", lambda value: value.lower()):
                operation = dirty_tidy.build_operation(
                    scene_data, scene_data["files"][0], [str(root)], settings
                )

            self.assertEqual(operation["destination_basename"], "clip.mp4")
            self.assertEqual(operation["status"], "unchanged")


class DirtyTidyPlanIntegrityTests(unittest.TestCase):
    class SnapshotClient:
        def __init__(self, root, scenes):
            self.root = root
            self.scenes = scenes
            self.moves = []

        def library_snapshot(self, settings):
            return [str(self.root)], self.scenes

        def file_path(self, file_id):
            return next((item["path"] for value in self.scenes for item in value["files"] if item["id"] == file_id), "")

        def move_file(self, operation):
            self.moves.append(operation)
            return True

    def _second_scene(self, path, title, scene_id, file_id):
        value = scene(path, id=scene_id, title=title)
        value["files"][0]["id"] = file_id
        return value

    def authorization_fixture(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        environment = mock.patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(root / "dirty_plugins.sqlite3")})
        environment.start()
        self.addCleanup(environment.stop)
        source = root / "first.mp4"
        source.write_bytes(b"first")
        client = self.SnapshotClient(root, [scene(source, title="First Scene")])
        settings = {"moveEnabled": False, "renameEnabled": True, "renamePattern": "{title}"}
        return root, client, settings

    def test_later_preview_cannot_expand_an_earlier_confirmation(self):
        root, client, settings = self.authorization_fixture()
        first = dirty_tidy.preview_plan(client, settings, record_review=True)
        later = root / "later.mp4"
        later.write_bytes(b"later")
        client.scenes.append(self._second_scene(later, "Later Scene", "2", "20"))
        second = dirty_tidy.preview_plan(client, settings, record_review=True)
        self.assertEqual(first["strategy_hash"], second["strategy_hash"])
        self.assertNotEqual(first["plan_digest"], second["plan_digest"])

        # This is the queued task contract, after another tab created preview B.
        with mock.patch.object(dirty_tidy, "StashClient", return_value=client), \
                mock.patch.object(dirty_tidy, "get_section", side_effect=lambda section: trigger_settings(settings) if section == "execution" else settings):
            result = dirty_tidy.run({"args": {
                "mode": "execute", "expectedStrategyHash": first["strategy_hash"],
                "expectedPlanDigest": first["plan_digest"],
            }})
        self.assertEqual(result["completed"], 1)
        self.assertEqual(result["unreviewed"], 1)
        self.assertEqual(result["reviewed_missing"], 0)
        self.assertEqual(result["confirmed_plan_digest"], first["plan_digest"])
        self.assertEqual([item["file_id"] for item in client.moves], ["10"])

        # Repeating the same preview in another order retains its existing record.
        before = dirty_tidy.shared_storage.get_metadata(dirty_tidy.REVIEW_NAMESPACE, second["plan_digest"])
        client.scenes.reverse()
        repeat = dirty_tidy.preview_plan(client, settings, record_review=True)
        self.assertEqual(repeat["plan_digest"], second["plan_digest"])
        self.assertEqual(dirty_tidy.shared_storage.get_metadata(dirty_tidy.REVIEW_NAMESPACE, repeat["plan_digest"]), before)

    def test_manual_execution_requires_its_preview_identity_and_matching_strategy(self):
        root, client, settings = self.authorization_fixture()
        preview = dirty_tidy.preview_plan(client, settings, record_review=True)
        for digest in ("", "not-a-digest", "0" * 64):
            with self.subTest(digest=digest), self.assertRaises(dirty_tidy.PluginError):
                dirty_tidy.execute_plan(client, settings, preview["strategy_hash"], dirty_tidy.Reporter(), digest)
        other_settings = {**settings, "renamePattern": "different"}
        with self.assertRaises(dirty_tidy.PluginError):
            dirty_tidy.execute_plan(client, other_settings, dirty_tidy.strategy_hash(other_settings),
                                    dirty_tidy.Reporter(), preview["plan_digest"])
        self.assertEqual(client.moves, [])

    def test_changed_missing_or_relocated_source_is_not_authorized_by_old_preview(self):
        for change in ("content", "missing", "path", "metadata", "destination"):
            with self.subTest(change=change):
                root, client, settings = self.authorization_fixture()
                preview = dirty_tidy.preview_plan(client, settings, record_review=True)
                source = root / "first.mp4"
                if change == "content":
                    source.write_bytes(b"replacement media with a different size")
                    # A new preview of the changed file must not replace the old
                    # source identity, even though its operation key is identical.
                    newer = dirty_tidy.preview_plan(client, settings, record_review=True)
                    self.assertNotEqual(newer["plan_digest"], preview["plan_digest"])
                elif change == "missing":
                    source.unlink()
                elif change == "path":
                    relocated = root / "relocated.mp4"
                    source.rename(relocated)
                    client.scenes[0]["files"][0].update(path=str(relocated), basename=relocated.name)
                elif change == "metadata":
                    client.scenes[0]["title"] = "Different Destination"
                else:
                    (root / "First Scene.mp4").write_bytes(b"destination sentinel")
                result = dirty_tidy.execute_plan(client, settings, preview["strategy_hash"],
                                                dirty_tidy.Reporter(), preview["plan_digest"])
                self.assertEqual(result["completed"], 0)
                self.assertEqual(result["reviewed_missing"], 1)
                self.assertEqual(client.moves, [])

    def test_each_move_checks_for_changes_since_the_execution_snapshot(self):
        for change in ("content", "missing", "path", "destination"):
            with self.subTest(change=change):
                root, client, settings = self.authorization_fixture()
                preview = dirty_tidy.preview_plan(client, settings, record_review=True)
                source = root / "first.mp4"

                def changed_file_path(file_id):
                    if change == "content":
                        source.write_bytes(b"changed after execution planned")
                    elif change == "missing":
                        source.unlink()
                    elif change == "path":
                        return str(root / "different.mp4")
                    else:
                        (root / "First Scene.mp4").write_bytes(b"destination sentinel")
                    return str(source)

                client.file_path = changed_file_path
                result = dirty_tidy.execute_plan(client, settings, preview["strategy_hash"],
                                                dirty_tidy.Reporter(), preview["plan_digest"])
                self.assertEqual(result["completed"], 0)
                self.assertEqual(result["failed"], 1)
                self.assertEqual(client.moves, [])
                self.assertEqual(dirty_tidy.exit_code_for(result), 1)

    def test_preview_records_reject_mutation_and_corrupted_contents(self):
        root, client, settings = self.authorization_fixture()
        preview = dirty_tidy.preview_plan(client, settings, record_review=True)
        before = dirty_tidy.shared_storage.get_metadata(dirty_tidy.REVIEW_NAMESPACE, preview["plan_digest"])
        preview["operations"][0]["destination_path"] = str(root / "unseen.mp4")
        with self.assertRaises(dirty_tidy.PluginError):
            dirty_tidy.save_reviewed_plan(preview)
        self.assertEqual(dirty_tidy.shared_storage.get_metadata(dirty_tidy.REVIEW_NAMESPACE, preview["plan_digest"]), before)
        corrupted = json.loads(before)
        corrupted["operations"][0]["destination_path"] = str(root / "unseen.mp4")
        dirty_tidy.shared_storage.set_metadata(dirty_tidy.REVIEW_NAMESPACE, preview["plan_digest"], json.dumps(corrupted))
        with self.assertRaises(dirty_tidy.PluginError):
            dirty_tidy.execute_plan(client, settings, preview["strategy_hash"], dirty_tidy.Reporter(), preview["plan_digest"])
        self.assertEqual(client.moves, [])

    def test_stash_path_validation_reads_only_the_affected_file(self):
        client = dirty_tidy.StashClient({"Host": "localhost", "Port": 9999})
        with mock.patch.object(client, "call", return_value={"findFiles": {"files": [{"id": "10", "path": "source.mp4"}]}}) as call:
            self.assertEqual(client.file_path("10"), "source.mp4")
            self.assertEqual(call.call_args.args[1], {"ids": ["10"]})

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
                    client, settings, record_review=True
                )
                self.assertEqual(preview["summary"]["ready"], 1)
                self.assertEqual(preview["summary"]["warnings"], 1)

                # The previously missing file becomes available after the preview.
                late_file.write_bytes(b"late")
                result = dirty_tidy.execute_plan(
                    client, settings, preview["strategy_hash"], dirty_tidy.Reporter(), preview["plan_digest"]
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
                        client, settings, plan["strategy_hash"], dirty_tidy.Reporter(), plan["plan_digest"]
                    )

    def test_an_all_failed_execute_reports_and_exits_as_a_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            database = root / "dirty_plugins.sqlite3"
            source = root / "video.mp4"
            source.write_bytes(b"video")

            class FailingClient(self.SnapshotClient):
                def move_file(self, operation):
                    raise OSError("disk full")

            client = FailingClient(root, [scene(source, title="Video")])
            settings = {
                "moveEnabled": False,
                "renameEnabled": True,
                "renamePattern": "{title} renamed",
            }

            with mock.patch.dict(
                os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(database)}
            ):
                preview = dirty_tidy.preview_plan(
                    client, settings, record_review=True
                )
                result = dirty_tidy.execute_plan(
                    client, settings, preview["strategy_hash"], dirty_tidy.Reporter(), preview["plan_digest"]
                )

            self.assertEqual(result["completed"], 0)
            self.assertEqual(result["failed"], preview["summary"]["ready"])
            self.assertTrue(result["failures"])
            self.assertEqual(dirty_tidy.exit_code_for(result), 1)

        # Partial and fully successful runs stay green, as do non-execute modes.
        self.assertEqual(dirty_tidy.exit_code_for({"completed": 1, "failed": 1}), 0)
        self.assertEqual(dirty_tidy.exit_code_for({"completed": 1, "failed": 0}), 0)
        self.assertEqual(dirty_tidy.exit_code_for({"skipped": True}), 0)
        self.assertEqual(dirty_tidy.exit_code_for(None), 0)

    def test_execute_rejects_an_unrecorded_preview_even_with_an_approved_strategy(self):
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

    def test_automation_applies_approved_rules_to_new_scenes_on_repeated_runs(self):
        class MovingClient(self.SnapshotClient):
            def move_file(self, operation):
                super().move_file(operation)
                destination = Path(operation["destination_path"])
                destination.parent.mkdir(parents=True, exist_ok=True)
                Path(operation["source_path"]).rename(destination)
                for item in self.scenes:
                    for file_info in item["files"]:
                        if file_info["id"] == operation["file_id"]:
                            file_info["path"] = str(destination)
                            file_info["basename"] = destination.name
                return True

        for trigger in ("scan", "generate"):
            for keep_preview_digest in (True, False):
                with self.subTest(trigger=trigger, preview_digest=keep_preview_digest), \
                        tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    approved_file = root / "approved.mp4"
                    approved_file.write_bytes(b"approved")
                    settings = {
                        "moveEnabled": True,
                        "hierarchyLevels": ["{studio}"],
                        "renameEnabled": True,
                        "renamePattern": "{title}",
                        "automationMode": trigger,
                    }
                    approved_scene = scene(approved_file, title="Approved Scene")
                    approved_plan = dirty_tidy.build_plan([str(root)], [approved_scene], settings)
                    settings["approvedStrategyHash"] = approved_plan["strategy_hash"]
                    settings["approvedPlanDigest"] = (
                        approved_plan["plan_digest"] if keep_preview_digest else ""
                    )
                    later_file = root / "later.mp4"
                    later_file.write_bytes(b"later")
                    later_scene = self._second_scene(later_file, "Later Scene", "2", "20")
                    client = MovingClient(root, [approved_scene, later_scene])
                    payload = {"args": {"mode": "automation", "automationTrigger": trigger}}

                    with mock.patch.object(dirty_tidy, "StashClient", return_value=client), \
                            mock.patch.object(dirty_tidy, "get_section",
                                              side_effect=lambda section: trigger_settings(settings) if section == "execution" else settings), \
                            mock.patch.object(dirty_tidy, "load_reviewed_plan",
                                              side_effect=AssertionError("automation must not freeze the preview")):
                        result = dirty_tidy.run(payload)
                        self.assertEqual(result["completed"], 2)
                        self.assertEqual(result["unreviewed"], 0)
                        self.assertNotEqual(result["plan_digest"], approved_plan["plan_digest"])
                        self.assertTrue((root / "Unknown" / "Later Scene.mp4").is_file())

                        # A repeat does no work, then updated metadata and another
                        # new scene both use the same still-approved strategy.
                        repeat = dirty_tidy.run(payload)
                        self.assertEqual(repeat["completed"], 0)
                        self.assertEqual(repeat["unchanged"], 2)
                        later_scene["title"] = "Updated Scene"
                        next_file = root / "next.mp4"
                        next_file.write_bytes(b"next")
                        client.scenes.append(self._second_scene(next_file, "Next Scene", "3", "30"))
                        next_run = dirty_tidy.run(payload)
                        self.assertEqual(next_run["completed"], 2)
                        self.assertTrue((root / "Unknown" / "Updated Scene.mp4").is_file())
                        self.assertTrue((root / "Unknown" / "Next Scene.mp4").is_file())

    def test_automation_skips_unapproved_or_changed_strategy_and_other_triggers(self):
        original = {
            "moveEnabled": False, "renameEnabled": True,
            "renamePattern": "{title}", "automationMode": "scan",
        }
        approved_hash = dirty_tidy.strategy_hash(original)
        cases = (
            ({"approvedStrategyHash": ""}, "scan"),
            ({"approvedStrategyHash": approved_hash, "renamePattern": "{title} changed"}, "scan"),
            ({"approvedStrategyHash": approved_hash, "automationMode": "manual"}, "scan"),
            ({"approvedStrategyHash": approved_hash}, "generate"),
        )
        for changes, trigger in cases:
            with self.subTest(changes=changes, trigger=trigger):
                client = self.SnapshotClient(Path("."), [])
                with mock.patch.object(dirty_tidy, "StashClient", return_value=client), \
                        mock.patch.object(dirty_tidy, "get_section",
                                          side_effect=lambda section: trigger_settings({**original, **changes}) if section == "execution" else {**original, **changes}):
                    result = dirty_tidy.run({"args": {"mode": "automation", "automationTrigger": trigger}})
                self.assertTrue(result["skipped"])
                self.assertTrue(result["reason"])
                self.assertEqual(client.moves, [])

    def test_automation_still_skips_collisions_missing_files_and_other_sources(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root = base / "source"
            root.mkdir()
            settings = {
                "moveEnabled": False, "renameEnabled": True,
                "renamePattern": "{title}", "automationMode": "scan",
            }
            approved_plan = dirty_tidy.build_plan([str(root)], [], settings)
            settings["approvedStrategyHash"] = approved_plan["strategy_hash"]
            settings["approvedPlanDigest"] = approved_plan["plan_digest"]
            scenes = []
            entries = (
                (root / "ready.mp4", "Ready Scene", True),
                (root / "collision.mp4", "Exists", True),
                (root / "duplicate-one.mp4", "Duplicate", True),
                (root / "duplicate-two.mp4", "Duplicate", True),
                (root / "missing.mp4", "Missing", False),
                (base / "outside.mp4", "Outside", True),
            )
            (root / "Exists.mp4").write_bytes(b"existing destination")
            for index, (source, title, exists) in enumerate(entries, 1):
                if exists:
                    source.write_bytes(b"source")
                scenes.append(self._second_scene(source, title, str(index), str(index * 10)))
            client = self.SnapshotClient(root, scenes)
            with mock.patch.object(dirty_tidy, "StashClient", return_value=client), \
                    mock.patch.object(dirty_tidy, "get_section", side_effect=lambda section: trigger_settings(settings) if section == "execution" else settings):
                result = dirty_tidy.run({"args": {"mode": "automation", "automationTrigger": "scan"}})
            self.assertEqual(result["completed"], 1)
            self.assertEqual(result["blocked"], 4)
            self.assertEqual(result["warnings"], 1)
            self.assertEqual([item["source_path"] for item in client.moves], [str(root / "ready.mp4")])
            self.assertEqual((root / "Exists.mp4").read_bytes(), b"existing destination")

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
                    dirty_tidy.load_reviewed_plan(plan["plan_digest"], plan["strategy_hash"])
                )
                dirty_tidy.save_reviewed_plan(plan)
                reviewed = dirty_tidy.load_reviewed_plan(plan["plan_digest"], plan["strategy_hash"])

            self.assertEqual(
                reviewed,
                {
                    dirty_tidy.operation_key(
                        next(
                            operation
                            for operation in plan["operations"]
                            if operation["status"] == "ready"
                        )
                    ): plan["operations"][0]["source_fingerprint"]
                },
            )


def trigger_settings(settings):
    mode = settings.get("automationMode", "manual")
    return {"move": mode, "rename": mode, "tags": mode, "encoding": {}}


class DirtyTidyAutomationQueueTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        environment = mock.patch.dict(os.environ, {
            "DIRTY_PLUGINS_DATABASE_PATH": str(Path(temporary.name) / "dirty_plugins.sqlite3")
        })
        environment.start()
        self.addCleanup(environment.stop)
        self.settings = {
            "moveEnabled": True, "renameEnabled": True,
            "renamePattern": "{title}", "automationMode": "scan",
        }
        self.save_settings()
        self.client = mock.Mock()
        self.client.call.return_value = {"runPluginTask": "100"}
        self.client.library_snapshot.side_effect = AssertionError("queuing must not inspect the library")
        client_patch = mock.patch.object(dirty_tidy, "StashClient", return_value=self.client)
        client_patch.start()
        self.addCleanup(client_patch.stop)
        self.args = {
            "mode": "queueAutomation", "automationTrigger": "scan",
            "sourceJobId": "1", "sourceStartTime": "2026-10-02T20:42:00Z",
        }

    def save_settings(self):
        self.settings["approvedStrategyHash"] = dirty_tidy.strategy_hash(self.settings)
        dirty_tidy.shared_storage.set_plugin_settings(dirty_tidy.PLUGIN_ID, {"organization": self.settings, "execution": trigger_settings(self.settings)})

    def queue(self, **overrides):
        return dirty_tidy.run({"args": {**self.args, **overrides}})

    def test_simultaneous_sessions_queue_only_one_task_and_reused_ids_still_work(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda unused: self.queue(), range(16)))
        self.assertEqual(sum("queuedJobId" in result for result in results), 1)
        self.assertEqual(self.client.call.call_count, 1)
        self.assertEqual(self.queue()["reason"], "duplicate")
        self.assertEqual(self.queue(sourceStartTime="2026-10-03T20:42:00Z")["queuedJobId"], "100")
        self.assertEqual(self.client.call.call_count, 2)

    def test_names_describe_enabled_actions_and_the_triggering_job(self):
        cases = (
            (True, True, "scan", "move and rename scene files"),
            (True, False, "scan", "organize scene files into folders"),
            (False, True, "generate", "rename scene files"),
        )
        for index, (move, rename, trigger, action) in enumerate(cases):
            with self.subTest(action=action):
                self.settings.update(moveEnabled=move, renameEnabled=rename, automationMode=trigger)
                self.save_settings()
                self.queue(automationTrigger=trigger, sourceJobId=str(index + 1))
                variables = self.client.call.call_args.args[1]
                self.assertEqual(variables["description"],
                                 f"DirtyTasks: organization: {action} (after {trigger.title()} #{index + 1})")
                self.assertEqual(variables["args"]["mode"], "automation")
                self.assertEqual(variables["args"]["sourceStartTime"], self.args["sourceStartTime"])

    def test_failed_queue_requests_release_claims_for_retry(self):
        self.client.call.side_effect = dirty_tidy.PluginError("queue unavailable")
        with self.assertRaises(dirty_tidy.PluginError):
            self.queue()
        self.client.call.side_effect = None
        self.client.call.return_value = {"runPluginTask": None}
        with self.assertRaises(dirty_tidy.PluginError):
            self.queue()
        self.client.call.return_value = {"runPluginTask": "101"}
        self.assertEqual(self.queue()["queuedJobId"], "101")
        self.assertEqual(self.queue()["reason"], "duplicate")

    def test_disabled_unapproved_changed_or_internal_jobs_do_not_claim_events(self):
        cases = (
            ({"automationMode": "manual"}, "disabled"),
            ({"approvedStrategyHash": ""}, "unapproved"),
            ({"renamePattern": "changed {title}"}, "unapproved"),
        )
        original = self.settings.copy()
        for changes, reason in cases:
            with self.subTest(reason=reason, changes=changes):
                dirty_tidy.shared_storage.set_plugin_settings(dirty_tidy.PLUGIN_ID, {"organization": {**original, **changes}, "execution": trigger_settings({**original, **changes})})
                self.assertEqual(self.queue()["reason"], reason)
        self.save_settings()
        with mock.patch.object(dirty_tidy.shared_storage, "internal_scan_check", return_value=True):
            self.assertEqual(self.queue()["reason"], "internal")
        self.client.call.assert_not_called()
        self.assertEqual(self.queue()["queuedJobId"], "100")

    def test_incomplete_job_identity_cannot_queue_automation(self):
        for field in ("automationTrigger", "sourceJobId", "sourceStartTime"):
            with self.subTest(field=field), self.assertRaises(dirty_tidy.PluginError):
                self.queue(**{field: ""})
        self.client.call.assert_not_called()

    def test_tag_updates_queue_once_after_scan_without_file_approval(self):
        self.settings.update(tagUpdateEnabled=True, taggerEndpoint="https://stashdb.org/graphql",
                             automationMode="scan", moveEnabled=False, renameEnabled=False,
                             approvedStrategyHash="")
        dirty_tidy.shared_storage.set_plugin_settings(dirty_tidy.PLUGIN_ID, {"organization": self.settings, "execution": trigger_settings(self.settings)})
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda unused: self.queue(), range(16)))
        self.assertEqual(sum("queuedJobId" in result for result in results), 1)
        self.assertEqual(self.client.call.call_count, 1)
        values = self.client.call.call_args.args[1]
        self.assertEqual(values["args"]["mode"], "updateTags")
        self.assertIn("merge scene tags", values["description"])
        self.assertEqual(self.queue(automationTrigger="generate")["reason"], "disabled")
        self.assertEqual(self.client.call.call_count, 1)
        self.assertEqual(self.queue(sourceStartTime="2026-10-03T20:42:00Z")["queuedJobId"], "100")

    def test_tag_updates_have_independent_claims_and_recheck_the_enable_switch(self):
        self.settings.update(tagUpdateEnabled=True, taggerEndpoint="https://stashdb.org/graphql")
        self.save_settings()
        self.client.call.side_effect = [{"runPluginTask": "100"}, {"runPluginTask": "101"}]
        result = self.queue()
        self.assertEqual(result["queuedJobIds"], ["100", "101"])
        self.assertEqual(self.queue()["reason"], "duplicate")
        self.settings["tagUpdateEnabled"] = False
        self.save_settings()
        with mock.patch.object(dirty_tidy, "update_scene_tags") as update:
            self.assertTrue(dirty_tidy.run({"args": {"mode": "updateTags"}})["skipped"])
            update.assert_not_called()

    def test_internal_scans_and_missing_sources_cannot_queue_tag_updates(self):
        self.settings.update(tagUpdateEnabled=True, automationMode="manual")
        self.save_settings()
        self.assertNotIn("queuedJobId", self.queue())
        self.settings["taggerEndpoint"] = "https://stashdb.org/graphql"
        self.save_settings()
        with mock.patch.object(dirty_tidy.shared_storage, "internal_scan_check", return_value=True):
            self.assertNotIn("queuedJobId", self.queue())
        self.client.call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
