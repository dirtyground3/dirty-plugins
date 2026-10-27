"""DirtyTasks' sole Stash JSON entry point; task workflows remain independent."""
from __future__ import annotations

from pathlib import Path
import sys
import uuid

for folder in ("dirtyPlugins", "DirtyPlugins"):
    shared = Path(__file__).resolve().parent.parent / folder
    if (shared / "dirty_plugins_storage.py").is_file():
        sys.path.insert(0, str(shared))
        break
sys.path.insert(0, str(Path(__file__).resolve().parent))

import dirty_plugins_protocol as protocol
import dirty_tasks_settings as settings
import dirty_tasks_lock as reservation
import dirty_tidy as organization
import dirty_compactor as encoding


def run(payload, reporter=None):
    args = payload.get("args") or {}
    if not isinstance(args, dict):
        raise ValueError("Task arguments must be an object")
    client = encoding.Client(payload.get("server_connection") or {})
    settings.migrate(client)
    mode = args.get("mode")
    if mode == "getTaskSettings":
        return settings.snapshot(args.get("section"))
    if mode == "saveTaskSettings":
        return settings.save_section(args.get("section"), args.get("settings"), args.get("expectedRevision"))
    if mode == "migrationStatus":
        import json
        return json.loads(settings.storage.get_metadata(settings.NAMESPACE, "migrated"))
    if mode == "dismissMigrationNotice":
        return settings.dismiss_migration_notice()
    if mode == "organizationRecoveryStatus":
        return reservation.organization_recovery_status(client)
    if mode == "recoverOrganization":
        recovered = reservation.recover_organization(client)
        if recovered:
            reservation.queue_pending(client)
            encoding.queue_pending(client)
        return {"recovered": recovered}
    if mode == "queueAutomation" and not args.get("task"):
        # One browser subscription, independent server-side claims for each task.
        errors = []
        files = {"skipped": True}
        try:
            files = organization.run(payload, reporter)
        except Exception as error:
            errors.append(str(error))
        compact = {"skipped": True}
        if args.get("automationTrigger") in ("scan", "generate"):
            try:
                compact = encoding.dispatch(client, {"mode": "startAutomaticRun", "automationTrigger": args.get("automationTrigger"), "jobId": args.get("sourceJobId"),
                                                     "startTime": args.get("sourceStartTime")})
            except Exception as error:
                errors.append(str(error))
        if errors:
            raise RuntimeError("; ".join(errors))
        return {"organization": files, "encoding": compact}
    task = args.get("task")
    if task == "organization":
        if mode in ("execute", "automation"):
            owner = args.get("reservation") or uuid.uuid4().hex
            try:
                reservation.acquire("organization", owner)
            except RuntimeError:
                if mode == "automation":
                    reservation.defer_organization(args)
                    return {"coalesced": True}
                raise
            try:
                return organization.run(payload, reporter)
            finally:
                reservation.release("organization", owner)
                reservation.queue_pending(client)
                encoding.queue_pending(client)
        return organization.run(payload, reporter)
    if task == "encoding":
        return encoding.run(payload, reporter)
    raise ValueError("Choose an organization or encoding task")


def main():
    return protocol.serve("DirtyTasks", run, quiet=True, exit_code=organization.exit_code_for,
                          public_error=lambda error: "File operation failed. Check Stash logs." if isinstance(error, OSError) else str(error))


if __name__ == "__main__":
    raise SystemExit(main())
