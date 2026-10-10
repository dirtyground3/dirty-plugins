"""Documentation captures (?docsCapture=1) must keep private media and paths out of screenshots.

These stylesheet rules are the last safeguard for public captures, so each one is
checked for the declaration it relies on. Behavior suites check that the capture
classes are applied; architecture rules live in scripts/build.mjs.
"""
import re
import unittest

from plugin_paths import source_path

# (plugin directory, stylesheet, selector, required declaration)
CAPTURE_RULES = (
    ("DirtyPlugins", "dirtyPlugins.css", '.dirty-plugins-docs-capture #dirty-plugins-panel-extractScenes input[type="text"]', "filter: blur("),
    ("DirtyCaptions", "dirtyCaptions.css", ".dirty-captions-capture video", "visibility: hidden"),
    ("DirtyCaptions", "dirtyCaptions.css", ".dirty-captions-capture img", "visibility: hidden"),
    ("DirtyCaptions", "dirtyCaptions.css", ".dirty-captions-capture .scrubber-wrapper", "visibility: hidden"),
    ("DirtyCaptions", "dirtyCaptions.css", ".dirty-captions-capture .vjs-text-track-display", "visibility: hidden"),
    ("DirtyMultiscreen", "multiscreen.css", ".ms-docs-capture .ms-native-tile video", "visibility: hidden"),
    ("DirtyMultiscreen", "multiscreen.css", ".ms-docs-capture .ms-native-tile img", "visibility: hidden"),
    ("DirtyMultiscreen", "multiscreen.css", ".ms-docs-capture .ms-title", "visibility: hidden"),
    ("DirtyRank", "dirtyRank.css", ".dirty-rank-censored-media img", "visibility: hidden"),
    ("DirtyRank", "dirtyRank.css", ".dirty-rank-censored-media video", "visibility: hidden"),
    ("DirtyRank", "dirtyRank.css", ".dirty-rank-censored-media canvas", "visibility: hidden"),
    ("DirtyRank", "dirtyRank.css", ".dirty-rank-censored-media .dirty-rank-image", "filter: blur("),
    ("DirtyRank", "dirtyRank.css", ".dirty-rank-censored-media .dirty-rank-podium-image", "filter: blur("),
    ("DirtyRank", "dirtyRank.css", ".dirty-rank-censored-media .dirty-rank-table-performer img", "filter: blur("),
)


def rule_bodies(styles, selector):
    """Bodies of every rule (including inside @media) whose selector list names selector."""
    styles = re.sub(r"/\*.*?\*/", "", styles, flags=re.S)
    bodies = []
    for selectors, body in re.findall(r"([^{}@;]+)\{([^{}]*)\}", styles):
        if selector in (part.strip() for part in selectors.split(",")):
            bodies.append(body)
    return bodies


class CaptureStyleTests(unittest.TestCase):
    def test_capture_rules_hide_media_and_paths(self):
        for plugin, stylesheet, selector, declaration in CAPTURE_RULES:
            with self.subTest(plugin=plugin, selector=selector):
                styles = source_path(plugin, stylesheet).read_text(encoding="utf-8")
                bodies = rule_bodies(styles, selector)
                self.assertTrue(bodies, "missing capture rule " + selector)
                self.assertTrue(any(declaration in body for body in bodies), selector + " must use " + declaration)


if __name__ == "__main__":
    unittest.main()
