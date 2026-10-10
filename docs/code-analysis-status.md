# Code analysis implementation status

Updated: 2026-10-10

## Scope and decisions

- Implement the [2026-10-10 code analysis](C:/Users/FABIO/.codex/visualizations/2026/10/10/01a12552-c133-7363-8eeb-0b7f360512cd/code-analysis.md),
  reviewed against commit `27e810f`.
- Keep code clean and performant; do not preserve obsolete compatibility paths.
- Keep this document current with completed work, validation evidence, and remaining tasks.

## Current progress

- [x] Read repository architecture, build, and testing guidance.
- [x] Check the starting working tree: clean.
- [x] Locate and read the implementation plan from the path supplied by the user.
- [x] Verify the complete repository suite against the implemented first batch.
- [x] Turn the plan into the checklist below and start the first correctness batch.
- [x] Complete backend batch 2, including fresh ownership/filter checks against isolated Stash.
- [x] Complete all seven implementation batches and findings 1–16.
- [x] Final combined suite, isolated acceptance, real browser review, package contents and native package installation.

## Implementation checklist

### Batch 1: workflow and state correctness (complete)

- [x] Finding 1: immutable manual Tidy previews and exact confirmation identity.
- [x] Finding 2: targeted, generation-safe hub reloads that preserve edits and custom workflows.
- [x] Finding 3: consistent Rank read snapshots and per-performer revision guards.
- [x] Finding 4: metadata-based numeric validation before autosave.
- [x] Finding 7 (atomic publication): apply each accepted Rank response once and notify once.
- [x] Finding 7 (selective invalidation): retain unaffected category/cohort score and rank caches.
- [x] Finding 16 (test groundwork): component identity, Object.is comparisons, unsettled-loop
  errors, and virtual-source cache identity.
- [x] Focused regressions, complete suite, affected isolated fixtures, and release documentation.
- [x] Lower-priority build-test portability: copy installed dependencies if junction creation
  is prohibited. The first full check reproduced the report's Windows `EPERM` issue.

### Batch 2: backend efficiency (complete)

- [x] Finding 8: Captions connection reuse, bounded queue reads, and measured unchanged scans.
- [x] Findings 9–10: Compactor ordinary reads and targeted file ownership checks.
- [x] Finding 11: Extractor batched selection reads and per-run FFmpeg configuration.
- [x] Focused concurrency/count regressions, complete suite, isolated Stash checks, and release documentation.

### Batch 3: frontend responsiveness (complete)

- [x] Findings 5–6: Stats chart lifetime, memoized widget results, and resource reconciliation.
- [x] Finding 7 (remaining): confidence-summary reuse and measured score rebuilds.
- [x] Multiscreen stable subscriptions, Growth daily aggregation reuse, and Captions status polling.
- [x] Final complete-suite and isolated-fixture validation, measurements, and documentation.

### Batch 4: subprocess reliability (complete)

- [x] Finding 12: contain quality samples, bounded/cancellable packet scans and marker extraction.
- [x] Synthetic child hangs/failures/cancellation and Windows parent termination regressions.
- [x] Focused regressions and isolated Compactor/Extractor acceptance.
- [x] Final complete-suite validation alongside the remaining batches.

### Batch 5: build and maintenance (complete)

- [x] Findings 14–15: shared package inputs, source/output containment, recoverable promotion.
- [x] Disposable fixtures: shared-source history/hash changes, ignored artifacts, unsafe paths,
  valid nested assets, byte-identical failed output, promotion/restoration failures and recovery.
- [x] Collision-resistant, exclusively reserved storage backups and contextual schema shape diagnostics.
- [x] Complete-suite validation, package build and native package installation.

### Batch 6: bounded library work (complete)

- [x] Finding 13: Rank paginated complete populations/coalesced requests/settings separation,
  bounded preferred marker queries preserving rating ties and earliest-marker order.
- [x] Finding 13: Multiscreen independent bounded page continuation, shared in-flight requests,
  complete selections, reproducible split assignments and per-page random permutations.
- [x] Finding 13: Stats display edge budget with strongest-first spanning forest, visible
  hidden counts and complete collaborator totals.
- [x] Focused regressions: 1,201 Rank performers, 1,001 contextual/selected playback items,
  bounded retained pane queues, page failures/retries/unmount, and 499,500 graph connections.
- [x] Isolated Rank fixture: actual compiled media queries preserve tied/null ratings and
  choose the earliest marker across tied scenes; exact served bundle and unchanged media.
- [x] Full suite, remaining isolated fixtures, browser review and release packaging.

### Batch 7: remaining behavior-preserving cleanup (complete)

- [x] Tidy strategy-specific snapshot fields, per-plan path caches and per-scene template values.
- [x] Cohesive extractions: Rank media queries and Multiscreen pane navigation.
- [x] Reconcile TODO entries with completed fixes and actual capture masking.
- [x] Quality-sample encoder/metric CPU budget measurements and implementation.
- [x] Finding 5 (full Origin): incremental map updates, one registration and retained interaction state.
- [x] Final Tidy focused/isolated validation and combined suite/package build.

### Follow-up: Rank score updates after votes (complete)

- [x] Retain grouped comparison sums and update only accepted performers' contributions.
- [x] Preserve exact score/tie behavior, snapshot/settings resets and atomic publication.
- [x] Compare work counts and timings for several categories, then run the combined suite and acceptance.

The existing cold rebuild remains exact. This follow-up targets the repeated rebuild
after a vote; library/settings resets still need a fresh complete comparison population.

### Follow-up: Rank cold comparison weights and responsive preparation (complete)

- [x] Factor ordinary logistic comparisons into shifted weights computed once per rating.
- [x] Prepare complete cold indexes in bounded browser tasks; coalesce shared work and cancel obsolete pools.
- [x] Gate Overall leaderboard/native sorting until scores are complete and compare retained sort values.
- [x] Verify ties, extreme ranges, numeric boundaries and incremental parity.
- [x] Measure cold work/timings and run complete-suite, isolated/browser and package acceptance.

No score formula changes or approximations were introduced. Extreme spans retain the
stable direct expectation calculation to avoid overflowing/underflowing weights.

## Validation

Requested follow-up: caption loading is silent in every native player, including
Multiscreen panes. The loading message is removed; extraction, track attachment,
warnings and answered-error retry controls retain their behavior. Pending-request
and repeated unanswered-request regressions now require no visible loading text.
Release build, strict TypeScript, all three caption JavaScript suites and bundle
budgets pass. Captions' bundle shrinks by 56 bytes to 14,568 bytes. The final
combined suite below includes this follow-up; focused regressions
cover pending requests, all five retries, successful attachment and cleanup.
Formatting and `git diff --check` pass. All eight refreshed packages pass content,
identity/checksum checks and native installation in disposable Stash. Logs:
`.build/code-analysis-caption-check.log` and `.build/code-analysis-caption-package.log`.

Rank incremental scoring follow-up:

- The retained index uses one group per distinct normalized rating, with performer
  membership, counts and expected comparison sums. An accepted vote removes/adds
  only changed contributions before publishing fresh immutable scores. Work is
  O(changed performers × rating groups + rating groups log rating groups), with
  O(performers + rating groups) retained storage. No pairwise matrix is retained.
- Bulk updates rebuild when repeated adjustments would cost more; snapshots,
  settings changes and refreshed reference populations also rebuild. The exact
  tied-position/strength formula and neutral unrated/singleton scores are preserved.
- The 1,200-distinct-rating regression requires fewer than 7,200 exponentials for
  two accepted updates versus 719,400 for the earlier direct-pair cold calculation.
  It verifies complete pair publication before listeners, immutable prior scores,
  unaffected category/cohort identity and zero work for stale/repeated replies.
  Another regression compares 1,000 successive updates with fresh exact results,
  including ties, additions/removals, clamping, invalid ratings and empty populations.
- These earlier local Node medians use seven measured samples after two warmups. Both
  policies use the same evaluator; only the changed category rebuilds in the former
  policy, and all other cached categories stay warm. Timings include accepted state
  publication and score lookup, and are synthetic measurements rather than live
  browser/library latency guarantees. Reproduce with `node tests/benchmark_rank_updates.js`.

  | Performers | Cached categories | Former vote rebuild (ms) | Retained sums vote (ms) |
  | --- | --- | --- | --- |
  | 250 | 1 | 0.884 | 0.173 |
  | 250 | 3 | 0.658 | 0.082 |
  | 1,000 | 1 | 7.908 | 0.305 |
  | 1,000 | 3 | 7.363 | 0.248 |
  | 3,000 | 1 | 61.292 | 0.513 |
  | 3,000 | 3 | 61.600 | 0.488 |
  | 5,000 | 1 | 167.474 | 0.684 |
  | 5,000 | 3 | 206.235 | 0.753 |

- Before cold weight reuse/chunking, 5,000 performers and three cached categories
  took 618.665 ms locally. The cold follow-up below records the current implementation.
- Isolated Stash passes exact served release assets, bounded preferred-media queries,
  seeded rating/undo and unchanged media/identities/native metadata. Browser acceptance
  warms Overall scores, records a tie and undoes it, restores both ratings and reports
  no console warnings/errors. Masked proof: `.build/code-analysis-rank-followup-browser.png`.
- All eight rebuilt release packages pass exact contents, identities/dependencies,
  checksums and native installation/backend execution in disposable Stash.
  Logs: `.build/code-analysis-rank-followup-test.log`,
  `.build/code-analysis-rank-incremental-benchmark.log`,
  `.build/code-analysis-rank-followup-stash.log` and
  `.build/code-analysis-rank-followup-package.log`.

Rank cold scoring follow-up:

- Ordinary spans compute one shifted exponential weight per distinct rating, then
  evaluate the same exact logistic probability as a ratio of weights. Weight spans
  above 512 Glicko scale units retain direct stable probabilities; close pairs at
  extreme absolute ratings never collapse into underflowed zero weights.
- A shared generator preserves the comparison/addition order for synchronous and
  asynchronous callers. Browser preparation yields after at most 32,768 comparisons
  through MessageChannel and releases both ports after completion or cancellation.
  Grouping, sorting and final publication remain linear/log-linear work outside the
  comparison batches. No worker asset, runtime dependency or pairwise matrix is added.
- Overall leaderboards and native overall sorting wait for complete scores. Cache
  preparation coalesces matching callers, cancels obsolete pools when states change,
  retries against current data, and retains unrelated work. An unmounted route cannot
  update its UI; shared valid preparation may finish warming the domain cache. Warmed
  votes remain immediately ready. Overall ordering calculates each performer's pool
  once, then compares retained values instead of recalculating inside sort comparisons.
- Seven new regressions pass: shifted/tied/boundary/extreme numeric parity, exact
  synchronous/asynchronous addition order, bounded yielding, cancellation/port cleanup,
  coalescing plus a mid-calculation accepted vote, refreshed populations, native
  loading/unmount/warm updates, and normalized pool reads during sorting. Existing
  1,000-update parity, stale reply and atomic publication regressions still pass.
- Local Node medians below use seven measured samples after two warmups. The
  direct-pair policy forces one exponential per pair in the same evaluator/batch
  machinery; it is a mathematical policy comparison, not the original commit's entire
  domain implementation. Asynchronous time includes scheduling. Longest-task medians
  include initial grouping/sorting and final publication as well as comparison batches.
  These are synthetic measurements; reproduce with `node tests/benchmark_rank_cold.js`.

  | Performers | Categories | Direct pairs (ms) | Weights sync (ms) | Weights async (ms) | Longest async task (ms) |
  | --- | --- | --- | --- | --- | --- |
  | 250 | 1 | 0.603 | 0.199 | 0.212 | 0.209 |
  | 250 | 3 | 1.613 | 0.570 | 0.575 | 0.244 |
  | 1,000 | 1 | 9.038 | 2.534 | 3.140 | 0.410 |
  | 1,000 | 3 | 25.539 | 7.239 | 8.123 | 0.398 |
  | 3,000 | 1 | 74.943 | 22.571 | 23.813 | 1.364 |
  | 3,000 | 3 | 253.193 | 79.246 | 84.400 | 1.154 |
  | 5,000 | 1 | 230.909 | 68.733 | 74.916 | 1.468 |
  | 5,000 | 3 | 710.917 | 225.075 | 234.789 | 1.846 |

- The standalone real-browser fixture runs the authored scoring module with 5,000
  synthetic ratings across three calculations. Two complete runs preserve weighted
  score checksums and record 48/43 browser timer heartbeat ticks while calculating.
  Totals are 188.7/158.6 ms, longest measured tasks 10.20/2.40 ms, with 1,143 task
  yields each. An active calculation cancels without publishing partial scores,
  then restarts successfully. Console warnings/errors are empty. This verifies the
  scoring module in a browser, not a 5,000-profile native Stash library.
  Proofs: `.build/code-analysis-rank-cold-browser.png` and
  `.build/code-analysis-rank-cold-cancel.png`.
- Isolated Stash serves the exact new release bundle and passes preferred-media
  queries, rating/undo and unchanged media/identities/native metadata. Its browser
  renders Overall standings after preparation and applies native Overall score
  ordering to all nine synthetic performers without console warnings/errors.
  Synthetic proof: `.build/code-analysis-rank-cold-native.png`.
- All eight release packages pass identity/dependency/path/checksum checks and native
  installation/backend execution in disposable Stash. Rank remains at its single
  1.0.5 release bump. Logs: `.build/code-analysis-rank-cold-test.log`,
  `.build/code-analysis-rank-cold-benchmark.log`, `.build/code-analysis-rank-cold-stash.log`
  and `.build/code-analysis-rank-cold-package.log`.

Final combined acceptance:

- `npm test` passes the release build, strict TypeScript and formatting checks,
  all 43 JavaScript test files (70 reported Node tests, zero failures/skips), and
  all 259 Python tests (61.959 seconds). `git diff --check` passes.
- Final Tidy and Compactor isolated Stash fixtures pass, including actual strategy
  fields, immutable previews, automation, thread-limited encoding, review/replacement,
  targeted ownership, unchanged original bytes and native metadata. Earlier affected
  hub/Rank/Captions/Extractor/Multiscreen fixtures also passed their respective batches.
- Origin's real browser map retains the same ECharts instance and visible zoom after
  selecting France and enabling country counts. Autosave succeeds, counts are correct
  and console warnings/errors are empty. Chart regressions also cover theme changes,
  remount registration and zoom/center retention in the real ECharts renderer.
  Synthetic capture: `.build/code-analysis-origin-browser.png`; performer cards are hidden.
- `build_site.sh _site/code-analysis` passes with the installed Git Bash. All eight ZIPs
  pass source/build identity, dependency, path, checksum and exact staged-content checks.
  Native Stash package installation into an empty disposable plugin directory passes:
  all eight versions/bundles load, installed files equal ZIPs plus Stash's manifest,
  and hub/Rank/Compactor backends run with their generated metadata modules.
- Final release JavaScript totals 1,422,280 bytes (+14,518 from the report's baseline).
  Rank measures 117,950 bytes (+2,875 for cold weight reuse, cancellable task preparation
  and UI readiness), within its remeasured 121 KiB budget (5% rounded to whole KiB).
  Multiscreen measures 27,062 bytes (+3,187); its documented 28 KiB budget covers
  bounded queues, coalescing/abort, reproducible permutations and retry feedback.
  The other six existing budgets pass unchanged. No runtime dependencies were added.
- Logs, synthetic screenshots, fixture databases and package output stay ignored in
  `.build/` and `_site/`. All temporary Stash processes/browser tabs are closed.
  The live installation and real library remain untouched; changes are uncommitted.

Batch 7 focused validation:

- All 50 Tidy tests pass. A three-file scene retains identical planned operations,
  computes scene metadata once and resolves each root once per plan. The next plan
  recomputes paths. GraphQL fields follow only enabled templates/required Stash IDs;
  identities, file paths/basenames and scene labels remain mandatory. Execution's
  fresh filesystem/identity checks and immutable reviewed-plan authorization remain.
- The three-file/two-root case drops path normalizations from 42 for uncached operations
  to 15 for the complete cached plan, with identical operations. The isolated four-scene
  strategy snapshot shrinks decoded compact JSON from 1,417 to 833 bytes (about 41%).
  These are synthetic work counts/payload measurements, not compressed transport sizes.
- All 59 Compactor backend tests pass, including explicit encoder/decoder/filter/VMAF
  budgets and one/two/three-worker limits according to CPU count. A final benchmark
  repetition of the actual implementation confirms the earlier measured direction.
- Quality measurements on 16 logical CPUs use a generated 24-second 720p/25fps
  source and three four-second samples, with two repetitions per configuration.
  Median automatic → bounded (wall seconds / child CPU seconds): one worker
  3.580 / 25.625 → 3.813 / 22.907; two workers 3.060 / 28.422 → 3.401 / 24.750;
  three workers 2.712 / 31.329 → 2.808 / 26.485. The three-worker bounded policy
  uses about 15% fewer child CPU seconds with about 4% more elapsed time locally.
  Samples' VMAF differences were below 0.18 points; encoder thread limits can
  change encoded bytes, so SEARCH_VERSION is incremented to 3. These are synthetic
  local measurements, not hardware/general-library performance guarantees.
- Retain up to three workers; cap by CPU count, divide encoder/VMAF threads among
  them and limit each decoder/filter pipeline to one thread. Hardware encoders can
  have their own internal scheduling; these are FFmpeg limits, not process affinity.
  `python -B tests/benchmark_compactor_quality.py 2` reproduces the comparison.

Batch 5 focused validation:

- The disposable build pipeline fixture passes shared-helper hash/history/date changes
  for all eight plugins, ignored SQLite/WAL/backup/bytecode identity checks, six unsafe
  install paths, valid nested assets, all-file preservation after failure, promotion rollback,
  restoration failure retaining a usable backup, and recovery on the next invocation.
- Schema shape regressions pass with plugin/key context for null constants, malformed
  settings and malformed options. Backups reserve unique targets exclusively; two backups
  at one timestamp retain different settings, and explicit existing paths are rejected.

Batch 6 focused validation:

- Rank requests 1,201 performers in three 500-row requests with one compatible shared
  promise; complete results remain available for global ratings. Settings refresh adds no
  library request. Native route entry refreshes; explicit invalidation discards cached and
  stale in-flight publication. Media caches are invalidated with library refreshes.
- Preferred manual media makes at most two requests, each requesting one row; autoplay
  makes one. A native isolated fixture runs the compiled module with tied scene ratings
  and null ratings and verifies the earliest marker selection in both cases.
- Multiscreen traverses 1,001 contextual items and all 1,001 explicitly selected items.
  Each pane retains one queue bounded by its page size (at most 240); unchanged panes
  retain subscriptions. Failed pages retain current playback, retries succeed, unplayable
  initial pages are skipped, and unmount aborts pending continuations. Random permutations
  are bounded per page and repeatable so split assignments remain consistent.
- A synthetic 1,000-performer complete graph reports 499,500 connections, displays 5,000,
  and reports 494,500 hidden. Every performer retains 999 collaborators; the displayed
  graph remains connected. A weak bridge is retained ahead of redundant strong links.
  Aggregation still enumerates cast pairs; the edge budget bounds force-layout input.
- Final combined `npm test` passes 59 reported Node tests and 255 Python tests,
  strict TypeScript, formatting and release builds. A transient Windows promotion
  lock reproduced during the first full run; bounded rename retries now pass a
  fault-injection test before falling back to the existing rollback/recovery policy.
- Multiscreen's new continuation/retry behavior adds 3,187 release bytes relative
  to the recorded 23,875-byte baseline: 27,062 bytes, with a documented 28 KiB
  budget (five percent rounded up). All other bundle budgets remain unchanged.
- Isolated Multiscreen verifies actual compiled bounded queries and seeded random
  continuation with no duplicate pages. The Stats fixture and real browser verify
  the All-performers control, exact total/shown counts, a rendered ECharts graph,
  successful autosave and no console warnings/errors. Synthetic capture:
  `.build/code-analysis-constellation-browser.png`. Both fixtures preserve media
  bytes/native metadata and have been stopped/cleaned up.

Batch 4 validation:

- Eight synthetic process tests pass, including real Windows forced parent termination
  for all three runners. Each contained child exits when its parent loses the job handle.
  Silent streams cannot block timeout or callback cancellation. Successful and failed
  diagnostics are bounded; marker callbacks can cancel before publishing output; every
  ordinary failure reaps its child before deleting the partial file.
- All 56 existing Compactor backend tests and all 14 Extractor tests pass. A ninth
  regression covers cancellation discovered inside the final preview scene's packet scan.
- Isolated Compactor and Extractor fixtures pass real encoding, replacement/ownership,
  clip boundaries/collisions/cancellation, exact served bundles and media preservation.
- Quality diagnostics retain at most 64 KiB. Packet aggregation retains only the sum
  and bounded line fragments. Marker diagnostics retain twenty lines of at most 4 KiB
  each. Their existing, separate runner contracts remain separate.
- Quality samples retain a 900-second deadline; packet scans have a 120-second deadline
  and preview/run cancellation callbacks. Marker deadlines scale with clip duration
  (minimum 120 seconds, twenty times duration, maximum 3,600 seconds). Marker encoders
  stop before temporary-output cleanup. A forced Python termination cannot execute
  cleanup, so existing partial files/reservations can remain; their encoder is contained.
- Compactor and Extractor retain their single 1.0.5 release bump. Runtime README/release
  notes explain the deadlines and forced-cancellation limits.

Batch 3 validation:

- Final `npm test` passes: release build, strict TypeScript, formatting, all 41 JavaScript
  test files (56 reported Node tests), and all 245 Python tests. `git diff --check` passes.

- Seven new Stats/Rank regressions pass, plus updated Multiscreen and Captions UI suites.
  They cover unrelated-render aggregate reuse, theme/options updates on one chart instance,
  map registration/resize and retained zoom/pan, per-key request lifetime/pruning, shared
  Growth capacity, removed/replaced/unmounted responses, period-selection aggregate reuse,
  confidence revision/settings/population changes, and tied/extreme score parity.
- Multiscreen marker advancement retains the other pane's exact observer/listener/callback
  identities and uses current navigation. Only the replaced marker mounts new subscriptions.
  Marker/video and audio observers remain separate because marker observation is conditional
  on a playback range while audio observation always runs.
- Caption polls spanning multiple three-second ticks still publish, never overlap, clear
  recovered errors, and cannot publish after unmount. Existing action-vs-poll guards pass.
- The manual Rank benchmark uses seven samples per size in Node's normal realm. Against
  `27e810f`, median cold rebuilds were 2.516 → 1.002 ms (250), 25.685 → 8.351 ms (1,000),
  93.430 → 67.058 ms (3,000), and 270.079 → 192.210 ms (5,000). Warm 10,000 lookups remained
  7–10 ms. These are synthetic local timings, not browser/library latency guarantees.
  `node tests/benchmark_rank_scores.js 27e810f` reproduces the comparison. Every distinct
  rating pair now uses one logistic evaluation; the algorithm remains quadratic. Larger
  population rebuilds can still exceed a frame budget; incremental/worker work remains a
  measured follow-up rather than changing the rating formula in this batch.
- Isolated Stats, Multiscreen, Rank, and Captions acceptance fixtures pass with exact served release
  bundles, synthetic media, and unchanged scene/file/performer metadata. Stats browser checks
  pass on real ECharts: four canvas charts retain the same DOM instance IDs after title edits,
  a display-option change, and keyboard reorder. No console warnings/errors were reported.
  The masked synthetic capture is ignored `.build/code-analysis-stats-browser.png`.
- Stats 1.0.6 and Multiscreen 1.0.5 are bumped once; Rank stays 1.0.5 and Captions stays 1.0.6
  across these uncommitted batches. README versions and release notes are updated.

Batch 2 validation:

- The same 1,000-scene unchanged synthetic scan measured 2,041 SQLite connections /
  7.1961 seconds before the change and 18 connections / 0.0731 seconds afterward.
  Both runs made 11 fake GraphQL requests, skipped all scenes, and made no probes or
  media accesses. These are single local samples, not live-library latency claims.
  `tests/benchmark_captions_index.py` repeats the current workload; the regression
  asserts connection/query counts rather than timings.
- Captions focused suite passes all 40 tests, including a 250-record queue drained
  in batches of 100/100/50, newer revisions retained during processing, and a
  cancellation committed through another connection after a page fetch.
- Four Compactor storage tests pass: established reads issue only SELECTs, reads
  succeed while another connection owns the writer lock, polling overlaps real Rank
  votes/settings saves/caption heartbeats, and concurrent run claims/CAS stay exclusive.
- A 200-poll synthetic Compactor sample went from 200 `BEGIN IMMEDIATE` statements
  and 200 DDL statements to zero of each. Standalone times were 0.6301 seconds
  before / 0.6627 seconds after; the improvement removes writer contention rather
  than reducing single-reader latency. The concurrent-writer regressions pass.
- All 56 Compactor backend tests pass and cover additional owners after preview, during encoding,
  and between commit checks, plus native rule changes and attachment transfer during
  revalidation. Every case retains the original media bytes.
- All 14 Extractor backend tests pass. A 1,000-scene selection makes forty requests;
  response order, missing IDs, mixed/duplicate selections, collision behavior,
  multiple marker failures, cached configuration failures, and dry runs are covered.
- Isolated Stash 0.31.1 proved that explicit `findFiles(ids: ...)` bypasses the
  accompanying filter. The implemented scene ID criterion plus
  `files_filter.scene_count` correctly combines both conditions and sees ownership
  changes immediately. No library-wide enumeration remains in revalidation.
- Extractor uses 25 scene criteria per request rather than the report's proposed
  100-ID lookup: both Stash `ids` and `scene_ids` reject a whole batch containing a
  missing scene, and a 100-term OR filter overflows its SQLite parser. The 25-term
  filter passed 1,000 requested IDs with only one still present; all 999 missing
  IDs, duplicate selection, and the mixed marker/image results remained ordered.
  Marker/image batches stay at 100. No failed-query or retired-API fallback is retained.
- Compactor's winning-rule checks also put the scene ID inside `scene_filter` so
  native criteria and search apply. The ownership request verifies the expected
  attachment set again, including transfer to another owner during revalidation.
- Captions, Compactor, and Extractor isolated Stash acceptance fixtures all pass.
  These use synthetic media and separate temporary databases/random ports. They
  cover indexed playback/forced errors/Scan deduplication, output review/replacement
  and native rule matching, and mixed selections/collisions/cancellation. Original
  bytes and scene/file metadata are retained where the workflows require them.

Dependency installation: `npm ci` passed after a network-capable retry. The initial
sandbox attempt could not resolve `registry.npmjs.org`.

- Final `npm test` passes: release build, strict TypeScript, formatting, all 39 JavaScript
  test files (49 reported Node tests), and all 245 Python tests. The test output is kept in
  ignored `.build/code-analysis-test.log`.
- The first full check reproduced the junction restriction. Fixture checkouts now stay
  under `.build/` and copy installed dependencies when junction creation is prohibited.
  Python tests use workspace-local `TEMP`/`TMP` because the sandbox's system temporary
  directories deny access to child processes. Final check command:

  ```powershell
  $env:TEMP = Join-Path (Get-Location) '.build'
  $env:TMP = $env:TEMP
  npm test
  ```

- The eight new hub settings regressions pass: invalid numeric input, unrelated events,
  pending flush, revert during an in-flight write, out-of-order reads, edits during reload,
  disposed route responses, and custom-panel ownership of dirty state. Custom-panel workflow
  preservation is also covered by the combined hub test.
- Focused Rank JavaScript and Tidy source tests pass, including 48 Tidy Python tests.
- Isolated Tidy and Rank Stash fixtures pass, using synthetic media and temporary databases.
  Tidy confirms preview A after preview B, skips unseen files, preserves bytes/IDs/metadata,
  and still applies approved automation to future scenes. Rank passes record/undo and served
  bundle/identity checks. The all-eight-plugin hub fixture also passes its backend checks.
  The sandbox blocks loopback sockets; these fixtures passed with the network-capable runner.
- Browser checks on the updated hub pass: no initial false dirty warning, visible feedback
  for screen counts 37 and 1.5, successful autosave of the valid boundary 36, matching backend
  readback, and no browser console errors. Broader live-library/UI acceptance remains separate.
- Current release JavaScript: 1,410,875 bytes, +3,113 from the report's baseline. All existing
  per-plugin budgets pass without increases.

## Implementation notes

- Tidy's existing digest identifies the ready operation set plus regular-file stat
  fingerprints. Reviewed records are keyed by that digest and never replaced with another
  preview's operation set. Manual tasks now require `expectedPlanDigest`; no old task
  fallback is retained. Automation remains strategy-based.
- Hub reloads retain the mounted custom panel. Ordinary saves merge only explicitly edited
  fields into the current configuration and retain field intent across in-flight reverts.
  Valid pending edits flush before a same-plugin reload; invalid raw edits remain visible.
- Rank snapshots begin short deferred transactions. Accepted response pairs update the
  shared index before one notification; React updater callbacks perform no store writes.
- Captions owns one read connection per worker and closes it on every exit. Reads do
  not begin a scan-wide transaction; state/queue writes retain immediate atomic updates
  and revision-conditional deletion. Queue limits and page keys are applied in SQL.
- Compactor initializes its table only when absent. Established reads are ordinary
  SELECTs, materialized before closing the connection/decoding JSON. Writes, run
  claims, and decisions retain immediate transactions and revision guards.
- Extractor preserves selection order after bounded requests. One run owns its
  lazily resolved FFmpeg path or configuration error; each failed clip still has
  its own result, and dry runs never resolve the executable.
- DirtyPlugins, DirtyRank, and DirtyTidy are bumped once to 1.0.5; README versions and release
  notes are updated. Batch 2 bumps Compactor and Extractor to 1.0.5 and Captions to 1.0.6.
  The hub stays at its single 1.0.5 bump across these uncommitted batches.

## Remaining work

The report's implementation batches are complete in source, release staging and verified local
packages. No obsolete API/task-layout compatibility was retained. DirtyTidy manual previews made
before this update must be regenerated. Plugin versions are bumped once for this release:
Captions/Stats 1.0.6, the other six plugins 1.0.5.

Separate product decisions remain in TODO: Tidy empty hierarchy semantics and case-only renames,
Extractor's marker fallback duration, Multiscreen close navigation, and unused Rank persisted
fields. Removing stored fields still requires the prescribed read-only data check; no existing
stored data was removed. Tidy continues to return its complete immutable reviewed preview.

Rank's exact comparison count and Stats' cast-pair aggregation remain quadratic. Rank now
yields cold comparison batches and updates warmed score sums after accepted votes. Larger
populations, changed-pool confidence simulations and Stats worker aggregation still need
measurements before further changes. Broader live-library/browser/theme coverage
and publishing/installing this release remain separate from the completed synthetic acceptance.
