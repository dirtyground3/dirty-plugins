"""Manual synthetic quality-sample benchmark; run after npm run build.

Compares automatic encoder threading with explicit per-worker encoder/metric
budgets for one/two/three workers. Windows CPU seconds include all FFmpeg children.
No live media or Stash database is read. Requires FFmpeg with libvmaf.
"""
import ctypes
from ctypes import wintypes
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

from plugin_paths import runtime_path

sys.path.insert(0, str(runtime_path("DirtyPlugins")))
sys.path.insert(0, str(runtime_path("DirtyCompactor")))
import dirty_compactor_quality as quality


def cpu_seconds(processes):
    if os.name != "nt":
        return None
    get_times = ctypes.windll.kernel32.GetProcessTimes
    get_times.argtypes = [wintypes.HANDLE, *([ctypes.POINTER(wintypes.FILETIME)] * 4)]
    get_times.restype = wintypes.BOOL
    total = 0
    for process in processes:
        created, exited, kernel, user = (wintypes.FILETIME() for _ in range(4))
        if not get_times(int(process._handle), ctypes.byref(created), ctypes.byref(exited), ctypes.byref(kernel), ctypes.byref(user)):
            raise ctypes.WinError()
        total += sum((value.dwHighDateTime << 32) + value.dwLowDateTime for value in (kernel, user)) / 10_000_000
    return round(total, 3)


def main():
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg is required")
    runs = int(sys.argv[1]) if len(sys.argv) > 1 else 2
    with tempfile.TemporaryDirectory(prefix="dirty-quality-benchmark-") as temporary:
        root = Path(temporary)
        source = root / "synthetic.mp4"
        subprocess.run([ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25",
                        "-t", "24", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "5", str(source)], check=True)
        windows = quality.sample_windows(24)
        original_run, original_popen = quality._run, subprocess.Popen
        try:
            for repeat in range(runs):
                for workers in (1, 2, 3):
                    threads = max(1, (os.cpu_count() or 1) // workers)
                    for bounded in (False, True):
                        processes = []
                        def spawn(*args, **kwargs):
                            process = original_popen(*args, **kwargs)
                            processes.append(process)
                            return process
                        def run(command, stop):
                            if not bounded:
                                # Reproduce the previous automatic encoder/decoder/filter policy.
                                command = list(command)
                                for index in reversed([index for index, value in enumerate(command) if value in
                                    {"-filter_threads", "-filter_complex_threads", "-threads", "-threads:v:0"}]):
                                    del command[index:index + 2]
                            return original_run(command, stop)
                        subprocess.Popen, quality._run = spawn, run
                        begin = time.perf_counter()
                        with ThreadPoolExecutor(max_workers=workers) as pool:
                            results = list(pool.map(lambda entry: quality.measure(ffmpeg, source, entry[1], (1280, 720), "libx264", 24,
                                root / f"{repeat}-{workers}-{bounded}-{entry[0]}.mkv", threads=threads), enumerate(windows)))
                        print(json.dumps({"repeat": repeat + 1, "workers": workers, "bounded": bounded, "threads_per_worker": threads,
                            "wall_seconds": round(time.perf_counter() - begin, 3), "cpu_seconds": cpu_seconds(processes),
                            "scores": [round(result[0], 3) for result in results]}), flush=True)
        finally:
            quality._run, subprocess.Popen = original_run, original_popen


if __name__ == "__main__":
    main()
