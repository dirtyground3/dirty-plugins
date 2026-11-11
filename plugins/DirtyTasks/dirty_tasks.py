"""DirtyTasks' sole Stash JSON entry point; task workflows remain independent."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys
import time
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
import dirty_tasks_backup as backup
import dirty_tasks_schedule as schedule


def acquire_organization(client, owner, reporter):
    """Take the file lock; an encoding run that no Stash task is running is paused rather than blocking."""
    try:
        reservation.acquire("organization", owner)
        return True
    except RuntimeError:
        pass
    try:
        parked = encoding.release_stranded(client)
    except RuntimeError:
        # Without a reliable answer from Stash, or if the run changed meanwhile, it keeps its lock.
        return False
    if not parked:
        return False
    started = time.strftime("%Y-%m-%d %H:%M", time.localtime(parked.get("created", 0)))
    reporter.info(f"DirtyTasks paused the encoding run started {started}, which no Stash task was running, "
                  "so organization can use the files. Resume or cancel it under Encoding.")
    try:
        reservation.acquire("organization", owner)
        return True
    except RuntimeError:
        return False


def queue_scheduled(client, reporter, group, keys, slot):
    """Queue one group of due scheduled actions through the same paths as Scan/Generate automation."""
    job_id, start = "schedule:" + str(int(slot)), datetime.fromtimestamp(slot).isoformat(timespec="minutes")
    if group == "organization":
        result = organization.queue_automation(client, {"automationTrigger": "schedule", "sourceJobId": job_id,
                                                        "sourceStartTime": start, "actions": keys}, reporter)
    elif group == "tags":
        result = organization.queue_tag_update(client, {"automationTrigger": "schedule", "sourceJobId": job_id,
                                                        "sourceStartTime": start}, reporter)
    elif group == "encoding":
        result = encoding.dispatch(client, {"mode": "startAutomaticRun", "automationTrigger": "schedule", "jobId": job_id,
                                            "startTime": start, "ruleIds": [key.split(":", 1)[1] for key in keys]})
    else:
        result = {"queuedJobId": client.queue("dirtyTasks", {"task": "backup", "automationTrigger": "schedule"},
                                              backup.DESCRIPTION + "scheduled " + start)}
    if result.get("skipped"):
        reporter.info("DirtyTasks skipped the scheduled " + ", ".join(keys) + " run: " + str(result.get("reason")) + ".")
    return result


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
    if mode == "checkSchedules":
        return schedule.check(client, reporter or protocol.Reporter(), queue_scheduled)
    if mode == "resolveMissedSchedules":
        return schedule.resolve(client, reporter or protocol.Reporter(), queue_scheduled, args.get("choices"))
    if mode == "backupStatus":
        return backup.status()
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
        saved = {"skipped": True}
        if args.get("automationTrigger") in ("scan", "generate"):
            try:
                compact = encoding.dispatch(client, {"mode": "startAutomaticRun", "automationTrigger": args.get("automationTrigger"), "jobId": args.get("sourceJobId"),
                                                     "startTime": args.get("sourceStartTime")})
            except Exception as error:
                errors.append(str(error))
            try:
                saved = backup.queue_automation(client, reporter or protocol.Reporter(), args["automationTrigger"],
                                                args.get("sourceJobId"), args.get("sourceStartTime"))
            except Exception as error:
                errors.append(str(error))
        if errors:
            raise RuntimeError("; ".join(errors))
        return {"organization": files, "encoding": compact, "backup": saved}
    task = args.get("task")
    if task == "organization":
        if mode in ("execute", "automation"):
            owner = args.get("reservation") or uuid.uuid4().hex
            log = reporter or protocol.Reporter()
            if not acquire_organization(client, owner, log):
                if mode == "automation":
                    reservation.defer_organization(args)
                    log.info("DirtyTasks organization is waiting: another file task is using the files. "
                             "It runs when that task finishes; recover an interrupted task in DirtyTasks.")
                    return {"coalesced": True}
                raise RuntimeError("Another file task is active. Finish, cancel, or recover it before starting this task.")
            try:
                return organization.run(payload, reporter)
            finally:
                reservation.release("organization", owner)
                reservation.queue_pending(client)
                encoding.queue_pending(client)
        return organization.run(payload, reporter)
    if task == "encoding":
        return encoding.run(payload, reporter)
    if task == "backup":
        return backup.run(client, reporter or protocol.Reporter(), args)
    raise ValueError("Choose an organization, encoding or backup task")


def main():
    return protocol.serve("DirtyTasks", run, quiet=True, exit_code=organization.exit_code_for,
                          public_error=lambda error: "File operation failed. Check Stash logs." if isinstance(error, OSError) else str(error))


if __name__ == "__main__":
    raise SystemExit(main())
