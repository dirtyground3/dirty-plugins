"""Opt-in second Stash instance on a copy of the local library; never port 9999.

python -B tests/library_copy_fixture.py --binary <stash.exe> [--stop-file <path>]

Run after npm run build. The live Stash and DirtyPlugins databases are copied
through SQLite's read-only backup API. Every absolute path stored in the copies
is redirected below a folder that does not exist, so file operations (Tidy
moves, Compactor runs, extraction, native file deletion) fail instead of
reaching real media. Compactor and Tidy automation are paused as well. The
instance has no generated files or images. It serves until Ctrl+C or the stop
file exists, then deletes the copy. Not run by npm test; Windows paths only.
"""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import time
import urllib.request

from plugin_paths import ROOT, runtime_path
from test_dirty_compactor_stash_integration import Fixture, add_build_mode_argument, select_build_mode

ABSOLUTE = re.compile(r"(?i)[a-z]:[\\/]|\\\\")
EMBEDDED = re.compile(r"(?i)(?<![a-z0-9])[a-z]:[\\/]|\\\\(?=[^\\\s])")


def snapshot(live, target):
    """Copy a live SQLite database; the source is opened read-only."""
    source = sqlite3.connect(Path(live).resolve().as_uri() + "?mode=ro", uri=True)
    try:
        destination = sqlite3.connect(target)
        try:
            source.backup(destination)
        finally:
            destination.close()
    finally:
        source.close()


def redirect(value, missing):
    """Move absolute Windows paths, alone or inside decoded JSON, below `missing`."""
    if isinstance(value, dict):
        return {key: redirect(item, missing) for key, item in value.items()}
    if isinstance(value, list):
        return [redirect(item, missing) for item in value]
    if isinstance(value, str) and ABSOLUTE.match(value) and not value.startswith(missing):
        return missing + "\\" + value.replace(":", "", 1).lstrip("\\/")
    return value


def _decode(text):
    try:
        return json.loads(text), True
    except ValueError:
        return text, False


def _strings(value):
    if isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)
    elif isinstance(value, str):
        yield value


def _text_cells(connection):
    tables = [row[0] for row in connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
    for table in tables:
        columns = [row[1] for row in connection.execute('PRAGMA table_info("%s")' % table)]
        for column in columns:
            for rowid, text in connection.execute('SELECT rowid, "%s" FROM "%s"' % (column, table)).fetchall():
                if isinstance(text, str):
                    yield table, column, rowid, text


def redirect_database(path, missing):
    """Rewrite every stored absolute path in one copied database; returns the count."""
    connection = sqlite3.connect(path)
    try:
        changes = []
        for table, column, rowid, text in _text_cells(connection):
            value, is_json = _decode(text)
            moved = redirect(value, missing)
            if moved != value:
                new = json.dumps(moved, ensure_ascii=False, separators=(",", ":")) if is_json else moved
                changes.append((table, column, rowid, new))
        for table, column, rowid, new in changes:
            connection.execute('UPDATE "%s" SET "%s"=? WHERE rowid=?' % (table, column), (new, rowid))
        connection.commit()
        return len(changes)
    finally:
        connection.close()


def stray_paths(path, missing):
    """Name the table columns that still mention an absolute path outside `missing`."""
    connection = sqlite3.connect(path)
    try:
        found = set()
        for table, column, _rowid, text in _text_cells(connection):
            for string in _strings(_decode(text)[0]):
                if any(not string.startswith(missing, match.start()) for match in EMBEDDED.finditer(string)):
                    found.add(table + "." + column)
        return sorted(found)
    finally:
        connection.close()


def pause_automation(path):
    """Keep scans in the copy from starting Compactor or Tidy runs."""
    connection = sqlite3.connect(path)
    try:
        connection.execute("UPDATE dirty_plugin_settings SET value_json='true' "
                           "WHERE plugin_id='dirtyCompactor' AND setting_key='automationPaused'")
        connection.execute("UPDATE dirty_plugin_settings SET value_json='\"manual\"' "
                           "WHERE plugin_id='dirtyTidy' AND setting_key='automationMode'")
        connection.execute("UPDATE dirty_plugin_settings SET value_json='false' "
                           "WHERE plugin_id='dirtyTidy' AND setting_key='tagUpdateEnabled'")
        for key, raw in connection.execute("SELECT setting_key,value_json FROM dirty_plugin_settings WHERE plugin_id='dirtyTasks'").fetchall():
            value = json.loads(raw)
            if key == "organization":
                value.update(automationMode="manual", tagUpdateEnabled=False)
            elif key == "encoding":
                value["automationPaused"] = True
            elif key == "execution":
                value = {"move": "manual", "rename": "manual", "tags": "manual", "encoding": {key: "manual" for key in value.get("encoding", {})}}
            else:
                continue
            connection.execute("UPDATE dirty_plugin_settings SET value_json=? WHERE plugin_id='dirtyTasks' AND setting_key=?", (json.dumps(value), key))
        connection.commit()
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--binary", required=True)
    parser.add_argument("--stash-db", type=Path, default=Path.home() / ".stash" / "stash-go.sqlite")
    parser.add_argument("--plugins-db", type=Path,
                        default=Path.home() / ".stash" / "plugins" / "dirtyPlugins" / "dirty_plugins.sqlite3")
    parser.add_argument("--stop-file", type=Path, help="Stop and delete the copy once this file exists")
    add_build_mode_argument(parser)
    args = parser.parse_args()
    if os.name != "nt":
        raise SystemExit("The copy redirects Windows media paths; run it on the Windows Stash host.")
    select_build_mode(args)
    registry = json.loads((ROOT / "scripts" / "plugin-registry.json").read_text(encoding="utf-8"))

    def prepare(root):
        missing = str(root / "missing")
        library = root / "stash.sqlite"
        shared = root / "plugins" / "dirtyPlugins" / "dirty_plugins.sqlite3"
        snapshot(args.stash_db, library)
        snapshot(args.plugins_db, shared)
        for database in (library, shared):
            count = redirect_database(database, missing)
            stray = stray_paths(database, missing)
            if stray:
                raise RuntimeError("Absolute paths remain in " + database.name + ": " + ", ".join(stray))
            print("COPY " + database.name + ": " + str(count) + " stored paths redirected", flush=True)
        pause_automation(shared)
        for plugin in registry:
            destination = root / "plugins" / plugin["id"]
            if not destination.exists():
                shutil.copytree(runtime_path(plugin["directory"]), destination,
                                ignore=shutil.ignore_patterns("runtime", "__pycache__", "*.sqlite*", "*.pyc"))
        # Backends inherit this; an override pointing at the live database would defeat the copy.
        os.environ["DIRTY_PLUGINS_DATABASE_PATH"] = str(shared)

    fixture = Fixture(args.binary, prefix="dirty-library-copy-", prepare=prepare)
    try:
        fixture.gql("mutation{setPluginsEnabled(enabledMap:{" + ",".join(p["id"] + ":true" for p in registry) + "})}")
        loaded = {plugin["id"]: plugin for plugin in fixture.gql("{plugins{id version enabled}}")["plugins"]}
        for plugin in registry:
            assert loaded[plugin["id"]]["enabled"], plugin["id"] + " is not enabled"
            with urllib.request.urlopen(fixture.url + "/plugin/" + plugin["id"] + "/javascript") as response:
                served = response.read()
            assert served == runtime_path(plugin["directory"], plugin["entry"]).read_bytes() + b"\n", \
                plugin["id"] + " does not serve the staged bundle"
        library = fixture.gql("{findScenes(filter:{per_page:1}){count scenes{files{path}}}"
                              "findPerformers(filter:{per_page:1}){count}}")
        missing = str(fixture.root / "missing")
        paths = [file["path"] for scene in library["findScenes"]["scenes"] for file in scene["files"]]
        assert all(path.startswith(missing) for path in paths) and not Path(missing).exists()
        print("PASS: seven staged plugins enabled and served; {} scenes, {} performers; media paths point to a "
              "missing folder".format(library["findScenes"]["count"], library["findPerformers"]["count"]), flush=True)
        print("UI " + fixture.url, flush=True)
        while not args.stop_file or not args.stop_file.exists():
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    except Exception:
        fixture.log.flush()
        print((fixture.root / "stash.log").read_text(errors="replace")[-2500:], flush=True)
        raise
    finally:
        fixture.close()
        if fixture.root.exists():
            print("WARNING: delete " + str(fixture.root) + " by hand; it holds the library copy", flush=True)
        else:
            print("Removed the library copy", flush=True)


if __name__ == "__main__":
    main()
