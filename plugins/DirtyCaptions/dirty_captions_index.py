"""Maintain filterable caption metadata without persisting subtitle text."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import sys
import time
import uuid

import dirty_plugins_storage as storage
from dirty_captions_media import CaptionError, TEXT_CODECS, file_identity, probe_subtitles

PLUGIN_ID = "dirtyCaptions"
NAMESPACE = "dirtyCaptions.index"
FILES = "dirtyCaptions.files"
SCENES = "dirtyCaptions.scenes"
PENDING = "dirtyCaptions.pending"
ANY_FIELD = "Contains embedded captions"
TEXT_FIELD = "Contains embedded text captions"
STATUS_FIELD = "Caption index status"
OWN_FIELDS = (ANY_FIELD, TEXT_FIELD, STATUS_FIELD)
MUTATION_ID = "dirtyCaptions:index:v1"
LEASE_SECONDS = 1200
FILE_FIELDS = "id path size mod_time fingerprints{type value}"
SCENE_QUERY = "query($id:ID!){findScene(id:$id){id custom_fields files{" + FILE_FIELDS + "}}}"


def enabled():
    return storage.get_plugin_settings(PLUGIN_ID).get("indexEnabled", True) not in (False, "false", 0)


def read_record(namespace, key):
    return json.loads(storage.get_metadata(namespace, str(key)) or "{}")


def status():
    state = read_record(NAMESPACE, "state")
    # Do not return file paths or internal queue/lease identifiers to the browser.
    return {key: state.get(key) for key in (
        "status", "jobId", "started", "finished", "lastFullScan", "checked", "probed", "skipped", "errors", "total", "forceRun"
    )}


def path_key(path):
    return hashlib.sha256(str(Path(path).resolve()).encode("utf-8")).hexdigest()


def fingerprint(path):
    return [path_key(path), *file_identity(path)]


def failure_location(path):
    # A changed location may restore access after a failed check. Use a lexical
    # path identity so even failed cached files require no filesystem lookup.
    return hashlib.sha256(str(Path(path).absolute()).encode("utf-8")).hexdigest()


def stash_identity(file):
    """Read identity from Stash's database; never open or stat the media file."""
    if file.get("size") is None or not file.get("mod_time"):
        return None
    return {"size": int(file["size"]), "mtime": file["mod_time"], "hashes": {
        item["type"]: item["value"] for item in file.get("fingerprints", [])
        if item.get("type") in ("md5", "oshash") and item.get("value")
    }}


def cached_file(file, records=None):
    cached = read_record(FILES, file["id"]) if records is None else records.get(str(file["id"]), {})
    source = stash_identity(file)
    previous = cached.get("stash")
    if source is not None and previous:
        if source["size"] != previous["size"] or source["mtime"] != previous["mtime"]:
            return None
        # Generated phashes and newly added hash algorithms do not mean that
        # the source changed. Compare content hashes present in both snapshots.
        if any(source["hashes"][key] != value for key, value in previous["hashes"].items() if key in source["hashes"]):
            return None
        if cached.get("failed") and cached.get("location") != failure_location(file["path"]):
            return None
        if source != previous:
            cached["stash"] = source
            storage.set_metadata(FILES, str(file["id"]), json.dumps(cached))
        return cached
    return None


def indexed_file(file):
    """Return the saved result of a file Stash reports unchanged; never open the media."""
    cached = cached_file(file) if enabled() else None
    return cached if cached and not cached.get("failed") else None


def stream_flags(streams):
    # Retain only the facts needed by filters, never dialogue or full probe output.
    return {"any": bool(streams), "text": any(item.get("codec_name") in TEXT_CODECS for item in streams)}


def save_file(file, streams, identity):
    record = dict(stream_flags(streams), fingerprint=identity, stash=stash_identity(file))
    storage.set_metadata(FILES, str(file["id"]), json.dumps(record))
    return record


def save_failed_file(file):
    source = stash_identity(file)
    if source is not None:
        storage.set_metadata(FILES, str(file["id"]), json.dumps({
            "stash": source, "failed": True, "location": failure_location(file["path"]),
        }))
    else:
        storage.delete_metadata(FILES, file["id"])


def tool_path(client):
    general = client.call("{configuration{general{ffprobePath}}}")["configuration"]["general"]
    tool = general.get("ffprobePath") or shutil.which("ffprobe")
    if not tool:
        raise CaptionError("ffprobe is unavailable. Configure its path in Stash.")
    return tool


def inspect_file(file, tool, force=False):
    cached = None if force else cached_file(file)
    if cached:
        if cached.get("failed"):
            raise CaptionError("A previous caption check failed. Use Reprobe all files to retry unchanged files.")
        return cached, False
    path = Path(file["path"])
    identity = fingerprint(path)
    streams = probe_subtitles(tool() if callable(tool) else tool, path)
    if fingerprint(path) != identity:
        raise CaptionError("The scene file changed during caption detection.")
    return save_file(file, streams, identity), True


def update_state(lease_token, **values):
    def update(state):
        if state.get("token") != lease_token:
            raise CaptionError("This caption-index task has been superseded.")
        state.update(values)
        if state.get("token") == lease_token:
            state["expires"] = time.time() + LEASE_SECONDS
        return state
    return storage.update_json_metadata(NAMESPACE, "state", update)


def active(token):
    state = read_record(NAMESPACE, "state")
    return state.get("token") == token and not state.get("cancel")


def caption_fields(records, failed=False):
    complete = bool(records) and all(record is not None for record in records)
    fields = {STATUS_FIELD: "Ready" if complete else "Error" if failed else "Unknown"}
    for name, flag in ((ANY_FIELD, "any"), (TEXT_FIELD, "text")):
        if any(record and record[flag] for record in records):
            fields[name] = "Yes"
        elif complete:
            fields[name] = "No"
    return fields, complete


def needs_scene(scene, file_records, scene_records):
    """Skip indexed scenes using database metadata alone, before file access."""
    records = [cached_file(file, file_records) for file in scene.get("files", [])]
    if any(record is None for record in records):
        return True
    snapshot = scene_records.get(str(scene["id"]), {})
    if not snapshot:
        return True
    files = sorted(str(file["id"]) for file in scene.get("files", []))
    if snapshot.get("files") != files:
        return True
    failed = any(record.get("failed") for record in records)
    fields, unused = caption_fields([None if record.get("failed") else record for record in records], failed)
    current = scene.get("custom_fields") or {}
    if any(current.get(key) != fields.get(key) for key in OWN_FIELDS):
        return True
    return False


def inspect_scene(client, scene, tool, force=False, token=None, force_files=None):
    records, fresh_records, probed, failed = [], [], 0, False
    for file in scene.get("files", []):
        if token and not active(token):
            return None
        try:
            force_file = force and (force_files is None or str(file["id"]) not in force_files)
            if force_file and force_files is not None:
                force_files.add(str(file["id"]))
            record, fresh = inspect_file(file, tool, force_file)
            records.append(record)
            fresh_records.append(fresh)
            probed += int(fresh)
        except Exception as error:
            failed = True
            records.append(None)
            fresh_records.append(False)
            save_failed_file(file)
            print("\x01e\x02DirtyCaptions index: scene {} file {}: {}".format(scene["id"], file["id"], error), file=sys.stderr)
        if token:
            update_state(token)
    # Recheck the attachment list and fingerprints immediately before publishing.
    latest = client.call(SCENE_QUERY, {"id": str(scene["id"])}).get("findScene")
    if not latest:
        storage.delete_metadata(SCENES, scene["id"])
        return {"probed": probed, "error": False}
    attachments = lambda value: [(str(item["id"]), item["path"], stash_identity(item)) for item in value.get("files", [])]
    if attachments(latest) != attachments(scene):
        enqueue_scene(client, scene["id"], start=False)
        records = [None for item in latest.get("files", [])]
        failed = False
    for position, (file, record) in enumerate(zip(scene.get("files", []), records)):
        if record and fresh_records[position]:
            try:
                if fingerprint(file["path"]) != record["fingerprint"]:
                    raise CaptionError("File changed before publishing caption metadata.")
            except (OSError, CaptionError):
                records[position] = None
                failed = True
                save_failed_file(file)
    fields, complete = caption_fields(records, failed)
    current = latest.get("custom_fields") or {}
    partial = {key: value for key, value in fields.items() if current.get(key) != value}
    remove = [key for key in OWN_FIELDS if key not in fields and key in current]
    if token and not active(token):
        return None
    if partial or remove:
        client.call("mutation($input:SceneUpdateInput!){sceneUpdate(input:$input){id}}", {"input": {
            "id": str(scene["id"]), "clientMutationId": MUTATION_ID,
            "custom_fields": {"partial": partial, "remove": remove},
        }})
    storage.set_metadata(SCENES, str(scene["id"]), json.dumps({"status": fields[STATUS_FIELD], "checked": time.time(),
        "files": sorted(str(file["id"]) for file in latest.get("files", []))}))
    return {"probed": probed, "error": not complete}


def recover(client):
    state = read_record(NAMESPACE, "state")
    if not state.get("token") or not state.get("jobId") or time.time() - state.get("queued", 0) < 30:
        return
    jobs = client.call("{jobQueue{id status}}").get("jobQueue") or []
    if any(str(job["id"]) == str(state["jobId"]) for job in jobs):
        return
    def update(current):
        if current.get("token") == state["token"]:
            current.update(token=None, expires=0, status="Interrupted", full=True,
                           force=current.get("force", False) or current.get("forceRun", False))
        return current
    storage.update_json_metadata(NAMESPACE, "state", update)


def schedule(client):
    token = uuid.uuid4().hex
    pending = bool(storage.list_metadata(PENDING))
    def claim(state):
        if state.get("paused"):
            return state
        if state.get("token") and state.get("expires", 0) > time.time():
            return state
        if not pending and not state.get("full"):
            return state
        if state.get("scanning"):
            state["full"] = True
        state.update(token=token, expires=time.time() + LEASE_SECONDS, status="Queued", cancel=False,
                     queued=time.time(), jobId=None, checked=0, probed=0, skipped=0, errors=0, total=None, forceRun=False)
        return state
    state = storage.update_json_metadata(NAMESPACE, "state", claim)
    if state.get("token") != token:
        return status()
    try:
        job_id = client.queue(PLUGIN_ID, {"mode": "indexWorker", "token": token}, "DirtyCaptions: refresh caption index")
        def attach(state):
            if state.get("token") == token:
                state["jobId"] = str(job_id)
            return state
        storage.update_json_metadata(NAMESPACE, "state", attach)
    except Exception:
        def release(state):
            if state.get("token") == token:
                state.update(token=None, expires=0, status="Interrupted")
            return state
        storage.update_json_metadata(NAMESPACE, "state", release)
        raise
    return status()


def enqueue_scene(client, scene_id, start=True):
    scene_id = str(scene_id)
    if not scene_id.isdigit():
        raise CaptionError("A scene ID is required.")
    storage.set_metadata(PENDING, scene_id, uuid.uuid4().hex)
    return schedule(client) if start else status()


def hook(client, context):
    scene_id = str(context.get("id") or "")
    if not scene_id.isdigit():
        return status()
    if context.get("type") == "Scene.Destroy.Post":
        storage.delete_metadata(SCENES, scene_id)
        storage.delete_metadata(PENDING, scene_id)
        return status()
    source = context.get("input") or {}
    fields = set(context.get("inputFields") or [])
    playback_fields = {"id", "clientMutationId", "resume_time", "play_count", "play_duration", "o_counter"}
    if source.get("clientMutationId") == MUTATION_ID or (fields and fields <= playback_fields) or not enabled():
        return status()
    return enqueue_scene(client, scene_id)


def record_playback(client, scene, file, streams, original):
    if not enabled():
        return
    try:
        known = indexed_file(file)
        if known and all(known[key] == value for key, value in stream_flags(streams).items()):
            return  # The map already holds this result: nothing to save or queue.
        identity = fingerprint(file["path"])
        if identity[1:] != list(original):
            return
        save_file(file, streams, identity)
        enqueue_scene(client, scene["id"])
    except Exception as error:
        # Index maintenance must never prevent subtitle playback.
        print("\x01e\x02DirtyCaptions index update: " + str(error), file=sys.stderr)


def request_refresh(client, force=False):
    recover(client)
    def update(state):
        state.update(full=True, paused=False, force=bool(force) or state.get("force", False))
        return state
    storage.update_json_metadata(NAMESPACE, "state", update)
    return schedule(client)


def bootstrap(client):
    """Start the initial index or recover queued work when the UI opens."""
    if not enabled():
        return status()
    recover(client)
    state = read_record(NAMESPACE, "state")
    if state.get("paused"):
        return status()
    if not state.get("lastFullScan"):
        if not state.get("scanning") and not state.get("full"):
            return request_refresh(client)
    return schedule(client)


def after_scan(client, args):
    """Request one refresh per completed Scan, shared across browser tabs."""
    settings = storage.get_plugin_settings(PLUGIN_ID)
    if not enabled() or settings.get("refreshAfterScan", False) not in (True, "true", 1):
        return dict(status(), skipped="disabled")
    job_id = str(args.get("jobId") or "")
    start_time = args.get("startTime")
    if not job_id.isdigit() or not isinstance(start_time, str) or not start_time:
        raise CaptionError("The completed Scan's job ID and start time are required.")
    if storage.internal_scan_check(job_id, start_time):
        return dict(status(), skipped="internal")
    recover(client)
    key = json.dumps([job_id, start_time])
    def claim(state):
        if state.get("paused"):
            return state
        handled = state.get("handledScans", [])
        if key not in handled:
            state.update(handledScans=(handled + [key])[-50:], full=True)
        return state
    storage.update_json_metadata(NAMESPACE, "state", claim)
    # A failed queue request leaves full=True, so even a replay can retry it.
    # Replayed events never request another pass of an already completed index.
    return schedule(client)


class WorkerContext:
    """Resources shared by pending hooks and a full traversal, for one lease."""
    def __init__(self, client, token: str):
        self.client = client
        self.token = token
        self.counts = {"checked": 0, "probed": 0, "skipped": 0, "errors": 0}
        self.probe_tool = None
        self.force_files: set[str] = set()
        self.file_records: dict[str, dict] = {}
        self.scene_records: dict[str, dict] = {}

    def tool(self):
        if self.probe_tool is None:
            self.probe_tool = tool_path(self.client)
        return self.probe_tool

    def account_outcome(self, scene, outcome):
        self.counts["checked"] += 1
        self.counts["probed"] += outcome["probed"]
        self.counts["errors"] += int(outcome["error"])
        update_state(self.token, **self.counts)
        for file in scene.get("files", []):
            self.file_records[str(file["id"])] = read_record(FILES, file["id"])
        self.scene_records[str(scene["id"])] = read_record(SCENES, scene["id"])

    def refresh_records(self):
        self.file_records = {key: json.loads(value) for key, value in storage.list_metadata(FILES).items()}
        self.scene_records = {key: json.loads(value) for key, value in storage.list_metadata(SCENES).items()}


def process_pending_batch(context: WorkerContext, force=False):
    for scene_id, revision in list(storage.list_metadata(PENDING).items())[:100]:
        if not active(context.token):
            break
        scene = context.client.call(SCENE_QUERY, {"id": scene_id}).get("findScene")
        if scene:
            outcome = inspect_scene(context.client, scene, context.tool, force, context.token, context.force_files)
            if outcome is None:
                break
            context.account_outcome(scene, outcome)
        else:
            storage.delete_metadata(SCENES, scene_id)
        # Only remove the revision we read; a hook may have queued a newer one.
        storage.delete_metadata(PENDING, scene_id, expected=revision)


def traverse_full_scan(context: WorkerContext, force: bool):
    token = context.token
    update_state(token, full=False, force=False, scanning=True, forceRun=bool(force))
    cursor = 0
    process_pending_batch(context, force)
    context.refresh_records()
    while active(token):
        result = context.client.call("query($filter:FindFilterType!,$scene:SceneFilterType!){findScenes(filter:$filter,scene_filter:$scene){count scenes{id custom_fields files{" + FILE_FIELDS + "}}}}", {
            "filter": {"per_page": 100, "page": 1, "sort": "id", "direction": "ASC"},
            "scene": {"id": {"value": cursor, "modifier": "GREATER_THAN"}},
        })["findScenes"]
        scenes = result["scenes"]
        if not scenes:
            break
        if not cursor:
            update_state(token, total=result["count"])
        for scene in scenes:
            if not active(token):
                break
            pending = storage.get_metadata(PENDING, str(scene["id"]))
            cursor = max(cursor, int(scene["id"]))
            if not force and pending is None and not needs_scene(scene, context.file_records, context.scene_records):
                context.counts["skipped"] += 1
                continue
            outcome = inspect_scene(context.client, scene, context.tool, force, token, context.force_files)
            if outcome is None:
                break
            context.account_outcome(scene, outcome)
            if pending is not None:
                storage.delete_metadata(PENDING, scene["id"], expected=pending)
            if context.counts["checked"] % 5 == 0:
                process_pending_batch(context, force)
        if len(scenes) < 100:
            break
        update_state(token, **context.counts)
    if active(token):
        update_state(token, scanning=False, lastFullScan=time.time(), **context.counts)


def complete_worker_lease(token):
    """Release atomically so a concurrent hook can claim the next worker."""
    def finish(current):
        if current.get("token") == token and not current.get("full"):
            current.update(token=None, expires=0, status="Finished", finished=time.time())
        return current
    return storage.update_json_metadata(NAMESPACE, "state", finish)


def worker(client, token):
    if not active(token):
        if token and read_record(NAMESPACE, "state").get("token") == token:
            update_state(token, token=None, expires=0, status="Cancelled", finished=time.time())
        return status()
    update_state(token, status="Running", started=time.time(), finished=None)
    context = WorkerContext(client, token)
    try:
        while active(token):
            state = read_record(NAMESPACE, "state")
            if state.get("full"):
                traverse_full_scan(context, state.get("force", False))
                continue
            if not storage.list_metadata(PENDING):
                if complete_worker_lease(token).get("token") != token:
                    break
                continue
            process_pending_batch(context)
    except Exception:
        update_state(token, token=None, expires=0, status="Interrupted", full=True, scanning=False)
        raise
    finally:
        state = read_record(NAMESPACE, "state")
        if state.get("token") == token:
            update_state(token, token=None, expires=0, status="Cancelled", scanning=False, full=True, finished=time.time())
    # Catch hooks arriving just before the lease was released.
    if enabled() and (storage.list_metadata(PENDING) or read_record(NAMESPACE, "state").get("full")):
        schedule(client)
    return status()


def run(client, args):
    mode = args.get("mode")
    if mode == "indexStatus":
        return status()
    if mode == "indexRefresh":
        return request_refresh(client, args.get("force") is True)
    if mode == "indexBootstrap":
        return bootstrap(client)
    if mode == "indexAfterScan":
        return after_scan(client, args)
    if mode == "indexWorker":
        return worker(client, str(args.get("token") or ""))
    if mode == "indexHook":
        return hook(client, args.get("hookContext") or {})
    if mode == "indexCancel":
        storage.update_json_metadata(NAMESPACE, "state", lambda state: dict(state, cancel=True, paused=True, full=False))
        return status()
    raise CaptionError("Unknown DirtyCaptions operation.")
