"""Backend API for shared Dirty Plugins settings and database maintenance."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dirty_plugins_storage as storage


MANAGED_PLUGIN_IDS = {"dirtyPlugins", "extractScenes", "multiscreen", "dirtyTidy", "dirtyRank", "dirtyStats", "dirtyCompactor", "dirtyCaptions"}


from dirty_plugins_protocol import StashReporter
import dirty_plugins_protocol as protocol


class PluginError(RuntimeError):
    pass




def _elapsed_ms(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


def _requested_mode(payload: Any) -> str:
    args = payload.get("args") if isinstance(payload, dict) else None
    if isinstance(args, dict):
        return str(args.get("mode") or "getAllSettings")
    return "unknown"


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
        snapshot = storage.get_plugin_settings_snapshot(plugin_id)
        return {
            "pluginId": plugin_id,
            "revision": snapshot["revision"],
            "settings": snapshot["settings"],
        }
    if mode == "setSettings":
        plugin_id = str(args.get("pluginId") or "")
        if plugin_id not in MANAGED_PLUGIN_IDS:
            raise PluginError(f"Unsupported Dirty plugin: {plugin_id}")
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
    protocol.configure_standard_streams()
    reporter = StashReporter()
    started = time.monotonic()
    mode = "unknown"
    try:
        payload = protocol.read_payload()
        mode = _requested_mode(payload)
        reporter.info(f"DirtyPlugins backend started: mode={mode}")
        output = run(payload)
        reporter.info(
            f"DirtyPlugins backend finished: mode={mode} in {_elapsed_ms(started)}ms"
        )
        protocol.emit_output(output, nested=True, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    except Exception as exc:
        reporter.error(
            f"DirtyPlugins backend failed: mode={mode} after {_elapsed_ms(started)}ms: {exc}"
        )
        protocol.emit_error(exc, ensure_ascii=False)
        sys.stdout.write("\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
