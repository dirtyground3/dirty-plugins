# DirtyMultiscreen release notes

Newest first. Each GitHub Release of DirtyMultiscreen uses the entry that names its version.

- **DirtyMultiscreen 1.0.26:** a slimmer screen header and Stash's own search.
  - **Scene link:** an icon opens the scene page in a new tab instead of the
    scene title, which is now its tooltip.
  - **Search:** each screen's search uses Stash's own search box, saved
    filters, Filter dialog and sort, limited to the session. Lists and
    selections follow the chosen sort too.
  - **O per scene:** a drop button beside the scene link adds one O to that
    screen's scene only.
  - **Consistent controls:** the scene link and O counter sit on the right of
    each screen. Overlay buttons and performer portraits share one circular
    size, reshuffle has a matching border, and Remove screen uses a red minus.
    The X that finishes editing stays at the upper-right corner of each
    screen's control group.
  - **Marker seeking:** dragging past a marker's end keeps playing from the
    chosen time instead of looping or advancing immediately. Returning before
    the end restores normal marker playback; saved positions beyond it resume
    there too.
  - **Performer buttons:** round portraits with the Next mark on their corner.
    In a performer-filtered scene list, clicking a co-performer finds their
    other scenes while keeping the remaining scene filters.
  - **Top right:** the button that adds an O to every visible scene shows
    several drops, and the top-right buttons fade after three seconds without
    mouse movement unless hovered. They stay visible throughout edit mode.

- **DirtyMultiscreen 1.0.25:** edit mode, saved grids and autosaves.
  - **Edit mode:** the grid button opens it. Each screen can be flipped,
    rotated, looped or filled, and screens swap places by click or drag
    without stopping playback.
  - **Grid picker:** squares under the main buttons choose a grid of up to
    6 x 6, and every cell plays.
  - **Fit videos:** shapes each screen to its video and packs the screens into
    the window. It's on by default and is in the settings as **Fit screens to
    videos**.
  - **Saved grids:** keeps named grids with every screen's scene, position,
    sound and picture in the shared database, so they work from any browser.
  - **Autosaves:** your last grids are saved automatically as Autosave 1, 2 and
    so on, newest first. **Autosaves to keep** sets how many (5 by default);
    naming one keeps it for good.
  - **Changed:** rows, columns and **Total screens** are no longer on the
    settings page; edit mode chooses the grid instead.
  - **Fixed:** themes no longer draw a border around each screen.

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

- **DirtyMultiscreen 1.0.22:** each performer has a portrait button with a Next
  icon beside the screen's title and search. Click a portrait to move to another
  scene featuring that performer in the screen's session queue, including across
  pages and wrapping at the end. Tooltips explain the action; missing photos use
  initials. Other screens keep playing, and no-match results preserve playback.

- **DirtyPlugins 1.0.15, DirtyStats 1.0.13, DirtyRank 1.0.10 and DirtyMultiscreen
  1.0.21:** the new **StockStash** suite theme makes the suite look like Stash
  itself, with its slate surfaces, flat blue and red buttons, sunken fields and
  underlined tabs. Every suite theme now has its own navigation icons: De Stijl
  Dark keeps the previous ones and De Stijl uses light versions of them. A Stash
  theme that sizes navbar icons itself keeps that size. In DirtyStats, **Age at
  scene** now counts scenes instead of performers and shows native scene cards.

- **DirtyMultiscreen 1.0.20 and DirtyPlugins 1.0.12:** the new **Avoid the same
  scene on several screens** setting, enabled by default, starts every screen on
  a different scene and skips scenes already playing on another screen when a
  screen moves forward. Going back and search results never skip, so the same
  scene can still play on several screens on purpose. It is greyed out while
  **Split scenes between panes** is on, where screens never share a scene. A
  shuffle button beside the close button reshuffles every screen: its menu
  lists the scene orders with the current one checked, and choosing another
  order also saves it as the **Scene order** setting.

- **DirtyMultiscreen 1.0.19:** opening DirtyMultiscreen without a list (for
  example from the header on the home page) now plays through the whole library
  page by page instead of stopping after the first page, and scene search finds
  any playable scene in the library instead of only the loaded page.

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

- **DirtyMultiscreen 1.0.15:** use consistent native source menus in every pane
  with Refract, restoring each player's speed and projection controls while
  retaining the theme's ordinary styling. The normal scene page is unaffected.

- **DirtyMultiscreen 1.0.14:** keep the source/settings menu visible in right-hand
  video panes, including themes that collapse the native menu width.

- **DirtyMultiscreen 1.0.13:** disabled seek preview thumbnails inside the
  smaller video panes, while retaining the seek bar and time display.

- **DirtyMultiscreen 1.0.12:** native players have independent IDs, preventing
  another screen's duration from appearing on the timebar or affecting streaming
  playback and seeking.

- **DirtyMultiscreen 1.0.11:** restored translucent backgrounds behind each
  screen's scene title and search button, including hover and keyboard focus.

- **DirtyMultiscreen 1.0.10:** choosing a search result moves that screen to the
  scene's position in the session queue. Previous/Next follows its neighbors
  across pages while the other screens keep their positions.

- **DirtyMultiscreen 1.0.9:** title search matches the complete phrase, ignoring
  case and treating punctuation literally, instead of matching individual words.

- **DirtyMultiscreen 1.0.8:** scene search is limited to the current session's
  selection, sampled queue or filters, including later filtered pages. Marker
  results keep their original playback ranges.

- **DirtyMultiscreen 1.0.7:** apply starting positions after the native source is
  playable, avoiding pending seeks during transcoding fallback. Marker boundaries
  use the native full-scene clock, including transcoding offsets.

- **DirtyMultiscreen 1.0.6:** each screen has a scene search. Choose a scene from
  the full library without interrupting other screens; Next/Previous returns to
  that screen's existing queue.

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
