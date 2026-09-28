"""Destination naming and collision rules for DirtyFileExtractor."""
from __future__ import annotations

import os
import re
from pathlib import Path

INVALID_FOLDER_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')

def sanitize_folder_name(
    title: str | None,
    item_id: str,
    item_kind: str = "scene",
) -> str:
    name = INVALID_FOLDER_CHARS.sub("_", (title or "").strip())
    name = re.sub(r"\s+", " ", name).strip(" .")
    if not name:
        name = f"{item_kind}-{item_id}"
    # Leave room for paths on systems where long path support is disabled.
    return name[:120].rstrip(" .") or f"{item_kind}-{item_id}"


def destination_key(path: Path) -> str:
    """Return a case-insensitive identity for a destination path."""
    return os.path.normcase(os.path.abspath(str(path)))


def renamed_destination(path: Path, planned: set[str] | None = None) -> Path:
    """Return path or the first free `name (N).ext` sibling."""
    planned = planned or set()
    if not path.exists() and destination_key(path) not in planned:
        return path
    stem, suffix = path.stem, path.suffix
    index = 2
    while True:
        candidate = path.with_name(f"{stem} ({index}){suffix}")
        if not candidate.exists() and destination_key(candidate) not in planned:
            return candidate
        index += 1


def resolve_destination(
    source: Path,
    requested: Path,
    policy: str,
    planned: set[str] | None = None,
) -> tuple[Path, str]:
    """Resolve a collision and return (destination, action)."""
    try:
        if requested.exists() and source.samefile(requested):
            return requested, "same-file"
    except OSError:
        pass

    occupied = requested.exists() or destination_key(requested) in (planned or set())
    if not occupied:
        return requested, "copy"
    if policy == "skip":
        return requested, "skip"
    if policy == "overwrite":
        return requested, "overwrite"
    return renamed_destination(requested, planned), "rename"


def resolve_generated_destination(
    requested: Path,
    policy: str,
    planned: set[str] | None = None,
) -> tuple[Path, str]:
    """Resolve a collision for generated media without a local source path."""
    occupied = requested.exists() or destination_key(requested) in (planned or set())
    if not occupied:
        return requested, "extract"
    if policy == "skip":
        return requested, "skip"
    if policy == "overwrite":
        return requested, "overwrite"
    return renamed_destination(requested, planned), "rename"


def reserve_destination(path: Path) -> bool:
    """Atomically claim an unused destination name across processes."""
    try:
        with path.open("xb"):
            return True
    except FileExistsError:
        return False


def marker_clip_basename(
    source_basename: str,
    marker_title: str | None,
    marker_id: str,
) -> str:
    source_stem = Path(source_basename).stem.strip() or "scene"
    marker_name = INVALID_FOLDER_CHARS.sub("_", (marker_title or "").strip())
    marker_name = re.sub(r"\s+", " ", marker_name).strip(" .")
    if not marker_name:
        marker_name = "marker"
    suffix = ".mp4"
    stem = f"{source_stem} - {marker_name} [marker-{marker_id}]"
    stem = stem[: max(1, 220 - len(suffix))].rstrip(" .")
    return (stem or f"marker-{marker_id}") + suffix


def format_bytes(value: int) -> str:
    size = float(max(value, 0))
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if size < 1024 or unit == "TiB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return f"{size:.1f} TiB"
