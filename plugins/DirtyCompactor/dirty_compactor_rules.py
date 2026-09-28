"""Rule validation, file identity, and resize calculations for DirtyCompactor."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

ENCODERS = {"h264": {"cpu": "libx264", "nvenc": "h264_nvenc", "qsv": "h264_qsv", "amf": "h264_amf"},
            "hevc": {"cpu": "libx265", "nvenc": "hevc_nvenc", "qsv": "hevc_qsv", "amf": "hevc_amf"}}


class PluginError(RuntimeError):
    pass


class Cancelled(PluginError):
    pass


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def file_hash(path):
    result = hashlib.sha256()
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(4 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def identity(path):
    path = Path(path)
    if path.is_symlink() or any(parent.is_symlink() for parent in path.parents):
        raise PluginError("Symbolic links are not supported")
    info = path.stat()
    if not path.is_file() or info.st_nlink != 1:
        raise PluginError("Only unshared regular files are supported")
    return {"size": info.st_size, "mtime": info.st_mtime_ns, "device": info.st_dev, "inode": info.st_ino}


def validate_settings(value):
    if not isinstance(value, dict) or not isinstance(value.get("rules", []), list):
        raise PluginError("Rules must be a list")
    if value.get("schemaVersion", 1) != 1:
        raise PluginError("Unsupported rule schema version")
    ids = set()
    rules = []
    for rule in value.get("rules", []):
        if not isinstance(rule, dict) or not rule.get("id") or rule["id"] in ids:
            raise PluginError("Each rule needs a unique ID")
        ids.add(rule["id"])
        if rule.get("mode") not in ("manual", "automatic") or rule.get("action") not in ("resize", "reencode", "delete"):
            raise PluginError("Invalid rule mode or action")
        condition = rule.get("condition") or {}
        if not isinstance(condition.get("scene", {}), dict) or not isinstance(condition.get("find", {}), dict):
            raise PluginError("Invalid native scene filter")
        if rule.get("enabled"):
            if not str(rule.get("name", "")).strip():
                raise PluginError("Enabled rules need a name")
            if not condition.get("all") and not condition.get("scene") and not condition.get("find", {}).get("q"):
                raise PluginError("Choose a scene filter or explicitly select All scenes")
        if rule["action"] != "delete":
            if rule.get("codec") not in ENCODERS or rule.get("encoder") not in ("auto", "cpu", "nvenc", "qsv", "amf"):
                raise PluginError("Invalid codec or encoder")
            if rule.get("format") not in ("keep", "allow"):
                raise PluginError("Invalid format policy")
            try:
                rate = float(rule.get("mbps", 0))
                sizes = [float(rule.get(key, 0)) for key in ("width", "height")] if rule["action"] == "resize" else [2, 2]
            except (ValueError, TypeError):
                raise PluginError("Enter valid bitrate and dimensions")
            if not math.isfinite(rate) or not 0.05 <= rate <= 1000 or any(not math.isfinite(v) or not 2 <= v <= 16384 or v != int(v) for v in sizes):
                raise PluginError("Bitrate must be 0.05–1000 Mbps; dimensions must be 2–16384")
        rules.append(rule)
    return {"schemaVersion": 1, "rules": rules, "automationPaused": bool(value.get("automationPaused", True))}


def dimensions(width, height, rule):
    if rule["action"] != "resize":
        return width, height
    bw, bh = int(rule["width"]), int(rule["height"])
    if height > width and bw > bh:
        bw, bh = bh, bw
    factor = min(1, bw / width, bh / height)
    if factor == 1:
        return width, height
    return max(2, int(width * factor) // 2 * 2), max(2, int(height * factor) // 2 * 2)
