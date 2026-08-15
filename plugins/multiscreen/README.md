# DirtyMultiscreen

DirtyMultiscreen adds an immersive multiscreen playback grid to Stash. It can launch from Stash scene and marker contexts while preserving the active list order when appropriate.

## Features

- Configurable number of screens, rows, and columns.
- Random or ordered scene playback.
- Optional scene splitting across panes.
- Random starting positions, looping, and start-muted behavior.
- Marker playback with a configurable fallback duration.
- Optional pause when the browser tab is hidden.
- Runs inside Stash and uses its existing scene and marker data.

## Installation

1. Copy this entire `multiscreen` directory into Stash's plugin directory. The usual paths are `%USERPROFILE%\.stash\plugins\multiscreen` on Windows and `~/.stash/plugins/multiscreen` on Linux/macOS.
2. In Stash, open **Settings > Plugins** and select **Reload Plugins**.
3. Configure **DirtyMultiscreen** under **Installed Plugins**.
4. Use the DirtyMultiscreen action in Stash to open the playback grid.

## Configuration

The plugin exposes settings for screen count, grid dimensions, randomization, scene splitting, random start positions, looping, marker duration, muting, tab visibility behavior, and fallback scene sorting.

The following playback options are enabled by default: **Random scenes**,
**Start muted**, **Random start**, **Loop scenes**, and **Pause when hidden**.

## Source

The source code and build script are maintained in the `infinitescreens` project. This folder contains the built files required to install the Stash plugin.

## License

DirtyMultiscreen is distributed under the [MIT License](LICENSE).
