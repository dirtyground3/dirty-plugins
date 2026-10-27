#!/usr/bin/env python3
"""Plan and execute safe file organization for the DirtyTasks organization Stash plugin."""

from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
import uuid
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dirty_tasks_metadata import CONSTANTS as ALL_CONSTANTS
CONSTANTS = ALL_CONSTANTS["organization"]  # noqa: E402
from dirty_tidy_templates import (
    _clean_text, scene_variables, scene_template_variables, template_variable_names, _normalized_path,
    find_source_root, render_destination_folder, render_destination_filename, validate_destination,
)


PLUGIN_ID = "dirtyTasks"
REVIEW_NAMESPACE = "dirtyTidy.reviewedPlans"
AUTOMATION_NAMESPACE = "dirtyTidy.automationJobs"
TAG_AUTOMATION_NAMESPACE = "dirtyTidy.tagUpdateJobs"
STRATEGY_VERSION = 7
DEFAULT_SETTINGS = CONSTANTS["defaultSettings"]
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


for folder in ("dirtyPlugins", "DirtyPlugins"):  # installed plugin ID, then source directory
    shared = Path(__file__).resolve().parent.parent / folder
    if (shared / "dirty_plugins_storage.py").is_file():
        sys.path.insert(0, str(shared))
        break
else:
    raise RuntimeError("DirtyPlugins shared storage is not installed")
import dirty_plugins_storage as shared_storage
from dirty_tasks_settings import get_section
from dirty_plugins_client import StashClient as BaseClient
from dirty_plugins_protocol import Reporter
from dirty_tidy_tags import update_scene_tags
SCENE_QUERY_PAGE_SIZE = 100


def snapshot_fields(settings: dict[str, Any]) -> str:
    """Fetch the reviewed strategy's inputs, plus the identities/labels needed by the plan."""
    templates = settings["hierarchyLevels"] if settings["moveEnabled"] else []
    if settings["renameEnabled"]:
        templates = [*templates, settings["renamePattern"]]
    names = {name for template in templates for name in template_variable_names(template)}
    scene_fields = ["id title"]
    for tokens, fields in (
        ({"date", "year", "month", "day"}, "date"),
        ({"rating", "grade", "rating_bucket"}, "rating100"),
        ({"organized"}, "organized"),
        ({"studio", "parent_studio"}, "studio { name parent_studio { name } }"),
        ({"performers", "first_performer", "female_performers", "females_performers", "male_performers",
          "first_female_performer", "first_male_performer", "performer_count"}, "performers { name gender }"),
        ({"tags", "first_tag"}, "tags { name }"),
        ({"group", "group_position"}, "groups { scene_index group { name } }"),
    ):
        if names & tokens:
            scene_fields.append(fields)
    requires_stash_id = any(settings[action + "Enabled"] and settings[action + "RequireStashId"]
                            for action in ("move", "rename"))
    if "stash_id" in names or requires_stash_id:
        scene_fields.append("stash_ids { stash_id }")
    file_fields = ["id path basename"]
    for tokens, fields in (
        ({"duration", "duration_bucket"}, "duration"),
        ({"resolution", "height"}, "height"),
        ({"video_codec"}, "video_codec"),
    ):
        if names & tokens:
            file_fields.append(fields)
    return " ".join([*scene_fields, "files { " + " ".join(file_fields) + " }"])


class PluginError(RuntimeError):
    """An error that should be shown cleanly in Stash."""


class StashClient(BaseClient):
    def __init__(self, server_connection):
        super().__init__(server_connection, timeout=120, error_type=PluginError)

    def library_snapshot(self, settings: dict[str, Any]) -> tuple[list[str], list[dict[str, Any]]]:
        query = """
          query DirtyTidyScenes($filter: FindFilterType) {
            configuration { general { stashes { path } } }
            findScenes(filter: $filter) {
              count
              scenes {
                %s
              }
            }
          }
        """ % snapshot_fields(settings)
        scenes: list[dict[str, Any]] = []
        roots: list[str] = []
        page = 1
        total = None
        while total is None or len(scenes) < total:
            data = self.call(query, {"filter": {"page": page, "per_page": SCENE_QUERY_PAGE_SIZE, "sort": "id", "direction": "ASC"}})
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

    def file_path(self, file_id: str) -> str:
        data = self.call(
            "query DirtyTidyFile($ids:[ID!]) { findFiles(ids:$ids) { files { id path } } }",
            {"ids": [str(file_id)]},
        )
        files = (data.get("findFiles") or {}).get("files") or []
        return next((str(item.get("path") or "") for item in files if str(item.get("id")) == str(file_id)), "")

    def move_file(self, operation: dict[str, Any]) -> bool:
        input_value: dict[str, Any] = {
            "ids": [str(operation["file_id"])],
            "destination_folder": operation["destination_folder"],
        }
        if operation["destination_basename"] != operation["source_basename"]:
            input_value["destination_basename"] = operation["destination_basename"]
        data = self.call("mutation DirtyTidyMove($input: MoveFilesInput!) { moveFiles(input: $input) }", {"input": input_value})
        return bool(data.get("moveFiles"))


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
    if not isinstance(value, list):
        return list(DEFAULT_SETTINGS["hierarchyLevels"])
    return [item.strip() for item in value if isinstance(item, str) and item.strip()]


def normalize_settings(raw: Any) -> dict[str, Any]:
    """Return the canonical strategy settings.

    This is the single source of truth for DirtyTasks organization settings. The settings
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
        "tagUpdateEnabled": as_bool(source.get("tagUpdateEnabled"), DEFAULT_SETTINGS["tagUpdateEnabled"]),
        "taggerEndpoint": source.get("taggerEndpoint", "").strip() if isinstance(source.get("taggerEndpoint"), str) else "",
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
    return normalized["file_id"], normalized["source_path"], normalized["destination_path"]


def source_fingerprint(path: str) -> list[int] | None:
    """Identify a regular source file without reading its media contents."""
    try:
        info = os.stat(path)
    except OSError:
        return None
    if not stat.S_ISREG(info.st_mode):
        return None
    return [info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns]


def reviewed_operations(operations: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        ({**_normalized_operation(operation), "source_fingerprint": operation["source_fingerprint"]}
         for operation in operations if operation.get("status") == "ready"),
        key=lambda operation: (operation["file_id"], operation["source_path"], operation["destination_path"]),
    )


def reviewed_digest(strategy_digest: str, operations: Iterable[dict[str, Any]]) -> str:
    # Stored paths are already canonical. Do not resolve them again: a later
    # symlink change must not reinterpret an earlier preview's authorization.
    ready = sorted(
        (operation["file_id"], operation["source_path"], operation["destination_path"], operation["source_fingerprint"])
        for operation in operations
    )
    encoded = json.dumps({"strategyHash": strategy_digest, "operations": ready}, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def plan_digest(strategy_digest: str, operations: Iterable[dict[str, Any]]) -> str:
    """Identify the exact ready operations and source files in a preview."""
    return reviewed_digest(strategy_digest, reviewed_operations(operations))


def save_reviewed_plan(plan: dict[str, Any]) -> None:
    """Retain an immutable preview, including when another tab previews later."""
    operations = reviewed_operations(plan["operations"])
    digest = reviewed_digest(plan["strategy_hash"], operations)
    if digest != plan["plan_digest"]:
        raise PluginError("The preview changed before it could be recorded. Generate a new preview.")
    payload = {"strategyHash": plan["strategy_hash"], "planDigest": digest, "operations": operations}

    def retain(current):
        if current and current != payload:
            raise PluginError("The recorded preview does not match its identity. Generate a new preview.")
        return current or payload

    shared_storage.update_json_metadata(REVIEW_NAMESPACE, digest, retain)


def load_reviewed_plan(preview_digest: str, strategy_digest: str) -> dict[tuple[str, str, str], list[int]] | None:
    """Return only the operations and source identities in this exact preview."""
    if not re.fullmatch(r"[0-9a-f]{64}", preview_digest):
        return None
    raw = shared_storage.get_metadata(REVIEW_NAMESPACE, preview_digest)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict) or payload.get("strategyHash") != strategy_digest or payload.get("planDigest") != preview_digest:
        return None
    operations = payload.get("operations")
    if not isinstance(operations, list):
        return None
    for operation in operations:
        if not isinstance(operation, dict) or any(not isinstance(operation.get(key), str) or not operation[key]
                                                  for key in ("file_id", "source_path", "destination_path")):
            return None
        fingerprint = operation.get("source_fingerprint")
        if not isinstance(fingerprint, list) or len(fingerprint) != 4 or any(type(value) is not int for value in fingerprint):
            return None
    if reviewed_digest(strategy_digest, operations) != preview_digest:
        return None
    return {
        (operation["file_id"], operation["source_path"], operation["destination_path"]): operation["source_fingerprint"]
        for operation in operations
    }


def scene_has_stash_id(scene: dict[str, Any]) -> bool:
    stash_ids = scene.get("stash_ids")
    if not isinstance(stash_ids, list):
        return False
    return any(isinstance(stash_id, dict) and bool(str(stash_id.get("stash_id") or "").strip()) for stash_id in stash_ids)


def build_operation(scene: dict[str, Any], file_info: dict[str, Any], roots: list[str], settings: dict[str, Any], *, normalize=None, scene_values=None) -> dict[str, Any]:
    source_path = str(file_info.get("path") or "")
    source_basename = str(file_info.get("basename") or Path(source_path).name)
    source_root = find_source_root(source_path, roots, normalize=normalize)
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
    fingerprint = source_fingerprint(source_path)
    if fingerprint is None:
        operation["status"] = "warning"
        warnings.append("Skipped because the Stash file record points to a missing or inaccessible source file.")
        return operation
    operation["source_fingerprint"] = fingerprint

    variables = scene_variables(scene, file_info, source_root, settings["multiValueSeparator"], scene_values=scene_values)
    has_stash_id = scene_has_stash_id(scene)
    move_allowed = settings["moveEnabled"] and (not settings["moveRequireStashId"] or has_stash_id)
    rename_allowed = settings["renameEnabled"] and (not settings["renameRequireStashId"] or has_stash_id)
    if settings["moveEnabled"] and not move_allowed:
        warnings.append("Skipped move because the scene has no Stash ID.")
    if settings["renameEnabled"] and not rename_allowed:
        warnings.append("Skipped rename because the scene has no Stash ID.")

    destination_folder = str(Path(source_path).parent)
    if move_allowed:
        folder = render_destination_folder(source_root, settings["hierarchyLevels"], variables)
        if folder.error:
            operation["status"] = "blocked"
            warnings.append(folder.error)
            return operation
        destination_folder = folder.value
        missing_tokens.update(folder.missing)
        invalid_tokens.update(folder.invalid)

    destination_basename = source_basename
    if rename_allowed:
        filename = render_destination_filename(source_basename, settings["renamePattern"], variables, settings["maxFilenameLength"])
        warnings.extend(filename.warnings)
        if filename.error:
            operation["status"] = "blocked"
            warnings.append(filename.error)
            return operation
        destination_basename = filename.value
        if len(scene.get("files") or []) > 1:
            variant = " - file-" + str(file_info["id"])
            name = Path(destination_basename)
            if len(variant) + len(name.suffix) >= settings["maxFilenameLength"]:
                variant = "-" + hashlib.sha256(str(file_info["id"]).encode()).hexdigest()[:8]
            limit = max(1, settings["maxFilenameLength"] - len(variant) - len(name.suffix))
            if not name.stem.endswith(variant):
                destination_basename = name.stem[:limit] + variant + name.suffix
        invalid_tokens.update(filename.invalid)
        skipped_rename_tokens.update(filename.missing)

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
        warnings.append("Skipped empty filename variables: " + ", ".join(sorted(skipped_rename_tokens)))
    validation = validate_destination(source_path, source_root, source_basename, destination_folder, destination_basename, operation["status"], normalize=normalize)
    operation["status"] = validation.status
    operation["actions"] = validation.actions
    warnings.extend(validation.warnings)
    return operation


def build_plan(roots: list[str], scenes: list[dict[str, Any]], raw_settings: dict[str, Any], actions=None) -> dict[str, Any]:
    settings = normalize_settings(raw_settings)
    operation_settings = dict(settings)
    if actions is not None:
        for action in ("move", "rename"):
            operation_settings[action + "Enabled"] = settings[action + "Enabled"] and action in actions
    # These caches live only for this plan. Execution builds a fresh plan and
    # retains its per-operation filesystem/identity checks before moving files.
    normalize = lru_cache(maxsize=None)(_normalized_path)
    operations = []
    for scene in scenes:
        scene_values = scene_template_variables(scene, settings["multiValueSeparator"])
        operations.extend(build_operation(scene, file_info, roots, operation_settings, normalize=normalize, scene_values=scene_values)
                          for file_info in scene.get("files") or [])

    destinations: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for operation in operations:
        if operation["status"] == "ready":
            destinations[normalize(operation["destination_path"])].append(operation)
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
            blocked_scenes.append({"id": scene_id, "title": duplicate["scene_title"]})
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
    action_counts = Counter(action for operation in operations for action in operation.get("actions") or [])
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


def preview_plan(client: StashClient, raw_settings: dict[str, Any], record_review: bool = False) -> dict[str, Any]:
    # The settings panel filters and pages the complete plan locally.
    roots, scenes = client.library_snapshot(normalize_settings(raw_settings))
    plan = build_plan(roots, scenes, raw_settings)
    if record_review:
        save_reviewed_plan(plan)
    return plan


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
    settings = normalize_settings(raw_settings)
    digest = strategy_hash(settings)
    if not expected_hash or expected_hash != digest:
        raise PluginError("The confirmed preview is stale. Generate and confirm a new preview.")
    reviewed = None if apply_approved_strategy else load_reviewed_plan(expected_plan_digest, expected_hash)
    if not apply_approved_strategy and reviewed is None:
        raise PluginError("The confirmed preview could not be found. Generate and confirm a new preview before running.")
    if plan is None:
        roots, scenes = client.library_snapshot(settings)
        plan = build_plan(roots, scenes, raw_settings)
    if not expected_hash or expected_hash != plan["strategy_hash"]:
        raise PluginError("The confirmed preview is stale. Generate and confirm a new preview.")

    ready = [operation for operation in plan["operations"] if operation["status"] == "ready"]
    unreviewed = 0
    reviewed_missing = 0
    if apply_approved_strategy:
        # Automation approves the rules for future libraries, including newly
        # scanned scenes. It must not be tied to the preview's file list.
        if settings["automationMode"] not in {"scan", "generate"} or settings["approvedStrategyHash"] != plan["strategy_hash"]:
            raise PluginError("The current strategy has not been approved for automation.")
    else:
        # Manual execution only applies the exact operations the user confirmed.
        # A file that was warning/blocked at preview time (or appeared later) must
        # never move unseen.
        assert reviewed is not None
        confirmed = [operation for operation in ready if reviewed.get(operation_key(operation)) == operation["source_fingerprint"]]
        unreviewed = len(ready) - len(confirmed)
        reviewed_missing = len(reviewed) - len(confirmed)
        ready = confirmed

    ready_with_keys = [(operation, operation_key(operation)) for operation in ready]

    approval = "approved strategy" if apply_approved_strategy else "confirmed preview"
    reporter.info(
        f"DirtyTasks organization will apply {len(ready)} operation(s) from the {approval}; "
        f"{unreviewed} operation(s) are not part of the confirmed preview, "
        f"{plan['summary']['warnings']} warning(s), {plan['summary']['blocked']} blocked, "
        f"and {plan['summary']['unchanged']} unchanged."
    )
    completed: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for index, (operation, confirmed_key) in enumerate(ready_with_keys, start=1):
        reporter.info(f"[{index}/{len(ready)}] {operation['source_path']} -> {operation['destination_path']}")
        entry = {key: operation[key] for key in ("file_id", "source_path", "destination_path")}
        try:
            # A long run must not rely on its initial snapshot. Recheck the file
            # ID's current Stash path and the filesystem immediately before move.
            current_path = client.file_path(operation["file_id"])
            if not current_path or _normalized_path(current_path) != confirmed_key[1] or operation_key(operation) != confirmed_key:
                raise PluginError("The source or destination path changed after the plan was checked.")
            if source_fingerprint(operation["source_path"]) != operation["source_fingerprint"]:
                raise PluginError("The source file changed or became inaccessible after the plan was checked.")
            validation = validate_destination(
                operation["source_path"], operation["source"], operation["source_basename"],
                operation["destination_folder"], operation["destination_basename"], "ready",
            )
            if validation.status != "ready":
                raise PluginError("The destination is no longer safe: " + " ".join(validation.warnings))
            if not client.move_file(operation):
                raise PluginError("Stash did not confirm the move.")
            completed.append(entry)
        except Exception as exc:
            reporter.error(f"Failed {operation['source_path']}: {exc}")
            failed.append({**entry, "error": str(exc)})
        reporter.progress(index / max(len(ready), 1))

    reporter.progress(1.0)
    reporter.info(f"DirtyTasks organization finished: {len(completed)} completed, {len(failed)} failed.")
    return {
        "strategy_hash": plan["strategy_hash"],
        "plan_digest": plan["plan_digest"],
        "confirmed_plan_digest": "" if apply_approved_strategy else expected_plan_digest,
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


def organization_actions(settings, trigger):
    execution = get_section("execution")
    return {key for key in ("move", "rename") if settings[key + "Enabled"] and execution[key] == trigger}


def queue_automation(client: StashClient, args: dict[str, Any], reporter: Reporter) -> dict[str, Any]:
    """Claim a completed job across browser sessions before creating a task."""
    trigger = str(args.get("automationTrigger") or "").strip().lower()
    job_id = str(args.get("sourceJobId") or "").strip()
    start_time = str(args.get("sourceStartTime") or "").strip()
    if trigger not in {"scan", "generate"} or not job_id or not start_time:
        raise PluginError("DirtyTasks organization automation requires the completed job's trigger, ID and start time")
    settings = normalize_settings(get_section("organization"))
    actions = organization_actions(settings, trigger)
    if not actions:
        return {"skipped": True, "reason": "disabled"}
    if not settings["approvedStrategyHash"] or settings["approvedStrategyHash"] != strategy_hash(settings):
        return {"skipped": True, "reason": "unapproved"}
    if shared_storage.internal_scan_check(job_id, start_time):
        return {"skipped": True, "reason": "internal"}
    if not settings["moveEnabled"] and not settings["renameEnabled"]:
        return {"skipped": True, "reason": "no actions enabled"}

    action = "move and rename scene files" if len(actions) == 2 else (
        "organize scene files into folders" if "move" in actions else "rename scene files"
    )
    return claim_automation_job(client, reporter, trigger, job_id, start_time, AUTOMATION_NAMESPACE,
                                "automation", action)


def claim_automation_job(client, reporter, trigger, job_id, start_time, namespace, mode, action):
    key = json.dumps([trigger, job_id, start_time], separators=(",", ":"))
    token = uuid.uuid4().hex
    claimed = shared_storage.update_json_metadata(
        namespace, key, lambda current: current or {"token": token}
    )
    if claimed.get("token") != token:
        reporter.info(f"DirtyTasks organization skipped duplicate {trigger} job {job_id} ({start_time}).")
        return {"skipped": True, "reason": "duplicate"}

    description = f"DirtyTasks: organization: {action} (after {trigger.title()} #{job_id})"
    try:
        queued_id = client.call(
            "mutation DirtyTidyAutomation($pluginId:ID!,$description:String,$args:Map){"
            "runPluginTask(plugin_id:$pluginId,description:$description,args_map:$args)}",
            {"pluginId": PLUGIN_ID, "description": description, "args": {
                "task": "organization", "mode": mode, "automationTrigger": trigger,
                "sourceJobId": job_id, "sourceStartTime": start_time,
            }},
        ).get("runPluginTask")
        if not queued_id:
            raise PluginError("Stash did not return a DirtyTasks organization task ID")
    except Exception:
        # Only release our own claim; a failed queue remains retryable.
        shared_storage.delete_metadata(namespace, key, expected=json.dumps(claimed))
        raise
    reporter.info(f"DirtyTasks organization queued job {queued_id}: {description}; source started {start_time}.")
    return {"queuedJobId": str(queued_id)}


def queue_tag_update(client, args, reporter):
    settings = normalize_settings(get_section("organization"))
    trigger = str(args.get("automationTrigger") or "").strip().lower()
    if trigger not in {"scan", "generate"} or trigger != get_section("execution")["tags"] or not settings["tagUpdateEnabled"] or not settings["taggerEndpoint"]:
        return {"skipped": True, "reason": "disabled"}
    job_id, start_time = str(args["sourceJobId"]).strip(), str(args["sourceStartTime"]).strip()
    if shared_storage.internal_scan_check(job_id, start_time):
        return {"skipped": True, "reason": "internal"}
    return claim_automation_job(client, reporter, trigger, job_id, start_time, TAG_AUTOMATION_NAMESPACE,
                                "updateTags", "merge scene tags from the selected tagger")


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
    if mode == "queueAutomation":
        # Tag merging is separately enabled and needs no approval to move files.
        files = queue_automation(client, args, reporter)
        tags = queue_tag_update(client, args, reporter)
        jobs = [result["queuedJobId"] for result in (files, tags) if result.get("queuedJobId")]
        return {"queuedJobId": jobs[0], "queuedJobIds": jobs} if jobs else files
    if mode == "updateTags":
        settings = normalize_settings(get_section("organization"))
        if args.get("automationTrigger") and args["automationTrigger"] != get_section("execution")["tags"]:
            return {"skipped": True, "reason": "Running strategy changed before the task started."}
        if not settings["tagUpdateEnabled"] or not settings["taggerEndpoint"]:
            return {"skipped": True, "reason": "Tag updates are disabled or no source is selected."}
        return update_scene_tags(client, settings["taggerEndpoint"], reporter, force=as_bool(args.get("force"), False))
    if mode == "preview":
        settings = args.get("settings")
        if not isinstance(settings, dict):
            settings = get_section("organization")
        return preview_plan(client, settings, record_review=True)
    if mode == "execute":
        return execute_plan(
            client, get_section("organization"), str(args.get("expectedStrategyHash") or ""),
            reporter, str(args.get("expectedPlanDigest") or ""),
        )
    if mode == "automation":
        settings = normalize_settings(get_section("organization"))
        trigger = str(args.get("automationTrigger") or "").strip().lower()
        if trigger not in {"scan", "generate"}:
            raise PluginError("DirtyTasks organization automation requires a Scan or Generate trigger")

        def skip(message: str) -> dict[str, Any]:
            reporter.info(message)
            return {"skipped": True, "reason": message}

        actions = organization_actions(settings, trigger)
        if not actions:
            return skip(f"DirtyTasks organization has no enabled actions scheduled after {trigger}.")
        approved_hash = settings["approvedStrategyHash"]
        if not approved_hash:
            return skip("DirtyTasks organization skipped automation because this strategy has not been approved.")
        roots, scenes = client.library_snapshot(settings)
        plan = build_plan(roots, scenes, settings, actions=actions)
        if approved_hash != plan["strategy_hash"]:
            return skip("DirtyTasks organization skipped automation because the saved settings no longer match the approved strategy.")
        reporter.info(f"DirtyTasks organization is applying the strategy approved for completed {trigger} jobs.")
        return execute_plan(client, settings, approved_hash, reporter, plan=plan, apply_approved_strategy=True)
    raise PluginError(f"Unsupported DirtyTasks organization operation mode: {mode}")


def exit_code_for(output: Any) -> int:
    """Report an execute run that applied nothing but failed as an error.

    Stash treats a nonzero plugin exit as a failure, so an all-failed run must
    not look green in Tasks. Preview and skipped runs stay successful.
    """
    return 1 if isinstance(output, dict) and output.get("failed") and not output.get("completed") else 0


