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

1. Install the published `multiscreen.zip`, or run `npm ci` and `npm run build` from the repository root and copy `.build/plugins/DirtyMultiscreen/` into Stash's `plugins/multiscreen/` directory.
2. Install the compatible **DirtyPlugins** package, or copy its staged `.build/plugins/DirtyPlugins/` files into `plugins/dirtyPlugins/`.
3. In Stash, open **Settings > Plugins** and select **Reload Plugins**.
4. Expand **DirtyMultiscreen** and follow its settings link.
5. Use the DirtyMultiscreen action in Stash to open the playback grid.

The authored source directory requires a build before installation. Back up
replaced files, copy runtime files before the manifest, reload plugins, then
hard-refresh the Stash browser tab (Ctrl+F5). Preserve settings, databases,
runtime files and Stash's package-provenance `manifest` during a local update.

## Configuration

The plugin exposes settings for screen count, grid dimensions, randomization, scene splitting, random start positions, looping, marker duration, muting, tab visibility behavior, and fallback scene sorting.

The following playback options are enabled by default: **Random scenes**,
**Start muted**, **Random start**, **Loop scenes**, and **Pause when hidden**.

## Source

Strict TypeScript domains and services live under `src/`; focused TSX components
use Stash's React instance and the DirtyPlugins public API. The build stages one
browser IIFE, `multiscreen.js`, as the manifest's sole frontend script. Release
builds carry no source map; `npm run build:dev` adds an inline map that travels
with `/plugin/multiscreen/javascript`. No React or hub
implementation is bundled into this plugin.

The entry validates dependencies and claims its guard before registering routes
or patches. Repeated loads retain that guard, including after a partial native
registration failure. Teardown deactivates integrations, clears owned timers,
listeners and observers, ignores late responses and unmounts the native players.
Domain tests import compiled modules; UI tests execute the final browser bundle.
An opt-in isolated Stash fixture uses synthetic media only:

```powershell
npm run build
python -B tests/test_dirty_multiscreen_stash_integration.py --binary /path/to/stash --serve --stop-file .build/multiscreen-review-stop
```

Close the review tab and create the named stop file to remove the temporary
fixture. See `docs/build-migration-status.md` for acceptance results and explicit
browser/manual limits.

The UI consumes DirtyPlugins' shared GraphQL client, value helpers, React
icon/state components, and visual tokens so its controls remain consistent with
the other plugins in this repository.
The navigation action is one focusable link, and overlay controls become fully
visible on keyboard focus. Native ScenePlayer remains the playback component.
With `?docsCapture=1`, playback frames and titles are covered by an opaque
documentation placeholder; `?censorMedia=1` is also accepted.

## License

DirtyMultiscreen is distributed under the [MIT License](LICENSE).
