# Dirty Plugins deep-review TODO

Findings from a full deep review (bugs, performance, refactoring) of all
plugins and the shared runtime, verified against the source. The existing
suite (102 Python tests + Node tests) passes, so most items below are latent
and untested. Items marked "verified" were reproduced or confirmed by direct
reading of the code; the rest come from per-plugin deep dives and should be
re-checked when picked up.

Status key: `[ ]` open, `[x]` done.

## Critical

- [x] **1. DirtyFileExtractor silently overwrites files despite "rename" policy** (verified)
  - Files: `plugins/DirtyFileExtractor/extract_scenes.py:310-348, 722-750, 403`
  - `resolve_destination` / `resolve_generated_destination` only check the
    filesystem (`path.exists()`), never destinations already planned in the
    same run. Two selected scenes with the same basename both resolve to the
    same path as `"copy"`, then `os.replace()` (line 403) clobbers the first.
    Reproduced: two clips produce one file, both reported copied.
  - Fix: track a `planned_destinations` set (normcased) and treat planned
    names as occupied; reserve with `O_CREAT|O_EXCL` for cross-process safety.
  - Done: `planned_destinations` (normcased keys, `destination_key`) gates
    `resolve_destination`/`resolve_generated_destination`; the copy loop claims
    names with `O_CREAT|O_EXCL` (`reserve_destination`) and re-resolves
    collisions from other processes. Tests cover rename/skip duplicate
    basenames in `tests/test_dirty_file_extractor.py`.

- [x] **2. DirtyMultiscreen has no re-registration guard** (verified)
  - File: `plugins/DirtyMultiscreen/multiscreen.js:1, 1308-1379`
  - No `INSTANCE_KEY` anywhere (unlike `extractScenes.js:5-13`). On Stash
    asset reload it re-registers a duplicate route and six patches, stacking
    nav links and count-query timers/context listeners each time.
  - Fix: adopt the `extractScenes.js` pattern (`previousInstance.destroy()` +
    teardown of listeners/observers), or at minimum a version-gated no-op.
  - Done: `__dirtyMultiscreenPlugin` guard at the top of the bundle returns
    early on re-registration (routes/patches cannot be unregistered), and the
    instance key is exported. Contract test added.

- [x] **3. DirtyTidy executes operations that were never confirmed in the preview** (verified)
  - Files: `plugins/DirtyTidy/dirty_tidy.py:347-354, 879-884`;
    `plugins/DirtyTidy/dirtyTidy.js:123, 538`
  - `strategy_hash` covers only normalized settings, and `execute_plan`
    re-snapshots, rebuilds the plan, then runs *every* fresh `ready` op. A
    file that was `warning`/`blocked` at preview becomes movable and executes
    unseen. The same standing authorization (`approvedStrategyHash`) lets
    automation move newly appeared files forever.
  - Fix: persist the previewed plan (ids + source/destination) in shared
    SQLite and execute only the confirmed intersection; for automation store
    a plan digest, not just a strategy hash.
  - Done: previews persist ready operations (file_id/source/destination) via
    `shared_storage.set_metadata`; manual `execute_plan` applies only the
    confirmed intersection; automation requires `approvedPlanDigest` and skips
    when the plan changed. Tests cover warning->ready and digest mismatch.

- [x] **4. Multiscreen grid clipping: `totalScreens` can exceed `rows × columns`** (verified)
  - File: `plugins/DirtyMultiscreen/multiscreen.js:129-131, 1066-1092`
  - Three values clamped independently; the CSS grid is
    `repeat(rows) × repeat(columns)` but renders `totalScreens` tiles. With
    6/2/2 the extra tiles are clipped by the fixed viewport yet still play
    (no IntersectionObserver; `pauseWhenHidden` only watches
    `visibilitychange`).
  - Fix: derive one value from the others, or add an observer that pauses
    off-screen tiles.
  - Done: `normalizeSettings` clamps with `Math.min(totalScreens, rows *
    columns)`. Contract test added.

## High / Medium bugs

- [x] **5. DirtyStats counts `"N/A"` country as Namibia and silently drops unmapped values** (verified)
  - File: `plugins/DirtyStats/dirtyStats.js:37-63`
  - ISO2 `NA` is indexed under normalized `"na"`, which collides with
    `"N/A"`. Non-empty but unmapped values (`"Atlantis"`, `"-"`) never
    increment `missing`, so the summary does not reconcile.
  - Fix: reject placeholders (`N/A`, `Unknown`, `-`), only treat 2-3 ASCII
    letters as codes, count every drop in `missing`.
  - Done: `countryName` rejects placeholders (including the "N/A" variants
    that normalized to Namibia's `"NA"`) and both `aggregate` and
    `countryPerformers` use it, so blank, placeholder, and unrecognized
    values all increment `missing` and now reconcile with `total`.

- [x] **6. DirtyRank `avoidRepeatWindow: 0` is inverted** (verified)
  - File: `plugins/DirtyRank/dirtyRank.js:1059, 1111`
  - `recentTokens.slice(-0)` is `slice(0)` -> the whole history, so setting 0
    penalizes every pair (score x0.04) instead of disabling the penalty.
  - Fix: `window > 0 ? slice(-window) : []`.
  - Done: `recentPairWindow` returns no tokens for 0/negative windows and is
    used by both `selectPair` and `selectGauntletPair`; algorithm tests cover
    window 0 (no penalty) versus window 1 (penalty).

- [x] **7. Storage has no revision precondition and non-snapshot reads** (verified)
  - File: `plugins/DirtyPlugins/dirty_plugins_storage.py:146-156, 159-180`
  - `set_plugin_settings` deletes/rewrites the whole plugin key set with no
    `expected_revision`; clients read-modify-write full settings (hub,
    extractor autosave), so concurrent tabs silently clobber each other,
    violating AGENTS.md's "older request cannot overwrite newer value".
    `get_all_plugin_settings` reads rows and revision in separate statements
    with no transaction.
  - Fix: compare-and-swap inside `BEGIN IMMEDIATE`; wrap the two reads in one
    transaction.
  - Done: per-plugin revisions stored in `dirty_metadata`; `set_plugin_settings`
    checks `expected_revision` inside its `BEGIN IMMEDIATE` transaction and
    raises `SettingsRevisionConflict`; `get_all_plugin_settings` snapshots
    settings and revisions in one read transaction. The backend accepts
    `expectedRevision`, and the hub caches revisions from reads and sends them
    on every write. Storage tests cover stale writes and per-plugin revisions.

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

- [x] **P11. Extractor UI global MutationObserver forces layout every frame**
  - File: `plugins/DirtyFileExtractor/extractScenes.js:607-608, 147-181,
    206-240`
  - `observe(document.body, {subtree:true})` plus `querySelectorAll` and
    `getBoundingClientRect` per frame.
  - Fix: observe only list containers, debounce, skip when busy and the
    selection signature is unchanged.
  - Done: mutation records are filtered to list-container/toolbar additions
    and removals (`hasRelevantMutations`), debounced (`MUTATION_DEBOUNCE_MS`),
    and skipped while busy or when the selection signature and button
    position are unchanged; `destroy` clears the pending timer.

- [ ] **P12. Hub and storage micro-inefficiencies**
  - Files: `plugins/DirtyPlugins/dirtyPlugins.js:725-744, 841`;
    `plugins/DirtyPlugins/dirty_plugins_storage.py:47-81, 99-114`
  - Settings page reloads the full snapshot on every configuration event;
    `snapshot.configuration[plugin.id] = input` mutates React state in
    place; WAL is only set when the schema version changes; backup filename
    is second-granular (two backups in one second reuse the file).

## Refactoring

- [ ] **R1. DirtyTidy JS/Python settings normalization is duplicated and already divergent**
  - Files: `plugins/DirtyTidy/dirtyTidy.js:70-106` vs
    `plugins/DirtyTidy/dirty_tidy.py:300-344`
  - Empty levels, empty rename pattern, and defaults disagree. Normalize
    server-side and feed the normalized values back into the panel (the
    preview already returns `settings` but the panel ignores it).

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

- [ ] **R4. DirtyStats bespoke UI instead of shared primitives and dead props**
  - Files: `plugins/DirtyStats/dirtyStats.js:1119`,
    `plugins/DirtyStats/dirtyStats.css:4-5, 13-14`
  - No `StateView`/`IconButton` usage (15+ bespoke alert/status sites);
    `extraCriteria: { dirtyStats: true }` ignored by Stash;
    `.dirty-stats-field` unused; `.dirty-stats-filter-statistic` declared
    twice; `stats.invalidDates` dead for `created_at`/`scene_date`.

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

## Test gaps (highest value)

- [x] Extractor: collision policies and duplicate basenames (would have
      caught Critical #1) — covered; partial failures, `samefile`, dry-run
      planning still open.
- [ ] Multiscreen: **zero** tests today; `normalizeSettings`, playlist/split
      logic, launch context are pure and easily testable.
- [x] DirtyTidy: preview->execute plan integrity (warning/blocked becoming
      ready) — covered; all-failed exit behavior, reserved-name folders,
      empty hierarchy levels, case-only renames, cp1252 stdin still open.
- [x] Storage: concurrent writers and `expected_revision` semantics —
      covered; migration from version 0/older/newer and corrupt JSON rows
      still open.
- [ ] DirtyRank: raw stdin/stdout protocol e2e (record -> loadAll -> undo ->
      resetPool); double registration after forced early exception;
      rating-index revision ordering.
- [x] DirtyRank: `avoidRepeatWindow=0` — covered by algorithm tests.
- [x] DirtyStats: `N/A` country and `missing` reconciliation — covered; card
      id/filter semantics against Stash's ID resolution, docsCapture, large
      constellations still open.

## Suggested fix order

1. Critical #1 (data loss in extractor) — done
2. Critical #3 (DirtyTidy plan integrity / automation authorization) — done
3. Critical #2 and #4 (multiscreen registration + grid) — done
4. Bugs #5-#7 (stats country data, rank repeat window, storage revision)
5. Performance P1-P3 (constellation, rank render math, rank fetches)
6. Remaining bugs, then refactors and the test gaps above