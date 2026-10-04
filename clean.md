# Opportunities to reduce code without changing functionality

Reviewed on 2026-10-04 against commit `ba9843f`, with a clean working tree before
the analysis. Implementation began afterward at the user's request. The findings
and source locations below refer to the original snapshot; the implementation
record at the end describes the resulting changes and measured reductions.

## Conclusion

The best remaining reductions are repeated **Stats page plumbing and markup**,
**Rank settings controls**, and a few small repeated integration patterns. The
repository already has shared transport, save controllers, pagination, chart
lifecycles, job interpretation, and several domain modules. Creating those again
would add code, and splitting more files alone would not reduce it.

A reasonable planning target is roughly **450–750 fewer first-party plugin
lines**, approximately **1.6–2.6%** of the current plugin source, plus a smaller
reduction in test scaffolding. These are estimates, not measured refactor
results or a guaranteed total. They include the cost of proposed helpers, can
overlap, and depend on keeping the current readable formatting. A much larger
reduction would need evidence beyond this review; removing compatibility paths,
guards, features, tests, or documentation is not an acceptable shortcut.

## Scope and verification

I inventoried every first-party JS, Python, and CSS file, examined function sizes
and repeated bodies, scanned JavaScript symbol references and Python imports,
compared CSS declaration blocks, and inspected the repeated paths together with
their callers and tests. The detailed review concentrated on shared runtime
contracts, Stats views/dashboard, Rank controls/session/rating presentation,
Multiscreen launch contexts, backend entry points/storage, and the distinct
Extractor, Tidy, Compactor, and Captions workflows.

Counts are physical lines, including comments and blank lines. Vendor assets,
manifests, documentation, runtime artifacts, and type declarations are excluded
from the plugin total.

| Area | Files | Lines |
| --- | ---: | ---: |
| First-party plugin JavaScript | 39 | 16,226 |
| First-party plugin Python | 19 | 6,502 |
| Plugin CSS | 8 | 5,776 |
| **Plugin total** | **66** | **28,504** |
| JavaScript tests and helpers | 30 | 6,268 |
| Python tests | 13 | 5,219 |

| Plugin directory | JS + Python + CSS lines |
| --- | ---: |
| DirtyRank | 8,437 |
| DirtyStats | 5,949 |
| DirtyPlugins | 4,528 |
| DirtyCompactor | 2,359 |
| DirtyTidy | 2,322 |
| DirtyFileExtractor | 1,825 |
| DirtyMultiscreen | 1,732 |
| DirtyCaptions | 1,352 |

Baseline verification actually run:

- `npm ci`: passed.
- `npm test`: typecheck and all **24 JavaScript suites passed**; Python discovery
  reported **272 entries, 270 passed and 2 intentionally skipped** duplicate Node
  checks. The expected Stats storage-failure diagnostic appeared during its
  failure-recovery test; the suite passed.
- No live Stash installation, media processing outside the test fixtures,
  deployment, or browser visual verification was performed for this review.
- The opt-in isolated-Stash script
  `tests/test_dirty_compactor_stash_integration.py` was not run; its scenarios
  are not executed by ordinary unittest discovery.

The earlier readability refactor was completed in commit `ba9843f`.
Recommendations here concern that implementation, rather than older source
locations or already-completed tasks. Its superseded review and handover
documents remain available in Git history.

## Prioritized opportunities

Priorities indicate expected reduction per unit of effort, not bug severity.
Savings are rough **net physical-line estimates**, after helper code and call
sites; they exclude any deletion of test cases or assertions.

| ID | Opportunity | Priority | Effort | Estimated net reduction |
| --- | --- | --- | --- | ---: |
| C01 | Let the Stats loader offer a state-owning adapter | High | Medium | 100–160 plugin lines |
| C02 | Reuse Stats toolbar, export, and chart-panel markup | High | Medium | 140–220 plugin lines |
| C03 | Describe repeated Rank settings controls as data | High | Medium | 60–110 plugin lines |
| C04 | Consolidate Multiscreen list capture and entity-context helpers | Medium | Small | 35–60 plugin lines |
| C05 | Share the completed-job effect around existing job helpers | Medium | Small | 15–30 plugin lines |
| C06 | Share the logged Python entry-point lifecycle | Medium | Medium | 25–45 plugin lines |
| C07 | Reuse SQLite connection closing and deferred read transactions | Medium | Small | 20–30 plugin lines |
| C08 | Merge verified CSS duplicates | Medium | Small | 18–28 plugin lines |
| C09 | Finish a few small utility/forwarding cleanups | Low | Small | 15–30 plugin lines |
| C10 | Reuse test scaffolding while retaining every scenario | Medium | Medium | 20–50 test/helper lines initially |

The ranges are not a sum to promise. For example, C01/C02 may share a small
adapter, and C03/C09 can touch the same controls. Prove net reduction with actual
patches before expanding any abstraction.

## C01. Give Stats a state-owning adapter over its existing loader

**Evidence.** `plugins/DirtyStats/dirtyStats.js` has **13** calls to
`dataLoader.usePageLoad`. `CountRatingPage` at 2122–2146 and
`QualityEfficiencyPage` at 2334–2357 each declare rows, loading, error, refresh,
and a serialized query key, then repeat the collection selector and state
callbacks. The same structure occurs in origins, constellation, growth, ratings,
performer scatter, repeat offenders, studios, tags, and birthdays. The Age view
has two requests with additional coordination.

`plugins/DirtyStats/dirtyStatsData.js:35–58` already owns cancellation and stale
response protection. It deliberately leaves state to callers; this is where
the remaining boilerplate lives. Do not replace the already-shared page loop.

**Reduction.** Add an optional Stats-local hook that owns the ordinary
`rows/loading/error/refresh` state and calls the existing `usePageLoad`. Its
request describes the entity root/collection and passes the existing query and
variable builder. Return a small explicit result object. Keep the lower-level
hook for Age and other requests with custom publication or disabling behavior.

For an ordinary page, the target call site should need its query/filter and
receive the result, instead of declaring three state pairs and supplying three
setter callbacks plus the same `{count, rows}` selector.

**Preserve.** Query operation names, requested fields, page size, native filter
sort, failure wording, refresh behavior, and when selections reset. Some pages
clear selections on filter/options changes; others also clear them when a load
starts. An adapter must preserve each policy explicitly. Do not turn all queries
into a dashboard-sized superset, add caching, or change network request counts.

**Verification.** Retain `test_dirty_stats_data.js`, `test_dirty_stats.js`, and
`test_dirty_stats_dashboard.js`. Extend focused loader assertions for the new
adapter's refresh, disabled requests, failures, and stale completion behavior.
Keep the existing Age two-request and bounded performer-card scenarios.

## C02. Reuse the repeated Stats rendering pieces

**Evidence.** `plugins/DirtyStats/dirtyStats.js` contains **12 Refresh buttons**
and **11 Export PNG buttons**. Compare `CountRatingPage:2164–2224`,
`QualityEfficiencyPage:2380–2435`, and `RatingPage:1814–1858`: toolbar/summary,
refresh, loading/error/empty states, panel/control row, export, chart node, and
selection reset recur with different copy and controls.

The export handler repeats the same `getDataURL` options, background role,
download call, and chart-ref check. Many `<Field>` trees elsewhere also repeat
an ID already assigned to a single child by the shared Field implementation.

**Reduction.** Introduce a few small Stats-local components, such as a toolbar,
an export action, and a chart panel. Give them explicit slots for page controls
and children. Keep the actual statistic components, aggregation, selection,
native cards, and explanatory copy local. Start with Count vs rating and Quality
efficiency to demonstrate that the common pieces replace more code than they
introduce, then migrate the other matching pages.

A single configuration-driven page engine is unnecessary. The shared pieces
should remove repeated trees, not encode every statistic as a large set of
conditional flags.

**Preserve.** Exact classes, panel placement, aria labels, loading/error/empty
visibility, disabled conditions, PNG filenames, pixel ratio 2, current theme
background, and the distinction between a chart error and a request error.
For example, origins can display an empty map; other views omit the chart when
there are no eligible points. Keep those conditions at the caller.

**Verification.** Keep all Stats behavior, chart, dashboard, contrast, and
shared UI contract tests. Extend rendered-tree assertions for the two pilot
pages and export parameters. Check the synthetic suite fixture at 360px and
desktop widths in all seven themes before calling a UI migration complete.

## C03. Extend Rank's existing descriptor approach to ordinary controls

**Evidence.** `plugins/DirtyRank/dirtyRankSettingsPanel.js:152–342` repeats
labelled selects, numeric controls, and seven navigation/battle toggles.
`RatingSettings:545–589` repeats three numeric Field/input trees immediately
before the existing descriptor loop at **591–615** for six other numeric values.
The overall-score controls at 310–337 use another descriptor-based input tree.

The shared `Field` at `plugins/DirtyPlugins/dirtyPluginsReact.js:298–318`
already assigns the child ID, descriptions, and invalid state. Its users do not
need to hand-write that wiring repeatedly.

**Reduction.** Add small presentation primitives for a labelled select and
labelled number input under `DirtyPlugins.react`, provided the Rank migration
alone pays for their code. Keep labels, limits, steps, help text, and option
lists in ordinary named descriptors. Map the simple toggles through existing
`SettingsToggle`. Extend the existing numeric descriptor loop instead of
creating a new form framework. Remove redundant child IDs only where Field
receives one normal React element and supplies exactly the same ID.

**Preserve.** Value conversion is a caller decision. `confidenceTopN`,
`leaderboardPerformerCount`, and overall-power edits retain raw input strings
for visible invalid drafts; the advanced rating controls currently use
`Number(...)`. Do not unify them by immediately coercing every number input.
The featured-layout select also updates the page count, while other selects
change one field. Keep that coupled callback and rich tooltip labels explicit.

**Verification.** Retain `test_dirty_rank_media.js`, settings assertions in
`test_dirty_rank.py`, domain-parity tests, typecheck, and shared UI contracts.
Add assertions for raw invalid input, limits/steps, coupled count rounding,
conditional controls, label association, and help/error descriptions. Preserve
autosave and its revision/conflict behavior.

## C04. Consolidate the repeated Multiscreen context plumbing

**Evidence.** In `plugins/DirtyMultiscreen/multiscreen.js`:

- `getPerformerIds:272–282` and `getStudioIds:283–293` share the same find-filter
  copy, page/per-page assignment, query execution, and ID mapping.
- The performer and studio branches in `getSceneQueryVariables:316–349` share
  selected/detail/filter ID resolution and scene find-filter construction.
- The SceneMarkerList, SceneList, PerformerList, and StudioList registrations around
  **1268–1323** repeat the same pathname/filter/selection checks and
  `updateListContext` callback structure.

**Reduction.** Use a small local registration helper with explicit component,
pathname, context key, and destination callback. Use an entity descriptor for
the performer/studio ID query and shared find-filter construction. Keep marker
launches and selected-scene ordering as their own readable paths.

**Preserve.** Exact route tests, registration order, Set checks, context-change
deduplication, query names, `per_page: -1`, selection order, contextual sort,
empty-ID return of `null`, and **studio `depth: 0`**. The descriptors must not
hide the differences between performers and studios. Retain the one-time asset
guard; no extra observers, timers, or native patches.

**Verification.** Retain every scenario in `test_dirty_multiscreen.js` and
registration/shared UI contracts. Cover each registration through the actual
patch callback, including wrong path, missing filter, empty selection, and
duplicate bundle loading.

## C05. Share the React effect that consumes completed jobs

**Evidence.** Job interpretation and replay tracking are already shared in
`plugins/DirtyPlugins/dirtyPluginsJobs.js`. Their surrounding effects still
repeat in:

- `plugins/DirtyTidy/dirtyTidy.js:95–117`;
- `plugins/DirtyCaptions/dirtyCaptionsIndex.js:170–179`;
- `plugins/DirtyCompactor/dirtyCompactorAutomation.js:12–27`.

Each reads the subscription event, claims a completion key, queues work,
releases the claim after failure, and lists the same five job/event dependencies.

**Reduction.** Add a small hub React hook accepting the event, accepted job
kinds, action, and error callback. It can own the replay tracker and completion
effect. Keep the subscription boundary and plugin-specific callbacks local.
Captions' separate bootstrap/configuration-change effect remains separate.

**Preserve.** Tidy accepts Scan and Generate; Captions and Compactor accept
Scan. Preserve callback error logging/notifications and retry after failed
queueing. Browser replay prevention must remain supplementary to the backend's
atomic cross-tab claims, internal-scan exclusion, and job ID plus startTime
identity. Do not replace any of those with a browser-only tracker or polling.

**Verification.** Keep `test_dirty_jobs.js`, all three consumer suites, and
backend automation/index tests. Add a shared-hook test for failure/retry and
unsupported job kinds. Update source-location contracts to verify the helper
and all consumer connections; do not simply remove their job-safety assertions.

## C06. Share the logged backend entry-point lifecycle, selectively

**Evidence.** `main()` repeats UTF-8 setup, reporter creation, start time,
payload reading, domain execution, timed logging, output emission, exception
logging, and exit-code handling in:

- `plugins/DirtyRank/dirty_rank.py:985–1005`;
- `plugins/DirtyTidy/dirty_tidy.py:811–831`;
- `plugins/DirtyFileExtractor/extract_scenes.py:862–880`.

`plugins/DirtyPlugins/dirty_plugins_protocol.py` already supplies the underlying
protocol functions, but these entry points repeat their orchestration.

**Reduction.** A small logged runner in that shared protocol module can accept
the domain runner and existing payload/output/error adapters, logging identity,
optional default mode, stream error policy, and an exit-code callback. The
manifest executable scripts keep their `main()` and JSON entry-point identity.
Start with Rank/Tidy and include Extractor only if the runner remains small.
Avoid forcing every backend through the same lifecycle.

**Preserve.** Rank emits a **nested JSON string**, Unicode output, and a newline;
Tidy emits a direct object with ASCII escaping and uses
`errors="backslashreplace"`; Extractor emits a direct Unicode object. Preserve
the current log messages and exception-to-exit mapping. Tidy's `exit_code_for`
must still fail an all-failed execute run. Keep callable adapters used by tests.

Captions has deliberate public-error redaction and private server diagnostics
(`dirty_captions.py:63–67`); Compactor has a short dispatcher entry point. Their
different paths are not good initial consumers. Stats has its own capacity log
context and nested envelope; adding it is optional, not assumed in the estimate.

**Verification.** Keep protocol tests and every backend's existing stdin/stdout,
logging, Unicode, error, and exit-code tests. Compare actual envelopes and log
streams before and after. A runner with many special branches or verbose
configuration is a reason to stop, not to migrate more consumers.

## C07. Reduce SQLite lifetime boilerplate without changing transactions

**Evidence.** `plugins/DirtyPlugins/dirty_plugins_storage.py` has an existing
write transaction manager at **98–109**. The snapshot readers at **244–258**
and **261–289** repeat their own BEGIN/commit/rollback/close lifecycle.
`get_metadata:163–172` and `list_metadata:205–213` repeat connect/try/finally/close.

**Reduction.** Add an explicit deferred-read mode to the existing transaction
manager, preserving its default `BEGIN IMMEDIATE`, and use it for the two
snapshot readers. Use standard-library `contextlib.closing` for ordinary owned
read connections. Keep the SQL and result construction visible.

**Preserve.** Snapshot readers use **`BEGIN`**, not `BEGIN IMMEDIATE`; ordinary
single-query readers should acquire no new explicit transaction. A borrowed
connection passed to `get_plugin_revision` or `get_plugin_settings` must not be
closed, committed, or rolled back by the callee. Do not replace closing with
`with sqlite3.Connection`, whose context manager controls transactions rather
than closing the connection. Keep settings compare-and-swap, metadata atomic
updates, Compactor run claims, and revision checks unchanged.

**Verification.** Retain `test_dirty_plugins_storage.py`, Rank settings/rating
repository tests, Compactor concurrency/recovery tests, and caption-index tests.
Verify closure after errors and that borrowed connections remain usable. A
generic SQL repository or callback wrapper would add complexity for little
additional reduction.

## C08. Merge a small, verified set of CSS duplicates

**Evidence.** There are a few exact matches, rather than evidence for a wholesale
CSS rewrite:

- `plugins/DirtyPlugins/dirtyPlugins.css:662–668` (`.dirty-ui-table th`) and
  **773–779** (`.dirty-ui-metric-label`) have identical declarations.
- `plugins/DirtyRank/dirtyRank.css:67–72` (`.dirty-rank-category-picker`) and
  **1983–1988** (`.dirty-rank-category-genders`) have identical fieldset resets.
- Rank's podium/gallery placeholders at **1455–1459** and **1746–1750** have
  identical color, font size, and height.
- The hub's `.dirty-ui-toolbar` blocks at **645–650** and **921–926** repeat
  display/flex-wrap/alignment; the later block overrides the earlier gap.

**Reduction.** Group the exact selectors and remove superseded declarations
after checking intervening rules. Keep the effective final toolbar gap
`0.5rem 0.75rem`. This should be a small patch with no new utility-class layer.

The visually hidden rules for Multiscreen's counter status and Rank's page
title also match, but moving them across plugin stylesheets is not automatically
beneficial. A shared utility adds markup changes and may encounter different
host-theme specificity. Prefer the same-file consolidations first.

**Preserve.** Selector specificity, source order relative to competing rules,
media-query boundaries, native Stash compatibility overrides, focus states,
reduced motion, and docs-capture masking. Identical bodies alone do not prove a
safe merge. Do not remove `!important` declarations on the assumption that the
normal suite stylesheet wins against host themes.

**Verification.** Keep CSS/shared UI contracts and Stats contrast tests. Check
the affected controls in synthetic fixtures at narrow/desktop widths and all
themes. Tests alone do not prove visual equivalence.

## C09. Finish small utility and forwarding cleanups

These are narrow follow-ups, not a reason to create a broad utilities framework.

1. **Boolean coercion in Python:** `extract_scenes.py:173–184` and
   `dirty_tidy.py:178–189` have equivalent bodies; their default argument differs.
   Share the implementation in a hub-owned values helper or another appropriate
   existing shared module, retaining each entry module's callable name/default.
   A lone 12-line extraction can save little after imports and aliases, so fold
   it into a justified shared-helper change. Preserve accepted strings, `None`,
   and fallback truthiness.
2. **Forwarding wrappers:** `dirtyRankSettings.js:124–130` forwards `asObject`
   and `parseMaybeJson` without adapting either. Direct local aliases to the
   existing `DirtyPlugins.values` functions eliminate those wrappers while
   preserving the settings module's returned API names.
3. **Bootstrap duplication:** Extractor's `_load_shared_storage:40–49` and
   Tidy's `:62–71` are identical and each is called once. Their discovery loop
   can use the shorter explicit folder-name style already used by Compactor,
   while retaining the missing-runtime error and imported module identity.
   Do not propose a shared loader that itself cannot be imported until the
   same discovery code has run. Preserve installed lowercase IDs and repository
   uppercase directory names.
4. **Unused imports:** the AST scan found unused implementation imports such
   as `json` in several protocol entry scripts, `hashlib` in Compactor's entry
   module, and `StashReporter` in Captions/Compactor. Remove only confirmed
   non-exported leftovers after checking test aliases and monkeypatches.
   Tidy's imported template functions are often compatibility re-exports:
   tests still call `dirty_tidy._grade`, `sanitize_filename`, and
   `render_rename_template`. An unused-in-module import is not proof of dead code.

**Verification.** Keep all tests intact, including standalone Python discovery,
protocol tests, domain-parity tests, and plugin asset/type checks. The JS symbol
scan did not identify an obvious unreferenced named function/variable to delete;
do not infer a large dead-code cleanup from file sizes.

## C10. Reduce test scaffolding, not test coverage

**Evidence.** `tests/ui_harness.js` already provides element trees, traversal,
text, and event dispatch. `test_dirty_stats.js:6` still defines the same basic
element shape locally, with another copy around **582**. Similar event and
element scaffolding remains in older suites.

The hook simulators in `test_dirty_rank_media.js:20–48` and
`test_dirty_rank_session.js:15–39` repeat slot indexing, functional state
updates, refs, dependency comparison, callback/memo handling, and effect
cleanup. `tests/shared_runtime.js` repeats its small VM-file-loading sequence
for metadata, jobs, and save helpers.

**Reduction.** First reuse existing element/event helpers where their behavior
already matches. Then, if it produces a net reduction, add a tiny test-only hook
host shared by the two Rank suites, with explicit render/effect/unmount methods.
Keep scenario data, native component expansion, fake responses, deferred
promises, and assertions in each suite. An internal helper can also remove the
three repeated VM-load sequences in `shared_runtime.js`.

**Preserve.** Every test file, scenario, assertion, failure-injection branch,
suite discovery rule, and independent-process isolation. The media suite has
special hook-free section expansion; preserve it as its local renderer. Do not
replace narrow effect stubs in every suite with a more complicated hook engine.
Manual source loading is sometimes deliberate to retain a fake ECharts/native
host; loading the complete manifest is not an automatic equivalent replacement.

**Verification.** Keep `test_test_runner.js` and all existing suites. Test the
new harness's state updates and cleanup if one is introduced, and compare the
scenario/assertion inventory before and after. Keep Python's two intentional
combined-run skips and its standalone Node coverage as they are.

## Tempting changes that are not justified as code reductions

- **Another save framework:** the shared save controller already exists.
  Rank owns rating-identity migration/revisions, Stats merges changed keys after
  reload, and Compactor blocks after save failures. Their remaining adapters
  encode different policies. Tidy's explicit preview/confirm workflow must stay.
- **One chart definition for full views and dashboard widgets:** the same
  aggregates are already reused, but chart presentation differs. Full views
  have selection, incremental updates, zoom, export, and detail labels;
  widgets have size-specific axes, transparent backgrounds, simplified
  tooltips, and different graph geometry. For example, full ratings use raw
  category names while the widget appends `/10`. Share proven leaf helpers only;
  blindly calling the full-view builder would change existing output.
- **Unifying all Stats defaults:** registry widget choices duplicate some
  `STATS_SETTING_SPECS` options, but full Growth defaults to `day` and the
  dashboard defaults to `month`. Registry reuse can help C02, but a mapping
  table alone may cost as many lines as it removes. Preserve separate defaults
  and persistence keys; do not count relocation as reduction.
- **One filter representation/editor:** the hub scene-filter editor returns
  `{find, scene, query, all}` and applies a candidate explicitly; Stats dashboard
  filters use `{find, object, count}` with a different capture/update flow.
  Rank also keeps global ranks independent of its visible filters. Adapters
  would be required, and no clear net reduction was demonstrated.
- **One subprocess runner:** Captions bounds in-memory output and diagnostics,
  enforces a timeout, and reaps readers; Compactor journals progress/cancellation
  and uses temporary private stderr logs; Extractor produces bounded marker
  clips with its own progress semantics. Child containment is already shared.
  A universal runner could become larger and remove critical distinctions.
- **Collapsing destructive workflows:** Tidy plans/digests and path containment,
  Extractor collision reservations and per-item failures, and Compactor
  approval/recovery/CAS journals have different contracts. Their explicit
  phases are useful code, not duplicate CRUD to erase.
- **Removing caption caches/guards:** the stored Stash fingerprint fast path
  skips unchanged media before filesystem stat/probe. Keep forced reprobe,
  leases, unknown/error states, partial writes to owned custom fields,
  native-source timing, in-memory captions, and hook-loop prevention. Do not add
  timer-based library checks to make the code look uniform. Status polling in
  the settings panel is a different concern.
- **Replacing JS/Python mirrored rules with one language:** browser previews
  and server validation both need their implementations. Rank rating math and
  Compactor rules already have parity fixtures. Eliminating either execution
  path changes functionality; adding a runtime generator or dependency is not
  justified merely to reduce source lines. Preserve the documented legacy
  flat-category normalization difference rather than silently fixing it.
- **Deleting legacy/native fallbacks:** Stats explicitly supports older-hub
  state rendering; Rank retains native and fallback cards/players; Extractor
  retains an older field-action integration path. Declaring them unreachable
  from the current machine is not proof that supported installations cannot
  use them. Minimum-version changes are compatibility changes, not cleanups.
- **Dynamic exports, bundling, or minification:** exported algorithms and
  guarded IIFEs are contracts used by plugins/tests. Keep explicit APIs,
  manifest load order, standard-library Python, and the no-build distribution.
  Minifying sources, deleting comments/types, or replacing readable statements
  with dense one-liners reduces visible lines without reducing responsibilities.
- **A large CSS purge or packaging rewrite:** most CSS is specific layout,
  theme, capture, native compatibility, or responsive behavior. Vendor code and
  notices must remain intact. `build_site.sh` already iterates plugins and
  excludes runtime artifacts; no major duplication warrants new packaging
  dependencies.

## Implementation order and acceptance criteria

1. Establish small reductions with C08, the aliases in C09, and C04. Keep each
   patch independently reviewable.
2. Pilot C01/C02 on two ordinary Stats pages. Measure the net change including
   new helpers and contracts before migrating the remaining pages.
3. Apply C03 to the simple Rank controls, retaining explicit exceptional
   callbacks and invalid-draft handling.
4. Address C05 and C07 separately because event replay and transactions require
   different behavioral checks. Consider C06 only after its adapter cost is
   clear. C10 can proceed independently of production refactors.

For every change:

- Keep existing test cases and their substantive assertions. Update any
  source-based contract to check the same guarantee at its new location, with
  behavior checks where appropriate; do not relax it simply to make a refactor
  pass. Add tests only for genuinely new shared boundaries or uncovered risks.
- Run the relevant focused suites while iterating, then `npm test` and
  `git diff --check` for the completed change. Preserve the 24-suite discovery
  and 272-entry baseline inventory, or increase it with new coverage.
- Compare source-line and byte totals including new helper files. Count
  production and test scaffolding separately. A smaller call site with a larger
  shared implementation is not a code reduction.
- Preserve API shapes, protocol envelopes, user-visible copy, accessibility,
  request ordering/counts, persistence revisions, cleanup, compatibility, and
  all safety/capture behavior. Test success supports equivalence but does not
  replace rendered UI checks or workflow-specific invariants.
- Reject an abstraction if it requires numerous flags or plugin-specific
  branches, does not pay for itself, or makes ownership harder to understand.
  Common suite capabilities belong in DirtyPlugins; statistic-specific
  rendering and ECharts code remain local to DirtyStats.

## Implementation record — 2026-10-04

The behavior-preserving reductions are implemented in the working tree. The
first-party plugin total fell from **28,504 to 28,046 lines: 458 fewer lines**.
Including the nine added type-declaration lines, production code and contracts
are **449 lines smaller**. Counts include comments and blank lines, exclude
vendor assets, and compare the current files with `ba9843f`.

| Finding | Implemented scope | Net plugin lines removed |
| --- | --- | ---: |
| C01/C02 | Stats state adapter for 12 loaders; shared ordinary toolbars, refresh/export buttons, and 11 chart containers | 247 |
| C03 | Rank's seven simple presentation toggles and nine advanced numeric controls use their existing shared primitives through descriptors | 54 |
| C04 | Multiscreen's four list captures and performer/studio launch-query construction share helpers | 57 |
| C05 | One completion hook owns replay claims, job identity dependencies, and failure releases for Tidy, Captions, and Compactor | 4 |
| C06 | Rank, Tidy, and Extractor share logged entry-point handling; their protocol adapters and dispatch functions remain local | 25 |
| C07 | Owned metadata reads use `closing`; settings snapshots use deferred transactions through the existing transaction context | 24 |
| C08 | Exact repeated CSS declarations are consolidated after checking competing rules | 25 |
| C09 | Direct Rank utility aliases, shorter storage discovery loops, and confirmed unused imports | 22 |
| **Total** | Includes added shared implementations | **458** |

C10 removes **38 lines of duplicated test scaffolding**: Rank suites share their
existing hook simulation, pure runtime feature loading has one implementation,
and Multiscreen tests use the actual hub value helpers. All test cases and
substantive assertions are retained. New coverage for the shared boundaries,
plus equivalent source-contract updates, increases the complete test source by
108 lines. Across plugin source, type declarations, and tests together, the
net reduction is **341 lines and 8,131 UTF-8 bytes**, with line endings normalized
so CRLF changes do not count as savings. Documentation is excluded from these
code totals.

The implementation deliberately stays narrower than several initial proposals:

- Stats keeps refresh, selection, chart errors, and exceptional requests local.
  The adapter calls the same three state hooks in the same position and invokes
  the existing abort-aware loader at the original effect position. Age retains
  its independent performer-ID request; Birthday retains its publication
  callback; Ratings retains its plural entity failure wording and chart-error
  setter. The full-page Growth defaults and dashboard defaults are unchanged.
- Stats shares the repeated chart image element, while view-specific panels,
  controls, conditional rendering, export filenames, and disabled conditions
  remain explicit. A more general panel engine would need unnecessary flags.
- Rank reuses `Field` and `SettingsToggle` directly instead of introducing new
  shared select/number components. Coupled leaderboard controls and raw invalid
  draft values keep their explicit handlers. IDs, labels, numeric limits, and
  conversion behavior are preserved.
- Backend stream configuration remains in each entry point. Tidy's all-failed
  exit policy and each plugin's nested/plain JSON envelope remain unchanged.
  Captions and Compactor keep their distinct entry lifecycles.
- Existing Python boolean wrappers remain: a shared parser plus compatibility
  wrappers would yield little or no net reduction. Compatibility aliases that
  tests exercise are retained.

Verification performed:

- Focused JS suites for Stats, Rank, Multiscreen, job completion, Captions,
  Compactor, and Tidy, plus storage and backend Python suites.
- Added checks for entity loading, stale cancellation, publication callbacks,
  failure wording, job-kind filtering, local replay/retry, exact backend logs
  and exit policy, deferred/immediate transactions, rollback, and connection
  closing. Four Python test methods were added; no existing method was removed.
- **39 comparisons with the original Stats implementation:** all 13 full views
  in loading, populated, and request-error states have equivalent rendered
  element trees and effect dependency ordering. This uses the local element
  harness, with refs/callback identities normalized; it is not a live browser
  screenshot comparison.
- **15 comparisons with the original backend entry points:** Rank, Tidy, and
  Extractor match in dispatch, output/error calls, exact logs, and exit codes
  for success, default mode, all-failed output, input failure, and dispatch
  failure.
- **`npm test` passed:** typecheck, all 24 JavaScript suites, and Python
  discovery with 276 entries (274 passed; the same two duplicate-JS invocations
  skipped as at baseline). `git diff --check` passed. The opt-in live Compactor
  integration script was not run.

No live Stash files were copied, no package output was generated, and no
manifest versions were bumped for this internal refactor. The shared runtime
and its updated consumers should be installed together when releasing these
changes; the new helper APIs live in DirtyPlugins.
