# DirtyMultiscreen

DirtyMultiscreen adds an immersive multiscreen playback grid to Stash. It can launch from Stash scene, marker, performer, and studio contexts while preserving the active list order when appropriate.

## Features

- Configurable number of screens, rows, and columns.
- Random or ordered scene playback.
- Optional scene splitting across panes.
- Random starting positions, looping, and start-muted behavior.
- Marker playback with a configurable fallback duration.
- Optional pause when the browser tab is hidden.
- The O-counter button fades away after one click per playback session. Failed saves can be retried without incrementing scenes that already succeeded.
- Runs inside Stash and uses its existing scene and marker data.

## Screenshots

### Playback grid

![DirtyMultiscreen four-pane playback grid with video frames blurred](../../docs/images/dirty-multiscreen-grid-censored.png)

The capture shows a real edge-to-edge four-pane session. The video frames and
scene titles are blurred for the public repository.

### Settings

![DirtyMultiscreen playback and grid settings](../../docs/images/dirty-multiscreen-settings.png)

Configure the grid geometry, scene distribution, starting behavior, looping,
muting, marker duration, and hidden-tab handling in one panel.

## Installation

1. Copy this entire `DirtyMultiscreen` directory into Stash's plugin directory. The usual paths are `%USERPROFILE%\.stash\plugins\DirtyMultiscreen` on Windows and `~/.stash/plugins/DirtyMultiscreen` on Linux/macOS.
2. Copy the sibling **DirtyPlugins** directory into the same plugins directory.
3. In Stash, open **Settings > Plugins** and select **Reload Plugins**.
4. Expand **DirtyMultiscreen** and follow its settings link.
5. Use the DirtyMultiscreen action in Stash to open the playback grid.

## Configuration

The plugin exposes settings for screen count, grid dimensions, randomization, scene splitting, random start positions, looping, marker duration, muting, tab visibility behavior, and fallback scene sorting.

The following playback options are enabled by default: **Random scenes**,
**Start muted**, **Random start**, **Loop scenes**, and **Pause when hidden**.

## Source

The plugin has no build step. Stash serves `multiscreenPlaylists.js`,
`multiscreenSettings.js`, and `multiscreen.js` directly, in the order listed
in `multiscreen.yml`, and the UI renders through the shared
`DirtyPlugins.react.html` template tag.

The UI consumes DirtyPlugins' shared GraphQL client, value helpers, React
icon/state components, and visual tokens so its controls remain consistent with
the other plugins in this repository.
The navigation action is one focusable link, and overlay controls become fully
visible on keyboard focus. Native ScenePlayer remains the playback component.
With `?docsCapture=1`, playback frames and titles are covered by an opaque
documentation placeholder; `?censorMedia=1` is also accepted.

## License

DirtyMultiscreen is distributed under the [MIT License](LICENSE).
