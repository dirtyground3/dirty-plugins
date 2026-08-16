# DirtyFileExtractor

DirtyFileExtractor is a Stash plugin that copies media from selected scenes,
markers, or images into a separate folder. It does not move, rename, or modify
the originals.

## Features

- An **Extract selected…** button appears beside the top toolbar when one or
  more scenes, markers, or images are selected.
- Scenes copy every attached media file.
- Markers copy the files belonging to their parent scenes. Selecting several
  markers from the same scene copies that source file only once.
- Images copy their original visual files.
- Optional title-based subfolders for scenes and images. Marker files use the
  parent scene's title.
- Collision policies: `rename` (safe default), `skip`, and `overwrite`.
- Optional dry-run mode.
- Live per-file log messages and byte-level progress in Stash's Tasks view.
- The UI is isolated from Stash's React tree: it does not patch components,
  change menus, replace elements, or render React children.
- Copy speed defaults to 20 MiB/s to avoid monopolizing the disk used by Stash;
  set **Maximum copy speed** to `0` for unlimited throughput.
- Uses only the Python standard library; no packages need to be installed.

## Installation

1. Copy this entire directory into Stash's plugin directory. The usual paths
   are `%USERPROFILE%\.stash\plugins\DirtyFileExtractor` on Windows and
   `~/.stash/plugins/DirtyFileExtractor` on Linux/macOS.
2. Copy the sibling **DirtyPlugins** directory into the same plugins directory.
3. In Stash, open **Settings > Plugins** and click **Reload Plugins**.
4. Expand **DirtyFileExtractor**, follow its settings link, and set
   **Destination folder** to an absolute path on
   the machine running Stash.
5. Ensure `python` on that machine runs Python 3.9 or newer.

For Docker, the destination must be a path *inside the Stash container*. Bind
mount the host export directory into the container, then enter that container
path in the plugin setting. The mounted directory must be writable by the user
running Stash.

Use **Browse…** beside **Destination folder** on the shared settings page to navigate directories exposed
by the Stash server and save the selected path. The standard **Edit** button is
still available for entering a path manually. In Docker, the picker shows the
container filesystem rather than host-only paths.

## Usage

Open Stash's **Scenes**, **Markers**, or **Images** page and select one or more
items using the normal checkboxes. Choose **Extract selected scene(s)**,
**Extract selected marker(s)**, or **Extract selected image(s)** beside the top
toolbar. Stash runs copying as a background job; progress and errors appear
under **Tasks** and in the Stash log.

The plugin copies source media only. For scenes and markers this means the
files attached to the scene; for images it means the original visual files. It
does not copy generated previews, screenshots, sprites, or unrelated sidecars.

## Collision behavior

- `rename` (default): keep the existing destination file and copy as
  `filename (2).ext`, `filename (3).ext`, and so on.
- `skip`: leave the existing destination file and skip that source.
- `overwrite`: replace the existing destination file.

Values other than these three are rejected.

## Development

Run the local checks from the repository root:

```powershell
python -B -m unittest discover -s tests -v
node --check plugins/DirtyFileExtractor/extractScenes.js
```

The UI integration is plain browser JavaScript attached directly to
`document.body`. It uses DirtyPlugins for GraphQL, configuration, notifications,
and shared visuals while intentionally avoiding Stash's experimental React
`PluginApi` for its own controls.

## License

DirtyFileExtractor is distributed under the [MIT License](LICENSE).
