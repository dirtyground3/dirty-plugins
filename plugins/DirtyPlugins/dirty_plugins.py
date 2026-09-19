"""Backend API for shared Dirty Plugins settings and database maintenance."""

from __future__ import annotations

import json
import sys
import time
from typing import Any

import dirty_plugins_storage as storage


MANAGED_PLUGIN_IDS = {"extractScenes", "multiscreen", "dirtyTidy", "dirtyRank", "dirtyStats"}


class PluginError(RuntimeError):
    pass


class StashReporter:
    """Write Stash's encoded log protocol to stderr.

    Stash logs these as ``[Plugin / DirtyPlugins]`` at the requested level.
    """

    @staticmethod
    def _write(level: str, message: Any) -> None:
        for line in str(message).splitlines() or [""]:
            print(f"\x01{level}\x02{line}", file=sys.stderr, flush=True)

    def info(self, message: str) -> None:
        self._write("i", message)

    def error(self, message: str) -> None:
        self._write("e", message)


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
    reporter = StashReporter()
    started = time.monotonic()
    mode = "unknown"
    try:
        payload = json.load(sys.stdin)
        mode = _requested_mode(payload)
        reporter.info(f"DirtyPlugins backend started: mode={mode}")
        output = run(payload)
        reporter.info(
            f"DirtyPlugins backend finished: mode={mode} in {_elapsed_ms(started)}ms"
        )
        json.dump({"output": json.dumps(output, ensure_ascii=False)}, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    except Exception as exc:
        reporter.error(
            f"DirtyPlugins backend failed: mode={mode} after {_elapsed_ms(started)}ms: {exc}"
        )
        json.dump({"error": str(exc)}, sys.stdout, ensure_ascii=False)
        sys.stdout.write("\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
