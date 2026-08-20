import importlib.util
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


MODULE_PATH = (
    Path(__file__).parents[1]
    / "plugins"
    / "DirtyFileExtractor"
    / "extract_scenes.py"
)
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

    def scene(self, scene_id):
        return self._scenes.get(str(scene_id))

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
    def test_parses_and_deduplicates_all_selection_types(self):
        self.assertEqual(
            extractor.selections_from_args(
                {
                    "scene_ids": [1, "1"],
                    "marker_ids": [" 2 "],
                    "image_id": 3,
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


if __name__ == "__main__":
    unittest.main()
