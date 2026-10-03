import importlib.util
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).parents[1]
SPEC = importlib.util.spec_from_file_location("dirty_captions_tests", ROOT / "plugins/DirtyCaptions/dirty_captions.py")
captions = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(captions)
media = sys.modules["dirty_captions_media"]
FFMPEG, FFPROBE = shutil.which("ffmpeg"), shutil.which("ffprobe")


class FakeClient:
    def __init__(self, path):
        self.path = path

    def call(self, query, variables=None):
        if "findScene" in query:
            return {"findScene": {"id": "1479", "files": [{"id": "1493", "path": str(self.path)}]}}
        return {"configuration": {"general": {"ffmpegPath": FFMPEG, "ffprobePath": FFPROBE}}}


class CaptionTests(unittest.TestCase):
    def setUp(self):
        self.playback_index = mock.patch.object(captions.caption_index, "record_playback")
        self.playback_index.start()
        self.addCleanup(self.playback_index.stop)

    def test_only_stash_resolved_files_can_be_read(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "scene.mp4"
            path.write_bytes(b"fixture")
            client = FakeClient(path)
            with mock.patch.object(captions, "read_captions", return_value={"tracks": [], "warnings": []}) as read:
                result = captions.captions(client, {"mode": "captions", "sceneId": "1479", "fileId": "1493", "path": "untrusted.mp4"})
                self.assertEqual(read.call_args.args[-1], path)
                self.assertEqual(result["fileId"], "1493")
                with self.assertRaisesRegex(media.CaptionError, "does not belong"):
                    captions.captions(client, {"mode": "captions", "sceneId": "1479", "fileId": "other"})
                with self.assertRaisesRegex(media.CaptionError, "scene ID"):
                    captions.captions(client, {"mode": "captions", "sceneId": "../../private"})

    def test_bitmap_subtitles_are_reported_without_conversion(self):
        probe = json.dumps({"streams": [{"index": 2, "codec_name": "hdmv_pgs_subtitle"}]}).encode()
        with mock.patch.object(media, "file_identity", return_value=(1, 1)), mock.patch.object(media, "run_tool", return_value=probe) as tool:
            result = media.read_captions("probe", "ffmpeg", "scene.mkv")
            self.assertEqual(result["tracks"], [])
            self.assertIn("hdmv_pgs_subtitle", result["warnings"][0])
            self.assertEqual(tool.call_count, 1)

    def test_bad_track_does_not_discard_other_languages(self):
        probe = json.dumps({"streams": [{"index": 2, "codec_name": "subrip"}, {"index": 3, "codec_name": "subrip"}]}).encode()
        vtt = b"WEBVTT\n\n00:00.000 --> 00:01.000\nHello\n"
        with mock.patch.object(media, "file_identity", return_value=(1, 1)), mock.patch.object(media, "run_tool", side_effect=[probe, media.CaptionError("failed"), vtt]), mock.patch("sys.stderr", io.StringIO()):
            result = media.read_captions("probe", "ffmpeg", "scene.mkv")
            self.assertEqual([track["index"] for track in result["tracks"]], [3])
            self.assertEqual(len(result["warnings"]), 1)

    def test_changed_media_is_rejected(self):
        with mock.patch.object(media, "file_identity", side_effect=[(1, 1), (1, 2)]), mock.patch.object(media, "run_tool", return_value=b'{"streams":[]}'):
            with self.assertRaisesRegex(media.CaptionError, "changed"):
                media.read_captions("probe", "ffmpeg", "scene.mp4")

    def test_empty_track_is_ignored(self):
        probe = json.dumps({"streams": [{"index": 2, "codec_name": "mov_text"}]}).encode()
        with mock.patch.object(media, "file_identity", return_value=(1, 1)), mock.patch.object(media, "run_tool", side_effect=[probe, b"WEBVTT\n"]):
            self.assertEqual(media.read_captions("probe", "ffmpeg", "scene.mp4")["tracks"], [])

    def test_pipe_limits_and_timeouts_reap_the_child(self):
        with self.assertRaisesRegex(media.CaptionError, "limit"):
            media.run_tool([sys.executable, "-c", "import sys;sys.stdout.write('x'*100000)"], limit=20)
        with self.assertRaisesRegex(media.CaptionError, "timed out"):
            media.run_tool([sys.executable, "-c", "import time;time.sleep(10)"], timeout=0.05)
        self.assertEqual(media.run_tool([sys.executable, "-c", "print('ok')"]).strip(), b"ok")

    def test_json_protocol_errors_do_not_leak_paths(self):
        payload = {"args": {"mode": "captions", "sceneId": "1479"}}
        out = io.StringIO()
        with mock.patch("sys.stdin", io.StringIO(json.dumps(payload))), mock.patch("sys.stdout", out), mock.patch("sys.stderr", io.StringIO()), mock.patch.object(captions, "captions", side_effect=media.CaptionError("Caption tool failed: private/path.mp4")):
            self.assertEqual(captions.main(), 1)
        self.assertNotIn("private", json.loads(out.getvalue())["error"])


@unittest.skipUnless(FFMPEG and FFPROBE, "FFmpeg and ffprobe required")
class CaptionMediaTests(unittest.TestCase):
    def setUp(self):
        self.playback_index = mock.patch.object(captions.caption_index, "record_playback")
        self.playback_index.start()
        self.addCleanup(self.playback_index.stop)

    def test_mp4_mov_text_languages_unicode_and_no_sidecars(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            first, second = root / "english.srt", root / "french.srt"
            first.write_text("1\n00:00:00,200 --> 00:00:00,800\nHello & welcome\n", encoding="utf-8")
            second.write_text("1\n00:00:00,300 --> 00:00:00,900\nBonjour, café 日本語\n", encoding="utf-8")
            target = root / "scene.mp4"
            subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "color=size=32x32:rate=5:duration=1",
                            "-i", str(first), "-i", str(second), "-map", "0:v", "-map", "1:s", "-map", "2:s",
                            "-c:v", "mpeg4", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng",
                            "-metadata:s:s:1", "language=fra", "-disposition:s:0", "default", "-disposition:s:1", "0",
                            str(target)], check=True, capture_output=True)
            before, identity = set(root.iterdir()), media.file_identity(target)
            result = captions.captions(FakeClient(target), {"mode": "captions", "sceneId": "1479"})
            self.assertEqual(result["warnings"], [])
            self.assertEqual([track["language"] for track in result["tracks"]], ["eng", "fra"])
            self.assertTrue(result["tracks"][0]["default"])
            self.assertIn("00:00.200 --> 00:00.800", result["tracks"][0]["vtt"])
            self.assertIn("café 日本語", result["tracks"][1]["vtt"])
            self.assertEqual(set(root.iterdir()), before)
            self.assertEqual(media.file_identity(target), identity)

    def test_video_without_subtitles_returns_empty(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "scene.mp4"
            subprocess.run([FFMPEG, "-v", "error", "-f", "lavfi", "-i", "color=size=32x32:rate=5:duration=1", "-c:v", "mpeg4", str(path)], check=True, capture_output=True)
            self.assertEqual(media.read_captions(FFPROBE, FFMPEG, path), {"tracks": [], "warnings": [], "retryable": False})


if __name__ == "__main__":
    unittest.main()
