#!/usr/bin/env python3
"""Backend for the DirtyFileExtractor plugin.

Stash invokes this program with its raw plugin protocol: a JSON object is read
from stdin and a JSON result is written to stdout.  The browser passes scene
IDs only; source paths are always resolved from Stash's own GraphQL API.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Iterable


PLUGIN_ID = "extractScenes"
VALID_COLLISION_POLICIES = {"rename", "skip", "overwrite"}
INVALID_FOLDER_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
COPY_CHUNK_SIZE = 4 * 1024 * 1024
PROGRESS_INTERVAL_SECONDS = 0.5


class PluginError(RuntimeError):
    """An error that should be reported cleanly to Stash."""


class Reporter:
    """No-op reporter used by library callers and unit tests."""

    def info(self, _message: str) -> None:
        pass

    def error(self, _message: str) -> None:
        pass

    def progress(self, _value: float) -> None:
        pass


class StashReporter(Reporter):
    """Write Stash's encoded log and task-progress protocol to stderr."""

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

        api_key = server_connection.get("ApiKey")
        if api_key:
            self.headers["ApiKey"] = str(api_key)

    def call(self, query: str, variables: dict[str, Any] | None = None) -> dict[str, Any]:
        body = json.dumps(
            {"query": query, "variables": variables or {}},
            ensure_ascii=False,
        ).encode("utf-8")
        request = urllib.request.Request(self.url, data=body, headers=self.headers)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                result = json.load(response)
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise PluginError(f"Could not contact Stash GraphQL: {exc}") from exc

        errors = result.get("errors") or []
        if errors:
            messages = "; ".join(str(error.get("message", error)) for error in errors)
            raise PluginError(f"Stash GraphQL returned an error: {messages}")
        return result.get("data") or {}

    def plugin_settings(self) -> dict[str, Any]:
        query = """
          query ExtractScenesSettings($ids: [ID!]) {
            configuration { plugins(include: $ids) }
          }
        """
        data = self.call(query, {"ids": [PLUGIN_ID]})
        plugins = (data.get("configuration") or {}).get("plugins") or {}
        return plugins.get(PLUGIN_ID) or {}

    def scene(self, scene_id: str) -> dict[str, Any] | None:
        query = """
          query ExtractScenesScene($id: ID!) {
            findScene(id: $id) {
              id
              title
              files { id path basename }
            }
          }
        """
        data = self.call(query, {"id": str(scene_id)})
        return data.get("findScene")


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


def as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    if value is None:
        return default
    return bool(value)


def as_nonnegative_float(value: Any, default: float) -> float:
    if value is None or value == "":
        return default
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise PluginError(f"Expected a non-negative number, received {value!r}") from exc
    if result < 0:
        raise PluginError(f"Expected a non-negative number, received {value!r}")
    return result


def scene_ids_from_args(args: dict[str, Any]) -> list[str]:
    raw_ids = args.get("scene_ids")
    if raw_ids is None and args.get("scene_id") is not None:
        raw_ids = [args.get("scene_id")]
    if not isinstance(raw_ids, list):
        raise PluginError("Select at least one scene before starting the copy")

    result: list[str] = []
    seen: set[str] = set()
    for value in raw_ids:
        scene_id = str(value).strip()
        if scene_id and scene_id not in seen:
            result.append(scene_id)
            seen.add(scene_id)
    if not result:
        raise PluginError("Select at least one scene before starting the copy")
    return result


def sanitize_folder_name(title: str | None, scene_id: str) -> str:
    name = INVALID_FOLDER_CHARS.sub("_", (title or "").strip())
    name = re.sub(r"\s+", " ", name).strip(" .")
    if not name:
        name = f"scene-{scene_id}"
    # Leave room for paths on systems where long path support is disabled.
    return name[:120].rstrip(" .") or f"scene-{scene_id}"


def renamed_destination(path: Path) -> Path:
    """Return path or the first free `name (N).ext` sibling."""
    if not path.exists():
        return path
    stem, suffix = path.stem, path.suffix
    index = 2
    while True:
        candidate = path.with_name(f"{stem} ({index}){suffix}")
        if not candidate.exists():
            return candidate
        index += 1


def resolve_destination(source: Path, requested: Path, policy: str) -> tuple[Path, str]:
    """Resolve a collision and return (destination, action)."""
    try:
        if requested.exists() and source.samefile(requested):
            return requested, "same-file"
    except OSError:
        pass

    if not requested.exists():
        return requested, "copy"
    if policy == "skip":
        return requested, "skip"
    if policy == "overwrite":
        return requested, "overwrite"
    return renamed_destination(requested), "rename"


def format_bytes(value: int) -> str:
    size = float(max(value, 0))
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if size < 1024 or unit == "TiB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{int(size)} B"
        size /= 1024
    return f"{size:.1f} TiB"


def copy_file_chunked(
    source: Path,
    destination: Path,
    on_chunk: Any,
    max_bytes_per_second: float = 0,
) -> None:
    """Copy through a temporary sibling while reporting transferred bytes."""
    temporary = destination.with_name(
        f".{destination.name}.extract-scenes-{uuid.uuid4().hex}.part"
    )
    started = time.monotonic()
    transferred = 0
    try:
        with source.open("rb") as input_file, temporary.open("xb") as output_file:
            while True:
                chunk = input_file.read(COPY_CHUNK_SIZE)
                if not chunk:
                    break
                output_file.write(chunk)
                transferred += len(chunk)
                on_chunk(len(chunk))
                if max_bytes_per_second > 0:
                    expected_elapsed = transferred / max_bytes_per_second
                    delay = expected_elapsed - (time.monotonic() - started)
                    if delay > 0:
                        time.sleep(delay)
        shutil.copystat(source, temporary)
        os.replace(temporary, destination)
    except BaseException:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def copy_scenes(
    client: StashClient,
    scene_ids: Iterable[str],
    settings: dict[str, Any],
    reporter: Reporter | None = None,
) -> dict[str, Any]:
    reporter = reporter or Reporter()
    destination_value = str(settings.get("destinationFolder") or "").strip()
    if not destination_value:
        raise PluginError(
            "Set Destination folder under Settings > Plugins > DirtyFileExtractor first"
        )

    destination_root = Path(os.path.expandvars(os.path.expanduser(destination_value)))
    if destination_root.exists() and not destination_root.is_dir():
        raise PluginError(f"Destination is not a folder: {destination_root}")

    policy = str(settings.get("collisionPolicy") or "rename").strip().lower()
    if policy not in VALID_COLLISION_POLICIES:
        raise PluginError(
            "File collision policy must be rename, skip, or overwrite "
            f"(received {policy!r})"
        )

    create_scene_folders = as_bool(settings.get("createSceneFolders"))
    dry_run = as_bool(settings.get("dryRun"))
    max_copy_speed_mib = as_nonnegative_float(
        settings.get("maxCopySpeedMBps"), 20.0
    )
    max_copy_speed_bytes = max_copy_speed_mib * 1024 * 1024
    if not dry_run:
        destination_root.mkdir(parents=True, exist_ok=True)

    copied: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    missing: list[dict[str, str]] = []
    pending: list[dict[str, Any]] = []
    seen_sources: set[str] = set()
    requested_scene_ids = list(scene_ids)

    reporter.info(
        f"Preparing {len(requested_scene_ids)} selected scene"
        f"{'s' if len(requested_scene_ids) != 1 else ''}"
    )
    reporter.progress(0.0)

    for scene_id in requested_scene_ids:
        scene = client.scene(scene_id)
        if not scene:
            missing.append({"scene_id": scene_id, "reason": "scene not found"})
            continue

        scene_destination = destination_root
        if create_scene_folders:
            folder_name = sanitize_folder_name(scene.get("title"), scene_id)
            scene_destination = destination_root / folder_name
            if not dry_run:
                scene_destination.mkdir(parents=True, exist_ok=True)

        files = scene.get("files") or []
        if not files:
            missing.append({"scene_id": scene_id, "reason": "scene has no files"})
            continue

        for file_info in files:
            source = Path(str(file_info.get("path") or ""))
            source_key = os.path.normcase(os.path.abspath(str(source)))
            if source_key in seen_sources:
                skipped.append({"source": str(source), "reason": "duplicate selection"})
                continue
            seen_sources.add(source_key)

            if not source.is_file():
                missing.append({"source": str(source), "reason": "source file not found"})
                continue

            basename = str(file_info.get("basename") or source.name)
            requested_destination = scene_destination / basename
            final_destination, action = resolve_destination(source, requested_destination, policy)

            if action in {"skip", "same-file"}:
                skipped.append({"source": str(source), "reason": action})
                continue

            pending.append(
                {
                    "source_path": source,
                    "destination_path": final_destination,
                    "action": "dry-run" if dry_run else action,
                    "size": source.stat().st_size,
                }
            )

    total_bytes = sum(int(item["size"]) for item in pending)
    reporter.info(
        f"Resolved {len(pending)} file{'s' if len(pending) != 1 else ''} "
        f"({format_bytes(total_bytes)}) for destination {destination_root}"
    )
    if max_copy_speed_mib > 0:
        reporter.info(f"Copy speed limited to {max_copy_speed_mib:g} MiB/s")
    else:
        reporter.info("Copy speed is unlimited")

    completed_bytes = 0
    last_progress_time = 0.0
    for index, item in enumerate(pending, start=1):
        source = item["source_path"]
        final_destination = item["destination_path"]
        file_size = int(item["size"])
        reporter.info(
            f"[{index}/{len(pending)}] Copying {source} -> {final_destination} "
            f"({format_bytes(file_size)})"
        )

        if not dry_run:
            file_copied = 0

            def on_chunk(chunk_size: int) -> None:
                nonlocal file_copied, last_progress_time
                file_copied += chunk_size
                now = time.monotonic()
                if now - last_progress_time >= PROGRESS_INTERVAL_SECONDS:
                    denominator = total_bytes or max(len(pending), 1)
                    numerator = completed_bytes + file_copied
                    reporter.progress(numerator / denominator)
                    last_progress_time = now

            copy_file_chunked(
                source,
                final_destination,
                on_chunk,
                max_copy_speed_bytes,
            )

        completed_bytes += file_size
        if total_bytes:
            reporter.progress(completed_bytes / total_bytes)
        elif pending:
            reporter.progress(index / len(pending))
        reporter.info(f"[{index}/{len(pending)}] Finished {final_destination}")
        copied.append(
            {
                "source": str(source),
                "destination": str(final_destination),
                "action": str(item["action"]),
            }
        )

    reporter.progress(1.0)
    reporter.info(
        f"DirtyFileExtractor finished: {len(copied)} copied, {len(skipped)} skipped, "
        f"{len(missing)} missing"
    )

    return {
        "destination": str(destination_root),
        "dry_run": dry_run,
        "scenes_requested": len(requested_scene_ids),
        "files_copied": len(copied),
        "files_skipped": len(skipped),
        "files_missing": len(missing),
        "copied": copied,
        "skipped": skipped,
        "missing": missing,
    }


def run(payload: dict[str, Any], reporter: Reporter | None = None) -> dict[str, Any]:
    reporter = reporter or Reporter()
    server_connection = payload.get("server_connection") or {}
    if not isinstance(server_connection, dict):
        raise PluginError("Missing Stash server connection details")
    args = payload.get("args") or {}
    if not isinstance(args, dict):
        raise PluginError("Plugin arguments must be an object")

    reporter.info("DirtyFileExtractor started")
    client = StashClient(server_connection)
    reporter.info("Reading DirtyFileExtractor settings")
    settings = client.plugin_settings()
    return copy_scenes(client, scene_ids_from_args(args), settings, reporter)


def main() -> int:
    reporter = StashReporter()
    try:
        emit_output(run(read_payload(), reporter))
        return 0
    except Exception as exc:  # Stash must always receive a valid protocol response.
        reporter.error(f"DirtyFileExtractor failed: {exc}")
        emit_error(exc)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
