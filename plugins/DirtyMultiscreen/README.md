# DirtyMultiscreen

DirtyMultiscreen adds an immersive multiscreen playback grid to Stash. It can launch from Stash scene, marker, performer, and studio contexts while preserving the active list order when appropriate.

## Features

- Configurable number of screens, rows, and columns.
- Random or ordered scene playback.
- Optional scene splitting across panes.
- Contextual playback continues through independently loaded pages of at most 240 items per pane.
  A pending page is shared between panes, and the current video remains visible if loading fails.
  Explicit selections include items selected on other native pages. Random playback permutes
  each bounded page independently per pane; split assignments remain stable between page requests.
- Random starting positions, looping, and start-muted behavior.
  Each native player has its own identity, keeping durations and streaming
  controls independent between screens.
  Starting positions are applied once the native source is playable, including
  after transcoding fallback, and do not race Stash's saved resume position.
- Marker playback with a configurable fallback duration.
- Optional pause when the browser tab is hidden.
- Seek preview thumbnails are disabled in the grid to keep smaller panes clear.
- The source/settings menu opens to the left of its button so it stays visible in right-hand panes, including with themes that override the native menu width.
- With Refract, every pane uses the same native source menu and its own speed and projection controls. Refract's single-player replacement panel is hidden inside the grid; its ordinary player styling is preserved.
- Search video titles available in the current session from each screen without
  interrupting the others. Explicit selections and sampled queues stay fixed;
  filtered sessions include later queue pages and preserve all launch filters.
  Choosing a result moves that screen to its position in the session queue, so
  Previous/Next follows from there, including across pages.
- Scene titles and search buttons use translucent backgrounds over the video.
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
muting, marker duration, hidden-tab handling, and the Stash header button in
one panel.

## Installation

1. Install the published `multiscreen.zip`, or run `npm ci` and `npm run build` from the repository root and copy `.build/plugins/DirtyMultiscreen/` into Stash's `plugins/multiscreen/` directory.
2. Install the compatible **DirtyPlugins** package, or copy its staged `.build/plugins/DirtyPlugins/` files into `plugins/dirtyPlugins/`.
3. In Stash, open **Settings > Plugins** and select **Reload Plugins**.
4. Expand **DirtyMultiscreen** and follow its settings link.
5. Use the DirtyMultiscreen action in Stash to open the playback grid.

In the grid, click the magnifying glass beside a screen's scene title, type a
scene search, and choose a result. Search results are paginated and limited to
the session's playable videos. Titles match the complete text you type, ignoring
case and treating punctuation literally. During marker playback, results keep the original
marker ranges.

The authored source directory requires a build before installation. Back up
replaced files, copy runtime files before the manifest, reload plugins, then
hard-refresh the Stash browser tab (Ctrl+F5). Preserve settings, databases,
runtime files and Stash's package-provenance `manifest` during a local update.

## Configuration

The plugin exposes settings for screen count, grid dimensions, randomization, scene splitting, random start positions, looping, marker duration, muting, tab visibility behavior, and fallback scene sorting.

The following playback options are enabled by default: **Random scenes**,
**Start muted**, **Random start**, **Loop scenes**, and **Pause when hidden**.

**Show DirtyMultiscreen in the Stash header** (enabled by default) hides or
restores the grid button without a reload. While it is hidden, the button
counts no scenes and the player stays reachable at `/plugins/multiscreen`.

## Source

Strict TypeScript domains and services live under `src/`; focused TSX components
use Stash's React instance and the DirtyPlugins public API. The build stages one
browser IIFE, `multiscreen.js`, as the manifest's sole frontend script. Release
builds carry no source map; `npm run build:dev` adds an inline map that travels
with `/plugin/multiscreen/javascript`. No React or hub
implementation is bundled into this plugin.

The entry registers its route and patches once through the hub's
`registerPlugin`. A reloaded bundle is ignored, including after a partial
native registration failure, which is logged once. Unmounting components clear
their timers, listeners and observers, ignore late responses and release the
native players.
Domain tests compile modules on demand; UI tests execute the final browser bundle.
An opt-in isolated Stash fixture uses synthetic media only:

```powershell
npm run build
python -B tests/test_dirty_multiscreen_stash_integration.py --binary /path/to/stash --serve --stop-file .build/multiscreen-review-stop
```

Add `--transcode` to use synthetic FFV1 files and exercise native source fallback
and full-scene time offsets during browser review.

Close the review tab and create the named stop file to remove the temporary
fixture. The remaining browser/manual limits are listed in the repository's
`TODO.md`.

The UI consumes DirtyPlugins' shared GraphQL client, value helpers, React
icon/state components, and visual tokens so its controls remain consistent with
the other plugins in this repository.
The navigation action is one focusable link, and overlay controls become fully
visible on keyboard focus. Native ScenePlayer remains the playback component.
With `?docsCapture=1`, playback frames and titles are covered by an opaque
documentation placeholder.

## License

DirtyMultiscreen is distributed under the [MIT License](LICENSE).
