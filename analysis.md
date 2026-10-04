# Code simplification and readability analysis

Implementation completed on `codex/readability-refactor` on 2026-10-04.
See [refactor-progress.md](refactor-progress.md) for task status and verification.

Reviewed on 2026-10-03 against the current working tree, including the existing
DirtyCompactor and DirtyTidy changes and `dirty_compactor_quality.py`.
Source locations below are relative to the repository root; line numbers describe
this snapshot and will move after refactoring.

## Scope and main findings

This is a static maintainability review of the shared runtime and all eight
plugin directories, with targeted inspection of their tests, manifests, and
repository conventions. First-party plugin sources contain 25 JavaScript files
(15,384 lines), 16 Python files (6,314 lines), and eight stylesheets (5,785 lines).
These counts exclude bundled vendor code, tests, and runtime artifacts. Large
files and functions guided inspection; size alone is not a reason to split code.

The strongest opportunities are to separate stateful controllers from rendering,
reuse repeated asynchronous lifecycle code, and give backend planning and
execution explicit boundaries. The project already has useful examples:
`dirtyPluginsValues.js`, `dirtyStatsAges.js`, `dirtyStatsGrowth.js`,
`extract_scenes_destinations.py`, and `dirty_rank_rating.py`. Extend that pattern
instead of introducing a framework or build step.

Existing notes in `TODO.md` were treated as leads, not as current findings. For
example, DirtyRank now rejects stale rating-index responses, and FileExtractor
now retains per-item failures. Those older bug descriptions should not drive
new refactors without checking the source again.

The priorities below describe maintenance value, not bug severity. Effort is
relative: small means a narrow extraction, medium means several consumers or
tests, and large means a stateful workflow that should be changed in stages.

| ID | Opportunity | Priority | Effort |
| --- | --- | --- | --- |
| A01 | Split DirtyRank settings and battle controllers | High | Large |
| A02 | Share the settings-save lifecycle | High | Large |
| A03 | Reuse DirtyStats paginated loading | High | Medium |
| A04 | Reuse DirtyStats chart lifecycle | High | Medium |
| A05 | Separate the hub's major responsibilities | High | Medium |
| A06 | Reuse Python transport and protocol helpers | High | Medium |
| A07 | Separate FileExtractor planning from execution | High | Medium |
| A08 | Make Compactor handlers and transitions explicit | High | Large |
| A09 | Break Tidy destination planning into named steps | Medium | Medium |
| A10 | Separate caption-index worker phases | Medium | Medium |
| A11 | Strengthen types at feature boundaries | High | Small, incrementally |
| A12 | Share completed-job event interpretation | Medium | Small |
| A13 | Reduce metadata duplication and test mirrored rules | Medium | Medium |
| A14 | Make tests easier to run and less tied to implementation | Medium | Medium |

## A01. Split DirtyRank settings and battle controllers

**Evidence:** `plugins/DirtyRank/dirtyRank.js:2873` contains the 858-line
`DirtyRankSettings` component. It owns loading, autosave, draft edits, gender-box
and category edits, validation, preset estimates, and the settings tree. The
715-line `DirtyRankBattlePage` starts at line 2147 and combines pair selection,
prefetching, optimistic votes, serialized persistence, undo, keyboard controls,
navigation protection, and rendering. The existing `dirtyRankSettings.js` mainly
extracts settings normalization and metadata; it does not contain this panel.

**Suggested change:**

- Extract settings sections into components such as `GenderBoxEditor`,
  `CategoryEditor`, `PresentationSettings`, and `RatingSettings`. Pass the draft,
  relevant errors, and explicit edit callbacks.
- Move pure `validateSettings` logic from inside the component (line 3118) into
  the existing settings module so it can be read and tested independently.
- Extract a battle-session controller or hook that owns pair selection and the
  vote/undo queue. Keep battle mode rules there; leave cards and controls in the
  page component.
- Group state that changes together, such as session counters and decision
  feedback, instead of maintaining loosely related setters throughout the page.

**Why it helps:** A presentation edit no longer requires understanding persistence
and matchmaking. Do this in separate steps; relocating the whole component into
another file would leave its main complexity intact.

**Validation:** Preserve immediate battle advancement, ordered vote/undo writes,
undo after an in-flight vote, failed-record handling, Gauntlet and King of the
Hill behavior, and pending-operation navigation protection. Use the Rank
algorithm, registration, media, and Python tests, plus focused controller tests.

## A02. Share the settings-save lifecycle

**Evidence:** The hub's `DirtyPluginsRoute` manages per-plugin timers, promise
chains, and save revisions (`plugins/DirtyPlugins/dirtyPlugins.js:1437`,
`:1565`, and `:1573`). Rank implements another queue with draft/edit revisions
(`dirtyRank.js:2907` and `:2956`). Stats uses module-level listeners, dirty-key
tracking, and a save chain (`plugins/DirtyStats/dirtyStats.js:86` and `:218`).
Compactor uses refs and a recursive save pump
(`plugins/DirtyCompactor/dirtyCompactor.js:299`). There is already a shared
`configurePlugin` transport, but the lifecycle around it is still repeated.

**Suggested change:** Add a small shared save controller in DirtyPlugins, with
an optional React hook adapter. It should own debounce timing, write serialization,
edit generations, saved snapshots, cleanup, and structured status
(`pending`, `saving`, `saved`, `invalid`, `error`). Plugins supply normalization,
validation, serialization, and their persistence callback. Rank can retain its
specialized `saveSettings` operation, which also migrates rating identities.

Keep conflict policy explicit: Stats currently reloads and merges changed keys,
while other panels may expose the conflict to the user. A shared controller must
not silently impose one policy on every plugin. DirtyTidy retains its explicit
preview/confirm/save workflow.

The hub also mutates `snapshot.configuration` and `snapshot.pluginRevisions`
after saving (`dirtyPlugins.js:1609`). Use immutable state updates or a clearly
separate persistence ref so React state and queue bookkeeping have distinct roles.

**Why it helps:** Write ordering and stale-success handling become one documented
contract rather than four slightly different implementations.

**Validation:** Test rapid edits, an edit during a write, a failed write followed
by retry, revision conflicts, restoring an old draft during a write, unmounting,
and invalid inputs. Preserve dirty-state reporting and the server's expected
revision checks. Migrate one consumer at a time.

## A03. Reuse DirtyStats paginated loading

**Evidence:** `plugins/DirtyStats/dirtyStats.js:748` and `:2211` show nearly
identical effects: create an AbortController, set loading/error, fetch bounded
pages, reject an unexpectedly empty page, accumulate rows, publish results, and
abort on cleanup. This pattern recurs across the full statistic views. Dashboard
already has its own `fetchPages` implementation
(`plugins/DirtyStats/dirtyStatsDashboard.js:166`).

**Suggested change:** Extract a Stats-local `fetchAllPages` helper and a small
loading hook. Pass the query, page-variable builder, response collection selector,
signal, and failure label. Queries and entity-specific aggregation stay readable
at the call site. Dashboard's bounded performer-card request should remain an
explicit single-page option, not be forced into an all-records fetch.

**Why it helps:** Each view expresses which data it needs without copying the
request lifecycle. Start within Stats; promote a generic mechanism to the hub
only when another plugin actually needs it.

**Validation:** Preserve 500-record bounds, native filters, explicit sorting,
refresh behavior, empty-page protection, and abort checks before publishing
results. Test that a previous filter's response cannot replace the current data.

## A04. Reuse DirtyStats chart lifecycle

**Evidence:** `initStatsChart` already provides reduced-motion and export behavior
(`plugins/DirtyStats/dirtyStats.js:173`), but full views still repeat creation,
click listeners, ResizeObserver, window resize handling, errors, and disposal.
For example, see `CountRatingPage` at line 2227 and `StudioValuePage` at line 2580
onwards. Dashboard has a separate `Chart` component at
`plugins/DirtyStats/dirtyStatsDashboard.js:214`.

**Suggested change:** Build a Stats-local chart hook/component around
`initStatsChart`. Give it explicit option updates, event handlers, resize hooks,
and a chart ref for PNG export. Keep map-specific geometry and registration in
the map adapter. Extract long chart options into named builders such as
`countRatingOption(stats, metric)`; the current option at line 2235 obscures the
effect's lifecycle with tooltip and axis configuration.

**Why it helps:** Ownership of observers, listeners, and disposal is clear in one
place. Aggregation, option construction, and React state stop competing inside
each page.

**Validation:** Preserve selection, click semantics, resize behavior, export
backgrounds, reduced motion, theme changes, and cleanup. Make the merge/reset
policy explicit: full option replacement and incremental updates have different
effects on zoom and selection. Keep ECharts and this adapter inside DirtyStats.

## A05. Separate the hub's major responsibilities

**Evidence:** The 1,767-line `plugins/DirtyPlugins/dirtyPlugins.js` contains debug
instrumentation (line 128 onwards), transport and settings revisions (369-478),
dialogs and shared components (483-921), theme/native integration (959-1117), and
settings-page logic (1118 onwards). `DirtyPluginsRoute` alone spans 340 lines.

**Suggested change:** Continue the existing manifest-ordered feature-file
pattern. Suitable boundaries are debug instrumentation, transport/settings,
shared React/dialog primitives, and theme/native adapters. The entry file should
assemble and register them. Prefer explicit factory dependencies over new
implicit globals, and preserve the existing public `DirtyPlugins` API.

**Why it helps:** A contributor can find transport behavior or a shared control
without navigating settings-page code. It also makes A02 easier to implement.

**Validation:** Maintain manifest load order, one-time route/patch registration,
public exports, and component-effect cleanup. Extend
`tests/test_shared_ui_contract.py` intentionally and retain its guarantees;
splitting files is not a reason to weaken the contract.

## A06. Reuse Python transport and protocol helpers

**Evidence:** Tidy and FileExtractor each define a Stash client, no-op reporter,
Stash stderr reporter, and JSON payload/output helpers:
`plugins/DirtyTidy/dirty_tidy.py:84`, `:111`, and `:217`;
`plugins/DirtyFileExtractor/extract_scenes.py:57`, `:88`, and `:217`.
`plugins/DirtyPlugins/dirty_plugins_client.py:43` already provides a shared
transport used by Compactor and Captions. Raw-protocol wrappers also recur in
Rank and the hub backend.

**Suggested change:** Enhance the shared client with configurable timeouts and
consistent transport-error handling, then let plugin clients subclass or compose
it for domain queries. Add narrowly scoped shared reporter and protocol helpers.
Keep each manifest's executable script as the entry point and keep domain
operations local. A minimal sibling-discovery bootstrap is still needed before
shared modules can be imported in both repository and installed layouts.

**Why it helps:** IPv6 host formatting, credentials, JSON encoding, GraphQL
errors, and Stash's stderr protocol have fewer implementations to maintain.

**Validation:** Preserve UTF-8 streams, valid JSON on failure, stdout/stderr
separation, timeout differences, and exit codes. Keep tests able to inject streams
and reporters. Do not merge all FFmpeg runners as part of this extraction:
cancellation, progress, containment, and output ownership differ by feature.

## A07. Separate FileExtractor planning from execution

**Evidence:** `_copy_resolved_items` is 329 lines
(`plugins/DirtyFileExtractor/extract_scenes.py:522`). It validates settings,
prepares folders, validates marker ranges, deduplicates sources, resolves
destinations, estimates progress, reserves names, copies/extracts files, cleans
failures, and formats the result. Destination helpers have already been extracted.

**Suggested change:** Keep the public wrappers, but split the body into settings
normalization, per-item planning, operation execution, progress accounting, and
result formatting. Use a small dataclass or TypedDict for a planned operation
instead of passing an evolving dictionary with implicit required keys.
Make directory creation and destination reservation explicit execution steps;
planning must continue to preserve dry-run behavior.

**Why it helps:** Collision policy and marker validation can be understood without
reading copy-progress closures and exception cleanup.

**Validation:** Preserve `reserve_destination`'s atomic claim, rechecking collisions
at execution, original-file protection, marker boundaries, throttling, cleanup,
and partial-success reporting. The current per-item failure handling at line 789
is useful behavior to preserve, not remove to shorten the function.

## A08. Make Compactor handlers and transitions explicit

**Evidence:** `dispatch` is 129 lines with nested workflow logic
(`plugins/DirtyCompactor/dirty_compactor.py:870`). It handles previews, worker
queueing, automatic triggers, output decisions, cancellation, and recovery.
Status assignments and persistence also occur throughout `worker` (line 591),
`commit` (546), and `recover` (784). Run and operation dictionaries acquire fields
as they move through these stages.

**Suggested change:** Extract named handlers such as `queue_preview`,
`handle_automatic_trigger`, and `decide_output`; leave dispatch as a readable mode
router. Define run/operation shapes and the allowed status transitions near the
workflow code. Use narrow transition helpers for repeated expected-state checks
and persistence, rather than a general-purpose state-machine dependency.

Separate planning, media execution, and reconciliation into domain modules only
after their input/output contracts are explicit. In particular, a status getter
such as `getPreview` currently includes stopped-task reconciliation; name that
step so its side effect is apparent.

**Why it helps:** The order of journal writes, queueing, file replacement, and
recovery becomes reviewable without tracing assignments across the entire file.

**Validation:** Preserve compare-and-swap revisions, one active run, cross-tab
trigger deduplication, source revalidation, review decisions, cancellation, and
recovery after interruption. Use isolated files/fake clients for failure tests;
these are sensitive workflow changes and should be separate from formatting.

## A09. Break Tidy destination planning into named steps

**Evidence:** The 133-line `build_operation`
(`plugins/DirtyTidy/dirty_tidy.py:437`) creates the result and warnings, checks the
source, resolves move/rename eligibility, renders folders and filenames, combines
missing/invalid tokens, checks containment/collisions, and chooses status.

**Suggested change:** Extract folder rendering, filename rendering, and final
destination validation into helpers with named result fields. Keep one visible
orchestrator that controls status precedence and combines warnings. Avoid helpers
that silently mutate the operation dictionary; return the computed destination
and validation details instead.

**Why it helps:** A filename-template change can be reviewed separately from
containment and collision policy. The existing `dirty_tidy_templates.py` is a
natural home for pure rendering helpers.

**Validation:** Preserve missing-variable fallback, unknown-variable errors,
reserved Windows names, source-root containment, unchanged paths, warning order,
and reviewed-plan hashes. The UI's explicit preview/confirmation contract remains
the boundary for saving and execution.

## A10. Separate caption-index worker phases

**Evidence:** The 105-line `worker`
(`plugins/DirtyCaptions/dirty_captions_index.py:399`) has nested helpers that share
counts, lazy tool loading, file/scene maps, token ownership, and forced-reprobe
state. Pending-item and full-scan paths repeat outcome accounting and record
refreshing (lines 424-431 and 463-470). Lease completion and rescheduling are
interleaved with traversal.

**Suggested change:** Introduce a small explicit worker context and extract
pending-batch processing, full-scan traversal, and lease completion. Share an
outcome-accounting helper. The top-level worker should make its phases and
cancellation boundary easy to follow.

**Why it helps:** Hook queue handling and library traversal can be changed without
reasoning through all closure mutations simultaneously.

**Validation:** Preserve the unchanged-file fast path before stat/probe, Stash's
stored fingerprints, forced reprobe, conditional pending deletion, atomic lease
release, hook-loop protection, unknown/error retention, and partial writes to the
three owned custom fields. Preserve event-driven scheduling; do not introduce
timer-based library checks or persisted subtitle payloads.

## A11. Strengthen types at feature boundaries

**Evidence:** New feature files use `@ts-check`, but several important contracts
are still `*`, `Function`, or `Array<*>`. Examples include
`plugins/DirtyRank/dirtyRankMatchmaking.js:7`,
`plugins/DirtyTidy/dirtyTidyPreview.js:7`, and
`plugins/DirtyCompactor/dirtyCompactorRules.js:81`.
`types/stash-globals.d.ts:1` describes only a small subset of the hub API;
`tsconfig.json` keeps global `checkJs` disabled. Captions already demonstrates
useful domain typedefs in `dirtyCaptionsTracks.js:9`.

**Suggested change:** Add JSDoc typedefs for settings, rules, operations, result
payloads, and factory dependencies. Annotate callback parameters/return values
and exported APIs first. Expand shared declarations with actual hub methods and
components as consumers become typed. Keep permissive types at genuine native
Stash compatibility boundaries, rather than spreading them through domain code.

**Why it helps:** Readers learn which fields are required and what each function
returns; the existing no-emit typecheck can catch accidental contract changes.

**Validation:** Run the existing `npm ci` / `npm run typecheck` workflow when
implementing this. Keep `@ts-check` adoption incremental; enabling checking for
every legacy file at once would create unrelated cleanup work. No runtime
TypeScript or new dependency is needed.

## A12. Share completed-job event interpretation

**Evidence:** Successful job-removal predicates and replay bookkeeping recur in
`plugins/DirtyTidy/dirtyTidy.js:95`,
`plugins/DirtyCaptions/dirtyCaptionsIndex.js:169`, and
`plugins/DirtyCompactor/dirtyCompactorAutomation.js:13`. Each interprets job
description/status/startTime, builds an identity, and releases its local claim
after queue failure. Tidy also handles generation jobs.

**Suggested change:** Start with a pure hub helper that turns a successful
completion event into `{kind, jobId, startTime, key}` or null. If useful, add a
small bounded in-memory replay tracker. Plugins retain their subscriptions,
enabled-setting checks, callbacks, and user-facing error policy.

**Why it helps:** Stash's event-shape compatibility rules are documented once,
and Scan versus Generate handling is explicit.

**Validation:** Keep identity based on job ID plus startTime. Local replay guards
must supplement backend atomic deduplication and internal-scan checks. Verify
failed/stopped jobs, missing timestamps, replayed events, and retry after a
queueing failure. Do not replace these subscriptions with polling.

## A13. Reduce metadata duplication and test mirrored rules

**Evidence:** Multiscreen defaults appear in the hub
(`plugins/DirtyPlugins/dirtyPlugins.js:76`) and its own settings module
(`plugins/DirtyMultiscreen/multiscreenSettings.js:11`). Stats lists routes,
labels, and order in its core (lines 426-457), then repeats labels/routes/order in
dashboard widget definitions (`dirtyStatsDashboard.js:30-51`). Rank defaults and
category definitions exist in both `dirtyRankSettings.js:24` and
`dirty_rank.py:43`. Compactor explicitly mirrors bitrate/quality tables and
calculations between JS and Python (`dirtyCompactorRules.js:7`, `:78`, `:81`,
`:90`; `dirty_compactor_rules.py:15`, `:144`, `:156`; and
`dirty_compactor_quality.py:22`).

**Suggested change:**

- For same-runtime metadata, derive labels/routes/order from a single registry.
  Stats' registry should load before both core and dashboard; the core cannot
  depend on an extension that the manifest loads later.
- Give shared settings metadata one explicit ownership point instead of
  independently editing hub and plugin copies. Keep typed manifest declarations
  and account for the hub loading before feature plugins.
- For JS/Python mirrors, retain local implementations where the browser needs
  immediate calculation. Add shared input/output fixtures that exercise both
  implementations: defaults, legacy settings, boundary values, portrait resizing,
  frame-rate scaling, and preset selection. Shared packaged JSON constants are
  an option only if loading them makes the runtime simpler.

**Why it helps:** Ordinary metadata changes require fewer edits, while unavoidable
cross-language duplication has executable documentation. The browser's approximate
Compactor estimate and backend's measured audio/probe data remain intentionally
different; consistency tests should compare equivalent inputs only.

## A14. Make tests easier to run and less tied to implementation

**Evidence:** `package.json:4` exposes typecheck and asset tests, while `AGENTS.md`
lists many individual Node commands. `tests/load_plugin_scripts.js:24` already
loads files in manifest order, but individual suites still build similar VM,
React, event, and PluginApi stubs. Rank source assertions, for example
`tests/test_dirty_rank.py:637-646`, check specific setter names and queue source
text, which makes behavior-preserving extraction harder.

**Suggested change:** Add a simple dependency-free Node test runner and a documented
command for the full JavaScript suite. Reuse manifest loading and extract only
stable harness pieces such as element trees and event dispatch; keep scenario
data and assertions visible inside each test.

Retain source/manifest checks for architectural requirements such as shared
GraphQL access, dependency order, and prohibited vendor use. For queueing, undo,
cleanup, and navigation behavior, gradually prefer executable tests of the
extracted controllers over exact source fragments. Update shared UI contracts
intentionally as modules move, maintaining the same guarantees.

**Why it helps:** Contributors can verify a refactor with one clear command, and
tests describe externally visible behavior instead of local variable choices.

**Validation:** The runner must execute every intended suite, propagate failures,
and preserve readable test output. Audit existing Python-invoked Node tests so
the combined workflow does not accidentally omit checks or repeat expensive
scenarios without a reason.

## Smaller, concrete readability improvements

- **Expand dense workflow statements.** Compactor's dispatcher at
  `dirty_compactor.py:875` and UI save pump at `dirtyCompactor.js:303` place
  multiple state changes on a line. Give state updates, persistence, and queue
  calls separate lines so their ordering is visible.
- **Format public API exports vertically.** Stats' large one-line
  `algorithms` export at `dirtyStats.js:2947` is difficult to scan and produces
  noisy diffs. Group named exports by responsibility without changing the API.
- **Use named descriptors for complex controls.** Rank's rating settings use
  positional arrays (`dirtyRank.js:3701`) followed by `definition[0]` through
  `[4]`. Objects with `key`, `label`, `min`, `max`, and `step` make the rendering
  code self-explanatory. Small two-value menu pairs do not need this treatment.
- **Fix factory indentation.** Nested factory bodies in `dirtyRankSettings.js`,
  `dirtyRankMatchmaking.js`, and `dirtyPluginsSceneFilter.js` use the same
  indentation as their enclosing declarations. Reindent them so scope is clear.
- **Share only the collision decision.**
  `extract_scenes_destinations.py:44` and `:66` repeat occupied/skip/overwrite/
  rename logic. A private helper can share that decision while copied files keep
  their `samefile` check and generated clips keep their `extract` action.
- **Group identical CSS locally.** `.dirty-rank-image` and
  `.dirty-rank-gallery-image` have identical base declarations
  (`dirtyRank.css:648` and `:1734`). They can share a selector group after checking
  intervening overrides and cascade order. Keep native/fallback card differences,
  theme overrides, and capture rules explicit; broad CSS deduplication would
  obscure those boundaries.

## Recommended implementation order

1. Apply a small batch of formatting fixes and boundary typedefs. Keep mechanical
   formatting separate from behavior changes and run the affected checks.
2. Extract one Stats pagination consumer and one chart consumer; confirm their
   contracts before migrating the remaining views.
3. Extract shared Python transport/protocol pieces and FileExtractor planning,
   using existing behavior tests to preserve error and collision semantics.
4. Split Rank's settings presentation, then its battle-session controller.
   Introduce the shared save lifecycle separately and migrate it consumer by
   consumer with ordering/conflict tests.
5. Refactor Compactor transitions, caption-worker phases, and Tidy planning in
   separate changes with workflow-specific regression coverage.

Keep entry files responsible for registration, list feature assets in dependency
order, preserve IIFE instance guards, and clean up owned effects. Reuse hub APIs
and shared visual primitives. Keep SQLite ownership in DirtyPlugins, Python
dependencies in the standard library, and browser code served without a build.
Use manifest version bumps for user-visible changes when implementing the work.

## Verification performed for this review

Inventoried first-party sources, measured JavaScript function spans using the
installed TypeScript parser, parsed all 16 Python plugin files with the local
Python interpreter, and inspected representative behavior/contract tests.
No application tests, typecheck, performance benchmarks, or live Stash operations
were run for this documentation-only review. The suggestions above are proposed
refactors, not claims that those workflows currently fail. Existing code and
working-tree changes were left intact; this review adds only `analysis.md`.
