# Dirty Plugins — style harmony report

Review date: 2026-09-23. Source baseline: `6cde073`.

This is an analysis only. No plugin code, settings, installed files, or manifests were changed. Each finding H01–H18 has a corresponding implementation plan in [harmony-plan.md](harmony-plan.md).

## Main conclusion

The suite has a solid shared runtime, but only part of a shared design system. Settings look related; complete plugin pages and some controls have evolved independently. The best opportunity is to extend **DirtyPlugins** into the owner of common visual rules and small UI primitives, while retaining each plugin's specialized content and interactions.

The greatest visual divergence is in **DirtyStats** and **DirtyRank**. Stats has five complete local themes, including its own font, geometry, surfaces, controls, and chart colours. Rank combines shared surfaces with an extensive amber-led visual vocabulary. FileExtractor is already a good example of keeping most colours and surfaces in the hub.

Three concrete inconsistencies deserve early attention: the hub and Stats disagree on the default theme; a Stats save-error notification calls an unexported hub method; and Rank contains a malformed CSS fragment before a reduced-motion rule. Documentation capture also has inconsistent activation and coverage.

## Scope and evidence

- Reviewed UI code across all six plugin directories, including both Stats scripts; all six stylesheets and manifests; shared runtime exports; plugin documentation; and relevant contract and JavaScript test coverage.
- Inspected frontend dependency use and Python imports. This is a style, UI consistency, and code-sharing audit, not a full backend correctness audit or third-party-library security review.
- Findings describe checked-in source. No live browser rendering, contrast measurement, screen-reader session, or installation was performed. Visual effects that depend on Stash or an installed theme require the checks in the plan.
- Ran `python -B -m unittest discover -s tests -p test_shared_ui_contract.py -v`: **40 tests passed**. These mostly check source contracts; passing them does not establish visual consistency or complete accessibility.
- Priorities: **P1** = foundation or concrete inconsistency to address early; **P2** = follow-on harmonization; **P3** = maintenance work after the visual foundation.

## Current position by plugin

| Plugin | Manifest version | Existing shared foundation | Main opportunity |
| --- | --- | --- | --- |
| DirtyPlugins | 0.4.4 | Tokens, settings cards/sections/toggles, icons, state views, notifications, settings persistence | Complete the visual and component contract; publish usage rules |
| DirtyFileExtractor | 0.4.2 | Hub-rendered settings, shared button/dialog classes, shared notifications | Reuse a complete dialog lifecycle and capture protection |
| DirtyMultiscreen | 0.4.3 | Hub-rendered settings, shared IconButton/StateView, Stash ScenePlayer | Normalize navigation, focus behaviour, and source conventions |
| DirtyRank | 0.7.12 | Shared settings primitives and StateView; native performer cards/player where supported | Reduce local control, typography, badge, and surface variations |
| DirtyStats | 0.6.12 | Hub settings, shared StateView, native filters/cards, shared settings store | Unify theme definitions, controls, dialogs, chart presentation, and save feedback |
| DirtyTidy | 0.3.6 | Shared settings card/section/toggle and notifications | Share fields, status badges, summary tiles, and pagination; preserve reviewed execution |

The CSS inventory supports that prioritization:

| Stylesheet | Size, bytes | Distinct literal colour expressions | `!important` uses |
| --- | ---: | ---: | ---: |
| DirtyPlugins | 7,298 | 17 | 0 |
| FileExtractor | 1,822 | 0 | 2 |
| Multiscreen | 2,720 | 5 | 0 |
| Rank | 39,741 | 76 | 0 |
| Stats | 28,499 | 82 | 44 |
| Tidy | 4,421 | 13 | 0 |

Counts are a source inventory, not a quality score. Colour expressions count distinct hex and `rgb`/`rgba` expressions, including token definitions, gradients, and intentional data colours. Stats' five themes explain much of its count. FileExtractor's two important declarations enforce `[hidden]`.

## Recommended recognizable style

Use a consistent **graphite surface, teal action, warm amber emphasis** direction, drawing on colours already present in Stats' Midnight theme and Rank. These are proposed design choices, not claims about the current suite or measured contrast results.

| Element | Proposed common rule |
| --- | --- |
| Surfaces | Graphite base near `#242b31`, raised panels near `#2c343b`, quiet borders; adapt through semantic tokens to supported themes |
| Primary action | Teal, based on `#54d5ca` in the dark palette; one clear primary action per action group |
| Emphasis | Warm amber near `#f3c779` for scores and highlights; keep warning meaning explicit through text/icon as well as colour |
| Shape | Consistent small/medium radii for controls and panels; pills for badges, circles for media overlays; restrained shadow levels |
| Typography | Inherit Stash's body font with a system fallback; one heading hierarchy; tabular numerals for metrics; monospace for paths and templates |
| Spacing | A short rem-based scale, with compact and regular control densities |
| Navigation | Matching icon size, alignment, active indicator, and accessible labels; retain a meaningful icon for each plugin |
| Signature | Repeat the same panel edge, selected-state treatment, and control geometry across pages. Use the existing grid motif as inspiration for a suite mark, without turning every plugin icon into the same glyph |

Keep saved Stats theme choices. Optional expressive themes can remain, but their buttons, spacing, states, and component behaviour should follow the same contract. A default-theme change must explicitly handle existing settings rather than silently replacing them.

## Findings

### H01 — One suite identity and one default-theme policy [P1]

- **Observed:** The hub defaults `dirtyStats.visualTheme` to `classic`, while Stats initializes and falls back to `arcade`. With no saved value, the settings control and Stats page can describe different defaults. Rank defines amber/cyan accents; other plugins mostly inherit Bootstrap and hub colours. Stats Arcade also changes the font and shadow style.
- **Impact:** The same suite presents different starting identities, and the theme control can misrepresent the initial appearance.
- **Direction:** Establish the proposed common baseline, one canonical default, and an explicit rule for optional plugin themes. Preserve saved choices and purpose-specific visualizations.
- **Evidence:** [hub defaults and options](plugins/DirtyPlugins/dirtyPlugins.js#L52), [Stats defaults and theme registry](plugins/DirtyStats/dirtyStats.js#L66), [Rank accents](plugins/DirtyRank/dirtyRank.css#L1), [Stats theme geometry and font](plugins/DirtyStats/dirtyStats.css#L1).

### H02 — Semantic colours and theme definitions need a single owner [P1]

- **Observed:** The hub supplies text, muted, surface, border, success, and danger tokens, but no common accent, warning, information, hover, selected, or focus palette. Stats defines `--dirty-ui-accent` locally. Stats repeats theme values in JavaScript and CSS and remaps old chart colours by literal value. Tidy repeats the hub's success/error backgrounds as literals; Rank has several local status palettes.
- **Impact:** Updating a colour requires changes in multiple places, and the same meaning can have different colours or contrast.
- **Direction:** Complete the `--dirty-ui-*` semantic palette, with foreground/background/border variants for states. Keep categorical chart colours and Rank medal colours separate from action/status meaning. Resolve chart colours from the same effective theme as the DOM.
- **Evidence:** [hub tokens and tone rules](plugins/DirtyPlugins/dirtyPlugins.css#L1), [Stats JavaScript themes](plugins/DirtyStats/dirtyStats.js#L90), [Stats CSS themes](plugins/DirtyStats/dirtyStats.css#L1), [Tidy status colours](plugins/DirtyTidy/dirtyTidy.css#L182).

### H03 — Typography, spacing, shape, and density need a small common scale [P2]

- **Observed:** Shared primitives sometimes force `system-ui`, while most controls inherit the host font and Stats Arcade uses monospace. Rank has many local type sizes and radius multipliers; Stats themes vary panel radius from `.2rem` to `1rem`. Checkbox sizes differ even between the hub's generic setting input and its shared toggle.
- **Impact:** Related controls and panels have visibly different proportions, even when they share a colour token.
- **Direction:** Define body/label/meta/heading/metric roles, a spacing scale, named radii, and compact/regular sizes. Keep deliberate media dimensions and dense chart labels outside the generic scale where needed.
- **Evidence:** [shared typography and toggles](plugins/DirtyPlugins/dirtyPlugins.css#L61), [generic checkbox size](plugins/DirtyPlugins/dirtyPlugins.css#L326), [Rank fields](plugins/DirtyRank/dirtyRank.css#L1487), [Stats theme radii](plugins/DirtyStats/dirtyStats.css#L1).

### H04 — Buttons have shared classes but no complete shared contract [P1]

- **Observed:** `.dirty-ui-button` mainly aligns content and sets a radius/transition. The suite also uses bare Bootstrap buttons, Bootstrap React `Button`, local icon actions, and the shared `IconButton`. Stats rating actions and pagination omit the shared button class; Tidy writes icon-button markup directly. Stats' compact action links duplicate control dimensions.
- **Impact:** Height, padding, icon spacing, focus, busy state, and disabled appearance vary by screen.
- **Direction:** Add a small shared button contract with primary/secondary/quiet/danger variants and regular/compact sizes. Extend the existing IconButton, and provide matching CSS for FileExtractor's DOM-created controls. Links must remain links.
- **Evidence:** [shared button CSS](plugins/DirtyPlugins/dirtyPlugins.css#L16), [IconButton](plugins/DirtyPlugins/dirtyPlugins.js#L534), [Stats rating controls](plugins/DirtyStats/dirtyStats.js#L1574), [Tidy hierarchy actions](plugins/DirtyTidy/dirtyTidy.js#L701), [dashboard widget actions](plugins/DirtyStats/dirtyStatsDashboard.js#L514).

### H05 — Field layout, help, and validation are independently implemented [P1]

- **Observed:** The hub has private `SettingInput`; Rank has `Field`; Tidy builds field markup inline; Stats has `SelectControl` and `CheckControl`. Label weights, help spacing, control sizes, and layout differ. Existing field wrappers do not establish a shared help/error association or invalid-state API.
- **Impact:** A setting does not have a consistent reading order or error presentation across plugins. New settings need bespoke markup.
- **Direction:** Share `Field`, input/select styling, and Toggle density. Support row and stacked layouts, linked labels/help/errors, visible invalid state, and disabled state. Plugin-specific validation and Tidy's strategy semantics stay local.
- **Evidence:** [SettingInput](plugins/DirtyPlugins/dirtyPlugins.js#L844), [Rank Field](plugins/DirtyRank/dirtyRank.js#L2688), [Tidy fields](plugins/DirtyTidy/dirtyTidy.js#L724), [Stats controls](plugins/DirtyStats/dirtyStatsDashboard.js#L410).

### H06 — Navigation and iconography need one visual and semantic pattern [P2]

- **Observed:** Rank uses Unicode swords/trophy, Multiscreen builds a four-cell CSS icon, Stats renders a multicolour SVG, and the hub Glyph supports FontAwesome. Their sizing and button wrappers differ. All three route-navigation implementations nest a button inside a NavLink.
- **Impact:** Icons vary by platform and plugin; nested interactive elements complicate keyboard behaviour and accessible naming.
- **Direction:** Use one `NavAction` pattern with a single interactive element, common active/focus treatment, consistent icon box, and preserved plugin glyphs/counts. Use existing PluginApi FontAwesome assets or small authored SVG/CSS assets; no additional icon package.
- **Evidence:** [Glyph](plugins/DirtyPlugins/dirtyPlugins.js#L527), [Rank navigation](plugins/DirtyRank/dirtyRank.js#L3115), [Multiscreen navigation](plugins/DirtyMultiscreen/multiscreen.js#L1335), [Stats navigation](plugins/DirtyStats/dirtyStats.js#L2263).

### H07 — Page shells, toolbars, and panel chrome can be shared [P2]

- **Observed:** Hub pages use a 72rem shell, Rank uses 92rem/100rem, and Stats uses 1600px/1800px. Headers, dividers, action groups, card padding, and panel backgrounds are implemented separately. `.dirty-ui-panel` sets border colour but depends on other classes for border width/style; its appearance therefore depends on composition.
- **Impact:** Pages lack a common structural rhythm, and using a shared class alone does not guarantee the same panel.
- **Direction:** Share shell, header, toolbar, and panel chrome with settings/wide/dashboard variants. Standardize the frame around content, not all content widths. Multiscreen must retain its immersive edge-to-edge black canvas.
- **Evidence:** [hub shell/panel](plugins/DirtyPlugins/dirtyPlugins.css#L26), [hub page](plugins/DirtyPlugins/dirtyPlugins.css#L193), [Rank shell](plugins/DirtyRank/dirtyRank.css#L1), [Stats page](plugins/DirtyStats/dirtyStats.css#L60), [Stats dashboard](plugins/DirtyStats/dirtyStats.css#L157).

### H08 — Tables, pagination, badges, and metric tiles repeat common UI [P2]

- **Observed:** Rank has leaderboard tables, metric cards, precision badges, and pagination. Tidy has a Bootstrap preview table, clickable summary tiles, status badges, and separate pagination. Stats repeats Previous/Page/Next in performer and scene lists and has its own metric tiles.
- **Impact:** Repeated reading and navigation patterns differ in spacing, labels, numeric alignment, and status treatment.
- **Direction:** Share lightweight table styling, Pagination, Badge, and Metric primitives. Let pagination accept a context label and optional detail. Keep schemas, page sizes, clickable Tidy summaries, and precision/medal semantics local; avoid a general-purpose data-grid framework.
- **Evidence:** [Rank pagination](plugins/DirtyRank/dirtyRank.js#L1703), [Rank tables and badges](plugins/DirtyRank/dirtyRank.css#L1162), [Tidy preview table](plugins/DirtyTidy/dirtyTidy.js#L375), [Stats card lists](plugins/DirtyStats/dirtyStats.js#L755), [Stats metrics](plugins/DirtyStats/dirtyStatsDashboard.js#L220).

### H09 — Dialog appearance and lifecycle should be shared together [P1]

- **Observed:** FileExtractor uses shared dialog/backdrop CSS but manually creates the DOM. It closes on Escape/backdrop click without explicit initial focus, trapping, or focus restoration. Both Stats dialogs implement focus handling locally; the dashboard dialog also locks body scroll. Layer values range from 1030/1040 in Stats to 12000 in the hub; Stats hosts native filter popups inside its dialogs.
- **Impact:** Similar dialogs differ in navigation, scrolling, dismissal, and stacking. Simply applying the hub's high z-index to native filter dialogs could put native child popups behind them.
- **Direction:** Provide a shared Dialog component plus a reusable DOM lifecycle helper, a layer policy that accommodates Stash modals/portals, and theme propagation to body portals. Preserve appropriate dismissal rules for nested dialogs.
- **Evidence:** [folder picker lifecycle](plugins/DirtyFileExtractor/extractScenes.js#L341), [shared modal layers](plugins/DirtyPlugins/dirtyPlugins.css#L131), [Stats performer dialog](plugins/DirtyStats/dirtyStats.js#L581), [Stats dashboard dialog](plugins/DirtyStats/dirtyStatsDashboard.js#L484).

### H10 — Loading, errors, and save feedback need one visible language [P1]

- **Observed:** StateView and notifications already exist, but Stats has two wrappers/fallbacks, chart errors can be plain paragraphs, and settings status is rendered separately in each panel. Rank's footer displays errors as the same muted status text. Stats display settings serialize/debounce writes but expose no equivalent persistent save-status UI; the terminal error branch checks `hub.notify`, while the runtime exports `hub.ui.notify`.
- **Impact:** Users cannot reliably infer whether an operation is pending, saved, invalid, or failed. Stats' intended terminal save-error toast is skipped with the current hub.
- **Direction:** Extend StateView with inline/panel/fullscreen density, add a shared inline message and save-status presentation, and reuse the exported notification API. Standardize useful recovery actions. Preserve serialized writes, revision checks, and Tidy's explicit review/confirm workflow.
- **Evidence:** [hub notifications and exports](plugins/DirtyPlugins/dirtyPlugins.js#L508), [Stats save path](plugins/DirtyStats/dirtyStats.js#L212), [Stats state wrapper](plugins/DirtyStats/dirtyStats.js#L307), [Rank status footer](plugins/DirtyRank/dirtyRank.js#L2933), [Tidy messages](plugins/DirtyTidy/dirtyTidy.js#L794).

### H11 — Focus, motion, and responsive behaviour need shared guarantees [P1]

- **Observed:** There is no suite-level focus-ring rule for the shared icon button. Multiscreen raises overlay-button opacity on hover, but has no matching local focus-visible opacity rule. Rank supplies reduced-motion rules for some animations; shared transitions and Stats charts have no common reduced-motion policy. Breakpoints mix rem and pixel conventions. Stats includes very small calendar/metadata text.
- **Impact:** Keyboard visibility and compact-screen readability depend on the particular component and host theme. Current source does not establish a consistent accessibility baseline.
- **Direction:** Share focus, hit-area, disabled, and motion tokens; make hidden overlay controls reveal on keyboard focus; define a small set of layout breakpoints and explicit dense-widget exceptions. Measure actual contrast and zoom behaviour before calling any palette accessible.
- **Evidence:** [IconButton CSS](plugins/DirtyPlugins/dirtyPlugins.css#L74), [Multiscreen overlays](plugins/DirtyMultiscreen/multiscreen.css#L67), [Rank motion rules](plugins/DirtyRank/dirtyRank.css#L529), [Stats calendar and responsive rules](plugins/DirtyStats/dirtyStats.css#L136).

### H12 — Reuse native Stash components through small compatibility helpers [P2]

- **Observed:** Rank already uses native performer cards and loads ScenePlayer when needed. Stats uses native filters/cards; Multiscreen uses native ScenePlayer. Capability checks and lazy-loading code are repeated. Rank intentionally keeps direct video playback and card fallbacks for applicable cases.
- **Impact:** Stash compatibility handling can drift, even though native components already give the suite useful theme and interaction consistency.
- **Direction:** Share capability detection/loading/error conventions where APIs are the same. Keep filters, voting, playback boundaries, and native-card interactions under the owning plugin. Treat host-generated cards as an integration boundary rather than restyling their internal controls globally.
- **Evidence:** [Rank native loaders](plugins/DirtyRank/dirtyRank.js#L347), [Multiscreen native player](plugins/DirtyMultiscreen/multiscreen.js#L762), [Stats native route initialization](plugins/DirtyStats/dirtyStats.js#L2217), [dashboard native filters](plugins/DirtyStats/dirtyStatsDashboard.js#L450).

### H13 — Dependency policy and actual library use should agree [P2]

- **Observed:** React/router and selected Bootstrap/FontAwesome/Intl facilities come from PluginApi. Stats additionally bundles ECharts 5.6.0 and Natural Earth map data, documented with licenses. ECharts is about 1.03 MB and the map about 245 KB of raw source. This is an existing exception to AGENTS.md's PluginApi-only library rule. No second chart engine or external font dependency was found; Python imports are standard-library based.
- **Impact:** The written policy does not explain the main existing library exception, and moving everything into the hub would make unrelated plugins carry chart assets unnecessarily.
- **Direction:** Document the current exception and ownership explicitly. Keep charts/map data in Stats while Stats is their sole consumer. Use PluginApi facilities for ordinary controls and avoid another UI, icon, or chart framework. Keep custom GraphQL transport in the hub; native Stash GQL hooks remain an intentional native-component integration.
- **Evidence:** [Stats manifest load order](plugins/DirtyStats/dirtyStats.yml#L17), [bundled dependency notes](plugins/DirtyStats/README.md#L283), [hub GraphQL](plugins/DirtyPlugins/dirtyPlugins.js#L396), [Multiscreen library access](plugins/DirtyMultiscreen/multiscreen.js#L97), [repository dependency policy](AGENTS.md).

### H14 — Chart appearance and lifecycle can be consolidated within Stats [P2]

- **Observed:** Stats already has `initStatsChart` and `themedChartOption`, and its export wrapper resolves the effective theme background. Full pages still repeat chart setup and style options; the dashboard has a separate Chart component and axes helper. Theme conversion relies on matching literal legacy colours, which ties semantic meaning to a hex value.
- **Impact:** A newly introduced colour can escape the remapping, and axis, tooltip, loading, sizing, and cleanup conventions can drift between dashboard and full view.
- **Direction:** Consolidate chart lifecycle and named presentation roles inside Stats, consuming hub theme tokens. Reuse axis/tooltip/legend/export defaults and responsive text rules while retaining each chart's data, selection logic, and specialized geometry. Do not put ECharts in the shared hub just to share a palette.
- **Evidence:** [theme remapping and chart initialization](plugins/DirtyStats/dirtyStats.js#L144), [full map page](plugins/DirtyStats/dirtyStats.js#L784), [growth page](plugins/DirtyStats/dirtyStats.js#L1045), [dashboard Chart and axes](plugins/DirtyStats/dirtyStatsDashboard.js#L190).

### H15 — CSS structure needs cleanup before broad extraction [P1]

- **Observed:** Rank ends a selector with `.dirty-rank-gallery-rating-row span,` immediately before an `@media` reduced-motion block: a malformed source fragment. Stats compresses many rules onto single lines and contains 44 `!important` uses, mainly around native controls and themes. Rank retains both native-card and custom fallback styles, so apparent overlap is not proof of dead CSS.
- **Impact:** Syntax errors and specificity dependencies make a design-system migration harder to reason about and can mask intended rules.
- **Direction:** Repair and parse-check the malformed fragment first. Separate tokens, generic primitives, plugin layout, native compatibility overrides, and capture rules. Document necessary specificity exceptions. Remove CSS only after verifying all native/fallback paths; do not mass-delete `!important` declarations.
- **Evidence:** [malformed Rank fragment](plugins/DirtyRank/dirtyRank.css#L1448), [Stats native overrides](plugins/DirtyStats/dirtyStats.css#L80), [Rank native/fallback styles](plugins/DirtyRank/dirtyRank.css#L1287).

### H16 — Source conventions should make shared code easy to maintain [P3]

- **Observed:** Most files use strict IIFEs and `var`/function style. Multiscreen retains generated-looking React aliases, arrow functions, `const`/`let`, optional chaining, and source-path comments; its outer IIFE lacks the shared strict-mode convention. Some other files already use async functions and modern APIs. Reload strategies intentionally differ: FileExtractor destroys/re-registers, while route-owning plugins skip duplicate loads.
- **Impact:** Shared helpers are harder to compare and extract, but an indiscriminate syntax or lifecycle rewrite would add unnecessary regression risk.
- **Direction:** Follow the repository's var/function convention for new shared code and normalize touched areas gradually. Distinguish source style from a promise of actual ES5-browser compatibility. Keep tested duplicate-load guards for APIs without unregister support.
- **Evidence:** [Multiscreen opening and aliases](plugins/DirtyMultiscreen/multiscreen.js#L1), [FileExtractor teardown](plugins/DirtyFileExtractor/extractScenes.js#L19), [Stats dashboard async loading](plugins/DirtyStats/dirtyStatsDashboard.js#L146), [reload contract tests](tests/test_shared_ui_contract.py).

### H17 — Documentation capture should be one reliable suite feature [P1]

- **Observed:** Hub, Multiscreen, and parts of Stats use `docsCapture=1`; Rank uses `censorMedia=1`. The hub blur only targets FileExtractor text inputs inside its settings tab, not the body-mounted folder picker. Tidy preview renders source/destination paths without capture handling. Stats hides dashboard performer cards and selected images, but its main `PerformerCards` and `SceneCards` render native cards without a capture guard.
- **Impact:** One capture URL is not enough to produce consistent safe review images. New components and portals can expose media or private paths during visual review.
- **Direction:** Share capture detection and safe placeholders/obscuring rules, preserve the Rank alias, cover portals/native cards/path text, and verify complete media coverage. Use synthetic fixtures for design comparisons whenever possible.
- **Evidence:** [hub capture CSS](plugins/DirtyPlugins/dirtyPlugins.css#L349), [Rank capture parameter](plugins/DirtyRank/dirtyRank.js#L1996), [Stats main card lists](plugins/DirtyStats/dirtyStats.js#L755), [Stats dashboard protection](plugins/DirtyStats/dirtyStatsDashboard.js#L351), [Tidy path rendering](plugins/DirtyTidy/dirtyTidy.js#L395).

### H18 — Contracts and documentation should prevent style drift [P1]

- **Observed:** All 40 shared-contract tests pass despite the findings above. Many assertions check for source strings and selected consumers rather than rendered behaviour. There is no consolidated token/component usage guide. The root README version table also trails the current manifests, and its suite test list omits the Stats dashboard test documented in the Stats README.
- **Impact:** Adding a shared class can satisfy a contract without producing a consistent control. Examples and validation instructions can lag the implementation.
- **Direction:** Extend the existing contract intentionally, add focused behavioural coverage for the shared components, and maintain a safe visual fixture matrix. Document defaults, component recipes, allowed exceptions, dependency ownership, and release checks alongside the runtime.
- **Evidence:** [shared contracts](tests/test_shared_ui_contract.py), [root README](README.md#L13), [hub documentation](plugins/DirtyPlugins/README.md), [Stats validation instructions](plugins/DirtyStats/README.md#L298).

## Boundaries to preserve

- Keep all existing plugin directory names, manifest dependencies, no-build distribution, and the shared SQLite/settings architecture.
- Keep Stash-native cards, filters, and player integrations, including their supported fallback paths.
- Keep Tidy's preview, confirmation, approved-plan safeguards, and manual strategy workflow. Visual unification must not turn these operations into autosave execution.
- Keep Rank's podium/precision meaning, Stats' chart-specific palettes and saved optional themes, and Multiscreen's immersive layout.
- Extract common presentation where there are real consumers. Do not create a universal data grid, chart engine, or plugin framework as part of style harmonization.
