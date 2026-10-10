# Dirty Plugins deep-review TODO

Findings from a full deep review (bugs, performance, refactoring) of all
plugins and the shared runtime, verified against the source. The existing
suite passes, so most items below are latent and untested. Items marked
"verified" were reproduced or confirmed by direct reading of the code; the
rest come from per-plugin deep dives and should be re-checked when picked up.

All remaining items are open unless checked. The 2026-10-09 dead-code cleanup
closed or narrowed the items marked below. On
2026-10-10 every item was re-read against the TypeScript source: references now
name the current file and symbol instead of line numbers in the retired `.js`
bundles, and items the code already fixes are checked with the evidence.

## Remaining UI acceptance checks

The shared styling implementation is in place. These acceptance checks are
carried forward from the retired harmony report and implementation plan:

- [ ] Review `tests/fixtures/dirty_suite_harmony.html` in its default, Paper
  Picnic, and Retro Arcade themes. Include busy controls, native/fallback card
  boundaries, and representative safe captures.
- [ ] Finish rendered contrast checks for translucent overlays and chart labels
  across supported themes, plus keyboard-only and reduced-motion checks on
  remaining plugin controls. Main Stats and Rank narrow-width checks already
  passed; the review conventions are in `plugins/DirtyPlugins/STYLE.md`.
- [ ] Complete the remaining live state checks: hub invalid/save feedback;
  FileExtractor and Multiscreen empty/error states; Rank Battle/Gauntlet and
  table interactions; Stats dashboard editing and nested native filters; and
  Tidy invalid/confirmation states. Use tests or safe previews for actions that
  would move files, and keep private media out of captures.

## Manual checks still open

Carried over from the TypeScript migration record and the 2026-10-10
simplification pass. The evidence and the exact reproduction steps are in the
Git history of `docs/build-migration-status.md`, under the named checkpoint.

- [ ] Interactive check of the 2026-10-10 registration and host-binding changes
  in the live Stash: Rank leaderboards, a Stats full page, Tidy preview, a
  Multiscreen launch, Captions playback, the FileExtractor selection action and
  a Compactor preview. Done on 2026-10-10 after installing 1.0.4/1.0.5 there:
  all eight plugins register without console errors, the settings hub shows
  every tab, the Stats dashboard and a Rank battle page render, the served
  bundles equal staging and the hub, Rank, Captions and Stats backends answer.
  The automated suite and all seven isolated Stash fixtures also pass.
- [ ] DevTools breakpoint stepping in a development build (`npm run build:dev`)
  was never verified for any plugin; served source maps and decoded authored
  locations were.
- [ ] Other browser engines, mobile fullscreen and casting are unverified
  (Captions, Multiscreen). ES2020 stays the explicit target.
- [ ] DirtyMultiscreen: the real hidden-tab pause transition, and selections
  spanning several native pages ("DirtyMultiscreen completed").
- [ ] DirtyCaptions: probe recovery after an error and live Stop refresh timing
  on a library larger than the two-file fixture ("DirtyCaptions completed").
- [ ] DirtyTidy: a multi-page preview in real Stash ("DirtyTidy completed").
- [ ] DirtyFileExtractor: stopping a running extraction (`--serve --stop-file`)
  and visual multi-page selection ("DirtyFileExtractor completed").
- [ ] DirtyStats at live-library scale; `npm audit` still reports
  GHSA-fgmj-fm8m-jvvx for ECharts < 6.1.0 (`lines` series only, which Stats
  neither uses nor bundles). An ECharts 6.x upgrade is a separate decision.
- [ ] Optional data follow-ups from the 2026-10-09 cleanup: drop Rank's
  write-only `enabledCohorts` and Stats' persisted theme copy from their
  settings; decide on Rank's `recentBattleIds` column (see R3).

## Compatibility follow-up

- [x] Recheck legacy flat-array `categories` normalization in DirtyRank.
  Checked 2026-10-09: the TS browser code and the backend now both fall back to
  the default categories for a flat array; no numeric-key pool is created.

## High / Medium bugs

- [x] **8. DirtyStats map loses zoom/pan on every interaction** (fixed 2026-10-10)
  - Origin uses incremental option updates and registers its map once.
    Country, label and theme changes retain the chart's zoom/pan; theme changes
    update styles on the mounted instance. Refresh/loading still owns its lifetime.
  - Regression covers country selection, label toggles, theme changes and remount.

- [ ] **9. DirtyTidy Windows/Unicode edge cases** (reported; narrowed
  2026-10-10)
  - Files: `plugins/DirtyTidy/dirty_tidy.py` (`_parse_levels`,
    `exit_code_for`), `plugins/DirtyTidy/dirty_tidy_templates.py`
    (`RESERVED_WINDOWS_NAMES`),
    `plugins/DirtyPlugins/dirty_plugins_protocol.py`
    (`configure_standard_streams`).
  - Fixed: stdin, stdout and stderr are all reconfigured as UTF-8 by the shared
    protocol, so non-ASCII settings survive legacy Windows code pages.
  - Fixed: reserved device names (`CON`, `NUL`, ...) are blocked for hierarchy
    folders as well as filenames.
  - Fixed: an execute run that failed and applied nothing exits nonzero
    (`exit_code_for`), so it no longer looks green in Tasks.
  - Open: `_parse_levels([])` returns `[]`, so with move enabled and all
    hierarchy levels removed files are `ready` to move to the source root. The
    browser now keeps the empty list too and shows "No folder levels"
    (`src/components/FolderStrategy.tsx`); decide whether that is intended or
    should be an invalid setting.
  - Open: a run with some applied and some failed moves still exits 0, and
    there is no journal/undo.

- [ ] **10. DirtyMultiscreen nav escape** (reported; stale-response race fixed)
  - File: `plugins/DirtyMultiscreen/src/components/Route.tsx` (`closeRoute`).
  - Fixed: the scene and marker queries share one hook
    (`plugins/DirtyMultiscreen/src/hooks.ts`) with a request revision guard, so
    a slow older query can no longer overwrite newer results or clear the
    spinner early.
  - Open: `closeRoute` uses `history.back()` whenever `history.length > 1`,
    which can navigate out of Stash entirely.

- [x] **11. DirtyRank screenshot mode uses the wrong query param** (resolved
  2026-10-09: Rank uses the hub's `captureEnabled`; the `censorMedia` alias is gone)
  - It read `censorMedia=1`; the repo convention (AGENTS.md, hub,
    multiscreen) is `docsCapture=1`. Since 2026-10-10 the build rejects both
    parameter names in plugin source, so only the hub parses them.

- [ ] **12. DirtyTidy case handling** (reported; `sourceJobId` part fixed)
  - Files: `plugins/DirtyTidy/dirty_tidy_templates.py` (`_normalized_path`),
    `plugins/DirtyTidy/dirty_tidy.py` (automation claim),
    `plugins/DirtyTidy/src/automation.tsx`.
  - Fixed: `sourceJobId` and the job start time are sent by the browser and
    used for the backend automation claim, which replaced the racy
    localStorage claim.
  - Open: `normcase` makes case-only renames impossible on Windows; case-fold
    duplicates are not detected on macOS.

- [x] **13. DirtyRank rating index can regress to an older revision**
  (resolved; checked 2026-10-10)
  - File: `plugins/DirtyRank/src/domain/rank.ts` (`applyRatingIndex`).
  - It unconditionally replaced the map and set
    `ratingIndexRevision = payload.revision`, so a `loadAll` racing a vote
    could erase the newer state from the UI. It now ignores payloads older than
    the applied revision and keeps the revision with `Math.max`.

- [x] **14. DirtyStats mounts a hidden native performer list on the Ages page**
  (resolved; checked 2026-10-10)
  - File: `plugins/DirtyStats/src/components/Filters.tsx`.
  - `FilteredPerformerList` ran its own `findPerformers` query and rendered
    cards offscreen before the user opened the panel. It is now mounted only
    while the filter dialog is open.

- [ ] **15. DirtyRank `autoPlayTopScenes` toggled off mid-request strands loading state** (reported; still present 2026-10-10)
  - File: `plugins/DirtyRank/src/components/PerformerCard.tsx` — the effect
    keyed on `autoPlayTopScenes` sets `sceneLoading`; its cleanup
    `cancelMediaRequest` bumps the request id without resetting it.
  - When the setting flips true->false during an in-flight request, neither
    `.then` nor `.finally` runs (request-id check), leaving `sceneLoading`
    true and the card stuck on "Loading...".
  - Fix: reset per-request loading state in the cleanup/effect keyed on the
    setting.

- [x] **16. DirtyRank `INSTANCE_KEY` set only at the end of the IIFE**
  (resolved 2026-10-10 by hub-owned registration)
  - File: `plugins/DirtyPlugins/src/register.ts` (`registerPlugin`).
  - An exception mid-registration (e.g. missing `ReactRouterDOM`) left the key
    unset, so the next reload registered duplicate routes/patches and a
    duplicate config listener. The hub now records the plugin id before running
    its setup, logs a failed registration once and never repeats it. Plugins no
    longer keep instance keys.
  - Decided against the originally proposed `destroy()`: Stash cannot
    unregister routes or patches, so teardown handles were removed.

- [ ] **17. DirtyFileExtractor has no ffmpeg timeout** (reported; partial
  results fixed)
  - File: `plugins/DirtyFileExtractor/extract_scenes.py`
    (`extract_marker_clip`, `_execute_extraction_plan`).
  - Fixed: per-item failures are collected in `failed` and reported together
    with `copied`/`skipped`/`missing`, so one error no longer discards the
    results accumulated so far.
  - Fixed 2026-10-10: marker encoders have duration-scaled deadlines, callback cancellation,
    bounded diagnostics and Windows child containment. Ordinary failures reap the
    child before removing partial output; forced parent termination stops its child.
  - Open: the run does not abort after N consecutive transport failures.

- [ ] **18. DirtyFileExtractor marker fallback differs from Multiscreen** (reported; still present 2026-10-10)
  - Files: `plugins/DirtyFileExtractor/extract_scenes.py` (reports "marker has
    no valid end time") vs `plugins/DirtyMultiscreen/src/components/Route.tsx`
    (`getMarkerItem(marker, settings.markerDuration)`).
  - Markers without `end_seconds` play in multiscreen (fallback
    `markerDuration`) but are reported `missing` by the extractor.
  - Fix: add the same `markerDuration` fallback setting.

## Performance

- [x] **P1. DirtyStats constellation display edge budget** (resolved 2026-10-10)
  - Displays at most 5,000 links, preserving a strongest-first spanning forest
    before filling with strongest remaining edges. The toolbar reports total,
    shown and hidden links; collaborator counts include hidden connections.
  - The 1,000-performer regression retains connectivity and exact 499,500-pair
    totals. Pair aggregation remains quadratic; chunking/worker work needs measurements.

- [ ] **P2. DirtyRank large-cohort cold scoring and confidence work** (partly resolved 2026-10-10)
  - Category entries and confidence estimates now reuse population/settings/pool
    revisions across unrelated renders. Cold scores evaluate each distinct rating
    pair once, and accepted votes update retained comparison sums before publication.
    Ties, neutral populations, stale replies and 1,000 repeated updates retain parity.
  - The local 5,000-performer two-person vote drops from 167.474 to 0.684 ms;
    three cached categories drop from 206.235 to 0.753 ms. These are synthetic Node
    medians, not browser/library guarantees; see `docs/code-analysis-status.md`.
  - Cold score weights now reuse one exponential per distinct rating. Preparation
    yields after at most 32,768 comparisons, coalesces callers, cancels obsolete pools
    and gates Overall/native sorting until scores are complete. Ordering computes
    each overall pool once. A 5,000-performer/three-category browser fixture retains
    exact checksums and processes input timer events throughout the calculation.
  - Exact comparisons remain quadratic; local Node preparation takes 234.789 ms
    total with a 1.846 ms longest-task median. Confidence changes still require Glicko
    simulations. Measure larger populations, confidence costs and top-K selection
    before adding further workers or changing algorithms.

- [x] **P3. DirtyRank repeated library/marker queries** (resolved 2026-10-10)
  - Complete reference populations load in 500-row pages with compatible
    in-flight request coalescing. Settings refresh does not reload them.
  - Route entry refreshes native library data; explicit invalidation guards
    cached/in-flight publication and clears preferred-media caches.
  - Preferred media queries request one row each and preserve the earliest marker
    across scenes tied at the best rating, including null ratings. The compiled
    queries pass an isolated Stash fixture; complete global populations are retained.

- [ ] **P4. DirtyStats card list serializes all ids every render**
  - File: `plugins/DirtyStats/src/components/Cards.tsx` (both card lists
    compute `JSON.stringify(ids)`).
  - `JSON.stringify(ids)` on every parent render; use a cheap key or reset
    page in the parent.

- [x] **P5. Growth period changes reuse daily aggregation** (resolved 2026-10-10)
  - Daily points depend on scenes/date basis; forecast parameters reuse those
    points. Regressions verify aggregate counts and identical forecast values.

- [ ] **P6. DirtyStats refetches all pages when only native sort changes**
  - Files: `plugins/DirtyStats/src/domain/data.ts` (`usePageLoad`,
    `usePageData`) and the page components that pass the native filter as load
    keys.
  - Aggregations are order-independent; fetch id-sorted once and sort cards
    locally.

- [x] **P7. DirtyStats duplicates eight paginated fetch loops and eight chart bootstraps**
  (resolved; checked 2026-10-10)
  - Files: `plugins/DirtyStats/src/domain/data.ts` (`fetchAllPages`,
    `usePageLoad`, `usePageData`), `plugins/DirtyStats/src/domain/charts.ts`
    (`mountChart`, `useChart`).
  - Every page now loads through the shared helpers, which centralize abort
    checks and `isDisposed` guards.

- [x] **P8. Multiscreen contextual working sets** (resolved 2026-10-10)
  - Contextual queues continue in independent pages of at most 240 items per
    pane. Pending page requests are shared; superseded/unmounted responses cannot
    publish. Complete explicit selections remain one source with bounded queues.
  - Ordered unsplit playback shares its source; random playback uses independent
    page permutations. Repeatable page seeds keep split assignments consistent.
  - Regressions traverse 1,001 contextual/selected items, assert queue sizes, and
    exercise empty initial pages, failures/retries and cancellation.

- [x] **P9. Multiscreen cross-pane subscription churn** (resolved 2026-10-10)
  - Stable callbacks read current navigation. Advancing one pane retains the other
    pane's exact player listener/observer identities.
  - Marker/video observation remains conditional; audio observation always runs.
    Combining them would blur these lifetimes, so separate observers remain deliberate.

- [x] **P10. DirtyTidy repeated path normalization and oversized snapshots** (fixed 2026-10-10)
  - Files: `plugins/DirtyTidy/dirty_tidy_templates.py` (`_normalized_path`),
    `plugins/DirtyTidy/dirty_tidy.py` (plan building).
  - Plans cache normalized paths locally and compute scene template values once.
    Snapshot fields follow enabled templates and required Stash IDs; identities,
    file paths/basenames and labels remain mandatory. The next plan recomputes paths.
  - The complete preview remains part of the immutable reviewed-plan contract.
    Browser paging would require a separate durable reviewed-plan design.

- [ ] **P12. Hub and storage micro-inefficiencies**
  - Files: `plugins/DirtyPlugins/src/components/Route.tsx` (the
    configuration-changed listener),
    `plugins/DirtyPlugins/dirty_plugins_storage.py` (`connect`,
    `backup_database`).
  - Fixed 2026-10-10: settings reloads target the affected plugin and preserve
    mounted custom workflow state. Backup names include UUIDs and exclusive
    creation refuses an existing destination; same-second backups remain distinct.
  - WAL is still configured on schema initialization; any lifecycle change should
    be justified separately against shared-database behavior.
  - Fixed: `pluginInput` copies the stored configuration before writing draft
    values, so React state is no longer mutated in place.

## Refactoring

- [x] **R2. DirtyTidy dead code/contracts** (2026-10-09: backend paging, `PREVIEW_STATUSES`
  and `excludeVideo` removed; `sourceJobId` is now used by the automation claim;
  `render_template` stays as an internal helper)
  - Backend pagination/`MAX_PAGE_SIZE`/`PREVIEW_STATUSES` was unreachable
    from the only client; `excludeVideo` fetched but unused; `sourceJobId`
    ignored; `render_template` is a thin wrapper.

- [ ] **R3. DirtyRank duplicated defaults/taxonomy and dead state** (2026-10-09: defaults
  come from the schema, `busy` guards are gone and the always-zero `failed`/`failures`
  fields were removed; the stored `recentBattleIds` column remains)
  - Files: `schemas/dirtyRank.settings.json` (the single source of defaults and
    Glicko clamps), `plugins/DirtyRank/dirty_rank.py` (`recent_battle_ids`
    column and its reader).
  - Open: `recentBattleIds` is persisted but never read by the browser
    (avoid-repeat is session-only). Delete it or wire it up.

- [ ] **R5. Multiscreen does not follow repo conventions** (narrowed 2026-10-10)
  - Files: `plugins/DirtyMultiscreen/src/counts.ts`,
    `plugins/DirtyMultiscreen/src/components/LoadedNativePlayer.tsx`
    (`disableVolumePersistence`).
  - Fixed: ES2020 is the documented target for every plugin, and the unused
    React shim re-exports are gone with the shared host binding.
  - Open: the scene-count cache is FIFO not LRU; the player monkey-patches
    volume persistence internals. Either reconcile with conventions or document
    an explicit exception.

- [ ] **R6. Storage lifecycle gaps** (narrowed 2026-10-10)
  - File: `plugins/DirtyPlugins/dirty_plugins_storage.py` (`connect`, the
    `json.loads` calls in the settings readers).
  - Decided: the hub guards itself with `window.DirtyPlugins` and has no
    `destroy()`; see item 16.
  - Open: no incremental migration framework (a future v2 would stamp the
    version without migrating); unguarded `json.loads/dumps` crash with raw
    tracebacks.

- [ ] **R7. DirtyTidy manifest/docs and capture mode** (narrowed 2026-10-10)
  - Files: `plugins/DirtyTidy/dirtyTidy.yml`,
    `schemas/dirtyTidy.settings.json` (constants only),
    `plugins/DirtyTidy/src/components/PreviewTable.tsx` (capture masking).
  - Open: the staged manifest has no typed `settings:` block, so the generic
    card renders nothing if the custom panel fails to register.
  - Fixed evidence: PreviewTable replaces paths with “Path hidden” and hides notes
    in capture mode. The missing CSS blur rule does not establish a current path leak.
  - Fixed: DirtyRank and DirtyStats support `?docsCapture=1` through the hub's
    `captureEnabled`.

- [ ] **R8. Oversized units**
  - `plugins/DirtyTidy/dirty_tidy.py` (570 lines);
    `plugins/DirtyFileExtractor/extract_scenes.py` (570 lines);
    `plugins/DirtyStats/src/components/Cards.tsx` (two near-duplicate card
    lists), `Growth.tsx` (333 lines), `Counters.tsx` (290), `Birthdays.tsx`
    (263); `plugins/DirtyMultiscreen/src/components/Route.tsx`, `Grid.tsx` and
    `LoadedNativePlayer.tsx`.
  - Split data fetching / option building / presentation; merge
    `resolve_destination` and `resolve_generated_destination`
    (`plugins/DirtyFileExtractor/extract_scenes_destinations.py`).

## Suggested fix order

1. Remaining high/medium bugs (#8-#18)
2. Performance P1-P3 (constellation, rank render math, rank fetches)
3. Remaining performance and refactors
