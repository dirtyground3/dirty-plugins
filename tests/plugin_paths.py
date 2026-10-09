"""Separate authored-source contract paths from staged runtime/backend paths."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
# Backend protocol tests launch Python children; -B on discovery is not inherited.
sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
_checked = False
# Tests and packages use release staging; opt-in map checks switch to development.
_mode = "release"
_directories = {item["directory"] for item in json.loads(
    (ROOT / "scripts/plugin-registry.json").read_text(encoding="utf-8"))}


def use_build_mode(mode):
    global _checked, _mode
    if mode not in ("release", "development"):
        raise ValueError("Unknown build mode: " + mode)
    _mode, _checked = mode, False


def build_mode():
    return _mode


def require_build():
    global _checked
    if _checked:
        return
    result = subprocess.run(
        ["node", "-e", "require('./scripts/build-lib.cjs').requireBuild(process.argv[1])", _mode],
        cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        command = "npm run build" if _mode == "release" else "npm run build:dev"
        raise RuntimeError("Missing or stale staged plugins. Run `" + command + "` before direct tests.\n" + result.stderr)
    _checked = True


def _path(base, plugin, file):
    if plugin not in _directories:
        raise ValueError("Unknown plugin directory: " + plugin)
    if file and ("\\" in file or Path(file).is_absolute() or any(part in ("", ".", "..") for part in file.split("/"))):
        raise ValueError("Unsafe plugin file: " + file)
    return base / plugin / file


def source_path(plugin, file=""):
    return _path(ROOT / "plugins", plugin, file)


def runtime_path(plugin, file=""):
    require_build()
    path = _path(ROOT / ".build/plugins", plugin, file)
    if not path.exists():
        raise RuntimeError("Missing staged runtime file: " + str(path) + ". Run `npm run build`.")
    return path
