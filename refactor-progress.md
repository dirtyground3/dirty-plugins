# Readability refactor handover

Branch: `codex/readability-refactor` (created from `main`, 2026-10-03).
Scope: implement A01-A14 in `analysis.md` in numerical order. A11 is integrated
into the feature work and completed with a final contract audit.

## Current checkpoint

All A01-A14 tasks and all six smaller improvements are complete (2026-10-04).
No work is running in the background.
The user authorized merging the tested working tree into local `main` on
2026-10-04. The integration includes the pre-existing Compactor/Tidy edits listed
below, which were the refactor baseline. Nothing has been installed into live Stash.

Final `npm test` passes: typecheck, 24 JavaScript suites and Python discovery
(272 entries: 270 passed, 2 duplicate Node invocations intentionally skipped).
The additional unused-symbol audit for checked feature modules and
`git diff --check` also pass. No live installation or browser checks were run.

Only mark a task complete after its implementation and relevant checks pass.
Record partial work and failing commands here before handing off.

| Task | Status | Implementation / verification |
| --- | --- | --- |
| A01 Rank components/controllers | Complete | Four hook-free settings sections; pure validation in settings module; battle-session hook; manifest loading and typed section props. Rank behavior/algorithm/registration tests and 51 Python Rank tests passed. |
| A02 Shared settings saving | Complete | Generic typed controller used by hub, Rank, Stats, Compactor; immutable hub snapshots; explicit per-consumer conflict policies. New queue/debounce regression tests. |
| A03 Stats paginated loading | Complete | Typed Stats-local fetchAllPages/usePageLoad; all 13 views and dashboard migrated; bounded card option and cancellation regression tests. |
| A04 Stats chart lifecycle | Complete | Chart lifecycle hook owns observers/listeners/disposal; 10 option builders; map resize and Growth zoom preserved; cleanup/setup-failure regression tests. |
| A05 Hub responsibility modules | Complete | Debug, transport/settings, React/dialog, theme and native factories; preserved API/registration order; hub behavior, assets and 52 UI contracts passed. |
| A06 Python transport/protocol | Complete | Configurable shared transport; common injectable reporter/JSON/UTF-8 helpers; all seven entry scripts retain envelopes and exit codes. Full 267-test Python suite passed; new protocol/transport tests passed. |
| A07 Extractor planning/execution | Complete | Explicit options/plan/operation contracts; settings normalization, per-item planning, execution, progress accounting and formatting separated; directory creation deferred to execution; shared collision decision. Extractor tests passed. |
| A08 Compactor handlers/transitions | Complete | Named dispatch handlers/router; explicit run/operation journal shapes and transitions; expected-state/CAS persistence helper; named stopped-preview reconciliation. All 51 Compactor tests passed. |
| A09 Tidy destination planning | Complete | Pure folder/filename rendering and final destination validation return named results; orchestration preserves warning/status precedence and plan hashes. All 44 Tidy tests passed. |
| A10 Caption worker phases | Complete | Explicit WorkerContext, pending batches, full scan, outcome accounting and atomic lease completion; all 36 caption-index regressions passed. |
| A11 Typed feature contracts | Complete | Typed settings, matchmaker pools/pairs/confidence/selection signatures, Stats builder inputs, Compactor rules/media/automation, Tidy operations, save/data/chart/jobs and hub factories. Native React/Stash/ECharts boundaries remain explicit. Typecheck passes. |
| A12 Job completion interpretation | Complete | Shared pure completion helper and bounded replay tracker; Tidy, Captions and Compactor migrated; pure helper and consumer regressions passed. |
| A13 Metadata/parity fixtures | Complete | Stats registry owns routes/labels/order/widgets; hub metadata owns Multiscreen defaults/order/bounds. Shared Rank normalization and Compactor bitrate/resize/preset fixtures pass in JS and Python. |
| A14 Test runner/harness | Complete | Dependency-free discovery and combined runner; failure propagation tests; shared element/event helpers; direct transport/session factory tests replace source slicing and queue-name assertions. Typecheck, all 24 JS suites and Python discovery pass. |
| Small readability improvements | Complete | All six implemented and verified: Compactor workflow statements, vertical Stats exports, Rank descriptors, factory indentation, Extractor collision helper and shared Rank image CSS. |

## Baseline and ownership

The branch includes pre-existing uncommitted work. Preserve it; do not reset,
stash, or mistake it for changes made by this refactor. Initial modified files:

- `README.md`
- `plugins/DirtyCompactor/{README.md,dirtyCompactor.js,dirtyCompactor.yml,dirtyCompactorRules.js,dirty_compactor.py,dirty_compactor_rules.py}`
- `plugins/DirtyTidy/{README.md,dirtyTidy.js,dirtyTidy.yml,dirty_tidy.py}`
- `tests/{test_dirty_compactor.js,test_dirty_compactor.py,test_dirty_tidy.py,test_dirty_tidy_automation.js}`

Initial untracked files: `analysis.md` and
`plugins/DirtyCompactor/dirty_compactor_quality.py`.
No live plugin installation, media processing, or publishing has been performed
for this refactor. Git integration preserves the complete tested working tree.

## Verification log

- `npm ci`: passed.
- Baseline `npm run typecheck`: passed.
- Baseline all 16 `tests/test_*.js` suites: passed.
- Baseline Python discovery: 267 tests passed.
- A01: typecheck, Rank algorithm/media/registration suites and 51 Python tests passed.
- A01: all 52 shared UI contracts passed after checking the full settings feature.
- A02: typecheck, all 16 existing JS suites and 52 shared contracts passed. New
  controller test also checks debounce, queue ordering, stale completion,
  validation, failure recovery and disposal.

## Rules for the next model

Read `AGENTS.md`, `analysis.md`, this file, and `git diff` before continuing.
Use manifest-ordered guarded IIFEs, explicit feature factory dependencies,
shared GraphQL/UI APIs, and standard-library Python. Preserve dirty-setting
protection, write ordering/revisions, Tidy confirmation, caption index leases and
fingerprint fast paths, and Compactor journals/recovery. Keep tests meaningful;
update source-based contracts for moved code without dropping their guarantees.
Update this checkpoint and verification log after each task.

- A03/A04: Stats behavior/dashboard/data/chart tests, assets, typecheck and 52 shared contracts passed.
- A11/A14 (2026-10-04): `npm test` passed: typecheck, 24 JavaScript suites and
  Python discovery (272 entries, 270 passed, 2 duplicate Node invocations skipped).
  `git diff --check` passed. No live installation or browser checks were performed.
- Final cleanup (2026-10-04): `npm test` passed again after the final code changes:
  typecheck, 24 JS suites and 272 Python entries (270 passed, 2 duplicate checks
  skipped). The checked-feature unused-symbol audit and `git diff --check` pass.

## Latest verification and implementation notes

- All 24 JavaScript suites passed after the final cleanup, including runner failure propagation,
  direct Rank session and transport factory tests.
- `npm test` passed, including typecheck and all 52 shared UI contracts within
  Python discovery. `git diff --check` passed at the stopping checkpoint.
- A07: all 10 Extractor tests passed after per-item planning extraction.
- A08: all 51 Compactor tests passed after dispatch/transition extraction.
- A09: all 44 Tidy tests passed after destination helper extraction.
- A10: all 36 caption-index tests passed after worker phase extraction.
- New Python protocol/transport tests (2), workflow-boundary tests (2), and
  parity fixture test (1) passed in full discovery. The combined run has 272
  Python entries: 270 pass and 2 Node-invoking Rank tests skip intentionally
  because their suites already passed in the JavaScript stage.

A11's final audit now covers explicit Rank selection/confidence callbacks, Stats
builder inputs and Compactor automation dependencies, and corrects the precision
tier's `label` field. Native Stash/React/ECharts compatibility remains explicit;
incremental `@ts-check` passes without enabling unrelated legacy cleanup.

A14 adds `npm test` for typecheck, all discovered JS suites and Python discovery.
`npm run test:js` and `npm run test:python` remain available independently. The
combined runner skips Python's two Node Rank invocations because they already ran;
standalone Python discovery retains them. Architectural checks still cover shared
GraphQL, registration, successful jobs, filters, UI primitives and manifest order.
The new Rank session suite verifies ordered votes, duplicate prevention, optimistic
undo while recording, stale response protection, failed-record recovery, exit
guards and listener cleanup. Stable element/event helpers are reused by multiple
suites; scenario data and hook simulation remain local. See `tests/README.md`.

All smaller improvements from `analysis.md` are complete:

- Compactor load/save/action state updates and backend workflow records are
  expanded so update, persistence and queue order are visible.
- Stats exports are vertical and grouped by responsibility; the same API members
  remain available.
- Rank numeric controls use named descriptors.
- Rank settings/matchmaking, the shared scene filter, and the new chart/battle
  factories have clear nesting. Template literal content was preserved during
  mechanical indentation.
- Extractor shares its collision decision while retaining separate copy/extract
  handling and the copy same-file check.
- Rank battle/gallery image base declarations share one selector group. Ready,
  hover, native card, capture and reduced-motion overrides retain their behavior.

The final scaffolding review also removed unused Rank busy/counter hooks and
section bindings, obsolete Compactor save refs, and 13 unused backend mode reads.
Rank navigation now belongs to the battle controller: three actions replace
duplicated page handlers and exposed refs/setters. Pending navigation protection
has a direct controller assertion, alongside existing category/cohort/mode tests.
The manifest factories remain explicit responsibility boundaries; no new runtime
dependency, abstraction layer or test framework was added in this final cleanup.

One existing compatibility difference surfaced while designing equivalent Rank
fixtures: a flat array in `categories` gives an extra numeric-key category pool in
browser normalization while the backend falls back to defaults. No runtime change
was made for that difference. Fixtures cover the supported serialized category
map and legacy scalar settings; keep any compatibility fix separately reviewed.

The implementation branch is `codex/readability-refactor`, with local `main` as
the integration target. Preserve the pre-existing edits listed above, and do not
commit generated/runtime artifacts. No task from `analysis.md` remains unfinished.
The compatibility difference noted above predates the refactor and remains
outside its scope.
