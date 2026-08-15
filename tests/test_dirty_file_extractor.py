import importlib.util
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


class FakeClient:
    def __init__(self, scenes=None, markers=None, images=None):
        self._scenes = scenes or {}
        self._markers = markers or []
        self._images = images or []

    def scene(self, scene_id):
        return self._scenes.get(str(scene_id))

    def markers(self, marker_ids):
        wanted = {str(value) for value in marker_ids}
        return [item for item in self._markers if str(item["id"]) in wanted]

    def images(self, image_ids):
        wanted = {str(value) for value in image_ids}
        return [item for item in self._images if str(item["id"]) in wanted]


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

    def test_markers_copy_parent_scene_and_images_copy_visual_files(self):
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
                    {"id": "20", "title": "A", "scene": parent_scene},
                    {"id": "21", "title": "B", "scene": parent_scene},
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
            self.assertEqual(result["files_copied"], 2)
            self.assertEqual(result["files_skipped"], 1)
            self.assertEqual(
                (destination / "Parent Scene" / scene_file.name).read_bytes(),
                b"scene",
            )
            self.assertEqual(
                (destination / "Original Image" / image_file.name).read_bytes(),
                b"image",
            )

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
