"""Read embedded text subtitles through FFmpeg pipes; never write sidecars."""
from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import threading
import time

from dirty_plugins_client import contain_child_process

TEXT_CODECS = {
    "mov_text", "subrip", "srt", "webvtt", "ass", "ssa", "text", "microdvd",
    "sami", "realtext", "subviewer", "subviewer1", "mpl2", "jacosub", "vplayer", "pjs",
}
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
MAX_TRACKS = 16


class CaptionError(RuntimeError):
    pass


def run_tool(command, timeout=120, limit=MAX_OUTPUT_BYTES):
    """Bound pipe output and execution time, and reap children on every exit."""
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    cleanup = lambda: None
    chunks, errors = [], []
    oversized = threading.Event()

    def read_output():
        total = 0
        while True:
            chunk = process.stdout.read(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                oversized.set()
                process.kill()
                break
            chunks.append(chunk)

    def read_errors():
        # Drain stderr even after the retained diagnostic is full.
        total = 0
        while True:
            chunk = process.stderr.read(4096)
            if not chunk:
                break
            if total < 4096:
                errors.append(chunk[:4096 - total])
                total += len(chunk)

    readers = []
    try:
        cleanup = contain_child_process(process)
        readers = [threading.Thread(target=read_output), threading.Thread(target=read_errors)]
        for reader in readers:
            reader.start()
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            raise CaptionError("Caption extraction timed out. Try again or check the media storage.")
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        for reader in readers:
            reader.join()
        process.stdout.close()
        process.stderr.close()
        cleanup()
    if oversized.is_set():
        raise CaptionError("Embedded caption data exceeds the 8 MiB limit.")
    if process.returncode:
        # Diagnostic stays server-side; do not expose private paths in the UI.
        raise CaptionError("Caption tool failed: " + b"".join(errors).decode("utf-8", errors="replace").strip())
    return b"".join(chunks)


def file_identity(path):
    stat = Path(path).stat()
    return stat.st_size, stat.st_mtime_ns


def probe_subtitles(ffprobe, path):
    raw = run_tool([ffprobe, "-v", "error", "-select_streams", "s", "-show_entries",
                    "stream=index,codec_name:stream_tags=language,title:stream_disposition=default,forced",
                    "-of", "json", str(path)], timeout=30, limit=1024 * 1024)
    streams = json.loads(raw).get("streams", [])
    if not isinstance(streams, list) or any(not isinstance(item, dict) for item in streams):
        raise CaptionError("ffprobe returned invalid subtitle metadata.")
    return streams


def read_captions(ffprobe, ffmpeg, path, on_probe=None):
    deadline = time.monotonic() + 120
    original = file_identity(path)
    streams = probe_subtitles(ffprobe, path)
    if on_probe:
        on_probe(streams, original)
    tracks, warnings, retryable = [], [], False
    text_streams = [stream for stream in streams if stream.get("codec_name") in TEXT_CODECS]
    unsupported = sorted({stream.get("codec_name") or "unknown" for stream in streams
                          if stream.get("codec_name") not in TEXT_CODECS})
    if unsupported:
        warnings.append("Unsupported embedded subtitle formats: " + ", ".join(unsupported) + ". Only text subtitles are supported.")
    if len(text_streams) > MAX_TRACKS:
        warnings.append("Only the first 16 embedded text tracks were loaded.")
    total = 0
    for stream in text_streams[:MAX_TRACKS]:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            warnings.append("Caption extraction timed out. Check the media storage and retry.")
            retryable = True
            break
        if total >= MAX_OUTPUT_BYTES:
            warnings.append("The 8 MiB caption limit was reached.")
            break
        index = int(stream["index"])
        try:
            data = run_tool([ffmpeg, "-hide_banner", "-v", "error", "-nostdin", "-i", str(path),
                             "-map", "0:" + str(index), "-c:s", "webvtt", "-f", "webvtt", "pipe:1"],
                            timeout=remaining, limit=MAX_OUTPUT_BYTES - total)
            vtt = data.decode("utf-8-sig")
            if not vtt.startswith("WEBVTT"):
                raise CaptionError("Caption conversion did not return WebVTT.")
            if "-->" not in vtt:
                continue  # Empty tracks are common in MP4 files.
            total += len(data)
            tags, disposition = stream.get("tags") or {}, stream.get("disposition") or {}
            tracks.append({"index": index, "codec": stream["codec_name"],
                           "language": str(tags.get("language") or "und"),
                           "title": str(tags.get("title") or ""),
                           "default": bool(disposition.get("default")),
                           "forced": bool(disposition.get("forced")), "vtt": vtt})
        except (CaptionError, UnicodeError) as error:
            # Keep successful tracks, and give a safe, actionable UI message.
            print("\x01e\x02DirtyCaptions stream {}: {}".format(index, error), file=sys.stderr)
            warnings.append("Could not load embedded subtitle track {}. Check the Stash log and retry.".format(index))
            retryable = True
    if file_identity(path) != original:
        raise CaptionError("The scene file changed during caption extraction. Reload the scene and try again.")
    return {"tracks": tracks, "warnings": warnings, "retryable": retryable}
