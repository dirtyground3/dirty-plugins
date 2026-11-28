"""Read the settings definitions supplied by installed Dirty plugin packages."""

from __future__ import annotations

import json
import os
from pathlib import Path

from dirty_plugins_client import StashClient


def installed_settings_definitions(connection: dict, plugin_ids: set[str]) -> dict:
    plugins_root = Path(__file__).resolve().parents[1]
    if connection:
        try:
            data = StashClient(connection, timeout=5).call("{configuration{general{pluginsPath}}}")
            general = data["configuration"]["general"]
        except (RuntimeError, KeyError, TypeError):
            general = {}
        if general.get("pluginsPath"):
            plugins_root = Path(general["pluginsPath"]).resolve()
    return read_settings_definitions(plugins_root, plugin_ids)


def read_settings_definitions(plugins_root: Path, plugin_ids: set[str]) -> dict:
    plugins_root = plugins_root.resolve()
    manifests = {plugin_id + ".yml": plugin_id for plugin_id in plugin_ids}
    packages: dict[str, list[Path]] = {}
    # Package sources and manual installs can put manifests in subdirectories.
    for directory, _, files in os.walk(plugins_root):
        for filename in manifests.keys() & set(files):
            packages.setdefault(manifests[filename], []).append(Path(directory))

    definitions = {}
    for plugin_id, directories in packages.items():
        if len(directories) != 1:
            continue
        directory = directories[0]
        try:
            file = directory / "settings-definition.json"
            resolved = file.resolve()
            if not resolved.is_relative_to(plugins_root) or resolved.parent != directory.resolve() or not file.is_file():
                continue
            definition = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, ValueError, RuntimeError):
            continue
        if isinstance(definition, dict) and definition.get("pluginId") == plugin_id:
            definitions[plugin_id] = definition
    return definitions
