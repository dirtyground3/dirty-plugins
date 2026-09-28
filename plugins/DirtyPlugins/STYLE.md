# Dirty Plugins UI guide

The default suite style uses graphite surfaces, teal for primary actions and
selection, and warm amber for destructive actions. The shape is rounded and
slightly playful; labels, focus, control height, and status meaning remain
consistent in all seven suite themes. Inherit Stash's font by default. Keep Rank
medals, rating precision, and Stats data series as domain colours rather than
reusing save/error colours.

## Use the shared pieces

| Need | Use | Keep local |
| --- | --- | --- |
| Suite action | `DirtyPlugins.react.Button` or `.dirty-ui-button` on a DOM button | What the action does and whether it needs confirmation |
| Icon action | `IconButton` with an accessible label | The plugin-specific glyph |
| Labelled setting | `Field` and a native input/select/textarea | Parsing, validation, and the user's uncommitted value |
| Boolean setting | `SettingsToggle` | The setting key and help text |
| Page state | `StateView`, `SaveStatus`, `ui.notify` | Retry operation and data loading |
| Data summary | `Metric`, `Badge`, `Pagination`, `.dirty-ui-table` | Page size, columns, and domain meaning |
| Route action | `NavAction` | Route and icon meaning |
| Browser page title | `react.usePageTitle(pluginName, viewTitle)` | Plugin name and current view label |
| Statistic navigation | `StatisticSelector` | Available statistics and their routes |
| Secondary row actions | `ActionMenu` (⋮ overflow menu) | Which actions are rare enough to hide |
| Modal | `react.Dialog` or `ui.manageDialog` for DOM-created content | Dialog body and data operation |

Call `DirtyPlugins.react.usePageTitle("Plugin", "View")` in each route component.
The hub formats the title as `View - Plugin`, keeps native list loading from
replacing it, and releases it when the route unmounts. Pass the current view
label so titles also update when navigating within a plugin. Omit the view
label for a page titled with just the plugin name.

`Button` defaults to `type="button"`. A normal control is 2.5rem high; a
compact action is 2rem. Use `.dirty-ui-control-row` for mixed buttons and
selects. Shared selects have less internal padding than buttons, while their
outside height matches. Text and number fields use the same control height.
Use native Stash buttons inside native Stash components rather than replacing
their internals.

`Field` owns the label/control/help/error relationship. Give it a stable ID,
pass visible error text, and retain an invalid number or path until the user
edits it. `SaveStatus` distinguishes pending, saving, saved, invalid, and error
states. Ordinary settings autosave after a short delay; DirtyTidy's file-moving
workflow still requires preview, confirmation, and an approved plan.

## Tokens and themes

Use `--dirty-ui-accent`, `--dirty-ui-emphasis`, `--dirty-ui-text`,
`--dirty-ui-muted`, `--dirty-ui-border`, `--dirty-ui-surface-raised`,
`--dirty-ui-focus`, `--dirty-ui-success`, `--dirty-ui-warning`, and
`--dirty-ui-danger` for common roles. The CSS file also defines `--dirty-ui-space-*`,
radius, shadow, and control-height tokens. Read effective CSS values with
`DirtyPlugins.theme.readRole(root, property)` when JavaScript must draw chart
chrome; do not inspect `CSSStyleSheet.cssRules`, which can throw for a Stash
theme stylesheet from another origin. Stats' category palettes and ECharts
options stay in Stats. Chart presentation reads CSS roles when options are
built; literal white and black remain available for data outlines and labels.
The General settings tab stores `visualTheme` for all suite-owned surfaces.
`DirtyPlugins.theme.defaultKey` is `classic` (Midnight). When no suite theme is
saved, a valid legacy DirtyStats theme applies to the suite; unknown values
display Midnight without rewriting storage. `theme.currentKey` and
`theme.subscribe` let chart adapters react to a change. The selected class sits
on the document root, including portals; native Stash cards and players keep
their host theme.

The hub uses a few `#root`-scoped `!important` declarations for suite-owned
buttons, fields, and settings tabs. They counter later Stash theme rules so
Paper Picnic remains readable and expressive theme shapes remain consistent;
they do not target native cards or players.

The authored Stats base, panel, and alternate-panel surfaces keep body, muted,
primary, and accent-text roles at or above 4.5:1 contrast in all seven themes;
`tests/test_dirty_stats_contrast.js` measures those pairs. Paper Picnic uses a
darker amber only for calendar count text, leaving its decorative amber intact.
Other chart colours and translucent overlays still need rendered review.
Tag DNA cells choose light or dark labels from each cell's fill colour; the
shared Stats contrast test covers the gradient endpoints in every theme.

**De Stijl** (`destijl`) uses the supplied reference palette: coral `#dc5e5f`,
blue `#5b9acf`, grey `#dcdcdc`, and charcoal `#282828`. Square corners, solid
offset shadows, dark construction lines, and small asymmetric colour accents define
the theme. Page headers omit decorative strips to keep their height compact.
Main statistic/category selectors use solid blue fills, bold uppercase labels,
a narrow coral edge, and a modest offset shadow. Small text uses darker blue/red ink variants for contrast; coral
button labels use near-black. Navigation artwork shares the reference palette
in every theme. Keep those colours in the hub's `--dirty-ui-icon-*` tokens;
there is no yellow in this palette.

**De Stijl Dark** (`destijl-dark`) shares the same geometry and artwork, with
charcoal surfaces and grey text. Its lighter blue and coral ink variants keep
text readable; filled blue controls retain charcoal labels in both variants.
Keep shared geometry in the combined De Stijl selectors and differences in
the palette tokens, including the select arrow and solid shadow.

## Dialogs and native content

`react.Dialog` renders in `document.body`; give it an accessible label or
labelled-by heading. `ui.manageDialog` applies the same initial focus, Tab
loop, Escape handling, stacked scroll lock, and focus return to DOM-created
dialogs such as FileExtractor's folder picker. Both APIs accept
`allowNativePopup` when Stash filters open a nested modal outside the dialog.
Use `.dirty-ui-native-filter-overlay` and `.dirty-ui-native-filter-dialog`
when showing Stash's native filter toolbar in a suite dialog; these keep the
filter controls while hiding the host's separate results and pagination.
The integrated Stats dialogs use the `--dirty-ui-layer-integrated-dialog`
levels (1030/1040) so native popups can rise above them. The standalone picker
uses `--dirty-ui-layer-standalone-dialog` (12000); toast messages use 12050.
Do not assign the standalone layer to a dialog that contains native filters.

Use `DirtyPlugins.native.loadComponent` or `ensureComponents` for the Stash
PerformerCard, ScenePlayer, and filter modules. These helpers deduplicate
loading; they do not replace the native component or its theme. Keep voting,
playback, and filter ownership in the plugin. Limit native compatibility CSS
to a plugin-owned wrapper; retain fallbacks where the native component may be
unavailable.

Stats keeps narrowly scoped `!important` overrides around Stash's generated
filter toolbar, dropdowns, native card memorial border, and its Paper/Arcade
theme buttons. These override host or generated component rules that are not
under the suite's markup control. The visually hidden helper also uses one
`!important` to resist host display styles. Do not move these selectors into
global hub CSS. FileExtractor's action `[hidden]` rules likewise override
fixed-position display styling and must remain in its own stylesheet.
Stats' native filter toolbar also removes Stash's 42px maximum height and
clipped overflow so its wrapped controls and dropdown remain visible at 360px.
Rank keeps separate native-card and fallback-card selectors: the native card
retains Stash's layout and theme, while the fallback needs suite-owned card
layout when Stash's component is unavailable. Capture rules cover both paths.

## Capture and review

`?docsCapture=1` is the suite capture mode, and Rank still accepts
`?censorMedia=1`. Use `captureEnabled` and `captureUrl` for detection and
navigation. Capture stays active during Stash's in-page filter URL rewrites;
`?docsCapture=0` turns it off, and a full reload without the flag starts a
normal page. Replace or cover every performer image, video, canvas, and private
path with an opaque placeholder, including content inside body portals and
content added after initial render. The synthetic fixtures in `tests/fixtures/`
are safe to inspect without Stash data. Check every real screenshot before
committing it; no uncensored adult media belongs in this repository.

Check keyboard focus, Escape/Tab in dialogs and nested native popups, reduced
motion, 360px width, and all suite themes.
Run the Python contract suite and the affected Node tests. The shared source
is plain PluginApi React and CSS served directly by Stash, with no build step.
For markup-style rendering, use `DirtyPlugins.react.html` (HTM bound to
`React.createElement`) rather than loading another copy in a plugin.
Keep a plugin's one-time route and PluginApi patch registrations behind its
`INSTANCE_KEY` guard: Stash cannot unregister those integrations when it
reloads an asset. Component effects are different; disconnect their observers
and remove their listeners or timers when the component unmounts. The
Multiscreen bundle uses this split so a repeated asset load does not stack
navigation links or patches, while player and visibility effects still clean
up with their tiles.

## Dependency inventory

PluginApi supplies React, ReactDOM, router, Bootstrap components, icons, and
Stash component loaders. Stash supplies native cards, filters, player, and
their internal GQL hooks; suite-owned data requests use the hub GraphQL client.
Python backends use the standard library. DirtyStats alone bundles Apache
ECharts 5.6.0 (`vendor/echarts.min.js`, 1,034,102 bytes) and Natural Earth map
data (`vendor/world.js`, 244,998 bytes). Their license and notice files live
beside those assets. The Stats manifest loads ECharts and the map before its
own chart code. No other plugin should acquire these assets simply to share a
control or colour token.

The shared hub bundles HTM 3.1.1 (`vendor/htm.umd.js`, Apache-2.0) so suite
plugins can write React templates without a build step. Its license and source
notice live beside the browser asset.
