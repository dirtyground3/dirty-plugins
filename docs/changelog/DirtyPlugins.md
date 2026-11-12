# DirtyPlugins release notes

Newest first. Each GitHub Release of DirtyPlugins uses the entry that names its version.

- **DirtyPlugins 1.0.21:** fixed the native scene search toolbar under themes
  such as Refract. The controls wrap inside the search dialog and the theme's
  toolbar background no longer covers the backdrop.

- **DirtyPlugins 1.0.20:** Stash's own scene search, saved filters and Filter
  button are available inline as `DirtyPlugins.react.NativeSceneFilter`, which
  DirtyMultiscreen's search uses. The scene filter dialog keeps hiding Stash's
  list controls under themes that restyle them, and hides Stash's floating
  pagination bar.

- **DirtyPlugins 1.0.19:** the server folder picker is shared by the suite as
  `DirtyPlugins.ui.pickFolder`. DirtyFileExtractor's destination and DirtyTasks'
  backup folder use it.

- **DirtyPlugins 1.0.18:** the **General** tab offers optional grouping in Nav
  Hub's **Plugins** menu when Nav Hub is active.

- **DirtyMultiscreen 1.0.24 and DirtyPlugins 1.0.17:** the header button plays
  the list another plugin's page announces through a `stash-scenes:context`
  event, such as Cherry Pick's For you, in that plugin's own order when it asks
  for one (see [For plugin authors](../../README.md#for-plugin-authors)). Search and the
  performer buttons stay inside the list. The new Advanced settings choose
  whose lists play and how many items one list may hold. The button also
  launches from tag lists, tag selections and tag pages. **Total screens** is
  empty by default and fills every grid cell. When every other scene is already
  on a screen, Next moves on and repeats one. Every settings tab except
  DirtyRank's and DirtyTasks' has a **Reset to defaults** button.

- **DirtyMultiscreen 1.0.23 and DirtyPlugins 1.0.16:** a performer button loads
  that performer's scenes in the session's sort and moves to the next one, which
  is much faster on large libraries, and "No other scenes" clears after a
  second. Each button is a dark pill with the portrait and a Next icon beside it.
  The title, search and performer buttons show and hide with the player's
  control bar. **Show performer next-scene buttons** in the Navigation settings
  turns the portraits off. Documentation capture blurs video frames instead of
  covering whole screens, so the player controls stay visible.

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

- **DirtyPlugins 1.0.13:** the package list says that DirtyPlugins is the required
  runtime and adds only a settings link on its own, and it shows every plugin's
  full description instead of cutting longer ones off after the first line.

- **DirtyMultiscreen 1.0.20 and DirtyPlugins 1.0.12:** the new **Avoid the same
  scene on several screens** setting, enabled by default, starts every screen on
  a different scene and skips scenes already playing on another screen when a
  screen moves forward. Going back and search results never skip, so the same
  scene can still play on several screens on purpose. It is greyed out while
  **Split scenes between panes** is on, where screens never share a scene. A
  shuffle button beside the close button reshuffles every screen: its menu
  lists the scene orders with the current one checked, and choosing another
  order also saves it as the **Scene order** setting.

- **DirtyMultiscreen 1.0.18 and DirtyPlugins 1.0.11:** the DirtyMultiscreen
  settings tab is grouped into Grid, Scenes, Playback and Navigation, with
  shorter descriptions. **Spread performers and studios** is greyed out while
  **Keep the list order** is selected, where it has no effect. Saved settings
  keep their values.

- **DirtyMultiscreen 1.0.17 and DirtyPlugins 1.0.10:** **Scene order** replaces
  the **Random scenes** switch with seven orders: Random, Fewer repeats, Favour
  unwatched scenes, Favour high ratings and O counts, Favour recently added
  scenes, Mix favourites with unwatched scenes, and Keep the list order. The new
  **Spread performers and studios** setting, enabled by default, keeps scenes
  that share a performer or studio apart in a pane and across split panes.
  Random stays the default.

- **DirtyStats 1.0.10, DirtyMultiscreen 1.0.16 and DirtyPlugins 1.0.9:** the
  DirtyStats and DirtyMultiscreen tabs of the Dirty Plugins settings can hide
  their buttons from the Stash header. A button disappears or returns as soon
  as the setting changes, and its pages stay reachable by URL. A hidden
  DirtyMultiscreen button no longer counts scenes in the background.

- **DirtyPlugins 1.0.8:** a settings button with the suite's navigation colors
  opens the Dirty Plugins settings from the Stash header. It always follows the
  other Dirty plugin buttons and can be hidden in **General**.

- **DirtyPlugins 1.0.7:** autosaved settings no longer leave **Unsaved
  changes** showing after a successful save.

- **DirtyTasks 1.0.0, DirtyPlugins 1.0.6:** DirtyTidy and DirtyCompactor are now one
  plugin with organization, encoding and tag updates. Resize/Reencode add a
  validated alternate file to the existing scene and keep the original primary
  file. Media deletion and output review are removed. Settings migrate once;
  old Delete rules are retired, pending trial outputs are discarded, and a new
  preview is required before enabling automation. Upgrade instructions are in
  [DirtyTasks](../../plugins/DirtyTasks/).

- **DirtyPlugins 1.0.5:** backups use unique names and exclusive creation, preventing
  same-second collisions and accidental replacement of an existing backup.

- **DirtyPlugins, DirtyRank, and DirtyTidy 1.0.5:** workflow and state correctness.
  - Tidy manual confirmation identifies an immutable preview. A later preview
    with the same strategy cannot add unseen moves; each confirmed source and
    destination is checked again before execution. Automation still approves
    a strategy for future library changes. Generate a new preview after updating.
  - Hub settings events refresh the affected plugin while preserving raw edits,
    pending saves, and custom-panel workflows. Numeric autosave now enforces
    authored bounds, integer requirements, and steps.
  - Rank reads ratings/settings with their revision from one database snapshot,
    rejects stale individual replies, and publishes each vote/undo response
    once after updating both performers. Unaffected score caches are retained.

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

- **DirtyPlugins 1.0.2, DirtyRank 1.0.2, DirtyCompactor 1.0.2:** settings
  labels, defaults, bounds and options, and the constants shared by browser and
  backend, now come from one schema per plugin, so Stash's settings, the browser
  code and the Python backends cannot drift apart. DirtyRank's backend lists
  gender-box categories in a stable order. No visible behavior changes.

- **1.0.1 for all plugins, DirtyStats 1.0.2:** minified release bundles without
  inline source maps, and DirtyStats loads only the ECharts modules it uses.
  Served plugin JavaScript fell from about 8.8 MB to 1.5 MB.

- **1.0.0 for all plugins:** frontends rewritten in TypeScript/TSX, each
  compiled to one bundle that uses Stash's React. Settings, stored data and
  behavior are unchanged.
