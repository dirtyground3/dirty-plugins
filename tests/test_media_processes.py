"""Synthetic children exercise media runner deadlines and cleanup without media access."""
from plugin_paths import runtime_path
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


def load(plugin, filename, name):
    spec = importlib.util.spec_from_file_location(name, runtime_path(plugin, filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


compactor = load("DirtyCompactor", "dirty_compactor.py", "media_compactor")
extractor = load("DirtyFileExtractor", "extract_scenes.py", "media_extractor")
quality = compactor.quality
POPEN = subprocess.Popen


class MediaProcessTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.children = []

    def spawn(self, script, *, partial=False):
        def start(command, **kwargs):
            arguments = [str(command[-1])] if partial else []
            process = POPEN([sys.executable, "-u", "-c", script, *arguments], **kwargs)
            self.children.append(process)
            return process
        return start

    def reaped(self):
        self.assertTrue(self.children)
        for process in self.children:
            self.assertIsNotNone(process.poll(), "runner must terminate and reap its child")

    def test_quality_silent_timeout_and_callback_cancellation(self):
        for timeout, stop, message in (
            (0.3, lambda: None, "timed out"),
            (30, lambda: (_ for _ in ()).throw(compactor.Cancelled("cancelled sample")), "cancelled sample"),
        ):
            with self.subTest(message=message), mock.patch.object(quality.subprocess, "Popen", self.spawn("import time; time.sleep(30)")):
                started = time.monotonic()
                with self.assertRaisesRegex(RuntimeError, message):
                    quality._run(["synthetic"], stop, timeout=timeout)
                self.assertLess(time.monotonic() - started, 5)
                self.reaped()

    def test_quality_success_and_failure_diagnostics_are_bounded(self):
        for code in (0, 7):
            script = "import sys; sys.stderr.write('x'*1000000+'\\nVMAF score: 97.2\\n'); sys.exit(%d)" % code
            with self.subTest(code=code), mock.patch.object(quality.subprocess, "Popen", self.spawn(script)):
                if code:
                    with self.assertRaisesRegex(compactor.PluginError, "VMAF score: 97.2") as error:
                        quality._run(["synthetic"])
                    self.assertLess(len(str(error.exception)), 700)
                else:
                    result = quality._run(["synthetic"])
                    self.assertLessEqual(len(result), 65536)
                    self.assertIn("VMAF score: 97.2", result)
                self.reaped()

    def test_packet_sum_skips_bad_and_oversized_records(self):
        script = "import sys; sys.stdout.write('100\\n250\\ninvalid\\n'+'9'*10000+'\\n500,side-data\\n')"
        with mock.patch.object(compactor.subprocess, "Popen", self.spawn(script)):
            self.assertEqual(compactor.packet_video_bitrate("synthetic", "unused", 2), 3400)
        self.reaped()

    def test_packet_scan_silent_timeout_cancel_and_failure(self):
        for script, timeout, stop, message in (
            ("import time; time.sleep(30)", 0.3, lambda: None, "timed out"),
            ("import time; time.sleep(30)", 30, lambda: (_ for _ in ()).throw(compactor.Cancelled("cancelled scan")), "cancelled scan"),
            ("import sys; sys.exit(3)", 30, lambda: None, "scan failed"),
        ):
            with self.subTest(message=message), mock.patch.object(compactor.subprocess, "Popen", self.spawn(script)):
                started = time.monotonic()
                with self.assertRaisesRegex(RuntimeError, message):
                    compactor.packet_video_bitrate("synthetic", "unused", 2, stop, timeout=timeout)
                self.assertLess(time.monotonic() - started, 5)
                self.reaped()

    def test_marker_timeout_and_cancel_reap_before_partial_deletion(self):
        script = "import sys,time; output=open(sys.argv[1],'wb'); output.write(b'partial'); output.flush(); time.sleep(30)"
        destination = self.root / "clip.mp4"
        destination.write_bytes(b"existing destination")
        discard = extractor._discard_partial
        def checked_discard(path):
            self.reaped()
            discard(path)
        for cancel in (False, True):
            ticks = []
            def progress(value):
                ticks.append(value)
                if cancel and len(ticks) >= 2:
                    raise RuntimeError("cancelled extraction")
            with self.subTest(cancel=cancel), mock.patch.object(extractor.subprocess, "Popen", self.spawn(script, partial=True)), \
                    mock.patch.object(extractor, "_discard_partial", checked_discard):
                started = time.monotonic()
                with self.assertRaisesRegex(RuntimeError, "cancelled extraction" if cancel else "timed out"):
                    extractor.extract_marker_clip("synthetic", self.root / "source", destination, 0, 1, progress, timeout=0.4)
                self.assertLess(time.monotonic() - started, 5)
                self.assertEqual(destination.read_bytes(), b"existing destination")
                self.assertFalse(list(self.root.glob(".*.part.mp4")))

    def test_marker_success_and_final_callback_cancel(self):
        script = "import sys; open(sys.argv[1],'wb').write(b'finished'); print('out_time=00:00:01.000000')"
        destination = self.root / "clip.mp4"
        destination.write_bytes(b"existing")
        def cancel(value):
            if value == 1:
                raise RuntimeError("cancel before publication")
        with mock.patch.object(extractor.subprocess, "Popen", self.spawn(script, partial=True)):
            with self.assertRaisesRegex(RuntimeError, "cancel before publication"):
                extractor.extract_marker_clip("synthetic", self.root / "source", destination, 0, 1, cancel)
            self.assertEqual(destination.read_bytes(), b"existing")
            values = []
            extractor.extract_marker_clip("synthetic", self.root / "source", destination, 0, 1, values.append)
            self.assertEqual(destination.read_bytes(), b"finished")
            self.assertEqual(values[-1], 1)
            self.assertFalse(list(self.root.glob(".*.part.mp4")))
        self.reaped()

    def test_marker_failure_retains_bounded_diagnostics_and_releases_partial(self):
        script = "import sys; open(sys.argv[1],'wb').write(b'partial'); sys.stdout.write('x'*1000000+'\\nfailure tail\\n'); sys.exit(7)"
        destination = self.root / "clip.mp4"
        with mock.patch.object(extractor.subprocess, "Popen", self.spawn(script, partial=True)):
            with self.assertRaisesRegex(extractor.PluginError, "failure tail") as error:
                extractor.extract_marker_clip("synthetic", self.root / "source", destination, 0, 1, lambda value: None)
            self.assertLess(len(str(error.exception)), 83000)
            self.assertFalse(destination.exists())
            self.assertFalse(list(self.root.glob(".*.part.mp4")))
        self.reaped()

    @unittest.skipUnless(os.name == "nt", "Windows close-on-parent-exit job containment")
    def test_forced_parent_exit_stops_each_runner_child(self):
        import ctypes
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
        for runner in ("quality", "packets", "marker"):
            with self.subTest(runner=runner):
                pid_file, ready = self.root / (runner + ".pid"), self.root / (runner + ".ready")
                child = "import os,pathlib,time; pathlib.Path(%r).write_text(str(os.getpid())); time.sleep(60)" % str(pid_file)
                code = """
import pathlib, subprocess, sys
sys.path.insert(0, sys.argv[1]); sys.path.insert(0, sys.argv[2])
import dirty_compactor as c, extract_scenes as e
real = subprocess.Popen
subprocess.Popen = lambda command, **kwargs: real([sys.executable, '-u', '-c', sys.argv[3]], **kwargs)
def progress(*args): pathlib.Path(sys.argv[4]).write_text('contained')
runner = sys.argv[5]
if runner == 'quality': c.quality._run(['synthetic'], progress)
elif runner == 'packets': c.packet_video_bitrate('synthetic', 'unused', 1, progress)
else: e.extract_marker_clip('synthetic', pathlib.Path('unused'), pathlib.Path(sys.argv[6]), 0, 1, progress)
"""
                parent = POPEN([sys.executable, "-B", "-c", code,
                                str(runtime_path("DirtyCompactor")), str(runtime_path("DirtyFileExtractor")),
                                child, str(ready), runner, str(self.root / "output.mp4")],
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                handle = None
                try:
                    deadline = time.monotonic() + 10
                    while not (pid_file.exists() and ready.exists()) and parent.poll() is None and time.monotonic() < deadline:
                        time.sleep(0.02)
                    if not (pid_file.exists() and ready.exists()):
                        parent.kill()
                        diagnostic = parent.communicate()[1].decode(errors="replace")
                        self.fail("Runner never reached contained state: " + diagnostic)
                    handle = kernel.OpenProcess(0x00100001, False, int(pid_file.read_text()))
                    self.assertTrue(handle)
                    self.assertEqual(kernel.WaitForSingleObject(handle, 0), 258, "synthetic child is running")
                    parent.kill()
                    parent.wait(timeout=5)
                    self.assertEqual(kernel.WaitForSingleObject(handle, 5000), 0, "child exits when parent loses its job handle")
                finally:
                    if parent.poll() is None:
                        parent.kill()
                    parent.wait()
                    parent.stderr.close()
                    if handle:
                        if kernel.WaitForSingleObject(handle, 0) == 258:
                            kernel.TerminateProcess(handle, 1)
                            kernel.WaitForSingleObject(handle, 5000)
                        kernel.CloseHandle(handle)


if __name__ == "__main__":
    unittest.main()
