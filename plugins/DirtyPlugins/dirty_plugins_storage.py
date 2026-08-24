"""Shared SQLite storage for the Dirty Plugins collection."""

from __future__ import annotations

import os
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


DATABASE_FILENAME = "dirty_plugins.sqlite3"
SETTINGS_NAMESPACE = "dirtyPlugins.settings"
STORAGE_SCHEMA_VERSION = 1


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
            (
                STORAGE_SCHEMA_VERSION,
                datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            ),
        )
        connection.commit()
    return connection


@contextmanager
def transaction(path: str | Path | None = None) -> Iterator[sqlite3.Connection]:
    connection = connect(path)
    try:
        connection.execute("BEGIN IMMEDIATE")
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
        f"dirty_plugins-backup-{stamp}.sqlite3"
    )
    target = target.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    source = connect(source_path)
    target_connection = sqlite3.connect(target)
    try:
        source.backup(target_connection)
    finally:
        target_connection.close()
        source.close()
    return target


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def settings_revision(connection: sqlite3.Connection) -> int:
    row = connection.execute(
        "SELECT value FROM dirty_metadata WHERE namespace=? AND key='revision'",
        (SETTINGS_NAMESPACE,),
    ).fetchone()
    return int(row[0]) if row else 0


def get_plugin_settings(
    plugin_id: str,
    path: str | Path | None = None,
    connection: sqlite3.Connection | None = None,
) -> dict:
    current = connection or connect(path)
    try:
        rows = current.execute(
            "SELECT setting_key, value_json FROM dirty_plugin_settings WHERE plugin_id=?",
            (str(plugin_id),),
        ).fetchall()
        return {str(row["setting_key"]): json.loads(row["value_json"]) for row in rows}
    finally:
        if connection is None:
            current.close()


def get_all_plugin_settings(path: str | Path | None = None) -> dict:
    connection = connect(path)
    try:
        result: dict[str, dict] = {}
        for row in connection.execute(
            "SELECT plugin_id, setting_key, value_json FROM dirty_plugin_settings ORDER BY plugin_id, setting_key"
        ):
            result.setdefault(str(row["plugin_id"]), {})[str(row["setting_key"])] = json.loads(row["value_json"])
        return {"revision": settings_revision(connection), "settings": result}
    finally:
        connection.close()


def set_plugin_settings(plugin_id: str, values: dict, path: str | Path | None = None) -> dict:
    if not isinstance(values, dict):
        raise TypeError("Plugin settings must be an object")
    plugin_id = str(plugin_id)
    with transaction(path) as connection:
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
        revision = settings_revision(connection) + 1
        connection.execute(
            """INSERT INTO dirty_metadata(namespace, key, value) VALUES (?, 'revision', ?)
               ON CONFLICT(namespace, key) DO UPDATE SET value=excluded.value""",
            (SETTINGS_NAMESPACE, str(revision)),
        )
    return {"pluginId": plugin_id, "revision": revision, "settings": values}
