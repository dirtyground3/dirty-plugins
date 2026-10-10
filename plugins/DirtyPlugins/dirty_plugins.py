"""Backend API for shared Dirty Plugins settings and database maintenance."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dirty_plugins_protocol as protocol
import dirty_plugins_storage as storage
from dirty_plugins_metadata import CONSTANTS


MANAGED_PLUGIN_IDS = set(CONSTANTS["managedPluginIds"])


class PluginError(RuntimeError):
    pass


def _managed_plugin_id(args: dict[str, Any]) -> str:
    plugin_id = str(args.get("pluginId") or "")
    if plugin_id not in MANAGED_PLUGIN_IDS:
        raise PluginError(f"Unsupported Dirty plugin: {plugin_id}")
    return plugin_id


def run(payload: dict[str, Any]) -> dict[str, Any]:
    args = payload.get("args") or {}
    if not isinstance(args, dict):
        raise PluginError("Plugin arguments must be an object")
    mode = str(args.get("mode") or "getAllSettings")
    if mode == "getAllSettings":
        return storage.get_all_plugin_settings()
    if mode == "getSettings":
        plugin_id = _managed_plugin_id(args)
        return {"pluginId": plugin_id, **storage.get_plugin_settings_snapshot(plugin_id)}
    if mode == "setSettings":
        plugin_id = _managed_plugin_id(args)
        values = args.get("settings")
        if not isinstance(values, dict):
            raise PluginError("Settings must be an object")
        expected_revision = args.get("expectedRevision")
        if expected_revision is not None:
            try:
                expected_revision = int(expected_revision)
            except (TypeError, ValueError):
                raise PluginError("expectedRevision must be an integer")
        try:
            return storage.set_plugin_settings(
                plugin_id, values, expected_revision=expected_revision
            )
        except storage.SettingsRevisionConflict as conflict:
            raise PluginError(str(conflict))
    if mode == "backupDatabase":
        return {"path": str(storage.backup_database())}
    raise PluginError(f"Unsupported DirtyPlugins operation mode: {mode}")


def main() -> int:
    return protocol.serve("DirtyPlugins", lambda payload, _reporter: run(payload), default_mode="getAllSettings")


if __name__ == "__main__":
    raise SystemExit(main())
