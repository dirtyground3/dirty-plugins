# Dirty Plugins — harmony implementation plan

This document plans the findings in [harmony.md](harmony.md). H01–H18 match the report one for one. DirtyRank established the approved visual reference; the other four plugins now consume more of the shared system. The detailed points below remain the checklist for deeper visual and compatibility review.

## DirtyRank pilot status

The initial pilot was limited to DirtyRank and shared DirtyPlugins primitives. Stash's native PerformerCard and ScenePlayer remain the preferred integrations; suite styling wraps them rather than replacing them. This table records that pilot scope; the rollout status follows.

| Point | DirtyRank pilot | Remaining rollout |
| --- | --- | --- |
| H01 | Shared graphite/teal/amber roles applied to Rank controls. | Resolve the hub/Stats default-theme disagreement; align the other plugins. |
| H02 | Added semantic hub tokens and mapped Rank accents/status. | Theme change signal, Stats chart roles, Tidy tokens, portal scopes, contrast review. |
| H03 | Added spacing, control, radius, and metric scales for Rank; adjacent Rank selects and buttons now share an explicit height. The hub settings, Stats dashboard, and Tidy automation select use the same size rule. | Verify zoom/density across themes and continue migrating other controls. |
| H04 | Added shared Button and extended IconButton for Rank actions. | DOM controls and remaining plugin actions; full variant/state fixture. |
| H05 | Rank settings use shared Field with linked errors and preserved invalid numeric edits. | Generic hub, Stats, and Tidy field migrations. |
| H06 | Rank navigation uses one named link and consistent SVG glyphs. | Multiscreen/Stats navigation and theme compatibility checks. |
| H07 | Rank uses shared page shell and header classes. | Other page layouts, panels, and toolbar composition. |
| H08 | Rank uses shared metric, badge, pagination, and table classes. | Tidy/Stats consumers and responsive visual checks. |
| H09 | No Rank dialog consumer. | FileExtractor and Stats dialog lifecycle work. |
| H10 | Rank footer uses shared SaveStatus; invalid edits supersede stale success. | Stats error path and other plugins' feedback; broader save orchestration review. |
| H11 | Shared focus and reduced-motion rules cover Rank's migrated controls. | Keyboard, narrow-width, zoom, and measured contrast checks across themes/plugins. |
| H12 | Shared native loader deduplicates Rank PerformerCard/ScenePlayer loads; native components remain in use. | Stats/Multiscreen adapters and live native/fallback review. |
| H13 | Documented existing runtime and Stats-only chart dependency. | Record vendor version/notices in the broader inventory. |
| H14 | No Rank chart consumer. | Stats-local chart adapter and lifecycle work. |
| H15 | Repaired Rank's dangling CSS selector and consolidated selected Rank rules. | Browser parsed-CSS review and later Stats/shared cleanup. |
| H16 | New JS follows the repository's no-build source style. | Other modules and duplicate-load review. |
| H17 | Rank recognizes both capture URLs and covers native media. | Safe visual review and capture coverage for the other plugins. |
| H18 | Added pilot component tests, documentation, and Rank/hub version bumps. | Visual fixtures, full cross-plugin contracts, and later release checks. |

## DirtyStats rollout status

The approved Rank pilot is the visual reference. The hub exports one `classic`/Midnight default; valid saved themes still win and unknown values fall back without rewriting storage. Stats now uses shared control geometry, fields, metrics, pagination, navigation, dialog focus/scroll helpers, native component loading, and visible save feedback. Chart semantic colours read effective CSS values; categorical palettes stay Stats-local. Native filters/cards remain Stash components, and capture mode hides card lists.

## Other plugin rollout status

| Plugin | Shared treatment now in place | Intentional boundary |
| --- | --- | --- |
| DirtyTidy | Shared fields, icon buttons, pagination, metric-style preview filters, status colours, and capture placeholders. | Its reviewed preview/confirm/run workflow stays explicit. |
| DirtyFileExtractor | Shared action styling; folder picker now traps/restores focus, locks background scroll, and masks paths in capture mode. | DOM integration and Stash's settings entry point remain local. |
| DirtyMultiscreen | One shared navigation link, deduplicated native player loading, keyboard-visible overlays, and opaque capture cover. | Edge-to-edge black playback and ScenePlayer remain native/specialized. |

The safe synthetic `tests/fixtures/dirty_suite_harmony.html` fixture covers the shared controls and plugin samples without private media. Automated behaviour and source checks are complete for this batch; live visual checks across Stash themes, 200% zoom, nested native filter popups, and chart interactions remain in the verification matrix below. The legacy literal-to-role chart adapter and Stats stylesheet specificity can be consolidated further after those checks.

## Delivery approach

Build outward from DirtyPlugins: agree the visual rules, extend small shared primitives, migrate actual consumers, then remove duplication. Each change should leave the suite usable with its native Stash integrations and existing settings. Keep component additions additive until their consumers have migrated.

| Stage | Work | Exit condition |
| --- | --- | --- |
| 0 — Establish evidence | Baseline fixtures from H18; syntax issue in H15; capture consistency in H17; document existing dependency exception in H13 | Safe reference views, validated CSS, explicit library ownership |
| 1 — Define the system | H01, H02, H03 | One default policy, semantic palette, geometry/type scales, and documented exceptions |
| 2 — Share the basics | H04, H05, H09, H10, H11 | Consistent controls, accessible dialogs, clear operation/save feedback |
| 3 — Align complete views | H06, H07, H08, H12, H14 | Matching navigation and page structure; native content and charts retain their behaviour |
| 4 — Consolidate and release | Finish H15 and H18; selective H16 | Removed duplication, current docs, passing checks, verified representative screens |

Fix the concrete notification mismatch in H10 independently if desired; it does not require waiting for the full design system. Establish accessibility requirements from H11 during stage 1, then verify them on every stage-2/3 primitive.

## Planned ownership

| Owner | Responsibilities |
| --- | --- |
| `plugins/DirtyPlugins/dirtyPlugins.css` | Semantic tokens, common control/panel/table styles, focus/motion rules, shared layers and capture utilities |
| `plugins/DirtyPlugins/dirtyPlugins.js` | Existing primitives plus narrowly scoped Field/Button/Dialog/feedback/navigation/pagination helpers; theme and capture interfaces; common native loading checks |
| Each plugin's JS/CSS | Domain data, interactions, layout constraints, native integration hooks, and genuine visual exceptions |
| DirtyStats | ECharts/map assets, chart lifecycle and presentation adapter, chart types, legends and categorical data palettes |
| `tests/` and runtime documentation | Behavioural contracts, synthetic fixture checks, integration scenarios, component recipes, and exceptions |

Keep no-build assets and PluginApi React. No new npm, Python, font, UI, chart, or icon dependency is proposed. Split shared source files only if it improves readability and their manifest load order remains explicit.

## Plans by finding

### H01 — One suite identity and one default-theme policy [P1]

**Owner:** DirtyPlugins; Stats default consumers. **Depends on:** baseline fixtures in H18.

1. Write a short visual specification using the report's graphite/teal/amber direction, including examples of a settings field, primary action, panel, metric, and selected tab.
2. Define one canonical default-theme key and default resolution path. Have hub settings and Stats page initialization/fallback use that source; remove the `classic` versus `arcade` disagreement.
3. Keep all saved Stats theme keys valid. Document what happens for an absent, invalid, or legacy value. Do not reset stored choices as a side effect of installing a style update.
4. Specify which rules are shared even under optional themes: control geometry, labels, states, focus, and icon sizing. Keep decorative treatments scoped.

**Done when:** With no saved settings, the hub selection and Stats page agree; each existing saved theme remains selectable and stable after reload. The same basic controls look related across all five visible plugins.

### H02 — Semantic colours and theme definitions need a single owner [P1]

**Owner:** Hub CSS/theme interface; all plugin styles; Stats theme adapter. **Depends on:** H01.

1. Add semantic tokens for accent/on-accent, warning, information, state foreground/background/border, hover, selected, focus, and elevation surfaces. Keep current public token names compatible during migration.
2. Make scoped CSS tokens authoritative for DOM colours. Expose a small theme-reading helper that reads effective values from a plugin root, including an explicit change signal for charts. Avoid inventing a second hardcoded JavaScript palette for those same roles.
3. Map Stats skins and Rank control/status colours to the common roles. Keep medals, rating precision distinctions, and categorical series colours named separately where they convey domain meaning.
4. Apply the resolved theme scope to portals and export contexts; replace Tidy's duplicated success/error literals with semantic tokens.

**Done when:** Changing a shared role updates its actual consumers, including chart chrome and dialog content. All supported backgrounds have measured text/control contrast; no semantic role requires editing both a CSS palette and a JavaScript hex-remapping table.

### H03 — Typography, spacing, shape, and density need a small common scale [P2]

**Owner:** Hub CSS, then all consumers. **Depends on:** H01–H02.

1. Define a small spacing scale such as `.25`, `.5`, `.75`, `1`, `1.5`, and `2rem`; define small/medium/pill radii and a limited shadow scale.
2. Define type roles for body, label, metadata, heading, and metric. Inherit the host font by default; reserve monospace for paths/templates and explicitly chosen expressive themes.
3. Add regular and compact control dimensions with aligned button/input/select heights. In mixed toolbars, give selects less internal padding and buttons more while keeping one explicit height. Use the same checkbox dimensions for generic settings and custom panels.
4. Migrate common geometry first. Retain local chart/media dimensions and documented information-density exceptions.

**Done when:** Equivalent controls align in mixed toolbars; labels/help text follow one hierarchy; settings, tables, and dashboards remain readable at increased text size and narrow widths.

### H04 — Buttons have shared classes but no complete shared contract [P1]

**Owner:** Hub Button/IconButton and CSS; every plugin. **Depends on:** H02–H03 and H11 requirements.

1. Add Button variants and density options; extend IconButton with size, tone, pressed state, busy state, and appropriate attribute/ref forwarding. Default actual buttons to `type="button"`.
2. Define identical CSS classes for DOM-created controls so FileExtractor can participate without a framework rewrite.
3. Migrate generic actions, Stats chart/list actions, Tidy hierarchy controls, and compact widget actions. Preserve native Stash controls behind their integration boundary.
4. Keep action callbacks, disabled rules, destructive confirmations, and route links semantically unchanged.

**Done when:** A fixture shows primary/secondary/quiet/danger controls in both sizes and all states. Keyboard focus, accessible names, disabled activation, and busy feedback work. Equivalent buttons no longer need local padding/height overrides.

### H05 — Field layout, help, and validation are independently implemented [P1]

**Owner:** Hub Field/Toggle and settings renderer; Rank, Tidy, Stats. **Depends on:** H02–H04.

1. Extract a Field wrapper with row/stacked/compact layouts and stable label/control/help/error IDs. Forward `aria-describedby`, `aria-invalid`, disabled, and required state where applicable.
2. Refactor the hub's generic SettingInput and Rank Field onto it, then migrate repeated Tidy fields and Stats dashboard SelectControl/CheckControl.
3. Reuse existing SettingsToggle with a compact option. Keep field-specific parsing and validation local; pass normalized validation output to the shared presentation.
4. Associate errors with the relevant control while retaining a panel-level summary where useful. Keep dirty/invalid values visible rather than silently clamping or discarding edits.

**Done when:** Clicking each label focuses/toggles its control; help and error text are associated programmatically; invalid values are identifiable without colour alone; Tidy templates and Rank category editing retain their current behaviour.

### H06 — Navigation and iconography need one visual and semantic pattern [P2]

**Owner:** Hub NavAction/Glyph; Rank, Multiscreen, Stats navigation. **Depends on:** H03–H04.

1. Inventory existing icons and choose a common optical box, baseline, weight, spacing, and active indicator. Retain distinct swords/trophy/grid/statistics meanings.
2. Use existing PluginApi icons where suitable and small authored SVG/CSS assets for suite-specific marks. Define a predictable monochrome fallback rather than relying on platform emoji rendering.
3. Render one route link or one action button, removing button-inside-NavLink composition. Put the accessible name on the interactive element and hide decorative glyphs from assistive technology.
4. Preserve Multiscreen counts/launch context and Rank visibility settings. Keep compatibility with themes that hide navbar spans.

**Done when:** Navigation has one keyboard stop per action, visible focus/active state, useful names, and aligned icons in default and customized Stash navigation. All original routes and count behaviours still work.

### H07 — Page shells, toolbars, and panel chrome can be shared [P2]

**Owner:** Hub layout primitives/CSS; settings, Rank, Stats. **Depends on:** H02–H04.

1. Add a minimal PageShell with settings/wide/dashboard widths and shared gutters, plus Panel, PageHeader, and Toolbar compositions only where multiple views benefit.
2. Give Panel a complete border/surface/radius contract rather than relying on accidental Bootstrap card composition. Retain the existing SettingsCard interface as a compatible consumer.
3. Migrate hub and Rank headers, then Stats toolbar/dashboard chrome. Keep native filter toolbars in their current functional integration and use a documented adapter around them.
4. Keep Rank's battle/sidebar layout, dashboard grid sizing, and Multiscreen's fullscreen media canvas local.

**Done when:** Shared headers, dividers, action alignment, and panel padding are consistent; wide visualizations retain usable space; native filters and menus remain operable; no new global Stash selectors are needed.

### H08 — Tables, pagination, badges, and metric tiles repeat common UI [P2]

**Owner:** Hub small data-display primitives; Rank, Tidy, Stats. **Depends on:** H02–H04 and H07.

1. Define table header/row/divider/density styling, numeric alignment, and a scroll-container utility. Preserve native table semantics and plugin-specific columns.
2. Add Pagination accepting page/count, an accessible context label, and optional details such as Rank's displayed rank range. Keep each plugin's own page-size/data policy.
3. Add Badge and Metric primitives with semantic tone and optional detail. Compose a button around a metric only when it is interactive, as in Tidy summary filters.
4. Migrate the three pagination implementations, common metric shells, and status badges before touching specialized podium/calendar layouts.

**Done when:** Pagination boundaries and filtering resets are unchanged; Rank ratings and Tidy paths remain legible; statuses include text; tables scroll within their containers instead of overflowing the page.

### H09 — Dialog appearance and lifecycle should be shared together [P1]

**Owner:** Hub Dialog plus DOM helper; FileExtractor and Stats. **Depends on:** H02–H04; native popup fixture from H18.

1. Consolidate initial focus, focus containment/restoration, Escape/backdrop dismissal, scroll locking, and cleanup. Support stacked dialogs and a no-focusable-content case.
2. Expose a React Dialog and a DOM lifecycle helper using the same rules. Migrate the folder picker and both Stats dialogs without changing their data operations.
3. Define named layer values after measuring Stash's native modal/dropdown behaviour. Support native filter dialogs portaled outside the shared dialog, including suspension of the outer focus trap and Escape handler when appropriate.
4. Preserve the opener, apply the right theme/capture scope to body portals, and use consistent header/close/footer composition.

**Done when:** Keyboard-only opening, tabbing, nested filters, dismissal, and focus return work in all three dialogs. Background scroll and layer ordering recover correctly after close, route change, and errors. Saving a folder or applying filters still behaves as before.

### H10 — Loading, errors, and save feedback need one visible language [P1]

**Owner:** Hub StateView/message/save-status presentation; all consumers. **Depends on:** H02–H05; the notification correction is independent.

1. Correct Stats' terminal save-error call to the existing `hub.ui.notify` API and add a focused failure-path check.
2. Extend StateView with inline/panel/fullscreen density and consistent action/announcement behaviour. Add a small InlineMessage/SaveStatus presentation rather than forcing every message into a large centered panel.
3. Standardize idle/pending/saving/saved/invalid/error wording and styling. Expose Stats' save state to its page/dashboard and make Rank footer errors visibly distinct. Provide a useful retry/recovery route where the operation supports one.
4. Share status presentation first. Extract autosave orchestration only with tests proving serialization, stale-response protection, revision handling, preservation of unrelated fields, and in-flight edits. Protect navigation while changes remain unsaved.
5. Keep Tidy's explicit save/preview/confirm/approval states and approved-plan logic; do not route them through ordinary autosave.

**Done when:** Failed writes visibly fail, successful writes visibly settle, and rapid edits cannot be overwritten by an older completion. Leaving with pending/invalid changes is handled consistently. Tidy still requires the appropriate reviewed plan before execution.

### H11 — Focus, motion, and responsive behaviour need shared guarantees [P1]

**Owner:** Hub interaction tokens/rules; plugin-specific interactive surfaces. **Depends on:** H02–H03; verify alongside H04–H09.

1. Define a visible focus ring and minimum target dimensions for normal/compact/touch contexts; use text/icon state in addition to colour. Do not suppress native outlines without a visible replacement.
2. Make Multiscreen overlay controls and title links reveal on keyboard focus. Check drag handles, variable chips, calendar cells, and selected summary buttons.
3. Introduce a shared reduced-motion signal for CSS and Stats chart options. Disable decorative movement/shimmer while preserving informative state changes.
4. Document shared breakpoints using explicit media-query values; ordinary CSS custom properties cannot directly replace media-query thresholds. Keep content-driven exceptions for dense charts and media layouts.
5. Review text contrast, 200% zoom, long labels, and narrow widths using real rendered components; increase very small metadata where necessary.

**Done when:** Every suite-owned action is usable and visibly focused by keyboard; reduced-motion mode removes decorative animation; ordinary page content does not overflow at 360px; tables/media use intentional containment. Contrast results are recorded for supported themes.

### H12 — Reuse native Stash components through small compatibility helpers [P2]

**Owner:** Hub native capability helper; Rank, Stats, Multiscreen. **Depends on:** H10; native fixture coverage in H18.

1. Catalogue actual component names/loadable names and required capabilities. Introduce a helper for availability checks and deduplicated loading only where callers share the same contract.
2. Keep React hooks inside components, and preserve each plugin's native data-query requirements. Return actionable missing-capability errors to the shared state presentation.
3. Migrate performer-card/player/filter loaders incrementally. Retain Rank's appropriate direct-video and custom-card fallbacks and Multiscreen's playback management.
4. Scope native compatibility CSS to plugin-owned wrappers. Do not consolidate voting, filter ownership, scene-boundary logic, or all player state into a generic shared component.

**Done when:** Loaded, lazily loaded, unavailable, and failed native components behave predictably. Voting does not swallow unrelated native-card actions; markers stop correctly; native filters and card theme customizations still work.

### H13 — Dependency policy and actual library use should agree [P2]

**Owner:** Repository/runtime documentation and Stats manifest/vendor ownership. **Depends on:** none.

1. Document a dependency inventory: PluginApi React/router/Bootstrap/icons/Intl; native Stash components/hooks; Stats-local ECharts and map data; standard-library Python backends.
2. Reconcile the written PluginApi-only rule with the already shipped ECharts exception. Record its purpose, version, licenses/notices, raw asset size, and sole consumer. Do not remove or upgrade it as a side effect of styling work.
3. Keep ECharts/map assets in Stats. Move only library-independent tokens and UI primitives to DirtyPlugins. Reconsider shared chart ownership only if another real consumer appears.
4. Keep manifest load order, offline bundled assets, shared GraphQL transport, and native GQL integrations explicit in the contributor guide.

**Done when:** Policy and manifests agree; installation needs no new dependency; non-Stats plugins do not acquire chart assets; packaging retains licenses/notices and excludes runtime data.

### H14 — Chart appearance and lifecycle can be consolidated within Stats [P2]

**Owner:** Stats-local chart adapter; hub theme interface. **Depends on:** H02, H03, H10, H11, H13.

1. Evolve the existing initializer into a Stats-local chart adapter for setup, resize, cleanup, error state, theme refresh, and export. Reuse the dashboard Chart component's lifecycle where suitable.
2. Replace literal-colour substitution with explicit presentation roles for axes, grids, tooltip, legend, selection, and series palettes. Preserve domain-specific colours and chart-specific option construction.
3. Reuse responsive font/spacing defaults for dashboard and full views, allowing compact variants. Pass reduced-motion preferences into chart options.
4. Preserve the existing export-background behaviour and verify that theme changes refresh existing charts and exports without losing user selections unnecessarily.

**Done when:** A chart in compact, full-view, and PNG form follows the same theme; resize/theme changes do not leak observers or chart instances; map selection, data zoom, calendar/constellation interactions, and filters remain correct.

### H15 — CSS structure needs cleanup before broad extraction [P1]

**Owner:** Rank CSS first; Stats CSS and shared CSS next. **Depends on:** none for the malformed fragment; H02–H14 for final cleanup.

1. Repair the dangling Rank selector at the reduced-motion block and check that the intended rule is present in the browser's parsed stylesheet. Record it as a focused correction separate from large migrations.
2. Reformat authored CSS into readable blocks and organize it by tokens, primitives, layout, native compatibility, responsive/motion, and capture rules. Exclude vendor assets from formatting.
3. Move rules into the hub only after their intended consumers are clear. Keep local aliases briefly where that makes migration reviewable.
4. Audit each Stats specificity override against the actual native theme/filter behaviour. Document retained exceptions; preserve FileExtractor's hidden-state rules.
5. Check native and fallback states before removing overlapping Rank selectors. Remove superseded rules after the replacement has been verified.

**Done when:** Stylesheets parse as intended, reduced-motion rules survive parsing, and no migrated control depends on accidental selector order. Necessary native overrides remain scoped and documented; both native and fallback cards still render correctly.

### H16 — Source conventions should make shared code easy to maintain [P3]

**Owner:** Shared runtime and touched plugin modules, particularly Multiscreen. **Depends on:** stable component APIs; avoid blocking earlier stages.

1. Use strict IIFEs, `var`, named functions, PluginApi React, and direct createElement calls for new shared code, following the repository convention.
2. Normalize only touched Multiscreen sections and remove demonstrably unused shim aliases after checking references. Keep no-build delivery and avoid reintroducing a generated bundle pipeline.
3. Document lifecycle categories: disposable DOM integrations versus non-unregisterable routes/patches. Preserve each tested duplicate-load strategy and clean up effect-owned listeners/observers.
4. Keep JavaScript style cleanup separate from behaviour changes. Do not mistake var/function style for complete legacy-browser support or launch a suite-wide transpilation effort.

**Done when:** Touched code follows one style, syntax checks pass, repeated bundle loads do not add navigation items/observers/timers, and existing media/registration tests still pass.

### H17 — Documentation capture should be one reliable suite feature [P1]

**Owner:** Hub capture helper/CSS; every media/path surface. **Depends on:** none; complete before making review captures with real data.

1. Add one capture-mode detector accepting `docsCapture=1` and the legacy Rank `censorMedia=1` alias. Use the same result in page roots, dialogs, and body portals.
2. Cover FileExtractor's folder picker path/list text, Tidy preview source/destination paths, Stats main native performer/scene cards, and all Rank/Multiscreen media surfaces. Prefer safe placeholders or opaque covers for fixtures and native components with changing internals.
3. Preserve query-state propagation when navigating between capture views. Cover loading/error/empty states and dynamically inserted images/video frames, not only the first render.
4. Maintain an explicit safe-fixture/capture checklist. Inspect every image before saving it into the repository; retain no uncensored captures in repository history.

**Done when:** One capture URL produces safe review views across the suite, including overlays and native cards. Private paths and every potentially explicit media region are hidden/obscured in the actual saved artifact. The old Rank capture URL continues to work.

### H18 — Contracts and documentation should prevent style drift [P1]

**Owner:** `tests/`, DirtyPlugins README/design guide, root and plugin READMEs. **Depends on:** start now; finish with each migration.

1. Extend the existing shared contract without weakening its requirements. Cover all consumers of shared transport/primitives and explicitly represent legitimate native GQL hooks and vendor exceptions.
2. Add focused behaviour checks for theme/default agreement, button semantics, field associations, dialog focus/nesting, notification failure, save ordering, and capture coverage. Use existing test infrastructure and a small synthetic browser fixture page; no new UI framework or build step.
3. Establish representative screenshots with synthetic or fully obscured content. Compare default/shared theme and supported expressive/light variants; include keyboard focus and reduced-motion checks.
4. Document the token catalog, component recipes, data-vs-status colour distinction, native integration rules, layer policy, theme migration, and allowed exceptions. Refresh the root README version table and include the Stats dashboard test in suite instructions.
5. For implementation releases, bump affected plugin manifests and the hub when its public behaviour changes. Verify packaged asset order, test old-consumer compatibility where supported, and document required coordinated updates.

**Done when:** Shared API changes have relevant behavioural checks and safe visual evidence; a contributor can choose the correct primitive from the guide; docs match manifests; existing domain tests remain intact.

## Verification matrix for implementation

| Surface | Representative checks |
| --- | --- |
| Hub settings | Each plugin tab; generic and custom panels; dirty/invalid/saving/error states; leaving with pending edits |
| FileExtractor | Selected-item action; empty/loading/error folder picker; keyboard loop/return; capture-mode private paths |
| Multiscreen | Loading/error/empty grid; overlay keyboard focus; fullscreen/narrow window; markers, counts, native playback and capture |
| Rank | Battle/Gauntlet, leaderboard table/gallery/podium, native and fallback cards, settings errors, keyboard voting and reduced motion |
| Stats | Dashboard edit/reorder, both filter dialogs and nested native popups, representative map/line/scatter/treemap/calendar, native cards, theme change and PNG export |
| Tidy | Template fields, summary filters, wide paths/table scrolling, invalid strategy, preview/confirm/save/execute states, capture |
| Shared environment | 360px, 768px, 1440px widths; 200% zoom; default Stash plus a supported customized theme; keyboard-only and reduced motion |

Run checks appropriate to each implementation change, then the repository's Python suite and all listed Node suites before release, including `test_dirty_stats_dashboard.js`. Syntax-check every changed JavaScript asset and verify parsed CSS in a browser. Preserve specialized media, ranking, storage, and automation tests; visual work must not weaken those contracts.

Release in small reviewable batches: shared primitive plus its first consumers, remaining consumers, then deletion of superseded code. Do not include generated `_site/`, runtime SQLite files, bytecode, or private media. The DirtyRank pilot is the first implementation batch; later plugin migrations and publishing remain separate.
