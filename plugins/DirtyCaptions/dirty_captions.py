"""Stash JSON protocol entry point for DirtyCaptions."""
from __future__ import annotations

import json
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


def main():
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    try:
        payload = json.load(sys.stdin)
        args = payload.get("args") or {}
        if not isinstance(args, dict):
            raise CaptionError("Plugin arguments must be an object.")
        client = StashClient(payload.get("server_connection") or {})
        result = captions(client, args) if args.get("mode") == "captions" else caption_index.run(client, args)
        json.dump({"output": result}, sys.stdout, ensure_ascii=True)
    except Exception as error:
        print("\x01e\x02DirtyCaptions: " + str(error), file=sys.stderr)
        # Tool failures can contain private paths. Keep those in Stash's log.
        message = str(error) if isinstance(error, CaptionError) and not str(error).startswith("Caption tool failed:") else "Could not read embedded captions. Check the Stash log and retry."
        json.dump({"error": message}, sys.stdout, ensure_ascii=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
