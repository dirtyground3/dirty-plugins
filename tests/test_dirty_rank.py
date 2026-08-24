import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).parents[1] / "plugins" / "DirtyRank" / "dirty_rank.py"
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
        self.assertEqual([item["id"] for item in female], ["my-category", "second-category"])
        self.assertEqual([item["weight"] for item in female], [2.5, 0.01])
        self.assertEqual([(item["id"], item["weight"]) for item in male], [("physique", 3.0)])

    def test_defaults_apply_to_every_cohort_without_inactivity_setting(self):
        settings = dirty_rank.normalize_settings({})

        self.assertNotIn("ratingPeriodDays", settings)
        self.assertEqual(settings["evidenceWeight"], 2.0)
        self.assertEqual(settings["enabledCohorts"], ["FEMALE"])
        self.assertTrue(settings["showLeaderboardsInMenu"])
        self.assertFalse(settings["hidePerformerImages"])
        self.assertEqual(settings["confidenceGoal"], "ranking")
        self.assertEqual(settings["confidenceTopN"], 20)
        for cohort in dirty_rank.VALID_COHORTS:
            self.assertEqual(
                [item["id"] for item in settings["categoriesByCohort"][cohort]],
                ["appearance", "performance"],
            )

    def test_inactivity_configuration_is_removed(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")
        manifest = MODULE_PATH.with_name("dirtyRank.yml").read_text(encoding="utf-8")

        self.assertNotIn("ratingPeriodDays", source)
        self.assertNotIn("ratingPeriodDays", manifest)
        self.assertNotIn("Inactivity period", source)

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

    def test_enabled_cohorts_are_ordered_and_default_is_kept_valid(self):
        settings = dirty_rank.normalize_settings(
            {
                "defaultCohort": "TRANSGENDER_MALE",
                "enabledCohorts": json.dumps(["MALE", "FEMALE", "unknown"]),
            }
        )

        self.assertEqual(settings["enabledCohorts"], ["FEMALE", "MALE"])
        self.assertEqual(settings["defaultCohort"], "FEMALE")

    def test_performer_images_can_be_hidden_without_changing_pool_eligibility(self):
        settings = dirty_rank.normalize_settings(
            {"hidePerformerImages": True, "includePerformersWithoutImages": True}
        )

        self.assertTrue(settings["hidePerformerImages"])
        self.assertTrue(settings["includePerformersWithoutImages"])

    def test_leaderboards_menu_can_be_hidden(self):
        settings = dirty_rank.normalize_settings({"showLeaderboardsInMenu": "false"})

        self.assertFalse(settings["showLeaderboardsInMenu"])


class JavaScriptAlgorithmTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which("node"), "Node.js is required for JavaScript tests")
    def test_information_gain_matchmaker(self):
        script = Path(__file__).with_name("test_dirty_rank_algorithms.js")
        result = subprocess.run(
            ["node", str(script)],
            capture_output=True,
            check=False,
            text=True,
        )

        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_arrow_shortcuts_cover_tie_and_undo(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")

        self.assertIn('event.key === "ArrowUp"', source)
        self.assertIn('event.key === "ArrowDown"', source)
        self.assertIn("↑ tie · ↓ undo", source)
        self.assertIn("UNDO_HISTORY_LIMIT = 25", source)
        self.assertIn("setUndoHistory", source)
        self.assertIn("undoHistoryRef", source)
        self.assertIn('setFeedback({ text: "Undo queued" })', source)
        self.assertIn("voteQueueRef.current = voteQueueRef.current.then", source)
        self.assertNotIn("pendingVotesRef.current > 0 || !lastBattle", source)
        self.assertIn('"Undo" + (undoHistory.length', source)

    def test_selected_battle_category_is_persisted_per_cohort(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")

        self.assertIn("CATEGORY_PREFERENCE_STORAGE_KEY", source)
        self.assertIn("function preferredCategoryId", source)
        self.assertIn("rememberCategory(cohort, nextCategoryId)", source)
        self.assertIn(
            "preferredCategoryId(nextSettings, nextCohort, current)",
            source,
        )

    def test_battle_cards_conditionally_render_images(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")
        styles = MODULE_PATH.with_name("dirtyRank.css").read_text(encoding="utf-8")

        self.assertIn("hidePerformerImages", source)
        self.assertIn("dirty-rank-card-no-image", source)
        self.assertIn("var showMedia = showImages || Boolean(scene) || sceneLoading", source)
        self.assertIn("showMedia && h(", source)
        self.assertIn("showImages && performer.image_path", source)
        self.assertIn('get("censorMedia") === "1"', source)
        self.assertIn("dirty-rank-censored-media", styles)
        self.assertIn("blur(42px)", styles)

    def test_battle_cards_link_performers_and_animate_every_pair(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")
        styles = MODULE_PATH.with_name("dirtyRank.css").read_text(encoding="utf-8")

        self.assertIn('to: "/performers/" + performer.id', source)
        self.assertIn('event.stopPropagation()', source)
        self.assertIn(
            'onClick: scene ? function (event) { event.stopPropagation(); } : undefined',
            source,
        )
        self.assertIn('key: pairInfo.instanceId + ":left"', source)
        self.assertIn('key: pairInfo.instanceId + ":right"', source)
        self.assertIn("@keyframes dirty-rank-card-change", styles)
        self.assertIn(".dirty-rank-image-ready .dirty-rank-image", styles)
        self.assertIn("@media (prefers-reduced-motion: reduce)", styles)

    def test_next_battle_is_prepared_and_images_are_preloaded(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")
        styles = MODULE_PATH.with_name("dirtyRank.css").read_text(encoding="utf-8")

        self.assertIn("preparedPairRef", source)
        self.assertIn("function preloadPairImages", source)
        self.assertIn('new window.Image()', source)
        self.assertIn("window.requestIdleCallback(prepareNextPair, { timeout: 300 })", source)
        self.assertIn("function showPreparedOrPickNext", source)
        self.assertIn("showPreparedOrPickNext();", source)
        self.assertIn("animation: dirty-rank-card-change 250ms", styles)
        self.assertIn("transition: opacity 180ms", styles)

    def test_pending_operations_guard_navigation_and_page_close(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")

        self.assertIn("var Prompt = Router.Prompt", source)
        self.assertIn('window.addEventListener("beforeunload", preventPendingOperationExit)', source)
        self.assertIn('window.removeEventListener("beforeunload", preventPendingOperationExit)', source)
        self.assertIn("when: pendingVotes > 0", source)
        self.assertIn("DirtyRank is still saving queued votes or undos", source)

    def test_gauntlet_route_and_performer_page_launch_are_registered(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")
        styles = MODULE_PATH.with_name("dirtyRank.css").read_text(encoding="utf-8")

        self.assertIn('GAUNTLET_ROUTE_PATH = "/plugins/dirty-rank/gauntlet/:performerId"', source)
        self.assertIn("function selectGauntletPair", source)
        self.assertIn("function GauntletConfidenceIndicator", source)
        self.assertIn('tier.id !== "provisional" ? " dirty-rank-gauntlet-established"', source)
        self.assertIn(".dirty-rank-gauntlet-confidence.dirty-rank-gauntlet-established", styles)
        self.assertIn("dirty-rank-gauntlet-excellent", source)
        self.assertIn("function DirtyRankGauntletLaunch", source)
        self.assertIn('PluginApi.register.route(GAUNTLET_ROUTE_PATH, DirtyRankRoute)', source)
        self.assertIn("gauntletPathActive && !routeTargetId", source)
        self.assertIn('PluginApi.patch.after("PerformerDetailsPanel"', source)
        self.assertIn('" Start Gauntlet"', source)
        self.assertIn("dirty-rank-card-gauntlet-target", styles)
        self.assertIn("dirty-rank-gauntlet-launch", styles)

    def test_dedicated_leaderboards_route_has_filters_stats_and_podium(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")
        styles = MODULE_PATH.with_name("dirtyRank.css").read_text(encoding="utf-8")

        self.assertIn('LEADERBOARDS_ROUTE_PATH = "/plugins/dirty-rank-leaderboards"', source)
        self.assertIn("DirtyRankLeaderboardsRoute", source)
        self.assertIn('PluginApi.register.route(LEADERBOARDS_ROUTE_PATH', source)
        self.assertIn('"Overall (weighted)"', source)
        self.assertIn('"Rated coverage"', source)
        self.assertIn('"Median RD"', source)
        self.assertIn('"Draw rate"', source)
        self.assertIn('"Gold", "Silver", "Bronze"', source)
        self.assertIn("var podiumOrder = [1, 0, 2]", source)
        self.assertIn("dirty-rank-podium-step", source)
        self.assertIn('useState("gallery")', source)
        self.assertIn('}, "Table")', source)
        self.assertIn('}, "Gallery")', source)
        self.assertIn("function LeaderboardGallery", source)
        self.assertIn("function LeaderboardPagination", source)
        self.assertIn("LEADERBOARD_TABLE_PAGE_SIZE = 25", source)
        self.assertIn("LEADERBOARD_GALLERY_PAGE_SIZE = 15", source)
        self.assertIn("dirty-rank-gallery-grid", styles)
        self.assertIn("dirty-rank-pagination", styles)
        self.assertIn("function precisionTier", source)
        self.assertIn("dirty-rank-status-refined", styles)
        self.assertIn("dirty-rank-status-excellent", styles)
        self.assertIn(".dirty-rank-podium-1 {\n  grid-column: 2", styles)
        self.assertIn(".dirty-rank-podium-2 {\n  grid-column: 1", styles)
        self.assertIn(".dirty-rank-podium-3 {\n  grid-column: 3", styles)

    def test_battle_sidebar_uses_the_selected_category_standings(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")
        sidebar = source[source.index("function Leaderboard(props)") : source.index("function ConfidenceIndicator")]

        self.assertIn("props.category.id", sidebar)
        self.assertIn('props.category.name + " standings"', sidebar)
        self.assertIn('"Current battle category · top 12"', sidebar)
        self.assertNotIn("rankOverallPerformers", sidebar)
        self.assertNotIn("overallPoolFor", sidebar)

    def test_confidence_copy_separates_rating_precision_from_order_confidence(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")

        self.assertIn('"order-separating"', source)
        self.assertIn('confidence.refined.toLocaleString()', source)
        self.assertIn('confidence.excellent.toLocaleString()', source)
        self.assertIn("var refinedTie =", source)
        self.assertIn("function confidenceProgress", source)
        self.assertIn("completedBattles / total * 100", source)
        self.assertNotIn("ORDER_TIE_GAP", source)

    def test_sex_selectors_only_render_for_multiple_enabled_cohorts(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")

        self.assertIn("enabledCohorts", source)
        self.assertIn('availableCohorts.length > 1 && h("div"', source)
        self.assertIn('id: "dirty-rank-battle-cohort"', source)
        self.assertIn('id: "dirty-rank-leaderboard-cohort"', source)
        self.assertIn('title: "Performer sexes"', source)

    def test_leaderboards_navigation_is_configurable(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")

        self.assertIn("showLeaderboardsInMenu", source)
        self.assertIn("DirtyRankLeaderboardsNavLink", source)
        self.assertIn("dirty-rank-leaderboards-nav-link", source)
        self.assertIn('label: "Show Leaderboards in the navigation menu"', source)

    def test_category_editor_only_lists_enabled_cohorts(self):
        source = MODULE_PATH.with_name("dirtyRank.js").read_text(encoding="utf-8")

        category_editor = source[source.index('id: "dirty-rank-category-cohort"') :]
        self.assertIn("draft.enabledCohorts.indexOf(item[0]) !== -1", category_editor)
        self.assertIn("nextEditingCohort", source)
        self.assertIn(
            'draft.enabledCohorts.length > 1 && h("div", { className: "dirty-rank-category-cohort" }',
            source,
        )

if __name__ == "__main__":
    unittest.main()
