"""Saved grids for DirtyMultiscreen; standard library only."""

import sys
from pathlib import Path

for folder in ("dirtyPlugins", "DirtyPlugins"):
    shared = Path(__file__).resolve().parent.parent / folder
    if (shared / "dirty_plugins_protocol.py").is_file():
        sys.path.insert(0, str(shared))
        break


import dirty_plugins_protocol as protocol
import dirty_multiscreen_grids as grids


def run(payload, _reporter=None):
    args = payload.get("args") or {}
    mode = args.get("mode")
    if mode == "gridList":
        return {"grids": grids.list_grids(args.get("keepRecent"))}
    if mode == "gridGet":
        return grids.get_grid(args.get("id"))
    if mode == "gridSave":
        return grids.save_grid(args.get("name"), args.get("rows"), args.get("columns"), args.get("data"),
                               args.get("id"))
    if mode == "gridRecent":
        return {"grid": grids.save_recent(args.get("name"), args.get("rows"), args.get("columns"),
                                          args.get("data"), args.get("keep"), args.get("id"))}
    if mode == "gridKeep":
        return grids.keep_grid(args.get("id"), args.get("name"))
    if mode == "gridRename":
        return grids.rename_grid(args.get("id"), args.get("name"))
    if mode == "gridDelete":
        return {"deleted": grids.delete_grid(args.get("id"))}
    raise ValueError("Unsupported DirtyMultiscreen operation")


def public_error(error):
    """Validation messages are written for the browser; anything else could name a private path."""
    return str(error) if isinstance(error, grids.GridError) else "DirtyMultiscreen could not use its saved grids"


def main():
    return protocol.serve("DirtyMultiscreen", run, public_error=public_error)


if __name__ == "__main__":
    raise SystemExit(main())
