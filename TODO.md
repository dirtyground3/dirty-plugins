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

- [ ] Live check of the 2026-10-10 registration and host-binding changes in the
  real Stash after installing the new builds: Rank battle and
  leaderboards, a Stats page and the dashboard, Tidy preview, a Multiscreen
  launch, Captions playback, the FileExtractor selection action and a Compactor
  preview. The automated suite and all seven isolated Stash fixtures pass (real
  Stash binary, synthetic media); nothing was installed into the live Stash
  during that pass.
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

- [ ] **8. DirtyStats map loses zoom/pan on every interaction** (verified;
  still present 2026-10-10)
  - File: `plugins/DirtyStats/src/components/Origin.tsx` — the option effect
    calls `chart.setOption(option, true)`; `charts.registerMap` sits in
    `beforeInit` and reruns on each init.
  - `chart.setOption(..., true)` (notMerge) rebuilds the map on label
    toggles/country clicks, discarding roam state that the README promises
    exports.
  - Fix: drop `true`; update only `series[0].data` and `visualMap.max`;
    register the map once.

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
  - Open: FFmpeg has no timeout/cancellation.
  - Open: the run does not abort after N consecutive transport failures.

- [ ] **18. DirtyFileExtractor marker fallback differs from Multiscreen** (reported; still present 2026-10-10)
  - Files: `plugins/DirtyFileExtractor/extract_scenes.py` (reports "marker has
    no valid end time") vs `plugins/DirtyMultiscreen/src/components/Route.tsx`
    (`getMarkerItem(marker, settings.markerDuration)`).
  - Markers without `end_seconds` play in multiscreen (fallback
    `markerDuration`) but are reported `missing` by the extractor.
  - Fix: add the same `markerDuration` fallback setting.

## Performance

- [ ] **P1. DirtyStats constellation is O(scenes x cast^2) with uncapped links** (dead `sceneIds` removed 2026-10-09; the link cap remains)
  - Files: `plugins/DirtyStats/src/domain/analytics.ts`
    (`aggregateConstellation`), `plugins/DirtyStats/src/domain/chartOptions.ts`
    (`constellationOption`).
  - Pair weights are already counted in a `Map`, but every link is fed to a
    force layout, which can freeze the main thread at the 1000-performer
    setting.
  - Fix: cap emitted links, surface "N connections hidden"; consider
    chunking/worker.

- [ ] **P2. DirtyRank recomputes unmemoized 1000-iteration confidence searches per render/vote**
  - Files: `plugins/DirtyRank/src/domain/matchmaking.ts`
    (`categoryConfidence`), `plugins/DirtyRank/src/components/Primitives.tsx`
    (three unmemoized calls of `leaderboardData`/`categoryConfidence`),
    `plugins/DirtyRank/src/battleSession.ts`. The leaderboard page
    (`components/Leaderboards.tsx`) already memoizes `leaderboardData`.
  - `categoryConfidence` runs per entry/boundary up to 1000 Glicko
    simulations; `leaderboardData` filters + sorts the whole cohort for 12
    rows. Tens of ms per click on large libraries.
  - Fix: `useMemo` on stable deps; partial selection for top-K.

- [ ] **P3. DirtyRank fetches the whole library/marker set repeatedly**
  - File: `plugins/DirtyRank/src/domain/rank.ts` (the performer query and the
    marker query both use `per_page: -1`).
  - `per_page:-1` with heavy fields on every route load and every
    configuration-changed event; marker query downloads all markers with
    full nested scenes just to pick one clip.
  - Fix: bounded `per_page` with server-side sort; module-level cache with
    TTL/revision.

- [ ] **P4. DirtyStats card list serializes all ids every render**
  - File: `plugins/DirtyStats/src/components/Cards.tsx` (both card lists
    compute `JSON.stringify(ids)`).
  - `JSON.stringify(ids)` on every parent render; use a cheap key or reset
    page in the parent.

- [ ] **P5. DirtyStats re-aggregates the whole library when the forecast period changes**
  - File: `plugins/DirtyStats/src/components/Growth.tsx` (the `forecast` memo
    depends on `period` and calls `aggregateGrowth` again).
  - Memoize the day-grouped aggregate on `[scenes, dateBasis]` only; reuse
    `stats.points` for day grouping.

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

- [ ] **P8. Multiscreen contextual queries bypass the page cap and clone lists per screen**
  - Files: `plugins/DirtyMultiscreen/src/queries.ts` (four `per_page: -1`
    filters), `plugins/DirtyMultiscreen/src/components/Grid.tsx` (per-screen
    playlists).
  - `per_page:-1` for studio/performer contexts, then the full item array is
    copied per screen (up to 36 copies).
  - Fix: apply `getSceneLimit`, page/lazy per screen, bounded working set.

- [ ] **P9. Multiscreen per-tile MutationObservers and effect churn**
  - Files: `plugins/DirtyMultiscreen/src/components/LoadedNativePlayer.tsx`
    (`observeSubtree`, effects that depend on `nextItem`),
    `plugins/DirtyMultiscreen/src/components/Grid.tsx` (`nextItem` is a new
    function on every render).
  - Two subtree observers per tile (up to 72); the marker effect re-subscribes
    on every render because `nextItem` is recreated.
  - Fix: refs for volatile values, stable deps, one grid-level observer, or
    hook `player.on("timeupdate")`.

- [ ] **P10. DirtyTidy repeated path normalization and oversized snapshots**
  - Files: `plugins/DirtyTidy/dirty_tidy_templates.py` (`_normalized_path`),
    `plugins/DirtyTidy/dirty_tidy.py` (plan building).
  - `realpath/normcase` recomputed per file per root (~1M walks at scale);
    the full library is decorated with fields the strategy never uses. Backend
    paging and `includeAll` were removed on 2026-10-09, so the entire plan is
    always serialized to the browser.
  - Fix: memoize `_normalized_path`, precompute normalized roots, derive
    GraphQL fields from `template_variable_names()`, cache scene variables,
    use server-side paging.

- [ ] **P12. Hub and storage micro-inefficiencies**
  - Files: `plugins/DirtyPlugins/src/components/Route.tsx` (the
    configuration-changed listener),
    `plugins/DirtyPlugins/dirty_plugins_storage.py` (`connect`,
    `backup_database`).
  - Settings page reloads the full snapshot on every configuration event; WAL
    is only set when the schema version changes; backup filename is
    second-granular (two backups in one second reuse the file).
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
    `plugins/DirtyTidy/dirtyTidy.css` (`.dirty-tidy-path`).
  - Open: the staged manifest has no typed `settings:` block, so the generic
    card renders nothing if the custom panel fails to register; no docs-capture
    rules hide `.dirty-tidy-path` (absolute private paths).
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
