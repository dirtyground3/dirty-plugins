"""Section settings and the one-time Tidy/Compactor migration in shared storage."""
from __future__ import annotations

import json
from pathlib import Path

import dirty_plugins_storage as storage
from dirty_tasks_metadata import CONSTANTS

PLUGIN_ID = "dirtyTasks"
NAMESPACE = "dirtyTasks.settings"
SECTIONS = ("organization", "encoding", "execution")


def execution_settings(value):
    value = value if isinstance(value, dict) else {}
    modes = {item["value"] for item in CONSTANTS["execution"]["modes"]}
    def mode(item):
        return item if item in modes else "manual"
    rules = value.get("encoding") if isinstance(value.get("encoding"), dict) else {}
    return {**{key: mode(value.get(key)) for key in ("move", "rename", "tags")},
            "encoding": {str(key): mode(item) for key, item in rules.items()}}


def migrate_triggers():
    """Seed individual actions from the last shared choice without changing content."""
    if storage.get_metadata(NAMESPACE, "actionTriggers"):
        return
    with storage.transaction() as connection:
        if storage.get_metadata(NAMESPACE, "actionTriggers", connection=connection):
            return
        values = storage.get_plugin_settings(PLUGIN_ID, connection=connection)
        organization = dict(values.get("organization") or {})
        encoding = dict(values.get("encoding") or {})
        execution = values.get("execution") or {}
        shared = execution.get("automationMode")
        if shared in {item["value"] for item in CONSTANTS["execution"]["modes"]}:
            defaults = {"move": shared, "rename": shared, "tags": shared,
                        "encoding": {str(r["id"]): shared for r in encoding.get("rules", [])}}
        else:
            mode = organization.get("automationMode", "manual")
            defaults = {"move": mode, "rename": mode,
                        "tags": "scan" if organization.get("tagUpdateEnabled") and organization.get("taggerEndpoint") else "manual",
                        "encoding": {str(r["id"]): "scan" if not encoding.get("automationPaused", True) and r.get("mode") == "automatic" else "manual"
                                     for r in encoding.get("rules", [])}}
        values["execution"] = execution_settings({**defaults, **execution})
        organization.pop("automationMode", None)
        encoding.pop("automationPaused", None)
        encoding["rules"] = [{k: v for k, v in rule.items() if k not in ("mode", "trigger")} for rule in encoding.get("rules", [])]
        values.update(organization=organization, encoding=encoding)
        storage.set_plugin_settings_on_connection(PLUGIN_ID, values, connection)
        for section in SECTIONS:
            revision = int(storage.get_metadata(NAMESPACE, section, connection=connection) or 0)
            storage._put_metadata(connection, NAMESPACE, section, str(revision + 1))
        storage._put_metadata(connection, NAMESPACE, "actionTriggers", "1")


def project(section, values):
    execution = execution_settings(values.get("execution"))
    if section == "execution":
        return execution
    current = dict(values.get(section) or {})
    # Approval context for the organization editor; scheduling uses each action.
    if section == "organization":
        current["automationMode"] = next((execution[key] for key in ("move", "rename")
                                          if current.get(key + "Enabled", True) and execution[key] != "manual"), "manual")
    elif section == "encoding":
        current["rules"] = [dict(rule, trigger=execution["encoding"].get(str(rule["id"]), "manual")) for rule in current.get("rules", [])]
        current["automationPaused"] = not any(r.get("enabled") and r["trigger"] != "manual" for r in current["rules"])
    return current


def _migrate_legacy(client=None):
    if storage.get_metadata(NAMESPACE, "migrated"):
        return
    if client is not None:
        state = client.call("{plugins{id enabled} jobQueue{id description status}}")
        if any(p.get("enabled") and p["id"] in ("dirtyTidy", "dirtyCompactor") for p in state.get("plugins") or []):
            raise RuntimeError("Disable DirtyTidy and DirtyCompactor before opening DirtyTasks, then hard-refresh Stash.")
        if any(j.get("status") in ("RUNNING", "READY") and any(name in str(j.get("description", ""))
               for name in ("DirtyTidy:", "DirtyCompactor:")) for j in state.get("jobQueue") or []):
            raise RuntimeError("Wait for the old Tidy and Compactor tasks to stop before migrating.")
    with storage.transaction() as connection:
        if storage.get_metadata(NAMESPACE, "migrated", connection=connection):
            return
        pending = []
        if connection.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dirty_compactor_records'").fetchone():
            for row in connection.execute("SELECT id,value_json FROM dirty_compactor_records WHERE kind='run'"):
                run = json.loads(row["value_json"])
                if run["status"] not in ("completed", "cancelled", "failed", "awaitingReview"):
                    raise RuntimeError("Resolve the interrupted replacement with DirtyCompactor before migrating to DirtyTasks.")
                if run["status"] == "awaitingReview":
                    pending.append((row["id"], run))
        # Review files are disposable, unlike original backups. Never follow a
        # journal path outside the old plugin's private/review directories.
        for record_id, run in pending:
            for op in run.get("operations", []):
                for key in ("output", "published"):
                    if not op.get(key):
                        continue
                    file = Path(op[key])
                    allowed = [Path(__file__).resolve().parent.parent / folder / "runtime" / child
                               for folder in ("dirtyCompactor", "DirtyCompactor") for child in ("private", "previews")]
                    if not any(parent.resolve() in file.resolve().parents for parent in allowed) or op["id"] not in file.name:
                        raise RuntimeError("Discard the pending output in DirtyCompactor before migrating.")
                    file.unlink(missing_ok=True)
            run["status"] = "cancelled"
            run["migrationNote"] = "Pending review discarded when migrating to DirtyTasks."
            connection.execute("UPDATE dirty_compactor_records SET value_json=?,revision=revision+1 WHERE kind='run' AND id=?",
                               (json.dumps(run), record_id))
        organization = storage.get_plugin_settings("dirtyTidy", connection=connection)
        encoding = storage.get_plugin_settings("dirtyCompactor", connection=connection)
        imported = bool(organization or encoding)
        rules = encoding.get("rules", [])
        removed = sum(r.get("action") == "delete" for r in rules)
        encoding = dict(encoding, rules=[r for r in rules if r.get("action") != "delete"], automationPaused=True)
        organization = dict(organization, approvedPlanDigest="", approvedStrategyHash="")
        current = storage.get_plugin_settings(PLUGIN_ID, connection=connection)
        values = {"organization": organization, "encoding": encoding, **current}
        storage.set_plugin_settings_on_connection(PLUGIN_ID, values, connection)
        summary = {"removedDeleteRules": removed, "discardedReviews": len(pending),
                   "imported": imported, "encodingAutomationPaused": True}
        storage._put_metadata(connection, NAMESPACE, "migrated", json.dumps(summary))


def migrate(client=None):
    _migrate_legacy(client)
    migrate_triggers()


def get_section(section):
    if section not in SECTIONS:
        raise ValueError("Unknown task settings section")
    return project(section, storage.get_plugin_settings(PLUGIN_ID))


def snapshot(section):
    if section not in SECTIONS:
        raise ValueError("Unknown task settings section")
    with storage.transaction(immediate=False) as connection:
        values = storage.get_plugin_settings(PLUGIN_ID, connection=connection)
        revision = storage.get_metadata(NAMESPACE, section, connection=connection)
        return {"settings": project(section, values), "revision": int(revision or 0)}


def save_section(section, values, expected):
    if section not in SECTIONS or not isinstance(values, dict):
        raise ValueError("Invalid task settings")
    if section == "organization":
        from dirty_tidy import normalize_settings
        values = normalize_settings(values)
        values.pop("automationMode", None)
    elif section == "encoding":
        from dirty_compactor_rules import validate_settings
        values = validate_settings(values)
        values.pop("automationPaused", None)
        values["rules"] = [{k: v for k, v in rule.items() if k not in ("mode", "trigger")} for rule in values["rules"]]
    else:
        modes = {item["value"] for item in CONSTANTS["execution"]["modes"]}
        if (any(values.get(key) not in modes for key in ("move", "rename", "tags"))
                or not isinstance(values.get("encoding"), dict)
                or any(item not in modes for item in values["encoding"].values())):
            raise ValueError("Choose Manual, Scan, or Generate")
        values = execution_settings(values)
    with storage.transaction() as connection:
        revision = int(storage.get_metadata(NAMESPACE, section, connection=connection) or 0)
        if expected is None or isinstance(expected, bool) or expected != revision:
            raise RuntimeError("These task settings changed in another session. Reload saved settings and retry.")
        settings = storage.get_plugin_settings(PLUGIN_ID, connection=connection)
        settings[section] = values
        storage.set_plugin_settings_on_connection(PLUGIN_ID, settings, connection)
        storage._put_metadata(connection, NAMESPACE, section, str(revision + 1))
        return {"settings": project(section, settings), "revision": revision + 1}
