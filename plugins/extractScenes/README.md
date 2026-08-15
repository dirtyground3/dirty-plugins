# Extract Scenes

Extract Scenes is a Stash plugin that copies every media file attached to one or
more selected scenes into a separate folder. It does not move, rename, or
modify the originals.

## Features

- **Copy scene files** appears beside Stash's Export actions in the scene
  selection menu.
- Copies all files attached to each selected scene.
- Optional scene-title subfolders.
- Collision policies: `rename` (safe default), `skip`, and `overwrite`.
- Optional dry-run mode.
- Live per-file log messages and byte-level progress in Stash's Tasks view.
- Uses Stash's official filtered-scene-list patch point and a standard React
  portal without traversing or modifying Stash's rendered scene tree.
- Copy speed defaults to 20 MiB/s to avoid monopolizing the disk used by Stash;
  set **Maximum copy speed** to `0` for unlimited throughput.
- Uses only the Python standard library; no packages need to be installed.

## Installation

1. Copy this entire directory into Stash's plugin directory. The usual paths
   are `%USERPROFILE%\.stash\plugins\extractScenes` on Windows and
   `~/.stash/plugins/extractScenes` on Linux/macOS.
2. In Stash, open **Settings > Plugins** and click **Reload Plugins**.
3. Expand **Extract Scenes** and set **Destination folder** to an absolute path on
   the machine running Stash.
4. Ensure `python` on that machine runs Python 3.9 or newer.

For Docker, the destination must be a path *inside the Stash container*. Bind
mount the host export directory into the container, then enter that container
path in the plugin setting. The mounted directory must be writable by the user
running Stash.

## Usage

Open Stash's **Scenes** page and select one or more scenes using the normal
checkboxes. Open the selection actions menu (the three-dot button), then choose
**Copy scene files** near **Export**. Stash runs copying as a background job;
progress and errors appear under **Tasks** and in the Stash log.

The plugin copies Stash scene files only. It does not copy generated previews,
screenshots, sprites, or unrelated sidecar files.

## Collision behavior

- `rename` (default): keep the existing destination file and copy as
  `filename (2).ext`, `filename (3).ext`, and so on.
- `skip`: leave the existing destination file and skip that source.
- `overwrite`: replace the existing destination file.

Values other than these three are rejected.

## Development

Run the local checks from this directory:

```powershell
python -m unittest discover -s tests -v
python -m py_compile extract_scenes.py
node --check extractScenes.js
```

The UI integration uses Stash's experimental `PluginApi`, so future Stash
versions may require small compatibility updates.
