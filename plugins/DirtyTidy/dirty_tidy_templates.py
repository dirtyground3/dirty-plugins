"""Template variables, filename sanitation, and source path rules for DirtyTidy."""
from __future__ import annotations

import os
import re
import unicodedata
from pathlib import Path
from typing import Any, Iterable

UNKNOWN_VALUE = "Unknown"
VARIABLE_NAMES = {
    "title",
    "scene_id",
    "stash_id",
    "date",
    "year",
    "month",
    "day",
    "rating",
    "grade",
    "rating_bucket",
    "organized",
    "performers",
    "first_performer",
    "female_performers",
    "females_performers",
    "male_performers",
    "first_female_performer",
    "first_male_performer",
    "performer_count",
    "studio",
    "parent_studio",
    "tags",
    "first_tag",
    "group",
    "group_position",
    "resolution",
    "height",
    "video_codec",
    "duration",
    "duration_bucket",
    "source",
    "original_name",
    "extension",
}
TOKEN_PATTERN = re.compile(r"\{([a-z][a-z0-9_]*)\}", re.IGNORECASE)
INVALID_PATH_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
RESERVED_WINDOWS_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
}

def _clean_text(value: Any) -> str:
    if value is None:
        return UNKNOWN_VALUE
    text = unicodedata.normalize("NFC", str(value)).strip()
    return text or UNKNOWN_VALUE


def _names(items: Any) -> list[str]:
    if not isinstance(items, list):
        return []
    result = [_clean_text(item.get("name")) for item in items if isinstance(item, dict)]
    return sorted({value for value in result if value != UNKNOWN_VALUE}, key=str.casefold)


def _stash_ids(items: Any) -> list[str]:
    if not isinstance(items, list):
        return []
    values = [
        str(item.get("stash_id") or "").strip()
        for item in items
        if isinstance(item, dict)
    ]
    return sorted({value for value in values if value}, key=str.casefold)


def _date_parts(value: Any) -> tuple[str, str, str, str]:
    text = str(value or "").strip()
    match = re.match(r"^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?", text)
    if not match:
        return UNKNOWN_VALUE, UNKNOWN_VALUE, UNKNOWN_VALUE, UNKNOWN_VALUE
    year, month, day = match.groups()
    return text, year or UNKNOWN_VALUE, month or UNKNOWN_VALUE, day or UNKNOWN_VALUE


def _rating_bucket(value: Any) -> str:
    try:
        rating = max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return UNKNOWN_VALUE
    if rating >= 90:
        return "90-100"
    lower = (rating // 10) * 10
    return f"{lower}-{lower + 9}"


def _grade(value: Any) -> str:
    try:
        rating = max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return UNKNOWN_VALUE
    if rating >= 90:
        return "A"
    if rating >= 80:
        return "B"
    if rating >= 70:
        return "C"
    if rating >= 60:
        return "D"
    if rating >= 50:
        return "E"
    return "F"


def _resolution(height: Any) -> str:
    try:
        pixels = int(height)
    except (TypeError, ValueError):
        return UNKNOWN_VALUE
    if pixels >= 2160:
        return "4K"
    if pixels >= 1440:
        return "1440p"
    if pixels >= 1080:
        return "1080p"
    if pixels >= 720:
        return "720p"
    if pixels >= 480:
        return "480p"
    return f"{pixels}p" if pixels > 0 else UNKNOWN_VALUE


def _duration_bucket(value: Any) -> str:
    try:
        minutes = float(value) / 60
    except (TypeError, ValueError):
        return UNKNOWN_VALUE
    if minutes < 10:
        return "Under 10m"
    if minutes < 30:
        return "10-30m"
    if minutes < 60:
        return "30-60m"
    return "60m+"


def scene_variables(
    scene: dict[str, Any],
    file_info: dict[str, Any],
    source_root: str,
    separator: str,
) -> dict[str, str]:
    date, year, month, day = _date_parts(scene.get("date"))
    performer_items = scene.get("performers") if isinstance(scene.get("performers"), list) else []
    performers = _names(performer_items)
    female_performers = _names([
        item
        for item in performer_items
        if isinstance(item, dict) and str(item.get("gender") or "").upper() == "FEMALE"
    ])
    male_performers = _names([
        item
        for item in performer_items
        if isinstance(item, dict) and str(item.get("gender") or "").upper() == "MALE"
    ])
    tags = _names(scene.get("tags"))
    studio = scene.get("studio") if isinstance(scene.get("studio"), dict) else {}
    parent_studio = studio.get("parent_studio") if isinstance(studio.get("parent_studio"), dict) else {}
    parent_studio_name = parent_studio.get("name") or studio.get("name")
    groups = scene.get("groups") if isinstance(scene.get("groups"), list) else []
    groups = [item for item in groups if isinstance(item, dict)]
    groups.sort(key=lambda item: (item.get("scene_index") is None, item.get("scene_index") or 0))
    primary_group = groups[0] if groups else {}
    group_value = primary_group.get("group") if isinstance(primary_group.get("group"), dict) else {}
    basename = str(file_info.get("basename") or Path(str(file_info.get("path") or "")).name)
    extension = Path(basename).suffix
    original_name = basename[: -len(extension)] if extension else basename
    try:
        duration_minutes = str(max(0, round(float(file_info.get("duration")) / 60)))
    except (TypeError, ValueError):
        duration_minutes = UNKNOWN_VALUE
    rating = scene.get("rating100")
    stash_ids = _stash_ids(scene.get("stash_ids"))
    return {
        "title": _clean_text(scene.get("title")),
        "scene_id": _clean_text(scene.get("id")),
        "stash_id": stash_ids[0] if stash_ids else UNKNOWN_VALUE,
        "date": date,
        "year": year,
        "month": month,
        "day": day,
        "rating": _clean_text(rating),
        "grade": _grade(rating),
        "rating_bucket": _rating_bucket(rating),
        "organized": "Organized" if scene.get("organized") else "Unorganized",
        "performers": separator.join(performers) if performers else UNKNOWN_VALUE,
        "first_performer": performers[0] if performers else UNKNOWN_VALUE,
        "female_performers": separator.join(female_performers) if female_performers else UNKNOWN_VALUE,
        "females_performers": separator.join(female_performers) if female_performers else UNKNOWN_VALUE,
        "male_performers": separator.join(male_performers) if male_performers else UNKNOWN_VALUE,
        "first_female_performer": female_performers[0] if female_performers else UNKNOWN_VALUE,
        "first_male_performer": male_performers[0] if male_performers else UNKNOWN_VALUE,
        "performer_count": str(len(performers)),
        "studio": _clean_text(studio.get("name")),
        "parent_studio": _clean_text(parent_studio_name),
        "tags": separator.join(tags) if tags else UNKNOWN_VALUE,
        "first_tag": tags[0] if tags else UNKNOWN_VALUE,
        "group": _clean_text(group_value.get("name")),
        "group_position": _clean_text(primary_group.get("scene_index")),
        "resolution": _resolution(file_info.get("height")),
        "height": _clean_text(file_info.get("height")),
        "video_codec": _clean_text(file_info.get("video_codec")),
        "duration": duration_minutes,
        "duration_bucket": _duration_bucket(file_info.get("duration")),
        "source": _clean_text(Path(source_root).name),
        "original_name": _clean_text(original_name),
        "extension": extension.lstrip(".") or UNKNOWN_VALUE,
    }


def _render_template(
    template: str,
    variables: dict[str, str],
    missing_replacement: str,
) -> tuple[str, list[str], list[str]]:
    missing: set[str] = set()
    invalid: set[str] = set()

    def replace(match: re.Match[str]) -> str:
        name = match.group(1).lower()
        if name not in VARIABLE_NAMES:
            invalid.add(name)
            return UNKNOWN_VALUE
        value = variables.get(name, UNKNOWN_VALUE)
        if value == UNKNOWN_VALUE:
            missing.add(name)
            return missing_replacement
        return value

    return TOKEN_PATTERN.sub(replace, str(template)), sorted(missing), sorted(invalid)


def render_template(template: str, variables: dict[str, str]) -> tuple[str, list[str], list[str]]:
    return _render_template(template, variables, UNKNOWN_VALUE)


def _clean_rename_separators(value: str) -> str:
    value = re.sub(r"\(\s*\)|\[\s*\]|\{\s*\}", "", value)
    separators = ("-", "–", "—", "|", ",", ";", "·", "_", ".")
    for separator in separators:
        def collapse(match: re.Match[str], current: str = separator) -> str:
            if current in {"_", "."}:
                return current
            return f" {current} " if any(char.isspace() for char in match.group(0)) else current

        value = re.sub(
            rf"(?:\s*{re.escape(separator)}\s*){{2,}}",
            collapse,
            value,
        )
    value = re.sub(r"^[\s\-–—_|,;·.]+|[\s\-–—_|,;·.]+$", "", value)
    return re.sub(r"\s+", " ", value).strip()


def render_rename_template(
    template: str,
    variables: dict[str, str],
) -> tuple[str, list[str], list[str]]:
    rendered, missing, invalid = _render_template(template, variables, "")
    return _clean_rename_separators(rendered), missing, invalid


def template_variable_names(template: str) -> list[str]:
    """Return valid variable names used by a template, preserving first use order."""
    names: list[str] = []
    for match in TOKEN_PATTERN.finditer(str(template)):
        name = match.group(1).lower()
        if name in VARIABLE_NAMES and name not in names:
            names.append(name)
    return names


def sanitize_segment(value: str) -> str:
    value = unicodedata.normalize("NFC", value)
    value = INVALID_PATH_CHARS.sub("", value)
    value = re.sub(r"\s+", " ", value).strip().rstrip(". ")
    if not value or value in {".", ".."}:
        return UNKNOWN_VALUE
    return value[:240].rstrip(". ") or UNKNOWN_VALUE


def sanitize_filename(rendered: str, extension: str, max_length: int) -> tuple[str, str | None]:
    stem = sanitize_segment(rendered)
    extension = extension if extension.startswith(".") or not extension else f".{extension}"
    available = max_length - len(extension)
    if available < 1:
        return "", "The maximum filename length is too short for the file extension."
    stem = stem[:available].rstrip(". ")
    if not stem:
        return "", "The rendered filename is empty after sanitization."
    if stem.upper() in RESERVED_WINDOWS_NAMES:
        return "", f"{stem} is a reserved filename."
    return stem + extension, None


def _normalized_path(path: str) -> str:
    return os.path.normcase(os.path.realpath(os.path.abspath(os.path.normpath(path))))


def path_is_within(path: str, root: str) -> bool:
    try:
        return os.path.commonpath([_normalized_path(path), _normalized_path(root)]) == _normalized_path(root)
    except ValueError:
        return False


def find_source_root(path: str, roots: Iterable[str]) -> str | None:
    candidates = [root for root in roots if root and path_is_within(path, root)]
    if not candidates:
        return None
    return max(candidates, key=lambda value: len(_normalized_path(value)))
