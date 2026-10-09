#!/usr/bin/env python3
"""Backend for the DirtyFileExtractor plugin.

Stash invokes this program with its raw plugin protocol: a JSON object is read
from stdin and a JSON result is written to stdout. The browser passes scene,
marker, or image IDs; source paths are always resolved from Stash's GraphQL API.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extract_scenes_destinations import (
    sanitize_folder_name, destination_key, resolve_destination,
    resolve_generated_destination, reserve_destination, marker_clip_basename, format_bytes,
)


from extract_scenes_plan import ExtractionOptions, ExtractionPlan, ExtractionProgress

PLUGIN_ID = "extractScenes"
VALID_COLLISION_POLICIES = {"rename", "skip", "overwrite"}
COPY_CHUNK_SIZE = 4 * 1024 * 1024
PROGRESS_INTERVAL_SECONDS = 0.5


for folder in ("dirtyPlugins", "DirtyPlugins"):  # installed plugin ID, then source directory
    shared = Path(__file__).resolve().parent.parent / folder
    if (shared / "dirty_plugins_storage.py").is_file():
        sys.path.insert(0, str(shared))
        break
else:
    raise RuntimeError("DirtyPlugins shared storage is not installed")
import dirty_plugins_storage as shared_storage
from dirty_plugins_client import StashClient as BaseClient
from dirty_plugins_protocol import Reporter, StashReporter
import dirty_plugins_protocol as protocol


class PluginError(RuntimeError):
    """An error that should be reported cleanly to Stash."""


class StashClient(BaseClient):
    def __init__(self, server_connection):
        super().__init__(server_connection, timeout=60, error_type=PluginError)

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
        data = self.call("query DirtyFileExtractorFFmpegPath { configuration { general { ffmpegPath } } }")
        configured = str(((data.get("configuration") or {}).get("general") or {}).get("ffmpegPath") or "").strip()
        executable = configured or shutil.which("ffmpeg")
        if not executable:
            raise PluginError(
                "FFmpeg is required to extract markers but was not found in Stash's "
                "configuration or PATH"
            )
        return executable

    def extract_marker_clip(self, source: Path, destination: Path, start_seconds: float, end_seconds: float, on_progress: Any) -> None:
        extract_marker_clip(self.ffmpeg_path(), source, destination, start_seconds, end_seconds, on_progress)


def read_payload(stream=None):
    return protocol.read_payload(stream, error_type=PluginError)


def emit_output(output, stream=None):
    protocol.emit_output(output, stream, ensure_ascii=False)


def emit_error(error, stream=None):
    protocol.emit_error(error, stream, ensure_ascii=False)


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


def selections_from_args(args: dict[str, Any]) -> dict[str, list[str]]:
    selections = {kind: _unique_ids(args.get(f"{kind}_ids")) for kind in ("scene", "marker", "image")}
    if not any(selections.values()):
        raise PluginError("Select at least one scene, marker, or image before starting the copy")
    return selections


def _discard_partial(path: Path) -> None:
    """Best-effort removal of an unfinished temporary output."""
    try:
        path.unlink(missing_ok=True)
    except OSError:
        pass


def copy_file_chunked(source: Path, destination: Path, on_chunk: Any, max_bytes_per_second: float = 0) -> None:
    """Copy through a temporary sibling while reporting transferred bytes."""
    temporary = destination.with_name(f".{destination.name}.extract-scenes-{uuid.uuid4().hex}.part")
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
        _discard_partial(temporary)
        raise


def _ffmpeg_timestamp(value: float) -> str:
    return f"{max(0.0, float(value)):.6f}"


def _parse_ffmpeg_time(value: str) -> float:
    try:
        hours, minutes, seconds = value.strip().split(":", 2)
        return int(hours) * 3600 + int(minutes) * 60 + float(seconds)
    except (TypeError, ValueError):
        return 0.0


def extract_marker_clip(ffmpeg_path: str, source: Path, destination: Path, start_seconds: float, end_seconds: float, on_progress: Any) -> None:
    """Create an accurate MP4 clip for one marker through FFmpeg."""
    duration = float(end_seconds) - float(start_seconds)
    if start_seconds < 0 or duration <= 0:
        raise PluginError(f"Invalid marker interval: {start_seconds!r} to {end_seconds!r}")
    temporary = destination.with_name(f".{destination.stem}.extract-scenes-{uuid.uuid4().hex}.part.mp4")
    command = [
        ffmpeg_path, "-hide_banner", "-loglevel", "error", "-nostdin",
        "-ss", _ffmpeg_timestamp(start_seconds), "-i", str(source), "-t", _ffmpeg_timestamp(duration),
        "-map", "0:v:0", "-map", "0:a?", "-map_metadata", "0",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", "-y", str(temporary),
    ]
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
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
            raise PluginError(f"FFmpeg marker extraction failed with exit code {return_code}" + (f": {detail}" if detail else ""))
        os.replace(temporary, destination)
        on_progress(1.0)
    except FileNotFoundError as exc:
        raise PluginError(f"FFmpeg executable was not found: {ffmpeg_path}") from exc
    except BaseException:
        _discard_partial(temporary)
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
            missing.append({"marker_id": marker_id, "reason": "marker has no parent scene"})
            continue
        items.append({
            **_scene_item(scene), "kind": "marker", "id": marker_id, "marker_title": marker.get("title"),
            "seconds": marker.get("seconds"), "end_seconds": marker.get("end_seconds"),
        })

    image_ids = selections.get("image", [])
    images_by_id = {
        str(image.get("id")): image for image in client.images(image_ids)
    } if image_ids else {}
    for image_id in image_ids:
        image = images_by_id.get(image_id)
        if not image:
            missing.append({"image_id": image_id, "reason": "image not found"})
            continue
        items.append({"kind": "image", "id": image_id, "title": image.get("title"), "folder_kind": "image",
                      "folder_id": image_id, "files": image.get("visual_files") or []})

    return items, missing


def _normalize_extraction_settings(settings: dict[str, Any]) -> ExtractionOptions:
    destination_value = str(settings.get("destinationFolder") or "").strip()
    if not destination_value:
        raise PluginError("Set Destination folder under Settings > Plugins > DirtyFileExtractor first")

    destination_root = Path(os.path.expandvars(os.path.expanduser(destination_value)))
    if destination_root.exists() and not destination_root.is_dir():
        raise PluginError(f"Destination is not a folder: {destination_root}")

    policy = str(settings.get("collisionPolicy") or "rename").strip().lower()
    if policy not in VALID_COLLISION_POLICIES:
        raise PluginError(f"File collision policy must be rename, skip, or overwrite (received {policy!r})")
    return ExtractionOptions(destination_root, policy, as_bool(settings.get("createSceneFolders")), as_bool(settings.get("dryRun")),
                             as_nonnegative_float(settings.get("maxCopySpeedMBps"), 20.0))


def _plan_extraction_items(items, options: ExtractionOptions, initial_missing=()) -> ExtractionPlan:
    plan = ExtractionPlan(operations=[], skipped=[], missing=list(initial_missing), destinations=set(), folders=[options.destination_root])
    seen_sources: set[str] = set()
    for item in items:
        _plan_extraction_item(item, options, plan, seen_sources)
    return plan


def _plan_extraction_item(item, options: ExtractionOptions, plan: ExtractionPlan, seen_sources: set[str]) -> None:
    dry_run, policy = options.dry_run, options.policy
    pending, skipped, missing, planned_destinations = plan.operations, plan.skipped, plan.missing, plan.destinations
    kind = str(item.get("kind") or "item")
    item_id = str(item.get("id") or "")
    item_destination = options.destination_root
    if options.create_item_folders:
        folder_name = sanitize_folder_name(item.get("title"), str(item.get("folder_id") or item_id), str(item.get("folder_kind") or kind))
        item_destination = options.destination_root / folder_name
        plan.folders.append(item_destination)

    files = item.get("files") or []
    if not files:
        missing.append({f"{kind}_id": item_id, "reason": f"{kind} has no files"})
        return

    if kind == "marker":
        try:
            start_seconds = float(item.get("seconds"))
            end_seconds = float(item.get("end_seconds"))
        except (TypeError, ValueError):
            missing.append({"marker_id": item_id, "reason": "marker has no valid end time"})
            return
        if start_seconds < 0 or end_seconds <= start_seconds:
            missing.append({"marker_id": item_id, "reason": "marker interval is invalid"})
            return
        source_info = files[0]
        source = Path(str(source_info.get("path") or ""))
        if not source.is_file():
            missing.append({"marker_id": item_id, "source": str(source), "reason": "source file not found"})
            return
        basename = marker_clip_basename(str(source_info.get("basename") or source.name), item.get("marker_title"), item_id)
        final_destination, action = resolve_generated_destination(item_destination / basename, policy, planned_destinations)
        if action == "skip":
            skipped.append({"marker_id": item_id, "source": str(source), "reason": action})
            return
        planned_destinations.add(destination_key(final_destination))
        pending.append({
            "kind": "marker", "marker_id": item_id, "source_path": source, "seconds": start_seconds, "end_seconds": end_seconds,
            "destination_path": final_destination, "action": "dry-run" if dry_run else action, "size": 0,
        })
        return

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
        final_destination, action = resolve_destination(source, item_destination / basename, policy, planned_destinations)
        if action in {"skip", "same-file"}:
            skipped.append({"source": str(source), "reason": action})
            continue
        planned_destinations.add(destination_key(final_destination))
        pending.append({
            "kind": kind, "source_path": source, "destination_path": final_destination,
            "action": "dry-run" if dry_run else action, "size": source.stat().st_size,
        })


def _execute_extraction_plan(plan: ExtractionPlan, options: ExtractionOptions, reporter, marker_clip_extractor):
    pending, planned_destinations, skipped = plan.operations, plan.destinations, plan.skipped
    policy, dry_run = options.policy, options.dry_run
    copied: list[dict[str, str]] = []
    failed: list[dict[str, str]] = []
    if not dry_run:
        for folder in plan.folders:
            folder.mkdir(parents=True, exist_ok=True)
    progress = ExtractionProgress(pending, reporter, PROGRESS_INTERVAL_SECONDS)
    for index, item in enumerate(pending, start=1):
        source = item["source_path"]
        final_destination = item["destination_path"]
        file_size = int(item["size"])

        claimed = False
        if not dry_run and policy != "overwrite":
            claimed = reserve_destination(final_destination)
            if not claimed:
                # Another process claimed the planned name after planning.
                # Release our reservation and resolve a fresh collision.
                planned_destinations.discard(destination_key(final_destination))
                if item["kind"] == "marker":
                    final_destination, action = resolve_generated_destination(final_destination, policy, planned_destinations)
                else:
                    final_destination, action = resolve_destination(source, final_destination, policy, planned_destinations)
                if action in {"skip", "same-file"}:
                    skipped.append({"source": str(source), "reason": action})
                    continue
                if not reserve_destination(final_destination):
                    raise PluginError(
                        f"Destination {final_destination} was claimed by another "
                        "process. Re-run the extraction to resolve collisions."
                    )
                planned_destinations.add(destination_key(final_destination))
                claimed = True
                item["destination_path"] = final_destination

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
            try:
                if item["kind"] == "marker" and marker_clip_extractor is None:
                    raise PluginError("Marker clip extraction is unavailable")
                if item["kind"] == "marker":
                    marker_clip_extractor(source, final_destination, float(item["seconds"]), float(item["end_seconds"]),
                                          progress.marker_callback(index))
                else:
                    copy_file_chunked(source, final_destination, progress.copy_callback(), options.max_copy_speed_bytes)
            except BaseException as exc:
                if claimed:
                    try:
                        if final_destination.stat().st_size == 0:
                            final_destination.unlink()
                    except OSError:
                        pass
                if not isinstance(exc, Exception):
                    # Never swallow KeyboardInterrupt/SystemExit.
                    raise
                # A single unreadable source or failed copy must not discard the
                # items already completed in this run.
                reporter.error(f"[{index}/{len(pending)}] Failed {source}: {exc}")
                failed.append({"source": str(source), "destination": str(final_destination), "kind": str(item["kind"]), "error": str(exc)})
                continue

        progress.complete(index, file_size)
        reporter.info(f"[{index}/{len(pending)}] Finished {final_destination}")
        copied.append({"source": str(source), "destination": str(final_destination), "action": str(item["action"]), "kind": str(item["kind"])})

    return copied, failed


def _extraction_result(options, requested_counts, copied, skipped, missing, failed):
    return {
        "destination": str(options.destination_root),
        "dry_run": options.dry_run,
        "scenes_requested": requested_counts.get("scene", 0),
        "markers_requested": requested_counts.get("marker", 0),
        "images_requested": requested_counts.get("image", 0),
        "files_copied": len(copied),
        "marker_clips_extracted": sum(1 for item in copied if item.get("kind") == "marker"),
        "files_skipped": len(skipped),
        "files_missing": len(missing),
        "files_failed": len(failed),
        "copied": copied,
        "skipped": skipped,
        "missing": missing,
        "failed": failed,
    }


def _copy_resolved_items(
    items: Iterable[dict[str, Any]],
    requested_counts: dict[str, int],
    settings: dict[str, Any],
    reporter: Reporter | None = None,
    initial_missing: Iterable[dict[str, str]] = (),
    marker_clip_extractor: Any | None = None,
) -> dict[str, Any]:
    reporter = reporter or Reporter()
    options = _normalize_extraction_settings(settings)
    total_requested = sum(requested_counts.values())
    reporter.info(f"Preparing {total_requested} selected item{'s' if total_requested != 1 else ''}")
    reporter.progress(0.0)
    plan = _plan_extraction_items(items, options, initial_missing)
    pending = plan.operations
    size_description = format_bytes(sum(int(item["size"]) for item in pending))
    marker_clip_count = sum(1 for item in pending if item["kind"] == "marker")
    if marker_clip_count:
        size_description += f" plus {marker_clip_count} marker clip{'s' if marker_clip_count != 1 else ''}"
    reporter.info(f"Resolved {len(pending)} file{'s' if len(pending) != 1 else ''} ({size_description}) for destination {options.destination_root}")
    if options.max_copy_speed_mib > 0:
        reporter.info(f"Copy speed limited to {options.max_copy_speed_mib:g} MiB/s")
    else:
        reporter.info("Copy speed is unlimited")

    copied, failed = _execute_extraction_plan(plan, options, reporter, marker_clip_extractor)
    reporter.progress(1.0)
    reporter.info(
        f"DirtyFileExtractor finished: {len(copied)} copied, {len(plan.skipped)} skipped, "
        f"{len(plan.missing)} missing, {len(failed)} failed"
    )
    return _extraction_result(options, requested_counts, copied, plan.skipped, plan.missing, failed)


def copy_selected(
    client: StashClient,
    selections: dict[str, list[str]],
    settings: dict[str, Any],
    reporter: Reporter | None = None,
) -> dict[str, Any]:
    items, missing = resolve_selected_items(client, selections)
    counts = {kind: len(selections.get(kind, [])) for kind in selections}
    return _copy_resolved_items(items, counts, settings, reporter, missing, getattr(client, "extract_marker_clip", None))


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
    settings = shared_storage.get_plugin_settings(PLUGIN_ID)
    return copy_selected(client, selections_from_args(args), settings, reporter)


def main() -> int:
    protocol.configure_standard_streams()
    return protocol.run_logged_backend(
        "DirtyFileExtractor", run, read_payload, emit_output, emit_error, StashReporter(), time.monotonic,
    )


if __name__ == "__main__":
    raise SystemExit(main())
