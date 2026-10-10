# Running the checks

From the repository root, install development tooling and run all checks:

```powershell
npm ci
npm test
```

`npm test` builds installable output once, runs the strict TypeScript check and
the formatting check, then every JavaScript suite and Python unittest discovery.
Python 3.9+ (as `python`) and Node.js must be available on PATH. The steps are
chained, so the first failing step ends the run; use the focused commands below
to run a later step on its own. TypeScript is development tooling only; Stash
users install generated packages without Node or runtime npm dependencies.

For a focused check:

```powershell
npm run typecheck
npm run format:check # npm run format rewrites the files
npm run test:js
npm run test:python
npm run build # release staging; required before direct Node/Python test-file invocations
node tests/test_dirty_rank_media.js
python -B -m unittest discover -s tests -p test_dirty_tidy.py -v
```

JavaScript suites run through Node's own test runner:
`node --test --test-concurrency=1 "tests/test_*.js"`. It runs each file in its
own Node process, one after another, with a summary at the end; a failing or
crashing file makes the run fail and later files still execute. Suites are
plain scripts built on `node:assert`, so `node tests/<suite>.js` runs one
directly. Helper files must use a different filename prefix.

Python discovery runs only Python tests; it no longer starts JavaScript suites.
`npm run test:packages` honors the `PYTHON` environment variable for its
package-content check.

Rebuild after changing plugin source, schemas or scripts: tests read
`.build/plugins/`, and a missing build fails with a request to run
`npm run build`. Staging is not fingerprinted, so a stale build is not detected.

# Test helpers

- `load_plugin_scripts.js` reads real manifests. Use its `sourceFor` for a
  plugin's aggregated staged assets.
- `plugin_paths.js` and `plugin_paths.py` distinguish `runtimePath`/`runtime_path`
  under `.build/plugins/` from `sourcePath`/`source_path` under authored `plugins/`.
  Missing staging produces an error asking for `npm run build`. Runtime
  and Python-backend tests use staging.
- `plugin_paths.js` also compiles TypeScript modules on demand with the build's
  own esbuild options, so no test modules are staged or listed in the registry:
  `compileSource(plugin, entry, { contents, external })` returns CommonJS code,
  `requireSource` evaluates a module once in the test's realm, and
  `runSource(plugin, entry, globals, { contents, external, modules })` evaluates
  it in a fresh context with the globals a test supplies (such as `window`).
  `external` leaves imports unbundled and `modules` answers their `require()`
  calls; that is how a suite replaces one module (a fake chart engine, a fake
  hub runtime) while the rest stays real.
- `shared_runtime.js` installs actual shared registration, save, job and value
  helpers into a minimal plugin host (`installRegistration`,
  `installSaveController`, `installJobHelpers`, `loadFeature`).
- `ui_harness.js` provides plain element trees, tree search/text and event
  dispatch, plus `createHooks` and `createRenderer`: one render loop with hook
  state keyed by tree position, effects after each render and cleanups for
  components that leave the tree. `test_ui_harness.js` checks the harness
  itself. Suites own their scenario data.
  Function identity determines remounts, state/dependencies compare with `Object.is`,
  and a nonsettling `flush` throws instead of silently stopping. Virtual source contents
  participate in the module cache (`test_plugin_paths.js`).
- `rank_modules.js` exposes Rank's domain modules as one namespace
  (`requireRankDomain`, `runRankDomain`); `stats_modules.js` loads every Stats
  module as one bundle (`core`, `dashboard`, `load`) with ECharts left
  external, so suites supply a fake chart engine.
- `test_settings_generation.js` checks that `schemas/` generation is deterministic,
  matches the staged TS modules, manifests and Python constants, rejects invalid
  schemas, and that descriptions stating a default agree with it.
  `test_generated_metadata.py` imports the staged Python constants and checks
  values and int/float types against each schema.
- `fixtures/domain-parity.json` contains shared fixed expectations for browser
  and Python settings/rules; `domain_fixtures.js` supplies the browser host.
- Compactor's `test_dirty_compactor.js` compiles the rules and automation
  modules on demand. `test_dirty_compactor_ui.js` executes its single compiled
  bundle through `compactor_harness.js`, with Stash-owned element/hooks and the
  real staged hub save/job helpers. It covers registration, draft/save ordering,
  native filter payloads and preview/run/review actions.
  `test_dirty_compactor_store.py` covers polling during shared writer activity,
  concurrent Rank votes/settings saves/caption heartbeats, and exclusive claims/CAS.
  Backend tests preserve originals when ownership changes after preview, during
  encoding, or between the two commit checks. The isolated fixture checks that
  scene ID criteria combine with `files_filter.scene_count`; explicit `findFiles`
  IDs bypass the accompanying filter on Stash 0.31.1.
- The opt-in isolated Stash integration also compares the aggregated served
  bundle with staging. It uses synthetic FFmpeg media and a temporary database,
  never port 9999:
  `python -B tests/test_dirty_compactor_stash_integration.py --binary /path/to/stash`.
  Add `--serve` for browser review; Ctrl+C cleans up the isolated fixture.
- Every opt-in Stash fixture shares `verify_served_bundle`. By default it checks
  release staging: exact served bytes and no source map. After
  `npm run build:dev`, pass `--development` to require the inline map and decode
  served component lines back to their embedded TSX; the map may name only the
  plugin's own sources and the shared `plugins/DirtyPlugins/src/shared/`
  modules. The mode is read from the staged bundle, and each mode refuses
  staging built in the other.
- `library_copy_fixture.py` (not a `test_` module, never run by `npm test`)
  starts a second Stash on copies of the local Stash and DirtyPlugins
  databases, for quicker realistic checks while porting. It copies through
  SQLite's read-only backup API, redirects every stored absolute path below a
  folder that does not exist (so file operations fail instead of touching real
  media), pauses Compactor and Tidy automation, serves all eight staged
  plugins without generated files or images, and deletes the copy on exit:
  `python -B tests/library_copy_fixture.py --binary /path/to/stash`. Stop it
  with Ctrl+C or `--stop-file <path>`. Anything that writes files stays on the
  synthetic fixtures; `test_library_copy_fixture.py` covers the redirection.
- `test_dirty_settings_draft.js` imports the typed shared hook with injectable
  host hooks and timers. It checks raw invalid values, in-flight edits/reverts,
  ordered revisions, failure/retry/reload, stale loads and unmount cleanup.
  `test_dirty_plugins_ui.js` loads both compiled hub/Compactor bundles to check
  dirty reports, before-unload protection and rejected tab navigation.
- `test_dirty_plugins_stash_integration.py` extends the controlled Stash fixture
  to all eight plugins and verifies the exact hub bundle (and its TSX maps with `--development`).
- `test_dirty_plugins_protocol.py` covers the shared backend protocol: `serve`
  logging and timing, the single ASCII envelope, the exit policy, public error
  messages, quiet backends and UTF-8 standard streams including stdin.
- Extractor's `test_dirty_file_extractor.js` imports typed selection and queue
  modules; `test_dirty_file_extractor_ui.js` renders its
  compiled TSX through `extractor_harness.js` and exercises the real picker DOM,
  registration, async races and capture masking. Its opt-in fixture is
  `python -B tests/test_dirty_file_extractor_stash_integration.py --binary
  /path/to/stash`: synthetic scene/image/marker copies, dry runs, collisions,
  progress/cancellation, unchanged originals and the exact served bundle.
  Add `--serve --stop-file <path>` for browser review and graceful cleanup.
  Backend tests also cover bounded batches, requested order/missing IDs, duplicate
  selections, and one FFmpeg configuration lookup across multiple clip failures.

- Tidy's settings/preview helpers, manual workflow and automation monitor are
  compiled on demand from source. `test_dirty_tidy_ui.js` renders
  the sole compiled bundle through `tidy_harness.js` to check explicit saves,
  confirmation, approval, capture masking, dirty reports and registration.
  `python -B tests/test_dirty_tidy_stash_integration.py --binary /path/to/stash`
  checks confined native moves/renames, unknown metadata/missing files,
  collisions, stale/unreviewed plans, approved Scan automation and deduplication,
  byte/entity preservation and the exact served bundle. Add
  `--serve --stop-file <path>` for browser review and graceful cleanup.

- Captions language/track/native filter and Scan behavior are compiled on
  demand from source. `test_dirty_captions_ui.js` exercises the sole browser
  bundle through `captions_harness.js`; `captions_native_filter.js` models the
  native enum/custom-field URL/bookmark contract. Checks cover owned track
  cleanup, guard failures, retry/late responses, status-poll races and action
  locking.
  `test_dirty_captions_index.py` checks connection/page counts for 1,000 unchanged
  scenes, bounded queue batches, concurrent cancellation and newer pending revisions.
  Repeat the timing sample with `python -B tests/benchmark_captions_index.py` after
  building; the benchmark uses fake GraphQL and requires no media files.
  `python -B tests/test_dirty_captions_stash_integration.py --binary /path/to/stash`
  checks synthetic multilingual WebVTT, no subtitle sidecars, partial fields,
  unchanged-file skipping, forced errors/recovery, Scan identity deduplication,
  media/entity preservation and the exact served bundle. Add
  `--serve --stop-file <path>` for player/filter/settings browser review.

- Multiscreen's settings/playlists/items/context/query/cache domains are
  compiled on demand in `test_dirty_multiscreen.js`.
  `test_dirty_multiscreen_ui.js` executes its sole browser bundle through
  `multiscreen_harness.js`: context order/counts, pane limits, markers, audio,
  hidden-tab pause/resume, counters, async races and player/listener/observer
  cleanup of unmounted components. The opt-in fixture is
  `python -B tests/test_dirty_multiscreen_stash_integration.py --binary /path/to/stash`:
  synthetic scene/marker/performer/studio contexts, native order/counts,
  HTTP seeking, byte/entity preservation and the exact served bundle.
  Add `--serve --stop-file <path>` for browser acceptance and graceful cleanup.

- Rank's domain, media and session suites compile the modules they need on
  demand (`rank_modules.js`). Registration tests execute the sole compiled
  IIFE, including a failing registration step (logged once, never retried) and
  a reloaded bundle.
  `test_dirty_rank_cache.js` checks confidence/entry reuse, revision-driven invalidation,
  exact tied/extreme scores, incremental updates, 1,000 repeated changes and logistic
  evaluation counts. After building,
  `node tests/benchmark_rank_scores.js 27e810f` compares synthetic cold/warm scoring
  with the report's baseline commit; timings are never assertions.
  `python -B tests/test_dirty_rank_stash_integration.py --binary /path/to/stash`
  verifies synthetic portraits/media/markers, rating/undo, HTTP seeking and
  the exact served bundle. Add `--serve --stop-file <path>` for browser review.
  `test_dirty_rank_cold.js` checks shifted-weight parity, bounded task yields,
  cancellation/port cleanup, shared preparation, changes during calculation,
  native loading/unmount and one overall pool calculation per sorted performer.
  `node tests/rank_cold_browser_fixture.js .build/rank-cold-browser-stop` serves
  a standalone 5,000-performer/three-category browser check on a random loopback
  port; create the stop file to close it. It uses only synthetic ratings and
  never connects to Stash. Start with a fresh stop-file name.

- Stats' suites load its modules through `stats_modules.js` to test the
  registry, data/chart lifetimes, settings, analytics, native filters and
  dashboard components.
  `test_dirty_stats_frontend.js` measures aggregate reuse and chart lifetime through
  edits/theme changes, retained zoom/pan, per-resource cancellation/pruning, shared
  capacity requests, stale replies, and Growth period selection.
  Registration tests run the sole compiled IIFE with its modular ECharts and
  map inputs (every configured series type must be registered in
  `src/echarts.ts`), a map-free release bundle and a reloaded bundle. Run
  `python -B tests/test_dirty_stats_stash_integration.py --binary /path/to/stash`
  for synthetic portraits/videos, native ratings/dates/tags/studios/view counters,
  exact served bundle and unchanged media/native metadata.
  Add `--serve --stop-file <path>` for browser acceptance and graceful cleanup.

Tests assert behavior, not source text. The architecture rules that used to be
text-matching tests are now enforced where they apply: the build rejects plugin
source that calls `fetch("/graphql")` or parses the capture parameters itself,
bundles that import React, another plugin or an undeclared package, and
manifests without the hub dependency; `npm run typecheck` enforces the hub's
typed API. `test_capture_styles.py` keeps the one stylesheet check that
protects privacy: capture mode must hide media and private paths.
Exercise queues, undo, cancellation and navigation through real controllers or
components with explicit scenario assertions. The transport suite instantiates
its factory directly. The Rank session suite exercises serialized votes,
optimistic undo, failed saves and keyboard handling directly through the
extracted hook. The media suite checks rendered behavior.

The build-pipeline suite checks that every plugin stages exactly its derived
install files and compares every copied one byte-for-byte with source.

`test_media_processes.py` runs synthetic children through the separate quality,
packet, and marker runners: silent timeouts, cancellation, bounded diagnostics,
reaping before partial deletion, and completed/failed publication. On Windows it
forcibly terminates each synthetic parent and verifies that its contained child
exits. These checks do not open media or connect to Stash.

The build-pipeline fixture lives under `.build/` and uses a dependency junction where supported; otherwise it
copies the installed packages without a network install. Its
disposable checkout checks that a failed build leaves the previous staging
intact, unsafe package cleanup, missing assets, extra manifest scripts, a
missing hub dependency, settings left in a manifest that has a schema,
runtime-artifact exclusion, shared-input package identities, TSX host React,
minified release and readable development output, and the bundle boundary and
source rules. Build and package commands share staging, so run them
sequentially. Watch rebuilds files only; it does not copy into Stash or refresh
the browser. Stop watch for checks.

`test_bundle_size.js` guards release output: every compiled bundle stays within
its recorded budget in `fixtures/bundle-sizes.json` and carries no source map.
The build's boundary rules keep foreign inputs, including chart code outside
Stats, out of every bundle. Raise a budget only with a reason recorded in the
fixture's note.

Manual synthetic benchmarks: `node tests/benchmark_rank_scores.js 27e810f`,
`node tests/benchmark_rank_cold.js`,
`node tests/benchmark_rank_updates.js`,
`python -B tests/benchmark_captions_index.py`, and
`python -B tests/benchmark_compactor_quality.py 2`. The quality benchmark needs
FFmpeg with libvmaf and compares one/two/three workers, automatic versus explicit
thread limits, wall time, Windows child CPU time and VMAF scores. These use
generated inputs and never read the live library. Use workspace-local TEMP/TMP
in restricted Windows sessions as described above.
The Rank update benchmark compares a two-person vote against the former affected-cache
invalidation policy using the same evaluator; other categories remain warm in both runs.
It reports seven-sample medians after two warm-ups for one and three cached categories.

After `./build_site.sh _site/main`, run `npm run test:packages` to verify all
eight ZIPs, their root manifests, staged bytes, dependencies, source/build
identities, and checksums. This check reads existing package output and does
not rebuild it. CI runs it before uploading the Pages artifact.
It also rejects any source, test, tooling or runtime-data file in a ZIP.
`python -B tests/test_package_install_stash_integration.py --binary /path/to/stash`
then installs those packages into an empty plugin directory of an isolated Stash
through its package manager (local HTTP package source, random port), adding
each declared DirtyPlugins requirement as Stash's UI does. Installed files must
equal the ZIPs plus Stash's `manifest` record; every plugin must load, serve its
staged bundle, and the hub, Rank and Compactor backends must run.
