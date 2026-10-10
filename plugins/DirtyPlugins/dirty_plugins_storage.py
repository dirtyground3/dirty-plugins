"""Shared SQLite storage for the Dirty Plugins collection."""

from __future__ import annotations

import os
import json
import sqlite3
import uuid
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


DATABASE_FILENAME = "dirty_plugins.sqlite3"
SETTINGS_NAMESPACE = "dirtyPlugins.settings"
STORAGE_SCHEMA_VERSION = 1


class SettingsRevisionConflict(RuntimeError):
    """Raised when a settings write does not match the expected revision."""

    def __init__(self, plugin_id: str, expected: int, actual: int):
        super().__init__(
            f"Settings for {plugin_id} changed in another session "
            f"(expected revision {expected}, found {actual}). Reload and retry."
        )
        self.plugin_id = plugin_id
        self.expected = expected
        self.actual = actual


def database_path(explicit: str | Path | None = None) -> Path:
    override = explicit or os.environ.get("DIRTY_PLUGINS_DATABASE_PATH")
    return Path(override).resolve() if override else Path(__file__).with_name(DATABASE_FILENAME)


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    target = database_path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(target, timeout=5.0)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.execute("PRAGMA synchronous = NORMAL")
    try:
        installed = connection.execute(
            "SELECT version FROM dirty_schema_versions WHERE plugin_id='dirtyPlugins'"
        ).fetchone()
    except sqlite3.OperationalError as error:
        if "no such table" not in str(error).lower():
            connection.close()
            raise
        installed = None
    installed_version = int(installed[0]) if installed else 0
    if installed_version > STORAGE_SCHEMA_VERSION:
        connection.close()
        raise RuntimeError(
            f"DirtyPlugins database schema {installed_version} is newer than this runtime supports"
        )
    if installed_version != STORAGE_SCHEMA_VERSION:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(
            """
        CREATE TABLE IF NOT EXISTS dirty_schema_versions (
          plugin_id TEXT PRIMARY KEY,
          version INTEGER NOT NULL,
          applied_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS dirty_metadata (
          namespace TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          PRIMARY KEY (namespace, key)
        );
        CREATE TABLE IF NOT EXISTS dirty_plugin_settings (
          plugin_id TEXT NOT NULL,
          setting_key TEXT NOT NULL,
          value_json TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (plugin_id, setting_key)
        );
            """
        )
        connection.execute(
            """INSERT INTO dirty_schema_versions(plugin_id, version, applied_at)
               VALUES ('dirtyPlugins', ?, ?)
               ON CONFLICT(plugin_id) DO UPDATE SET
                 version=excluded.version, applied_at=excluded.applied_at""",
            (STORAGE_SCHEMA_VERSION, _timestamp()),
        )
        connection.commit()
    return connection


@contextmanager
def _borrowed(connection: sqlite3.Connection | None, path: str | Path | None) -> Iterator[sqlite3.Connection]:
    """Use the caller's connection as is, or open and close an owned one."""
    if connection is not None:
        yield connection
        return
    with closing(connect(path)) as owned:
        yield owned


def _metadata_value(connection: sqlite3.Connection, namespace: str, key: str) -> str | None:
    row = connection.execute(
        "SELECT value FROM dirty_metadata WHERE namespace=? AND key=?", (str(namespace), str(key))
    ).fetchone()
    return str(row[0]) if row else None


def _put_metadata(connection: sqlite3.Connection, namespace: str, key: str, value: str) -> None:
    connection.execute(
        """INSERT INTO dirty_metadata(namespace, key, value) VALUES (?, ?, ?)
           ON CONFLICT(namespace, key) DO UPDATE SET value=excluded.value""",
        (str(namespace), str(key), str(value)),
    )


@contextmanager
def transaction(path: str | Path | None = None, *, immediate=True) -> Iterator[sqlite3.Connection]:
    connection = connect(path)
    try:
        connection.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def backup_database(destination: str | Path | None = None, path: str | Path | None = None) -> Path:
    source_path = database_path(path)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = Path(destination) if destination else source_path.with_name(
        f"dirty_plugins-backup-{stamp}-{uuid.uuid4().hex}.sqlite3"
    )
    target = target.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    # Reserve before SQLite opens it: never merge into an existing backup.
    with target.open("xb"):
        pass
    try:
        with closing(connect(source_path)) as source, closing(sqlite3.connect(target)) as target_connection:
            source.backup(target_connection)
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    return target


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _plugin_revision_key(plugin_id: str) -> str:
    return f"plugin-revision:{plugin_id}"


def get_plugin_revision(
    plugin_id: str,
    path: str | Path | None = None,
    connection: sqlite3.Connection | None = None,
) -> int:
    with _borrowed(connection, path) as current:
        value = _metadata_value(current, SETTINGS_NAMESPACE, _plugin_revision_key(str(plugin_id)))
        return int(value) if value is not None else 0


def get_metadata(namespace: str, key: str, path: str | Path | None = None, *, connection=None) -> str | None:
    with _borrowed(connection, path) as current:
        return _metadata_value(current, namespace, key)


def set_metadata(
    namespace: str,
    key: str,
    value: str,
    path: str | Path | None = None,
) -> None:
    with transaction(path) as connection:
        _put_metadata(connection, namespace, key, value)


def update_json_metadata(namespace, key, update, path=None):
    """Atomically update a JSON record; callbacks must not perform external I/O."""
    with transaction(path) as connection:
        stored = _metadata_value(connection, namespace, key)
        value = update(json.loads(stored) if stored is not None else {})
        _put_metadata(connection, namespace, key, json.dumps(value, ensure_ascii=True))
        return value


def list_metadata(namespace, path=None, *, connection=None, limit=None, keys=None):
    """Read a namespace, a bounded queue batch, or the keys on one fetched page."""
    query = "SELECT key, value FROM dirty_metadata WHERE namespace=?"
    values = [str(namespace)]
    if keys is not None:
        keys = list(dict.fromkeys(str(key) for key in keys))
        if not keys:
            return {}
        if len(keys) > 900:
            raise ValueError("Metadata key reads must be batched at 900 keys or fewer")
        query += " AND key IN (" + ",".join("?" for key in keys) + ")"
        values.extend(keys)
    query += " ORDER BY key"
    if limit is not None:
        query += " LIMIT ?"
        values.append(max(0, int(limit)))
    with _borrowed(connection, path) as current:
        return {str(row["key"]): str(row["value"]) for row in current.execute(query, values)}


def has_metadata(namespace, path=None, *, connection=None):
    with _borrowed(connection, path) as current:
        return current.execute(
            "SELECT 1 FROM dirty_metadata WHERE namespace=? LIMIT 1", (str(namespace),)
        ).fetchone() is not None


def delete_metadata(namespace, key, path=None, expected=None):
    """An expected value prevents removing work requested again in the meantime."""
    with transaction(path) as connection:
        query = "DELETE FROM dirty_metadata WHERE namespace=? AND key=?"
        values = [str(namespace), str(key)]
        if expected is not None:
            query += " AND value=?"
            values.append(str(expected))
        return connection.execute(query, values).rowcount > 0


def get_plugin_settings(
    plugin_id: str,
    path: str | Path | None = None,
    connection: sqlite3.Connection | None = None,
) -> dict:
    with _borrowed(connection, path) as current:
        rows = current.execute(
            "SELECT setting_key, value_json FROM dirty_plugin_settings WHERE plugin_id=?",
            (str(plugin_id),),
        ).fetchall()
        return {str(row["setting_key"]): json.loads(row["value_json"]) for row in rows}


def get_plugin_settings_snapshot(plugin_id: str, path: str | Path | None = None) -> dict:
    """Read one plugin's settings and revision as a single snapshot."""
    with transaction(path, immediate=False) as connection:
        revision = get_plugin_revision(str(plugin_id), connection=connection)
        settings = get_plugin_settings(str(plugin_id), connection=connection)
        return {"revision": revision, "settings": settings}


def get_all_plugin_settings(path: str | Path | None = None) -> dict:
    with transaction(path, immediate=False) as connection:
        # A single read transaction keeps the settings rows and their per-plugin
        # revisions on the same snapshot.
        result: dict[str, dict] = {}
        for row in connection.execute(
            "SELECT plugin_id, setting_key, value_json FROM dirty_plugin_settings ORDER BY plugin_id, setting_key"
        ):
            result.setdefault(str(row["plugin_id"]), {})[str(row["setting_key"])] = json.loads(row["value_json"])
        revisions: dict[str, int] = {}
        for row in connection.execute(
            "SELECT key, value FROM dirty_metadata WHERE namespace=? AND key LIKE 'plugin-revision:%'",
            (SETTINGS_NAMESPACE,),
        ):
            revisions[str(row["key"]).split(":", 1)[1]] = int(row["value"])
        return {
            "revision": max(revisions.values(), default=0),
            "pluginRevisions": revisions,
            "settings": result,
        }


def set_plugin_settings(
    plugin_id: str,
    values: dict,
    path: str | Path | None = None,
    expected_revision: int | None = None,
) -> dict:
    with transaction(path) as connection:
        return set_plugin_settings_on_connection(str(plugin_id), values, connection, expected_revision)


def set_plugin_settings_on_connection(
    plugin_id: str,
    values: dict,
    connection: sqlite3.Connection,
    expected_revision: int | None = None,
) -> dict:
    """Write settings inside an existing transaction (for plugin data migrations)."""
    if not isinstance(values, dict):
        raise TypeError("Plugin settings must be an object")
    plugin_id = str(plugin_id)
    current_revision = get_plugin_revision(plugin_id, connection=connection)
    if expected_revision is not None and int(expected_revision) != current_revision:
        raise SettingsRevisionConflict(plugin_id, int(expected_revision), current_revision)
    connection.execute("DELETE FROM dirty_plugin_settings WHERE plugin_id=?", (plugin_id,))
    timestamp = _timestamp()
    connection.executemany(
        """INSERT INTO dirty_plugin_settings(plugin_id, setting_key, value_json, updated_at)
           VALUES (?, ?, ?, ?)""",
        [
            (plugin_id, str(key), json.dumps(value, ensure_ascii=False, separators=(",", ":")), timestamp)
            for key, value in values.items()
        ],
    )
    revision = current_revision + 1
    _put_metadata(connection, SETTINGS_NAMESPACE, _plugin_revision_key(plugin_id), str(revision))
    return {"pluginId": plugin_id, "revision": revision, "settings": values}


INTERNAL_SCANS_NAMESPACE = "dirtyPlugins.internalScans"


def internal_scan_register(job_id, path=None):
    """Mark a Stash scan a Dirty plugin started itself, so scan automation ignores it."""
    set_metadata(INTERNAL_SCANS_NAMESPACE, str(job_id), str(datetime.now(timezone.utc).timestamp()), path)


def internal_scan_check(job_id, start_time=None, path=None):
    registered = get_metadata(INTERNAL_SCANS_NAMESPACE, str(job_id), path)
    if registered is None or not start_time:
        return False
    try:
        stamp = datetime.fromisoformat(str(start_time).replace("Z", "+00:00")).timestamp()
        # Job IDs reset on Stash restart; a later job must not inherit ownership.
        return -2 <= stamp - float(registered) < 86400
    except (ValueError, TypeError):
        return False
