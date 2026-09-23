# DirtyPlugins

DirtyPlugins provides the shared runtime and unlisted settings page used by
plugins in this repository. It is installed automatically as a dependency
when a Dirty plugin is installed from the package source.

The shared runtime includes the GraphQL client, plugin-configuration helpers,
value coercion, stacked notifications, reusable React settings-card, section,
toggle, icon, and state components, custom settings-panel registration, and
the visual tokens used by the Dirty plugins.

## UI contract

DirtyRank established the shared visual reference. Use
`DirtyPlugins.react.Button`, `Field`, `IconButton`, `SaveStatus`, `Badge`,
`Metric`, `Pagination`, and `NavAction` for suite-owned controls. Keep content
and interaction details in the plugin. `Field` associates its label, help, and
error with one native input, select, or textarea; use a stable `id` and retain
the user's invalid value until they correct it. `Button` defaults to a
non-submitting button and offers a compact size, a Bootstrap-compatible tone,
and disabled/busy state. `NavAction` renders one link with its accessible name.

The shared CSS owns `--dirty-ui-accent`, `--dirty-ui-emphasis`, status colours,
focus colour, a small spacing scale (`--dirty-ui-space-*`), radii, and the
`.dirty-ui-control`, `.dirty-ui-field`, `.dirty-ui-page-shell`,
`.dirty-ui-table`, and `.dirty-ui-pagination` classes. `.dirty-ui-button`
now owns the rounded shape, regular 2.5rem height, hover movement, and
teal/graphite/amber tones across suite-owned actions. Compact actions are
2rem; mixed toolbars use the regular height. `.dirty-ui-pilot` remains a Rank
theme adapter. Keep domain colours such as Rank medals and Stats chart
categories separate from save/error status colours. Destructive actions use
warm amber; error messages retain red. Inherit the Stash font.

Use `.dirty-ui-control-row` for a toolbar that places suite-owned selects or
text fields beside buttons. Its controls share `--dirty-ui-control-height`
(2.5rem): selects have compact internal padding and buttons have a larger hit
area. Keep native Stash controls outside this rule, and use the separate compact
number-field treatment where a dense numeric editor needs it.

Use `DirtyPlugins.native.loadComponent(name)` for a lazily exposed Stash
component when the plugin already has a suitable fallback. It shares concurrent
loads and reports unavailable components; it does not replace native performer
cards, scene players, or their theme behaviour. Use
`DirtyPlugins.native.ensureComponents(loadableName, requiredNames)` when one
Stash module registers several components, as the Stats filters do.
`DirtyPlugins.ui.trapDialogTab` and `lockBodyScroll` cover keyboard looping and
stacked scroll locks for suite-owned dialogs. `DirtyPlugins.captureEnabled`
accepts `docsCapture=1` and Rank's legacy `censorMedia=1`; `captureUrl` carries
capture mode through suite navigation. Capture pages still need opaque covers
for media and private paths before a screenshot is saved.

The suite uses PluginApi React, router, Bootstrap styling and Stash components.
DirtyStats alone bundles ECharts and map data for charts; no chart library is
loaded by the hub or DirtyRank. New shared code has no build step or additional
package dependency. The synthetic `tests/fixtures/dirty_rank_harmony.html` and
`tests/fixtures/dirty_suite_harmony.html` pages compare Rank and suite-wide
controls without loading private data or media.

`DirtyPlugins.theme.defaultKey` owns the suite's default visual theme. It is
`classic` (Midnight) for a fresh DirtyStats install; a saved valid theme wins,
and an unknown value falls back visually without overwriting that saved value.
`DirtyPlugins.theme.readRole(root, property)` reads effective CSS variables
without inspecting stylesheet rules, so external Stash theme stylesheets are
safe to use. Stats charts consume these roles for semantic chrome while their
categorical palettes remain Stats-specific.

DirtyPlugins also owns `dirty_plugins.sqlite3`, the shared WAL-enabled database
for high-frequency plugin data that should not trigger Stash entity-update
hooks. Runtime database and WAL files are excluded from plugin packages and
remain in the installed DirtyPlugins directory across ordinary updates.

The database is also the authoritative settings store for DirtyFileExtractor,
DirtyMultiscreen, DirtyTidy, DirtyRank, and DirtyStats. The Stash manifests retain setting
definitions so the shared hub can render typed controls, but Stash's plugin
configuration values are not read or written by Dirty plugins.

Managed plugins currently include DirtyFileExtractor, DirtyMultiscreen,
DirtyTidy, DirtyRank, and DirtyStats. DirtyRank uses a custom hub panel for its categories,
performer cohort, Glicko-2 parameters, and guarded data tools.

The page has no navigation entry. Open it using the link shown in the normal
Stash settings panel for a managed Dirty plugin. Each installed plugin has its
own inner tab, and the link opens that plugin's tab directly.
On Stash's main Plugins page, the Dirty plugin setting cards are kept together
in a stable shared-hub-first order without changing other plugins' order.
Standard settings and DirtyRank's custom settings save automatically shortly
after a control changes. Pending or invalid values remain visibly marked and
are protected by confirmation when the page is closed, refreshed, or left
through an in-app link. DirtyTidy deliberately keeps its explicit preview and
confirmation workflow because its strategy can move and rename files.
The direct URL is `/plugins/dirty-plugins`; it remains unlisted in Stash's
navigation.

## Debug logging

The hub installs a shared browser-side debug log used by every Dirty plugin.
Console lines are prefixed `[DirtyPlugins]`, and the full log is available at
`window.__dirtyPluginsDebugLog` and through `dirtyPluginsDumpDebugLogs()` (also
`DirtyPlugins.dumpDebugLogs()`). It records plugin lifecycle events, route and
patch registrations, every patch invocation on ordinary Stash pages, and shared
GraphQL requests. Set `window.__dirtyPluginsDebug = false` or
`localStorage.setItem("dirtyPluginsDebug", "0")` to silence the console; the
in-memory log keeps collecting. Stash's Troubleshooting mode disables all
plugin JavaScript, so no logs appear while it is active.

The hub's Python backend logs through Stash's plugin log protocol as
`[Plugin / DirtyPlugins]`, recording a `started`/`finished` pair (mode and
elapsed milliseconds) for every operation. Set **Settings → General → Log
level** to `Debug` and open **Settings → Logs** to read it.

## Screenshot

![Dirty Plugins shared settings hub showing DirtyRank configuration](../../docs/images/dirty-rank-settings.png)

The hub gives every installed Dirty plugin its own tab and consistent settings
layout. This capture shows DirtyRank's custom panel inside the shared page.

For a manual installation, copy this directory alongside the other Dirty
plugin directories and reload plugins in Stash.

## License

DirtyPlugins is distributed under the [MIT License](LICENSE).
