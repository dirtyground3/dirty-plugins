#!/usr/bin/env python3
"""Plan and execute safe file organization for the DirtyTidy Stash plugin."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dirty_tidy_templates import (
    UNKNOWN_VALUE, VARIABLE_NAMES, TOKEN_PATTERN, INVALID_PATH_CHARS, RESERVED_WINDOWS_NAMES,
    _clean_text, _names, _stash_ids, _date_parts, _rating_bucket, _grade,
    _resolution, _duration_bucket, scene_variables, _render_template, render_template, _clean_rename_separators,
    render_rename_template, template_variable_names, sanitize_segment, sanitize_filename, _normalized_path, path_is_within,
    find_source_root,
)



PLUGIN_ID = "dirtyTidy"
REVIEW_NAMESPACE = "dirtyTidy.reviewedPlans"
STRATEGY_VERSION = 6
DEFAULT_SETTINGS = {
    "moveEnabled": True,
    "moveRequireStashId": False,
    "hierarchyLevels": ["{studio}", "{year}"],
    "renameEnabled": False,
    "renameRequireStashId": False,
    "renamePattern": "{date} - {studio} - {title}",
    "maxFilenameLength": 180,
    "multiValueSeparator": ", ",
    "automationMode": "manual",
    "approvedStrategyHash": "",
    "approvedPlanDigest": "",
}
AUTOMATION_MODES = {"manual", "scan", "generate"}
STRATEGY_SETTING_KEYS = (
    "moveEnabled",
    "moveRequireStashId",
    "hierarchyLevels",
    "renameEnabled",
    "renameRequireStashId",
    "renamePattern",
    "maxFilenameLength",
    "multiValueSeparator",
)


def _load_shared_storage():
    plugin_root = Path(__file__).resolve().parent.parent
    for path in (
        plugin_root / "dirtyPlugins" / "dirty_plugins_storage.py",
        plugin_root / "DirtyPlugins" / "dirty_plugins_storage.py",
    ):
        if path.is_file():
            sys.path.insert(0, str(path.parent))
            return __import__("dirty_plugins_storage")
    raise RuntimeError("DirtyPlugins shared storage is not installed")


shared_storage = _load_shared_storage()
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

    def library_snapshot(self) -> tuple[list[str], list[dict[str, Any]]]:
        query = """
          query DirtyTidyScenes($filter: FindFilterType) {
            configuration { general { stashes { path excludeVideo } } }
            findScenes(filter: $filter) {
              count
              scenes {
                id title date rating100 organized
                stash_ids { stash_id }
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
    # Stash may launch Python with a legacy Windows code page. Keeping the raw
    # plugin protocol ASCII-only avoids charmap failures while JSON decoding
    # still restores every Unicode character.
    json.dump({"output": output}, stream, ensure_ascii=True)


def emit_error(error: Any, stream: Any = sys.stdout) -> None:
    json.dump({"error": str(error)}, stream, ensure_ascii=True)


def configure_standard_streams() -> None:
    """Use UTF-8 for the plugin protocol on every standard stream.

    Legacy Windows hosts may hand Stash a cp1252 stdin, which would corrupt
    non-ASCII settings before JSON decoding. Reconfiguring stdin alongside the
    output streams keeps the protocol UTF-8 end to end.
    """
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if not callable(reconfigure):
            continue
        try:
            reconfigure(encoding="utf-8", errors="backslashreplace")
        except (OSError, ValueError):
            # The JSON protocol remains ASCII-safe even if a host-owned stream
            # cannot be reconfigured.
            pass


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
    """Return the canonical strategy settings.

    This is the single source of truth for DirtyTidy settings. The settings
    panel mirrors these rules client-side so the strategy hash it saves always
    matches the plan the backend builds from the same values.
    """
    source = raw if isinstance(raw, dict) else {}
    try:
        max_length = int(source.get("maxFilenameLength", DEFAULT_SETTINGS["maxFilenameLength"]))
    except (TypeError, ValueError):
        max_length = int(DEFAULT_SETTINGS["maxFilenameLength"])
    separator_value = source.get("multiValueSeparator", DEFAULT_SETTINGS["multiValueSeparator"])
    if separator_value is None:
        separator_value = DEFAULT_SETTINGS["multiValueSeparator"]
    separator = str(separator_value)
    if not separator:
        separator = str(DEFAULT_SETTINGS["multiValueSeparator"])
    automation_mode = str(source.get("automationMode") or "manual").strip().lower()
    if automation_mode not in AUTOMATION_MODES:
        automation_mode = "manual"
    approved_hash = str(source.get("approvedStrategyHash") or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", approved_hash):
        approved_hash = ""
    approved_digest = str(source.get("approvedPlanDigest") or "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", approved_digest):
        approved_digest = ""
    return {
        "moveEnabled": as_bool(source.get("moveEnabled"), True),
        "moveRequireStashId": as_bool(source.get("moveRequireStashId"), False),
        "hierarchyLevels": _parse_levels(source.get("hierarchyLevels", DEFAULT_SETTINGS["hierarchyLevels"])),
        "renameEnabled": as_bool(source.get("renameEnabled"), False),
        "renameRequireStashId": as_bool(source.get("renameRequireStashId"), False),
        "renamePattern": str(source.get("renamePattern", DEFAULT_SETTINGS["renamePattern"]) or "").strip(),
        "maxFilenameLength": max(16, min(255, max_length)),
        "multiValueSeparator": separator[:10],
        "automationMode": automation_mode,
        "approvedStrategyHash": approved_hash,
        "approvedPlanDigest": approved_digest,
    }


def strategy_hash(settings: dict[str, Any]) -> str:
    normalized = normalize_settings(settings)
    strategy = {
        "strategyVersion": STRATEGY_VERSION,
        "settings": {key: normalized[key] for key in STRATEGY_SETTING_KEYS},
    }
    encoded = json.dumps(strategy, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _normalized_operation(operation: dict[str, Any]) -> dict[str, str]:
    source = str(operation.get("source_path") or "")
    destination = str(operation.get("destination_path") or "")
    return {
        "file_id": str(operation.get("file_id") or ""),
        "source_path": _normalized_path(source) if source else "",
        "destination_path": _normalized_path(destination) if destination else "",
    }


def operation_key(operation: dict[str, Any]) -> tuple[str, str, str]:
    normalized = _normalized_operation(operation)
    return (
        normalized["file_id"],
        normalized["source_path"],
        normalized["destination_path"],
    )


def plan_digest(strategy_digest: str, operations: Iterable[dict[str, Any]]) -> str:
    """Identify the exact ready operations in a preview or execution snapshot."""
    ready = sorted(
        operation_key(operation)
        for operation in operations
        if operation.get("status") == "ready"
    )
    encoded = json.dumps(
        {"strategyHash": strategy_digest, "operations": ready},
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def save_reviewed_plan(plan: dict[str, Any]) -> None:
    """Persist the plan a user confirmed so execution cannot exceed it."""
    operations = [
        _normalized_operation(operation)
        for operation in plan.get("operations") or []
        if operation.get("status") == "ready"
    ]
    payload = json.dumps(
        {
            "strategyHash": plan.get("strategy_hash") or "",
            "planDigest": plan.get("plan_digest") or "",
            "operations": operations,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    shared_storage.set_metadata(
        REVIEW_NAMESPACE, str(plan.get("strategy_hash") or ""), payload
    )


def load_reviewed_plan(strategy_digest: str) -> set[tuple[str, str, str]] | None:
    """Return the confirmed operation keys for a strategy, if one was saved."""
    raw = shared_storage.get_metadata(REVIEW_NAMESPACE, str(strategy_digest or ""))
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    operations = payload.get("operations")
    if not isinstance(operations, list):
        return None
    keys: set[tuple[str, str, str]] = set()
    for operation in operations:
        if not isinstance(operation, dict):
            continue
        keys.add(
            (
                str(operation.get("file_id") or ""),
                str(operation.get("source_path") or ""),
                str(operation.get("destination_path") or ""),
            )
        )
    return keys


def scene_has_stash_id(scene: dict[str, Any]) -> bool:
    stash_ids = scene.get("stash_ids")
    if not isinstance(stash_ids, list):
        return False
    return any(
        isinstance(stash_id, dict) and bool(str(stash_id.get("stash_id") or "").strip())
        for stash_id in stash_ids
    )


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
    skipped_rename_tokens: set[str] = set()

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
    has_stash_id = scene_has_stash_id(scene)
    move_allowed = settings["moveEnabled"] and (
        not settings["moveRequireStashId"] or has_stash_id
    )
    rename_allowed = settings["renameEnabled"] and (
        not settings["renameRequireStashId"] or has_stash_id
    )
    if settings["moveEnabled"] and not move_allowed:
        warnings.append("Skipped move because the scene has no Stash ID.")
    if settings["renameEnabled"] and not rename_allowed:
        warnings.append("Skipped rename because the scene has no Stash ID.")

    destination_folder = str(Path(source_path).parent)
    if move_allowed:
        destination = Path(source_root)
        for level in settings["hierarchyLevels"]:
            rendered, missing, invalid = render_template(level, variables)
            missing_tokens.update(missing)
            invalid_tokens.update(invalid)
            segment = sanitize_segment(rendered)
            if segment.upper() in RESERVED_WINDOWS_NAMES:
                operation["status"] = "blocked"
                warnings.append(f"{segment} is a reserved folder name.")
                return operation
            destination /= segment
        destination_folder = str(destination)

    destination_basename = source_basename
    if rename_allowed:
        if not settings["renamePattern"]:
            operation["status"] = "blocked"
            warnings.append("Renaming is enabled but the filename pattern is empty.")
            return operation
        rendered, missing, invalid = render_rename_template(settings["renamePattern"], variables)
        invalid_tokens.update(invalid)
        rename_variables = template_variable_names(settings["renamePattern"])
        all_rename_variables_missing = bool(rename_variables) and all(
            variables.get(name, UNKNOWN_VALUE) == UNKNOWN_VALUE
            for name in rename_variables
        )
        if all_rename_variables_missing and not invalid:
            warnings.append(
                "Kept the original filename because all filename variables are missing."
            )
        else:
            skipped_rename_tokens.update(missing)
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
    if skipped_rename_tokens:
        warnings.append(
            "Skipped empty filename variables: "
            + ", ".join(sorted(skipped_rename_tokens))
        )
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
        blocked_scenes = []
        seen_scene_ids: set[str] = set()
        for duplicate in duplicates:
            scene_id = duplicate["scene_id"]
            if not scene_id or scene_id in seen_scene_ids:
                continue
            seen_scene_ids.add(scene_id)
            blocked_scenes.append(
                {"id": scene_id, "title": duplicate["scene_title"]}
            )
        for operation in duplicates:
            operation["status"] = "blocked"
            operation["warnings"].append("Multiple files in this plan have the same destination.")
            operation["blocked_scenes"] = blocked_scenes

    for operation in operations:
        if operation["status"] != "blocked" or operation.get("blocked_scenes"):
            continue
        operation["blocked_scenes"] = [
            {"id": operation["scene_id"], "title": operation["scene_title"]}
        ] if operation["scene_id"] else []

    counts = Counter(operation["status"] for operation in operations)
    action_counts = Counter(
        action for operation in operations for action in operation.get("actions") or []
    )
    digest = strategy_hash(settings)
    return {
        "strategy_hash": digest,
        "plan_digest": plan_digest(digest, operations),
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
    record_review: bool = False,
) -> dict[str, Any]:
    roots, scenes = client.library_snapshot()
    plan = build_plan(roots, scenes, raw_settings)
    if record_review:
        save_reviewed_plan(plan)
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
    expected_plan_digest: str = "",
    plan: dict[str, Any] | None = None,
    *,
    apply_approved_strategy: bool = False,
) -> dict[str, Any]:
    if plan is None:
        roots, scenes = client.library_snapshot()
        plan = build_plan(roots, scenes, raw_settings)
    if not expected_hash or expected_hash != plan["strategy_hash"]:
        raise PluginError("The confirmed preview is stale. Generate and confirm a new preview.")
    if expected_plan_digest and expected_plan_digest != plan["plan_digest"]:
        raise PluginError(
            "The approved plan changed after it was approved. Generate a new preview "
            "and approve it again."
        )

    ready = [operation for operation in plan["operations"] if operation["status"] == "ready"]
    unreviewed = 0
    reviewed_missing = 0
    if apply_approved_strategy:
        # Automation approves the rules for future libraries, including newly
        # scanned scenes. It must not be tied to the preview's file list.
        settings = normalize_settings(raw_settings)
        if (
            settings["automationMode"] not in {"scan", "generate"}
            or settings["approvedStrategyHash"] != plan["strategy_hash"]
        ):
            raise PluginError("The current strategy has not been approved for automation.")
    else:
        # Manual execution only applies the exact operations the user confirmed.
        # A file that was warning/blocked at preview time (or appeared later) must
        # never move unseen.
        reviewed_keys = load_reviewed_plan(expected_hash)
        if reviewed_keys is None:
            raise PluginError(
                "The confirmed preview could not be found. Generate and confirm a new "
                "preview before running."
            )
        confirmed = [
            operation for operation in ready if operation_key(operation) in reviewed_keys
        ]
        unreviewed = len(ready) - len(confirmed)
        reviewed_missing = len(reviewed_keys) - len(confirmed)
        ready = confirmed

    approval = "approved strategy" if apply_approved_strategy else "confirmed preview"
    reporter.info(
        f"DirtyTidy will apply {len(ready)} operation(s) from the {approval}; "
        f"{unreviewed} operation(s) are not part of the confirmed preview, "
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
        "plan_digest": plan["plan_digest"],
        "completed": len(completed),
        "failed": len(failed),
        "unreviewed": unreviewed,
        "reviewed_missing": reviewed_missing,
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
            settings = shared_storage.get_plugin_settings(PLUGIN_ID)
        return preview_plan(
            client,
            settings,
            int(args.get("page") or 1),
            int(args.get("perPage") or 50),
            str(args.get("status") or "all"),
            as_bool(args.get("includeAll"), False),
            record_review=True,
        )
    if mode == "execute":
        stored_settings = shared_storage.get_plugin_settings(PLUGIN_ID)
        return execute_plan(
            client,
            stored_settings,
            str(args.get("expectedStrategyHash") or ""),
            reporter,
        )
    if mode == "automation":
        settings = normalize_settings(shared_storage.get_plugin_settings(PLUGIN_ID))
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
        roots, scenes = client.library_snapshot()
        plan = build_plan(roots, scenes, settings)
        if approved_hash != plan["strategy_hash"]:
            message = (
                "DirtyTidy skipped automation because the saved settings no longer "
                "match the approved strategy."
            )
            reporter.info(message)
            return {"skipped": True, "reason": message}
        reporter.info(
            f"DirtyTidy is applying the strategy approved for completed {trigger} jobs."
        )
        return execute_plan(
            client, settings, approved_hash, reporter, plan=plan,
            apply_approved_strategy=True,
        )
    raise PluginError(f"Unsupported DirtyTidy operation mode: {mode}")


def _requested_mode(payload: Any) -> str:
    args = payload.get("args") if isinstance(payload, dict) else None
    if isinstance(args, dict):
        return str(args.get("mode") or "execute")
    return "unknown"


def exit_code_for(output: Any) -> int:
    """Report an execute run that applied nothing but failed as an error.

    Stash treats a nonzero plugin exit as a failure, so an all-failed run must
    not look green in Tasks. Preview and skipped runs stay successful.
    """
    if (
        isinstance(output, dict)
        and output.get("failed")
        and not output.get("completed")
    ):
        return 1
    return 0


def main() -> int:
    configure_standard_streams()
    reporter = StashReporter()
    started = time.monotonic()
    mode = "unknown"
    try:
        payload = read_payload()
        mode = _requested_mode(payload)
        reporter.info(f"DirtyTidy backend started: mode={mode}")
        output = run(payload, reporter)
        reporter.info(
            f"DirtyTidy backend finished: mode={mode} in {int((time.monotonic() - started) * 1000)}ms"
        )
        emit_output(output)
        return exit_code_for(output)
    except Exception as exc:
        reporter.error(
            f"DirtyTidy failed: mode={mode} after {int((time.monotonic() - started) * 1000)}ms: {exc}"
        )
        emit_error(exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
