# DirtyFileExtractor release notes

Newest first. Each GitHub Release of DirtyFileExtractor uses the entry that names its version.

- **DirtyCaptions 1.0.10, DirtyRank 1.1.2, DirtyStats 1.0.15, DirtyFileExtractor
  1.0.7, DirtyMultiscreen 1.0.29 and DirtyPlugins 1.0.22:** setting descriptions
  no longer say whether a toggle is enabled or disabled by default.

- **DirtyFileExtractor 1.0.6:** **Browse…** beside **Destination folder** opens
  the shared DirtyPlugins folder picker and works as before.

- **DirtyCompactor and DirtyFileExtractor 1.0.5:** subprocess reliability.
  - Quality samples, packet scans, and marker encoders share Windows child
    containment so forced parent termination stops them. Silent pipes cannot
    block cancellation/deadlines; diagnostics remain bounded.
  - Packet scans observe preview/run cancellation. Marker extraction stops and
    reaps its child before removing partial output, and callback cancellation
    can still abort before publication. Forced Stash termination can leave a
    partial file and an empty reservation, without leaving its encoder running.

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
