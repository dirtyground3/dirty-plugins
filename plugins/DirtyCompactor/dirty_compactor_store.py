"""DirtyCompactor records in the shared Dirty Plugins database.

Compactor owns no second database. JSON snapshots are immutable at the run
boundary; revision checks protect decisions made by multiple browser tabs.
"""
import json
from contextlib import closing

import dirty_plugins_storage as storage


def _schema(connection):
    # Initialized on the first access only. Established polling reads must not
    # execute DDL or reserve the shared database's writer lock.
    if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dirty_compactor_records'").fetchone():
        return
    connection.execute("""CREATE TABLE IF NOT EXISTS dirty_compactor_records (
        kind TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
        value_json TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(kind, id))""")


def get(kind, record_id, path=None):
    with closing(storage.connect(path)) as connection:
        _schema(connection)
        row = connection.execute(
            "SELECT value_json, revision FROM dirty_compactor_records WHERE kind=? AND id=?",
            (kind, record_id)).fetchone()
    if row is None:
        return None
    return dict(json.loads(row[0]), _revision=row[1])


def list_records(kind, limit=50, path=None):
    with closing(storage.connect(path)) as connection:
        _schema(connection)
        rows = connection.execute(
            "SELECT value_json, revision FROM dirty_compactor_records WHERE kind=? ORDER BY updated_at DESC LIMIT ?",
            (kind, max(1, min(int(limit), 1000)))).fetchall()
    return [dict(json.loads(row[0]), _revision=row[1]) for row in rows]


def put(kind, record_id, value, expected=None, path=None):
    with storage.transaction(path) as connection:
        _schema(connection)
        row = connection.execute(
            "SELECT revision FROM dirty_compactor_records WHERE kind=? AND id=?",
            (kind, record_id)).fetchone()
        revision = row[0] if row else -1
        if expected is not None and revision != expected:
            raise RuntimeError("This operation changed in another session. Refresh and retry.")
        clean = {key: val for key, val in value.items() if key != "_revision"}
        connection.execute("""INSERT INTO dirty_compactor_records VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,
            value_json=excluded.value_json, updated_at=excluded.updated_at""",
            (kind, record_id, revision + 1, json.dumps(clean, ensure_ascii=True), storage._timestamp()))
        return dict(clean, _revision=revision + 1)


def claim_run(run, trigger=None, path=None):
    """Atomically claim one active run and deduplicate scan events across tabs."""
    with storage.transaction(path) as connection:
        _schema(connection)
        def read(kind, key):
            row = connection.execute("SELECT value_json FROM dirty_compactor_records WHERE kind=? AND id=?", (kind, key)).fetchone()
            return json.loads(row[0]) if row else None
        def write(kind, key, value):
            connection.execute("""INSERT INTO dirty_compactor_records VALUES (?,?,0,?,?)
                ON CONFLICT(kind,id) DO UPDATE SET value_json=excluded.value_json,
                revision=dirty_compactor_records.revision+1, updated_at=excluded.updated_at""",
                (kind, key, json.dumps(value), storage._timestamp()))
        if trigger and read("trigger", trigger):
            return {"duplicate": True}
        active = read("control", "active")
        if active:
            existing = read("run", active["id"])
            if existing and existing["status"] not in ("completed", "cancelled", "failed"):
                if trigger:
                    write("control", "pending", {"trigger": trigger})
                    write("trigger", trigger, {"id": existing["id"]})
                    return {"id": existing["id"], "coalesced": True}
                raise RuntimeError("Resolve or cancel the active DirtyCompactor run first.")
        write("run", run["id"], run)
        write("control", "active", {"id": run["id"]})
        if trigger:
            write("trigger", trigger, {"id": run["id"]})
        return {"id": run["id"]}
