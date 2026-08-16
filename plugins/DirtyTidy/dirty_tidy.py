#!/usr/bin/env python3
"""Plan and execute safe file organization for the DirtyTidy Stash plugin."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import urllib.error
import urllib.request
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable


PLUGIN_ID = "dirtyTidy"
UNKNOWN_VALUE = "Unknown"
DEFAULT_SETTINGS = {
    "moveEnabled": True,
    "hierarchyLevels": ["{studio}", "{year}"],
    "renameEnabled": False,
    "renamePattern": "{date} - {studio} - {title}",
    "maxFilenameLength": 180,
    "multiValueSeparator": ", ",
    "automationMode": "manual",
    "approvedStrategyHash": "",
}
AUTOMATION_MODES = {"manual", "scan", "generate"}
STRATEGY_SETTING_KEYS = (
    "moveEnabled",
    "hierarchyLevels",
    "renameEnabled",
    "renamePattern",
    "maxFilenameLength",
    "multiValueSeparator",
)
VARIABLE_NAMES = {
    "title",
    "scene_id",
    "date",
    "year",
    "month",
    "day",
    "rating",
    "rating_bucket",
    "organized",
    "performers",
    "first_performer",
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
MAX_PAGE_SIZE = 200
SCENE_QUERY_PAGE_SIZE = 100
PREVIEW_STATUSES = {"ready", "warning", "blocked", "unchanged"}


class PluginError(RuntimeError):
    """An error that should be shown cleanly in Stash."""


class Reporter:
    def info(self, _message: str) -> None:
        pass

    def error(self, _message: str) -> None:
        pass

    def progress(self, _value: float) -> None:
        pass


class StashReporter(Reporter):
    @staticmethod
    def _write(level: str, message: Any) -> None:
        for line in str(message).splitlines() or [""]:
            print(f"\x01{level}\x02{line}", file=sys.stderr, flush=True)

    def info(self, message: str) -> None:
        self._write("i", message)

    def error(self, message: str) -> None:
        self._write("e", message)

    def progress(self, value: float) -> None:
        self._write("p", str(min(max(float(value), 0.0), 1.0)))


class StashClient:
    def __init__(self, server_connection: dict[str, Any]):
        scheme = server_connection.get("Scheme") or "http"
        host = server_connection.get("Host") or "127.0.0.1"
        if host in {"", "0.0.0.0", "::", None}:
            host = "127.0.0.1"
        port = int(server_connection.get("Port") or 9999)
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"

        self.url = f"{scheme}://{host}:{port}/graphql"
        self.headers = {"Content-Type": "application/json"}
        cookie = server_connection.get("SessionCookie") or {}
        if cookie.get("Name") and cookie.get("Value"):
            self.headers["Cookie"] = f'{cookie["Name"]}={cookie["Value"]}'
        if server_connection.get("ApiKey"):
            self.headers["ApiKey"] = str(server_connection["ApiKey"])

    def call(
        self,
        query: str,
        variables: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        body = json.dumps(
            {"query": query, "variables": variables or {}},
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(self.url, data=body, headers=self.headers)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                result = json.load(response)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise PluginError(f"Could not contact Stash GraphQL: {exc}") from exc

        errors = result.get("errors") or []
        if errors:
            message = "; ".join(str(error.get("message", error)) for error in errors)
            raise PluginError(f"Stash GraphQL returned an error: {message}")
        return result.get("data") or {}

    def plugin_settings(self) -> dict[str, Any]:
        data = self.call(
            """
            query DirtyTidySettings($ids: [ID!]) {
              configuration { plugins(include: $ids) }
            }
            """,
            {"ids": [PLUGIN_ID]},
        )
        plugins = (data.get("configuration") or {}).get("plugins") or {}
        settings = plugins.get(PLUGIN_ID) or {}
        return settings if isinstance(settings, dict) else {}

    def library_snapshot(self) -> tuple[list[str], list[dict[str, Any]]]:
        query = """
          query DirtyTidyScenes($filter: FindFilterType) {
            configuration { general { stashes { path excludeVideo } } }
            findScenes(filter: $filter) {
              count
              scenes {
                id title date rating100 organized
                studio { name parent_studio { name } }
                performers { name gender }
                tags { name }
                groups { scene_index group { name } }
                files {
                  id path basename duration width height video_codec
                }
              }
            }
          }
        """
        scenes: list[dict[str, Any]] = []
        roots: list[str] = []
        page = 1
        total = None
        while total is None or len(scenes) < total:
            data = self.call(
                query,
                {
                    "filter": {
                        "page": page,
                        "per_page": SCENE_QUERY_PAGE_SIZE,
                        "sort": "id",
                        "direction": "ASC",
                    }
                },
            )
            if not roots:
                stashes = ((data.get("configuration") or {}).get("general") or {}).get("stashes") or []
                roots = [str(stash.get("path") or "") for stash in stashes if stash.get("path")]
            result = data.get("findScenes") or {}
            batch = result.get("scenes") or []
            total = int(result.get("count") or 0)
            scenes.extend(batch)
            if not batch:
                break
            page += 1
        return roots, scenes

    def move_file(self, operation: dict[str, Any]) -> bool:
        input_value: dict[str, Any] = {
            "ids": [str(operation["file_id"])],
            "destination_folder": operation["destination_folder"],
        }
        if operation["destination_basename"] != operation["source_basename"]:
            input_value["destination_basename"] = operation["destination_basename"]
        data = self.call(
            """
            mutation DirtyTidyMove($input: MoveFilesInput!) {
              moveFiles(input: $input)
            }
            """,
            {"input": input_value},
        )
        return bool(data.get("moveFiles"))


def read_payload(stream: Any = sys.stdin) -> dict[str, Any]:
    raw = stream.read()
    if not raw.strip():
        raise PluginError("Stash did not provide plugin input")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PluginError(f"Invalid plugin input: {exc}") from exc
    if not isinstance(payload, dict):
        raise PluginError("Plugin input must be a JSON object")
    return payload


def emit_output(output: Any, stream: Any = sys.stdout) -> None:
    json.dump({"output": output}, stream, ensure_ascii=False)


def emit_error(error: Any, stream: Any = sys.stdout) -> None:
    json.dump({"error": str(error)}, stream, ensure_ascii=False)


def as_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on"}:
            return True
        if normalized in {"false", "0", "no", "off"}:
            return False
    if value is None:
        return default
    return bool(value)


def _parse_levels(value: Any) -> list[str]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = [value]
        value = parsed
    if not isinstance(value, list):
        return list(DEFAULT_SETTINGS["hierarchyLevels"])
    levels: list[str] = []
    for item in value:
        template = item.get("template") if isinstance(item, dict) else item
        template = str(template or "").strip()
        if template:
            levels.append(template)
    return levels


def normalize_settings(raw: Any) -> dict[str, Any]:
    source = raw if isinstance(raw, dict) else {}
    try:
        max_length = int(source.get("maxFilenameLength", DEFAULT_SETTINGS["maxFilenameLength"]))
    except (TypeError, ValueError):
        max_length = int(DEFAULT_SETTINGS["maxFilenameLength"])
    separator = str(source.get("multiValueSeparator", DEFAULT_SETTINGS["multiValueSeparator"]))
    if not separator:
        separator = str(DEFAULT_SETTINGS["multiValueSeparator"])
    automation_mode = str(source.get("automationMode") or "manual").strip().lower()
    if automation_mode not in AUTOMATION_MODES:
        automation_mode = "manual"
    approved_hash = str(source.get("approvedStrategyHash") or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", approved_hash):
        approved_hash = ""
    return {
        "moveEnabled": as_bool(source.get("moveEnabled"), True),
        "hierarchyLevels": _parse_levels(source.get("hierarchyLevels", DEFAULT_SETTINGS["hierarchyLevels"])),
        "renameEnabled": as_bool(source.get("renameEnabled"), False),
        "renamePattern": str(source.get("renamePattern", DEFAULT_SETTINGS["renamePattern"]) or "").strip(),
        "maxFilenameLength": max(16, min(255, max_length)),
        "multiValueSeparator": separator[:10],
        "automationMode": automation_mode,
        "approvedStrategyHash": approved_hash,
    }


def strategy_hash(settings: dict[str, Any]) -> str:
    normalized = normalize_settings(settings)
    strategy = {key: normalized[key] for key in STRATEGY_SETTING_KEYS}
    encoded = json.dumps(strategy, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


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
    return {
        "title": _clean_text(scene.get("title")),
        "scene_id": _clean_text(scene.get("id")),
        "date": date,
        "year": year,
        "month": month,
        "day": day,
        "rating": _clean_text(rating),
        "rating_bucket": _rating_bucket(rating),
        "organized": "Organized" if scene.get("organized") else "Unorganized",
        "performers": separator.join(performers) if performers else UNKNOWN_VALUE,
        "first_performer": performers[0] if performers else UNKNOWN_VALUE,
        "first_female_performer": female_performers[0] if female_performers else UNKNOWN_VALUE,
        "first_male_performer": male_performers[0] if male_performers else UNKNOWN_VALUE,
        "performer_count": str(len(performers)),
        "studio": _clean_text(studio.get("name")),
        "parent_studio": _clean_text(parent_studio.get("name")),
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


def render_template(template: str, variables: dict[str, str]) -> tuple[str, list[str], list[str]]:
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
        return value

    return TOKEN_PATTERN.sub(replace, str(template)), sorted(missing), sorted(invalid)


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


def build_operation(
    scene: dict[str, Any],
    file_info: dict[str, Any],
    roots: list[str],
    settings: dict[str, Any],
) -> dict[str, Any]:
    source_path = str(file_info.get("path") or "")
    source_basename = str(file_info.get("basename") or Path(source_path).name)
    source_root = find_source_root(source_path, roots)
    warnings: list[str] = []
    invalid_tokens: set[str] = set()
    missing_tokens: set[str] = set()

    operation: dict[str, Any] = {
        "scene_id": str(scene.get("id") or ""),
        "scene_title": _clean_text(scene.get("title")),
        "file_id": str(file_info.get("id") or ""),
        "source": source_root or "",
        "source_path": source_path,
        "source_basename": source_basename,
        "destination_folder": str(Path(source_path).parent),
        "destination_basename": source_basename,
        "destination_path": source_path,
        "actions": [],
        "status": "ready",
        "warnings": warnings,
    }

    if not source_path or not source_root:
        operation["status"] = "blocked"
        warnings.append("The file is not inside a configured Stash source.")
        return operation
    if not os.path.isfile(source_path):
        operation["status"] = "warning"
        warnings.append("Skipped because the Stash file record points to a missing or inaccessible source file.")
        return operation

    variables = scene_variables(
        scene,
        file_info,
        source_root,
        settings["multiValueSeparator"],
    )

    destination_folder = str(Path(source_path).parent)
    if settings["moveEnabled"]:
        destination = Path(source_root)
        for level in settings["hierarchyLevels"]:
            rendered, missing, invalid = render_template(level, variables)
            missing_tokens.update(missing)
            invalid_tokens.update(invalid)
            destination /= sanitize_segment(rendered)
        destination_folder = str(destination)

    destination_basename = source_basename
    if settings["renameEnabled"]:
        if not settings["renamePattern"]:
            operation["status"] = "blocked"
            warnings.append("Renaming is enabled but the filename pattern is empty.")
            return operation
        rendered, missing, invalid = render_template(settings["renamePattern"], variables)
        missing_tokens.update(missing)
        invalid_tokens.update(invalid)
        extension = Path(source_basename).suffix
        destination_basename, filename_error = sanitize_filename(
            rendered,
            extension,
            settings["maxFilenameLength"],
        )
        if filename_error:
            operation["status"] = "blocked"
            warnings.append(filename_error)
            return operation

    destination_path = str(Path(destination_folder) / destination_basename)
    operation["destination_folder"] = destination_folder
    operation["destination_basename"] = destination_basename
    operation["destination_path"] = destination_path

    if invalid_tokens:
        operation["status"] = "blocked"
        warnings.append("Unknown variables: " + ", ".join(sorted(invalid_tokens)))
    if missing_tokens:
        warnings.append("Used Unknown for: " + ", ".join(sorted(missing_tokens)))
    if not path_is_within(destination_path, source_root):
        operation["status"] = "blocked"
        warnings.append("The destination would leave the file's Stash source.")

    source_normalized = _normalized_path(source_path)
    destination_normalized = _normalized_path(destination_path)
    if source_normalized == destination_normalized:
        operation["status"] = "unchanged"
        return operation
    if _normalized_path(str(Path(source_path).parent)) != _normalized_path(destination_folder):
        operation["actions"].append("move")
    if source_basename != destination_basename:
        operation["actions"].append("rename")
    if os.path.exists(destination_path):
        operation["status"] = "blocked"
        warnings.append("A file already exists at the destination.")
    return operation


def build_plan(
    roots: list[str],
    scenes: list[dict[str, Any]],
    raw_settings: dict[str, Any],
) -> dict[str, Any]:
    settings = normalize_settings(raw_settings)
    operations: list[dict[str, Any]] = []
    for scene in scenes:
        for file_info in scene.get("files") or []:
            operations.append(build_operation(scene, file_info, roots, settings))

    destinations: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for operation in operations:
        if operation["status"] == "ready":
            destinations[_normalized_path(operation["destination_path"])].append(operation)
    for duplicates in destinations.values():
        if len(duplicates) < 2:
            continue
        for operation in duplicates:
            operation["status"] = "blocked"
            operation["warnings"].append("Multiple files in this plan have the same destination.")

    counts = Counter(operation["status"] for operation in operations)
    action_counts = Counter(
        action for operation in operations for action in operation.get("actions") or []
    )
    return {
        "strategy_hash": strategy_hash(settings),
        "settings": settings,
        "total": len(operations),
        "summary": {
            "ready": counts.get("ready", 0),
            "warnings": counts.get("warning", 0),
            "unchanged": counts.get("unchanged", 0),
            "blocked": counts.get("blocked", 0),
            "moves": action_counts.get("move", 0),
            "renames": action_counts.get("rename", 0),
        },
        "operations": operations,
    }


def preview_plan(
    client: StashClient,
    raw_settings: dict[str, Any],
    page: int = 1,
    per_page: int = 50,
    status_filter: str = "all",
    include_all: bool = False,
) -> dict[str, Any]:
    roots, scenes = client.library_snapshot()
    plan = build_plan(roots, scenes, raw_settings)
    status_filter = str(status_filter or "all").strip().lower()
    if status_filter not in PREVIEW_STATUSES:
        status_filter = "all"
    filtered_operations = plan["operations"]
    if status_filter != "all":
        filtered_operations = [
            operation
            for operation in filtered_operations
            if operation["status"] == status_filter
        ]
    if include_all:
        result = dict(plan)
        result["operations"] = filtered_operations
        result["filter"] = status_filter
        result["filtered_total"] = len(filtered_operations)
        result["page"] = 1
        result["per_page"] = max(1, len(filtered_operations))
        result["pages"] = 1
        return result
    page = max(1, int(page))
    per_page = max(1, min(MAX_PAGE_SIZE, int(per_page)))
    pages = max(1, math.ceil(len(filtered_operations) / per_page))
    page = min(page, pages)
    start = (page - 1) * per_page
    result = dict(plan)
    result["operations"] = filtered_operations[start : start + per_page]
    result["filter"] = status_filter
    result["filtered_total"] = len(filtered_operations)
    result["page"] = page
    result["per_page"] = per_page
    result["pages"] = pages
    return result


def execute_plan(
    client: StashClient,
    raw_settings: dict[str, Any],
    expected_hash: str,
    reporter: Reporter,
) -> dict[str, Any]:
    roots, scenes = client.library_snapshot()
    plan = build_plan(roots, scenes, raw_settings)
    if not expected_hash or expected_hash != plan["strategy_hash"]:
        raise PluginError("The confirmed preview is stale. Generate and confirm a new preview.")

    ready = [operation for operation in plan["operations"] if operation["status"] == "ready"]
    reporter.info(
        f"DirtyTidy will apply {len(ready)} operation(s); "
        f"{plan['summary']['warnings']} warning(s), {plan['summary']['blocked']} blocked, "
        f"and {plan['summary']['unchanged']} unchanged."
    )
    completed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for index, operation in enumerate(ready, start=1):
        reporter.info(
            f"[{index}/{len(ready)}] {operation['source_path']} -> "
            f"{operation['destination_path']}"
        )
        try:
            if not client.move_file(operation):
                raise PluginError("Stash did not confirm the move.")
            completed.append(
                {
                    "file_id": operation["file_id"],
                    "source_path": operation["source_path"],
                    "destination_path": operation["destination_path"],
                }
            )
        except Exception as exc:
            reporter.error(f"Failed {operation['source_path']}: {exc}")
            failed.append(
                {
                    "file_id": operation["file_id"],
                    "source_path": operation["source_path"],
                    "destination_path": operation["destination_path"],
                    "error": str(exc),
                }
            )
        reporter.progress(index / max(len(ready), 1))

    reporter.progress(1.0)
    reporter.info(
        f"DirtyTidy finished: {len(completed)} completed, {len(failed)} failed."
    )
    return {
        "strategy_hash": plan["strategy_hash"],
        "completed": len(completed),
        "failed": len(failed),
        "warnings": plan["summary"]["warnings"],
        "blocked": plan["summary"]["blocked"],
        "unchanged": plan["summary"]["unchanged"],
        "operations": completed,
        "failures": failed,
    }


def run(payload: dict[str, Any], reporter: Reporter | None = None) -> dict[str, Any]:
    reporter = reporter or Reporter()
    server_connection = payload.get("server_connection") or {}
    if not isinstance(server_connection, dict):
        raise PluginError("Missing Stash server connection details")
    args = payload.get("args") or {}
    if not isinstance(args, dict):
        raise PluginError("Plugin arguments must be an object")

    client = StashClient(server_connection)
    mode = str(args.get("mode") or "execute")
    if mode == "preview":
        settings = args.get("settings")
        if not isinstance(settings, dict):
            settings = client.plugin_settings()
        return preview_plan(
            client,
            settings,
            int(args.get("page") or 1),
            int(args.get("perPage") or 50),
            str(args.get("status") or "all"),
            as_bool(args.get("includeAll"), False),
        )
    if mode == "execute":
        return execute_plan(
            client,
            client.plugin_settings(),
            str(args.get("expectedStrategyHash") or ""),
            reporter,
        )
    if mode == "automation":
        settings = normalize_settings(client.plugin_settings())
        trigger = str(args.get("automationTrigger") or "").strip().lower()
        if trigger not in {"scan", "generate"}:
            raise PluginError("DirtyTidy automation requires a Scan or Generate trigger")
        if settings["automationMode"] != trigger:
            message = (
                f"DirtyTidy skipped the {trigger} automation because the saved mode is "
                f"{settings['automationMode']}."
            )
            reporter.info(message)
            return {"skipped": True, "reason": message}
        approved_hash = settings["approvedStrategyHash"]
        if not approved_hash:
            message = "DirtyTidy skipped automation because this strategy has not been approved."
            reporter.info(message)
            return {"skipped": True, "reason": message}
        reporter.info(
            f"DirtyTidy is applying the strategy approved for completed {trigger} jobs."
        )
        return execute_plan(client, settings, approved_hash, reporter)
    raise PluginError(f"Unsupported DirtyTidy operation mode: {mode}")


def main() -> int:
    reporter = StashReporter()
    try:
        emit_output(run(read_payload(), reporter))
        return 0
    except Exception as exc:
        reporter.error(f"DirtyTidy failed: {exc}")
        emit_error(exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
