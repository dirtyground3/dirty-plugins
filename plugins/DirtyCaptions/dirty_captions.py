"""Stash JSON protocol entry point for DirtyCaptions."""
from __future__ import annotations

from pathlib import Path
import shutil
import sys

for folder in ("dirtyPlugins", "DirtyPlugins"):
    shared = Path(__file__).resolve().parent.parent / folder
    if (shared / "dirty_plugins_client.py").is_file():
        sys.path.insert(0, str(shared))
        break
from dirty_plugins_client import StashClient
sys.path.insert(0, str(Path(__file__).resolve().parent))
from dirty_captions_media import CaptionError, read_captions
import dirty_captions_index as caption_index


import dirty_plugins_protocol as protocol


def captions(client, args):
    if args.get("mode") != "captions":
        raise CaptionError("Unknown DirtyCaptions operation.")
    scene_id = str(args.get("sceneId") or "")
    if not scene_id.isdigit():
        raise CaptionError("A scene ID is required.")
    scene = client.call("query($id:ID!){findScene(id:$id){id files{" + caption_index.FILE_FIELDS + "}}}", {"id": scene_id}).get("findScene")
    if not scene or not scene.get("files"):
        raise CaptionError("The scene has no playable file.")
    file_id = str(args.get("fileId") or scene["files"][0]["id"])
    file = next((item for item in scene["files"] if str(item["id"]) == file_id), None)
    if not file:
        raise CaptionError("The requested file does not belong to this scene.")
    path = Path(file["path"])
    if not path.is_file():
        raise CaptionError("The scene file is unavailable on the Stash server.")
    general = client.call("{configuration{general{ffmpegPath ffprobePath}}}")["configuration"]["general"]
    tools = {}
    for name in ("ffprobe", "ffmpeg"):
        tools[name] = general.get(name + "Path") or shutil.which(name)
        if not tools[name]:
            raise CaptionError(name + " is unavailable. Configure its path in Stash.")
    # Resolve paths only from Stash. UI callers cannot request arbitrary files.
    result = read_captions(tools["ffprobe"], tools["ffmpeg"], path,
                           on_probe=lambda streams, original: caption_index.record_playback(client, scene, file, streams, original))
    result.update(sceneId=scene_id, fileId=file_id)
    return result


def run(payload, _reporter=None):
    args = payload.get("args") or {}
    if not isinstance(args, dict):
        raise CaptionError("Plugin arguments must be an object.")
    client = StashClient(payload.get("server_connection") or {})
    return captions(client, args) if args.get("mode") == "captions" else caption_index.run(client, args)


def public_error(error):
    # Tool failures can contain private paths. Keep those in Stash's log.
    if isinstance(error, CaptionError) and not str(error).startswith("Caption tool failed:"):
        return str(error)
    return "Could not read embedded captions. Check the Stash log and retry."


def main():
    # The player and the settings page call this often; only failures are logged.
    return protocol.serve("DirtyCaptions", run, public_error=public_error, quiet=True)


if __name__ == "__main__":
    sys.exit(main())
