# DirtyStats release notes

Newest first. Each GitHub Release of DirtyStats uses the entry that names its version.

- **DirtyRank 1.1.1 and DirtyStats 1.0.14:** setting descriptions no longer end
  with "Enabled by default."

- **DirtyPlugins 1.0.15, DirtyStats 1.0.13, DirtyRank 1.0.10 and DirtyMultiscreen
  1.0.21:** the new **StockStash** suite theme makes the suite look like Stash
  itself, with its slate surfaces, flat blue and red buttons, sunken fields and
  underlined tabs. Every suite theme now has its own navigation icons: De Stijl
  Dark keeps the previous ones and De Stijl uses light versions of them. A Stash
  theme that sizes navbar icons itself keeps that size. In DirtyStats, **Age at
  scene** now counts scenes instead of performers and shows native scene cards.

- **DirtyStats 1.0.12, DirtyRank 1.0.9 and DirtyPlugins 1.0.14:** the new **Scenes
  per studio** statistic is a multi-level pie chart with up to four levels of
  studios, as a page and a dashboard widget. Click a segment to zoom into a studio
  and show its scenes. **Tag DNA** has a **View** choice beside the treemap: a **Bar
  chart** of average rating colored by scene count, and a **Cluster plot** that
  groups tags appearing on the same scenes. The entries of the DirtyStats page menu
  and the DirtyRank leaderboard menu are real links, so they can be opened in a new
  tab or window.

- **DirtyStats 1.0.11:** the dashboard has an **Options** button beside **Edit
  dashboard** that opens the DirtyStats settings. The new **Replace default
  stats page** setting, off by default, sends the Stash
  statistics button and `/stats` to the dashboard. The new **Default stats**
  widget shows the figures of that page, so the dashboard can fully replace it.
  **Hide widget titles**, also off by default, removes the title above every
  dashboard widget.

- **DirtyStats 1.0.10, DirtyMultiscreen 1.0.16 and DirtyPlugins 1.0.9:** the
  DirtyStats and DirtyMultiscreen tabs of the Dirty Plugins settings can hide
  their buttons from the Stash header. A button disappears or returns as soon
  as the setting changes, and its pages stay reachable by URL. A hidden
  DirtyMultiscreen button no longer counts scenes in the background.

- **DirtyStats 1.0.9:** ECharts and the world map moved into a separate file
  that loads the first time a Stats page opens. The Stats script that every
  Stash page loads fell from 1.15 MB to 160 KB. Charts and map look the same.

- **DirtyStats 1.0.8:** the navigation icon is now a bubble chart, so it no
  longer looks like the DirtyMultiscreen grid.

- **DirtyStats 1.0.7:** added **Performer vs scene rating** as a full view and
  dashboard widget. Compare each performer's rating with the average of their
  rated scenes, with a dotted equal-rating diagonal, native performer filters,
  performer selection and PNG export.

- **DirtyStats 1.0.6, DirtyRank and DirtyMultiscreen 1.0.5:** bounded library work.
  - Constellations display at most 5,000 connections, prioritizing a strongest-first
    spanning forest and then strongest remaining links. Counts include hidden links.
  - Rank loads its complete reference population in 500-row pages, coalesces compatible
    requests, and separates settings refreshes from library refreshes. Preferred playback
    uses bounded queries and retains the earliest marker across best-rated scene ties.
  - Multiscreen contextual queues continue in independent pages capped at 240 items.
    Panes share pending requests; explicit selections stay complete; random playback
    uses bounded page permutations. Failed loads retain the current video and can retry.

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
