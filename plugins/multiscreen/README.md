# Stash Multiscreen

Stash Multiscreen adds an immersive multiscreen playback grid to Stash. It can launch from Stash scene and marker contexts while preserving the active list order when appropriate.

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
3. Configure **Stash Multiscreen** under **Installed Plugins**.
4. Use the Multiscreen action in Stash to open the playback grid.

## Configuration

The plugin exposes settings for screen count, grid dimensions, randomization, scene splitting, random start positions, looping, marker duration, muting, tab visibility behavior, and fallback scene sorting.

## Source

The source code and build script are maintained in the `infinitescreens` project. This folder contains the built files required to install the Stash plugin.

## License

No explicit license is currently included for Stash Multiscreen.
