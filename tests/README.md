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
  `python -B tests/test_dirty_rank_stash_integration.py --binary /path/to/stash`
  verifies synthetic portraits/media/markers, rating/undo, HTTP seeking and
  the exact served bundle. Add `--serve --stop-file <path>` for browser review.

- Stats' suites load its modules through `stats_modules.js` to test the
  registry, data/chart lifetimes, settings, analytics, native filters and
  dashboard components.
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
install files and compares every copied one byte-for-byte with source. Its
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
