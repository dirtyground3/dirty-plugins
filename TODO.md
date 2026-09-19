# Dirty Plugins deep-review TODO

Findings from a full deep review (bugs, performance, refactoring) of all
plugins and the shared runtime, verified against the source. The existing
suite passes, so most items below are latent and untested. Items marked
"verified" were reproduced or confirmed by direct reading of the code; the
rest come from per-plugin deep dives and should be re-checked when picked up.

All remaining items are open.

## High / Medium bugs

- [ ] **8. DirtyStats map loses zoom/pan on every interaction** (verified)
  - File: `plugins/DirtyStats/dirtyStats.js:387` (also `charts.registerMap`
    at :374 reruns each init)
  - `chart.setOption(..., true)` (notMerge) rebuilds the map on label
    toggles/country clicks, discarding roam state that the README promises
    exports.
  - Fix: drop `true`; update only `series[0].data` and `visualMap.max`;
    register the map once.

- [ ] **9. DirtyTidy Windows/Unicode edge cases** (reported; stdin/levels verified)
  - File: `plugins/DirtyTidy/dirty_tidy.py:272-278, 300-315, 588-608,
    907-917, 990-999`
  - `configure_standard_streams` reconfigures only stdout/stderr; stdin
    decoded as cp1252 corrupts non-ASCII settings on legacy Windows hosts.
  - `_parse_levels([])` returns `[]`, so with move enabled and all hierarchy
    levels removed (JS `removeLevel` allows this, `dirtyTidy.js:441-447`)
    files are `ready` to move to the source root; the UI meanwhile shows the
    defaults.
  - Reserved device names (`CON`, `NUL`, ...) are blocked for filenames but
    not for hierarchy folders.
  - Partial failures: each move failure is logged and skipped, `main()`
    always exits 0, so an all-failed run looks green in Tasks, with no
    journal/undo.

- [ ] **10. DirtyMultiscreen stale-response races and nav escape** (reported)
  - File: `plugins/DirtyMultiscreen/multiscreen.js:640-711, 1112-1118`
  - `useSceneQuery`/`useMarkerQuery` have no request-id/abort guard; a slow
    older query can overwrite newer settings' results and clear the spinner
    early. The shared `graphql` already accepts `options.signal`.
  - `closeRoute` uses `history.back()` whenever `history.length > 1`, which
    can navigate out of Stash entirely.

- [ ] **11. DirtyRank screenshot mode uses the wrong query param** (verified)
  - File: `plugins/DirtyRank/dirtyRank.js:1894, 2024`
  - It reads `censorMedia=1`; the repo convention (AGENTS.md, hub,
    multiscreen) is `docsCapture=1`. DirtyRank fails to blur in documented
    capture flows (and `tests/test_dirty_rank.py:404` bakes in the
    deviation).

- [ ] **12. DirtyTidy `sourceJobId` and case handling** (reported)
  - File: `plugins/DirtyTidy/dirty_tidy.py:611-612, 754-758, 941-987`;
    `plugins/DirtyTidy/dirtyTidy.js:144-156`
  - `sourceJobId` is sent by the UI but ignored (no idempotency); the
    localStorage automation claim is racy across tabs (`normcase`
    case-only renames are impossible on Windows; case-fold duplicates are
    not detected on macOS).

- [ ] **13. DirtyRank rating index can regress to an older revision** (reported)
  - File: `plugins/DirtyRank/dirtyRank.js:291-300`
  - `applyRatingIndex` unconditionally replaces the map and sets
    `ratingIndexRevision = payload.revision` (not `Math.max`), so a
    `loadAll` racing a vote can erase the newer state from the UI.
  - Fix: ignore payloads older than the applied revision; merge instead of
    clear.

- [ ] **14. DirtyStats mounts a hidden native performer list on the Ages page** (reported)
  - File: `plugins/DirtyStats/dirtyStats.js:141, 172-185`
  - `FilteredPerformerList` runs its own `findPerformers` query and renders
    cards offscreen (`display:none`) before the user opens the panel.
  - Fix: mount lazily on first open.

- [ ] **15. DirtyRank `autoPlayTopScenes` toggled off mid-request strands loading state** (reported)
  - File: `plugins/DirtyRank/dirtyRank.js:1194-1311`
  - When the setting flips true->false during an in-flight request, neither
    `.then` nor `.finally` runs (request-id check), leaving `sceneLoading`
    true and the card stuck on "Loading...".
  - Fix: reset per-request loading state in the cleanup/effect keyed on the
    setting.

- [ ] **16. DirtyRank `INSTANCE_KEY` set only at the end of the IIFE** (verified)
  - File: `plugins/DirtyRank/dirtyRank.js:5, 3063`
  - An exception mid-registration (e.g. missing `ReactRouterDOM`) leaves the
    key unset, so the next reload registers duplicate routes/patches and a
    duplicate config listener. There is no exported teardown.
  - Fix: set the key before side effects and expose `destroy()`.

- [ ] **17. DirtyFileExtractor drops partial results on first failure / no ffmpeg timeout** (reported)
  - File: `plugins/DirtyFileExtractor/extract_scenes.py:788-833, 404-409,
    424-479`
  - One error raises out of `_copy_resolved_items`, discarding all
    `copied`/`skipped`/`missing` already accumulated; files already copied
    stay on disk with no report. FFmpeg has no timeout/cancellation.
  - Fix: per-item `OSError` handling + `errors` list in the result, abort
    after N consecutive transport failures, add ffmpeg timeout/kill.

- [ ] **18. DirtyFileExtractor marker fallback differs from Multiscreen** (reported)
  - Files: `plugins/DirtyFileExtractor/extract_scenes.py:665-677` vs
    `plugins/DirtyMultiscreen/multiscreen.js:457-471`
  - Markers without `end_seconds` play in multiscreen (fallback
    `markerDuration`) but are reported `missing` by the extractor.
  - Fix: add the same `markerDuration` fallback setting.

## Performance

- [ ] **P1. DirtyStats constellation is O(scenes x cast^2) with uncapped links** (verified `sceneIds` dead)
  - File: `plugins/DirtyStats/dirtyStats.js:474-481, 547`
  - `sceneIds` is written but never read (dead memory); every link is fed to
    a force layout, which can freeze the main thread at the 1000-performer
    setting.
  - Fix: drop `sceneIds`, count weights in a `Map<string, number>`, cap
    emitted links, surface "N connections hidden"; consider chunking/worker.

- [ ] **P2. DirtyRank recomputes unmemoized 1000-iteration confidence searches per render/vote**
  - File: `plugins/DirtyRank/dirtyRank.js:1046, 1430, 1458, 1559`
  - `categoryConfidence` runs per entry/boundary up to 1000 Glicko
    simulations; `leaderboardData` filters + sorts the whole cohort for 12
    rows. Tens of ms per click on large libraries.
  - Fix: `useMemo` on stable deps; partial selection for top-K.

- [ ] **P3. DirtyRank fetches the whole library/marker set repeatedly**
  - File: `plugins/DirtyRank/dirtyRank.js:318-329, 340-354, 1841, 2078`
  - `per_page:-1` with heavy fields on every route load and every
    configuration-changed event; marker query downloads all markers with
    full nested scenes just to pick one clip.
  - Fix: bounded `per_page` with server-side sort; module-level cache with
    TTL/revision.

- [ ] **P4. DirtyStats card list serializes all ids every render**
  - File: `plugins/DirtyStats/dirtyStats.js:314-316, 407-409`
  - `JSON.stringify(ids)` on every parent render; use a cheap key or reset
    page in the parent.

- [ ] **P5. DirtyStats re-aggregates the whole library when the forecast period changes**
  - File: `plugins/DirtyStats/dirtyStats.js:619-620`
  - Memoize the day-grouped aggregate on `[scenes, dateBasis]` only; reuse
    `stats.points` for day grouping.

- [ ] **P6. DirtyStats refetches all pages when only native sort changes**
  - File: `plugins/DirtyStats/dirtyStats.js:341-344, 367, 604, 637, 952, 970`
  - Aggregations are order-independent; fetch id-sorted once and sort cards
    locally.

- [ ] **P7. DirtyStats duplicates eight paginated fetch loops and eight chart bootstraps**
  - File: `plugins/DirtyStats/dirtyStats.js:354-365, 519-529, 624-635,
    726-738, 749-759, 891-903, 958-968, 1033-1043`; `373-381, 536-557,
    642-666, 766-780, 909-921, 975-989, 1050-1063`
  - Extract `fetchAll(query, variables, opts)` and `useChart(node,
    buildOption)`; centralizes abort checks and `isDisposed` guards.

- [ ] **P8. Multiscreen contextual queries bypass the page cap and clone lists per screen**
  - File: `plugins/DirtyMultiscreen/multiscreen.js:54-65, 329-350,
    1158-1166`
  - `per_page:-1` for studio/performer contexts, then the full item array is
    copied per screen (up to 36 copies).
  - Fix: apply `getSceneLimit`, page/lazy per screen, bounded working set.

- [ ] **P9. Multiscreen per-tile MutationObservers and effect churn**
  - File: `plugins/DirtyMultiscreen/multiscreen.js:799-833, 1071-1091`
  - Two subtree observers per tile (up to 72); the marker effect re-subscribes
    on every render because `nextItem` is recreated.
  - Fix: refs for volatile values, stable deps, one grid-level observer, or
    hook `player.on("timeupdate")`.

- [ ] **P10. DirtyTidy repeated path normalization and oversized snapshots**
  - File: `plugins/DirtyTidy/dirty_tidy.py:182-228, 452-523, 611-626,
    754-783`
  - `realpath/normcase` recomputed per file per root (~1M walks at scale);
    the full library is decorated with fields the strategy never uses;
    `includeAll` serializes the entire plan to the browser.
  - Fix: memoize `_normalized_path`, precompute normalized roots, derive
    GraphQL fields from `template_variable_names()`, cache scene variables,
    use server-side paging.

- [ ] **P12. Hub and storage micro-inefficiencies**
  - Files: `plugins/DirtyPlugins/dirtyPlugins.js:725-744, 841`;
    `plugins/DirtyPlugins/dirty_plugins_storage.py:47-81, 99-114`
  - Settings page reloads the full snapshot on every configuration event;
    `snapshot.configuration[plugin.id] = input` mutates React state in
    place; WAL is only set when the schema version changes; backup filename
    is second-granular (two backups in one second reuse the file).

## Refactoring

- [ ] **R2. DirtyTidy dead code/contracts**
  - Files: `plugins/DirtyTidy/dirty_tidy.py:106-108, 185, 829-870,
    941-987`; `plugins/DirtyTidy/dirtyTidy.js:138`
  - Backend pagination/`MAX_PAGE_SIZE`/`PREVIEW_STATUSES` is unreachable
    from the only client; `excludeVideo` fetched but unused; `sourceJobId`
    ignored; `render_template` is a thin wrapper.

- [ ] **R3. DirtyRank duplicated defaults/taxonomy and dead state**
  - Files: `plugins/DirtyRank/dirtyRank.js:48-91, 196-227, 2046-2066`;
    `plugins/DirtyRank/dirty_rank.py:22-76, 230-278, 845`;
    `plugins/DirtyRank/dirtyRank.yml:19-95`
  - Defaults/Glicko clamps in triplicate (already drifted); dead
    `busy`/`busyRef` guards; `recentBattleIds` persisted but never read
    (session-only avoid-repeat); always-zero `failed`/`failures`.
  - Fix: single shared defaults resource or generator-verified parity tests;
    delete or wire up the dead fields.

- [ ] **R5. Multiscreen does not follow repo conventions**
  - File: `plugins/DirtyMultiscreen/multiscreen.js` (ES2020 syntax
    throughout vs AGENTS.md ES5 rule; ~30 unused React shim re-exports;
    `sceneCountCache` is FIFO not LRU; monkey-patches player volume
    internals). Either reconcile with conventions or document an explicit
    exception.

- [ ] **R6. Hub/storage lifecycle gaps**
  - Files: `plugins/DirtyPlugins/dirtyPlugins.js:5`;
    `plugins/DirtyPlugins/dirty_plugins_storage.py:47-81, 140, 170`
  - No `destroy()`/versioning for the hub instance key; no incremental
    migration framework (a future v2 would stamp the version without
    migrating); unguarded `json.loads/dumps` crash with raw tracebacks.

- [ ] **R7. DirtyTidy manifest/docs and capture mode**
  - Files: `plugins/DirtyTidy/dirtyTidy.yml:1-17`;
    `plugins/DirtyTidy/dirtyTidy.css`
  - Declares no typed `settings:` block although AGENTS.md asks for it (the
    generic card renders nothing if the custom panel fails to register);
    no docs-capture rules hiding `.dirty-tidy-path` (absolute private
    paths).
  - Also: DirtyRank and DirtyStats have no `?docsCapture=1` support at all.

- [ ] **R8. Oversized units**
  - `plugins/DirtyTidy/dirty_tidy.py:639-766, 873-932`;
    `plugins/DirtyFileExtractor/extract_scenes.py:595-864`;
    `plugins/DirtyStats/dirtyStats.js:312-334, 405-426` (near-duplicate
    card lists), `585-706, 707-798, 877-1084`;
    `plugins/DirtyMultiscreen/multiscreen.js:1119-1307`
  - Split data fetching / option building / presentation; merge
    `resolve_destination` and `resolve_generated_destination`.

## Suggested fix order

1. Remaining high/medium bugs (#8-#18)
2. Performance P1-P3 (constellation, rank render math, rank fetches)
3. Remaining performance and refactors