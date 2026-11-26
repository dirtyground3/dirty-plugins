"""DirtyRank backend: category-scoped ratings for Stash performers, fitted to every verdict."""

from __future__ import annotations

import copy
import json
import math
import re
import sqlite3
import sys
import unicodedata
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
# Defaults, bounds and default categories are generated from schemas/dirtyRank.settings.json.
from dirty_rank_metadata import CONSTANTS, DEFAULTS, LIMITS  # noqa: E402


PLUGIN_ID = "dirtyRank"
STATE_VERSION = 2
# A refit rewrites a stored pool only when it moves by at least this much.
WRITE_TOLERANCE = 0.01
VERDICT_THRESHOLDS = tuple(float(value) for value in CONSTANTS["verdictThresholds"])
# Changing these refits every pool, so the new values apply to all verdicts.
FIT_SETTINGS = ("initialRating", "initialDeviation", "evidenceWeight", "deviationFloor")
# Settings of earlier rating models and matchmaking, and values tuned for them.
RETIRED_SETTINGS = (
    "tau", "initialVolatility", "evidenceWeight", "initialDeviation", "avoidRepeatWindow", "calibrationPercent",
)
# Tables of the battle journal that verdicts replaced.
PREVIOUS_TABLES = (
    "dirty_rank_pools", "dirty_rank_baselines", "dirty_rank_battles",
    "dirty_rank_pools_previous", "dirty_rank_battles_previous",
)
VALID_COHORTS = {
    "FEMALE",
    "MALE",
    "TRANSGENDER_FEMALE",
    "TRANSGENDER_MALE",
    "INTERSEX",
    "NON_BINARY",
}
COHORT_ORDER = [
    "FEMALE",
    "MALE",
    "TRANSGENDER_FEMALE",
    "TRANSGENDER_MALE",
    "INTERSEX",
    "NON_BINARY",
]
DEFAULT_CATEGORY_DEFINITIONS = CONSTANTS["defaultCategories"]


for folder in ("dirtyPlugins", "DirtyPlugins"):  # installed plugin ID, then source directory
    shared = Path(__file__).resolve().parent.parent / folder
    if (shared / "dirty_plugins_storage.py").is_file():
        sys.path.insert(0, str(shared))
        break
else:
    raise RuntimeError("DirtyPlugins shared storage is not installed")
import dirty_plugins_storage as shared_storage
from dirty_plugins_protocol import Reporter
import dirty_plugins_protocol as protocol
from dirty_rank_rating import VERDICT_LIMIT, PluginError, Rating, Verdict, fit_ratings


def _finite_number(value: Any, fallback: float, minimum: float, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    if not math.isfinite(number):
        return fallback
    return min(max(number, minimum), maximum)


def _integer(value: Any, fallback: int, minimum: int, maximum: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return fallback
    return min(max(number, minimum), maximum)


def _bounded(source: dict[str, Any], key: str, minimum: float | None = None, maximum: float | None = None) -> float:
    """A real-valued setting clamped to its schema limits, unless another setting bounds it."""
    limits = LIMITS[key]
    return _finite_number(source.get(key), DEFAULTS[key], limits["min"] if minimum is None else minimum,
                          limits["max"] if maximum is None else maximum)


def _bounded_integer(source: dict[str, Any], key: str) -> int:
    return _integer(source.get(key), DEFAULTS[key], LIMITS[key]["min"], LIMITS[key]["max"])


def _boolean(value: Any, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        if value.strip().lower() == "true":
            return True
        if value.strip().lower() == "false":
            return False
    return fallback


def _maybe_json(value: Any) -> Any:
    """Settings written by the browser may hold JSON strings; invalid JSON reads as missing."""
    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return None


def _slug(value: Any) -> str:
    ascii_name = unicodedata.normalize("NFKD", str(value or "").strip().lower())
    ascii_name = "".join(character for character in ascii_name if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]+", "-", ascii_name).strip("-")[:64] or "category"


def _unique_category_id(name: str, used_ids: set[str]) -> str:
    base = _slug(name)
    candidate = base
    suffix = 1
    while candidate in used_ids:
        ending = f"-{suffix}"
        candidate = base[: 64 - len(ending)].rstrip("-") + ending
        suffix += 1
    used_ids.add(candidate)
    return candidate


def _parse_category_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        value = copy.deepcopy(DEFAULT_CATEGORY_DEFINITIONS)

    categories: list[dict[str, Any]] = []
    used_ids: set[str] = {"overall"}
    for index, raw in enumerate(value[:24]):
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()[:80]
        if not name:
            continue
        category_id = _unique_category_id(name, used_ids)
        categories.append(
            {
                "id": category_id,
                "name": name,
                "description": str(raw.get("description") or "").strip()[:500],
                "enabled": _boolean(raw.get("enabled"), True),
                "weight": _finite_number(raw.get("weight"), 1.0, 0.01, 1000.0),
                "order": index,
            }
        )
    if not categories:
        return _parse_category_list(copy.deepcopy(DEFAULT_CATEGORY_DEFINITIONS))
    return categories


def _parse_categories_by_cohort(value: Any, boxes: list[dict[str, Any]] | None = None) -> dict[str, list[dict[str, Any]]]:
    value = _maybe_json(value)
    source = value if isinstance(value, dict) else {}
    result = {
        cohort: _parse_category_list(source.get(cohort))
        # A list, not the set: the order must not depend on the process hash seed.
        for cohort in COHORT_ORDER
    }
    for cohort in list(source) + [box["id"] for box in (boxes or [])]:
        if cohort not in result and _valid_box_id(cohort):
            result[cohort] = _parse_category_list(source.get(cohort))
    return result


def _valid_box_id(value: Any) -> bool:
    return isinstance(value, str) and (value in VALID_COHORTS or re.fullmatch(r"BOX-[A-Z0-9-]{1,60}", value) is not None)


def _parse_gender_boxes(value: Any, enabled_cohorts: list[str]) -> list[dict[str, Any]]:
    value = _maybe_json(value)
    boxes: list[dict[str, Any]] = []
    used: set[str] = set()
    for raw in value[:24] if isinstance(value, list) else []:
        if not isinstance(raw, dict):
            continue
        box_id = str(raw.get("id") or "").strip().upper()
        if not _valid_box_id(box_id) or box_id in used:
            continue
        used.add(box_id)
        boxes.append({
            "id": box_id,
            "name": str(raw.get("name") or box_id.replace("_", " ").capitalize()).strip()[:80],
            "genders": _parse_enabled_cohorts(raw.get("genders"), [box_id] if box_id in VALID_COHORTS else ["FEMALE"]),
            "enabled": _boolean(raw.get("enabled"), True),
        })
    if not boxes:
        boxes = [{"id": cohort, "name": cohort.replace("_", " ").capitalize().replace("Non binary", "Non-binary"),
                  "genders": [cohort], "enabled": cohort in enabled_cohorts} for cohort in COHORT_ORDER]
    if not any(box["enabled"] for box in boxes):
        boxes[0]["enabled"] = True
    return boxes


def _parse_enabled_cohorts(value: Any, fallback: list[str]) -> list[str]:
    value = _maybe_json(value)
    requested = {str(item or "").strip().upper() for item in value} if isinstance(value, list) else set()
    result = [cohort for cohort in COHORT_ORDER if cohort in requested]
    return result or fallback.copy()


def normalize_settings(raw: dict[str, Any] | None) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}

    def flag(key: str) -> bool:
        return _boolean(source.get(key), DEFAULTS[key])

    cohort = str(source.get("defaultCohort") or DEFAULTS["defaultCohort"]).upper()
    boxes = _parse_gender_boxes(source.get("genderBoxes"), [cohort])
    enabled_cohorts = [box["id"] for box in boxes if box["enabled"]]
    if cohort not in enabled_cohorts:
        cohort = enabled_cohorts[0]
    confidence_goal = str(source.get("confidenceGoal") or DEFAULTS["confidenceGoal"]).lower()
    if confidence_goal not in {"all", "ranking", "top"}:
        confidence_goal = DEFAULTS["confidenceGoal"]
    overall_strategy = source.get("overallScoreStrategy")
    if overall_strategy not in ("weighted", "power", "rating", "proven"):
        overall_strategy = DEFAULTS["overallScoreStrategy"]
    initial_deviation = _bounded(source, "initialDeviation")
    # Floor and provisional threshold are bounded by the other deviations, not only their static limits.
    deviation_floor = _bounded(source, "deviationFloor", maximum=initial_deviation)
    raw_top_count = _finite_number(source.get("leaderboardTopCount"), float(DEFAULTS["leaderboardTopCount"]), -1000000.0, 1000000.0)
    top_count = int(raw_top_count) if raw_top_count in (3, 4, 5) else DEFAULTS["leaderboardTopCount"]
    raw_performer_count = source.get("leaderboardPerformerCount")
    if raw_performer_count is None or not str(raw_performer_count).strip():
        raw_performer_count = DEFAULTS["leaderboardPerformerCount"]
    performer_limit = LIMITS["leaderboardPerformerCount"]["max"]
    performer_count = math.floor(_finite_number(raw_performer_count, float(DEFAULTS["leaderboardPerformerCount"]),
                                                top_count * 2, float(performer_limit)))
    performer_count = min(performer_limit // top_count * top_count, (performer_count + top_count - 1) // top_count * top_count)
    return {
        "categoriesByCohort": _parse_categories_by_cohort(source.get("categories"), boxes),
        "genderBoxes": boxes,
        "defaultCohort": cohort,
        "enabledCohorts": enabled_cohorts,
        "showBattlesInMenu": flag("showBattlesInMenu"),
        "leaderboardTopCount": top_count,
        "leaderboardPerformerCount": performer_count,
        "leaderboardView": "table" if source.get("leaderboardView") == "table" else DEFAULTS["leaderboardView"],
        "overallScoreStrategy": overall_strategy,
        "overallPower": _bounded(source, "overallPower"),
        "showLeaderboardsInMenu": flag("showLeaderboardsInMenu"),
        "showRatingsBeforeVote": flag("showRatingsBeforeVote"),
        "hidePerformerImages": flag("hidePerformerImages"),
        "hideBattleStandings": flag("hideBattleStandings"),
        "includePerformersWithoutImages": flag("includePerformersWithoutImages"),
        "confidenceGoal": confidence_goal,
        "confidenceTopN": _bounded_integer(source, "confidenceTopN"),
        "initialRating": _bounded(source, "initialRating"),
        "initialDeviation": initial_deviation,
        "evidenceWeight": _bounded(source, "evidenceWeight"),
        "deviationFloor": deviation_floor,
        "provisionalDeviation": _bounded(source, "provisionalDeviation", deviation_floor, initial_deviation),
    }


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_time(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def pool_key(category_id: str, cohort: str) -> str:
    return f"{_slug(category_id)}|{cohort.upper()}"


class RatingRepository:
    SCHEMA_VERSION = 4

    def __init__(
        self,
        path: str | Path | None = None,
        connection: Any | None = None,
    ):
        self.path = path
        self._connection = connection
        self.ensure_schema()

    @contextmanager
    def connect(self):
        connection = self._connection or shared_storage.connect(self.path)
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            if self._connection is None:
                connection.close()

    @staticmethod
    def _schema_version(connection: Any) -> int:
        row = connection.execute(
            "SELECT version FROM dirty_schema_versions WHERE plugin_id=?", (PLUGIN_ID,),
        ).fetchone()
        return int(row[0]) if row else 0

    @staticmethod
    def _table_exists(connection: Any, name: str) -> bool:
        return connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)
        ).fetchone() is not None

    def ensure_schema(self) -> None:
        with self.connect() as connection:
            if self._schema_version(connection) == self.SCHEMA_VERSION:
                return

            # Recheck under the write lock in case another invocation already migrated.
            connection.execute("BEGIN IMMEDIATE")
            installed_version = self._schema_version(connection)
            if installed_version == self.SCHEMA_VERSION:
                return
            if installed_version > self.SCHEMA_VERSION:
                raise PluginError(
                    f"DirtyRank database schema {installed_version} is newer than this plugin supports"
                )
            previous = [table for table in PREVIOUS_TABLES if self._table_exists(connection, table)]
            if previous:
                # Verdicts replace battles. The backup keeps the battles and ratings;
                # every pool then starts unrated.
                shared_storage.backup_database(path=self.path)
                for table in previous:
                    connection.execute(f"DROP TABLE {table}")
                stored = shared_storage.get_plugin_settings(PLUGIN_ID, connection=connection)
                if any(key in stored for key in RETIRED_SETTINGS):
                    stored = {key: value for key, value in stored.items() if key not in RETIRED_SETTINGS}
                    shared_storage.set_plugin_settings_on_connection(PLUGIN_ID, stored, connection)

            connection.execute("""
                CREATE TABLE dirty_rank_pools (
                  performer_id TEXT NOT NULL,
                  category_id TEXT NOT NULL,
                  cohort TEXT NOT NULL,
                  rating REAL NOT NULL,
                  deviation REAL NOT NULL,
                  matches INTEGER NOT NULL,
                  wins INTEGER NOT NULL,
                  losses INTEGER NOT NULL,
                  draws INTEGER NOT NULL,
                  last_rated_at TEXT,
                  PRIMARY KEY (performer_id, category_id, cohort)
                )
            """)
            # One verdict per pair, from the first ID's side in text order: positive
            # favours low_id. Confirmations count how often the same verdict was chosen again.
            connection.execute("""
                CREATE TABLE dirty_rank_verdicts (
                  category_id TEXT NOT NULL,
                  cohort TEXT NOT NULL,
                  low_id TEXT NOT NULL,
                  high_id TEXT NOT NULL,
                  score INTEGER NOT NULL CHECK (score BETWEEN -3 AND 3),
                  confirmations INTEGER NOT NULL DEFAULT 0,
                  created_at TEXT NOT NULL,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (category_id, cohort, low_id, high_id)
                )
            """)
            # Every choice in order, with what it replaced, for duplicate protection and undo.
            connection.execute("""
                CREATE TABLE dirty_rank_verdict_log (
                  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                  verdict_id TEXT NOT NULL UNIQUE,
                  category_id TEXT NOT NULL,
                  cohort TEXT NOT NULL,
                  low_id TEXT NOT NULL,
                  high_id TEXT NOT NULL,
                  score INTEGER NOT NULL,
                  previous_score INTEGER,
                  previous_confirmations INTEGER,
                  previous_updated_at TEXT,
                  created_at TEXT NOT NULL,
                  undone_at TEXT
                )
            """)
            connection.execute("""CREATE INDEX dirty_rank_verdict_log_by_pair
                ON dirty_rank_verdict_log(category_id, cohort, low_id, high_id, sequence)""")
            # Where this pool's verdicts put "slightly", "better" and "much better", in log-odds.
            connection.execute("""
                CREATE TABLE dirty_rank_scales (
                  category_id TEXT NOT NULL,
                  cohort TEXT NOT NULL,
                  slightly REAL NOT NULL,
                  better REAL NOT NULL,
                  much REAL NOT NULL,
                  PRIMARY KEY (category_id, cohort)
                )
            """)
            connection.execute(
                """INSERT OR IGNORE INTO dirty_metadata(namespace, key, value)
                   VALUES (?, 'revision', '0')""",
                (PLUGIN_ID,),
            )
            if previous:
                self.increment_revision(connection)
            connection.execute(
                """INSERT INTO dirty_schema_versions(plugin_id, version, applied_at)
                   VALUES (?, ?, ?)
                   ON CONFLICT(plugin_id) DO UPDATE SET
                     version=excluded.version, applied_at=excluded.applied_at""",
                (PLUGIN_ID, self.SCHEMA_VERSION, iso_time(utc_now())),
            )
            connection.commit()
            if previous:
                try:
                    connection.execute("VACUUM")
                except sqlite3.OperationalError:
                    # Compaction can fail while the shared database is busy.
                    # The migration is committed and SQLite can reuse the freed pages.
                    pass

    @staticmethod
    def _row_pool(row: Any) -> dict[str, Any] | None:
        if row is None:
            return None
        return {
            "rating": float(row["rating"]),
            "deviation": float(row["deviation"]),
            "matches": int(row["matches"]),
            "wins": int(row["wins"]),
            "losses": int(row["losses"]),
            "draws": int(row["draws"]),
            "lastRatedAt": row["last_rated_at"],
        }

    def pool(self, connection: Any, performer_id: str, category_id: str, cohort: str) -> dict[str, Any] | None:
        row = connection.execute(
            """SELECT * FROM dirty_rank_pools
               WHERE performer_id=? AND category_id=? AND cohort=?""",
            (performer_id, category_id, cohort),
        ).fetchone()
        return self._row_pool(row)

    @staticmethod
    def pool_keys(connection: Any) -> list[tuple[str, str]]:
        rows = connection.execute("""
            SELECT category_id, cohort FROM dirty_rank_verdicts
            UNION SELECT category_id, cohort FROM dirty_rank_pools
            UNION SELECT category_id, cohort FROM dirty_rank_scales
        """).fetchall()
        return sorted((str(row[0]), str(row[1])) for row in rows)

    def refit_all(self, connection: Any, settings: dict[str, Any]) -> set[str]:
        changed: set[str] = set()
        for category_id, cohort in self.pool_keys(connection):
            changed |= self.refit(connection, category_id, cohort, settings)
        return changed

    def refit(self, connection: Any, category_id: str, cohort: str, settings: dict[str, Any]) -> set[str]:
        """Fit one pool to its verdicts. Returns the performers whose pool changed."""
        verdicts = [
            Verdict(str(row["low_id"]), str(row["high_id"]), int(row["score"]), row["updated_at"])
            for row in connection.execute(
                """SELECT low_id, high_id, score, updated_at FROM dirty_rank_verdicts
                   WHERE category_id=? AND cohort=? ORDER BY low_id, high_id""",
                (category_id, cohort),
            )
        ]
        stored = {
            str(row["performer_id"]): row
            for row in connection.execute(
                "SELECT * FROM dirty_rank_pools WHERE category_id=? AND cohort=?", (category_id, cohort)
            )
        }
        fit = fit_ratings(verdicts, settings, VERDICT_THRESHOLDS)
        if verdicts:
            connection.execute(
                """INSERT INTO dirty_rank_scales(category_id, cohort, slightly, better, much)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(category_id, cohort) DO UPDATE SET
                     slightly=excluded.slightly, better=excluded.better, much=excluded.much""",
                (category_id, cohort, *fit.thresholds),
            )
        else:
            connection.execute("DELETE FROM dirty_rank_scales WHERE category_id=? AND cohort=?", (category_id, cohort))
        changed: set[str] = set()
        for performer_id, rating in fit.ratings.items():
            row = stored.get(performer_id)
            if row is not None and _same_pool(row, rating):
                continue
            connection.execute(
                """INSERT INTO dirty_rank_pools(
                     performer_id, category_id, cohort, rating, deviation,
                     matches, wins, losses, draws, last_rated_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(performer_id, category_id, cohort) DO UPDATE SET
                     rating=excluded.rating, deviation=excluded.deviation,
                     matches=excluded.matches, wins=excluded.wins, losses=excluded.losses,
                     draws=excluded.draws, last_rated_at=excluded.last_rated_at""",
                (
                    performer_id, category_id, cohort, rating.rating, rating.deviation,
                    rating.matches, rating.wins, rating.losses, rating.draws, rating.last_rated_at,
                ),
            )
            changed.add(performer_id)
        for performer_id in set(stored) - set(fit.ratings):
            connection.execute(
                "DELETE FROM dirty_rank_pools WHERE performer_id=? AND category_id=? AND cohort=?",
                (performer_id, category_id, cohort),
            )
            changed.add(performer_id)
        return changed

    @staticmethod
    def thresholds(connection: Any, category_id: str, cohort: str) -> list[float]:
        row = connection.execute(
            "SELECT slightly, better, much FROM dirty_rank_scales WHERE category_id=? AND cohort=?",
            (category_id, cohort),
        ).fetchone()
        return [float(value) for value in row] if row else list(VERDICT_THRESHOLDS)

    @staticmethod
    def verdict(connection: Any, category_id: str, cohort: str, low_id: str, high_id: str) -> list[Any]:
        """[low ID, high ID, score from the low ID's side or None, confirmations]."""
        row = connection.execute(
            """SELECT score, confirmations FROM dirty_rank_verdicts
               WHERE category_id=? AND cohort=? AND low_id=? AND high_id=?""",
            (category_id, cohort, low_id, high_id),
        ).fetchone()
        return [low_id, high_id, int(row["score"]), int(row["confirmations"])] if row else [low_id, high_id, None, 0]

    def revision(self, connection: Any) -> int:
        row = connection.execute(
            "SELECT value FROM dirty_metadata WHERE namespace=? AND key='revision'",
            (PLUGIN_ID,),
        ).fetchone()
        return int(row[0]) if row else 0

    def increment_revision(self, connection: Any) -> int:
        revision = self.revision(connection) + 1
        connection.execute(
            """INSERT INTO dirty_metadata(namespace, key, value) VALUES (?, 'revision', ?)
               ON CONFLICT(namespace, key) DO UPDATE SET value=excluded.value""",
            (PLUGIN_ID, str(revision)),
        )
        return revision

    def state(self, connection: Any, performer_id: str, revision: int | None = None) -> dict[str, Any]:
        state = {"version": STATE_VERSION, "revision": self.revision(connection) if revision is None else revision, "pools": {}}
        rows = connection.execute(
            "SELECT * FROM dirty_rank_pools WHERE performer_id=?",
            (performer_id,),
        ).fetchall()
        for row in rows:
            state["pools"][pool_key(row["category_id"], row["cohort"])] = self._row_pool(row)
        return state

    def states(self, connection: Any, performer_ids: set[str], revision: int) -> list[dict[str, Any]]:
        """Full states of the performers a refit changed, for the browser's rating index."""
        return [{"id": performer_id, "state": self.state(connection, performer_id, revision)}
                for performer_id in sorted(performer_ids)]

    def pair_result(self, connection: Any, left_id: str, right_id: str, key: str, revision: int) -> dict[str, Any]:
        """Both performers' full states and their pool at one revision."""
        result = {}
        for side, performer_id in (("left", left_id), ("right", right_id)):
            state = self.state(connection, performer_id, revision)
            result[side] = {"id": performer_id, "pool": state["pools"].get(key), "state": state}
        return result

    def all_states(self) -> dict[str, Any]:
        with self.connect() as connection:
            connection.execute("BEGIN")
            revision = self.revision(connection)
            states: dict[str, Any] = {}
            for row in connection.execute("SELECT * FROM dirty_rank_pools ORDER BY performer_id"):
                performer_id = str(row["performer_id"])
                state = states.setdefault(performer_id, {"version": STATE_VERSION, "revision": revision, "pools": {}})
                state["pools"][pool_key(row["category_id"], row["cohort"])] = self._row_pool(row)
            return {"version": STATE_VERSION, "revision": revision, "states": states}


def _same_pool(row: Any, rating: Rating) -> bool:
    return (
        abs(float(row["rating"]) - rating.rating) < WRITE_TOLERANCE
        and abs(float(row["deviation"]) - rating.deviation) < WRITE_TOLERANCE
        and (int(row["matches"]), int(row["wins"]), int(row["losses"]), int(row["draws"]))
        == (rating.matches, rating.wins, rating.losses, rating.draws)
        and row["last_rated_at"] == rating.last_rated_at
    )


def _category_settings_with_label_ids(raw_settings: dict[str, Any]) -> tuple[dict[str, Any], dict[str, dict[str, str]]]:
    """Canonicalize category IDs while retaining each category's previous ID to move its ratings."""
    result = dict(raw_settings)
    raw_categories = _maybe_json(raw_settings.get("categories"))
    if not isinstance(raw_categories, dict):
        return result, {}
    categories = copy.deepcopy(raw_categories)
    remaps: dict[str, dict[str, str]] = {}
    for cohort in categories:
        if not _valid_box_id(cohort):
            continue
        items = categories.get(cohort)
        if not isinstance(items, list):
            continue
        used_ids: set[str] = {"overall"}
        remaps[cohort] = {}
        for item in items[:24]:
            if not isinstance(item, dict):
                continue
            name = str(item.get("name") or "").strip()[:80]
            if not name:
                continue
            new_id = _unique_category_id(name, used_ids)
            old_id = str(item.get("id") or "").strip()
            item["id"] = new_id
            if old_id and old_id != new_id:
                if old_id in remaps[cohort]:
                    raise PluginError(f"Duplicate existing category ID for {cohort}: {old_id}")
                remaps[cohort][old_id] = new_id
    result["categories"] = json.dumps(categories, ensure_ascii=False, separators=(",", ":"))
    return result, remaps


RATING_TABLES = ("dirty_rank_pools", "dirty_rank_verdicts", "dirty_rank_verdict_log", "dirty_rank_scales")


def _move_category_rating_ids(connection: Any, remaps: dict[str, dict[str, str]]) -> bool:
    changed = False
    for cohort, mapping in remaps.items():
        if not mapping:
            continue
        old_ids = set(mapping)
        for new_id in mapping.values():
            if new_id in old_ids:
                continue
            for table in RATING_TABLES:
                if connection.execute(
                    f"SELECT 1 FROM {table} WHERE cohort=? AND category_id=? LIMIT 1",
                    (cohort, new_id),
                ).fetchone():
                    raise PluginError(
                        f"Cannot rename a {cohort} category to {new_id}: ratings already use that ID"
                    )
        temporary = {old_id: "__dirty_rank_migration_" + uuid.uuid4().hex for old_id in mapping}
        for old_id, temp_id in temporary.items():
            for table in RATING_TABLES:
                connection.execute(
                    f"UPDATE {table} SET category_id=? WHERE cohort=? AND category_id=?",
                    (temp_id, cohort, old_id),
                )
        for old_id, new_id in mapping.items():
            for table in RATING_TABLES:
                connection.execute(
                    f"UPDATE {table} SET category_id=? WHERE cohort=? AND category_id=?",
                    (new_id, cohort, temporary[old_id]),
                )
        changed = True
    return changed


def save_settings(repository: RatingRepository, connection: Any, args: dict[str, Any]) -> dict[str, Any]:
    values = args.get("settings")
    if not isinstance(values, dict):
        raise PluginError("DirtyRank settings must be an object")
    expected_revision = args.get("expectedRevision")
    if isinstance(expected_revision, bool) or not isinstance(expected_revision, int):
        raise PluginError("DirtyRank settings require a revision from the latest read")
    canonical, remaps = _category_settings_with_label_ids(values)
    connection.execute("BEGIN IMMEDIATE")
    try:
        current_revision = shared_storage.get_plugin_revision(PLUGIN_ID, connection=connection)
        if expected_revision != current_revision:
            raise shared_storage.SettingsRevisionConflict(PLUGIN_ID, expected_revision, current_revision)
        current = shared_storage.get_plugin_settings(PLUGIN_ID, connection=connection)
        current_categories = _maybe_json(current.get("categories"))
        if isinstance(current_categories, dict):
            for cohort, mapping in remaps.items():
                existing_ids = {str(item.get("id")) for item in current_categories.get(cohort, []) if isinstance(item, dict)}
                remaps[cohort] = {old: new for old, new in mapping.items() if old in existing_ids}
        else:
            remaps = {}
        ratings_changed = _move_category_rating_ids(connection, remaps)
        response = shared_storage.set_plugin_settings_on_connection(
            PLUGIN_ID, canonical, connection, expected_revision
        )
        previous, updated = normalize_settings(current), normalize_settings(canonical)
        if any(previous[key] != updated[key] for key in FIT_SETTINGS):
            # New starting values and evidence apply to every verdict, not only future ones.
            repository.refit_all(connection, updated)
            ratings_changed = True
        if ratings_changed:
            repository.increment_revision(connection)
        connection.commit()
        return response
    except Exception:
        connection.rollback()
        raise


def _category(
    settings: dict[str, Any], category_id: str, cohort: str, *, require_enabled: bool = True
) -> dict[str, Any]:
    normalized = _slug(category_id)
    for category in settings["categoriesByCohort"].get(cohort, []):
        if category["id"] == normalized and (category["enabled"] or not require_enabled):
            return category
    raise PluginError(
        f"Unknown or disabled DirtyRank category for {cohort}: {category_id}"
    )


def _cohort(value: Any, settings: dict[str, Any] | None = None) -> str:
    cohort = str(value or "").strip().upper()
    if not _valid_box_id(cohort) or (settings is not None and not any(box["id"] == cohort for box in settings["genderBoxes"])):
        raise PluginError(f"Unsupported performer cohort: {value}")
    return cohort


def _enabled_cohort(settings: dict[str, Any], value: Any) -> str:
    cohort = _cohort(value, settings)
    if cohort not in settings["enabledCohorts"]:
        raise PluginError(f"DirtyRank battles are disabled for {cohort}")
    return cohort


def _verdict_pair(args: dict[str, Any]) -> tuple[str, str, str, str]:
    """The request's left and right IDs, and the pair in stored order."""
    left_id = str(args.get("leftId") or "").strip()
    right_id = str(args.get("rightId") or "").strip()
    if not left_id or not right_id or left_id == right_id:
        raise PluginError("A verdict requires two different performers")
    low_id, high_id = sorted((left_id, right_id))
    return left_id, right_id, low_id, high_id


def _verdict_id(args: dict[str, Any]) -> str:
    verdict_id = str(args.get("verdictId") or "").strip()
    if not verdict_id or len(verdict_id) > 160:
        raise PluginError("A verdict requires a valid idempotency ID")
    return verdict_id


def record_verdict(
    repository: RatingRepository,
    args: dict[str, Any],
    settings: dict[str, Any],
    now: datetime | None = None,
) -> dict[str, Any]:
    """Save the verdict on a pair, replacing any earlier one; choosing it again confirms it."""
    left_id, right_id, low_id, high_id = _verdict_pair(args)
    verdict_id = _verdict_id(args)
    cohort = _enabled_cohort(settings, args.get("cohort"))
    category_id = _category(settings, str(args.get("categoryId") or ""), cohort)["id"]
    score = args.get("score")
    if isinstance(score, bool) or not isinstance(score, int) or abs(score) > VERDICT_LIMIT:
        raise PluginError(f"A verdict score must be a whole number from -{VERDICT_LIMIT} to {VERDICT_LIMIT}")
    low_score = score if left_id == low_id else -score

    timestamp = iso_time(now or utc_now())
    key = pool_key(category_id, cohort)
    with repository.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        if connection.execute(
            "SELECT 1 FROM dirty_rank_verdict_log WHERE verdict_id=?", (verdict_id,)
        ).fetchone() is not None:
            return {
                "duplicate": True, "verdictId": verdict_id, "changed": [],
                "verdict": repository.verdict(connection, category_id, cohort, low_id, high_id),
                "thresholds": repository.thresholds(connection, category_id, cohort),
                **repository.pair_result(connection, left_id, right_id, key, repository.revision(connection)),
            }
        existing = connection.execute(
            """SELECT score, confirmations, updated_at FROM dirty_rank_verdicts
               WHERE category_id=? AND cohort=? AND low_id=? AND high_id=?""",
            (category_id, cohort, low_id, high_id),
        ).fetchone()
        if existing is None:
            connection.execute(
                """INSERT INTO dirty_rank_verdicts(
                     category_id, cohort, low_id, high_id, score, confirmations, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)""",
                (category_id, cohort, low_id, high_id, low_score, timestamp, timestamp),
            )
        else:
            # A confirmation keeps the time the score was given, as it keeps every rating.
            same = int(existing["score"]) == low_score
            connection.execute(
                """UPDATE dirty_rank_verdicts SET score=?, confirmations=?, updated_at=?
                   WHERE category_id=? AND cohort=? AND low_id=? AND high_id=?""",
                (
                    low_score, int(existing["confirmations"]) + 1 if same else 0,
                    existing["updated_at"] if same else timestamp,
                    category_id, cohort, low_id, high_id,
                ),
            )
        connection.execute(
            """INSERT INTO dirty_rank_verdict_log(
                 verdict_id, category_id, cohort, low_id, high_id, score,
                 previous_score, previous_confirmations, previous_updated_at, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                verdict_id, category_id, cohort, low_id, high_id, low_score,
                None if existing is None else int(existing["score"]),
                None if existing is None else int(existing["confirmations"]),
                None if existing is None else existing["updated_at"],
                timestamp,
            ),
        )
        # A confirmation leaves the score, and so every rating, as it was.
        ratings_move = existing is None or int(existing["score"]) != low_score
        result = _refit_result(repository, connection, settings, category_id, cohort, left_id, right_id, ratings_move)
        result["verdict"] = repository.verdict(connection, category_id, cohort, low_id, high_id)
        connection.commit()
    return {"duplicate": False, "verdictId": verdict_id, "categoryId": category_id, "cohort": cohort, **result}


def _refit_result(
    repository: RatingRepository, connection: Any, settings: dict[str, Any],
    category_id: str, cohort: str, left_id: str, right_id: str, ratings_move: bool = True,
) -> dict[str, Any]:
    """Refit the verdict's pool and describe every performer whose rating moved."""
    if ratings_move:
        changed = repository.refit(connection, category_id, cohort, settings) | {left_id, right_id}
        revision = repository.increment_revision(connection)
    else:
        changed, revision = set(), repository.revision(connection)
    result = repository.pair_result(connection, left_id, right_id, pool_key(category_id, cohort), revision)
    result["changed"] = repository.states(connection, changed, revision)
    result["thresholds"] = repository.thresholds(connection, category_id, cohort)
    return result


def undo_verdict(
    repository: RatingRepository,
    args: dict[str, Any],
    settings: dict[str, Any],
) -> dict[str, Any]:
    """Restore what the pair had before one choice: the earlier verdict, or none."""
    left_id, right_id, low_id, high_id = _verdict_pair(args)
    verdict_id = _verdict_id(args)
    cohort = _cohort(args.get("cohort"), settings)
    category_id = _category(settings, str(args.get("categoryId") or ""), cohort)["id"]
    with repository.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        entry = connection.execute(
            "SELECT * FROM dirty_rank_verdict_log WHERE verdict_id=? AND undone_at IS NULL", (verdict_id,)
        ).fetchone()
        if entry is None:
            raise PluginError(f"Verdict {verdict_id} is not available to undo")
        if (str(entry["low_id"]), str(entry["high_id"])) != (low_id, high_id):
            raise PluginError("The stored undo performers do not match this verdict")
        if entry["category_id"] != category_id or entry["cohort"] != cohort:
            raise PluginError("The stored undo pool does not match this verdict")
        latest = connection.execute(
            """SELECT verdict_id FROM dirty_rank_verdict_log
               WHERE category_id=? AND cohort=? AND low_id=? AND high_id=? AND undone_at IS NULL
               ORDER BY sequence DESC LIMIT 1""",
            (category_id, cohort, low_id, high_id),
        ).fetchone()
        if latest["verdict_id"] != verdict_id:
            raise PluginError("A later verdict on this pair must be undone first")
        previous_score = entry["previous_score"]
        if previous_score is None:
            connection.execute(
                """DELETE FROM dirty_rank_verdicts
                   WHERE category_id=? AND cohort=? AND low_id=? AND high_id=?""",
                (category_id, cohort, low_id, high_id),
            )
        else:
            connection.execute(
                """UPDATE dirty_rank_verdicts SET score=?, confirmations=?, updated_at=?
                   WHERE category_id=? AND cohort=? AND low_id=? AND high_id=?""",
                (
                    int(previous_score), int(entry["previous_confirmations"]), entry["previous_updated_at"],
                    category_id, cohort, low_id, high_id,
                ),
            )
        connection.execute(
            "UPDATE dirty_rank_verdict_log SET undone_at=? WHERE sequence=?",
            (iso_time(utc_now()), entry["sequence"]),
        )
        ratings_move = previous_score is None or int(previous_score) != int(entry["score"])
        result = _refit_result(repository, connection, settings, category_id, cohort, left_id, right_id, ratings_move)
        result["verdict"] = repository.verdict(connection, category_id, cohort, low_id, high_id)
        connection.commit()
    return {"undone": True, "verdictId": verdict_id, **result}


def load_verdicts(repository: RatingRepository, args: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
    """Every verdict of one pool, as [low ID, high ID, score from the low ID's side, confirmations]."""
    cohort = _cohort(args.get("cohort"), settings)
    category_id = _category(settings, str(args.get("categoryId") or ""), cohort, require_enabled=False)["id"]
    with repository.connect() as connection:
        connection.execute("BEGIN")
        rows = connection.execute(
            """SELECT low_id, high_id, score, confirmations FROM dirty_rank_verdicts
               WHERE category_id=? AND cohort=? ORDER BY low_id, high_id""",
            (category_id, cohort),
        ).fetchall()
        return {
            "categoryId": category_id,
            "cohort": cohort,
            "revision": repository.revision(connection),
            "thresholds": repository.thresholds(connection, category_id, cohort),
            "verdicts": [[str(row[0]), str(row[1]), int(row[2]), int(row[3])] for row in rows],
        }


def reset_pool(
    repository: RatingRepository,
    args: dict[str, Any],
    settings: dict[str, Any],
    reporter: Reporter,
) -> dict[str, Any]:
    if str(args.get("confirm") or "") != "RESET":
        raise PluginError("Reset requires explicit RESET confirmation")
    cohort = _cohort(args.get("cohort"), settings)
    category_id = _category(
        settings, str(args.get("categoryId") or ""), cohort, require_enabled=False
    )["id"]
    with repository.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        reset = connection.execute(
            "SELECT COUNT(*) FROM dirty_rank_pools WHERE category_id=? AND cohort=?",
            (category_id, cohort),
        ).fetchone()[0]
        for table in RATING_TABLES:
            connection.execute(f"DELETE FROM {table} WHERE category_id=? AND cohort=?", (category_id, cohort))
        repository.increment_revision(connection)
        connection.commit()
    reporter.progress(1.0)
    return {"reset": int(reset)}


def run(payload: dict[str, Any], reporter: Reporter | None = None) -> dict[str, Any]:
    reporter = reporter or Reporter()
    args = payload.get("args") or {}
    if not isinstance(args, dict):
        raise PluginError("Plugin arguments must be an object")
    connection = shared_storage.connect()
    try:
        repository = RatingRepository(connection=connection)
        mode = str(args.get("mode") or "record")
        if mode == "getSettings":
            with repository.connect() as snapshot:
                snapshot.execute("BEGIN")
                return {
                    "revision": shared_storage.get_plugin_revision(PLUGIN_ID, connection=snapshot),
                    "settings": shared_storage.get_plugin_settings(PLUGIN_ID, connection=snapshot),
                }
        if mode == "saveSettings":
            return save_settings(repository, connection, args)
        if mode == "loadAll":
            return repository.all_states()
        settings = normalize_settings(
            shared_storage.get_plugin_settings(PLUGIN_ID, connection=connection)
        )
        if mode == "record":
            return record_verdict(repository, args, settings)
        if mode == "undo":
            return undo_verdict(repository, args, settings)
        if mode == "loadVerdicts":
            return load_verdicts(repository, args, settings)
        if mode == "resetPool":
            return reset_pool(repository, args, settings, reporter)
        raise PluginError(f"Unsupported DirtyRank operation mode: {mode}")
    finally:
        connection.close()


def main() -> int:
    return protocol.serve("DirtyRank", run, default_mode="record")


if __name__ == "__main__":
    raise SystemExit(main())
