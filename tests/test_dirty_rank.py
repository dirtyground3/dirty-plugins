from plugin_paths import runtime_path
import importlib.util
import json
import math
import os
import random
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock


MODULE_PATH = runtime_path("DirtyRank", "dirty_rank.py")
SPEC = importlib.util.spec_from_file_location("dirty_rank", MODULE_PATH)
dirty_rank = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = dirty_rank
SPEC.loader.exec_module(dirty_rank)
import dirty_rank_rating as rating_model  # noqa: E402  (beside dirty_rank on its path)

THRESHOLDS = dirty_rank.VERDICT_THRESHOLDS


class FitTests(unittest.TestCase):
    def setUp(self):
        self.settings = dirty_rank.normalize_settings({})

    def fit(self, verdicts, **overrides):
        settings = {**self.settings, **overrides}
        return dirty_rank.fit_ratings(
            [dirty_rank.Verdict(str(left), str(right), score) for left, right, score in verdicts],
            settings,
            THRESHOLDS,
        )

    def test_verdict_probabilities_cover_every_answer_and_mirror(self):
        for difference in (-4.0, -0.3, 0.0, 1.2, 6.0):
            probabilities = [rating_model.verdict_probability(difference, score, THRESHOLDS) for score in range(-3, 4)]
            self.assertAlmostEqual(sum(probabilities), 1.0, places=12)
            self.assertTrue(all(probability > 0 for probability in probabilities))
            for score in range(-3, 4):
                self.assertAlmostEqual(
                    rating_model.verdict_probability(difference, score, THRESHOLDS),
                    rating_model.verdict_probability(-difference, -score, THRESHOLDS),
                    places=12,
                )
        # A clear lead makes a strong verdict for the leader the likeliest answer.
        leading = [rating_model.verdict_probability(4.0, score, THRESHOLDS) for score in range(-3, 4)]
        self.assertEqual(leading.index(max(leading)) - 3, 3)

    def test_one_verdict_moves_both_performers_equally(self):
        ratings = self.fit([(1, 2, 2)]).ratings

        # Converged within about 0.002 points.
        self.assertAlmostEqual(ratings["1"].rating - 1000, 1000 - ratings["2"].rating, delta=0.01)
        self.assertGreater(ratings["1"].rating, 1000)
        self.assertAlmostEqual(ratings["1"].deviation, ratings["2"].deviation, delta=0.01)
        self.assertLess(ratings["1"].deviation, self.settings["initialDeviation"])
        self.assertEqual((ratings["1"].matches, ratings["1"].wins), (1, 1))
        self.assertEqual((ratings["2"].matches, ratings["2"].losses), (1, 1))

    def test_stronger_verdicts_mean_larger_gaps(self):
        gaps = []
        for score in range(-3, 4):
            ratings = self.fit([(1, 2, score)]).ratings
            gaps.append(ratings["1"].rating - ratings["2"].rating)
        self.assertAlmostEqual(gaps[3], 0.0, delta=0.01)
        for weaker, stronger in zip(gaps[3:], gaps[4:]):
            self.assertGreater(stronger, weaker)
        for index in range(3):
            self.assertAlmostEqual(gaps[index], -gaps[6 - index], delta=0.01)

    def test_equal_verdict_pulls_ratings_together(self):
        apart = self.fit([(1, 3, 3), (2, 3, 1)]).ratings
        together = self.fit([(1, 3, 3), (2, 3, 1), (1, 2, 0)]).ratings

        self.assertLess(together["1"].rating - together["2"].rating, apart["1"].rating - apart["2"].rating)
        self.assertEqual((together["1"].draws, together["2"].draws), (1, 1))

    def test_verdict_order_does_not_change_ratings(self):
        verdicts = [(1, 2, 2), (2, 3, 1), (3, 1, 0), (1, 4, -3), (4, 2, 2), (3, 4, 1)]
        forward = self.fit(verdicts)
        backward = self.fit(list(reversed(verdicts)))

        for performer, rating in forward.ratings.items():
            self.assertAlmostEqual(rating.rating, backward.ratings[performer].rating, delta=0.01)
            self.assertAlmostEqual(rating.deviation, backward.ratings[performer].deviation, delta=0.01)
        for left, right in zip(forward.thresholds, backward.thresholds):
            self.assertAlmostEqual(left, right, delta=0.001)

    def test_later_verdicts_revalue_earlier_ones(self):
        # Beating a newcomer who later proves strong is worth more once that is known.
        early = self.fit([(1, 2, 1)]).ratings
        later = self.fit([(1, 2, 1)] + [(2, opponent, 2) for opponent in range(3, 9)]).ratings

        self.assertGreater(later["1"].rating, early["1"].rating)

    def test_evidence_weight_sets_how_much_a_verdict_counts(self):
        verdicts = [(1, 2, 1), (2, 3, 1), (1, 3, 2)]
        deviations = [self.fit(verdicts, evidenceWeight=weight).ratings["1"].deviation for weight in (0.5, 1.0, 2.0)]

        self.assertGreater(deviations[0], deviations[1])
        self.assertGreater(deviations[1], deviations[2])

    def test_thresholds_start_at_the_defaults_and_learn_the_scale(self):
        self.assertEqual(self.fit([]).thresholds, THRESHOLDS)
        # Someone who keeps most verdicts at "slightly" spreads the thresholds out.
        generator = random.Random(7)
        truth = {str(index): generator.gauss(0, 1.2) for index in range(60)}
        actual = (1.2, 2.6, 4.0)

        def answer(difference):
            draw, total = generator.random(), 0.0
            for score in range(-3, 4):
                total += rating_model.verdict_probability(difference, score, actual)
                if draw <= total:
                    return score
            return 3

        pairs = set()
        while len(pairs) < 700:
            pairs.add(tuple(generator.sample(sorted(truth), 2)))
        verdicts = [(left, right, answer(truth[left] - truth[right])) for left, right in sorted(pairs)]
        learned = self.fit(verdicts).thresholds

        self.assertLess(learned[0], learned[1])
        self.assertLess(learned[1], learned[2])
        for default, fitted, true in zip(THRESHOLDS, learned, actual):
            self.assertLess(abs(fitted - true), abs(default - true))

    def test_rating_has_no_user_facing_ceiling(self):
        ratings = self.fit([(1, 2, 3)], initialRating=99999).ratings

        self.assertGreater(ratings["1"].rating, 99999)
        self.assertAlmostEqual(ratings["1"].rating - 99999, 99999 - ratings["2"].rating, delta=0.01)

    def test_deviation_stays_between_floor_and_starting_deviation(self):
        verdicts = [(1, opponent, 0) for opponent in range(2, 400)]
        ratings = self.fit(verdicts, evidenceWeight=3).ratings

        self.assertEqual(ratings["1"].deviation, self.settings["deviationFloor"])
        unbeaten = self.fit([(1, opponent, 3) for opponent in range(2, 52)]).ratings
        self.assertLessEqual(unbeaten["1"].deviation, self.settings["initialDeviation"])
        self.assertTrue(all(math.isfinite(rating.rating) for rating in unbeaten.values()))


class DirtyRankOperationTests(unittest.TestCase):
    def setUp(self):
        self.settings = dirty_rank.normalize_settings({})
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repository = dirty_rank.RatingRepository(Path(self.temp_dir.name) / "dirty.sqlite3")
        self.now = datetime(2026, 8, 21, 12, 0, tzinfo=timezone.utc)

    def tearDown(self):
        self.temp_dir.cleanup()

    def state(self, performer_id, repository=None):
        repository = repository or self.repository
        with repository.connect() as connection:
            return repository.state(connection, str(performer_id))

    def stored_verdicts(self, repository=None):
        repository = repository or self.repository
        with repository.connect() as connection:
            return [tuple(row) for row in connection.execute(
                "SELECT category_id, cohort, low_id, high_id, score, confirmations FROM dirty_rank_verdicts"
                " ORDER BY category_id, cohort, low_id, high_id"
            )]

    def assertSamePools(self, actual, expected):
        """Pools match: refits store a rating only once it moves by 0.01 or more."""
        self.assertEqual(set(actual), set(expected))
        for performer, state in actual.items():
            self.assertEqual(set(state["pools"]), set(expected[performer]["pools"]))
            for key, pool in state["pools"].items():
                other = expected[performer]["pools"][key]
                self.assertAlmostEqual(pool["rating"], other["rating"], delta=0.011)
                self.assertAlmostEqual(pool["deviation"], other["deviation"], delta=0.011)
                self.assertEqual({k: v for k, v in pool.items() if k not in ("rating", "deviation")},
                                 {k: v for k, v in other.items() if k not in ("rating", "deviation")})

    def verdict_args(self, verdict_id="verdict-1", **changes):
        return {
            "leftId": "1",
            "rightId": "2",
            "verdictId": verdict_id,
            "categoryId": "appearance",
            "cohort": "FEMALE",
            "score": 2,
            **changes,
        }

    def record(self, verdict_id="verdict-1", repository=None, settings=None, now=None, **changes):
        return dirty_rank.record_verdict(
            repository or self.repository, self.verdict_args(verdict_id, **changes), settings or self.settings,
            now or self.now,
        )

    def undo(self, verdict_id="verdict-1", repository=None, settings=None, **changes):
        return dirty_rank.undo_verdict(
            repository or self.repository, self.verdict_args(verdict_id, **changes), settings or self.settings
        )

    def test_record_is_precise_idempotent_and_category_scoped(self):
        first = self.record()
        duplicate = self.record()
        key = dirty_rank.pool_key("appearance", "FEMALE")
        left_state = self.state("1")
        right_state = self.state("2")

        self.assertFalse(first["duplicate"])
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["changed"], [])
        self.assertEqual(first["verdict"], ["1", "2", 2, 0])
        self.assertEqual(duplicate["verdict"], ["1", "2", 2, 0])
        self.assertEqual(len(first["thresholds"]), 3)
        self.assertGreater(left_state["pools"][key]["rating"], 1000)
        self.assertLess(right_state["pools"][key]["rating"], 1000)
        self.assertIsInstance(left_state["pools"][key]["rating"], float)
        self.assertEqual(left_state["pools"][key]["matches"], 1)
        self.assertEqual(self.stored_verdicts(), [("appearance", "FEMALE", "1", "2", 2, 0)])
        self.assertNotIn("performance|FEMALE", left_state["pools"])

    def test_a_pair_keeps_one_verdict_from_the_first_id_side(self):
        self.record(leftId="2", rightId="1", score=3)

        self.assertEqual(self.stored_verdicts(), [("appearance", "FEMALE", "1", "2", -3, 0)])
        key = dirty_rank.pool_key("appearance", "FEMALE")
        self.assertGreater(self.state("2")["pools"][key]["rating"], self.state("1")["pools"][key]["rating"])

    def test_choosing_the_same_verdict_again_confirms_it_without_moving_ratings(self):
        first = self.record("first", score=1)
        confirmed = self.record("again", leftId="2", rightId="1", score=-1)

        self.assertEqual(confirmed["verdict"], ["1", "2", 1, 1])
        self.assertEqual(confirmed["changed"], [])
        self.assertEqual(confirmed["left"]["state"]["revision"], first["left"]["state"]["revision"])
        self.assertEqual(self.stored_verdicts(), [("appearance", "FEMALE", "1", "2", 1, 1)])

    def test_a_different_verdict_replaces_the_earlier_one(self):
        self.record("first", score=2)
        self.record("confirm", score=2)
        replaced = self.record("change", score=-1)
        key = dirty_rank.pool_key("appearance", "FEMALE")

        self.assertEqual(replaced["verdict"], ["1", "2", -1, 0])
        self.assertEqual(self.state("1")["pools"][key]["matches"], 1)
        self.assertLess(self.state("1")["pools"][key]["rating"], 1000)
        self.assertEqual({item["id"] for item in replaced["changed"]}, {"1", "2"})

    def test_undo_restores_what_the_pair_had_before(self):
        key = dirty_rank.pool_key("appearance", "FEMALE")
        self.record("first", score=2)
        before = self.state("1")
        later = self.now + timedelta(hours=1)
        self.record("confirm", score=2, now=later)
        self.record("change", score=-3, now=later)

        undone = self.undo("change")
        self.assertTrue(undone["undone"])
        self.assertEqual(undone["verdict"], ["1", "2", 2, 1])
        # A confirmation keeps the time the score was given.
        self.assertEqual(self.state("1")["pools"][key]["lastRatedAt"], dirty_rank.iso_time(self.now))
        self.undo("confirm")
        self.assertEqual(self.stored_verdicts(), [("appearance", "FEMALE", "1", "2", 2, 0)])
        self.assertEqual(self.state("1")["pools"], before["pools"])
        removed = self.undo("first")
        self.assertEqual(removed["verdict"], ["1", "2", None, 0])
        self.assertNotIn(key, self.state("1")["pools"])
        self.assertNotIn(key, self.state("2")["pools"])
        with self.assertRaisesRegex(dirty_rank.PluginError, "not available to undo"):
            self.undo("first")

    def test_only_the_latest_choice_on_a_pair_can_be_undone(self):
        self.record("first", score=1)
        self.record("second", score=-1)

        with self.assertRaisesRegex(dirty_rank.PluginError, "later verdict on this pair"):
            self.undo("first")
        with self.assertRaisesRegex(dirty_rank.PluginError, "do not match"):
            self.undo("second", rightId="3")

    def test_any_verdict_can_be_undone_exactly(self):
        other_pool = self.verdict_args("other-pool", categoryId="performance")
        dirty_rank.record_verdict(self.repository, other_pool, self.settings, self.now)
        verdicts = [self.verdict_args(f"verdict-{index}", rightId=str(2 + index), score=index % 7 - 3)
                    for index in range(40)]
        for verdict in verdicts:
            dirty_rank.record_verdict(self.repository, verdict, self.settings, self.now)

        before_retry = self.state("1")
        retry = dirty_rank.record_verdict(self.repository, verdicts[0], self.settings, self.now)
        self.assertTrue(retry["duplicate"])
        self.assertEqual(self.state("1"), before_retry)

        # The oldest verdict undoes as if it had never been given.
        undone = dirty_rank.undo_verdict(self.repository, verdicts[0], self.settings)
        expected = dirty_rank.RatingRepository(Path(self.temp_dir.name) / "expected.sqlite3")
        dirty_rank.record_verdict(expected, other_pool, self.settings, self.now)
        for verdict in verdicts[1:]:
            dirty_rank.record_verdict(expected, verdict, self.settings, self.now)
        self.assertSamePools(self.repository.all_states()["states"], expected.all_states()["states"])
        self.assertLessEqual({"1", "2"}, {item["id"] for item in undone["changed"]})
        with self.repository.connect() as connection:
            row = connection.execute(
                "SELECT score, undone_at FROM dirty_rank_verdict_log WHERE verdict_id='verdict-0'"
            ).fetchone()
        self.assertEqual(row["score"], -3)
        self.assertIsNotNone(row["undone_at"])

    def test_verdict_returns_every_performer_the_refit_moved(self):
        self.record("a", rightId="3")
        result = self.record("b")

        changed = {item["id"]: item["state"] for item in result["changed"]}
        self.assertEqual(set(changed), {"1", "2", "3"})
        self.assertEqual(changed["3"], self.state("3"))
        self.assertEqual(changed["1"], result["left"]["state"])
        self.assertEqual(result["left"]["state"]["revision"], result["right"]["state"]["revision"])

    def test_load_verdicts_returns_one_pool_and_its_thresholds(self):
        self.record("a", score=1)
        self.record("b", rightId="3", score=-2)
        self.record("c", categoryId="performance")

        loaded = dirty_rank.load_verdicts(self.repository, {"categoryId": "appearance", "cohort": "FEMALE"},
                                          self.settings)
        self.assertEqual(loaded["verdicts"], [["1", "2", 1, 0], ["1", "3", -2, 0]])
        self.assertEqual(len(loaded["thresholds"]), 3)
        self.assertNotEqual(tuple(loaded["thresholds"]), THRESHOLDS)
        empty = dirty_rank.load_verdicts(self.repository, {"categoryId": "appearance", "cohort": "MALE"},
                                         self.settings)
        self.assertEqual(empty["verdicts"], [])
        self.assertEqual(tuple(empty["thresholds"]), THRESHOLDS)

    def test_invalid_verdicts_are_rejected(self):
        for score in (4, -4, 1.5, "2", True, None):
            with self.subTest(score=score), self.assertRaisesRegex(dirty_rank.PluginError, "whole number"):
                self.record(score=score)
        with self.assertRaisesRegex(dirty_rank.PluginError, "two different performers"):
            self.record(rightId="1")
        with self.assertRaisesRegex(dirty_rank.PluginError, "idempotency"):
            self.record(verdict_id="")

    def test_changing_rating_settings_refits_every_verdict(self):
        database = self.repository.path
        self.record()
        key = dirty_rank.pool_key("appearance", "FEMALE")
        before = self.state("1")["pools"][key]
        with mock.patch.dict(os.environ, {"DIRTY_PLUGINS_DATABASE_PATH": str(database)}):
            snapshot = dirty_rank.run({"args": {"mode": "getSettings"}})
            for changed in ({"evidenceWeight": 2}, {"evidenceWeight": 2, "initialRating": 1500}):
                saved = dirty_rank.run({"args": {"mode": "saveSettings",
                                                 "settings": dict(snapshot["settings"], **changed),
                                                 "expectedRevision": snapshot["revision"]}})
                snapshot = {"revision": saved["revision"], "settings": saved["settings"]}
                if "initialRating" not in changed:
                    weighted = self.state("1")["pools"][key]
                    self.assertLess(weighted["deviation"], before["deviation"])
                    self.assertGreater(weighted["rating"], before["rating"])
        shifted = self.state("1")["pools"][key]
        self.assertAlmostEqual(shifted["rating"] - 1500, weighted["rating"] - 1000, delta=0.01)
        self.assertGreater(self.repository.all_states()["revision"], 2)

    def previous_database(self, version):
        """A database written before verdicts: Glicko-2 battles (1, 2) or fitted battles (3)."""
        database = Path(self.temp_dir.name) / f"previous-{version}.sqlite3"
        connection = dirty_rank.shared_storage.connect(database)
        connection.executescript("""
            CREATE TABLE dirty_rank_pools (
              performer_id TEXT NOT NULL, category_id TEXT NOT NULL, cohort TEXT NOT NULL,
              rating REAL NOT NULL, deviation REAL NOT NULL, matches INTEGER NOT NULL,
              wins INTEGER NOT NULL, losses INTEGER NOT NULL, draws INTEGER NOT NULL, last_rated_at TEXT,
              PRIMARY KEY (performer_id, category_id, cohort)
            );
            CREATE TABLE dirty_rank_battles (
              sequence INTEGER PRIMARY KEY AUTOINCREMENT, battle_id TEXT NOT NULL UNIQUE,
              category_id TEXT NOT NULL, cohort TEXT NOT NULL, left_id TEXT NOT NULL,
              right_id TEXT NOT NULL, outcome TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
              created_at TEXT NOT NULL, undone_at TEXT
            );
        """)
        if version == 3:
            connection.execute("""CREATE TABLE dirty_rank_baselines (
              performer_id TEXT NOT NULL, category_id TEXT NOT NULL, cohort TEXT NOT NULL,
              rating_offset REAL NOT NULL, deviation REAL NOT NULL, matches INTEGER NOT NULL,
              wins INTEGER NOT NULL, losses INTEGER NOT NULL, draws INTEGER NOT NULL, last_rated_at TEXT,
              PRIMARY KEY (performer_id, category_id, cohort))""")
        if version > 1:
            connection.execute(
                "INSERT INTO dirty_schema_versions(plugin_id, version, applied_at) VALUES ('dirtyRank', ?, 'then')",
                (version,),
            )
        connection.executemany(
            """INSERT INTO dirty_rank_battles(battle_id, category_id, cohort, left_id, right_id, outcome, created_at)
               VALUES (?, 'appearance', 'FEMALE', '1', '2', 'right', ?)""",
            [(f"previous-{index}", self.now.isoformat()) for index in range(12)],
        )
        connection.executemany(
            "INSERT INTO dirty_rank_pools VALUES (?, 'appearance', 'FEMALE', ?, 60, 12, ?, ?, 0, ?)",
            [("1", 700.0, 0, 12, self.now.isoformat()), ("2", 1300.0, 12, 0, self.now.isoformat())],
        )
        connection.commit()
        connection.close()
        dirty_rank.shared_storage.set_plugin_settings(
            dirty_rank.PLUGIN_ID,
            {"tau": 0.5, "initialVolatility": 0.06, "evidenceWeight": 2, "initialDeviation": 350,
             "calibrationPercent": 5, "avoidRepeatWindow": 20, "confidenceTopN": 15},
            path=database,
        )
        return database

    def test_upgrade_keeps_battles_in_a_backup_and_starts_every_pool_fresh(self):
        for version in (1, 2, 3):
            with self.subTest(version=version):
                database = self.previous_database(version)
                repository = dirty_rank.RatingRepository(database)

                payload = repository.all_states()
                self.assertEqual(payload["states"], {})
                self.assertEqual(payload["revision"], 1)
                stored = dirty_rank.shared_storage.get_plugin_settings(dirty_rank.PLUGIN_ID, path=database)
                self.assertEqual(stored, {"confidenceTopN": 15})
                with repository.connect() as connection:
                    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
                self.assertFalse({"dirty_rank_battles", "dirty_rank_baselines"} & tables)
                self.assertLessEqual({"dirty_rank_verdicts", "dirty_rank_verdict_log", "dirty_rank_scales"}, tables)
                backups = sorted(database.parent.glob("dirty_plugins-backup-*"))
                self.assertEqual(len(backups), version)
                backup = dirty_rank.shared_storage.connect(backups[-1])
                try:
                    self.assertEqual(backup.execute("SELECT COUNT(*) FROM dirty_rank_battles").fetchone()[0], 12)
                finally:
                    backup.close()

                dirty_rank.RatingRepository(database)
                self.assertEqual(len(list(database.parent.glob("dirty_plugins-backup-*"))), version)
                self.record("after-upgrade", repository=repository)
                self.assertEqual(self.stored_verdicts(repository), [("appearance", "FEMALE", "1", "2", 2, 0)])

    def test_load_all_returns_sqlite_rating_index(self):
        self.record()
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
        first = self.record()
        original_revision = self.repository.revision
        interleaved = False

        def revision_then_write(connection):
            nonlocal interleaved
            revision = original_revision(connection)
            if not interleaved:
                interleaved = True
                self.assertTrue(connection.in_transaction)
                self.record("verdict-2", rightId="3")
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

    def test_renamed_labels_move_ratings_verdicts_and_undo_through_id_swaps(self):
        database = Path(self.temp_dir.name) / "rename-chain.sqlite3"
        repository = dirty_rank.RatingRepository(database)
        for category_id in ("appearance", "performance", "category-1"):
            label = "Category 1" if category_id == "category-1" else category_id.title()
            settings = dirty_rank.normalize_settings({"categories": json.dumps({
                "FEMALE": [{"name": label}],
            })})
            self.record("verdict-" + category_id, repository=repository, settings=settings, categoryId=category_id)
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
            loaded = dirty_rank.run({"args": {"mode": "loadVerdicts", "categoryId": "breasts", "cohort": "FEMALE"}})
            self.assertEqual(loaded["verdicts"], [["1", "2", 2, 0]])
            dirty_rank.run({"args": {"mode": "undo", "leftId": "1", "rightId": "2",
                                     "verdictId": "verdict-appearance", "categoryId": "breasts",
                                     "cohort": "FEMALE"}})
        with repository.connect() as connection:
            self.assertIsNone(repository.pool(connection, "1", "breasts", "FEMALE"))
            self.assertEqual(connection.execute(
                "SELECT category_id FROM dirty_rank_verdict_log WHERE verdict_id='verdict-appearance'"
            ).fetchone()[0], "breasts")

    def test_saving_renamed_label_moves_existing_pool_and_rejects_stale_revision(self):
        database = Path(self.temp_dir.name) / "rename.sqlite3"
        repository = dirty_rank.RatingRepository(database)
        self.record(repository=repository)
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
            self.assertEqual({row[0] for row in connection.execute(
                "SELECT category_id FROM dirty_rank_scales UNION SELECT category_id FROM dirty_rank_verdicts"
            )}, {"etoile"})

    def test_adding_genders_preserves_existing_pools_and_verdicts(self):
        database = Path(self.temp_dir.name) / "mixed.sqlite3"
        repository = dirty_rank.RatingRepository(database)
        self.record(repository=repository)
        male_settings = dirty_rank.normalize_settings({"genderBoxes": [
            {"id": "FEMALE", "genders": ["FEMALE"]}, {"id": "MALE", "genders": ["MALE"]},
        ]})
        self.record("male-existing", repository=repository, settings=male_settings, cohort="MALE")
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
        self.assertEqual(len(self.stored_verdicts(repository)), 2)
        mixed_settings = dirty_rank.normalize_settings(changed)
        mixed = self.record("mixed-new", repository=repository, settings=mixed_settings, rightId="3")
        self.assertEqual(mixed["left"]["pool"]["matches"], 2)
        self.assertEqual(mixed["right"]["pool"]["matches"], 1)
        with repository.connect() as connection:
            self.assertEqual(repository.state(connection, "1")["pools"]["appearance|MALE"],
                             original["pools"]["appearance|MALE"])
        self.undo("mixed-new", repository=repository, settings=mixed_settings, rightId="3")
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
            self.record("verdict-" + box, repository=repository, settings=settings, cohort=box)
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
            dirty_rank.reset_pool(repository, {"categoryId": "appearance", "cohort": "BOX-1"}, settings,
                                  dirty_rank.Reporter())
        dirty_rank.reset_pool(repository, {"categoryId": "appearance", "cohort": "BOX-1", "confirm": "RESET"},
                              settings, dirty_rank.Reporter())
        with repository.connect() as connection:
            self.assertEqual(set(repository.state(connection, "1")["pools"]), {"power|BOX-2"})
        self.assertEqual([row[:2] for row in self.stored_verdicts(repository)], [("power", "BOX-2")])
        self.undo("verdict-BOX-2", repository=repository, settings=settings, categoryId="power", cohort="BOX-2")
        with repository.connect() as connection:
            self.assertEqual(repository.state(connection, "1")["pools"], {})
        with self.assertRaises(dirty_rank.PluginError):
            self.record("invalid-box", repository=repository, settings=settings, cohort="BOX-4")

    def test_verdict_for_disabled_cohort_is_rejected(self):
        settings = dirty_rank.normalize_settings(
            {"defaultCohort": "MALE", "enabledCohorts": json.dumps(["MALE"])}
        )

        with self.assertRaisesRegex(dirty_rank.PluginError, "disabled for FEMALE"):
            self.record(settings=settings)


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
        self.assertEqual(settings["evidenceWeight"], 1.0)
        self.assertEqual(settings["initialDeviation"], 500.0)
        self.assertNotIn("tau", settings)
        self.assertNotIn("initialVolatility", settings)
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
            0.25,
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
        pair = {"categoryId": "appearance", "cohort": "FEMALE", "leftId": "1", "rightId": "2"}
        recorded = self.output(self.run_backend({"args": {
            "mode": "record", "verdictId": "verdict-1", "score": -1, **pair,
        }}))
        self.assertFalse(recorded["duplicate"])
        self.assertEqual(recorded["verdict"], ["1", "2", -1, 0])

        loaded = self.output(self.run_backend({"args": {"mode": "loadAll"}}))
        self.assertEqual(loaded["version"], 2)
        self.assertIn("1", loaded["states"])
        self.assertIn("2", loaded["states"])
        verdicts = self.output(self.run_backend({"args": {
            "mode": "loadVerdicts", "categoryId": "appearance", "cohort": "FEMALE",
        }}))
        self.assertEqual(verdicts["verdicts"], [["1", "2", -1, 0]])

        undone = self.output(self.run_backend({"args": {"mode": "undo", "verdictId": "verdict-1", **pair}}))
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
