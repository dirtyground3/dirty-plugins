# DirtyCaptions release notes

Newest first. Each GitHub Release of DirtyCaptions uses the entry that names its version.

- **DirtyCaptions 1.0.10, DirtyRank 1.1.2, DirtyStats 1.0.15, DirtyFileExtractor
  1.0.7, DirtyMultiscreen 1.0.29 and DirtyPlugins 1.0.22:** setting descriptions
  no longer say whether a toggle is enabled or disabled by default.

- **DirtyTasks 1.0.11 and DirtyCaptions 1.0.9:** an encoding run that no Stash
  task is running any more, for example after Stash restarted, no longer blocks
  file organization. Organization pauses it and goes ahead, **Pause** and
  **Cancel** act on it at once, and the Stash log says when organization has to
  wait. Bulk edits of selected scenes no longer start one caption-index job per
  scene.

- **DirtyCaptions 1.0.8:** edits to the **Production date** field added in Stash
  0.32 count as metadata saves and no longer queue caption-index work.

- **DirtyCaptions 1.0.7:** scene rating, rating-tag and other metadata saves no
  longer queue caption-index work. Media changes, custom-field edits and hooks
  without field information still update the index; bulk scene inputs are handled.

- **DirtyStats and DirtyCaptions 1.0.6, DirtyRank and DirtyMultiscreen 1.0.5:** frontend responsiveness.
  - Dashboard charts retain their instances and zoom/pan while options change.
    Origin also retains zoom/pan on country, label and theme changes and registers its map once.
    Unrelated edits reuse widget aggregates. Only added or changed datasets load;
    removed requests are cancelled and their data is released. Growth widgets share
    capacity discovery, and full-view forecast selections reuse daily aggregation.
  - Rank reuses category entries and confidence estimates until their population,
    settings, or rating pool changes. Score rebuilds evaluate each rating pair once,
    preserving tied scores and the existing formula.
    Accepted votes retain comparison sums and replace only changed performers'
    contributions; larger updates and snapshots rebuild the affected scores.
    Cold comparisons reuse one shifted weight per rating and yield between bounded
    batches. Overall leaderboards and native sorting wait for complete scores;
    changes cancel obsolete calculations, and ordering calculates each overall value once.
  - Advancing a Multiscreen pane retains other panes' marker and audio subscriptions.
    Embedded captions load silently in every native player, including Multiscreen panes.
    Slow caption status polls remain visible without overlapping requests, and successful
    polling clears recovered errors.

- **DirtyCaptions 1.0.6, DirtyCompactor and DirtyFileExtractor 1.0.5:** backend efficiency.
  - Captions reuses short database reads during indexing, reads pending revisions
    per scene page, and limits queue batches in SQLite. Unchanged media still
    requires no file access; cancellation, leases, and queue revisions stay fresh.
  - Compactor polling reads no longer reserve the shared database's writer lock.
    Ownership checks before encoding and replacement query the affected scene
    instead of downloading the library. Native rule criteria and the attachment
    set are checked again; files with another owner remain blocked.
  - Extractor resolves scenes in batches of 25 and markers/images in batches
    of 100 while preserving order, missing-item reporting, and collision planning.
    FFmpeg configuration is
    resolved once per run, including runs with multiple failed marker clips.

- **DirtyCaptions 1.0.5:** playback uses the caption index.
  - Opening a scene whose file the index found without subtitle streams no
    longer probes the file. Stash's stored size, modification time and hashes
    decide whether the saved result still applies.
  - Playback no longer queues a caption-index job when the index already
    holds the same result. Unknown files and results that differ are still
    saved and queued.
  - A request that gets no answer from Stash, as can happen when changing
    scenes quickly, is no longer reported. It is repeated after 1, 2, 4, 8
    and 16 seconds. Errors returned by Stash still show **Retry captions**.

- **DirtyStats 1.0.5 and 1.0.4 for the other plugins:** internal simplification
  with no changes to settings or stored data.
  - The hub registers every plugin once per page. A plugin whose registration
    fails is reported once in the browser console
    (`[<pluginId>] registration failed`) and no longer stops the others.
  - Browser debug timing of patches and routes is recorded only when debugging
    was enabled before the page loaded (set `dirtyPluginsDebug` in localStorage
    and reload). `dirtyPluginsDumpDebugLogs()` still works;
    `DirtyPlugins.dumpDebugLogs()` is removed.
  - Server logs: every backend reports failures in the same form
    (`<Plugin> failed: mode=... after ...ms: ...`), including DirtyCompactor,
    which previously reported them only to the browser. DirtyStats'
    `started`/`finished` lines use the same wording as the other backends.
  - The marker that tells DirtyTidy, DirtyCaptions and DirtyCompactor
    automation to ignore scans started by DirtyCompactor moved to another table
    of the shared database. Markers written before the update are not read, so
    a Compactor-started scan that is still running during the update may be
    treated as an ordinary scan once.
  - Developer-facing: plugins no longer expose `destroy()` handles or the
    `DirtyPlugins.values`/`settingsMetadata`/`unregister*` members.

- **DirtyStats 1.0.4 and 1.0.3 for the other plugins:** internal
  simplification with no behavior changes. The hub's internal modules import
  each other instead of being wired through factory dependency objects, and
  DirtyMultiscreen's components import their bound runtime. Converted
  `var`/`function` code and template-era JSX are modernized, and repeated
  logic is shared: leaderboard paging, the battle vote queue, matchmaking
  scoring, Stats aggregations, shared settings storage, backend start-up and
  the backends' settings parsing and result building.
  Settings, stored data and the hub's public API are unchanged; the
  DirtyPlugins backend's failure log line now matches the other backends.

- **DirtyStats 1.0.3 and 1.0.2 for the other plugins:** dead code and
  compatibility with pre-1.0 developer builds are removed. The hub no longer
  bundles HTM (`react.html`) and exposes only the API members the plugins use;
  older-hub fallbacks and the `?censorMedia=1` alias are gone (use
  `?docsCapture=1`). Readers for data written by pre-1.0 versions were removed
  after a read-only check showed current data no longer uses them: the shared
  Stats rounding key and Stats-only theme, Tidy JSON-string settings, Rank
  cohort-only settings and old category IDs, caption-index records without
  Stash identities, and Compactor outcomes recorded before quick fingerprints.
  DirtyRank's reset message drops its always-zero failure count.

- **1.0.1 for all plugins, DirtyStats 1.0.2:** minified release bundles without
  inline source maps, and DirtyStats loads only the ECharts modules it uses.
  Served plugin JavaScript fell from about 8.8 MB to 1.5 MB.

- **1.0.0 for all plugins:** frontends rewritten in TypeScript/TSX, each
  compiled to one bundle that uses Stash's React. Settings, stored data and
  behavior are unchanged.
