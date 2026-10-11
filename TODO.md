# Dirty Plugins TODO

Open bugs, product decisions and acceptance checks carried forward from the
completed reviews. Recheck reported issues against the current source before
implementing them. Completed work is recorded in Git history and release notes.

## UI acceptance checks

- [ ] Review `tests/fixtures/dirty_suite_harmony.html` in its default, Paper
  Picnic and Retro Arcade themes, including busy controls, native/fallback
  card boundaries and safe captures.
- [ ] Finish rendered contrast checks for translucent overlays and chart labels
  across supported themes, plus keyboard-only and reduced-motion checks on
  remaining controls. Follow `plugins/DirtyPlugins/STYLE.md`.
- [ ] Complete live state checks: hub invalid/save feedback; FileExtractor and
  Multiscreen empty/error states; Rank Battle/Gauntlet and table interactions;
  Stats dashboard editing and nested native filters; Tidy invalid/confirmation
  states. Use safe previews for file-moving actions and mask private media.

## Manual checks

- [ ] Finish interactive checks of Rank leaderboards, a Stats full page, Tidy
  preview, Multiscreen launch, Captions playback, FileExtractor selection and
  Compactor preview. Registration, settings tabs, Stats dashboard, a Rank battle
  page, served assets, backend reads and isolated fixtures already passed.
- [ ] Verify DevTools breakpoint stepping in a development build
  (`npm run build:dev`); served maps and decoded source locations already passed.
- [ ] Check other browser engines, mobile fullscreen and casting for Captions
  and Multiscreen. ES2020 remains the target.
- [ ] DirtyMultiscreen: hidden-tab pause transitions and selections spanning
  several native pages.
- [ ] DirtyCaptions: probe recovery after errors and live Stop refresh timing
  on a library larger than the two-file fixture.
- [ ] DirtyTidy: a multi-page preview in real Stash.
- [ ] DirtyFileExtractor: stopping a running extraction (`--serve --stop-file`)
  and visual multi-page selection.
- [ ] DirtyStats: exercise live-library scale and assess an ECharts 6.x upgrade
  for GHSA-fgmj-fm8m-jvvx. The affected `lines` series is neither used nor bundled.

## Bugs and product decisions

- [ ] **9. DirtyTidy empty hierarchy and partial failures.**
  `plugins/DirtyTidy/dirty_tidy.py` (`_parse_levels`, `exit_code_for`): an empty
  hierarchy with move enabled targets the source root. Decide whether this is
  intended or invalid. A run with both applied and failed moves exits 0; decide
  its exit policy and whether a journal/undo is needed.
- [ ] **10. DirtyMultiscreen close navigation.**
  `plugins/DirtyMultiscreen/src/components/Route.tsx` (`closeRoute`) uses
  `history.back()` whenever `history.length > 1`, which can leave Stash.
- [ ] **12. DirtyTidy case handling.**
  `plugins/DirtyTidy/dirty_tidy_templates.py` (`_normalized_path`): `normcase`
  prevents case-only renames on Windows; case-fold duplicates are not detected
  on macOS.
- [ ] **15. DirtyRank autoplay loading state.**
  `plugins/DirtyRank/src/components/PerformerCard.tsx`: disabling
  `autoPlayTopScenes` during a request invalidates its completion callbacks
  without resetting `sceneLoading`. Reset loading in the setting effect/cleanup.
- [ ] **17. DirtyFileExtractor repeated transport failures.**
  `plugins/DirtyFileExtractor/extract_scenes.py` (`_execute_extraction_plan`):
  decide whether to abort after a bounded number of consecutive transport
  failures. Encoder deadlines and per-item failure reporting are implemented.
- [ ] **18. DirtyFileExtractor marker fallback duration.**
  `plugins/DirtyFileExtractor/extract_scenes.py` rejects markers without an end
  time; Multiscreen uses `markerDuration`. Decide whether extraction should have
  the same fallback setting.

## Performance measurements and follow-ups

- [ ] **P2. DirtyRank large-cohort scoring and confidence.**
  Exact comparisons remain quadratic despite cached/incremental scores and
  bounded cold batches. Measure larger populations, changed-pool Glicko
  confidence simulations and top-K selection before adding workers or changing
  algorithms. Use `tests/benchmark_rank_scores.js`,
  `tests/benchmark_rank_cold.js` and `tests/benchmark_rank_updates.js`.
- [ ] Measure DirtyStats cast-pair aggregation on larger populations before
  introducing chunking or worker aggregation. The 5,000-link display budget
  bounds rendering, while aggregation still considers every pair.
- [ ] **P4. DirtyStats card-list keys.**
  `plugins/DirtyStats/src/components/Cards.tsx` serializes all IDs on every
  parent render in both card lists. Consider a cheaper key or parent-owned page
  reset after measuring the cost.
- [ ] **P6. DirtyStats native sort changes.**
  `plugins/DirtyStats/src/domain/data.ts` (`usePageLoad`, `usePageData`) refetches
  all pages when native sort changes. Aggregations are order-independent;
  evaluate ID-sorted loading with local card ordering.
- [ ] **P12. Shared storage lifecycle.**
  `plugins/DirtyPlugins/dirty_plugins_storage.py` (`connect`) configures WAL
  during schema initialization. Any lifecycle change needs measurements and
  validation against shared-database behavior.

## Data and maintenance decisions

- [ ] **R3. Unused persisted settings and battle IDs.**
  Assess removing Rank's write-only `enabledCohorts` and Stats' persisted theme
  copy. `plugins/DirtyRank/dirty_rank.py` persists `recentBattleIds`, but browser
  repeat avoidance is session-only; remove it or use it. Perform the required
  read-only data check before removing stored fields or readers.
- [ ] **R5. Multiscreen cache and player internals.**
  `plugins/DirtyMultiscreen/src/counts.ts` uses FIFO rather than LRU;
  `src/components/LoadedNativePlayer.tsx` (`disableVolumePersistence`) patches
  player volume-persistence internals. Reconcile these choices with conventions
  or document explicit exceptions.
- [ ] **R6. Storage migrations and JSON failures.**
  `plugins/DirtyPlugins/dirty_plugins_storage.py` has no incremental migration
  path for a future schema version. Evaluate migration requirements when a
  schema change is needed, and handle malformed stored JSON without raw
  tracebacks.
- [ ] **R7. DirtyTidy settings fallback.**
  `plugins/DirtyTidy/dirtyTidy.yml` and `schemas/dirtyTidy.settings.json` expose
  no typed settings block, so the generic card is empty if its custom panel
  fails to register. Decide whether a fallback is needed.
- [ ] **R8. Large units and repeated presentation.**
  Review `plugins/DirtyTidy/dirty_tidy.py`,
  `plugins/DirtyFileExtractor/extract_scenes.py`, Stats' `Cards.tsx`, `Growth.tsx`,
  `Counters.tsx` and `Birthdays.tsx`, and Multiscreen's `Route.tsx`, `Grid.tsx`
  and `LoadedNativePlayer.tsx` for useful splits between fetching, option
  building and presentation. Evaluate merging Extractor's `resolve_destination`
  and `resolve_generated_destination` in `extract_scenes_destinations.py`.
