"""Rule validation, file identity, and resize calculations for DirtyCompactor."""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

ENCODERS = {"h264": {"cpu": "libx264", "nvenc": "h264_nvenc", "qsv": "h264_qsv", "amf": "h264_amf"},
            "hevc": {"cpu": "libx265", "nvenc": "hevc_nvenc", "qsv": "hevc_qsv", "amf": "hevc_amf"}}
# Video Mbps for a 1080p, 30 fps output. Other outputs scale by pixel count
# (sub-linearly) and frame rate, so one preset suits a mixed library.
QUALITY_MBPS_1080P = {"h264": {"high": 8, "balanced": 5, "small": 3},
                      "hevc": {"high": 5, "balanced": 3, "small": 1.8}}
QUALITIES = ("high", "balanced", "small", "custom")


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
            if rule.get("quality", "custom") not in QUALITIES:
                raise PluginError("Invalid quality preset")
            try:
                rate = float(rule.get("mbps", 0)) if rule.get("quality", "custom") == "custom" else 1
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


def target_mbps(rule, width, height, fps=None):
    """Return the video bitrate for one output; rules without a preset use their custom Mbps."""
    quality = rule.get("quality", "custom")
    if quality == "custom":
        return float(rule["mbps"])
    pixels = max(1, width * height) / (1920 * 1080)
    motion = max(1, min(float(fps or 30), 120) / 30) ** 0.5
    return round(max(0.2, QUALITY_MBPS_1080P[rule["codec"]][quality] * pixels ** 0.75 * motion), 2)
