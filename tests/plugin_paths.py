"""Separate authored-source contract paths from staged runtime/backend paths."""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Backend protocol tests launch Python children; -B on discovery is not inherited.
sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
_registry = json.loads((ROOT / "scripts/plugin-registry.json").read_text(encoding="utf-8"))
_directories = {item["directory"] for item in _registry}


def require_build():
    missing = [item["directory"] for item in _registry
               if not (ROOT / ".build/plugins" / item["directory"] / (item["id"] + ".yml")).exists()]
    if missing:
        raise RuntimeError("Missing staged plugins (" + ", ".join(missing) + "). Run `npm run build` first.")


def _path(base, plugin, file):
    if plugin not in _directories:
        raise ValueError("Unknown plugin directory: " + plugin)
    return base / plugin / file


def source_path(plugin, file=""):
    return _path(ROOT / "plugins", plugin, file)


def runtime_path(plugin, file=""):
    require_build()
    path = _path(ROOT / ".build/plugins", plugin, file)
    if not path.exists():
        raise RuntimeError("Missing staged runtime file: " + str(path) + ". Run `npm run build`.")
    return path
