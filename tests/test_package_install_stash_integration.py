"""Opt-in install of the generated packages into an empty plugin directory; never port 9999.

python -B tests/test_package_install_stash_integration.py --binary /path/to/stash

Run after `./build_site.sh _site/main`. An isolated Stash reads this repository's package
source from a local HTTP server and installs the six public plugins with its own package
manager; DirtyPlugins must follow as their declared dependency. Installed files must equal
the ZIPs (plus Stash's own `manifest` record) with no source, tooling or runtime data, and
every plugin must load, serve its staged bundle and run its Python backend.
"""
import argparse
from functools import partial
import http.server
import json
from pathlib import Path
import shutil
import subprocess
import threading
import urllib.request
import zipfile

from check_package_contents import FORBIDDEN
from plugin_paths import ROOT, runtime_path
from test_dirty_compactor_stash_integration import Fixture, wait_for


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def operation(fixture, plugin_id, mode, **args):
    value = fixture.gql("mutation($id:ID!,$args:Map!){runPluginOperation(plugin_id:$id,args:$args)}",
                        {"id": plugin_id, "args": dict(args, mode=mode)})["runPluginOperation"]
    for _ in range(5):
        if isinstance(value, str):
            value = json.loads(value)
        elif isinstance(value, dict) and "output" in value:
            value = value["output"]
        else:
            break
    if isinstance(value, dict) and value.get("error"):
        raise RuntimeError(plugin_id + " " + mode + ": " + value["error"])
    return value


def installed_directory(plugins, plugin_id):
    matches = [path.parent for path in plugins.glob("**/" + plugin_id + ".yml") if len(path.relative_to(plugins).parts) <= 3]
    assert len(matches) == 1, plugin_id + " installed " + str(len(matches)) + " times"
    return matches[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--binary", required=True)
    parser.add_argument("--site", type=Path, default=ROOT / "_site" / "main")
    args = parser.parse_args()
    site = args.site.resolve()
    # Packages must be current: identities, checksums and contents equal release staging.
    subprocess.run(["node", "scripts/check-packages.mjs", str(site)], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    registry = json.loads((ROOT / "scripts" / "plugin-registry.json").read_text(encoding="utf-8"))
    public = [plugin["id"] for plugin in registry if plugin["id"] != "dirtyPlugins"]
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(site)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    source = "http://127.0.0.1:" + str(server.server_address[1]) + "/index.yml"

    def empty_plugin_directory(root):
        # The shared fixture stages two plugins; this test starts from an empty plugin directory.
        for child in (root / "plugins").iterdir():
            shutil.rmtree(child)

    fixture = Fixture(args.binary, prefix="dirty-package-install-", prepare=empty_plugin_directory)
    try:
        plugins = fixture.root / "plugins"
        assert not fixture.gql("{plugins{id}}")["plugins"] and not any(plugins.iterdir())
        fixture.gql('mutation($sources:[PackageSourceInput!]){configureGeneral(input:{pluginPackageSources:$sources}){pluginPackageSources{url}}}',
                    {"sources": [{"name": "Dirty plugins (local packages)", "url": source, "local_path": ""}]})
        available = {item["package_id"]: item for item in fixture.gql(
            "query($source:String!){availablePackages(type:Plugin,source:$source){package_id version requires{package_id}}}",
            {"source": source})["availablePackages"]}
        assert sorted(available) == sorted(plugin["id"] for plugin in registry), sorted(available)
        for plugin in registry:
            item = available[plugin["id"]]
            requires = [entry["package_id"] for entry in item["requires"] or []]
            assert requires == ([] if plugin["id"] == "dirtyPlugins" else ["dirtyPlugins"]), (plugin["id"], requires)
        print("PASS: package source lists all seven plugins; each public plugin requires DirtyPlugins", flush=True)

        # installPackages installs exactly the listed IDs; like Stash's UI, add each declared requirement.
        requested = list(public)
        for plugin_id in public:
            for entry in available[plugin_id]["requires"] or []:
                if entry["package_id"] not in requested:
                    requested.append(entry["package_id"])
        fixture.gql("mutation($packages:[PackageSpecInput!]!){installPackages(type:Plugin,packages:$packages)}",
                    {"packages": [{"id": plugin_id, "sourceURL": source} for plugin_id in requested]})
        wait_for(lambda: not fixture.gql("{jobQueue{id}}")["jobQueue"], timeout=180)
        fixture.gql("mutation{reloadPlugins}")
        installed = {item["package_id"]: item["version"] for item in fixture.gql("{installedPackages(type:Plugin){package_id version}}")["installedPackages"]}
        assert sorted(installed) == sorted(available), sorted(installed)
        assert all(installed[plugin_id] == available[plugin_id]["version"] for plugin_id in installed)
        print("PASS: the six public plugins plus their declared DirtyPlugins requirement installed; versions match the source", flush=True)

        for plugin in registry:
            directory = installed_directory(plugins, plugin["id"])
            with zipfile.ZipFile(site / (plugin["id"] + ".zip")) as archive:
                members = {item.filename: archive.read(item.filename) for item in archive.infolist() if not item.is_dir()}
            files = {path.relative_to(directory).as_posix(): path for path in directory.rglob("*") if path.is_file()}
            assert set(files) - {"manifest"} == set(members), (plugin["id"], sorted(set(files) ^ set(members)))
            assert all(files[name].read_bytes() == data for name, data in members.items()), plugin["id"]
            assert not [name for name in files if FORBIDDEN.search(name)], plugin["id"]
        print("PASS: installed files equal the ZIPs plus Stash's manifest record; no source, tooling or runtime data", flush=True)

        loaded = {plugin["id"]: plugin for plugin in fixture.gql("{plugins{id version enabled}}")["plugins"]}
        disabled = [plugin_id for plugin_id, plugin in loaded.items() if not plugin["enabled"]]
        if disabled:
            fixture.gql("mutation{setPluginsEnabled(enabledMap:{" + ",".join(plugin_id + ":true" for plugin_id in disabled) + "})}")
        for plugin in registry:
            version = available[plugin["id"]]["version"].split("-", 1)[0]
            assert loaded[plugin["id"]]["version"] == version, (plugin["id"], loaded[plugin["id"]]["version"], version)
            with urllib.request.urlopen(fixture.url + "/plugin/" + plugin["id"] + "/javascript") as response:
                served = response.read()
            assert served == runtime_path(plugin["directory"], plugin["entry"]).read_bytes() + b"\n", plugin["id"]
        print("PASS: all seven load at their manifest versions and serve their staged release bundles"
              + (" (enabled after install: " + ", ".join(disabled) + ")" if disabled else ""), flush=True)

        settings = operation(fixture, "dirtyPlugins", "getAllSettings")
        assert isinstance(settings.get("settings"), dict)
        # Backends import their generated metadata when they load, so any operation proves it shipped.
        rank = operation(fixture, "dirtyRank", "getSettings")
        assert rank["settings"] == {} and rank["revision"] == 0, rank
        assert isinstance(operation(fixture, "dirtyTasks", "listRuns", task="encoding"), (dict, list))
        print("PASS: installed hub, Rank and DirtyTasks backends run, including generated metadata modules", flush=True)
    except Exception:
        if fixture.log:
            fixture.log.flush()
            print((fixture.root / "stash.log").read_text(errors="replace")[-2500:], flush=True)
        raise
    finally:
        fixture.close()
        server.shutdown()


if __name__ == "__main__":
    main()
