"""DirtyMultiscreen's saved grids in the shared DirtyPlugins database.

Named grids are kept until deleted. Recent grids are saved automatically while they play; only the newest few
stay, and naming one keeps it as a named grid.
"""

import json
import time

import dirty_plugins_storage as storage
from dirty_multiscreen_metadata import LIMITS


MAX_NAME_LENGTH = 80
# A grid launched from another plugin's list keeps that list's IDs, so a session can be large.
MAX_DATA_BYTES = 4 * 1024 * 1024
MAX_GRIDS = 200
MAX_RECENT = LIMITS["recentGrids"]["max"]


class GridError(ValueError):
    """A request the browser can show as it is: it never names a path."""


def _connection(immediate=True):
    return storage.transaction(immediate=immediate)


def _ensure_table(connection):
    connection.execute("""CREATE TABLE IF NOT EXISTS dirty_multiscreen_grids (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        grid_rows INTEGER NOT NULL,
        grid_columns INTEGER NOT NULL,
        data TEXT NOT NULL,
        updated_at REAL NOT NULL,
        recent INTEGER NOT NULL DEFAULT 0
    )""")


def _summary(row):
    return {"id": row["id"], "name": row["name"], "rows": row["grid_rows"],
            "columns": row["grid_columns"], "updatedAt": row["updated_at"], "recent": bool(row["recent"])}


def _name(value):
    name = " ".join(value.split()) if isinstance(value, str) else ""
    if not name:
        raise GridError("Enter a name for the grid")
    if len(name) > MAX_NAME_LENGTH:
        raise GridError(f"A grid name has at most {MAX_NAME_LENGTH} characters")
    return name


def _whole(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and value == int(value)


def _side(value, label):
    limits = LIMITS[label]
    if not _whole(value):
        raise GridError(f"Grid {label} must be a whole number")
    if not limits["min"] <= int(value) <= limits["max"]:
        raise GridError(f"Grid {label} must be between {limits['min']} and {limits['max']}")
    return int(value)


def _keep(value):
    if not _whole(value) or not 0 <= int(value) <= MAX_RECENT:
        raise GridError(f"Recent grids to keep must be between 0 and {MAX_RECENT}")
    return int(value)


def _data(value):
    """The session is stored as the JSON text the browser sent, so no number or key changes on the way."""
    if not isinstance(value, str):
        raise GridError("Grid data must be JSON text")
    if len(value.encode("utf-8")) > MAX_DATA_BYTES:
        raise GridError("This grid is too large to save")
    try:
        parsed = json.loads(value)
    except ValueError as exc:
        raise GridError("Grid data is not valid JSON") from exc
    if not isinstance(parsed, dict):
        raise GridError("Grid data must be a JSON object")
    return value


def _id(value):
    if not _whole(value):
        raise GridError("Unknown saved grid")
    return int(value)


def _row(connection, grid_id):
    row = connection.execute("SELECT * FROM dirty_multiscreen_grids WHERE id=?", (_id(grid_id),)).fetchone()
    if row is None:
        raise GridError("This saved grid no longer exists")
    return row


def _room_for_named(connection):
    count = connection.execute("SELECT COUNT(*) FROM dirty_multiscreen_grids WHERE recent=0").fetchone()[0]
    if count >= MAX_GRIDS:
        raise GridError(f"At most {MAX_GRIDS} grids can be saved. Delete one first")


def _trim_recent(connection, keep):
    connection.execute(
        "DELETE FROM dirty_multiscreen_grids WHERE recent=1 AND id NOT IN ("
        "SELECT id FROM dirty_multiscreen_grids WHERE recent=1 ORDER BY updated_at DESC, id DESC LIMIT ?)",
        (keep,))


def list_grids(keep_recent=None):
    """Recent grids first, newest first, then named grids by name. A number trims the recent grids to it first."""
    keep = None if keep_recent is None else _keep(keep_recent)
    with _connection(immediate=keep is not None) as connection:
        _ensure_table(connection)
        if keep is not None:
            _trim_recent(connection, keep)
        rows = connection.execute(
            "SELECT id, name, grid_rows, grid_columns, updated_at, recent FROM dirty_multiscreen_grids "
            "ORDER BY recent DESC, CASE WHEN recent=1 THEN -updated_at END, name COLLATE NOCASE, id")
        return [_summary(row) for row in rows]


def get_grid(grid_id):
    with _connection(immediate=False) as connection:
        _ensure_table(connection)
        row = _row(connection, grid_id)
        return {**_summary(row), "data": row["data"]}


def save_grid(name, rows, columns, data, grid_id=None, now=None):
    """Add a named grid, or replace the screens of an existing one when its ID is given."""
    values = (_name(name), _side(rows, "rows"), _side(columns, "columns"), _data(data),
              time.time() if now is None else now)
    with _connection() as connection:
        _ensure_table(connection)
        if grid_id is None:
            _room_for_named(connection)
            grid_id = connection.execute(
                "INSERT INTO dirty_multiscreen_grids(name, grid_rows, grid_columns, data, updated_at) "
                "VALUES (?, ?, ?, ?, ?)", values).lastrowid
        else:
            if _row(connection, grid_id)["recent"]:
                _room_for_named(connection)
            connection.execute(
                "UPDATE dirty_multiscreen_grids SET name=?, grid_rows=?, grid_columns=?, data=?, updated_at=?, "
                "recent=0 WHERE id=?", (*values, _id(grid_id)))
        return _summary(_row(connection, grid_id))


def save_recent(name, rows, columns, data, keep, grid_id=None, now=None):
    """Update the recent grid with this ID, or add one when it is gone or was kept under a name.

    Only the newest `keep` recent grids stay; with 0 none are saved and every recent grid goes.
    """
    keep = _keep(keep)
    values = (_name(name), _side(rows, "rows"), _side(columns, "columns"), _data(data),
              time.time() if now is None else now)
    with _connection() as connection:
        _ensure_table(connection)
        if not keep:
            _trim_recent(connection, 0)
            return None
        current = None if grid_id is None else connection.execute(
            "SELECT id FROM dirty_multiscreen_grids WHERE id=? AND recent=1", (_id(grid_id),)).fetchone()
        if current is None:
            grid_id = connection.execute(
                "INSERT INTO dirty_multiscreen_grids(name, grid_rows, grid_columns, data, updated_at, recent) "
                "VALUES (?, ?, ?, ?, ?, 1)", values).lastrowid
        else:
            connection.execute(
                "UPDATE dirty_multiscreen_grids SET name=?, grid_rows=?, grid_columns=?, data=?, updated_at=? "
                "WHERE id=?", (*values, _id(grid_id)))
        _trim_recent(connection, keep)
        return _summary(_row(connection, grid_id))


def keep_grid(grid_id, name):
    """Keep a recent grid under a name. A named grid with the same name is replaced."""
    name = _name(name)
    with _connection() as connection:
        _ensure_table(connection)
        if not _row(connection, grid_id)["recent"]:
            raise GridError("This grid is already saved")
        same = connection.execute(
            "SELECT id FROM dirty_multiscreen_grids WHERE recent=0 AND name=? COLLATE NOCASE", (name,)).fetchall()
        if same:
            connection.executemany("DELETE FROM dirty_multiscreen_grids WHERE id=?", [(row["id"],) for row in same])
        else:
            _room_for_named(connection)
        connection.execute("UPDATE dirty_multiscreen_grids SET name=?, recent=0 WHERE id=?", (name, _id(grid_id)))
        return _summary(_row(connection, grid_id))


def rename_grid(grid_id, name):
    with _connection() as connection:
        _ensure_table(connection)
        _row(connection, grid_id)
        connection.execute("UPDATE dirty_multiscreen_grids SET name=? WHERE id=?", (_name(name), _id(grid_id)))
        return _summary(_row(connection, grid_id))


def delete_grid(grid_id):
    with _connection() as connection:
        _ensure_table(connection)
        return connection.execute("DELETE FROM dirty_multiscreen_grids WHERE id=?", (_id(grid_id),)).rowcount > 0
