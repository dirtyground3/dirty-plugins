"""Opt-in hub checks with all eight staged plugins in an isolated Stash, never port 9999."""
import argparse
import json
from pathlib import Path
import shutil
import time

from plugin_paths import ROOT, runtime_path
from test_dirty_compactor_stash_integration import Fixture, exercise, verify_frontend, add_build_mode_argument, select_build_mode, verify_served_bundle


def verify_hub_frontend(fixture):
    detail = verify_served_bundle(fixture, "DirtyPlugins", "dirtyPlugins", "dirtyPlugins.js",
                                  {"SettingsToggle": "Settings", "DirtyPluginsRoute": "Route"},
                                  required=("/components/Route.tsx", "/components/Controls.tsx"))
    print("PASS: " + detail, flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True)
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--stop-file", type=Path, help="End --serve and clean up when this file exists")
    add_build_mode_argument(parser)
    args = parser.parse_args()
    select_build_mode(args)
    fixture = Fixture(args.binary)
    try:
        registry = json.loads((ROOT / "scripts/plugin-registry.json").read_text())
        for plugin in registry:
            destination = fixture.root / "plugins" / plugin["id"]
            if not destination.exists():
                shutil.copytree(runtime_path(plugin["directory"]), destination,
                                ignore=shutil.ignore_patterns("runtime", "__pycache__", "*.sqlite*", "*.pyc"))
        fixture.gql("mutation{reloadPlugins}")
        enabled = {plugin["id"]: True for plugin in registry}
        fixture.gql("mutation{setPluginsEnabled(enabledMap:{" +
                    ",".join(plugin_id + ":true" for plugin_id in enabled) + "})}")
        loaded = fixture.gql("{plugins{id version enabled}}") ["plugins"]
        assert {plugin["id"] for plugin in loaded} == set(enabled)
        assert all(plugin["enabled"] for plugin in loaded)
        print("FIXTURE " + fixture.url + " " + str(fixture.root), flush=True)
        verify_hub_frontend(fixture)
        verify_frontend(fixture)
        exercise(fixture)
        if args.serve:
            print("UI " + fixture.url + "/plugins/dirty-plugins?plugin=multiscreen&docsCapture=1", flush=True)
            while not args.stop_file or not args.stop_file.exists():
                time.sleep(1)
    except Exception:
        fixture.log.flush()
        print((fixture.root / "stash.log").read_text(errors="replace")[-2500:], flush=True)
        raise
    finally:
        fixture.close()


if __name__ == "__main__":
    main()
