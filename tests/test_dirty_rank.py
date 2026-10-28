from plugin_paths import runtime_path
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock


MODULE_PATH = runtime_path("DirtyRank", "dirty_rank.py")
SPEC = importlib.util.spec_from_file_location("dirty_rank", MODULE_PATH)
dirty_rank = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = dirty_rank
SPEC.loader.exec_module(dirty_rank)


class Glicko2Tests(unittest.TestCase):
    def setUp(self):
        self.settings = dirty_rank.normalize_settings({})

    def test_official_glicko2_example(self):
        player = dirty_rank.Rating(1500, 200, 0.06)
        opponents = [
            (dirty_rank.Rating(1400, 30, 0.06), 1.0),
            (dirty_rank.Rating(1550, 100, 0.06), 0.0),
            (dirty_rank.Rating(1700, 300, 0.06), 0.0),
        ]

        standard_settings = {**self.settings, "evidenceWeight": 1.0}
        result = dirty_rank.glicko2_update(player, opponents, standard_settings)

        self.assertAlmostEqual(result.rating, 1464.06, delta=0.02)
        self.assertAlmostEqual(result.deviation, 151.52, delta=0.02)
        self.assertAlmostEqual(result.volatility, 0.059996, places=6)

    def test_default_evidence_weight_adds_information_without_extra_match(self):
        player = dirty_rank.Rating(1000, 350, 0.06)
        opponent = dirty_rank.Rating(1000, 350, 0.06)
        standard_settings = {**self.settings, "evidenceWeight": 1.0}

        weighted, _ = dirty_rank.rate_battle(
            player, opponent, 1.0, self.settings
        )
        standard, _ = dirty_rank.rate_battle(
            player, opponent, 1.0, standard_settings
        )

        self.assertEqual(weighted.matches, 1)
        self.assertLess(weighted.deviation, standard.deviation)
        self.assertGreater(weighted.rating, standard.rating)

    def test_rating_has_no_user_facing_ceiling(self):
        left = dirty_rank.Rating(9999, 350, 0.06)
        right = dirty_rank.Rating(9999, 350, 0.06)

        winner, loser = dirty_rank.rate_battle(left, right, 1.0, self.settings)

        self.assertGreater(winner.rating, 9999)
        self.assertLess(loser.rating, 9999)
        self.assertAlmostEqual(winner.rating - 9999, 9999 - loser.rating, places=8)

    def test_presets_refine_balanced_results_with_fewer_physical_battles(self):
        # The same two equal-strength performers alternate wins. Use actual
        # updates, including volatility, rather than just the UI's RD estimate.
        profiles = [
            {"initialRating": 1500, "initialDeviation": 500,
             "initialVolatility": 0.09, "deviationFloor": 45,
             "provisionalDeviation": 110, "evidenceWeight": 1, "tau": 0.75},
            {"evidenceWeight": 2, "tau": 0.5},
            {"evidenceWeight": 3, "tau": 0.3},
        ]
        counts = []
        for profile in profiles:
            settings = dirty_rank.normalize_settings(profile)
            left = right = dirty_rank.Rating(
                settings["initialRating"], settings["initialDeviation"],
                settings["initialVolatility"],
            )
            for count in range(1, 101):
                left, right = dirty_rank.rate_battle(
                    left, right, float(count % 2), settings,
                )
                self.assertEqual(left.matches, count)
                self.assertEqual(right.matches, count)
                self.assertEqual(left.wins + left.losses + left.draws, count)
                self.assertGreater(left.volatility, 0)
                if max(left.deviation, right.deviation) <= settings["provisionalDeviation"]:
                    counts.append(count)
                    break
            else:
                self.fail("Balanced battles should reach refinement")
        self.assertLess(counts[1], counts[0])
        self.assertLess(counts[2], counts[1])

    def test_inactivity_does_not_change_rating_updates(self):
        established = dirty_rank.Rating(
            1000,
            35,
            0.06,
            matches=50,
            last_rated_at="2000-01-01T00:00:00Z",
        )
        identical_without_timestamp = dirty_rank.Rating(1000, 35, 0.06, matches=50)
        opponent = dirty_rank.Rating(1000, 100, 0.06, matches=20)

        old_result, _ = dirty_rank.rate_battle(
            established, opponent, 1.0, self.settings, datetime.now(timezone.utc)
        )
        current_result, _ = dirty_rank.rate_battle(
            identical_without_timestamp,
            opponent,
            1.0,
            self.settings,
            datetime.now(timezone.utc),
        )

        self.assertAlmostEqual(old_result.rating, current_result.rating)
        self.assertAlmostEqual(old_result.deviation, current_result.deviation)

    def test_draw_moves_favorite_and_underdog_toward_each_other(self):
        favorite = dirty_rank.Rating(1400, 120, 0.06)
        underdog = dirty_rank.Rating(800, 120, 0.06)

        new_favorite, new_underdog = dirty_rank.rate_battle(
            favorite, underdog, 0.5, self.settings
        )

        self.assertLess(new_favorite.rating, favorite.rating)
        self.assertGreater(new_underdog.rating, underdog.rating)
        self.assertEqual(new_favorite.draws, 1)
        self.assertEqual(new_underdog.draws, 1)


class DirtyRankOperationTests(unittest.TestCase):
    def setUp(self):
        self.settings = dirty_rank.normalize_settings({})
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repository = dirty_rank.RatingRepository(Path(self.temp_dir.name) / "dirty.sqlite3")
        self.now = datetime(2026, 8, 21, 12, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self.temp_dir.cleanup()

    def state(self, performer_id):
        with self.repository.connect() as connection:
            return self.repository.state(connection, str(performer_id))

    def battle_args(self, battle_id="battle-1"):
        return {
            "leftId": "1",
            "rightId": "2",
            "battleId": battle_id,
            "categoryId": "appearance",
            "cohort": "FEMALE",
            "outcome": "left",
        }

    def test_record_is_precise_idempotent_and_category_scoped(self):
        first = dirty_rank.record_battle(
            self.repository, self.battle_args(), self.settings, self.now
        )
        duplicate = dirty_rank.record_battle(
            self.repository, self.battle_args(), self.settings, self.now
        )
        key = dirty_rank.pool_key("appearance", "FEMALE")
        left_state = self.state("1")
        right_state = self.state("2")

        self.assertFalse(first["duplicate"])
        self.assertTrue(duplicate["duplicate"])
        self.assertGreater(left_state["pools"][key]["rating"], 1000)
        self.assertLess(right_state["pools"][key]["rating"], 1000)
        self.assertIsInstance(left_state["pools"][key]["rating"], float)
        self.assertEqual(left_state["pools"][key]["matches"], 1)
        with self.repository.connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM dirty_rank_battles").fetchone()[0], 1)
        self.assertNotIn("performance|FEMALE", left_state["pools"])

    def test_undo_restores_both_missing_pools(self):
        dirty_rank.record_battle(
            self.repository, self.battle_args(), self.settings, self.now
        )

        result = dirty_rank.undo_battle(
            self.repository,
            {
                **self.battle_args(),
                "mode": "undo",
            },
            self.settings,
        )
        key = dirty_rank.pool_key("appearance", "FEMALE")

        self.assertTrue(result["undone"])
        self.assertNotIn(key, self.state("1")["pools"])
        self.assertNotIn(key, self.state("2")["pools"])

    def test_multiple_undos_restore_consecutive_battles(self):
        dirty_rank.record_battle(
            self.repository, self.battle_args("battle-1"), self.settings, self.now
        )
        second_args = self.battle_args("battle-2")
        second_args["outcome"] = "right"
        dirty_rank.record_battle(self.repository, second_args, self.settings, self.now)

        dirty_rank.undo_battle(self.repository, second_args, self.settings)
        key = dirty_rank.pool_key("appearance", "FEMALE")
        after_first_undo = self.state("1")
        self.assertEqual(after_first_undo["pools"][key]["matches"], 1)

        dirty_rank.undo_battle(
            self.repository, self.battle_args("battle-1"), self.settings
        )
        self.assertNotIn(
            key, self.state("1")["pools"]
        )
        self.assertNotIn(
            key, self.state("2")["pools"]
        )

    def test_database_journal_supports_many_consecutive_undos(self):
        for index in range(1, 31):
            dirty_rank.record_battle(
                self.repository,
                self.battle_args(f"battle-{index}"),
                self.settings,
                self.now,
            )

        for index in range(30, 5, -1):
            dirty_rank.undo_battle(
                self.repository,
                self.battle_args(f"battle-{index}"),
                self.settings,
            )

        key = dirty_rank.pool_key("appearance", "FEMALE")
        state = self.state("1")
        self.assertEqual(state["pools"][key]["matches"], 5)
        self.assertNotIn("lastBattle", state["pools"][key])
        dirty_rank.undo_battle(
            self.repository, self.battle_args("battle-5"), self.settings
        )
        self.assertEqual(self.state("1")["pools"][key]["matches"], 4)

    def test_load_all_returns_sqlite_rating_index(self):
        dirty_rank.record_battle(self.repository, self.battle_args(), self.settings, self.now)
        payload = self.repository.all_states()
        self.assertEqual(payload["version"], 2)
        self.assertEqual(set(payload["states"]), {"1", "2"})
        self.assertEqual(payload["states"]["1"]["pools"]["appearance|FEMALE"]["matches"], 1)

    def test_plugin_operation_reuses_one_database_connection(self):
        database = Path(self.temp_dir.name) / "run.sqlite3"
        original_connect = dirty_rank.shared_storage.connect
        with mock.patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(database)}):
            with mock.patch.object(
                dirty_rank.shared_storage, "connect", wraps=original_connect
            ) as connect:
                payload = dirty_rank.run({"args": {"mode": "loadAll"}})

        self.assertEqual(connect.call_count, 1)
        self.assertEqual(payload["states"], {})

    def test_load_all_keeps_revision_and_pools_on_one_snapshot(self):
        first = dirty_rank.record_battle(self.repository, self.battle_args(), self.settings, self.now)
        original_revision = self.repository.revision
        interleaved = False

        def revision_then_write(connection):
            nonlocal interleaved
            revision = original_revision(connection)
            if not interleaved:
                interleaved = True
                self.assertTrue(connection.in_transaction)
                dirty_rank.record_battle(
                    self.repository, self.battle_args("battle-2"), self.settings, self.now
                )
            return revision

        with mock.patch.object(self.repository, "revision", side_effect=revision_then_write):
            snapshot = self.repository.all_states()

        self.assertTrue(interleaved)
        self.assertEqual(snapshot["revision"], 1)
        self.assertEqual(snapshot["states"]["1"], first["left"]["state"])
        self.assertEqual(snapshot["states"]["2"], first["right"]["state"])
        latest = self.repository.all_states()
        self.assertEqual(latest["revision"], 2)
        self.assertEqual(latest["states"]["1"]["pools"]["appearance|FEMALE"]["matches"], 2)

    def test_get_settings_keeps_revision_and_values_on_one_snapshot(self):
        database = self.repository.path
        storage = dirty_rank.shared_storage
        storage.set_plugin_settings(dirty_rank.PLUGIN_ID, {"initialRating": 1000}, path=database)
        original_revision = storage.get_plugin_revision
        interleaved = False

        def revision_then_write(*args, **kwargs):
            nonlocal interleaved
            revision = original_revision(*args, **kwargs)
            if not interleaved:
                interleaved = True
                self.assertTrue(kwargs["connection"].in_transaction)
                storage.set_plugin_settings(dirty_rank.PLUGIN_ID, {"initialRating": 1200}, path=database)
            return revision

        with mock.patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(database)}):
            with mock.patch.object(storage, "get_plugin_revision", side_effect=revision_then_write):
                snapshot = dirty_rank.run({"args": {"mode": "getSettings"}})
            latest = dirty_rank.run({"args": {"mode": "getSettings"}})

        self.assertTrue(interleaved)
        self.assertEqual(snapshot, {"revision": 1, "settings": {"initialRating": 1000}})
        self.assertEqual(latest, {"revision": 2, "settings": {"initialRating": 1200}})

    def test_renamed_labels_move_ratings_history_and_undo_through_id_swaps(self):
        database = Path(self.temp_dir.name) / "rename-chain.sqlite3"
        repository = dirty_rank.RatingRepository(database)
        for category_id in ("appearance", "performance", "category-1"):
            label = "Category 1" if category_id == "category-1" else category_id.title()
            settings = dirty_rank.normalize_settings({"categories": json.dumps({
                "FEMALE": [{"name": label}],
            })})
            dirty_rank.record_battle(
                repository,
                {"leftId": "1", "rightId": "2", "battleId": "battle-" + category_id,
                 "categoryId": category_id, "cohort": "FEMALE", "outcome": "left"},
                settings,
                self.now,
            )
        current = {"FEMALE": [
            {"id": "appearance", "name": "Appearance"},
            {"id": "performance", "name": "Performance"},
            {"id": "category-1", "name": "Category 1"},
        ]}
        dirty_rank.shared_storage.set_plugin_settings(
            dirty_rank.PLUGIN_ID, {"categories": json.dumps(current)}, path=database
        )
        renamed = {"FEMALE": [
            {"id": "appearance", "name": "Breasts"},
            {"id": "performance", "name": "Face"},
            {"id": "category-1", "name": "Performance"},
        ]}
        with mock.patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(database)}):
            snapshot = dirty_rank.run({"args": {"mode": "getSettings"}})
            changed = dict(snapshot["settings"], categories=json.dumps(renamed))
            result = dirty_rank.run({"args": {"mode": "saveSettings", "settings": changed,
                                              "expectedRevision": snapshot["revision"]}})
            states = dirty_rank.run({"args": {"mode": "loadAll"}})["states"]
            self.assertEqual(
                [item["id"] for item in json.loads(result["settings"]["categories"])["FEMALE"]],
                ["breasts", "face", "performance"],
            )
            self.assertEqual(set(states["1"]["pools"]),
                             {"breasts|FEMALE", "face|FEMALE", "performance|FEMALE"})
            dirty_rank.run({"args": {"mode": "undo", "leftId": "1", "rightId": "2",
                                     "battleId": "battle-appearance", "categoryId": "breasts",
                                     "cohort": "FEMALE"}})
        with repository.connect() as connection:
            self.assertIsNone(repository.pool(connection, "1", "breasts", "FEMALE"))
            self.assertEqual(connection.execute(
                "SELECT category_id FROM dirty_rank_battles WHERE battle_id='battle-appearance'"
            ).fetchone()[0], "breasts")

    def test_saving_renamed_label_moves_existing_pool_and_rejects_stale_revision(self):
        database = Path(self.temp_dir.name) / "rename.sqlite3"
        repository = dirty_rank.RatingRepository(database)
        dirty_rank.record_battle(repository, self.battle_args(), self.settings, self.now)
        categories = {"FEMALE": [{"id": "appearance", "name": "Appearance"}]}
        dirty_rank.shared_storage.set_plugin_settings(
            dirty_rank.PLUGIN_ID, {"categories": json.dumps(categories)}, path=database
        )
        with mock.patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(database)}):
            snapshot = dirty_rank.run({"args": {"mode": "getSettings"}})
            changed = dict(snapshot["settings"])
            changed["categories"] = json.dumps({"FEMALE": [{"id": "appearance", "name": "Étoile"}]})
            result = dirty_rank.run({"args": {"mode": "saveSettings", "settings": changed,
                                              "expectedRevision": snapshot["revision"]}})
            self.assertEqual(json.loads(result["settings"]["categories"])["FEMALE"][0]["id"], "etoile")
            with self.assertRaises(dirty_rank.shared_storage.SettingsRevisionConflict):
                dirty_rank.run({"args": {"mode": "saveSettings", "settings": changed,
                                          "expectedRevision": snapshot["revision"]}})
        with repository.connect() as connection:
            self.assertIsNone(repository.pool(connection, "1", "appearance", "FEMALE"))
            self.assertIsNotNone(repository.pool(connection, "1", "etoile", "FEMALE"))
            self.assertEqual(connection.execute(
                "SELECT category_id FROM dirty_rank_battles WHERE battle_id='battle-1'"
            ).fetchone()[0], "etoile")

    def test_adding_genders_preserves_existing_pools_and_history(self):
        database = Path(self.temp_dir.name) / "mixed.sqlite3"
        repository = dirty_rank.RatingRepository(database)
        dirty_rank.record_battle(repository, self.battle_args(), self.settings, self.now)
        male_settings = dirty_rank.normalize_settings({"genderBoxes": [
            {"id": "FEMALE", "genders": ["FEMALE"]}, {"id": "MALE", "genders": ["MALE"]},
        ]})
        male_battle = dict(self.battle_args("male-existing"), cohort="MALE")
        dirty_rank.record_battle(repository, male_battle, male_settings, self.now)
        with repository.connect() as connection:
            original = repository.state(connection, "1")
        with mock.patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(database)}):
            snapshot = dirty_rank.run({"args": {"mode": "getSettings"}})
            changed = dict(snapshot["settings"])
            changed["categories"] = json.dumps({"FEMALE": [{"id": "appearance", "name": "Appearance"}]})
            changed["genderBoxes"] = json.dumps([
                {"id": "FEMALE", "name": "Mixed", "genders": ["FEMALE", "MALE"]},
                {"id": "MALE", "name": "Male", "genders": ["MALE"], "enabled": False},
            ])
            saved = dirty_rank.run({"args": {"mode": "saveSettings", "settings": changed,
                                           "expectedRevision": snapshot["revision"]}})
            self.assertEqual(json.loads(saved["settings"]["genderBoxes"])[0]["genders"], ["FEMALE", "MALE"])
        with repository.connect() as connection:
            self.assertEqual(repository.state(connection, "1")["pools"], original["pools"])
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM dirty_rank_battles").fetchone()[0], 2)
        mixed_settings = dirty_rank.normalize_settings(changed)
        added_battle = dict(self.battle_args("mixed-new"), rightId="3")
        mixed = dirty_rank.record_battle(repository, added_battle, mixed_settings, self.now)
        self.assertEqual(mixed["left"]["pool"]["matches"], 2)
        self.assertEqual(mixed["right"]["pool"]["matches"], 1)
        with repository.connect() as connection:
            self.assertEqual(repository.state(connection, "1")["pools"]["appearance|MALE"], original["pools"]["appearance|MALE"])
        dirty_rank.undo_battle(repository, dict(added_battle, mode="undo"), mixed_settings)
        with repository.connect() as connection:
            self.assertEqual(repository.state(connection, "1")["pools"], original["pools"])
            self.assertEqual(repository.state(connection, "3")["pools"], {})

    def test_custom_boxes_keep_independent_pools_through_rename_reset_and_undo(self):
        database = Path(self.temp_dir.name) / "boxes.sqlite3"
        repository = dirty_rank.RatingRepository(database)
        raw = {"genderBoxes": json.dumps([
            {"id": "BOX-1", "name": "Box 1", "genders": ["FEMALE", "NON_BINARY"]},
            {"id": "BOX-2", "name": "Box 2", "genders": ["MALE"]},
            {"id": "BOX-3", "name": "Box 3", "genders": ["TRANSGENDER_MALE", "TRANSGENDER_FEMALE"]},
        ]), "categories": json.dumps({
            box: [{"id": "appearance", "name": "Appearance"}] for box in ["BOX-1", "BOX-2", "BOX-3"]
        }), "defaultCohort": "BOX-1"}
        dirty_rank.shared_storage.set_plugin_settings(dirty_rank.PLUGIN_ID, raw, path=database)
        settings = dirty_rank.normalize_settings(raw)
        for box in ["BOX-1", "BOX-2"]:
            dirty_rank.record_battle(repository, dict(self.battle_args("battle-" + box), cohort=box), settings, self.now)
        with repository.connect() as connection:
            before = repository.state(connection, "1")["pools"]
        self.assertEqual(set(before), {"appearance|BOX-1", "appearance|BOX-2"})
        with mock.patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(database)}):
            snapshot = dirty_rank.run({"args": {"mode": "getSettings"}})
            changed = dict(snapshot["settings"])
            boxes = json.loads(changed["genderBoxes"])
            boxes[1]["name"] = "Renamed men"
            changed["genderBoxes"] = json.dumps(boxes)
            categories = json.loads(changed["categories"])
            categories["BOX-2"][0]["name"] = "Power"
            changed["categories"] = json.dumps(categories)
            saved = dirty_rank.run({"args": {"mode": "saveSettings", "settings": changed,
                                           "expectedRevision": snapshot["revision"]}})
        settings = dirty_rank.normalize_settings(saved["settings"])
        with repository.connect() as connection:
            after = repository.state(connection, "1")["pools"]
        self.assertEqual(after["power|BOX-2"], before["appearance|BOX-2"])
        self.assertEqual(after["appearance|BOX-1"], before["appearance|BOX-1"])
        settings["categoriesByCohort"]["BOX-1"][0]["enabled"] = False
        with self.assertRaisesRegex(dirty_rank.PluginError, "explicit RESET confirmation"):
            dirty_rank.reset_pool(repository, {"categoryId": "appearance", "cohort": "BOX-1"}, settings, dirty_rank.Reporter())
        dirty_rank.reset_pool(repository, {"categoryId": "appearance", "cohort": "BOX-1", "confirm": "RESET"}, settings, dirty_rank.Reporter())
        with repository.connect() as connection:
            self.assertEqual(set(repository.state(connection, "1")["pools"]), {"power|BOX-2"})
        dirty_rank.undo_battle(repository, dict(self.battle_args("battle-BOX-2"), categoryId="power", cohort="BOX-2"), settings)
        with repository.connect() as connection:
            self.assertEqual(repository.state(connection, "1")["pools"], {})
        with self.assertRaises(dirty_rank.PluginError):
            dirty_rank.record_battle(repository, dict(self.battle_args("invalid-box"), cohort="BOX-4"), settings)

    def test_battle_for_disabled_cohort_is_rejected(self):
        settings = dirty_rank.normalize_settings(
            {"defaultCohort": "MALE", "enabledCohorts": json.dumps(["MALE"])}
        )

        with self.assertRaisesRegex(dirty_rank.PluginError, "disabled for FEMALE"):
            dirty_rank.record_battle(
                self.repository, self.battle_args(), settings, self.now
            )

    def test_skip_is_not_a_backend_outcome(self):
        args = self.battle_args()
        args["outcome"] = "skip"

        with self.assertRaisesRegex(dirty_rank.PluginError, "left, right, or draw"):
            dirty_rank.record_battle(self.repository, args, self.settings, self.now)

class SettingsTests(unittest.TestCase):
    def test_overall_scoring_strategies(self):
        self.assertEqual(dirty_rank.normalize_settings({})["overallScoreStrategy"], "weighted")
        for strategy in ("weighted", "power", "rating", "proven"):
            self.assertEqual(dirty_rank.normalize_settings({"overallScoreStrategy": strategy})["overallScoreStrategy"], strategy)
        for invalid in ("unknown", "", None, [], {}):
            self.assertEqual(dirty_rank.normalize_settings({"overallScoreStrategy": invalid})["overallScoreStrategy"], "weighted")

    def test_power_mean_exponent_is_validated(self):
        self.assertEqual(dirty_rank.normalize_settings({})["overallPower"], 3.0)
        for raw, expected in ((0, 1.0), (99, 4.0), ("2.5", 2.5), (float("nan"), 3.0), (None, 3.0)):
            with self.subTest(raw=raw):
                self.assertEqual(dirty_rank.normalize_settings({"overallPower": raw})["overallPower"], expected)

    def test_gender_boxes_support_multiple_selections_and_ignore_pre_box_cohorts(self):
        settings = dirty_rank.normalize_settings({"genderBoxes": [
            {"id": "BOX-1", "name": "Shared", "genders": ["male", "FEMALE", "NON_BINARY", "MALE", "UNKNOWN"]},
        ], "categories": {"BOX-1": [{"name": "Shared category"}]}})
        self.assertEqual(settings["genderBoxes"][0]["genders"], ["FEMALE", "MALE", "NON_BINARY"])
        self.assertEqual(settings["defaultCohort"], "BOX-1")
        self.assertEqual(settings["categoriesByCohort"]["BOX-1"][0]["id"], "shared-category")
        # Pre-1.0 settings enabled cohorts without boxes; that shape is no longer read.
        legacy = dirty_rank.normalize_settings({"enabledCohorts": ["MALE", "FEMALE"]})
        self.assertEqual(legacy["enabledCohorts"], ["FEMALE"])
        self.assertEqual(next(box for box in legacy["genderBoxes"] if box["id"] == "MALE")["genders"], ["MALE"])

    def test_label_ids_are_sanitized_and_suffix_collisions(self):
        settings = dirty_rank.normalize_settings({"categories": json.dumps({
            "FEMALE": [
                {"id": "unrelated", "name": "Étoile & Face"},
                {"name": "Etoile Face"},
                {"name": "Étoile--Face"},
                {"name": "Overall"},
            ]
        })})
        self.assertEqual(
            [category["id"] for category in settings["categoriesByCohort"]["FEMALE"]],
            ["etoile-face", "etoile-face-1", "etoile-face-2", "overall-1"],
        )

    def test_categories_are_scoped_by_cohort_with_weights(self):
        settings = dirty_rank.normalize_settings(
            {
                "categories": json.dumps(
                    {
                        "FEMALE": [
                            {"id": "My Category", "name": "First", "weight": 2.5},
                            {"id": "my-category", "name": "Duplicate"},
                            {"name": "Second Category", "weight": 0},
                        ],
                        "MALE": [{"name": "Physique", "weight": 3}],
                    }
                )
            }
        )

        female = settings["categoriesByCohort"]["FEMALE"]
        male = settings["categoriesByCohort"]["MALE"]
        self.assertEqual([item["id"] for item in female], ["first", "duplicate", "second-category"])
        self.assertEqual([item["weight"] for item in female], [2.5, 1.0, 0.01])
        self.assertEqual([(item["id"], item["weight"]) for item in male], [("physique", 3.0)])

    def test_defaults_apply_to_every_cohort_without_inactivity_setting(self):
        settings = dirty_rank.normalize_settings({})

        self.assertNotIn("ratingPeriodDays", settings)
        self.assertEqual(settings["evidenceWeight"], 2.0)
        self.assertEqual(settings["enabledCohorts"], ["FEMALE"])
        self.assertTrue(settings["showLeaderboardsInMenu"])
        self.assertTrue(settings["showBattlesInMenu"])
        self.assertEqual(settings["leaderboardPerformerCount"], 18)
        self.assertFalse(settings["hidePerformerImages"])
        self.assertFalse(settings["hideBattleStandings"])
        self.assertEqual(settings["confidenceGoal"], "ranking")
        self.assertEqual(settings["confidenceTopN"], 20)
        for cohort in dirty_rank.VALID_COHORTS:
            self.assertEqual(
                [item["id"] for item in settings["categoriesByCohort"][cohort]],
                ["appearance", "performance"],
            )

    def test_category_cohort_order_does_not_depend_on_the_hash_seed(self):
        self.assertEqual(list(dirty_rank.normalize_settings({})["categoriesByCohort"]), dirty_rank.COHORT_ORDER)
        script = ("import json, sys; sys.path.insert(0, sys.argv[1]); import dirty_rank; "
                  "print(json.dumps(list(dirty_rank.normalize_settings({})['categoriesByCohort'])))")
        for seed in ("1", "2", "3"):
            result = subprocess.run([sys.executable, "-B", "-c", script, str(MODULE_PATH.parent)], capture_output=True,
                                    text=True, check=True, env=dict(os.environ, PYTHONHASHSEED=seed))
            self.assertEqual(json.loads(result.stdout), dirty_rank.COHORT_ORDER, "PYTHONHASHSEED=" + seed)

    def test_evidence_weight_is_bounded(self):
        self.assertEqual(
            dirty_rank.normalize_settings({"evidenceWeight": 0.1})["evidenceWeight"],
            1.0,
        )
        self.assertEqual(
            dirty_rank.normalize_settings({"evidenceWeight": 99})["evidenceWeight"],
            3.0,
        )

    def test_confidence_goal_is_validated(self):
        self.assertEqual(
            dirty_rank.normalize_settings({"confidenceGoal": "top", "confidenceTopN": 50})[
                "confidenceTopN"
            ],
            50,
        )
        self.assertEqual(
            dirty_rank.normalize_settings({"confidenceGoal": "unknown"})[
                "confidenceGoal"
            ],
            "ranking",
        )

    def test_enabled_boxes_follow_box_order_and_default_is_kept_valid(self):
        settings = dirty_rank.normalize_settings(
            {
                "defaultCohort": "TRANSGENDER_MALE",
                "genderBoxes": json.dumps([
                    {"id": "MALE"}, {"id": "unknown"}, {"id": "FEMALE"},
                    {"id": "TRANSGENDER_MALE", "enabled": False},
                ]),
            }
        )

        self.assertEqual(settings["enabledCohorts"], ["MALE", "FEMALE"])
        self.assertEqual(settings["defaultCohort"], "MALE")

    def test_performer_images_can_be_hidden_without_changing_pool_eligibility(self):
        settings = dirty_rank.normalize_settings(
            {"hidePerformerImages": True, "includePerformersWithoutImages": True}
        )

        self.assertTrue(settings["hidePerformerImages"])
        self.assertTrue(settings["includePerformersWithoutImages"])

    def test_leaderboards_menu_can_be_hidden(self):
        settings = dirty_rank.normalize_settings({"showLeaderboardsInMenu": "false"})

        self.assertFalse(settings["showLeaderboardsInMenu"])

    def test_battle_standings_visibility_is_preserved(self):
        for raw, expected in ((True, True), (False, False), ("true", True), ("false", False)):
            settings = dirty_rank.normalize_settings({"hideBattleStandings": raw})
            self.assertEqual(settings["hideBattleStandings"], expected)

    def test_header_buttons_are_independent(self):
        for battles, leaderboards in ((True, False), (False, True), (False, False), (True, True)):
            settings = dirty_rank.normalize_settings({
                "showBattlesInMenu": str(battles).lower(),
                "showLeaderboardsInMenu": str(leaderboards).lower(),
            })
            self.assertEqual(settings["showBattlesInMenu"], battles)
            self.assertEqual(settings["showLeaderboardsInMenu"], leaderboards)

    def test_leaderboard_counts_follow_layout_multiples(self):
        for top, count, expected in ((3, 18, 18), (4, 18, 20), (5, 18, 20),
                                     (3, 1, 6), (4, 21, 24), (5, 26, 30),
                                     (3, 2000, 999), (4, 2000, 1000), (5, 2000, 1000)):
            settings = dirty_rank.normalize_settings({
                "leaderboardTopCount": top, "leaderboardPerformerCount": count,
            })
            self.assertEqual(settings["leaderboardPerformerCount"], expected)
            self.assertEqual(settings["leaderboardPerformerCount"] % top, 0)


class DirtyRankProtocolTests(unittest.TestCase):
    """Drives the raw stdin/stdout plugin protocol in a real subprocess.

    read_payload/emit_output bind sys.stdin/sys.stdout as default arguments at
    import time, so a subprocess is the only faithful way to exercise main().
    """

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database = Path(self.temp_dir.name) / "protocol.sqlite3"

    def tearDown(self):
        self.temp_dir.cleanup()

    def run_backend(self, payload):
        environment = dict(os.environ)
        environment["DIRTY_PLUGINS_DATABASE_PATH"] = str(self.database)
        return subprocess.run(
            [sys.executable, str(MODULE_PATH)],
            input=json.dumps(payload),
            capture_output=True,
            check=False,
            text=True,
            env=environment,
        )

    def output(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        envelope = json.loads(result.stdout)
        self.assertIn("output", envelope, envelope)
        # DirtyRank emits the payload as a JSON string inside the envelope.
        return json.loads(envelope["output"])

    def test_record_load_undo_and_reset_round_trip_over_stdin_stdout(self):
        recorded = self.output(self.run_backend({"args": {
            "mode": "record", "battleId": "battle-1", "categoryId": "appearance",
            "cohort": "FEMALE", "leftId": "1", "rightId": "2", "outcome": "left",
        }}))
        self.assertFalse(recorded["duplicate"])

        loaded = self.output(self.run_backend({"args": {"mode": "loadAll"}}))
        self.assertEqual(loaded["version"], 2)
        self.assertIn("1", loaded["states"])
        self.assertIn("2", loaded["states"])

        undone = self.output(self.run_backend({"args": {
            "mode": "undo", "battleId": "battle-1", "categoryId": "appearance",
            "cohort": "FEMALE", "leftId": "1", "rightId": "2",
        }}))
        self.assertTrue(undone["undone"])

        reset = self.output(self.run_backend({"args": {
            "mode": "resetPool", "confirm": "RESET",
            "categoryId": "appearance", "cohort": "FEMALE",
        }}))
        self.assertEqual(reset, {"reset": 0}, "undo removed the only pool; the result carries only the count")

    def test_unknown_mode_reports_an_error_on_stdout_and_exits_nonzero(self):
        result = self.run_backend({"args": {"mode": "nonsense"}})

        self.assertEqual(result.returncode, 1)
        envelope = json.loads(result.stdout)
        self.assertIn("error", envelope)
        self.assertIn("Unsupported DirtyRank operation mode", envelope["error"])

    def test_empty_input_reports_an_error(self):
        environment = dict(os.environ)
        environment["DIRTY_PLUGINS_DATABASE_PATH"] = str(self.database)
        result = subprocess.run(
            [sys.executable, str(MODULE_PATH)],
            input="",
            capture_output=True,
            check=False,
            text=True,
            env=environment,
        )

        self.assertEqual(result.returncode, 1)
        self.assertIn(
            "Stash did not provide plugin input",
            json.loads(result.stdout)["error"],
        )


if __name__ == "__main__":
    unittest.main()
