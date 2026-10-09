# Build migration status

Updated: 8 October 2026 (Europe/Paris).

Plan: [build-migration-plan.md](build-migration-plan.md). This file is the
handoff record; update it after each implementation or verification checkpoint.

## Current checkpoint

Phase 0 baseline and phase 1 infrastructure are complete and verified locally.
Phase 2 (DirtyCompactor) and phase 3 (hub conversion, then shared settings hook)
are complete at their separate review checkpoints. **Phase 4 is complete**:
DirtyFileExtractor, DirtyTidy, DirtyCaptions, DirtyMultiscreen, DirtyRank and
now **DirtyStats** are each at a separate review checkpoint. All eight plugins
compile to one staged bundle each and are installed and enabled on port 9999
(seven at 1.0.1, Stats at 1.0.2). All earlier uncommitted work is preserved.

**The migration is complete: phase 6 finished on 8 October 2026 and stopped at
its review checkpoint.** Legacy staging, types, checks and test shims are gone.
The docs describe the final conventions. Clean packages install into an empty
plugin directory through Stash's package manager. DirtyPlugins, DirtyRank and
DirtyCompactor are 1.0.2 in source (not installed live). See "Phase 6" below.

**Phase 5 (settings metadata generation) is complete and stopped at its review
checkpoint (8 October 2026).** Six plugins' selected settings metadata and
shared constants now have one authored definition in `schemas/`; the build
generates manifest settings, TypeScript tables and Python constants. Parity
with the pre-generation baseline is exact (two explained differences). It is
not installed live; versions are unchanged. See "Phase 5" below.

**The separate bundle size reduction step is complete and stopped at its
review checkpoint (8 October 2026).** All three changes are implemented,
verified and installed live: A (release builds without inline maps), B
(minification) and C (modular ECharts for Stats).

- **Live port 9999:** seven plugins at 1.0.1 (A+B) and **DirtyStats 1.0.2** (C),
  all enabled. Every served bundle equals release staging plus Stash's newline,
  with no map. Served plugin JavaScript fell from 8,824,354 bytes before the
  step to **1,477,451 bytes** (Stats 1,178,324). Hard-refresh the live Stash tab
  (Ctrl+F5) so the browser loads Stats 1.0.2.
- Final checks on the current tree (after phase 6): `npm test` (39 JS suites,
  284 Python tests), clean packaging, `npm run test:packages`, the package
  install test, the Rank and hub fixtures and `git diff --check` passed.
- Next: the user reviews phase 6 (and phase 5) and decides on the live install
  of the 1.0.2 releases (see "Phase 6 next actions"). Work remains uncommitted;
  no pushes/releases.
- New opt-in tool for faster porting checks: `tests/library_copy_fixture.py`
  runs a second Stash on a path-redirected copy of the local library (see
  "Library-copy test instance" below).

## Completed

- Read the migration plan and repository instructions.
- Initial working tree had only the user's untracked
  `docs/build-migration-plan.md`; preserve it.
- `npm ci` passed with the original lockfile (TypeScript 5.9.3).
- Read-only local Stash query: v0.31.1, hash `4de2351e`, built
  `2026-04-13 01:44:23`. Host libraries have not been changed.
- Original `npm test`: typecheck, 24 JavaScript suites and 276 Python tests
  passed; two expected skips avoid rerunning Rank JS in the combined runner.
- [build-migration-baseline.md](build-migration-baseline.md) records every
  manifest's script order, versions, byte sizes, original package files,
  compatibility evidence, and regression scenarios.
- Host served React/ReactDOM is 17.0.2. The exact Stash source declares React 17,
  Vite 5.4.21 and optional legacy output, without an explicit browser list.
  Adopted ES2020 for compiled plugin output. The pilot's modern-browser and
  served-map checks passed; this does not establish host legacy-browser support.
- Pinned build-only dependencies: esbuild 0.28.2, YAML 2.9.1,
  `@types/react` 17.0.93; retained TypeScript 5.9.3. License inventory is in
  `plugins/DirtyPlugins/STYLE.md`. `npm ci --offline` with the new lockfile passed.
- Explicit install-file registry and cross-platform staging build under
  `scripts/`. Legacy files copy unchanged; migrated bundles use classic JSX and
  host React, reject cross-plugin implementation/npm runtime imports, and
  compile selected test modules as CommonJS. Output remains ignored.
- Safe output cleanup, symlink/junction rejection, concurrent-build lock,
  stale-lock recovery, input fingerprints, and failed-build invalidation.
- Runtime JS and Python suites now read `.build/plugins/` using shared path
  helpers. Source architecture checks remain authored-source checks. Missing
  or stale staging gives a clear build instruction. Python children inherit
  bytecode suppression so tests do not contaminate staged packages.
- `npm test` builds once before typechecking and both language suites. Focused
  npm commands prepare staging. Strict TS/TSX has a separate configuration.
- Packaging builds staging, preserves ZIP root/IDs/dependencies/Pages paths,
  uses source Git metadata plus content hashes for update identity, and confines
  cleanup to `_site/`. Shared build inputs change every affected package identity.
- Deployment CI installs pinned Node and dependencies, checks Python 3.9,
  runs the suite, builds ZIPs and checks packages before upload. Trigger paths
  include shared build/config/schema/type/package/test inputs. CI was edited,
  not dispatched from this session.
- AGENTS, root README, hub UI guide, and test instructions describe staging,
  modern source conventions, watch, direct-test prerequisites and local installs.
- Package allowlisting intentionally drops contributor-only hub `STYLE.md` and
  Tidy `TODO.md`; runtime files, README, licenses and vendor notices stay intact.

## Current work / next action

### Phase 6 — completion (review checkpoint, 8 October 2026)

- User: "fix rank and go phase 6". Work stays uncommitted; nothing installed live.
- **Rank fix first.** `_parse_categories_by_cohort` iterated the `VALID_COHORTS`
  set, so `categoriesByCohort` key order changed with the process hash seed (the
  phase 5 finding). It now iterates `COHORT_ORDER`, matching the browser's
  `COHORTS`. New `test_dirty_rank.py` test checks the order in-process and with
  `PYTHONHASHSEED` 1, 2 and 3; the pre-fix staged backend gave three different
  orders for those seeds.
- **Legacy cleanup.**
  - Types: deleted `types/rank.d.ts` and `types/stats.d.ts` (unused: no errors
    without them), `types/domain.d.ts` (only `HtmlRenderer` was used; it moved
    to the hub's `src/types.ts`), and the "legacy checked JavaScript" aliases
    `types/jobs.d.ts` and `types/save-controller.d.ts` (their three TS consumers
    now `import type` from the hub, the established pattern).
    `types/stash-globals.d.ts` keeps only the debug globals and types
    `window.DirtyPlugins` as the hub's real `HubApi`.
  - One TypeScript config: the old `tsconfig.json` legacy check covered only
    `vendor/htm.umd.js` (with `checkJs` off), so the strict config became
    `tsconfig.json` and `tsconfig.migrated.json` was removed (build, typecheck,
    shared inputs, pipeline test and docs updated).
  - Build: no legacy staging path. Every registry entry must declare `bundle`,
    and each manifest's `ui.javascript` must be exactly its compiled entry (CSS
    keeps the allowlist check). Build state no longer records script lists.
  - Tests: the pipeline test now compares every copied install file with source
    and rejects extra manifest scripts and bundle-less entries; the assets test
    checks one parseable entry per plugin; the contract helper `read()` lost its
    legacy manifest branch; Rank/Stats test hosts no longer stub `react.html`.
    Two stale "legacy" wordings were corrected.
- **HTM audit.** No current plugin calls `DirtyPlugins.react.html`. Removing
  it would break anyone running an older feature plugin with a newer hub, so it
  stays as a documented deprecated compatibility API (with its license) until a
  deliberate breaking hub release; its public-API test is kept.
- **Development cycle docs, validated.** README, AGENTS, hub STYLE/README and
  tests README describe the final conventions and the cycle (build:dev or watch →
  copy staged files → reload plugins → hard-refresh). Watch was exercised: a new
  `src/` file and a temporary schema edit each triggered a rebuild, and the
  generated metadata followed the schema; both were reverted byte-for-byte. A
  watcher process that outlived its shell was found and stopped. The development
  maps decoded to TSX in the served context earlier the same day (hub fixture
  with `--development`).
- **Packages.** `_site/` was deleted and rebuilt; `npm run test:packages` passed,
  now also rejecting source/test/tooling/runtime-data members in any ZIP.
  New opt-in `tests/test_package_install_stash_integration.py`: an isolated Stash
  with an empty plugin directory reads the package source from a local HTTP
  server and installs through `installPackages`. It checked that installed files
  equal the ZIPs plus Stash's `manifest` record and contain no runtime data or
  tooling, that all eight load enabled at their versions, serve the staged
  bundles, and that the hub, Rank and Compactor backends run.
  **Finding:** the GraphQL `installPackages` installs only the listed IDs; it
  does not resolve `requires`. The Stash UI does: in a second isolated instance,
  selecting only DirtyRank also selected DirtyPlugins, and Install added both.
  The README's "pulled in automatically" claim is accurate for the UI; the test
  adds declared requirements itself, as the UI does.
- **Versions and release notes.** Runtime files changed since the live 1.0.1/1.0.2
  release for the hub (bundle), Rank (bundle, backend, new metadata module) and
  Compactor (bundle, backends, new metadata module): each is now **1.0.2**.
  Captions, Extractor and Tidy changed only their README and Multiscreen only its
  manifest key order, so they keep 1.0.1; Stats stays 1.0.2. README version
  table and a new "Release notes" section updated; AGENTS states the bump rule.
  Size guard: recorded sizes updated for Compactor 36,095, hub 50,249 and Rank
  133,981 bytes; budgets unchanged and met (total 1,480,184 bytes).
- **Verification.** `npm test`: 39 JS suites, 284 Python tests (two expected
  skips) (`.build/phase6-test.log`). Clean packaging and `npm run test:packages`
  passed (`.build/phase6-final-package*.log`). Package install test passed
  (`.build/phase6-final-install.log`). Rank and hub (all eight plugins) fixtures
  passed (`.build/phase6-*-fixture.log`). `git diff --check` passed. ZIPs: Stats
  423,352, Rank 74,667, hub 47,385, Compactor 45,917, Tidy 27,024, Captions
  26,683, Extractor 21,214, Multiscreen 15,712 bytes. Empty fixture folders from
  this session were removed; the 19 older ones remain.
- Exit criterion met: every plugin installs from the generated packages, the
  complete regression suite passes, conventions are documented, and the
  dependency graph (bundle inputs, declared packages and generated imports) and
  package contents satisfy the shared-runtime and offline-packaging contracts.
- Checkpoint: `.build/phase6-checkpoint/` (`review.patch` against the end of
  phase 5, changed-file list, git status).

#### Phase 6 next actions (exact)

1. Review `.build/phase6-checkpoint/review.patch` (and the phase 5 checkpoints).
2. Decide on the live install of DirtyPlugins 1.0.2, DirtyRank 1.0.2 and
   DirtyCompactor 1.0.2 (port 9999 runs 1.0.1). It needs explicit authorization:
   `npm run build`, back up and copy those three plugins' registry files
   (manifest last; Rank and Compactor gain `*_metadata.py`), reload, verify the
   served bundles, then hard-refresh Stash. The other five need no install.
3. Commit when ready, on `main`. No pushes or releases were made.

### Phase 5 — settings metadata generation (review checkpoint, 8 October 2026)

- User: "continue with phase 5" (after asking to keep things simple). Scope as
  planned: prove the generator on Multiscreen, then Rank's duplicated
  defaults/bounds/presets and Compactor's shared quality constants, extending
  only where duplication warranted it. That was the hub's standard-settings
  tables for Captions, Extractor and the hub theme (the hub would otherwise mix
  generated and hand-kept tables). Tidy (defaults only in Python) and Stats (no
  hub settings) were left alone. No live install; no version bumps (no
  user-visible change).
- **Design (kept small).**
  - `schemas/<pluginId>.settings.json` (six files): per setting `type`,
    `displayName`, `description`, optional `default`, `integer`, `min`/`max`/
    `step` and `options`; optional free-form `constants`. Key order is the
    manifest/hub order.
  - `scripts/generate-settings.mjs` validates schemas (unknown keys, types,
    bounds, options, default range) and generates: `.build/generated/<id>.settings.ts`
    (`order`, `defaults`, `limits`, `options`, `constants`) imported as
    `@generated/<id>.settings` through `tsconfig.migrated.json` paths; the
    staged manifest `settings:` section (merged with the pinned YAML parser);
    and Python constants (`DEFAULTS`, `LIMITS`, `OPTIONS`, `CONSTANTS`). Real-valued
    NUMBER settings stay Python floats (`1000.0`), `integer` ones stay ints.
  - Registry: `generatedImports` lists the generated modules a bundle may
    import (hub: dirtyPlugins/dirtyCaptions/extractScenes/multiscreen; Rank and
    Compactor: their own). `generatedFiles` marks staged Python modules
    (`dirty_rank_metadata.py`, `dirty_compactor_metadata.py`), which are also
    install files. The build rejects undeclared generated imports and a source
    manifest that still declares settings its schema owns. `npm run typecheck`
    generates first; fingerprints skip generated install files (schemas/ was
    already a shared input; CI already triggers on `schemas/**`).
  - Source manifests (hub, Captions, Extractor, Multiscreen, Rank, Compactor)
    lost their `settings:` sections; everything else stays authored.
- **Code now reading generated metadata.** Hub `constants.ts`
  (`PLUGIN_SETTING_ORDER`/`PLUGIN_DEFAULTS`/`FIELD_OPTIONS`/`FIELD_LIMITS` via one
  `standardTable` helper, `DEFAULT_VISUAL_THEME`, new `VISUAL_THEME_KEYS` injected
  into `theme.ts`), hub `metadata.ts` (public `settingsMetadata.multiscreen`
  shape unchanged; Multiscreen source untouched). Rank: `domain/settings.ts`
  (defaults, default categories, presets, static bounds, top-N message),
  `domain/navigation.ts` (leaderboard defaults/max, new
  `leaderboardPerformerCountMaximum`), `RatingSettings.tsx` and
  `PresentationSettings.tsx` (input bounds), `dirty_rank.py` (`_bounded`/
  `_bounded_integer` helpers; the unused `DEFAULT_SETTINGS` dict removed).
  Compactor: `rules.ts`, `dirty_compactor_rules.py`, `dirty_compactor_quality.py`
  (bitrate and CRF tables, quality and VMAF lists). Coercion, dynamic bounds
  (deviation floor/provisional threshold, performer-count multiples), option
  checks and algorithms stay handwritten in each language.
- **Parity method.** Before any change, `.build/phase5-capture.cjs`/`.py`
  recorded exact JSON for: all eight staged manifests; hub field definitions and
  initial values for every managed setting; Multiscreen normalization; Rank
  defaults, presets, parameters, and normalization/serialization/validation of
  25 settings × 46 probes (missing, null, empty, invalid strings, Infinity,
  booleans, below/at/above bounds, legacy numeric strings), 125 dynamic
  deviation combinations and 60 leaderboard count pairs; Compactor tables,
  estimates and rule validation (Python via `json.dumps`, so `1000` vs `1000.0`
  would show). Saved with the pre-change staging and source in
  `.build/phase5-baseline/`.
- **Parity result:** 168 comparisons, exact except two explained differences:
  (1) the Rank TSX bound literals the capture scraped are now `...limits.X`;
  a separate check confirmed the generated limits equal them, including the
  two fields without a step. (2) Python `QUALITIES` follows the UI order
  (`source` before `custom`); its only use is a membership check. TS
  `DEFAULT_SETTINGS` key order follows the manifest (compared order-free; it is
  not used outside tests). Real data, read-only snapshot then deleted: the
  stored Rank settings (27 keys) and Compactor rules (3) give identical exact
  results with the old and new backends.
- **Finding (pre-existing, not changed):** Rank's Python `normalize_settings`
  orders `categoriesByCohort` by iterating the `VALID_COHORTS` set, so the key
  order varies between processes (hash seed). Captures ran with
  `PYTHONHASHSEED=0`. Using `COHORT_ORDER` would make it stable; left for the
  user to decide.
- **Tests.** New `tests/test_settings_generation.js` (deterministic TS/Python/
  manifest output equals staging; no source manifest repeats a schema;
  validation rejects ten bad schemas; descriptions stating a default — "Defaults
  to N", "(default)", "Enabled/Disabled/Off by default" — agree with it) and
  `tests/test_generated_metadata.py` (staged Python constants equal the schema,
  ints vs floats). Updated: build-pipeline fixture (copies `schemas/`, rejects
  manifest/schema duplication and undeclared generated imports), bundle-size
  and Compactor UI input checks, the shared Stash-fixture helper (release
  metafile and development map sources), and five architecture contracts in
  `test_shared_ui_contract.py`/`test_dirty_rank.py` that pinned old literals
  (now asserting the schema plus the generated usage).
- **Verification.** `npm test`: 39 JS suites, 283 Python tests (two expected
  skips) (`.build/phase5-final-test.log`). Packaging and `npm run test:packages`
  passed (Compactor 10 and Rank 8 install files) (`.build/phase5-final-package*.log`);
  `git diff --check` passed. Extracted Rank/Compactor/hub ZIPs ran in isolated
  Python (`-I`) without the repository: imports, normalization and the protocol
  error path work. Isolated Stash fixtures (synthetic media) passed for the hub
  (all eight plugins), Compactor, Rank, Multiscreen, Captions and Extractor
  (`.build/phase5-*-fixture.log`), and the hub fixture with `--development`
  (generated modules appear as `../../../generated/…` map sources; the helper
  was fixed for that). Library-copy instance (paths redirected, read only):
  the Multiscreen, Extractor, Captions and hub theme settings pages and the Rank
  panel rendered in schema order with the generated bounds, options and the
  user's real values (stored theme applied, real Rank values recognised as the
  "Extremely confident" preset), with no plugin console errors; the copy was
  deleted afterwards.
- **Size:** release bundles +2,741 bytes in total (Rank +1,819, hub +610,
  Compactor +312; the other five byte-identical), within the size guard. ZIPs:
  Rank 74,623, hub 47,423, Compactor 45,917, Multiscreen 15,712 bytes.
- Line endings: one inline edit briefly rewrote Rank `src/domain/settings.ts`
  (LF) as CRLF through Python `write_text`; it was restored to LF. All other
  edits kept each line's ending (mixed files edited line by line).
- Leftovers: six empty `dirty-compactor-stash-*` folders from today's runs were
  verified empty and removed; the 19 older ones remain.
- Checkpoints: `.build/phase5-checkpoint-1-multiscreen/` (generator, schemas,
  hub tables, manifests), `.build/phase5-checkpoint-2-rank-compactor/`, and the
  final `.build/phase5-checkpoint-3-final/` (adds docs and the fixture helper
  fix), each with `review.patch` against `.build/phase5-baseline/source/`.

#### Phase 5 next actions (exact)

1. Review `.build/phase5-checkpoint-3-final/review.patch` (or the two earlier
   checkpoints for the Multiscreen proof and the Rank/Compactor step).
2. Decide whether to install phase 5 live. It changes shipped files for the hub,
   Rank and Compactor (bundles and Python) and the six manifests' layout, with no
   user-visible change. If yes: `npm run build`, back up and copy those plugins'
   registry files (manifest last; Rank and Compactor gain their `*_metadata.py`),
   reload and verify served bundles, as in `.build/install-size-release.ps1`.
   Decide whether that release bumps patch versions.
3. Done in phase 6: Rank's Python cohort order is stable.
4. Done: phase 6 completed (section above).

### Bundle size reduction step — complete (review checkpoint); A+B live as 1.0.1, C live as Stats 1.0.2

- User: "please continue the migration" after the plan gained the separate
  bundle size step. Implementing its three reviewable changes in order: A
  (release builds without inline maps), B (conservative minification), C
  (modular ECharts for Stats), then the size guard, patch versions and a
  backed-up local install. Phases 5–6 stay untouched; work stays uncommitted.
- Saved `.build/size-step-baseline/`: current staged plugins and 1.0.0 ZIPs
  (rollback and byte comparison), scripts/tests/docs, git status/diff and a
  497-file worktree hash inventory. `requireBuild()` confirmed fresh staging.
- **Change A complete (release builds without inline maps).** `npm run build`
  (also used by tests and packaging) stages release bundles without maps;
  `npm run build:dev` and `npm run build:watch` add inline maps. The mode is
  recorded in `build-state.json` (format 2), and `requireBuild(mode)` rejects
  staging built in the other mode with the right command. Node test modules
  keep inline maps (never installed). Package checks reject any `sourceMappingURL`.
- Acceptance: all eight release bundles equal the baseline bundles minus their
  map comment byte-for-byte; every other staged file is unchanged. Served JS
  totals **2,832,322 bytes** versus 8,824,346 (Stats 7,025,978 → 2,269,763).
  ZIPs: Stats 585,945 (was 1,792,378), Rank 82,416, hub 52,248, Compactor 47,177,
  Tidy 28,516, Captions 28,064, Extractor 22,177, Multiscreen 18,561 bytes.
- Tests: map-based dependency checks now read esbuild's recorded metafile; the
  build-pipeline fixture covers both modes, release = development minus map,
  mode mismatches and unknown options. All eight Stash fixtures share
  `verify_served_bundle`: release bytes/no map/plugin-only inputs by default,
  decoded TSX maps with `--development`. Freed imports were removed.
- `npm test` passed 37 JS suites and 278 Python tests (logs
  `.build/size-change-a-test.log`, `.build/size-change-a-final-test.log`);
  packaging and `npm run test:packages` passed; `git diff --check` passed.
  Isolated Stash: Stats fixture passed in release mode; Stats and Multiscreen
  passed with `--development` (decoded TSX); a release fixture on development
  staging failed with the expected rebuild instruction. Staging is release again.
- Docs: root README, AGENTS, hub STYLE, tests README and six plugin READMEs
  describe the two modes and the fixture option.
- Line endings: four files had mixed CRLF/LF at baseline (Compactor and Tidy
  READMEs, hub STYLE.md, tests/README.md). Editing normalized them; their
  original per-line endings were restored with only the textual edits kept
  (`git diff` unchanged). The root README and status doc were already
  normalized to CRLF by the previous turn's edits; Git's `autocrlf` makes the
  committed content identical, so they were left as is.
- One fixture run left an empty `dirty-compactor-stash-*` folder (Windows
  release timing); it was verified empty and removed. Sixteen older
  `dirty-compactor-stash-*` folders in `%TEMP%` predate this session.
- Checkpoint: `.build/size-change-a-checkpoint/` (changed files, `review.patch`
  against the exact baseline, change list). Next: Change B (minification).
- **Change B complete (conservative minification).** Release browser bundles
  use esbuild `minify` (whitespace, syntax, local identifiers) with `keepNames`;
  no property mangling is configured, and `legalComments: "inline"` keeps legal
  comments. Development bundles stay readable with maps; test modules unchanged.
  Plugin source never reads function names; `keepNames` (+46 KB total) keeps
  component names for React DevTools, diagnostics and the compiled-bundle
  harnesses. Measured variants: readable 2,832,322; minified 1,739,134;
  minified + keepNames **1,785,644 bytes** (legacy JavaScript 2,104,941).
- Finding (pre-existing since the phase 4 Stats port): the ECharts Apache header
  in `echarts.min.js` is a plain `/*` comment, so esbuild drops it from readable
  and minified bundles alike. The package keeps `vendor/ECHARTS-LICENSE` and
  `ECHARTS-NOTICE`. Change C should add an explicit attribution banner.
- Build-pipeline fixture now checks minified release code, preserved component
  names, host property names, kept legal comments, readable development code and
  release < development size. Full suite: 37 JS suites + 278 Python passed
  (`.build/size-change-b-test.log`). All seven per-plugin Stash fixtures passed
  against minified release bundles (`.build/size-change-b-*-fixture.log`).
- Browser smoke on an isolated all-plugin fixture (synthetic media only): all
  eight guards registered; all eight hub settings tabs rendered without alerts
  (Stats correctly reports no hub settings); Stats dashboard and growth chart
  (sized 267×280 once the pane was visible; a hidden pane reports 0×0), Rank
  battle/leaderboard empty states, Multiscreen grid with native players, the
  Extractor "Extract selected scene" operations-menu action and Captions scene
  fields all rendered. Console errors were only known host issues (Wake Lock
  denial, duplicate `google-cast-button`, ScenePlayer null `querySelector`) and
  404s for unGenerated `_thumbs.vtt` sprites; every plugin asset returned 200.
- **Size guard:** new `tests/test_bundle_size.js` with
  `tests/fixtures/bundle-sizes.json` (measured size, budget = +5% capped at the
  legacy JavaScript, legacy). It fails on budget breaches (verified with a
  deliberate breach), any shipped map, foreign inputs, or chart code outside Stats.
- **Release 1.0.1:** all eight manifests and the README table bumped once for
  this release (every shipped bundle changed). Final `npm test`: **38 JS suites
  and 278 Python tests** passed (`.build/size-change-b-final-test.log`);
  packaging and `npm run test:packages` passed; `git diff --check` passed.
  All-plugin and Stats fixtures passed at 1.0.1. ZIPs: Stats 523,322 (1.0.0:
  1,792,378), Rank 72,988, hub 47,201, Compactor 45,029, Tidy 27,022, Captions
  26,685, Extractor 21,227, Multiscreen 15,715 bytes.
- Checkpoint: `.build/size-change-b-checkpoint/` (`review.patch` against Change A).
- **Installed live** with `.build/install-size-release.ps1`: verified backups of
  all 64 replaced files, runtime files before manifests, no other file touched,
  then reload. Port 9999 reports all eight plugins enabled at **1.0.1**; every
  served bundle equals staging plus Stash's newline with no map; all 29 protected
  files (provenance manifests, caches, backups and the live shared database)
  kept their hashes. Live served JavaScript: 1,785,652 bytes (was 8,824,354).
  Backup: `.build/install-backups/20261005T104213223Z/` (also holds served copies).
  Log: `.build/size-release-install.log`. Hard-refresh the Stash tab (Ctrl+F5).
- **Change C (modular ECharts) is waiting for permission to download** pinned
  packages from registry.npmjs.org: `echarts-5.6.0.tgz` (Apache-2.0, 53.2 MB
  unpacked), `zrender-5.6.1.tgz` (BSD-3-Clause, 4.1 MB) and `tslib-2.3.0.tgz`
  (0BSD, 39 KB). None are in the local npm cache. Stats uses line, bar, pie,
  scatter, graph, map and treemap series; title, tooltip, grid, legend,
  dataZoom (inside/slider), visualMap, markLine, markArea and axisPointer; the
  canvas renderer and `registerMap`. Every bundle already meets the exit
  criterion without Change C (Stats 1,486,524 ≤ legacy 1,554,684).
- **User approved the download** ("yes, go ahead with the download").
  `npm install --save-dev --save-exact echarts@5.6.0` added exactly echarts
  5.6.0, zrender 5.6.1 and tslib 2.3.0 to `package-lock.json` (+1 line in
  `package.json`); CRLF endings kept. Licenses: Apache-2.0, BSD-3-Clause, 0BSD.
- **Security note:** `npm audit` reports GHSA-fgmj-fm8m-jvvx (moderate XSS, all
  ECharts < 6.1.0). It affects only the `lines` series tooltip without a custom
  formatter. Stats never uses `lines`, and the modular bundle no longer ships
  that chart's code at all (the previous full `echarts.min.js` 5.6.0 did).
  Upgrading to ECharts 6.x is a major change outside this step; not done.
- **Change C complete in the repository (Stats 1.0.2).**
  - New `plugins/DirtyStats/src/echarts.ts` imports `echarts/core` and registers
    only Bar, Graph, Line, Map, Pie, Scatter and Treemap charts; AxisPointer,
    DataZoom (inside+slider), Grid, Legend (incl. scroll), MarkArea, MarkLine,
    Title, Tooltip and continuous VisualMap components; the Canvas renderer. A
    `/*!` attribution banner survives minification. `index.tsx` imports it.
  - Registry: Stats declares `bundledPackages: ["echarts","zrender","tslib"]`
    and three new install files: `vendor/ECHARTS-LICENSE-d3` (d3-derived
    treemap/force/number code, BSD-3-Clause; this was already missing with the
    full vendored file), `vendor/ZRENDER-LICENSE`, `vendor/TSLIB-LICENSE`.
    ECharts LICENSE/NOTICE in npm equal the vendored copies.
  - Build: only declared packages may be loaded, from their resolved install
    directories; every other input stays link-checked and plugin-owned. A new
    build-pipeline case proves an undeclared package (`yaml`) is rejected.
  - Removed `vendor/echarts.min.js` (tracked) and `vendor/echarts.min.d.ts`
    after verification; hash-checked copies are in
    `.build/size-change-c-parity/removed-vendor/`.
  - Tests: registration test checks declared-package inputs, the banner, no
    full distribution, and that every series type configured in Stats source
    is registered in `src/echarts.ts`. The map-render test uses the npm
    `echarts` package. The size guard and the shared fixture helper allow only
    declared packages. Stats budget updated (measured 1,178,323; budget 1,238,016).
  - Docs: hub STYLE dependency inventory, AGENTS dependencies, root README,
    Stats README (bundled dependencies) and tests README. Stats is **1.0.2** in
    its manifest and the README table; other plugins stay 1.0.1.
- Size: Stats bundle **1,486,524 → 1,178,323 bytes**; all eight total
  **1,477,443 bytes** (A+B: 1,785,644; before the step: 8,824,346). Kept code
  after tree-shaking: world map 242 KB, zrender 190 KB, Stats code 178 KB,
  ECharts ~560 KB. Stats ZIP 423,352 bytes (1.0.1: 523,322).
- **Browser parity (isolated fixture, synthetic media only),** full 1.0.1
  bundle versus modular bundle, both served by the same fixture:
  - Static charts at DPR 1.25 with a warm image cache: **15 of 16 canvases
    byte-identical PNGs** across the dashboard and all 12 chart routes. The
    constellation's force layout is random (it also differs between two runs
    of the same build).
  - All **7 suite themes × 5 canvases byte-identical**; 7 distinct backgrounds
    confirm each theme applied.
  - Interactions: pointer hit-testing flags matched; clicking a point selected
    a scene identically; treemap roam and wheel behaviour matched; **PNG export
    byte-identical** (2424×1024, 98,855 bytes). Hover canvas states vary with
    tooltip timing even within one build (demonstrated), so they are not compared.
  - Method notes: the in-app pane was sometimes hidden, which pauses
    animation frames; captures therefore stubbed `matchMedia` to report reduced
    motion (Stats then disables animation). Earlier mismatches were explained:
    first-visit studio image loading and a DPR change between runs.
  - The fixture's own checks passed (exact served bundle, media/metadata
    unchanged) and its tree was removed. The only console error was a 404 for a
    never-generated native scene preview.
- Final checks after all edits: `npm test` passed **38 JS suites and 278 Python
  tests** (`.build/size-change-c-test.log`); packaging and `npm run
  test:packages` passed (Stats 11 install files); `git diff --check` passed.
  The final staged Stats bundle is byte-identical to the parity-tested one.
- Checkpoint: `.build/size-change-c-checkpoint/` (`review.patch` against Change
  B, change list, git status). Earlier: `.build/size-change-a-checkpoint/`,
  `.build/size-change-b-checkpoint/`, baseline `.build/size-step-baseline/`.
- **Stats 1.0.2 installed live (8 October 2026)**, as the user authorized.
  The handoff was re-verified first: `git status` matched
  `.build/size-change-c-checkpoint/git-status.txt` and every checkpoint
  `after/` file matched the worktree; `requireBuild()` reported fresh staging;
  port 9999 (Stash v0.31.1, `4de2351e`) reported all eight plugins enabled at
  1.0.1. `npm run build` restaged release output, and the Stats bundle stayed
  byte-identical to the parity-tested
  `.build/size-change-c-parity/dirtyStats-modular.js`.
  - `.build/install-size-release.ps1` now installs only `dirtyStats` at 1.0.2;
    the all-plugin 1.0.1 version is kept as `install-size-release-1.0.1.ps1`.
    It requires fresh release staging, the staged 1.0.2 manifest, exactly the
    11 registry files and live Stats at 1.0.1. It hashes every other file under
    the plugins root (all plugins, provenance manifests, caches, the shared
    SQLite database and its backups), backs up and verifies each replaced file,
    copies runtime and license files first and the manifest last, and reloads.
    It then checks the enabled version, the exact served bundle without a map,
    the other plugins' versions and served bundles, protected hashes, and that
    no unexpected file appeared.
  - Result: 11 files installed, three of them new (`vendor/ECHARTS-LICENSE-d3`,
    `vendor/ZRENDER-LICENSE`, `vendor/TSLIB-LICENSE`). `dirtyStats` is enabled
    at **1.0.2** and serves 1,178,324 bytes = staging 1,178,323 + newline, with
    no map. The other seven served bundles and the rest of the 14-plugin list
    are unchanged; all 173 protected files kept their hashes (the live database
    did not change). The replaced 1.0.1 bundle equalled
    `dirtyStats-full-1.0.1.js`. Live served JavaScript for the eight plugins is
    **1,477,451 bytes**.
  - Backup: `.build/install-backups/20261008T162640302Z/` (the eight replaced
    files, `installation.json` with `Existed` flags, protected-file and plugin
    lists, served bundles before and after). Log:
    `.build/size-stats-1.0.2-install.log`.
- Isolated fixture against the final manifest:
  `python -B tests/test_dirty_stats_stash_integration.py --binary <stash.exe>`
  passed (enabled 1.0.2, exact sole served release bundle without a map,
  Stats-only inputs; synthetic media and native metadata unchanged). Its
  temporary tree was removed. Log: `.build/size-stats-1.0.2-fixture.log`.
- Final checks: `npm test` passed typecheck, **38 JS suites** (size guard:
  1,477,443 bytes, within budget) and **278 Python tests** with the two expected
  skips (`.build/size-stats-1.0.2-test.log`). Packaging passed: the Stats ZIP is
  423,352 bytes with identity `1.0.2-34e1611-841ba876d080`, and the other seven
  ZIPs keep their 1.0.1 sizes. `npm run test:packages` verified all eight
  packages, Stats with 11 files (`.build/size-stats-1.0.2-package.log`,
  `.build/size-stats-1.0.2-package-check.log`). `git diff --check` passed. This
  status record is the only repository file changed since the Change C checkpoint.
- **Exit criterion met.** Packages and local installs carry no inline maps;
  development maps decoded to TSX in the served Stash context (Change A: Stats
  and Multiscreen fixtures with `--development`). Minified bundles pass the
  full suite and every Stash fixture (Change B logs). Stats renders every
  chart, theme and export with modular ECharts (parity above). Every release
  bundle is smaller than its legacy JavaScript: Stats 1,178,323 vs 1,554,684;
  Rank 132,162 vs 248,889; hub 49,639 vs 95,942; Compactor 35,783 vs 58,156;
  Multiscreen 28,815 vs 55,369; Tidy 22,636 vs 37,846; Captions 16,813 vs
  29,442; Extractor 13,272 vs 24,613 (total 1,477,443 vs 2,104,941). The size
  guard records these results.

#### Next actions (exact)

1. Hard-refresh (Ctrl+F5) the live Stash tab so the browser loads Stats 1.0.2.
   Only the served bytes were verified live; no acceptance runs against the
   live library, so a look at the live dashboard is the user's call.
2. Review the bundle size step: the three checkpoint patches
   (`.build/size-change-a-checkpoint/`, `.build/size-change-b-checkpoint/`,
   `.build/size-change-c-checkpoint/`, each with `review.patch`; baseline
   `.build/size-step-baseline/`), the size guard (`tests/test_bundle_size.js`,
   `tests/fixtures/bundle-sizes.json`) and this record.
3. Rollback, only if the review asks for it: copy the eight files from
   `.build/install-backups/20261008T162640302Z/dirtyStats/` back into
   `C:\Users\FABIO\.stash\plugins\dirtyStats\` (manifest last), delete the three
   new vendor license files (`Existed: false` in that backup's
   `installation.json`), then run `reloadPlugins`. Pre-1.0.1 files for all
   eight plugins are in `.build/install-backups/20261005T104213223Z/`; the 1.0.0
   ZIPs are in `.build/size-step-baseline/`.
4. Phase 5 has since been completed (section above); phase 6 needs the user's
   instruction. Committing, pushing and releasing are also the user's decision.
- Unresolved/unverified: the live Stats 1.0.2 UI in the user's browser (needs
  the hard refresh); DevTools stepping with `npm run build:dev`; other browser
  engines; live-library scale. `npm audit` still reports GHSA-fgmj-fm8m-jvvx
  (ECharts < 6.1.0, `lines` series only, which Stats neither uses nor bundles);
  an ECharts 6.x upgrade is out of scope for this step. Nineteen older
  `dirty-compactor-stash-*` folders in `%TEMP%` (27 September–5 October; three
  from 28 September still hold fixture files) predate this session; none were
  created on 8 October, and they were left in place.

### Library-copy test instance (8 October 2026)

- At the user's request (to proceed quicker with the porting), added the opt-in
  `tests/library_copy_fixture.py`: a second Stash (same binary, random port,
  fresh config and folders) on copies of the local Stash and DirtyPlugins
  databases, serving the eight staged plugins. File operations stay on the
  synthetic fixtures. Not a `test_` module, so `npm test` never runs it.
- Safety: copies use SQLite's read-only backup API. Every stored absolute path
  is redirected below a folder that does not exist, and the copy is refused if
  any path remains outside it. The live data had 200 folder paths across four
  roots (`P:`, `E:`, two on `C:`) and 3 plugin values (two Compactor records,
  one Extractor destination). Compactor automation is paused and Tidy set to
  manual (the live Tidy mode is `scan`). `DIRTY_PLUGINS_DATABASE_PATH` points
  backends at the copy. No generated files or images are copied. The copy is
  deleted on exit; `Fixture` now also cleans up when setup fails.
- `Fixture` (in `test_dirty_compactor_stash_integration.py`) gained optional
  `prefix` and `prepare` parameters; defaults keep every existing fixture
  unchanged. `tests/test_library_copy_fixture.py` covers redirection, the
  leftover check and the paused automation on synthetic databases.
- Verified: a dry run on scratch copies redirected 200 + 3 paths with none left
  over and `integrity_check` ok (scratch copies then deleted). The real run
  served all eight staged bundles exactly, loaded 1,380 scenes and 624
  performers with media paths under the missing folder, and the backends read
  the copy (Tidy `manual`, Compactor paused). Stopping it removed the copy
  (`.build/library-copy-fixture.log`). `npm test`: 38 JS suites, 281 Python
  tests (`.build/library-copy-test.log`); the Stats fixture still passes on the
  refactored class (`.build/library-copy-stats-fixture.log`).

### Phase 4 — DirtyStats completed (review checkpoint)

The bullets below are chronological; the closeout bullets after "Remaining"
record the final checks, install and review artifacts.

- Next: save its full pre-port baseline/rollback ZIP and whole-worktree inventory;
  convert registry, growth/ages/analytics, settings and chart/load services to
  strict imported modules, then focused TSX pages/dashboard. Preserve ECharts
  5.6.0, map content and vendor licenses; modular ECharts/minification belong to
  phase 6 and are not authorized here. Verify themes/contrast, PNG export,
  native filtering/cards, widget order/settings and capacity/forecast parity.
- Rank's completed full suite already exercises the unchanged legacy Stats;
  preserve its current 0.6.41 until the completed port meets acceptance.
- Saved `.build/phase4-stats-baseline/`: full plugin/tests/scripts/types/docs,
  whole-worktree hash inventory, binary diff and the exact staged rollback ZIP.
- First strict module split complete: registry, growth/forecast, ages/birthdays,
  generic abortable loaders, chart lifecycle and chart-option builders. Strict
  checking passes; 331 deterministic differential scenarios match pre-port
  0.6.41 exactly. Loader module tests cover pagination, bounded requests and stale
  responses; chart module tests cover resize, observer/export cleanup and partial
  initialization. Browser frontend remains legacy for this domain checkpoint.
- Native chart callbacks keep the original error object, including cross-realm
  errors (module regression caught an unnecessary Error rewrap; corrected).
- Domain checkpoint: `npm test` passed 35 JS suites, strict checking and all
  278 Python tests (51.902s, two expected skips). Log:
  `.build/phase4-stats-domain-test.log`; snapshot:
  `.build/phase4-stats-domain-checkpoint/`.
- Next: typed analytics/settings, focused statistic/card/dashboard TSX and
  guarded sole-script integration, then compiled/browser acceptance and install.
- Strict frontend port now stages one `dirtyStats.js` with private ECharts 5.6.0
  and unchanged world geometry; licenses remain install files. Registry includes
  analytics/settings/filter/dashboard/view test modules. Existing algorithm,
  settings/conflict, native-readiness, card and dashboard tests use modules.
  New compiled-bundle tests verify private vendor inputs, inline maps, dependency,
  duplicate/partial-registration guards, inactive fallthrough and owned cleanup.
- First TSX full run: 35 JS suites passed, one build-fixture failure; all 278
  Python tests passed (51.732s, two skips). Fixture copied only staged allowlist
  files and missed bundled vendor source inputs. Updated its source setup to
  copy authored vendor inputs; focused/full rerun pending.
- Isolated browser fixture active with 32 synthetic portraits/performers, six
  generated videos, dates/ratings/studios/tags and real source capacity. Exact
  served bundle and decoded route/growth/dashboard inline maps passed.
- Focused build pipeline rerun passed after its source fixture correction.
  Browser acceptance caught ECharts UMD `__esModule` without a default export;
  changed the private import to its typed namespace and validate chart methods
  before claiming the guard. Rebuilt charts render normally in real Stash.
- Browser checks passed native pagination (24 + 8 performers), search reducing
  map/cards to one performer, separate age performer filters across six scenes,
  and restoration of the origin search on return. Ratings, scatter, count/rating,
  quality, studios, tag DNA, constellation (32 nodes/496 edges) and birthday
  views render without errors; the zero-view repeat curve shows its empty state.
- Dashboard keyboard reorder, custom title, grouping, count validation (1–500),
  filtered three-card widget and autosave survive a full browser reload.
  PNG export created a valid native download despite the browser event waiter
  timing out; its saved file is retained as ignored review proof.
- Added module regressions for instance-owned request/chart cleanup, late and
  out-of-order configuration loads, canceled studio image loads, and clearing
  export refs even when native disposal throws. Focused tests/typecheck passed.
- Saved `.build/phase4-stats-tsx-checkpoint/`. Hash audit confirms all prior
  uncommitted files outside the explicit Stats/test/docs/registry allowlist
  unchanged. Python/CSS/licenses/ECharts bytes and world JSON content match
  the baseline. Removed only eight hash-verified retired authored frontend JS.
- Port manifest is now 1.0.0. Next: finish seven-theme rendering, final full
  suite/package checks, final fixture served-map verification/cleanup, then
  backed-up staging install on port 9999 and separate review checkpoint.
- Final `npm test` passed strict checking, all 37 JavaScript suites and 278
  Python tests (52.997s; two expected skips). Log:
  `.build/phase4-stats-final-test.log`. Seven suite themes render all four
  dashboard canvases without errors; CSS contrast tests also pass all themes.
  Export proof is a real 2424×1024 PNG (98,836 bytes), including the real
  capacity line. Fixture now serves enabled Stats 1.0.0 and exact final staged
  JS with one inline map; decoded TSX positions pass again.
- Remaining: final package/content checks, final browser proof and fixture
  cleanup, authorized backed-up live staging install, review snapshot/status.
- Closeout (continuation on 5 October 2026): the previous agent stopped after
  packaging, the dashboard screenshots and a controlled fixture extension (21
  recorded views, scenes 1–6 played 1–6 times, re-snapshotted with counters).
  Its isolated fixture (port 60983) was still running and Stats was not
  installed live (port 9999 still served 0.6.41). Re-read AGENTS, plan, status
  and baseline; preserved all uncommitted work.
- Fixture served the exact current staging plus Stash's newline. Browser pass on
  the compiled bundle: the dashboard and all 13 statistic routes render with sized
  chart canvases (Birthdays is a calendar view by design), correct page titles,
  no alerts and no plugin console errors/warnings. Repeat-offender curve now
  reports "Top 5% (1 scene) account for 28.6% of 21 recorded views" (6/21),
  replacing the earlier zero-view empty state; Birthdays shows 32 within 30 days.
- Stopped the fixture via `.build/stats-acceptance-stop`: runner verified media
  hashes, scene/performer identities and native metadata (with counters)
  unchanged, then removed its temporary tree. Only live Stash (PID 30808)
  remains; the browser tab is closed. The runner process predated the 11:47 edit
  adding a post-serve frontend check, so that check did not run in-process;
  byte equality was rechecked during closeout, and decoded maps passed at 11:44
  (`.build/stats-final-served-map.log`) and again on live port 9999.
- Final `npm test` after all edits: strict/legacy typecheck, **37 JavaScript
  suites and 278 Python tests** (44.111s; two expected skips). Two logged stack
  traces are intentional failure-path tests. Log:
  `.build/phase4-stats-closeout-test.log`.
- `build_site.sh _site/main` and `npm run test:packages` passed for all eight
  ZIPs (Captions 8, Compactor 9, Extractor 8, Multiscreen 5, hub 12, Rank 7,
  **Stats 8**, Tidy 7). The Stats ZIP holds the manifest, sole JS, CSS, Python,
  README, LICENSE and ECharts license/notice; no source, map files, vendor
  inputs, tests, caches or databases. Logs: `.build/phase4-stats-closeout-package.log`,
  `.build/phase4-stats-closeout-package-check.log`. `git diff --check` passed.
- `node .build/check-stats-baseline.cjs` passed: all non-Stats prior work is
  hash-identical to the pre-port inventory except intended documentation and
  test/registry edits; Python, CSS, licenses and `echarts.min.js` bytes and the
  world JSON payload are unchanged. AGENTS.md was added to its intended-edit set
  for the one-line legacy note below.
- Metrics (`.build/phase4-stats-metrics.json`): 40 strict TS/TSX files (22
  component files), 5,499 lines versus 4,352 legacy lines. The map has 35
  runtime TS/TSX inputs plus private `vendor/echarts.min.js` and `vendor/world.js`,
  and no inputs from other plugins, React or the hub. JS before the map is
  **2,269,763 bytes** versus 1,554,684 legacy bytes including vendor (275,584
  app-only); the inline map adds 4,756,215 bytes, of which 1,580,981 are embedded
  sources. Full bundle **7,025,978 bytes**, SHA-256
  `67a4015eb4cce5eb4ada2026b199396e0987960ae4d185cef3fbc59f555e03a6`.
  ZIP 1,792,378 versus baseline 510,521 bytes.
- Installed from staging with `.build/install-stats.ps1` (user-authorized):
  verified backups, eight registry files copied with the manifest last, then
  removed only the five backed-up obsolete files of the older installed 0.6.41
  (`dirtyStatsGrowth.js`, `dirtyStatsAges.js`, `dirtyStatsDashboard.js`,
  `vendor/echarts.min.js`, `vendor/world.js`) and reloaded plugins. Shared SQLite,
  the Stats and hub package-provenance `manifest` files and every other existing
  file kept their hashes. No settings, databases or runtime data were copied.
  Backup: `.build/install-backups/20261005T100117154Z/`.
- Live port 9999 reports DirtyStats **1.0.0** enabled. `.build/verify-live-stats.py`
  (read-only) passed: all eight installed files equal staging (only Stash's
  provenance `manifest` is extra), exact served bundle plus newline, one inline
  map, Stats-only inputs and decoded route/growth/dashboard TSX. Log:
  `.build/phase4-stats-live-verify.log`. The live UI was not opened because the
  live library holds personal media; acceptance used synthetic fixtures only.
- Updated the root README migration paragraph (Rank and Stats were missing; all
  eight now ported) and AGENTS.md's stale "Legacy DirtyStats" sentence.
- Review artifacts: `.build/phase4-stats-review-checkpoint/` (final Stats source,
  tests, scripts and docs, 1.0.0 ZIP, metrics, worktree patch, git status and
  synthetic screenshots); baseline-to-port comparison `.build/phase4-stats.patch`;
  pre-port rollback ZIP `.build/phase4-stats-baseline/DirtyStats-rollback.zip`.

#### DirtyStats verification limits and exact next actions

- **Bundle size needs a decision.** Stash loads `/plugin/dirtyStats/javascript`
  on every page: 7.03 MB now versus 1.55 MB legacy. esbuild reprints the
  minified ECharts readably (+0.7 MB code), and the inline map embeds ECharts and
  world sources. This follows the plan's readable-bundle/inline-map policy.
  On 5 October 2026 the user asked for size reduction as its own step: the plan's
  "Bundle size reduction" section (after phase 4) now holds release builds
  without inline maps, minification and modular ECharts, with measurements for
  all eight bundles (8.8 MB served versus 2.1 MB legacy). Not started. Until it
  ships, roll back with the backup above if page load is noticeably slower.
- Source readability: like Rank, Stats keeps `createX(dependencies)` factory
  wiring and converted `var` style; 331 lines exceed 160 characters (26 exceed
  400). Strict checking and parity tests pass. Any formatting/readability pass
  should be a separate, behavior-neutral change after review.
- Unverified: DevTools breakpoint stepping (no debugger control in the browser
  tools), other browser engines and live-library scale. The PNG export proof is a real file, but the browser download-event waiter
  timed out. To step manually, run the fixture with a **new, absent** stop file,
  open `/plugin/dirtyStats/javascript` in DevTools Sources and step `Growth.tsx`
  or `dashboard/Page.tsx`; then close the tab and create the stop file:

```powershell
python -B tests/test_dirty_stats_stash_integration.py --binary 'C:\Users\FABIO\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\stash.exe' --serve --stop-file .build/stats-review-stop
```

- Ctrl+F5 the live Stash tab, then review entry/runtime/types, domains,
  settings, components/dashboard TSX, registry/sole-script manifest, module and
  compiled-bundle tests, opt-in fixture and documentation. Keep the rollback ZIP
  and install backup. Phase 4 is complete; do not start the bundle size step or
  phases 5–6 without the user's next instruction.

### Phase 4 — DirtyRank completed (review checkpoint)

- Re-read AGENTS, plan, status and baseline. Saved pre-port plugin sources,
  affected tests/types/registry/docs, a whole-worktree hash inventory and diff,
  and a staged rollback ZIP under `.build/phase4-rank-baseline/`.
- `npm ci --offline` passed. The first baseline runner overlapped creation of
  incomplete TS source; architecture tests detected that source and failed.
  Moved the unfinished source into ignored output and reran the baseline before
  continuing. Record the clean result below; this overlap was not a legacy failure.
- Split Rank into settings/rating/matchmaking domain conversion, typed UI/media
  and guarded integration, then shared settings-hook adoption. Preserve rating,
  matchmaking, optimistic serialized voting/undo, revision conflicts, native
  filters/sorts, route identities and owned media/effect cleanup. Keep Python,
  CSS and data formats unchanged; retain 0.7.68 until acceptance passes.
- Clean pre-port baseline: 33 JS suites and 278 Python tests passed (90.953s,
  two expected skips). Domain checkpoint saved in
  `.build/phase4-rank-domain-checkpoint/`: strict settings/rating/matchmaking,
  navigation and rank services; 405 seeded legacy differential comparisons,
  JS/Python parity, settings boundaries and stale-index revision checks pass.
- Domain full runner passed 278 Python tests and 33 JS suites; its one failing
  build-fixture suite omitted prepared sources when `bundle` was null. Fixed
  fixture copying for either bundle or testModules, then focused build pipeline
  and all eight package-content checks passed. Final full rerun remains required.
- Typed UI checkpoint saved in `.build/phase4-rank-tsx-checkpoint/`. Native
  preview/card, battle/session, standings/layouts, native filter/sort and four
  settings editor components now use internal imports and host classic JSX.
  Settings controller adopts the public shared draft hook with the existing
  revision precondition, current-preset snapshot and local reset workflow.
- Registry stages only `dirtyRank.js`, with seven domain/UI/session CJS test
  modules. Guard is claimed before registration; duplicate/partial failure,
  inactive native fallthrough, settings unregistration and owned effects pass
  compiled-bundle integration tests. Source-contract checks now inspect TSX;
  module tests retain the existing media/layout/queue/undo assertions.
- Strict checking and focused media/session/registration tests pass. A temporary
  helper's Windows default encoding damaged Unicode in four new settings files
  and Rank's test source; corrected explicitly to UTF-8. Rank Python's 51 tests
  now pass; the remaining shared contract assertion is being updated to the
  actual revision-ref name. No backend behavior changed.
- Next: finish cleanup tests and source contracts; full tests and packaging,
  isolated synthetic Stash browser and served-map acceptance, remove replaced
  legacy source, version 1.0.0, and backed-up staging installation (manifest last).
- First complete-port `npm test` passed **34 JavaScript suites and 278 Python
  tests** (76.442s; two expected skips), log
  `.build/phase4-rank-acceptance-test.log`. Strict checking, module media/session
  and compiled registration tests pass after removing the six backed-up legacy
  authored scripts. Added older-refresh/unmount rejection for session loads,
  leaderboard loads and settings-reset callbacks; teardown clears owned caches.
- Isolated Stash on port 49324: exact served IIFE plus newline, one embedded
  plugin-only map and decoded settings/player/podium TSX pass. Fixture generates
  nine portraits/performers, two seekable videos and a 2–4s marker, seeds eight
  independent rating pools, then verifies exact pool restoration after undo
  while the revision advances. No live library or port 9999 is used.
- Browser verified muted marker playback and pause at ~4.08s, immediate tie
  advancement with queued save, ArrowDown undo and restored ratings, King of
  the Hill route, podium/gallery pagination, four-person Mount Rushmore/table
  and native name filter (one Gamma result, original overall rank retained).
  Automatic full-scene previews render and finish normally.
- Browser exposed a React 17 save-status race: the shared hook's accepted
  normalized draft can render before its controller status callback. Rank now
  reports Saved when its ready draft matches the accepted baseline, while
  retaining pending/error states for unsaved values. Module regression and
  isolated browser Saved status pass; persistence/revision policy is unchanged.
- Current: finish Fingers/Gauntlet/native sort acceptance, final version/docs,
  full/package rerun and local installation; then save Rank review checkpoint
  and begin the independently backed-up DirtyStats port. Phases 5–6 untouched.
- Completed remaining browser acceptance: five-person Fingers/table, saved
  settings reloaded across routes, native performer Overall score ASC (all eight
  rated performers in score order; unrated Iota last), performer-page Gauntlet
  launch/target and native player removal on route exit. Browser console has no
  errors. Proof: `.build/phase4-rank-review-checkpoint/gauntlet.png` contains only
  generated fixture media. Fixture process and temporary directory are gone;
  agent-created browser tab closed; original files/native metadata unchanged.
- Final `npm test` passed **34 JS suites and 278 Python tests** (72.430s, two
  expected skips). Packaging and all eight content/identity/dependency/hash
  checks pass; Rank ZIP contains exactly seven staged files. Logs:
  `.build/phase4-rank-final-test.log`, `.build/phase4-rank-final-packages.log`.
- Port set to **1.0.0** in manifest/root documentation. Saved 26 TS/TSX files
  (5,251 lines versus 5,043 legacy lines). Bundle is 794,824 bytes including its
  inline map; executable content before the map is 253,453 bytes versus 248,889
  bytes across six legacy scripts. Module formatting/type contracts and required
  map embedding account for the change; no runtime React implementation added.
- Installed from staging into `C:\Users\FABIO\.stash\plugins\dirtyRank` using
  `.build/install-rank.ps1`: backed up replaced/obsolete files, copied seven
  registry files with manifest last, removed only five backed-up obsolete scripts,
  reloaded plugins. Shared database and Rank/hub package provenance hashes are
  unchanged; no settings/runtime directories copied. Backup:
  `.build/install-backups/20261005T083713435Z/`.
- Live port 9999 reports DirtyRank enabled at 1.0.0 and serves the exact staged
  bundle plus Stash's newline, with one inline map. Bundle SHA-256:
  `00920125ef7571a0741048e89827a07fdd7ea114b6d8a735d30c39c59222b7a4`.
- Acceptance limits: DevTools breakpoint stepping was not verified; decoded
  source-map component positions and actual compiled browser execution passed.
  Native DESC ordering and initial 30–70% autoplay timestamp are covered by module
  scenarios; browser measured native ASC ordering, muted playback and completion.
  This fixture does not establish behavior at live-library scale or on old browsers.
- Whole pre-port inventory confirms every unrelated earlier uncommitted file
  remains byte-identical. Review snapshot/metrics/patch are under ignored
  `.build/phase4-rank-review-checkpoint/`. Continue only DirtyStats phase 4;
  phases 5–6 remain untouched and all work remains uncommitted.

### Phase 4 — DirtyMultiscreen completed (review checkpoint)

- Read AGENTS, plan, status and baseline. Preserved all existing work; saved
  frontend/CSS/manifest, affected tests, registry, root/test documentation,
  worktree inventory/diff and the seven-file rollback ZIP in ignored
  `.build/phase4-multiscreen-baseline/`.
- `npm ci --offline`, `npm run build` and the legacy Multiscreen suite passed.
- Convert settings/playlists/items/context/query/count services into strict
  imports with focused TSX controls, route, navigation, counter, grid and native
  player components. Reuse Stash React and the public hub; retain ordinary hub
  settings/autosave, CSS and stored formats. Emit only `multiscreen.js`.
- Entry claims the guard before non-removable registration; failed partial
  registration remains inert. Owned effects stop listeners/observers/timers;
  route teardown removes native players through React. Async requests reject
  stale responses after refresh, unmount or teardown. No phases 5–6 work.
- Strict/legacy `npm run typecheck`, module/bundle suites and all 52 shared UI
  contracts passed. Removed the three legacy authored IIFEs/private algorithm
  globals; seven selected CJS test modules keep domain tests independent of
  bundle variable names. Bundle tests cover missing host, duplicate/partial
  route/patch failure, all selection/detail contexts, count debounce/cache,
  grid clamps/splits, marker loops/fallback/advance, per-pane audio persistence,
  hidden-tab resume, counters, stale loads and observer/listener/player cleanup.
- First full `npm test` passed **33 JavaScript suites and 278 Python tests**
  (53.808s, two expected combined-runner skips). Log:
  `.build/phase4-multiscreen-test.log`. Source formatting/const cleanup followed;
  strict checking still passes. Rerun focused/full after final edits/version.
- Isolated Stash 0.31.1 at port 52154: exact sole served JS plus newline,
  one inline map and decoded LoadedNativePlayer/Grid/Counter TSX positions pass.
  Four synthetic scenes, two bounded/fallback markers, a performer and a studio
  exercise contextual counts, list order, selected IDs and HTTP range streams.
- Browser: native descending Title context produced Gamma/Delta/Beta/Alpha
  across four panes; all real native videos play with readyState 4 and muted
  audio. Native first-pane unmute/volume adjustment leaves other panes muted.
  Visible-scene O action saved once for each scene (all four counters are 1).
  Saved raw `totalScreens=99` still renders only four cells in the 2x2 grid.
  Standard hub settings intentionally retain/persist raw numeric values even
  when the native input reports rangeOverflow; playback normalization clamps
  them. Preserved this existing policy; no hub/settings redesign.
- Completed browser acceptance with the compiled bundle: standard settings show
  Unsaved/Waiting, then Saved automatically; new sessions load persisted values.
  Reusable playlists start both panes on Alpha; native Next/Previous preserves
  first-pane unmute and 90% volume while the other pane remains muted. Selecting
  Gamma then Alpha launches that ID order; native Next goes Gamma → Alpha.
  Performer detail shows two matching scenes. Marker selection Fallback then
  Explicit preserves order; starts at 4s/1s, loops within 4–6s/1–3s when enabled,
  and automatically advances at the boundaries when disabled. Closing removes
  all `.ms-grid` and `video-js` elements. Capture mode computes hidden visibility
  for native videos and titles and displays its opaque documentation cover.
- Temporarily served the saved legacy scripts in the same disposable fixture
  and reloaded the browser. Native Google Cast duplicate custom-element errors
  and ScenePlayer's null-querySelector ready callback reproduced with the legacy
  frontend; they originate in host/gstatic assets. Also reproduced the native
  whole-scene completion quirk: with auto-start disabled, loop=true seeks to 0
  and the native player pauses. The compiled port preserves that behavior.
  Marker loops continue playing because they seek before native media end.
- The available in-app browser keeps `document.hidden=false` when another tab
  opens, so actual tab-switch pause is unverified. Bundle tests cover hidden
  pause, only-resume-previously-playing behavior,
  new autoplay while hidden, disabled pause and listener cleanup. Manual
  breakpoint/step debugging and other engines/fullscreen/casting remain unverified.
- Final cleanup refinement detaches an old volume listener immediately when its
  player element disappears, before any replacement is mounted. A bundle test
  covers removal, reattachment, late ready callbacks and final teardown. Requests
  and deferred counts reject stale completions; counter retries preserve failed
  original scene IDs even after playback advances.
- A saved-baseline differential check passed **1,040** settings/seeded-playlist
  cases. CSS matches the pre-port baseline byte-for-byte. Authored frontend:
  **19 strict TS/TSX files**, including **seven focused component files**, 1,362
  lines versus 1,409 legacy lines. Eighteen runtime inputs are exclusively
  Multiscreen-owned; type-only hub/React contracts erase. JS before its inline
  map: **60,095 bytes** versus 55,369 legacy bytes; full readable bundle:
  **193,262 bytes**. ZIP: **53,962 bytes** versus saved baseline 18,717 bytes.
  Inline development maps remain intentional; phase 6 optimization has not begun.
- Set the first completed port to **1.0.0** after acceptance, then updated source,
  installation and test documentation. Final `npm test` passed strict/legacy
  checking, all **33 JavaScript suites**, and **278 Python tests** (64.122s;
  two expected combined-runner skips). Log:
  `.build/phase4-multiscreen-final-test.log`.
- `& 'C:\Program Files\Git\bin\bash.exe' build_site.sh _site/main` built all
  eight ZIPs; `npm run test:packages` passed exact staged contents, identities,
  dependency declarations, root manifests, Pages paths and SHA-256 checksums.
  Runtime counts: Captions 8, Compactor 9, Extractor 8, **Multiscreen 5**, hub 12,
  Rank 12, Stats 17, Tidy 7. No standalone TS/TSX, test/CJS/tooling files,
  React/hub implementation copies, database/cache/bytecode or media is packaged.
  Log: `.build/phase4-multiscreen-packages.log`.
- Reinstalled the final five-file staging into the isolated fixture, manifest
  last, and reloaded. Enabled **1.0.0**, exact aggregate bytes plus Stash newline,
  sole inline map, embedded sources and decoded player/grid/counter mappings
  passed. Fixture media bytes, scene/file IDs and unrelated metadata stayed
  unchanged; only the intended synthetic O counters and settings were changed.
- Local authorized install used `.build/install-multiscreen.ps1`. Backed up all
  five replaced files and the two obsolete feature scripts, recorded hashes,
  copied the sole-script manifest last, removed only the two backed-up obsolete
  JS files, then reloaded plugins. Backup:
  `.build/install-backups/20261004T200414269Z/`. Shared SQLite and both the
  Multiscreen/hub package-provenance `manifest` hashes stayed unchanged; no
  settings, databases or runtime data were copied or removed.
- Live port **9999** verifies enabled **Multiscreen 1.0.0**, all five installed
  files equal staging, the exact sole served bundle plus its final newline,
  one inline map and decoded LoadedNativePlayer/Grid/Counter positions.
  Hard-refresh the live browser tab (Ctrl+F5); plugin reload does not refresh it.
- Closed both temporary browser tabs and gracefully stopped the named fixture
  through `.build/multiscreen-fixture-stop`. Its temporary tree is gone; only
  original live Stash PID **9124** remains. Browser proof is outside the repo:
  `C:\Users\FABIO\.codex\visualizations\2026\10\04\01a10861-85aa-7fd0-a7c0-09a437c96198\multiscreen-settings.jpg`.
  No commits, pushes or releases; earlier changes remain preserved. Verified all
  **79 unaffected prior tracked diff sections** and every other plugin registry
  entry unchanged against the initial snapshot. Review source
  comparison: `.build/phase4-multiscreen.patch`; metrics:
  `.build/phase4-multiscreen-metrics.json`; final source/tests/registry snapshot:
  `.build/phase4-multiscreen-checkpoint/`. `git diff --check` passed.

#### DirtyMultiscreen verification limits and exact next actions

- Review the guarded entry/host contract, settings/playlists/context/query domains,
  lifecycle service, seven TSX components, sole-script manifest/registry, module
  and compiled-bundle tests, opt-in fixture and documentation. Keep the ignored
  rollback ZIP and verified install backup. This checkpoint is complete.
- Reproduce with `npm test`, the command below, packaging and `npm run
  test:packages`; finish with `git diff --check`.

```powershell
python -B tests/test_dirty_multiscreen_stash_integration.py --binary 'C:\Users\FABIO\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\stash.exe' --serve --stop-file .build/multiscreen-review-stop
```

- Use a **new, absent** stop file. The fixture prints its random non-9999 URL.
  After review close the browser and create that file to remove all fixtures.
- Actual hidden-tab transition is unverified in this browser API. In a normal
  supported ES2020 browser, play two synthetic panes, pause one manually, switch
  tabs and verify the other pauses; return and verify only the formerly playing
  pane resumes. Repeat with Pause when hidden disabled, and navigate away to
  confirm no remaining video/listener activity. Bundle tests cover these paths.
- DevTools stepping is unverified. Set and step a breakpoint in embedded
  `LoadedNativePlayer.tsx`, `Grid.tsx` or `Counter.tsx` through the real aggregate
  `/plugin/multiscreen/javascript`. Source-map decoding is verified on fixture
  and live URLs. Other engines/mobile fullscreen/casting and a visual selection
  spanning native pages are unverified; off-page selection IDs are bundle-tested.
- Whole-scene continuous repeat with native auto-start/loop controls enabled is
  unverified. With default auto-start disabled, both legacy and compiled clients
  reset to zero and pause at native completion. Marker loop/advance, initial
  mute, per-pane volume persistence and native Next/Previous were verified.
  Any change to the native completion policy belongs to a separate behavior fix.
- Standard hub numeric autosave retains raw out-of-range values (99 persisted
  with native rangeOverflow); runtime normalization clamps grid geometry.
  This pre-existing shared policy was preserved. No new settings abstraction or
  metadata generation was introduced.
- Wait for user review/continuation before DirtyRank. Do not start DirtyRank,
  DirtyStats, metadata generation, ECharts changes or phases 5–6 here.

### Phase 4 — DirtyCaptions completed (review checkpoint)

- Re-read AGENTS, plan, status and baseline; preserve all existing work. Saved
  the original frontend/backend/manifest, affected tests, registry, package ZIP
  and working-tree inventory in `.build/phase4-captions-baseline/`.
- Port track helpers/service, native enum/custom-field filter integration and
  index controls into typed imports and focused TSX. Retain standard hub
  autosave, in-memory VTT/data URLs, native source-selector timing, owned-track
  cleanup, file-map skip behavior, partial custom-field writes and job identity
  deduplication. Do not alter Python or add timer-based library checks.
- Scope: module/bundle tests, guard and teardown handling; focused/full suite,
  isolated synthetic subtitle/index/filter/Scan acceptance, served maps,
  packages and local install. Retained version 0.2.3 during acceptance and
  assigned 1.0.0 after the port passed. Stop before Multiscreen.
- Implemented 12 strict source files: typed host/media/filter contracts, imported
  language/settings and tracks, native filter serialization/list adapter, four
  focused TSX components and guarded registration. One staged `dirtyCaptions.js`
  replaces three IIFEs/private feature globals; five CJS module entries serve
  tests. Python/CSS are unchanged; version stayed 0.2.3 during acceptance.
- Passed strict/legacy typecheck, native tracks/settings/cleanup tests, all six
  filter categories and criterion-order/URL/bookmark regressions, Scan identity
  replay/restart/retry tests, bundle player/retry/late-response/index action/
  masking/guard/cleanup checks, and all 52 shared UI contracts. Explicit teardown
  removes owned configuration listeners, status/player timers, observers and
  tracks; native non-removable patches retain an inert guard. The host's job
  subscription remains tied to its React lifecycle.
- Index controls use synchronous action locking and reject late status polls
  after a newer action. No recurring library check was introduced.

- Full `npm test` passed strict/legacy checking, all **32 JavaScript suites**
  and **278 Python tests**, with two expected combined-runner skips. The final
  log is `.build/phase4-captions-final-test.log`. Initial new test failures were
  corrected in the React clone/criterion harness; the final suite passed.
- Isolated Stash 0.31.1 on port 49574 passed real FFmpeg stdout WebVTT for two
  synthetic language tracks, Unicode/default selection and empty media; no
  subtitle sidecars. The file map skips inaccessible unchanged media, forced
  probes remain unverified on error and recover after restoration. Partial
  writes preserve unrelated custom fields; successful Scan identity claims
  deduplicate concurrent clients/replay and exclude internal scans. Media bytes,
  scene/file IDs and metadata remain unchanged; hook jobs settle.
- Browser acceptance passed English preference over the French file default,
  persistent CC Off, seeking and a real MP4 transcode starting at five seconds,
  track replacement and French Unicode cues. Native Text captions selects only
  the caption fixture; normal custom-field URL reload and native saved-filter
  save/load restore the enum and results. Standard preferred-language controls
  show unsaved/waiting then Saved automatically and persist `fra` in the hub.
  Served bundle matches staging plus Stash newline; inline TSX sources/mappings
  decode correctly.

- Real compiled index controls passed incremental Refresh (zero probes, two
  unchanged scenes skipped) and Reprobe all files (two successful probes).
  A native Scan with the browser mounted completed as job 11 and its App job
  subscription queued exactly one caption job 12; replay retained the same
  job ID/lastFullScan. Capture mode computed `visibility: hidden` for video,
  poster, scrubber and rendered captions. No caption-generated console error
  appeared. A native marker `ready` callback reports a null `querySelector`
  on rapid player navigation; the identical stack reproduced with DirtyCaptions
  disabled, along with native Cast/player initialization errors. This is a
  Stash host limitation, not changed by the port.
- Acceptance found no port defect. Set **1.0.0** and update root/plugin/test
  installation and development documentation. Final `npm run build`, strict/
  legacy typecheck, three caption Node suites, all 52 shared UI contracts and
  **45 caption Python tests** passed. The full suite above covers the final
  frontend; subsequent edits only assign the version and document the result.
- `& 'C:\Program Files\Git\bin\bash.exe' build_site.sh _site/main` built all
  eight ZIPs. `npm run test:packages` passed identities, dependencies, root
  manifests, Pages paths, staged bytes and SHA-256 checksums. Runtime counts:
  **Captions 8**, Compactor 9, Extractor 8, Multiscreen 7, hub 12, Rank 12,
  Stats 17, Tidy 7. No TS/TSX, test/CJS/tooling files, external React/hub,
  SQLite, cache, bytecode or runtime media is packaged.
- Three Python files and CSS match the preserved pre-port baseline byte-for-
  byte. Twelve typed files/four component files contain 643 source lines;
  eleven runtime inputs are exclusively Caption source (types erase). JS before
  its map: 31,154 bytes versus 29,442 legacy bytes. Readable inline-map bundle:
  106,081 bytes. ZIP: 51,132 bytes versus baseline 29,296. Development maps
  remain deliberate; phase 6 optimization has not started. Review comparison:
  `.build/phase4-captions.patch`; metrics: `.build/phase4-captions-metrics.json`.
- Installed all eight staged files into
  `C:\Users\FABIO\.stash\plugins\dirtyCaptions`, manifest last. Removed only
  backed-up obsolete `dirtyCaptionsTracks.js` and `dirtyCaptionsIndex.js`.
  Live port 9999 confirms enabled **1.0.0**, exact sole staged JS plus Stash's
  newline and one inline map; decoded CaptionsController/IndexSettings/
  IndexMonitor mappings pass on both fixture and live aggregate URLs. Shared
  SQLite and Captions/hub package-provenance hashes stayed unchanged. Runtime
  caches/data were preserved. Backup:
  `.build/install-backups/20261004T192138534Z/`; installer:
  `.build/install-captions.ps1`. Hard-refresh the user's live tab (Ctrl+F5).
- Final fixture manifest and a fresh page show **1.0.0** with the saved language.
  Closed the acceptance tab and gracefully stopped the fixture through
  `.build/captions-fixture-stop`; its temporary tree is gone. Only original
  live Stash PID 9124 remains. No commits, pushes or releases; earlier work is
  preserved. Synthetic browser proof stays outside the repository under
  `C:\Users\FABIO\.codex\visualizations\2026\10\04\01a10646-ea75-7a31-9319-e7f9448a470c\`:
  `captions-player.png` (French cue during native transcode) and
  `captions-settings.png` (frozen version and saved settings).

#### DirtyCaptions verification limits and exact next actions

- Manual DevTools breakpoint/step debugging is unverified: the browser API
  has no debugger control. Served maps and decoded TSX positions are verified.
  Run `python -B tests/test_dirty_captions_stash_integration.py --binary
  'C:\Users\FABIO\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\stash.exe'
  --serve --stop-file .build/captions-review-stop` with a new, absent stop file;
  open the printed fixture URL and step CaptionsController or IndexSettings
  from `/plugin/dirtyCaptions/javascript`. Close the tab, then create the
  named stop file for graceful cleanup.
- Live Stop refresh timing is unverified because the two-file fixture finishes
  before that action is available. Bundle/backend tests cover cancellation,
  status races, action locking and late-response cleanup. For manual timing,
  use a larger synthetic-only fixture, Reprobe, Stop refresh while running,
  verify Cancelled, then refresh and verify cached results are reused.
- Other browser engines/mobile fullscreen/casting are unverified. Real native
  external-caption coexistence and bitmap-only media were not created for this
  fixture; track/module/backend tests cover priority/owned removal and unsupported
  formats. Browser acceptance covered two text languages, Off, seeking,
  transcoding, native filter/URL/bookmark, standard autosave, index controls,
  successful Scan and capture masking. Native leave-prompt dismissal remains
  the earlier hub manual limit; caption standard settings use the same hub flow.
- Review typed entry/runtime/contracts, domain/track/filter modules, four
  components, registry/sole-script manifest, module/bundle/native-filter tests,
  the opt-in fixture and documentation. Preserve the ignored baseline ZIP and
  verified install backup for rollback. This checkpoint is complete.
- After review and another continuation, re-read AGENTS/plan/status/baseline,
  snapshot DirtyMultiscreen and its package/tests, then implement that separate
  phase 4 port. Do not start Rank, Stats, metadata generation or optimization.

### Phase 4 — DirtyTidy completed (review checkpoint)

- Re-read AGENTS, plan, status and baseline. Preserve all earlier uncommitted
  work. Saved Tidy source, prior ZIP, registry and working-tree inventory under
  ignored `.build/phase4-tidy-baseline/` before editing.
- Convert normalization and preview helpers to typed imported modules; split
  strategy controls, preview table/summary and confirmation into focused TSX.
  Retain the public hub components, Stash React, CSS and unchanged Python.
- Keep manual Save and explicit Preview/Confirm/Run. The shared settings hook
  autosaves, so it does not apply to Tidy's documented exception. Use a local
  typed workflow with snapshots, busy locking, dirty reports and owned cleanup.
- Preserve server-authoritative normalization, reviewed-plan/strategy hashes,
  approved automation for future scenes, job identity/deduplication, and capture
  masking. Claim the guard before the non-removable App patch; retain it on
  partial patch failure and clean up reversible registration/effects.
  Native job subscription cleanup belongs to Stash's React hook on unmount;
  explicit teardown immediately deactivates callbacks, while the retained App
  patch passes through on its next render. No duplicate patch is installed.
- Scope: implement the port and module/bundle tests; verify settings/preview/
  confirmation/races/cleanup, full suite, packages, isolated Stash confined
  moves/renames/unknown metadata/automation, served bundle/maps and browser UI.
  Set 1.0.0 after acceptance, install from staging, and stop before Captions.
- Implemented 17 strict TS/TSX files: typed host/contracts, imported settings and
  grouping/filtering, a manual workflow and adapter hook, automation monitor,
  and focused strategy/preview/confirmation components. Registry now emits only
  `dirtyTidy.js` plus four selected CommonJS test modules. Removed three legacy
  IIFEs/private feature APIs; the entry owns panel/App registration and cleanup.
- Manual workflow snapshots and synchronous busy locking preserve Save-before-
  queue ordering and prevent duplicate clicks. An older save advances only the
  saved baseline; newer edits remain dirty. Late initial loads/previews cannot
  overwrite newer interactions, and teardown stops post-save task queueing.
  Editing during a confirmation save requires a new preview before execution.
  These lifecycle/race decisions are covered directly and do not alter Python.
- Passed strict/legacy typecheck, normalization/grouping/pagination modules,
  manual save/preview/confirm/approval/order/race/conflict/cleanup tests,
  automation identity/replay tests, compiled TSX controls/dirty reports/masks/
  blocked-scene links/guards, and all 52 shared UI contract tests. An initial
  Windows cp1252 text conversion changed Unicode labels in two edited files;
  restored their UTF-8 content and re-ran the checks successfully.
- Full `npm test` passed strict/legacy checking, all **31 JavaScript suites** and
  **278 Python tests**, with two expected combined-runner skips.
- New opt-in Tidy integration passed on isolated Stash 0.31.1, port 57587:
  preview does not save/move; unknown folder values and all-missing rename
  retention, stale strategy rejection, missing-file warnings and blocked
  collisions; manual native moves apply only reviewed operations and skip newly
  scanned/restored unreviewed files. A successful native Scan followed by two
  concurrent clients queues exactly one automated task, applies approved rules
  to future scenes, skips replay/wrong triggers, and preserves all file bytes,
  extensions, scene/file IDs and metadata inside the disposable source tree.
  The exact sole served bundle matches staging plus Stash's final newline;
  embedded maps decode Settings, PreviewTable and Confirmation to authored TSX.
- Browser acceptance passed against synthetic media at port 57587: unsaved raw
  length 999 is retained with native range-overflow validity and does not
  autosave; Preview normalizes it to 255 without persisting or moving. Explicit
  Save persists 255. Dialog Shift+Tab wraps to Run now; Cancel restores opener
  focus and leaves files untouched. Run now queued successful task 5 for six
  files. Approve without running saves hashes without execution; the compiled
  App subscription queued task 7 after native Scan 6 and moved seven fixture
  files including the newly scanned scene. All earlier bytes, metadata and IDs
  remain intact, replay is deduplicated, and a new preview shows seven Unchanged.
  Capture masking and an empty warning/error console were verified.
- Acceptance found no port defect. Set the completed port to **1.0.0** and
  updated installation/source/test documentation. Final strict/legacy typecheck,
  all four Tidy Node suites, asset contract, 44 Tidy Python tests and
  `git diff --check` passed. The full suite result above covers the final
  frontend implementation; subsequent edits assign the version and document it.
- `& 'C:\Program Files\Git\bin\bash.exe' build_site.sh _site/main` built all
  eight ZIPs. `npm run test:packages` passed staged-byte comparisons, identities,
  dependencies, manifest roots, Pages paths and SHA-256 checksums. File counts:
  Captions 10, Compactor 9, Extractor 8, Multiscreen 7, hub 12, Rank 12, Stats 17,
  Tidy **7**. No authored TS/TSX, tooling/tests/CJS modules, external React/hub,
  SQLite, caches, bytecode or runtime media is packaged.
- Both Python files and CSS match the pre-port baseline byte-for-byte. A
  temporary differential check against its preserved settings IIFE passed
  **594 normalization cases** and all 32 variable tuples. The unchanged
  backend's existing tests remain the authoritative domain/safety reference.
- Authored frontend: 17 typed files, including nine focused component files,
  609 lines versus 819 legacy lines. Only 16 runtime source modules enter the
  bundle; types erase. JS before map: 38,291 bytes versus 37,846 legacy bytes.
  Readable inline-map bundle: 120,742 bytes (82,451 map bytes). ZIP: 53,513 bytes
  versus baseline 29,583. Development source maps remain deliberate; phase 6
  optimization has not started. Frontend/manifest/README comparison is ignored
  at `.build/phase4-tidy.patch`; metrics at `.build/phase4-tidy-metrics.json`.
- Final fixture manifest/version and exact bundle/maps were verified after
  assigning 1.0.0; a fresh browser reload and clean General/Tidy tab navigation
  remounted the saved approved strategy with no warning/error logs.
- Installed all seven staged runtime files into
  `C:\Users\FABIO\.stash\plugins\dirtyTidy`, manifest last. Removed only the
  two obsolete feature scripts after verified backup. Live port 9999 confirms
  enabled Tidy **1.0.0**, exact sole staged bundle plus final newline, and one
  inline map. Shared SQLite and Tidy/hub package-provenance hashes stayed
  unchanged; all runtime caches/data were preserved. Backup:
  `.build/install-backups/20261004T184126956Z/`; reproducible installer:
  `.build/install-tidy.ps1`. Hard-refresh the user's live Stash tab (Ctrl+F5).
- Closed the acceptance tab and gracefully stopped the named fixture through
  `.build/tidy-fixture-stop`; its temporary tree is gone. Only original live
  Stash PID 9124 remains. No commits, pushes or releases; all earlier changes
  remain uncommitted and preserved. Browser proof is synthetic/capture-masked,
  outside the repository:
  `C:\Users\FABIO\.codex\visualizations\2026\10\04\01a10646-ea75-7a31-9319-e7f9448a470c\tidy-port.png`.

#### DirtyTidy verification limits and exact next actions

- Manual DevTools breakpoint/step debugging is unverified: the available browser
  API has no debugger control. Served bytes, embedded sources and decoded TSX
  locations are verified. Run the opt-in fixture with `--serve --stop-file
  <new-stop-path>` and set/step a DevTools breakpoint in Settings, Confirmation
  or PreviewTable on `/plugin/dirtyTidy/javascript`.
- Native unsaved leave-confirm dismissal was not retried after earlier hub/pilot
  checks stalled the browser tool. Dirty reports, saved clean navigation,
  teardown and rejection paths are tested through modules/bundles. Manually
  edit a folder level, switch plugin tabs, cancel the leave prompt, verify the
  draft remains, then Save and switch again.
- Other browser engines, a separate native Generate completion and a visual
  multi-page preview are unverified. Scan was verified end-to-end in real Stash;
  Generate identities/replay and 50-row filtering/pagination are module-tested.
  Use only synthetic scenes for the remaining manual checks. ES2020 stays the
  explicit browser target.
- Review the typed entry/host adapter, domains, workflow/hook, components,
  automation, registry/manifest, four Node suites, shared UI contract updates
  and opt-in integration. Reproduce commands below. This completes Tidy's
  separate review checkpoint; the later continuation completed Captions above.

### Phase 4 — DirtyFileExtractor completed (review checkpoint)

- Implemented imported strict TypeScript selection/mutation/queue/picker modules,
  a typed host adapter, and the focused `ExtractionAction.tsx` component. The
  picker keeps its existing DOM integration and delegates focus/scroll ownership
  to `hubApi.ui.manageDialog`. Python and CSS remain unchanged.
- Registry stages one `extractScenes.js` IIFE and three CommonJS test modules;
  removed the two legacy authored IIFEs and the private picker global. The source
  manifest declares the sole bundle; retained 0.4.6 during acceptance and set
  the completed port to 1.0.0.
- Fixed the Browse callback's pre-assignment capture. Stash patches cannot be
  removed, so duplicate loads retain the active instance; teardown and partial
  registration failure keep a guard and make installed patches pass through.
  Reversible failures before the first patch release the guard for retry.
- Late settings/task/directory/save results are ignored after teardown. A prior
  save cannot close a newly opened picker. Fresh settings are still merged to
  preserve unknown keys and hub revision/conflict semantics.
- Passed `npm run build`, `npm run typecheck`, both focused Extractor Node suites,
  and all 52 shared UI contract tests. Bundle tests exercise native selections,
  width preservation, double-click locking, initialized Browse, dialog cleanup,
  stale folder/save results, capture masking and partial patch failures. Domain
  tests exercise selection labels/arguments, filtered mutations and queue state.
- `npm test` passed strict/legacy typecheck, all **29 JavaScript suites**, and
  **278 Python tests** in 55.283s (two expected skips).
- The new opt-in `test_dirty_file_extractor_stash_integration.py` passed against
  isolated Stash 0.31.1 at port 59569 with synthetic scene/image/marker/performer
  entities: dry run made no folders, scene/image copies matched original bytes,
  a 0.7–2.3s marker produced a 1.6s clip, rename/skip/overwrite and title folders
  worked, Tasks reached progress 1, and cancellation stopped before finalizing
  the scene or processing the later image. Original hashes, file IDs and metadata
  remained unchanged. The sole served bundle matched staging plus Stash's final
  newline; its inline map embeds only Extractor TS/TSX and decodes the real
  `ExtractionAction` location.
- Existing backend limitation: Stash's hard task cancellation leaves its
  `.extract-scenes-<uuid>.part` sibling and zero-byte reserved destination on
  Windows. This port preserves that behavior; no finalized copy or later item
  was produced. All remnants are confined to the disposable fixture tree.
- Browser fixture acceptance passed Browse opening, server-parent navigation,
  capture placeholders/disabled path entry, Shift+Tab wrap, destination save,
  Escape/focus restoration and scroll-lock release. The compiled native scene,
  image and marker actions each queued a successful dry-run task (jobs 9–11).
  A performer-page scene selection also showed the action and preserved the
  toolbar width capped to its list container. Selections across pagination and
  duplicate clicks are covered by bundle tests; this one-item fixture cannot
  demonstrate pagination visually.
- Set the first completed Extractor port to **1.0.0** and updated installation,
  source/build, guard, fixture and cancellation documentation.
- Final `npm run typecheck`, both focused Extractor Node suites, the asset
  contract and ten Extractor Python tests passed. `build_site.sh _site/main`
  built all eight ZIPs, and `npm run test:packages` verified every staged byte,
  identity, dependency, manifest root, Pages path and SHA-256 checksum. File
  counts: Captions 10, Compactor 9, **Extractor 8**, Multiscreen 7, hub 12,
  Rank 12, Stats 17, Tidy 9. No TS/TSX, tooling, test modules or runtime data
  enter the packages.
- esbuild's recorded dependency graph contains exactly eight Extractor-owned
  runtime TS/TSX inputs (the ninth, type-only file is erased) and no React/ReactDOM
  or hub implementation. Authored frontend:
  **398 lines in nine files**, versus **663 legacy lines**. Readable browser JS
  before its inline map: **23,815 bytes**; complete bundle: **76,334 bytes**.
  ZIP: **38,535 bytes**, versus saved phase 3 package **22,764 bytes**. Inline
  development maps account for the deliberate size increase. All three Python
  sources and CSS are byte-identical to the pre-port checkpoint.
- Local installation used ignored `.build/install-extractor.ps1`, explicit
  registry paths and verified backups at
  `.build/install-backups/20261004T145532901Z/`. Copied eight staged files,
  installed the manifest last, and removed only the backed-up obsolete picker
  JS. Stash on 9999 reports Extractor **1.0.0 enabled** and serves the exact sole
  bundle plus its final newline, with one inline map. Shared SQLite and both
  Stash package-provenance manifests retained their hashes; no runtime caches,
  SQLite or media were copied. Browser hard refresh remains required.
- Final fixture recheck verified the 1.0.0 served map and jobs 9–11 all FINISHED
  with progress 1 and no errors. Browser logs contained no errors/warnings.
  Native scene/marker cards reported unavailable generated hover previews
  because this fixture deliberately skipped generated covers/previews; that
  host display does not affect originals or extraction.
- Saved capture-safe UI proof outside the repository:
  `C:\Users\FABIO\.codex\visualizations\2026\10\04\01a10646-ea75-7a31-9319-e7f9448a470c\extractor-port.png`.
  The browser tab closed normally. The stop-file workflow shut down the fixture
  and removed its named temporary tree, including cancellation remnants. Only
  the original live Stash process (PID 9124) remains.

- Re-read instructions, plan, status and baseline; preserve all prior changes.
  Saved Extractor source, prior ZIP and working-tree inventory under ignored
  `.build/phase4-extractor-baseline/` before editing.
- Saved final source/tests/registry under `.build/phase4-extractor-checkpoint/`
  and the isolated source diff at `.build/phase4-extractor.patch` for review.
  `git diff --check` passed; all prior uncommitted work is preserved.

Unverified/manual checks and exact next actions:

1. Review `plugins/DirtyFileExtractor/src/`, sole-script manifest, registry,
   module/bundle tests and opt-in fixture. Keep the saved ZIP/install backup
   for rollback. All work remains uncommitted; no push/release was made.
2. Manual DevTools breakpoint/step debugging and other browser engines remain
   unverified. Re-run the fixture below with `--serve --stop-file <path>`;
   in DevTools Sources open `/plugin/extractScenes/javascript`, set and step a
   breakpoint in embedded `components/ExtractionAction.tsx` and `picker.ts`.
   Repeat in each desired ES2020 browser. Real served VLQ mappings are verified.
3. Visual multi-page selection remains unverified in the one-item fixture.
   Bundle tests cover selections containing off-page IDs and all three kinds.
   For separate manual acceptance, expand synthetic media above the native
   page size, select across pages and confirm the queued IDs/outputs.
4. Hard-refresh the live Stash tab (Ctrl+F5). Do not run acceptance against
   personal media. The next continuation subsequently completed DirtyTidy's
   separate phase 4 checkpoint above; preserve this port and all earlier changes.

Reproduce this checkpoint:

```powershell
npm test
python -B tests/test_dirty_file_extractor_stash_integration.py --binary 'C:\Users\FABIO\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\stash.exe'
& 'C:\Program Files\Git\bin\bash.exe' build_site.sh _site/main
npm run test:packages
git diff --check
```

### Phase 3 implementation record (4 October 2026)

- User: "ok validated continue" after installing and verifying Compactor 1.0.0.
  Record this as user validation of the local pilot and authorization to proceed
  to the next planned phase. Preserve the completed pilot and all earlier work.
- Re-read AGENTS, plan, status and baseline. Saved the current legacy hub JS,
  manifest, package and working-tree inventory under ignored
  `.build/phase3-baseline/` before edits.
- First change: strict TS modules and focused TSX hub components, one guarded
  browser bundle, unchanged public APIs/HTM compatibility, host React and storage.
  Validate the hub conversion before separately extracting the shared settings
  hook and updating Compactor to use it. Do not start phase 4.
- Next: migrate injectable values/save/job/transport helpers and metadata;
  convert shared components, theme/native/debug adapters and hub route; update
  module/bundle/architecture contracts and run focused/full/package/fixture
  checks. Retain hub 0.5.6 until the conversion meets its acceptance checks.
- Conversion now builds as one IIFE from `src/index.tsx`. Values, save/job
  helpers, metadata, transport, theme/native/debug adapters and shared/settings
  components use strict typed imports. Removed 11 legacy hub source scripts
  and factory-only global types; vendor HTM and its notices remain available
  for legacy consumers, with `react.html` bound to the same host React.
- Guard validation precedes side effects; the entry owns both patches and the
  route, retains the guard on partial failure and removes debug listeners if
  initialization fails. Existing effect cleanup and public-object identity stay
  intact. Python, CSS, database schema and settings representation are unchanged.
- Focused typecheck, compiled UI primitives, save/job module tests, transport,
  suite theme and compiled Compactor tests passed. Added direct domain/module
  and bundle tests for inert imports, missing host APIs, duplicate/partial
  registration, native filter serialization, standard settings/tabs/autosave,
  revisions, invalid drafts and cleanup; these pass.
- Architecture contracts intentionally inspect authored imports/TSX and public
  API ownership. Tests import selected CommonJS modules instead of retired hub
  globals. Next: full suite, packaging and isolated real-Stash/browser checks;
  only then complete the hub conversion and begin the separate hook extraction.
- Hub conversion acceptance: `npm test` passed strict/legacy checking, all
  **27 JavaScript suites and 278 Python tests** (50.268s, two expected skips).
  Packaging all eight plugins and `npm run test:packages` passed; the hub now
  has 12 install files versus 22, retaining HTM runtime/license/notice.
- Isolated Stash 0.31.1 on port 51558 loaded all eight enabled plugins. Browser
  checks passed standard autosave, suite theme changes, all six legacy settings
  panels/addons, Compactor rule UI and the native filter dialog. No browser
  errors/warnings appeared. Controlled synthetic media exercised review,
  replacement, preserved metadata/file IDs and automatic event deduplication.
- Exact served hub bytes and its single inline map passed; decoded component
  locations resolve to embedded `Settings.tsx` and `Route.tsx`. This verifies
  map locations, not manual DevTools stepping or other browser engines.
- The conversion meets its automated/package/Stash acceptance criteria; set
  hub version to **1.0.0**. Save/job types are colocated, with compatibility
  aliases for remaining checked legacy JavaScript. Python/CSS/storage unchanged.
- Preserve this conversion under ignored `.build/phase3-hub-checkpoint/`
  before the next change. Next: extract typed `react.useSettingsDraft`, adopt
  it in Compactor, test races/failures/conflicts/dirty/cleanup and shared ordinary
  field definitions, then rerun full/package/isolated Stash checks. No phase 4.
- Shared-hook extraction is now a separate change after the saved hub checkpoint:
  `react.useSettingsDraft` uses the existing serialized controller and injectable
  host hooks/timers. Callers supply load/normalize/validate/comparable/serialize/
  save and revision/conflict callbacks. Invalid raw edits stay visible; failures
  block autosave until explicit retry/reload; newer drafts survive older writes.
- Compactor uses the public hook through a type-only hub contract import. Its
  rule, automation, preview/run/review behavior remains local; reload-on-conflict,
  500ms autosave and persisted raw values remain unchanged. No hub implementation
  is imported into the feature bundle. Added ordinary field definitions and
  `react.SettingsField`, preserving native control IDs/options/limits and keeping
  capture masking/field actions local. Tidy's explicit workflow is unchanged.
- Hook module and compiled Compactor checks pass races, ordered revisions,
  revert during an active save, invalid raw values, failure/block/retry/reload,
  dirty notifications, stale loads and pending/active work after unmount.
  The two compiled bundles exercise the hub route's before-unload handler and
  canceling a tab leave, preserving the edited rule. Next: focused/full suite,
  packaging, final isolated Stash/browser checks and cleanup, phase 3 review.

### Phase 3 final verification and local install

- Final `npm test`: legacy/strict typecheck, **28 JavaScript suites, 278 Python
  tests**, 56.969s Python runtime, two expected skips; no failures. The earlier
  hook full run also passed (59.293s). Focused hub/Compactor/hook/UI-contract
  checks passed. A final Compactor regression additionally verifies that a
  successful settings save clears an earlier workflow error, as before extraction.
- `& 'C:\Program Files\Git\bin\bash.exe' build_site.sh _site/main` and
  `npm run test:packages` passed for all eight ZIPs. File counts: Captions 10,
  Compactor 9, Extractor 9, Multiscreen 7, hub 12, Rank 12, Stats 17, Tidy 9.
  Exact staged bytes, roots, identities, dependency declarations and SHA-256
  checksums passed. No source, tests, tooling, caches, database or runtime media
  is packaged. Dependency graphs contain only plugin-owned implementations;
  hub includes its existing HTM, features contain no copied hub or React runtime.
- Final isolated Stash 0.31.1 used port **58426** and only synthetic test media.
  All eight plugins loaded; hub/Compactor aggregated scripts match staging plus
  Stash's final newline, with one inline map each and embedded/decoded TSX.
  Backend acceptance passed review/HTTP seeking/exact-byte replacement,
  scene/file identity, metadata, savings, container changes, automatic Delete
  and scan-event deduplication. Backend Python and CSS remain unchanged.
- Browser acceptance passed invalid raw bitrate/action blocking, correction
  and autosave, a real competing settings revision, retained conflicted draft,
  explicit reload of the newer revision and a successful subsequent save.
  Fixture revisions progressed 5 → 6 externally → 7 after reload/edit. Ordinary
  Multiscreen numeric autosave and the General theme selector/save also passed.
  Final rebuilt Compactor loaded with Saved and the preserved fixture rule.
  The responsive final browser tab reported no errors or warnings.
- Browser verification limitation: after saving the proof screenshot, browser
  input timed out on tab 4; subsequent tab activation input was unreliable in
  the recovery tab despite working field updates, readable DOM and no console
  errors. Tab 4 could not be closed through the supported API; the responsive
  recovery tab closed normally. Repeat final tab switching and native leave
  confirmation manually. Compiled-bundle tests verify canceled navigation,
  retained edits, before-unload protection and dirty cleanup. The earlier hub
  conversion browser check did verify all six legacy panels and native filters.
- Manual DevTools breakpoint/stepping and other browser engines remain
  unverified. Exact served maps and decoded authored locations are verified.
  No personal media or live database was used for acceptance workflows.
- Hub authored frontend: **27 TS/TSX files, 2,480 lines** versus 2,222 legacy JS
  lines; explicit contracts account for the increase. Removed 11 internal hub
  IIFEs/factory globals and reduced manifest scripts from 12 to one. Compactor's
  source is now 969 lines (1,001 before extraction); workflow state stays local.
  Hub code before its map: 98,156 bytes versus 95,942 legacy bytes. Readable
  bundle with inline map: 316,975 bytes; ZIP 112,929 versus baseline 58,275.
  Final Compactor bundle: 190,150 bytes; ZIP 86,846. Minification stays in phase 6.
- Installed the tested compatible pair from staging: 12 hub files and nine
  Compactor files, with manifests copied last. Backed up all affected existing
  runtime files and removed only the ten backed-up obsolete hub scripts.
  Original installed runtime backup:
  `.build/install-backups/20261004T134749497Z/`; final refresh backup:
  `.build/install-backups/20261004T135432011Z/`. Both include `installation.json`.
  The phase 2 backup and original hub ZIP also remain available for rollback.
- Reloaded local Stash plugins. Both IDs are enabled at **1.0.0**, and both final
  `/plugin/<id>/javascript` assets match staged bytes with a single inline map.
  Shared SQLite and Stash package-provenance hashes are unchanged; runtime data
  was excluded from the copy/removal lists. No commits, pushes or releases.
- All original uncommitted work is preserved. Logs stay ignored under `.build/`:
  `phase3-hub-test.log`, `phase3-hub-packages.log`, `phase3-final-test.log`,
  `phase3-final-packages.log`. Hub-before-hook source/registry/diff checkpoint is
  `.build/phase3-hub-checkpoint/`; legacy source/ZIP is `.build/phase3-baseline/`.
  Separate hook review patches are `.build/phase3-shared-hook-hub.patch` and
  `.build/phase3-shared-hook-compactor.patch`. Final `git diff --check` passed.
- Both named phase 3 temporary Stash processes stopped; their fixture trees were
  removed (the final one through normal Python cleanup using `--stop-file`).
  Only the pre-existing live Stash remains. Screenshot is outside the repository:
  `C:\Users\FABIO\.codex\visualizations\2026\10\04\01a10646-ea75-7a31-9319-e7f9448a470c\phase3-shared-hook.png`.

### Exact next review actions

1. Ctrl+F5 the local Stash tab to load the installed hub and compatible Compactor.
2. Review hub entry/runtime/typed public APIs/components, registry, module/bundle
   contracts; compare the saved hub checkpoint with the separate shared-hook and
   Compactor lifecycle extraction. Keep the rollback backups/ZIP until accepted.
3. Repeat tab/leave-confirm checks and DevTools TSX breakpoint stepping with the
   controlled fixture command below; optionally repeat on other ES2020 browsers.
4. Phase 3 is ready for review with the explicit manual/tool limits above.
   Phase 4 requires the user's next instruction; do not start it at this checkpoint.

- Phase 2 started after reading AGENTS, plan, status, and baseline. Initial
  working-tree changes match the phase 1 handoff; no reset/checkout performed.
- Legacy Compactor frontends copied to ignored `.build/phase2-baseline/` for
  behavior comparison. Python, CSS, persisted formats and hub APIs stay stable.
- All authorized phase 2 implementation and automated acceptance work is done.
  Review the source/modules, fixture tests, manifest/registry and documentation.
  Do not begin phase 3 without the next instruction.

### Local installation follow-up (4 October 2026)

- User explicitly requested building and installing the completed pilot into
  the live Stash on port 9999. This follows the phase 2 review checkpoint;
  phase 3 remains unstarted.
- Fresh `npm run build`, `npm run typecheck`,
  `node tests/test_dirty_compactor.js` and
  `node tests/test_dirty_compactor_ui.js` passed.
- Before installation Compactor was 0.3.2. The installed hub reported 0.5.6
  but predated the repository's existing save/job helper extraction and lacked `createJobHook`
  and `createSaveController`. Refreshed the hub's 22 allowlisted runtime files
  along with Compactor's nine files. This installs the existing legacy hub,
  without converting it or changing its version. No other plugins were copied.
- At 12:35 UTC, backed up existing affected files and SHA-256 hashes under
  `.build/install-backups/20261004T123532865Z/`; `installation.json` also records
  newly added files for rollback. Copied from staging with verified literal
  paths, rejected reparse paths, replaced manifests last and removed only the
  two backed-up obsolete Compactor scripts. No whole-directory cleanup.
- `mutation { reloadPlugins }` returned true. Live `{ plugins { id version
  enabled } }` verified enabled Compactor 1.0.0 and hub 0.5.6. The job queue was
  empty before installation.
- `python -B .build/verify-live-compactor.py` passed: all 31 installed files
  match staging byte-for-byte; both served JS aggregates match their manifests
  exactly. Compactor serves only `dirtyCompactor.js`, one inline source map,
  embedded source and decoded Settings/OutputReview TSX locations. The served
  hub includes its required save/job APIs.
- Shared SQLite and both Stash package-provenance `manifest` files have
  unchanged SHA-256 hashes. The Compactor runtime preview inventory, sizes and
  timestamps are unchanged. No settings or media operation was performed;
  server-side reload leaves already-open browser pages unchanged.
- `git diff --check` passed. Exact next action: Ctrl+F5 the local Stash tab to
  load the new frontend, then review the phase 2 diff. Manual debugging/browser
  acceptance limits below remain explicit; do not begin phase 3.

### Phase 2 implementation checkpoint

- Rules are strict typed exports in `src/domain/rules.ts`; raw numeric input
  stays `number | string` until the existing backend normalization. Corrected
  the old frontend type declaration to match the existing `format: allow` UI.
- Automation is an imported, injectable typed controller using the hub's job
  hook. No rules/automation/algorithm test APIs remain on `window`.
- The adapter binds Stash React and hub controls after entry validation. Imports
  themselves install no routes, patches, listeners or timers. The entry claims
  its guard before registration; reversible settings registration can retry,
  while an attempted non-removable App patch retains its guard on failure.
- TSX is split into Settings, RuleRow, RuleField, Results, OperationTable,
  OutputReview, RunHistory and WorkflowDialogs. Settings lifecycle stays local;
  the phase 3 shared-hook extraction has not started.
- Registry compiles `src/index.tsx` to the sole staged `dirtyCompactor.js` and
  selects rules/automation CommonJS modules for tests. Legacy authored scripts
  were removed after consumers moved to imports. Backend, CSS and preview paths
  are unchanged. README explains compiled-source installation.
- `npm ci --offline`, strict `npm run typecheck`, rules module tests, and the
  compiled UI harness passed before the final component split. UI tests use
  staged hub save/job helpers and host hook/transport/media fixtures; cover
  filters, invalid input, dirty state, serialization, reload after failure,
  preview invalidation, progress/cancellation, review/recovery, guards and cleanup.
- At this implementation checkpoint the manifest remained 0.3.2 pending
  browser/integration acceptance; the completed checks below allowed 1.0.0.

### Phase 2 acceptance progress

- Focused rules/compiled-UI tests passed after the component split. Compactor
  backend: 51 tests passed in 28.957s. Shared UI architecture: 52 tests passed.
- First phase 2 `npm test`: strict typecheck, 26 JS suites, 278 Python tests
  passed, with two expected combined-runner skips (Python discovery: 54.018s).
- Isolated Stash v0.31.1 launched from the existing local binary on port 60817
  with only staged hub/Compactor, a fresh temporary database, and FFmpeg test
  patterns. No port-9999 install, real library edits or host upgrades occurred.
- Real integration passed output review/range seeking/exact-byte acceptance,
  metadata and scene/file-ID preservation, container-change reconciliation,
  automatic deletion of one named synthetic fixture, native filter execution,
  cross-tab event deduplication and byte accounting.
- Browser smoke in Codex's in-app browser rendered the compiled TSX with Stash
  React. Verified output playback/review and acceptance; added a disabled rule,
  edited its name, selected a native Rating criterion, applied the filter and
  saw `Rating > 1 star`; custom bitrate blank stays visible/invalid and blocks
  Preview and Accept; valid settings persisted and reopened in a fresh tab.
- The unsaved-leave confirmation appeared as expected. The browser automation
  API then stalled on that JavaScript dialog; its documented dismissal API did
  not return a dialog and AX/key/close calls timed out. A fresh tab recovered
  verification. The prompt-dismissal path itself is unverified in this tool.
- Stash's aggregated frontend contained the exact staged bytes plus one newline,
  one inline map and all 13 embedded source files. Added a reproducible opt-in
  integration check that decodes VLQ mappings of served Settings/OutputReview
  entry lines back to their authored TSX. No individual source URLs are needed.
- Manual DevTools breakpoint/step debugging and browsers other than the tested
  modern in-app browser are unverified. ES2020 remains the explicit target;
  no claim of legacy-browser compatibility is made.
- No acceptance failure in the port was found. Set Compactor to 1.0.0 after
  these checks, then completed the final checks below.

## Phase 2 final verification and source comparison

- Final `npm test` after version assignment, source formatting, direct automation
  module tests and served-map checks: strict typecheck, all 26 JS suites, all
  278 Python tests passed, with two expected skips (Python discovery: 52.544s).
  Output is ignored
  at `.build/phase2-final-test.log`.
- Final isolated integration on port 52493 repeated all real-Stash backend and
  source-map checks successfully. GraphQL confirmed Stash v0.31.1, enabled
  DirtyCompactor 1.0.0 and DirtyPlugins 0.5.6. A fresh browser tab loaded the
  final bundle and rule editor/review panel. Synthetic video playback verified
  `paused: false`, advancing time, `readyState: 4`, duration 3s and 160×90 output.
- Browser Cancel run was verified against the first synthetic fixture; the
  deterministic bundle/backend tests cover preview cancellation/progress and
  stale async completion. Live clicking during the very short preview task was
  not timed as a separate browser check. Final browser logs had no errors from
  the final fixture; one old websocket-disconnect log came from shutting down
  the earlier fixture.
- `& 'C:\Program Files\Git\bin\bash.exe' build_site.sh _site/main` built all
  eight ZIPs. `npm run test:packages` passed all staged byte comparisons,
  identities, dates, manifest roots, dependencies, Pages paths and SHA-256 sums.
  File counts: Captions 10, Compactor **9**, Extractor 9, Multiscreen 7, hub 22,
  Rank 12, Stats 17, Tidy 9. No TS/TSX, tooling, test modules, runtime media,
  SQLite, caches, bytecode or external React/hub implementations are packaged.
- Compactor's four Python sources and CSS match HEAD content exactly (allowing
  checkout newline conversion). A temporary differential comparison against
  the preserved legacy rules passed 1,512 rule/normalization/quality/estimate
  cases across actions, codecs, qualities, landscape/portrait sizes and FPS.
  Committed domain-parity fixtures remain the clean-checkout behavioral reference.
- Removed three legacy IIFEs, the rules/automation window APIs and entry's
  algorithm-only exports. One entry now owns registration and imports 14 typed
  source files, including eight focused TSX components. Authored source is 1,001
  lines versus 791 legacy lines; the increase includes explicit host, settings,
  media/workflow and component contracts. No shared settings hook or backend
  redesign was added. Injection is retained for the automation controller.
- Browser JS before its map is 58,976 bytes versus 58,156 legacy frontend bytes.
  Readable development bundle with inline map: 194,663 bytes (135,687 map bytes).
  Compactor ZIP: 87,747 bytes versus the phase 1 ZIP's 50,028 bytes. The map is
  the deliberate pilot size tradeoff; production optimization stays in phase 6.
- `git diff --check` passed. At the original phase 2 checkpoint: no commits,
  live plugin installs, live database
  changes, pushes or releases. Both temporary Stash instances stopped and their
  verified named fixture trees were removed; only the pre-existing live Stash
  process remains. Logs/baseline ZIPs stay ignored under `.build/`.
- Browser smoke screenshot contains only synthetic test patterns and is outside
  the repository at
  `C:\Users\FABIO\.codex\visualizations\2026\10\04\01a10646-ea75-7a31-9319-e7f9448a470c\compactor-pilot.png`.
  The final smoke tab closed normally. The earlier tab stalled on the unsaved
  confirmation and could not be closed through the browser API; its temporary
  server has been stopped. No personal media was involved.

### Unverified checks and exact review actions

- Manual DevTools breakpoint/step debugging: maps are validated through real
  served bytes and decoded locations, but the available browser API has no
  debugger control. To verify manually, run the opt-in fixture with `--serve`,
  open DevTools Sources on `/plugin/dirtyCompactor/javascript`, and set/step a
  breakpoint in embedded `components/Settings.tsx` or `OutputReview.tsx`.
- Other supported Stash browsers and legacy-browser compatibility: not tested.
  Run the same isolated fixture UI on each desired ES2020 browser; retain the
  explicit target unless a separately tested compatibility change is approved.
- The native unsaved-confirm dismissal path was blocked by the browser tool.
  Manually clear a custom bitrate, switch plugin tabs, cancel the leave prompt,
  restore a valid value, verify Saved and switch again. The prompt itself and
  dirty-state cleanup are verified; no port defect was observed.
- Live preview-progress/cancel timing: automated fixtures verify this behavior.
  For a separate manual check use a larger synthetic-only fixture, start Preview
  and cancel while planning. Never perform acceptance against personal media.
- The original phase 2 request stopped for review here. The user's subsequent
  validation/continuation and completed phase 3 are recorded above.

## Phase 0–1 verification results (historical)

- First staged full suite: typecheck, 25 JS suites, 278 Python tests passed
  in 54.598s with two expected skips. The new Python tests check 3.9 syntax and
  same-directory/shared-module import provenance from staging.
- Final `npm test` after bytecode suppression and concurrent/junction safety
  fixtures: typecheck, all 25 JS suites, all 278 Python tests passed in 52.460s,
  with two expected combined-runner skips. Staging remained free of bytecode,
  caches and SQLite files after backend tests.
- Focused build fixture passes legacy byte parity, artifact exclusion,
  missing/stale builds, failed builds, live build-lock rejection, junction-safe
  output cleanup, shared-input identity,
  guarded TSX using host React, inline maps, and direct CommonJS module exports.
- All eight ZIPs built successfully via Git Bash on Windows. Windows inherited
  native `find.exe`/`sort.exe` originally broke packaging; the script now puts
  Git Bash tools first only on MSYS/Cygwin. Fresh `npm run test:packages` passed:
  every ZIP matches staging byte-for-byte, manifests sit at ZIP roots, and all
  source/build identities, dates, dependency declarations and checksums match.
  Verified file counts: Captions 10, Compactor 11, Extractor 9, Multiscreen 7,
  hub 22, Rank 12, Stats 17, Tidy 9.
- `git diff --check` passed. Logs are ignored under `.build/` and may not exist
  after transfer; commands below reproduce the results.
- Local package output is `_site/main/` (ignored); installable directories are
  `.build/plugins/` (ignored). No live Stash install/smoke check is necessary
  for copied legacy assets; the actual compiled-bundle/browser/inline-map smoke
  check was required before the pilot could be marked complete; phase 2 results
  above now record that acceptance.

## Reproduce / continue

```powershell
npm ci
npm test
python -B tests/test_dirty_compactor_stash_integration.py --binary 'C:\Users\FABIO\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\stash.exe'
python -B tests/test_dirty_plugins_stash_integration.py --binary 'C:\Users\FABIO\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\stash.exe'
python -B tests/test_dirty_tidy_stash_integration.py --binary 'C:\Users\FABIO\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\stash.exe'
python -B tests/test_dirty_captions_stash_integration.py --binary 'C:\Users\FABIO\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\stash.exe'
python -B tests/test_dirty_stats_stash_integration.py --binary 'C:\Users\FABIO\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\stash.exe'
python -B tests/library_copy_fixture.py --binary 'C:\Users\FABIO\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\stash.exe'
node scripts/generate-settings.mjs   # regenerate .build/generated/ alone (npm run build and typecheck do this too)
python -B tests/test_package_install_stash_integration.py --binary 'C:\Users\FABIO\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\stash.exe'   # after packaging
& 'C:\Program Files\Git\bin\bash.exe' build_site.sh _site/main
npm run test:packages
git diff --check
```

On Linux/macOS use `./build_site.sh _site/main`. The package check reads existing
ZIPs; run it after packaging. Run build/test/package commands sequentially and
stop `npm run build:watch` before checks. If a process was terminated, a new
build reclaims a dead PID lock; an invalid lock reports manual removal guidance.

For focused frontend checks run `npm run build`, then
`node tests/test_dirty_compactor.js` and `node tests/test_dirty_compactor_ui.js`.
For backend/architecture checks use Python discovery with
`-p test_dirty_compactor.py` or `-p test_shared_ui_contract.py`. Add `--serve`
to the isolated integration command for browser review; its printed URL uses
a random non-9999 port. Ctrl+C stops the fixture. If the command runner kills
the process group before Python cleanup, verify the printed absolute temporary
fixture path/process has stopped before removing that named tree.

Review entry/runtime/types, `src/domain/`, focused `src/components/`, registry,
manifest, domain/bundle tests and the integration map check. Preserve the old
ignored ZIP for rollback. Further phase 2 edits require the appropriate checks
again. Phase 3 is complete; the later instruction authorized the first phase 4
port, which is now also complete. The hub
fixture accepts `--serve --stop-file <path>` for graceful command-runner cleanup;
create that named stop file after closing the browser review tab.

## Remaining phases

- Phase 2: completed; review checkpoint with explicit verification limits above.
- Phase 3: completed; hub conversion and shared-hook checkpoints retained,
  with explicit manual verification limits above.
- Phase 4: completed. FileExtractor, Tidy, Captions, Multiscreen, Rank and Stats
  are each at a separate review checkpoint with recorded verification limits.
- Bundle size reduction (separate step): complete and at its review checkpoint.
  Changes A (release builds without inline maps) and B (minification) shipped
  with a size guard as 1.0.1; Change C (modular ECharts) shipped as Stats 1.0.2.
  All are installed live.
- Phase 5: completed (8 October 2026) at its review checkpoint; six schemas
  generate manifest settings, hub/Rank/Compactor tables and Python constants.
- Phase 6: completed (8 October 2026) at its review checkpoint — legacy cleanup,
  documented and validated development cycle, clean packages installed into an
  empty plugin directory, 1.0.2 releases for the hub, Rank and Compactor.

## Verification and handoff notes

- No commits, live database changes, pushes or releases made. Phase 2 acceptance
  exercised only isolated temporary test plugins/databases/media and removed
  them. The subsequent explicitly requested live install is recorded above;
  settings, databases and preview data were preserved.
- All work is uncommitted in the existing checkout. The user's plan remains
  untracked; on 5 October 2026 it gained the separate bundle size step at the
  user's request (phase 6's ECharts/minification items moved there). Do not
  discard it or this handoff record.
- Local runtime and media must stay outside packages and Git history.
- Keep the staged manifest authoritative for bundle tests; architecture checks
  continue inspecting authored source. Missing/stale staging must fail clearly.
- Compile one guarded browser bundle per migrated plugin; use host React and
  the hub API. Keep legacy loading order until a plugin's port is complete.
- Bump each completed first port to 1.0.0; no version bumps for staging alone.
- The original request stopped at the phase 2 review checkpoint. The user has
  validated it and authorized phase 3; keep the hub conversion and the
  subsequent shared-settings-hook extraction separately reviewable. The later
  "please continue" authorized phase 4's FileExtractor port, now at its review
  checkpoint. A further continuation completed DirtyTidy's separate checkpoint.
  A further continuation completed DirtyCaptions at its separate checkpoint.
  A further explicit continuation completed DirtyMultiscreen at its separate
  review checkpoint; the user then authorized the remaining phase 4 ports, and
  DirtyRank and DirtyStats were completed at separate review checkpoints. The
  latest continuation finished Stats' closeout checks and live install. Phase 4
  is complete. The user then had the plan updated with a separate bundle size
  step after phase 4 and said "please continue the migration": Changes A and B
  shipped live as 1.0.1. On 8 October 2026 the user authorized the Stats 1.0.2
  install (Change C), which is now live; the step is at its review checkpoint.
  The user then said "continue with phase 5"; phase 5 is complete at its review
  checkpoint and not installed live. The user then said "fix rank and go phase
  6"; the Rank fix and phase 6 are complete at their review checkpoint, not
  installed live, and the migration is finished.
