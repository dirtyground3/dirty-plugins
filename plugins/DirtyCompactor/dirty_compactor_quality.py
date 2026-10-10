"""Constant-quality encoding and VMAF-guided quality search for DirtyCompactor.

Quality presets use each encoder's constant-quality mode (CRF, CQ, ICQ, or
constant QP) instead of a bitrate, so the encoder spends as many bits as each
scene needs. "Match visual quality" encodes short sample clips during
planning and keeps the highest CRF whose VMAF score still reaches the target.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path
import re
import shutil
import subprocess
import threading
import time

from dirty_plugins_client import contain_child_process
from dirty_compactor_metadata import CONSTANTS
from dirty_compactor_rules import PluginError, visual_preset

# Constant-quality value per preset (generated; shared with the browser). Hardware
# encoders use the same number on their own quality scale, which is close to but
# not identical to CRF.
CRF = CONSTANTS["crf"]
# Search bounds for "Match visual quality": lower values are higher quality.
CRF_RANGE = {"h264": (14, 34), "hevc": (16, 36)}
# The search starts at the matching preset and interpolates between measured
# scores, so it needs at most this many tests (usually two or three).
SEARCH_STEPS = 4
# Typical VMAF change per CRF step, used before two points are measured.
VMAF_PER_CRF = 1.0
# Bump when the measurement changes so remembered results are not reused.
SEARCH_VERSION = 3
SAMPLE_SECONDS = 4.0
SAMPLE_POINTS = (0.2, 0.5, 0.8)
VMAF_SCORE = re.compile(r"VMAF score[:=]\s*([0-9.]+)")
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def quality_args(encoder, value, maxrate=None):
    """Constant-quality arguments for the first video stream.

    ``maxrate`` (bits per second) keeps an output from exceeding the source's
    bitrate on encoders whose quality mode honours a VBV cap.
    """
    value = str(int(value))
    if encoder.startswith("lib"):
        args = ["-crf:v:0", value]
    elif encoder.endswith("_nvenc"):
        args = ["-rc:v:0", "vbr", "-cq:v:0", value, "-b:v:0", "0"]
    elif encoder.endswith("_qsv"):
        args = ["-global_quality:v:0", value]
    elif encoder.endswith("_amf"):
        args = ["-rc:v:0", "cqp", "-qp_i:v:0", value, "-qp_p:v:0", value]
    else:
        raise PluginError("No constant-quality mode for encoder " + encoder)
    if maxrate and (encoder.startswith("lib") or encoder.endswith("_nvenc")):
        args += ["-maxrate:v:0", str(int(maxrate)), "-bufsize:v:0", str(int(maxrate * 2))]
    return args


def sample_windows(duration):
    """Start time and length of the clips measured for one video."""
    if duration <= SAMPLE_SECONDS * len(SAMPLE_POINTS):
        return [(0.0, max(0.5, min(duration, SAMPLE_SECONDS * len(SAMPLE_POINTS))))]
    return [(max(0.0, duration * point - SAMPLE_SECONDS / 2), SAMPLE_SECONDS) for point in SAMPLE_POINTS]


def _run(command, stop=lambda: None, *, timeout=900):
    """Contain FFmpeg, bound diagnostics, and poll cancellation even with silent pipes."""
    process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=NO_WINDOW)
    cleanup = lambda: None
    reader = None
    diagnostic = bytearray()
    def read():
        while True:
            chunk = process.stderr.read(8192)
            if not chunk:
                break
            diagnostic.extend(chunk)
            del diagnostic[:-65536]
    try:
        cleanup = contain_child_process(process)
        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        deadline = time.monotonic() + timeout
        while process.poll() is None:
            stop()
            if time.monotonic() >= deadline:
                raise PluginError("Quality sample timed out")
            try:
                process.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                pass
        stop()
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        cleanup()
        if reader:
            reader.join(timeout=2)
        process.stderr.close()
    stderr = diagnostic.decode(errors="replace")
    if process.returncode:
        raise PluginError("Quality sample failed: " + stderr[-600:])
    return stderr


def measure(ffmpeg, source, window, dimensions, encoder, value, clip, stop=lambda: None, threads=None):
    """Encode one clip; return (VMAF score, clip bytes)."""
    start, length = window
    threads = threads or max(1, os.cpu_count() or 1)
    width, height = dimensions
    command = [ffmpeg, "-hide_banner", "-v", "error", "-nostdin", "-y", "-filter_threads", "1", "-ss", "%.3f" % start, "-t", "%.3f" % length,
               "-threads", "1", "-i", str(source), "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", "scale=%d:%d" % (width, height),
               "-fps_mode", "passthrough", "-c:v:0", encoder] + quality_args(encoder, value)
    if encoder.startswith("lib"):
        command += ["-preset", "medium"]
    _run(command + ["-threads:v:0", str(threads), "-f", "matroska", str(clip)], stop)
    # libvmaf takes [distorted][reference]; compare at the output resolution.
    # Pair frames by position, not timestamp: WMV/ASF timestamps are irregular
    # and timestamp pairing scored even a lossless copy at only ~91.
    graph = ("[0:v:0]scale=%d:%d:flags=bicubic,setpts=N/(25*TB),format=yuv420p[ref];"
             "[1:v:0]setpts=N/(25*TB),format=yuv420p[dist];"
             "[dist][ref]libvmaf=n_threads=%d" % (width, height, threads))
    output = _run([ffmpeg, "-hide_banner", "-v", "info", "-nostdin", "-filter_complex_threads", "1", "-ss", "%.3f" % start, "-t", "%.3f" % length,
                   "-threads", "1", "-i", str(source), "-threads", "1", "-i", str(clip), "-lavfi", graph, "-f", "null", "-"], stop)
    match = VMAF_SCORE.search(output)
    if not match:
        raise PluginError("FFmpeg did not report a VMAF score; an FFmpeg build with libvmaf is required")
    return float(match.group(1)), clip.stat().st_size


def next_value(tested, target, bounds):
    """Next constant-quality value to test, or None when the answer is known.

    ``tested`` maps values to mean VMAF. Higher values are smaller files and
    lower scores. The answer is the highest value that reaches ``target``.
    """
    lowest, highest = bounds
    passing = [value for value, vmaf in tested.items() if vmaf >= target]
    failing = [value for value, vmaf in tested.items() if vmaf < target]
    good = max(passing) if passing else lowest - 1
    bad = min(value for value in failing if value > good) if any(value > good for value in failing) else highest + 1
    if bad - good <= 1:
        return None
    if passing and bad <= highest:
        # Interpolate between the two measurements around the target.
        above, below = tested[good], tested[bad]
        guess = good + round((above - target) / max(0.01, above - below) * (bad - good))
    elif passing:
        guess = good + max(1, round((tested[good] - target) / VMAF_PER_CRF))
    else:
        guess = bad - max(1, round((target - tested[bad]) / VMAF_PER_CRF))
    guess = min(max(guess, good + 1, lowest), bad - 1, highest)
    return None if guess in tested or not lowest <= guess <= highest else guess


def search(ffmpeg, source, media, dimensions, codec, encoder, target, workdir, cancel=lambda: None, stop=lambda: None):
    """Find the highest constant-quality value whose sampled VMAF reaches ``target``.

    Returns the chosen value, its mean sampled VMAF, the measured video Mbps,
    and whether the target was reached within the tests.
    ``cancel`` runs before each test (progress); ``stop`` is polled while
    FFmpeg runs so a cancellation does not wait for the test to finish.
    """
    workdir = Path(workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    windows = sample_windows(media["duration"])
    seconds = sum(length for _start, length in windows)
    workers = min(len(windows), max(1, os.cpu_count() or 1))
    threads = max(1, (os.cpu_count() or 1) // workers)
    scores = {}

    def score(value):
        cancel()
        # The clips are independent: encode and score them at the same time.
        with ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(lambda item: measure(ffmpeg, source, item[1], dimensions, encoder, value,
                                                         workdir / ("%d-%d.mkv" % (item[0], value)), stop, threads),
                                    enumerate(windows)))
        vmaf = sum(result[0] for result in results) / len(results)
        mbps = sum(result[1] for result in results) * 8 / seconds / 1e6
        scores[value] = (vmaf, mbps)

    try:
        bounds = CRF_RANGE[codec]
        value = CRF[codec][visual_preset(target)]
        for _test in range(SEARCH_STEPS):
            score(value)
            value = next_value({key: item[0] for key, item in scores.items()}, target, bounds)
            if value is None:
                break
        passing = [key for key, item in scores.items() if item[0] >= target]
        best = max(passing) if passing else min(scores)
        vmaf, mbps = scores[best]
        return {"crf": best, "vmaf": round(vmaf, 2), "mbps": round(mbps, 3), "reached": bool(passing)}
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
