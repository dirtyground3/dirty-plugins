from plugin_paths import runtime_path
import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = runtime_path("DirtyFileExtractor", "extract_scenes.py")
SPEC = importlib.util.spec_from_file_location("dirty_file_extractor", MODULE_PATH)
extractor = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(extractor)

FFMPEG = shutil.which("ffmpeg")
FFPROBE = shutil.which("ffprobe")


class FakeClient:
    def __init__(self, scenes=None, markers=None, images=None):
        self._scenes = scenes or {}
        self._markers = markers or []
        self._images = images or []
        self.extractions = []

    def scenes(self, scene_ids):
        wanted = {str(value) for value in scene_ids}
        return [scene for key, scene in self._scenes.items() if key in wanted]

    def markers(self, marker_ids):
        wanted = {str(value) for value in marker_ids}
        return [item for item in self._markers if str(item["id"]) in wanted]

    def images(self, image_ids):
        wanted = {str(value) for value in image_ids}
        return [item for item in self._images if str(item["id"]) in wanted]

    def extract_marker_clip(
        self, source, destination, start_seconds, end_seconds, on_progress
    ):
        self.extractions.append((source, start_seconds, end_seconds))
        content = f"{start_seconds:g}-{end_seconds:g}".encode()
        destination.write_bytes(content)
        on_progress(1)


class DirtyFileExtractorTests(unittest.TestCase):
    def test_thousand_scenes_use_forty_bounded_requests_and_keep_requested_order(self):
        client = extractor.StashClient({})
        requested = [str(n) for n in range(1000, 0, -1)]
        def response(query, variables):
            ids = []
            condition = variables["scene"]
            while condition:
                self.assertEqual(condition["id"]["modifier"], "EQUALS")
                ids.append(condition["id"]["value"])
                condition = condition.get("OR")
            self.assertLessEqual(len(ids), 25)
            self.assertEqual(variables["filter"]["per_page"], 25)
            return {"findScenes": {"scenes": [{"id": str(n), "files": []} for n in sorted(ids) if n != 500]}}
        with mock.patch.object(client, "call", side_effect=response) as calls:
            items, missing = extractor.resolve_selected_items(client, {"scene": requested})
        self.assertEqual(calls.call_count, 40)
        self.assertEqual([item["id"] for item in items], [item for item in requested if item != "500"])
        self.assertEqual(missing, [{"scene_id": "500", "reason": "scene not found"}])

    def test_mixed_selection_deduplicates_fetches_and_preserves_missing_order(self):
        scene = {"id": "1", "files": []}
        client = FakeClient(scenes={"1": scene}, markers=[{"id": "3", "scene": scene}], images=[{"id": "5"}])
        selections = extractor.selections_from_args({"scene_ids": ["2", "1", "1"], "marker_ids": ["4", "3", "3"], "image_ids": ["6", "5", "5"]})
        with mock.patch.object(client, "scenes", wraps=client.scenes) as scenes:
            items, missing = extractor.resolve_selected_items(client, selections)
        scenes.assert_called_once_with(["2", "1"])
        self.assertEqual([(item["kind"], item["id"]) for item in items], [("scene", "1"), ("marker", "3"), ("image", "5")])
        self.assertEqual(missing, [{"scene_id": "2", "reason": "scene not found"},
                                  {"marker_id": "4", "reason": "marker not found"}, {"image_id": "6", "reason": "image not found"}])

    def test_configuration_is_resolved_once_even_when_multiple_marker_clips_fail(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "scene.mp4"
            source.write_bytes(b"source")
            scene = {"id": "1", "files": [{"path": str(source)}]}
            client = extractor.StashClient({})
            markers = [{"id": str(n), "scene": scene, "seconds": n, "end_seconds": n + 1} for n in range(1, 4)]
            def call(query, variables=None):
                if "findSceneMarkers" in query:
                    return {"findSceneMarkers": {"scene_markers": markers}}
                return {"configuration": {"general": {"ffmpegPath": "configured-ffmpeg"}}}
            attempted = []
            def extract(tool, source, destination, start, end, progress):
                attempted.append(tool)
                if len(attempted) != 2:
                    raise extractor.PluginError("synthetic clip failure")
                destination.write_bytes(b"clip")
            with mock.patch.object(client, "call", side_effect=call) as calls, \
                 mock.patch.object(extractor, "extract_marker_clip", side_effect=extract):
                result = extractor.copy_selected(client, {"marker": ["1", "2", "3"]}, {"destinationFolder": str(root / "output")})
            self.assertEqual(calls.call_count, 2, "One marker batch and one configuration lookup")
            self.assertEqual(attempted, ["configured-ffmpeg"] * 3)
            self.assertEqual((result["files_failed"], result["marker_clips_extracted"]), (2, 1))
            self.assertEqual(source.read_bytes(), b"source")

    def test_failed_configuration_is_cached_for_the_run_and_unused_for_dry_runs(self):
        client = extractor.StashClient({})
        with mock.patch.object(client, "call", side_effect=extractor.PluginError("configuration unavailable")) as calls:
            for n in range(3):
                with self.assertRaisesRegex(extractor.PluginError, "configuration unavailable"):
                    client.ffmpeg_path()
            calls.assert_called_once()
        # A different run gets a fresh client and can resolve a recovered path.
        client = extractor.StashClient({})
        with mock.patch.object(client, "call", return_value={"configuration": {"general": {"ffmpegPath": "recovered"}}}):
            self.assertEqual(client.ffmpeg_path(), "recovered")
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "scene.mp4"
            source.write_bytes(b"source")
            marker = {"id": "1", "seconds": 0, "end_seconds": 1,
                      "scene": {"id": "1", "files": [{"path": str(source)}]}}
            with mock.patch.object(client, "markers", return_value=[marker]), \
                 mock.patch.object(client, "ffmpeg_path", side_effect=AssertionError("Dry runs must not resolve FFmpeg")):
                result = extractor.copy_selected(client, {"marker": ["1"]},
                    {"destinationFolder": str(Path(folder) / "output"), "dryRun": True})
            self.assertEqual(result["marker_clips_extracted"], 1)
            self.assertFalse((Path(folder) / "output").exists())


    def test_parses_and_deduplicates_all_selection_types(self):
        self.assertEqual(
            extractor.selections_from_args(
                {
                    "scene_ids": [1, "1"],
                    "marker_ids": [" 2 "],
                    "image_ids": [3],
                }
            ),
            {"scene": ["1"], "marker": ["2"], "image": ["3"]},
        )

    def test_markers_extract_individual_clips_and_images_copy_visual_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "output"
            scene_file = root / "scene.mp4"
            image_file = root / "image.jpg"
            scene_file.write_bytes(b"scene")
            image_file.write_bytes(b"image")

            parent_scene = {
                "id": "10",
                "title": "Parent Scene",
                "files": [{"path": str(scene_file), "basename": scene_file.name}],
            }
            client = FakeClient(
                markers=[
                    {
                        "id": "20",
                        "title": "A",
                        "seconds": 10.5,
                        "end_seconds": 20.5,
                        "scene": parent_scene,
                    },
                    {
                        "id": "21",
                        "title": "B",
                        "seconds": 30,
                        "end_seconds": 45,
                        "scene": parent_scene,
                    },
                ],
                images=[
                    {
                        "id": "30",
                        "title": "Original Image",
                        "visual_files": [
                            {"path": str(image_file), "basename": image_file.name}
                        ],
                    }
                ],
            )

            result = extractor.copy_selected(
                client,
                {"scene": [], "marker": ["20", "21"], "image": ["30"]},
                {
                    "destinationFolder": str(destination),
                    "createSceneFolders": True,
                    "maxCopySpeedMBps": 0,
                },
            )

            self.assertEqual(result["markers_requested"], 2)
            self.assertEqual(result["images_requested"], 1)
            self.assertEqual(result["files_copied"], 3)
            self.assertEqual(result["marker_clips_extracted"], 2)
            self.assertEqual(result["files_skipped"], 0)
            self.assertEqual(
                (
                    destination
                    / "Parent Scene"
                    / "scene - A [marker-20].mp4"
                ).read_bytes(),
                b"10.5-20.5",
            )
            self.assertEqual(
                (
                    destination
                    / "Parent Scene"
                    / "scene - B [marker-21].mp4"
                ).read_bytes(),
                b"30-45",
            )
            self.assertEqual(
                [(start, end) for _source, start, end in client.extractions],
                [(10.5, 20.5), (30.0, 45.0)],
            )
            self.assertFalse((destination / "Parent Scene" / scene_file.name).exists())
            self.assertEqual(
                (destination / "Original Image" / image_file.name).read_bytes(),
                b"image",
            )

    def test_scene_selection_still_copies_the_complete_source_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "output"
            scene_file = root / "scene.mp4"
            scene_file.write_bytes(b"complete scene")
            client = FakeClient(
                scenes={
                    "10": {
                        "id": "10",
                        "title": "Parent Scene",
                        "files": [
                            {"path": str(scene_file), "basename": scene_file.name}
                        ],
                    }
                }
            )

            result = extractor.copy_selected(
                client,
                {"scene": ["10"], "marker": [], "image": []},
                {
                    "destinationFolder": str(destination),
                    "maxCopySpeedMBps": 0,
                },
            )

            self.assertEqual(result["files_copied"], 1)
            self.assertEqual(result["marker_clips_extracted"], 0)
            self.assertEqual((destination / scene_file.name).read_bytes(), b"complete scene")

    @unittest.skipUnless(FFMPEG and FFPROBE, "FFmpeg and FFprobe are required")
    def test_ffmpeg_extracts_the_complete_marker_interval(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source.mp4"
            destination = root / "marker.mp4"
            subprocess.run(
                [
                    FFMPEG,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=black:s=160x90:r=25:d=3",
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-y",
                    str(source),
                ],
                check=True,
            )
            progress = []

            extractor.extract_marker_clip(
                FFMPEG,
                source,
                destination,
                0.75,
                2.25,
                progress.append,
            )

            duration = float(
                subprocess.check_output(
                    [
                        FFPROBE,
                        "-v",
                        "error",
                        "-show_entries",
                        "format=duration",
                        "-of",
                        "default=noprint_wrappers=1:nokey=1",
                        str(destination),
                    ],
                    text=True,
                ).strip()
            )
            self.assertAlmostEqual(duration, 1.5, delta=0.08)
            self.assertEqual(progress[-1], 1.0)

    def test_duplicate_basenames_are_renamed_instead_of_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "output"
            first_file = root / "first" / "scene.mp4"
            second_file = root / "second" / "scene.mp4"
            first_file.parent.mkdir()
            second_file.parent.mkdir()
            first_file.write_bytes(b"first")
            second_file.write_bytes(b"second")
            client = FakeClient(
                scenes={
                    "1": {
                        "id": "1",
                        "title": "First",
                        "files": [
                            {"path": str(first_file), "basename": first_file.name}
                        ],
                    },
                    "2": {
                        "id": "2",
                        "title": "Second",
                        "files": [
                            {"path": str(second_file), "basename": second_file.name}
                        ],
                    },
                }
            )

            result = extractor.copy_selected(
                client,
                {"scene": ["1", "2"], "marker": [], "image": []},
                {
                    "destinationFolder": str(destination),
                    "collisionPolicy": "rename",
                    "maxCopySpeedMBps": 0,
                },
            )

            self.assertEqual(result["files_copied"], 2)
            self.assertEqual(result["files_skipped"], 0)
            self.assertEqual((destination / "scene.mp4").read_bytes(), b"first")
            self.assertEqual((destination / "scene (2).mp4").read_bytes(), b"second")

    def test_duplicate_basenames_respect_the_skip_policy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "output"
            first_file = root / "first" / "scene.mp4"
            second_file = root / "second" / "scene.mp4"
            first_file.parent.mkdir()
            second_file.parent.mkdir()
            first_file.write_bytes(b"first")
            second_file.write_bytes(b"second")
            client = FakeClient(
                scenes={
                    "1": {
                        "id": "1",
                        "title": "First",
                        "files": [
                            {"path": str(first_file), "basename": first_file.name}
                        ],
                    },
                    "2": {
                        "id": "2",
                        "title": "Second",
                        "files": [
                            {"path": str(second_file), "basename": second_file.name}
                        ],
                    },
                }
            )

            result = extractor.copy_selected(
                client,
                {"scene": ["1", "2"], "marker": [], "image": []},
                {
                    "destinationFolder": str(destination),
                    "collisionPolicy": "skip",
                    "maxCopySpeedMBps": 0,
                },
            )

            self.assertEqual(result["files_copied"], 1)
            self.assertEqual(result["files_skipped"], 1)
            self.assertEqual((destination / "scene.mp4").read_bytes(), b"first")
            self.assertFalse((destination / "scene (2).mp4").exists())

    def test_missing_marker_and_image_are_reported(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = extractor.copy_selected(
                FakeClient(),
                {"scene": [], "marker": ["404"], "image": ["405"]},
                {"destinationFolder": temporary, "dryRun": True},
            )
            self.assertEqual(result["files_missing"], 2)
            self.assertEqual(result["missing"][0]["marker_id"], "404")
            self.assertEqual(result["missing"][1]["image_id"], "405")

    def test_samefile_selection_is_skipped_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "scene.mp4"
            source.write_bytes(b"scene")
            client = FakeClient(
                scenes={
                    "1": {
                        "id": "1",
                        "title": "Scene",
                        "files": [{"path": str(source), "basename": source.name}],
                    }
                }
            )

            # The destination folder is the source folder, so the requested
            # destination is the source file itself.
            result = extractor.copy_selected(
                client,
                {"scene": ["1"], "marker": [], "image": []},
                {"destinationFolder": str(root), "maxCopySpeedMBps": 0},
            )

            self.assertEqual(result["files_copied"], 0)
            self.assertEqual(result["files_skipped"], 1)
            self.assertEqual(result["skipped"][0]["reason"], "same-file")
            self.assertEqual(source.read_bytes(), b"scene")

    def test_dry_run_plans_without_writing_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "scene.mp4"
            source.write_bytes(b"scene")
            destination = root / "output"
            client = FakeClient(
                scenes={
                    "1": {
                        "id": "1",
                        "title": "Scene",
                        "files": [{"path": str(source), "basename": source.name}],
                    }
                }
            )

            result = extractor.copy_selected(
                client,
                {"scene": ["1"], "marker": [], "image": []},
                {"destinationFolder": str(destination), "dryRun": True, "maxCopySpeedMBps": 0},
            )

            self.assertTrue(result["dry_run"])
            self.assertFalse(destination.exists(), "a dry run must not create the destination")
            self.assertEqual(result["files_copied"], 1)
            self.assertEqual(result["files_failed"], 0)
            self.assertEqual(result["copied"][0]["action"], "dry-run")
            self.assertEqual(result["copied"][0]["destination"], str(destination / "scene.mp4"))

    def test_one_failed_copy_does_not_discard_completed_items(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            destination = root / "output"
            good = root / "good.mp4"
            bad = root / "bad.mp4"
            good.write_bytes(b"good")
            bad.write_bytes(b"bad")
            client = FakeClient(
                scenes={
                    "1": {
                        "id": "1",
                        "title": "Good",
                        "files": [{"path": str(good), "basename": good.name}],
                    },
                    "2": {
                        "id": "2",
                        "title": "Bad",
                        "files": [{"path": str(bad), "basename": bad.name}],
                    },
                }
            )

            original = extractor.copy_file_chunked

            def flaky(source, target, on_chunk, speed):
                if Path(source).name == "bad.mp4":
                    raise OSError("disk full")
                return original(source, target, on_chunk, speed)

            with mock.patch.object(extractor, "copy_file_chunked", flaky):
                result = extractor.copy_selected(
                    client,
                    {"scene": ["1", "2"], "marker": [], "image": []},
                    {"destinationFolder": str(destination), "maxCopySpeedMBps": 0},
                )

            self.assertEqual(result["files_copied"], 1)
            self.assertEqual(result["files_failed"], 1)
            self.assertEqual(result["failed"][0]["source"], str(bad))
            self.assertIn("disk full", result["failed"][0]["error"])
            self.assertEqual((destination / "good.mp4").read_bytes(), b"good")
            self.assertFalse((destination / "bad.mp4").exists())


if __name__ == "__main__":
    unittest.main()
