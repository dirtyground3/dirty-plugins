#!/usr/bin/env python3
"""Backend for the DirtyFileExtractor plugin.

Stash invokes this program with its raw plugin protocol: a JSON object is read
from stdin and a JSON result is written to stdout. The browser passes scene,
marker, or image IDs; source paths are always resolved from Stash's GraphQL API.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
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

    def markers(self, marker_ids: Iterable[str]) -> list[dict[str, Any]]:
        query = """
          query DirtyFileExtractorMarkers($ids: [ID!]) {
            findSceneMarkers(ids: $ids) {
              scene_markers {
                id
                title
                seconds
                end_seconds
                scene { id title files { id path basename } }
              }
            }
          }
        """
        data = self.call(query, {"ids": [str(value) for value in marker_ids]})
        result = data.get("findSceneMarkers") or {}
        return result.get("scene_markers") or []

    def images(self, image_ids: Iterable[str]) -> list[dict[str, Any]]:
        query = """
          query DirtyFileExtractorImages($ids: [ID!]) {
            findImages(ids: $ids) {
              images {
                id
                title
                visual_files {
                  ... on ImageFile { id path basename }
                  ... on VideoFile { id path basename }
                }
              }
            }
          }
        """
        data = self.call(query, {"ids": [str(value) for value in image_ids]})
        result = data.get("findImages") or {}
        return result.get("images") or []

    def ffmpeg_path(self) -> str:
        data = self.call(
            """
            query DirtyFileExtractorFFmpegPath {
              configuration { general { ffmpegPath } }
            }
            """
        )
        configured = str(
            ((data.get("configuration") or {}).get("general") or {}).get(
                "ffmpegPath"
            )
            or ""
        ).strip()
        executable = configured or shutil.which("ffmpeg")
        if not executable:
            raise PluginError(
                "FFmpeg is required to extract markers but was not found in Stash's "
                "configuration or PATH"
            )
        return executable

    def extract_marker_clip(
        self,
        source: Path,
        destination: Path,
        start_seconds: float,
        end_seconds: float,
        on_progress: Any,
    ) -> None:
        extract_marker_clip(
            self.ffmpeg_path(),
            source,
            destination,
            start_seconds,
            end_seconds,
            on_progress,
        )


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


def _unique_ids(raw_ids: Any) -> list[str]:
    if raw_ids is None:
        return []
    if not isinstance(raw_ids, list):
        raise PluginError("Selected item IDs must be provided as a list")
    result: list[str] = []
    seen: set[str] = set()
    for value in raw_ids:
        item_id = str(value).strip()
        if item_id and item_id not in seen:
            result.append(item_id)
            seen.add(item_id)
    return result


def scene_ids_from_args(args: dict[str, Any]) -> list[str]:
    raw_ids = args.get("scene_ids")
    if raw_ids is None and args.get("scene_id") is not None:
        raw_ids = [args.get("scene_id")]
    result = _unique_ids(raw_ids)
    if not result:
        raise PluginError("Select at least one scene before starting the copy")
    return result


def selections_from_args(args: dict[str, Any]) -> dict[str, list[str]]:
    selections: dict[str, list[str]] = {}
    for kind in ("scene", "marker", "image"):
        raw_ids = args.get(f"{kind}_ids")
        if raw_ids is None and args.get(f"{kind}_id") is not None:
            raw_ids = [args.get(f"{kind}_id")]
        selections[kind] = _unique_ids(raw_ids)
    if not any(selections.values()):
        raise PluginError(
            "Select at least one scene, marker, or image before starting the copy"
        )
    return selections


def sanitize_folder_name(
    title: str | None,
    item_id: str,
    item_kind: str = "scene",
) -> str:
    name = INVALID_FOLDER_CHARS.sub("_", (title or "").strip())
    name = re.sub(r"\s+", " ", name).strip(" .")
    if not name:
        name = f"{item_kind}-{item_id}"
    # Leave room for paths on systems where long path support is disabled.
    return name[:120].rstrip(" .") or f"{item_kind}-{item_id}"


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


def resolve_generated_destination(requested: Path, policy: str) -> tuple[Path, str]:
    """Resolve a collision for generated media without a local source path."""
    if not requested.exists():
        return requested, "extract"
    if policy == "skip":
        return requested, "skip"
    if policy == "overwrite":
        return requested, "overwrite"
    return renamed_destination(requested), "rename"


def marker_clip_basename(
    source_basename: str,
    marker_title: str | None,
    marker_id: str,
) -> str:
    source_stem = Path(source_basename).stem.strip() or "scene"
    marker_name = INVALID_FOLDER_CHARS.sub("_", (marker_title or "").strip())
    marker_name = re.sub(r"\s+", " ", marker_name).strip(" .")
    if not marker_name:
        marker_name = "marker"
    suffix = ".mp4"
    stem = f"{source_stem} - {marker_name} [marker-{marker_id}]"
    stem = stem[: max(1, 220 - len(suffix))].rstrip(" .")
    return (stem or f"marker-{marker_id}") + suffix


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


def _ffmpeg_timestamp(value: float) -> str:
    return f"{max(0.0, float(value)):.6f}"


def _parse_ffmpeg_time(value: str) -> float:
    try:
        hours, minutes, seconds = value.strip().split(":", 2)
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except (TypeError, ValueError):
        return 0.0


def extract_marker_clip(
    ffmpeg_path: str,
    source: Path,
    destination: Path,
    start_seconds: float,
    end_seconds: float,
    on_progress: Any,
) -> None:
    """Create an accurate MP4 clip for one marker through FFmpeg."""
    duration = float(end_seconds) - float(start_seconds)
    if start_seconds < 0 or duration <= 0:
        raise PluginError(
            f"Invalid marker interval: {start_seconds!r} to {end_seconds!r}"
        )
    temporary = destination.with_name(
        f".{destination.stem}.extract-scenes-{uuid.uuid4().hex}.part.mp4"
    )
    command = [
        ffmpeg_path,
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-ss",
        _ffmpeg_timestamp(start_seconds),
        "-i",
        str(source),
        "-t",
        _ffmpeg_timestamp(duration),
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-map_metadata",
        "0",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
        "-y",
        str(temporary),
    ]
    try:
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        output_lines: list[str] = []
        assert process.stdout is not None
        for raw_line in process.stdout:
            line = raw_line.strip()
            if line.startswith("out_time="):
                elapsed = _parse_ffmpeg_time(line.split("=", 1)[1])
                on_progress(min(max(elapsed / duration, 0.0), 1.0))
            elif line and not line.startswith("progress="):
                output_lines.append(line)
                output_lines = output_lines[-20:]
        process.stdout.close()
        return_code = process.wait()
        if return_code != 0:
            detail = "\n".join(output_lines).strip()
            raise PluginError(
                f"FFmpeg marker extraction failed with exit code {return_code}"
                + (f": {detail}" if detail else "")
            )
        os.replace(temporary, destination)
        on_progress(1.0)
    except FileNotFoundError as exc:
        raise PluginError(f"FFmpeg executable was not found: {ffmpeg_path}") from exc
    except BaseException:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _scene_item(scene: dict[str, Any]) -> dict[str, Any]:
    scene_id = str(scene.get("id") or "")
    return {
        "kind": "scene",
        "id": scene_id,
        "title": scene.get("title"),
        "folder_kind": "scene",
        "folder_id": scene_id,
        "files": scene.get("files") or [],
    }


def resolve_selected_items(
    client: StashClient,
    selections: dict[str, list[str]],
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    items: list[dict[str, Any]] = []
    missing: list[dict[str, str]] = []

    for scene_id in selections.get("scene", []):
        scene = client.scene(scene_id)
        if scene:
            items.append(_scene_item(scene))
        else:
            missing.append({"scene_id": scene_id, "reason": "scene not found"})

    marker_ids = selections.get("marker", [])
    markers_by_id = {
        str(marker.get("id")): marker for marker in client.markers(marker_ids)
    } if marker_ids else {}
    for marker_id in marker_ids:
        marker = markers_by_id.get(marker_id)
        if not marker:
            missing.append({"marker_id": marker_id, "reason": "marker not found"})
            continue
        scene = marker.get("scene")
        if not scene:
            missing.append(
                {"marker_id": marker_id, "reason": "marker has no parent scene"}
            )
            continue
        scene_id = str(scene.get("id") or "")
        items.append(
            {
                "kind": "marker",
                "id": marker_id,
                "title": scene.get("title"),
                "marker_title": marker.get("title"),
                "seconds": marker.get("seconds"),
                "end_seconds": marker.get("end_seconds"),
                "folder_kind": "scene",
                "folder_id": scene_id,
                "files": scene.get("files") or [],
            }
        )

    image_ids = selections.get("image", [])
    images_by_id = {
        str(image.get("id")): image for image in client.images(image_ids)
    } if image_ids else {}
    for image_id in image_ids:
        image = images_by_id.get(image_id)
        if not image:
            missing.append({"image_id": image_id, "reason": "image not found"})
            continue
        items.append(
            {
                "kind": "image",
                "id": image_id,
                "title": image.get("title"),
                "folder_kind": "image",
                "folder_id": image_id,
                "files": image.get("visual_files") or [],
            }
        )

    return items, missing


def _copy_resolved_items(
    items: Iterable[dict[str, Any]],
    requested_counts: dict[str, int],
    settings: dict[str, Any],
    reporter: Reporter | None = None,
    initial_missing: Iterable[dict[str, str]] = (),
    marker_clip_extractor: Any | None = None,
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

    create_item_folders = as_bool(settings.get("createSceneFolders"))
    dry_run = as_bool(settings.get("dryRun"))
    max_copy_speed_mib = as_nonnegative_float(
        settings.get("maxCopySpeedMBps"), 20.0
    )
    max_copy_speed_bytes = max_copy_speed_mib * 1024 * 1024
    if not dry_run:
        destination_root.mkdir(parents=True, exist_ok=True)

    copied: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    missing: list[dict[str, str]] = list(initial_missing)
    pending: list[dict[str, Any]] = []
    seen_sources: set[str] = set()
    resolved_items = list(items)
    total_requested = sum(requested_counts.values())

    reporter.info(
        f"Preparing {total_requested} selected item"
        f"{'s' if total_requested != 1 else ''}"
    )
    reporter.progress(0.0)

    for item in resolved_items:
        kind = str(item.get("kind") or "item")
        item_id = str(item.get("id") or "")
        item_destination = destination_root
        if create_item_folders:
            folder_name = sanitize_folder_name(
                item.get("title"),
                str(item.get("folder_id") or item_id),
                str(item.get("folder_kind") or kind),
            )
            item_destination = destination_root / folder_name
            if not dry_run:
                item_destination.mkdir(parents=True, exist_ok=True)

        files = item.get("files") or []
        if not files:
            missing.append(
                {f"{kind}_id": item_id, "reason": f"{kind} has no files"}
            )
            continue

        if kind == "marker":
            try:
                start_seconds = float(item.get("seconds"))
                end_seconds = float(item.get("end_seconds"))
            except (TypeError, ValueError):
                missing.append(
                    {"marker_id": item_id, "reason": "marker has no valid end time"}
                )
                continue
            if start_seconds < 0 or end_seconds <= start_seconds:
                missing.append(
                    {"marker_id": item_id, "reason": "marker interval is invalid"}
                )
                continue
            source_info = files[0]
            source = Path(str(source_info.get("path") or ""))
            if not source.is_file():
                missing.append(
                    {
                        "marker_id": item_id,
                        "source": str(source),
                        "reason": "source file not found",
                    }
                )
                continue
            basename = marker_clip_basename(
                str(source_info.get("basename") or source.name),
                item.get("marker_title"),
                item_id,
            )
            requested_destination = item_destination / basename
            final_destination, action = resolve_generated_destination(
                requested_destination, policy
            )
            if action == "skip":
                skipped.append(
                    {
                        "marker_id": item_id,
                        "source": str(source),
                        "reason": action,
                    }
                )
                continue
            pending.append(
                {
                    "kind": "marker",
                    "marker_id": item_id,
                    "source_path": source,
                    "seconds": start_seconds,
                    "end_seconds": end_seconds,
                    "destination_path": final_destination,
                    "action": "dry-run" if dry_run else action,
                    "size": 0,
                }
            )
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
            requested_destination = item_destination / basename
            final_destination, action = resolve_destination(source, requested_destination, policy)

            if action in {"skip", "same-file"}:
                skipped.append({"source": str(source), "reason": action})
                continue

            pending.append(
                {
                    "kind": kind,
                    "source_path": source,
                    "destination_path": final_destination,
                    "action": "dry-run" if dry_run else action,
                    "size": source.stat().st_size,
                }
            )

    total_bytes = sum(int(item["size"]) for item in pending)
    marker_clip_count = sum(1 for item in pending if item["kind"] == "marker")
    size_description = format_bytes(total_bytes)
    if marker_clip_count:
        size_description += (
            f" plus {marker_clip_count} marker clip"
            f"{'s' if marker_clip_count != 1 else ''}"
        )
    reporter.info(
        f"Resolved {len(pending)} file{'s' if len(pending) != 1 else ''} "
        f"({size_description}) for destination {destination_root}"
    )
    if max_copy_speed_mib > 0:
        reporter.info(f"Copy speed limited to {max_copy_speed_mib:g} MiB/s")
    else:
        reporter.info("Copy speed is unlimited")

    completed_bytes = 0
    last_progress_time = 0.0
    use_byte_progress = marker_clip_count == 0
    for index, item in enumerate(pending, start=1):
        source = item["source_path"]
        final_destination = item["destination_path"]
        file_size = int(item["size"])
        if item["kind"] == "marker":
            reporter.info(
                f"[{index}/{len(pending)}] Extracting marker {item['marker_id']} "
                f"({item.get('seconds')}–{item.get('end_seconds')} seconds) from "
                f"{source} -> {final_destination}"
            )
        else:
            reporter.info(
                f"[{index}/{len(pending)}] Copying {source} -> {final_destination} "
                f"({format_bytes(file_size)})"
            )

        if not dry_run:
            if item["kind"] == "marker" and marker_clip_extractor is None:
                raise PluginError("Marker clip extraction is unavailable")
            file_copied = 0

            def on_chunk(chunk_size: int) -> None:
                nonlocal file_copied, last_progress_time
                file_copied += chunk_size
                now = time.monotonic()
                if (
                    use_byte_progress
                    and now - last_progress_time >= PROGRESS_INTERVAL_SECONDS
                ):
                    denominator = total_bytes or max(len(pending), 1)
                    numerator = completed_bytes + file_copied
                    reporter.progress(numerator / denominator)
                    last_progress_time = now

            if item["kind"] == "marker":
                def on_marker_progress(value: float) -> None:
                    reporter.progress(
                        ((index - 1) + min(max(float(value), 0.0), 1.0))
                        / max(len(pending), 1)
                    )

                marker_clip_extractor(
                    source,
                    final_destination,
                    float(item["seconds"]),
                    float(item["end_seconds"]),
                    on_marker_progress,
                )
            else:
                copy_file_chunked(
                    source,
                    final_destination,
                    on_chunk,
                    max_copy_speed_bytes,
                )

        completed_bytes += file_size
        if use_byte_progress and total_bytes:
            reporter.progress(completed_bytes / total_bytes)
        elif pending:
            reporter.progress(index / len(pending))
        reporter.info(f"[{index}/{len(pending)}] Finished {final_destination}")
        copied.append(
            {
                "source": str(source),
                "destination": str(final_destination),
                "action": str(item["action"]),
                "kind": str(item["kind"]),
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
        "scenes_requested": requested_counts.get("scene", 0),
        "markers_requested": requested_counts.get("marker", 0),
        "images_requested": requested_counts.get("image", 0),
        "files_copied": len(copied),
        "marker_clips_extracted": sum(
            1 for item in copied if item.get("kind") == "marker"
        ),
        "files_skipped": len(skipped),
        "files_missing": len(missing),
        "copied": copied,
        "skipped": skipped,
        "missing": missing,
    }


def copy_scenes(
    client: StashClient,
    scene_ids: Iterable[str],
    settings: dict[str, Any],
    reporter: Reporter | None = None,
) -> dict[str, Any]:
    """Backward-compatible scene-only entry point used by existing callers."""
    requested_scene_ids = list(scene_ids)
    items: list[dict[str, Any]] = []
    missing: list[dict[str, str]] = []
    for scene_id in requested_scene_ids:
        scene = client.scene(scene_id)
        if scene:
            items.append(_scene_item(scene))
        else:
            missing.append({"scene_id": scene_id, "reason": "scene not found"})
    return _copy_resolved_items(
        items,
        {"scene": len(requested_scene_ids), "marker": 0, "image": 0},
        settings,
        reporter,
        missing,
    )


def copy_selected(
    client: StashClient,
    selections: dict[str, list[str]],
    settings: dict[str, Any],
    reporter: Reporter | None = None,
) -> dict[str, Any]:
    items, missing = resolve_selected_items(client, selections)
    counts = {kind: len(selections.get(kind, [])) for kind in selections}
    return _copy_resolved_items(
        items,
        counts,
        settings,
        reporter,
        missing,
        getattr(client, "extract_marker_clip", None),
    )


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
    return copy_selected(client, selections_from_args(args), settings, reporter)


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
