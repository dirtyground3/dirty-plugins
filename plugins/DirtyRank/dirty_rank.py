"""DirtyRank backend: category-scoped Glicko-2 ratings for Stash performers."""

from __future__ import annotations

import copy
import json
import math
import re
import sys
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
    "showLeaderboardsInMenu": True,
    "showRatingsBeforeVote": False,
    "hidePerformerImages": False,
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
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()).strip("-")
    return slug[:64]


def _parse_category_list(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        value = copy.deepcopy(DEFAULT_CATEGORY_DEFINITIONS)

    categories: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for index, raw in enumerate(value[:24]):
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()[:80]
        category_id = _slug(raw.get("id") or name)
        if not name or not category_id or category_id in used_ids:
            continue
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
        used_ids.add(category_id)
    if not categories:
        return _parse_category_list(copy.deepcopy(DEFAULT_CATEGORY_DEFINITIONS))
    return categories


def _parse_categories_by_cohort(value: Any) -> dict[str, list[dict[str, Any]]]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            value = None

    source = value if isinstance(value, dict) else {}
    return {
        cohort: _parse_category_list(source.get(cohort))
        for cohort in VALID_COHORTS
    }


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
    if cohort not in VALID_COHORTS:
        cohort = str(DEFAULT_SETTINGS["defaultCohort"])
    enabled_cohorts = _parse_enabled_cohorts(source.get("enabledCohorts"), [cohort])
    if cohort not in enabled_cohorts:
        cohort = enabled_cohorts[0]
    confidence_goal = str(source.get("confidenceGoal") or "ranking").lower()
    if confidence_goal not in {"all", "ranking", "top"}:
        confidence_goal = "ranking"
    initial_deviation = _finite_number(
        source.get("initialDeviation"), 350.0, 30.0, 1000.0
    )
    deviation_floor = _finite_number(
        source.get("deviationFloor"), 30.0, 1.0, initial_deviation
    )
    return {
        "categoriesByCohort": _parse_categories_by_cohort(source.get("categories")),
        "defaultCohort": cohort,
        "enabledCohorts": enabled_cohorts,
        "showLeaderboardsInMenu": _boolean(
            source.get("showLeaderboardsInMenu"), True
        ),
        "showRatingsBeforeVote": _boolean(source.get("showRatingsBeforeVote"), False),
        "hidePerformerImages": _boolean(source.get("hidePerformerImages"), False),
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


def _category(
    settings: dict[str, Any], category_id: str, cohort: str
) -> dict[str, Any]:
    normalized = _slug(category_id)
    for category in settings["categoriesByCohort"].get(cohort, []):
        if category["id"] == normalized and category["enabled"]:
            return category
    raise PluginError(
        f"Unknown or disabled DirtyRank category for {cohort}: {category_id}"
    )


def _cohort(value: Any) -> str:
    cohort = str(value or "").strip().upper()
    if cohort not in VALID_COHORTS:
        raise PluginError(f"Unsupported performer cohort: {value}")
    return cohort


def _enabled_cohort(settings: dict[str, Any], value: Any) -> str:
    cohort = _cohort(value)
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
    cohort = _cohort(args.get("cohort"))
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
    cohort = _cohort(args.get("cohort"))
    category_id = _category(
        settings, str(args.get("categoryId") or ""), cohort
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
        if mode == "loadAll":
            return repository.all_states()
        if mode == "backupSharedDatabase":
            return {"path": str(shared_storage.backup_database(path=repository.path))}
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


def main() -> int:
    configure_standard_streams()
    reporter = StashReporter()
    try:
        emit_output(run(read_payload(), reporter))
        return 0
    except Exception as exc:
        reporter.error(f"DirtyRank failed: {exc}")
        emit_error(exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
