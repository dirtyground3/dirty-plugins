"""Back up Stash's database, blobs and configuration and the DirtyPlugins database into one zip."""
from __future__ import annotations

from contextlib import closing
from datetime import datetime
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
import time
import uuid
import zipfile

import dirty_plugins_storage as storage
import dirty_tasks_settings as settings

QUERY = """{configuration{general{databasePath backupDirectoryPath blobsPath blobsStorage configFilePath scrapersPath}}
version{version}}"""
# Stash reads these from the folder that holds its configuration file.
CUSTOM_FILES = ("custom.css", "custom.js", "custom-locales.json")
STATUS_NAMESPACE = "dirtyTasks.backup"
AUTOMATION_NAMESPACE = "dirtyTasks.backupAutomation"
BACKUP_NAME = re.compile(r"dirty-backup-\d{8}_\d{6}\.zip")
DESCRIPTION = "DirtyTasks: backup: "


def snapshot(source: Path, target: Path) -> None:
    """Copy a live SQLite database, its WAL included, through SQLite's backup API."""
    with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True, timeout=30)) as live, \
            closing(sqlite3.connect(target)) as copy:
        live.backup(copy)


def folder_files(folder: Path, prefix: str, skip: Path):
    """Every file below folder as (path, archive name), without Python caches or the backup itself."""
    for root, directories, files in os.walk(folder):
        directories[:] = sorted(name for name in directories if name != "__pycache__")
        for name in sorted(files):
            path = Path(root, name)
            if name.endswith(".pyc") or path.resolve() == skip:
                continue
            yield path, prefix + "/" + path.relative_to(folder).as_posix()


def run(client, reporter, args=None):
    """The Stash task: create a backup with the saved options, then keep only the newest ones."""
    trigger = (args or {}).get("automationTrigger")
    if trigger and settings.get_section("execution")["backup"] != trigger:
        reporter.info("DirtyTasks skipped a queued backup because its trigger changed before it started.")
        return {"skipped": True}
    options = settings.get_section("backup")
    try:
        result = create(client, reporter, options)
    except Exception as error:
        storage.update_json_metadata(STATUS_NAMESPACE, "status", lambda current: dict(
            current, failure={"time": time.time(), "error": str(error) if not isinstance(error, OSError)
                              else "Could not read or write a backup file. Check Stash logs."}))
        raise
    result["removed"] = prune(Path(result["path"]).parent, options["keep"], reporter)
    storage.set_metadata(STATUS_NAMESPACE, "status", json.dumps({"success": dict(result, time=time.time())}))
    return result


def status():
    raw = storage.get_metadata(STATUS_NAMESPACE, "status")
    return json.loads(raw) if raw else {}


def prune(folder, keep, reporter):
    """Delete the oldest DirtyTasks backups in folder beyond keep (0 keeps all)."""
    if not keep:
        return 0
    backups = sorted((item for item in folder.iterdir() if item.is_file() and BACKUP_NAME.fullmatch(item.name)),
                     key=lambda item: item.name, reverse=True)
    for item in backups[keep:]:
        item.unlink()
    removed = max(0, len(backups) - keep)
    if removed:
        reporter.info("DirtyTasks removed " + str(removed) + " older backup" + ("s" if removed > 1 else "")
                      + ", keeping the newest " + str(keep) + ".")
    return removed


def queue_automation(client, reporter, trigger, job_id, start_time):
    """Queue one backup after a completed Scan or Generate observed by any tab."""
    if settings.get_section("execution")["backup"] != trigger:
        return {"skipped": True, "reason": "disabled"}
    if storage.internal_scan_check(job_id, start_time):
        return {"skipped": True, "reason": "internal"}
    key = json.dumps([trigger, str(job_id), str(start_time)], separators=(",", ":"))
    token = uuid.uuid4().hex
    claimed = storage.update_json_metadata(AUTOMATION_NAMESPACE, key, lambda current: current or {"token": token})
    if claimed.get("token") != token:
        return {"skipped": True, "reason": "duplicate"}
    try:
        queued = client.queue("dirtyTasks", {"task": "backup", "automationTrigger": trigger},
                              DESCRIPTION + "after " + trigger.title() + " #" + str(job_id))
    except Exception:
        storage.delete_metadata(AUTOMATION_NAMESPACE, key, expected=json.dumps(claimed))
        raise
    return {"queuedJobId": str(queued)}


def create(client, reporter, options):
    stash = client.call(QUERY)
    general = stash["configuration"]["general"]
    database = Path(general["databasePath"])
    if not database.is_file():
        raise RuntimeError("Stash's database file was not found")
    destination = Path(options["folder"] or general.get("backupDirectoryPath") or database.parent)
    destination.mkdir(parents=True, exist_ok=True)
    name = "dirty-backup-" + datetime.now().strftime("%Y%m%d_%H%M%S") + ".zip"
    final = destination / name
    partial = destination / (name + ".partial")
    if final.exists():
        raise RuntimeError("A backup named " + name + " already exists; run the task again")

    # (path, archive name, compress): blobs are already compressed images.
    entries = []
    config = Path(general["configFilePath"]) if general.get("configFilePath") else None
    if options["configuration"] and config and config.is_file():
        entries.append((config, config.name, True))
        entries += [(config.parent / item, item, True) for item in CUSTOM_FILES if (config.parent / item).is_file()]
    skip = partial.resolve()
    blobs = Path(general["blobsPath"]) if general.get("blobsPath") else None
    if options["blobs"] and general.get("blobsStorage") == "FILESYSTEM" and blobs and blobs.is_dir():
        entries += [(path, archive, False) for path, archive in folder_files(blobs, "blobs", skip)]
    scrapers = Path(general["scrapersPath"]) if general.get("scrapersPath") else None
    if options["scrapers"] and scrapers and scrapers.is_dir():
        entries += [(path, archive, True) for path, archive in folder_files(scrapers, "scrapers", skip)]
    dirty = storage.database_path()
    if not options["dirtyPlugins"] or not dirty.is_file():
        dirty = None

    sizes = [path.stat().st_size for path, _archive, _compress in entries]
    databases = sum(path.stat().st_size for path in (database, dirty) if path)
    total = sum(sizes) + databases
    # Each database copy waits in a temporary folder beside the zip while it is added.
    if shutil.disk_usage(destination).free < total + databases:
        raise RuntimeError("Not enough free space in the backup folder for about " + megabytes(total + databases))

    done = 0
    reported = -1.0

    def advance(size):
        nonlocal done, reported
        done += size
        value = done / total if total else 1.0
        if value - reported >= 0.01:
            reported = value
            reporter.progress(value)

    try:
        with tempfile.TemporaryDirectory(dir=destination, prefix=".dirty-backup-") as temporary, \
                partial.open("xb") as stream, zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as archive:
            # Databases first: the blobs they reference are copied afterwards.
            copy = Path(temporary, database.name)
            snapshot(database, copy)
            archive.write(copy, database.name)
            copy.unlink()
            advance(database.stat().st_size)
            names = [database.name]
            if dirty:
                copy = storage.backup_database(Path(temporary, dirty.name))
                archive.write(copy, dirty.name)
                copy.unlink()
                advance(dirty.stat().st_size)
                names.append(dirty.name)
            for (path, archived, compress), size in zip(entries, sizes):
                archive.write(path, archived, zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED)
                advance(size)
            restore = {database.name: str(database)}
            if dirty:
                restore[dirty.name] = str(dirty)
            if any(archived.startswith("blobs/") for _path, archived, _compress in entries):
                restore["blobs"] = str(blobs)
            if any(archived.startswith("scrapers/") for _path, archived, _compress in entries):
                restore["scrapers"] = str(scrapers)
            if options["configuration"] and config:
                restore["configuration"] = str(config.parent)
            archive.writestr("backup.json", json.dumps({
                "created": datetime.now().astimezone().isoformat(timespec="seconds"),
                "stashVersion": stash.get("version", {}).get("version"),
                "databases": names,
                "files": len(entries),
                "restoreTo": restore,
            }, indent=2))
        os.replace(partial, final)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    size = final.stat().st_size
    reporter.progress(1.0)
    reporter.info("DirtyTasks backed up " + ", ".join(names) + " and " + str(len(entries)) + " files to "
                  + str(final) + " (" + megabytes(size) + ")")
    return {"path": str(final), "size": size, "files": len(entries) + len(names)}


def megabytes(size):
    return str(round(size / 1048576, 1)) + " MB"
