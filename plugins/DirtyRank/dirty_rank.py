"""DirtyRank backend: category-scoped Glicko-2 ratings for Stash performers."""

from __future__ import annotations

import copy
import json
import math
import re
import sys
import time
import unicodedata
import uuid
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


PLUGIN_ID = "dirtyRank"
STATE_VERSION = 2
GLICKO_SCALE = 173.7178
GLICKO_ORIGIN = 1500.0
MAX_RECENT_BATTLE_IDS = 24
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
DEFAULT_CATEGORY_DEFINITIONS = [
    {
        "id": "appearance",
        "name": "Appearance",
        "description": "Visual appeal and on-camera presence.",
        "enabled": True,
        "weight": 1.0,
    },
    {
        "id": "performance",
        "name": "Performance",
        "description": "Technique, energy, chemistry, and engagement.",
        "enabled": True,
        "weight": 1.0,
    },
]
DEFAULT_CATEGORIES_BY_COHORT = {
    cohort: copy.deepcopy(DEFAULT_CATEGORY_DEFINITIONS) for cohort in VALID_COHORTS
}
DEFAULT_SETTINGS = {
    "categoriesByCohort": DEFAULT_CATEGORIES_BY_COHORT,
    "defaultCohort": "FEMALE",
    "enabledCohorts": ["FEMALE"],
    "showBattlesInMenu": True,
    "showLeaderboardsInMenu": True,
    "leaderboardTopCount": 3,
    "leaderboardPerformerCount": 18,
    "leaderboardView": "gallery",
    "overallScoreStrategy": "weighted",
    "overallPower": 3.0,
    "showRatingsBeforeVote": False,
    "hidePerformerImages": False,
    "hideBattleStandings": False,
    "includePerformersWithoutImages": False,
    "confidenceGoal": "ranking",
    "confidenceTopN": 20,
    "avoidRepeatWindow": 12,
    "calibrationPercent": 10,
    "initialRating": 1000.0,
    "initialDeviation": 350.0,
    "initialVolatility": 0.06,
    "evidenceWeight": 2.0,
    "tau": 0.5,
    "deviationFloor": 30.0,
    "provisionalDeviation": 100.0,
}


def _load_shared_storage():
    """Load storage from the required DirtyPlugins sibling in source and installs."""
    plugin_root = Path(__file__).resolve().parent.parent
    for path in (
        plugin_root / "dirtyPlugins" / "dirty_plugins_storage.py",
        plugin_root / "DirtyPlugins" / "dirty_plugins_storage.py",
    ):
        if path.is_file():
            sys.path.insert(0, str(path.parent))
            return __import__("dirty_plugins_storage")
    raise RuntimeError("DirtyPlugins shared storage is not installed")


shared_storage = _load_shared_storage()


class PluginError(RuntimeError):
    """An error that should be displayed cleanly in Stash."""


@dataclass(frozen=True)
class Rating:
    rating: float
    deviation: float
    volatility: float
    matches: int = 0
    wins: int = 0
    losses: int = 0
    draws: int = 0
    last_rated_at: str | None = None


class Reporter:
    def info(self, _message: str) -> None:
        pass

    def error(self, _message: str) -> None:
        pass

    def progress(self, _value: float) -> None:
        pass


class StashReporter(Reporter):
    @staticmethod
    def _write(level: str, message: Any) -> None:
        for line in str(message).splitlines() or [""]:
            print(f"\x01{level}\x02{line}", file=sys.stderr, flush=True)

    def info(self, message: str) -> None:
        self._write("i", message)

    def error(self, message: str) -> None:
        self._write("e", message)

    def progress(self, value: float) -> None:
        self._write("p", str(min(max(float(value), 0.0), 1.0)))


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


def _boolean(value: Any, fallback: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        if value.strip().lower() == "true":
            return True
        if value.strip().lower() == "false":
            return False
    return fallback


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


def _parse_category_list(value: Any, cohort: str = "FEMALE") -> list[dict[str, Any]]:
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
        return _parse_category_list(copy.deepcopy(DEFAULT_CATEGORY_DEFINITIONS), cohort)
    return categories


def _parse_categories_by_cohort(value: Any, boxes: list[dict[str, Any]] | None = None) -> dict[str, list[dict[str, Any]]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            value = None

    source = value if isinstance(value, dict) else {}
    result = {
        cohort: _parse_category_list(source.get(cohort), cohort)
        for cohort in VALID_COHORTS
    }
    for cohort in list(source) + [box["id"] for box in (boxes or [])]:
        if cohort not in result and _valid_box_id(cohort):
            result[cohort] = _parse_category_list(source.get(cohort), cohort)
    return result


def _valid_box_id(value: Any) -> bool:
    return isinstance(value, str) and (value in VALID_COHORTS or re.fullmatch(r"BOX-[A-Z0-9-]{1,60}", value) is not None)


def _parse_gender_boxes(value: Any, enabled_cohorts: list[str]) -> list[dict[str, Any]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            value = None
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
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            value = value.split(",")
    requested = (
        {str(item or "").strip().upper() for item in value}
        if isinstance(value, list)
        else set()
    )
    result = [cohort for cohort in COHORT_ORDER if cohort in requested]
    return result or fallback.copy()


def normalize_settings(raw: dict[str, Any] | None) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    cohort = str(source.get("defaultCohort") or DEFAULT_SETTINGS["defaultCohort"]).upper()
    boxes = _parse_gender_boxes(source.get("genderBoxes"), _parse_enabled_cohorts(source.get("enabledCohorts"), [cohort]))
    enabled_cohorts = [box["id"] for box in boxes if box["enabled"]]
    if cohort not in enabled_cohorts:
        cohort = enabled_cohorts[0]
    confidence_goal = str(source.get("confidenceGoal") or "ranking").lower()
    if confidence_goal not in {"all", "ranking", "top"}:
        confidence_goal = "ranking"
    overall_strategy = source.get("overallScoreStrategy")
    if overall_strategy not in ("weighted", "power"):
        overall_strategy = "weighted"
    initial_deviation = _finite_number(
        source.get("initialDeviation"), 350.0, 30.0, 1000.0
    )
    deviation_floor = _finite_number(
        source.get("deviationFloor"), 30.0, 1.0, initial_deviation
    )
    raw_top_count = _finite_number(source.get("leaderboardTopCount"), 3.0, -1000000.0, 1000000.0)
    top_count = int(raw_top_count) if raw_top_count in (3, 4, 5) else 3
    raw_performer_count = source.get("leaderboardPerformerCount")
    if raw_performer_count is None or not str(raw_performer_count).strip():
        raw_performer_count = 18
    performer_count = math.floor(_finite_number(raw_performer_count, 18.0, top_count * 2, 1000.0))
    performer_count = min(1000 // top_count * top_count, (performer_count + top_count - 1) // top_count * top_count)
    return {
        "categoriesByCohort": _parse_categories_by_cohort(source.get("categories"), boxes),
        "genderBoxes": boxes,
        "defaultCohort": cohort,
        "enabledCohorts": enabled_cohorts,
        "showBattlesInMenu": _boolean(source.get("showBattlesInMenu"), True),
        "leaderboardTopCount": top_count,
        "leaderboardPerformerCount": performer_count,
        "leaderboardView": "table" if source.get("leaderboardView") == "table" else "gallery",
        "overallScoreStrategy": overall_strategy,
        "overallPower": _finite_number(source.get("overallPower"), 3.0, 1.0, 4.0),
        "showLeaderboardsInMenu": _boolean(
            source.get("showLeaderboardsInMenu"), True
        ),
        "showRatingsBeforeVote": _boolean(source.get("showRatingsBeforeVote"), False),
        "hidePerformerImages": _boolean(source.get("hidePerformerImages"), False),
        "hideBattleStandings": _boolean(source.get("hideBattleStandings"), False),
        "includePerformersWithoutImages": _boolean(
            source.get("includePerformersWithoutImages"), False
        ),
        "confidenceGoal": confidence_goal,
        "confidenceTopN": _integer(source.get("confidenceTopN"), 20, 1, 1000),
        "avoidRepeatWindow": _integer(source.get("avoidRepeatWindow"), 12, 0, 100),
        "calibrationPercent": _integer(source.get("calibrationPercent"), 10, 0, 100),
        "initialRating": _finite_number(
            source.get("initialRating"), 1000.0, -100000.0, 100000.0
        ),
        "initialDeviation": initial_deviation,
        "initialVolatility": _finite_number(
            source.get("initialVolatility"), 0.06, 0.0001, 1.0
        ),
        "evidenceWeight": _finite_number(
            source.get("evidenceWeight"), 2.0, 1.0, 3.0
        ),
        "tau": _finite_number(source.get("tau"), 0.5, 0.01, 2.0),
        "deviationFloor": deviation_floor,
        "provisionalDeviation": _finite_number(
            source.get("provisionalDeviation"), 100.0, deviation_floor, initial_deviation
        ),
    }


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_time(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def default_rating(settings: dict[str, Any]) -> Rating:
    return Rating(
        rating=float(settings["initialRating"]),
        deviation=float(settings["initialDeviation"]),
        volatility=float(settings["initialVolatility"]),
    )


def rating_from_pool(pool: Any, settings: dict[str, Any]) -> Rating:
    if not isinstance(pool, dict):
        return default_rating(settings)
    return Rating(
        rating=_finite_number(
            pool.get("rating"), settings["initialRating"], -1000000.0, 1000000.0
        ),
        deviation=_finite_number(
            pool.get("deviation"),
            settings["initialDeviation"],
            settings["deviationFloor"],
            settings["initialDeviation"],
        ),
        volatility=_finite_number(
            pool.get("volatility"), settings["initialVolatility"], 0.0001, 2.0
        ),
        matches=_integer(pool.get("matches"), 0, 0, 2_000_000_000),
        wins=_integer(pool.get("wins"), 0, 0, 2_000_000_000),
        losses=_integer(pool.get("losses"), 0, 0, 2_000_000_000),
        draws=_integer(pool.get("draws"), 0, 0, 2_000_000_000),
        last_rated_at=str(pool.get("lastRatedAt")) if pool.get("lastRatedAt") else None,
    )


def rating_to_pool(rating: Rating) -> dict[str, Any]:
    value = asdict(rating)
    value["lastRatedAt"] = value.pop("last_rated_at")
    return value


def _g(phi: float) -> float:
    return 1.0 / math.sqrt(1.0 + 3.0 * phi * phi / (math.pi * math.pi))


def _expected(mu: float, opponent_mu: float, opponent_phi: float) -> float:
    exponent = -_g(opponent_phi) * (mu - opponent_mu)
    exponent = min(max(exponent, -700.0), 700.0)
    return 1.0 / (1.0 + math.exp(exponent))


def glicko2_update(
    rating: Rating,
    results: Iterable[tuple[Rating, float]],
    settings: dict[str, Any],
) -> Rating:
    """Apply one evidence-weighted Glicko-2 rating period."""

    result_list = list(results)
    if not result_list:
        return rating

    mu = (rating.rating - GLICKO_ORIGIN) / GLICKO_SCALE
    phi = rating.deviation / GLICKO_SCALE
    converted = []
    for opponent, score in result_list:
        opponent_mu = (opponent.rating - GLICKO_ORIGIN) / GLICKO_SCALE
        opponent_phi = opponent.deviation / GLICKO_SCALE
        expected = _expected(mu, opponent_mu, opponent_phi)
        converted.append((opponent_mu, opponent_phi, float(score), expected))

    evidence_weight = settings["evidenceWeight"]
    variance_inverse = evidence_weight * sum(
        _g(opponent_phi) ** 2 * expected * (1.0 - expected)
        for _opponent_mu, opponent_phi, _score, expected in converted
    )
    if variance_inverse <= 0 or not math.isfinite(variance_inverse):
        raise PluginError("Glicko-2 could not calculate a finite variance")
    variance = 1.0 / variance_inverse
    delta = variance * evidence_weight * sum(
        _g(opponent_phi) * (score - expected)
        for _opponent_mu, opponent_phi, score, expected in converted
    )

    sigma = rating.volatility
    tau = settings["tau"]
    alpha = math.log(sigma * sigma)

    def objective(value: float) -> float:
        exp_value = math.exp(value)
        numerator = exp_value * (delta * delta - phi * phi - variance - exp_value)
        denominator = 2.0 * (phi * phi + variance + exp_value) ** 2
        return numerator / denominator - (value - alpha) / (tau * tau)

    a_value = alpha
    if delta * delta > phi * phi + variance:
        b_value = math.log(delta * delta - phi * phi - variance)
    else:
        k_value = 1
        b_value = alpha - k_value * tau
        while objective(b_value) < 0:
            k_value += 1
            if k_value > 1000:
                raise PluginError("Glicko-2 volatility iteration did not converge")
            b_value = alpha - k_value * tau

    f_a = objective(a_value)
    f_b = objective(b_value)
    while abs(b_value - a_value) > 1e-6:
        denominator = f_b - f_a
        if denominator == 0:
            break
        c_value = a_value + (a_value - b_value) * f_a / denominator
        f_c = objective(c_value)
        if f_c * f_b <= 0:
            a_value = b_value
            f_a = f_b
        else:
            f_a /= 2.0
        b_value = c_value
        f_b = f_c

    new_volatility = math.exp(a_value / 2.0)
    pre_deviation = math.sqrt(phi * phi + new_volatility * new_volatility)
    new_phi = 1.0 / math.sqrt(1.0 / (pre_deviation * pre_deviation) + 1.0 / variance)
    new_mu = mu + new_phi * new_phi * evidence_weight * sum(
        _g(opponent_phi) * (score - expected)
        for _opponent_mu, opponent_phi, score, expected in converted
    )
    new_deviation = min(
        settings["initialDeviation"],
        max(settings["deviationFloor"], new_phi * GLICKO_SCALE),
    )
    return Rating(
        rating=GLICKO_ORIGIN + GLICKO_SCALE * new_mu,
        deviation=new_deviation,
        volatility=new_volatility,
        matches=rating.matches,
        wins=rating.wins,
        losses=rating.losses,
        draws=rating.draws,
        last_rated_at=rating.last_rated_at,
    )


def rate_battle(
    left: Rating,
    right: Rating,
    score_left: float,
    settings: dict[str, Any],
    now: datetime | None = None,
) -> tuple[Rating, Rating]:
    now = now or utc_now()
    updated_left = glicko2_update(left, [(right, score_left)], settings)
    updated_right = glicko2_update(right, [(left, 1.0 - score_left)], settings)
    timestamp = iso_time(now)

    def with_result(value: Rating, score: float) -> Rating:
        return Rating(
            rating=value.rating,
            deviation=value.deviation,
            volatility=value.volatility,
            matches=value.matches + 1,
            wins=value.wins + (1 if score == 1.0 else 0),
            losses=value.losses + (1 if score == 0.0 else 0),
            draws=value.draws + (1 if score == 0.5 else 0),
            last_rated_at=timestamp,
        )

    return with_result(updated_left, score_left), with_result(updated_right, 1.0 - score_left)


def pool_key(category_id: str, cohort: str) -> str:
    return f"{_slug(category_id)}|{cohort.upper()}"


def serialize_state(state: dict[str, Any]) -> str:
    return json.dumps(state, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _recent_ids(pool: Any) -> list[str]:
    if not isinstance(pool, dict) or not isinstance(pool.get("recentBattleIds"), list):
        return []
    return [str(value) for value in pool["recentBattleIds"]][-MAX_RECENT_BATTLE_IDS:]


class RatingRepository:
    SCHEMA_VERSION = 1

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

    def ensure_schema(self) -> None:
        with self.connect() as connection:
            installed = connection.execute(
                "SELECT version FROM dirty_schema_versions WHERE plugin_id=?",
                (PLUGIN_ID,),
            ).fetchone()
            installed_version = int(installed[0]) if installed else 0
            if installed_version > self.SCHEMA_VERSION:
                raise PluginError(
                    f"DirtyRank database schema {installed_version} is newer than this plugin supports"
                )
            if installed_version and installed_version < self.SCHEMA_VERSION:
                shared_storage.backup_database(path=self.path)
            if installed_version != self.SCHEMA_VERSION:
                connection.executescript(
                    """
                CREATE TABLE IF NOT EXISTS dirty_rank_pools (
                  performer_id TEXT NOT NULL,
                  category_id TEXT NOT NULL,
                  cohort TEXT NOT NULL,
                  rating REAL NOT NULL,
                  deviation REAL NOT NULL,
                  volatility REAL NOT NULL,
                  matches INTEGER NOT NULL,
                  wins INTEGER NOT NULL,
                  losses INTEGER NOT NULL,
                  draws INTEGER NOT NULL,
                  last_rated_at TEXT,
                  recent_battle_ids TEXT NOT NULL DEFAULT '[]',
                  PRIMARY KEY (performer_id, category_id, cohort)
                );
                CREATE TABLE IF NOT EXISTS dirty_rank_battles (
                  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                  battle_id TEXT NOT NULL UNIQUE,
                  category_id TEXT NOT NULL,
                  cohort TEXT NOT NULL,
                  left_id TEXT NOT NULL,
                  right_id TEXT NOT NULL,
                  outcome TEXT NOT NULL,
                  left_before TEXT,
                  right_before TEXT,
                  left_after TEXT NOT NULL,
                  right_after TEXT NOT NULL,
                  status TEXT NOT NULL DEFAULT 'active',
                  created_at TEXT NOT NULL,
                  undone_at TEXT
                );
                CREATE INDEX IF NOT EXISTS dirty_rank_battles_left_latest
                  ON dirty_rank_battles(left_id, category_id, cohort, status, sequence DESC);
                CREATE INDEX IF NOT EXISTS dirty_rank_battles_right_latest
                  ON dirty_rank_battles(right_id, category_id, cohort, status, sequence DESC);
                    """
                )
                connection.execute(
                    """INSERT INTO dirty_schema_versions(plugin_id, version, applied_at)
                       VALUES (?, ?, ?)
                       ON CONFLICT(plugin_id) DO UPDATE SET
                         version=excluded.version, applied_at=excluded.applied_at""",
                    (PLUGIN_ID, self.SCHEMA_VERSION, iso_time(utc_now())),
                )
                connection.execute(
                    """INSERT OR IGNORE INTO dirty_metadata(namespace, key, value)
                       VALUES (?, 'revision', '0')""",
                    (PLUGIN_ID,),
                )

    @staticmethod
    def _row_pool(row: Any) -> dict[str, Any] | None:
        if row is None:
            return None
        return {
            "rating": float(row["rating"]),
            "deviation": float(row["deviation"]),
            "volatility": float(row["volatility"]),
            "matches": int(row["matches"]),
            "wins": int(row["wins"]),
            "losses": int(row["losses"]),
            "draws": int(row["draws"]),
            "lastRatedAt": row["last_rated_at"],
            "recentBattleIds": json.loads(row["recent_battle_ids"] or "[]"),
        }

    def pool(self, connection: Any, performer_id: str, category_id: str, cohort: str) -> dict[str, Any] | None:
        row = connection.execute(
            """SELECT * FROM dirty_rank_pools
               WHERE performer_id=? AND category_id=? AND cohort=?""",
            (performer_id, category_id, cohort),
        ).fetchone()
        return self._row_pool(row)

    def put_pool(self, connection: Any, performer_id: str, category_id: str, cohort: str, pool: dict[str, Any]) -> None:
        connection.execute(
            """INSERT INTO dirty_rank_pools(
                 performer_id, category_id, cohort, rating, deviation, volatility,
                 matches, wins, losses, draws, last_rated_at, recent_battle_ids
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(performer_id, category_id, cohort) DO UPDATE SET
                 rating=excluded.rating, deviation=excluded.deviation,
                 volatility=excluded.volatility, matches=excluded.matches,
                 wins=excluded.wins, losses=excluded.losses, draws=excluded.draws,
                 last_rated_at=excluded.last_rated_at,
                 recent_battle_ids=excluded.recent_battle_ids""",
            (
                performer_id, category_id, cohort, pool["rating"], pool["deviation"],
                pool["volatility"], pool["matches"], pool["wins"], pool["losses"],
                pool["draws"], pool.get("lastRatedAt"),
                json.dumps(_recent_ids(pool), separators=(",", ":")),
            ),
        )

    def restore_pool(self, connection: Any, performer_id: str, category_id: str, cohort: str, snapshot: dict[str, Any] | None) -> None:
        if snapshot is None:
            connection.execute(
                "DELETE FROM dirty_rank_pools WHERE performer_id=? AND category_id=? AND cohort=?",
                (performer_id, category_id, cohort),
            )
        else:
            self.put_pool(connection, performer_id, category_id, cohort, snapshot)

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

    def all_states(self) -> dict[str, Any]:
        with self.connect() as connection:
            revision = self.revision(connection)
            states: dict[str, Any] = {}
            for row in connection.execute("SELECT * FROM dirty_rank_pools ORDER BY performer_id"):
                performer_id = str(row["performer_id"])
                state = states.setdefault(performer_id, {"version": STATE_VERSION, "revision": revision, "pools": {}})
                state["pools"][pool_key(row["category_id"], row["cohort"])] = self._row_pool(row)
            return {"version": STATE_VERSION, "revision": revision, "states": states}


def _category_settings_with_label_ids(raw_settings: dict[str, Any]) -> tuple[dict[str, Any], dict[str, dict[str, str]]]:
    """Canonicalize category IDs while retaining each category's previous ID for migration."""
    result = dict(raw_settings)
    raw_categories = raw_settings.get("categories")
    if isinstance(raw_categories, str):
        try:
            raw_categories = json.loads(raw_categories)
        except (TypeError, ValueError):
            raw_categories = None
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


def _move_category_rating_ids(connection: Any, remaps: dict[str, dict[str, str]]) -> bool:
    changed = False
    for cohort, mapping in remaps.items():
        if not mapping:
            continue
        old_ids = set(mapping)
        for new_id in mapping.values():
            if new_id in old_ids:
                continue
            for table in ("dirty_rank_pools", "dirty_rank_battles"):
                if connection.execute(
                    f"SELECT 1 FROM {table} WHERE cohort=? AND category_id=? LIMIT 1",
                    (cohort, new_id),
                ).fetchone():
                    raise PluginError(
                        f"Cannot rename a {cohort} category to {new_id}: ratings already use that ID"
                    )
        temporary = {old_id: "__dirty_rank_migration_" + uuid.uuid4().hex for old_id in mapping}
        for old_id, temp_id in temporary.items():
            for table in ("dirty_rank_pools", "dirty_rank_battles"):
                connection.execute(
                    f"UPDATE {table} SET category_id=? WHERE cohort=? AND category_id=?",
                    (temp_id, cohort, old_id),
                )
        for old_id, new_id in mapping.items():
            for table in ("dirty_rank_pools", "dirty_rank_battles"):
                connection.execute(
                    f"UPDATE {table} SET category_id=? WHERE cohort=? AND category_id=?",
                    (new_id, cohort, temporary[old_id]),
                )
        changed = True
    return changed


def _category_ids_differ(current: dict[str, Any], canonical: dict[str, Any]) -> bool:
    try:
        return json.loads(current["categories"]) != json.loads(canonical["categories"])
    except (KeyError, TypeError, ValueError):
        return current.get("categories") != canonical.get("categories")


def _ensure_category_ids(repository: RatingRepository, connection: Any) -> None:
    current = shared_storage.get_plugin_settings(PLUGIN_ID, connection=connection)
    if not current or "categories" not in current:
        return
    canonical, _ = _category_settings_with_label_ids(current)
    if not _category_ids_differ(current, canonical):
        return
    shared_storage.backup_database(path=repository.path)
    connection.execute("BEGIN IMMEDIATE")
    try:
        current = shared_storage.get_plugin_settings(PLUGIN_ID, connection=connection)
        canonical, remaps = _category_settings_with_label_ids(current)
        if _category_ids_differ(current, canonical):
            if _move_category_rating_ids(connection, remaps):
                repository.increment_revision(connection)
            shared_storage.set_plugin_settings_on_connection(
                PLUGIN_ID, canonical, connection,
                shared_storage.get_plugin_revision(PLUGIN_ID, connection=connection),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


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
        current_categories = current.get("categories")
        if isinstance(current_categories, str):
            try:
                current_categories = json.loads(current_categories)
            except (TypeError, ValueError):
                current_categories = None
        if isinstance(current_categories, dict):
            for cohort, mapping in remaps.items():
                existing_ids = {str(item.get("id")) for item in current_categories.get(cohort, []) if isinstance(item, dict)}
                remaps[cohort] = {old: new for old, new in mapping.items() if old in existing_ids}
        else:
            remaps = {}
        if _move_category_rating_ids(connection, remaps):
            repository.increment_revision(connection)
        response = shared_storage.set_plugin_settings_on_connection(
            PLUGIN_ID, canonical, connection, expected_revision
        )
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


def record_battle(
    repository: RatingRepository,
    args: dict[str, Any],
    settings: dict[str, Any],
    now: datetime | None = None,
) -> dict[str, Any]:
    left_id = str(args.get("leftId") or "").strip()
    right_id = str(args.get("rightId") or "").strip()
    battle_id = str(args.get("battleId") or "").strip()
    cohort = _enabled_cohort(settings, args.get("cohort"))
    category_id = _category(
        settings, str(args.get("categoryId") or ""), cohort
    )["id"]
    outcome = str(args.get("outcome") or "").strip().lower()
    if not left_id or not right_id or left_id == right_id:
        raise PluginError("A battle requires two different performers")
    if not battle_id or len(battle_id) > 160:
        raise PluginError("A battle requires a valid idempotency ID")
    if outcome not in {"left", "right", "draw"}:
        raise PluginError("Outcome must be left, right, or draw")

    timestamp = iso_time(now or utc_now())
    with repository.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        duplicate = connection.execute(
            "SELECT status FROM dirty_rank_battles WHERE battle_id=?", (battle_id,)
        ).fetchone()
        if duplicate is not None:
            revision = repository.revision(connection)
            left_state = repository.state(connection, left_id, revision)
            right_state = repository.state(connection, right_id, revision)
            key = pool_key(category_id, cohort)
            return {
                "duplicate": True,
                "battleId": battle_id,
                "left": {"id": left_id, "pool": left_state["pools"].get(key), "state": left_state},
                "right": {"id": right_id, "pool": right_state["pools"].get(key), "state": right_state},
            }

        left_pool = repository.pool(connection, left_id, category_id, cohort)
        right_pool = repository.pool(connection, right_id, category_id, cohort)
        score_left = {"left": 1.0, "right": 0.0, "draw": 0.5}[outcome]
        new_left, new_right = rate_battle(
            rating_from_pool(left_pool, settings), rating_from_pool(right_pool, settings),
            score_left, settings, now,
        )

        def build_pool(rating: Rating, old_pool: Any) -> dict[str, Any]:
            value = rating_to_pool(rating)
            value["recentBattleIds"] = (_recent_ids(old_pool) + [battle_id])[-MAX_RECENT_BATTLE_IDS:]
            return value

        next_left = build_pool(new_left, left_pool)
        next_right = build_pool(new_right, right_pool)
        repository.put_pool(connection, left_id, category_id, cohort, next_left)
        repository.put_pool(connection, right_id, category_id, cohort, next_right)
        connection.execute(
            """INSERT INTO dirty_rank_battles(
                 battle_id, category_id, cohort, left_id, right_id, outcome,
                 left_before, right_before, left_after, right_after, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                battle_id, category_id, cohort, left_id, right_id, outcome,
                serialize_state(left_pool) if left_pool is not None else None,
                serialize_state(right_pool) if right_pool is not None else None,
                serialize_state(next_left), serialize_state(next_right), timestamp,
            ),
        )
        revision = repository.increment_revision(connection)
        left_state = repository.state(connection, left_id, revision)
        right_state = repository.state(connection, right_id, revision)
        connection.commit()
    key = pool_key(category_id, cohort)
    return {
        "duplicate": False,
        "battleId": battle_id,
        "categoryId": category_id,
        "cohort": cohort,
        "left": {"id": left_id, "pool": left_state["pools"][key], "state": left_state},
        "right": {"id": right_id, "pool": right_state["pools"][key], "state": right_state},
    }


def undo_battle(
    repository: RatingRepository,
    args: dict[str, Any],
    settings: dict[str, Any],
) -> dict[str, Any]:
    left_id = str(args.get("leftId") or "").strip()
    right_id = str(args.get("rightId") or "").strip()
    battle_id = str(args.get("battleId") or "").strip()
    cohort = _cohort(args.get("cohort"), settings)
    category_id = _category(
        settings, str(args.get("categoryId") or ""), cohort
    )["id"]
    with repository.connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        battle = connection.execute(
            "SELECT * FROM dirty_rank_battles WHERE battle_id=? AND status='active'",
            (battle_id,),
        ).fetchone()
        if battle is None:
            raise PluginError(f"Battle {battle_id} is not available to undo")
        if str(battle["left_id"]) != left_id or str(battle["right_id"]) != right_id:
            raise PluginError("The stored undo performers do not match this battle")
        if battle["category_id"] != category_id or battle["cohort"] != cohort:
            raise PluginError("The stored undo pool does not match this battle")
        for performer_id in (left_id, right_id):
            latest = connection.execute(
                """SELECT MAX(sequence) FROM dirty_rank_battles
                   WHERE status='active' AND category_id=? AND cohort=?
                     AND (left_id=? OR right_id=?)""",
                (category_id, cohort, performer_id, performer_id),
            ).fetchone()[0]
            if latest != battle["sequence"]:
                raise PluginError(f"Battle {battle_id} is not the latest battle for performer {performer_id}")
        left_before = json.loads(battle["left_before"]) if battle["left_before"] else None
        right_before = json.loads(battle["right_before"]) if battle["right_before"] else None
        repository.restore_pool(connection, left_id, category_id, cohort, left_before)
        repository.restore_pool(connection, right_id, category_id, cohort, right_before)
        connection.execute(
            "UPDATE dirty_rank_battles SET status='undone', undone_at=? WHERE sequence=?",
            (iso_time(utc_now()), battle["sequence"]),
        )
        revision = repository.increment_revision(connection)
        left_state = repository.state(connection, left_id, revision)
        right_state = repository.state(connection, right_id, revision)
        connection.commit()
    key = pool_key(category_id, cohort)
    return {
        "undone": True,
        "battleId": battle_id,
        "left": {"id": left_id, "state": left_state, "pool": left_state["pools"].get(key)},
        "right": {"id": right_id, "state": right_state, "pool": right_state["pools"].get(key)},
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
        connection.execute(
            "DELETE FROM dirty_rank_pools WHERE category_id=? AND cohort=?",
            (category_id, cohort),
        )
        connection.execute(
            "DELETE FROM dirty_rank_battles WHERE category_id=? AND cohort=?",
            (category_id, cohort),
        )
        repository.increment_revision(connection)
        connection.commit()
    reporter.progress(1.0)
    return {"reset": int(reset), "failed": 0, "failures": []}


def read_payload(stream: Any = sys.stdin) -> dict[str, Any]:
    raw = stream.read()
    if not raw.strip():
        raise PluginError("Stash did not provide plugin input")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PluginError(f"Stash provided invalid JSON: {exc}") from exc
    if not isinstance(payload, dict):
        raise PluginError("Stash plugin input must be an object")
    return payload


def emit_output(output: Any, stream: Any = sys.stdout) -> None:
    json.dump({"output": json.dumps(output, ensure_ascii=False)}, stream, ensure_ascii=False)
    stream.write("\n")
    stream.flush()


def emit_error(error: Exception, stream: Any = sys.stdout) -> None:
    json.dump({"error": str(error)}, stream, ensure_ascii=False)
    stream.write("\n")
    stream.flush()


def configure_standard_streams() -> None:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8")


def run(payload: dict[str, Any], reporter: Reporter | None = None) -> dict[str, Any]:
    reporter = reporter or Reporter()
    args = payload.get("args") or {}
    if not isinstance(args, dict):
        raise PluginError("Plugin arguments must be an object")
    connection = shared_storage.connect()
    try:
        repository = RatingRepository(connection=connection)
        mode = str(args.get("mode") or "record")
        _ensure_category_ids(repository, connection)
        if mode == "getSettings":
            return {
                "revision": shared_storage.get_plugin_revision(PLUGIN_ID, connection=connection),
                "settings": shared_storage.get_plugin_settings(PLUGIN_ID, connection=connection),
            }
        if mode == "saveSettings":
            return save_settings(repository, connection, args)
        if mode == "loadAll":
            return repository.all_states()
        settings = normalize_settings(
            shared_storage.get_plugin_settings(PLUGIN_ID, connection=connection)
        )
        if mode == "record":
            return record_battle(repository, args, settings)
        if mode == "undo":
            return undo_battle(repository, args, settings)
        if mode == "resetPool":
            return reset_pool(repository, args, settings, reporter)
        raise PluginError(f"Unsupported DirtyRank operation mode: {mode}")
    finally:
        connection.close()


def _requested_mode(payload: Any) -> str:
    args = payload.get("args") if isinstance(payload, dict) else None
    if isinstance(args, dict):
        return str(args.get("mode") or "record")
    return "unknown"


def main() -> int:
    configure_standard_streams()
    reporter = StashReporter()
    started = time.monotonic()
    mode = "unknown"
    try:
        payload = read_payload()
        mode = _requested_mode(payload)
        reporter.info(f"DirtyRank backend started: mode={mode}")
        output = run(payload, reporter)
        reporter.info(
            f"DirtyRank backend finished: mode={mode} in {int((time.monotonic() - started) * 1000)}ms"
        )
        emit_output(output)
        return 0
    except Exception as exc:
        reporter.error(
            f"DirtyRank failed: mode={mode} after {int((time.monotonic() - started) * 1000)}ms: {exc}"
        )
        emit_error(exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
