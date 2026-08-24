"""Backend API for shared Dirty Plugins settings and database maintenance."""

from __future__ import annotations

import json
import sys
from typing import Any

import dirty_plugins_storage as storage


MANAGED_PLUGIN_IDS = {"extractScenes", "multiscreen", "dirtyTidy", "dirtyRank"}


class PluginError(RuntimeError):
    pass


def run(payload: dict[str, Any]) -> dict[str, Any]:
    args = payload.get("args") or {}
    if not isinstance(args, dict):
        raise PluginError("Plugin arguments must be an object")
    mode = str(args.get("mode") or "getAllSettings")
    if mode == "getAllSettings":
        return storage.get_all_plugin_settings()
    if mode == "getSettings":
        plugin_id = str(args.get("pluginId") or "")
        if plugin_id not in MANAGED_PLUGIN_IDS:
            raise PluginError(f"Unsupported Dirty plugin: {plugin_id}")
        return {"pluginId": plugin_id, "settings": storage.get_plugin_settings(plugin_id)}
    if mode == "setSettings":
        plugin_id = str(args.get("pluginId") or "")
        if plugin_id not in MANAGED_PLUGIN_IDS:
            raise PluginError(f"Unsupported Dirty plugin: {plugin_id}")
        values = args.get("settings")
        if not isinstance(values, dict):
            raise PluginError("Settings must be an object")
        return storage.set_plugin_settings(plugin_id, values)
    if mode == "backupDatabase":
        return {"path": str(storage.backup_database())}
    raise PluginError(f"Unsupported DirtyPlugins operation mode: {mode}")


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        output = run(payload)
        json.dump({"output": json.dumps(output, ensure_ascii=False)}, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    except Exception as exc:
        json.dump({"error": str(exc)}, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
