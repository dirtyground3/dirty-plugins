# Running the checks

From the repository root, install development tooling and run all checks:

```powershell
npm ci
npm test
```

`npm test` builds installable output once, runs the strict TypeScript check,
then every JavaScript suite and Python unittest discovery.
Python 3.9+ and Node.js must be available
on PATH. Set the `PYTHON` environment variable to a different Python executable
for the combined runner if needed. TypeScript is development tooling only;
Stash users install generated packages without Node or runtime npm dependencies.

For a focused check:

```powershell
npm run typecheck
npm run test:js
npm run test:python
npm run build # release staging; required before direct Node/Python test-file invocations
node tests/test_dirty_rank_media.js
python -B -m unittest discover -s tests -p test_dirty_tidy.py -v
```

The JavaScript runner discovers `tests/test_*.js` in alphabetical order and runs
each in its own Node process with its output intact. Any failure or process
launch error makes the runner fail; later suites still execute. Helper files
must use a different filename prefix. The combined runner continues to Python
after JavaScript failures and returns a failing exit code if either stage fails.

Plain Python discovery also invokes the Rank algorithm and media JavaScript
suites when Node is available. The combined runner sets
`DIRTY_PLUGINS_SKIP_JS_TESTS=1` only for its Python child because those two suites
have already run. Their two unittest entries appear as intentionally skipped;
all other Python checks execute normally.

# Test helpers

- `load_plugin_scripts.js` loads real manifests in dependency order. Use its
  `loadPluginScripts` for VM contexts or `sourceFor` for aggregated assets.
- `plugin_paths.js` and `plugin_paths.py` distinguish `runtimePath`/`runtime_path`
  under `.build/plugins/` from `sourcePath`/`source_path` under authored `plugins/`.
  Missing/stale staging produces an error asking for `npm run build`. Runtime
  and Python-backend tests use staging; architecture checks retain source access.
- `testModulePath` loads explicitly selected CommonJS domain/controller modules
  compiled to `.build/test-modules/` through the registry's `testModules` entries.
- `shared_runtime.js` installs actual shared save, job and metadata helpers into
  a minimal plugin host.
- `ui_harness.js` provides plain element trees, tree search/text and event
  dispatch. Suites own React hook state, component expansion and scenario data.
- `test_settings_generation.js` checks that `schemas/` generation is deterministic,
  matches the staged TS modules, manifests and Python constants, rejects invalid
  schemas, and that descriptions stating a default agree with it.
  `test_generated_metadata.py` imports the staged Python constants and checks
  values and int/float types against each schema.
- `fixtures/domain-parity.json` contains shared fixed expectations for browser
  and Python settings/rules; `domain_fixtures.js` supplies the browser host.
- Compactor's `test_dirty_compactor.js` imports staged rules and automation
  CommonJS modules. `test_dirty_compactor_ui.js` executes its single compiled
  bundle through `compactor_harness.js`, with Stash-owned element/hooks and the
  real staged hub save/job helpers. It covers registration, draft/save ordering,
  native filter payloads, preview/run/review actions and cleanup.
- The opt-in isolated Stash integration also compares the aggregated served
  bundle with staging. It uses synthetic FFmpeg media and a temporary database,
  never port 9999:
  `python -B tests/test_dirty_compactor_stash_integration.py --binary /path/to/stash`.
  Add `--serve` for browser review; Ctrl+C cleans up the isolated fixture.
- Every opt-in Stash fixture shares `verify_served_bundle`. By default it checks
  release staging: exact served bytes, no source map, and only plugin-owned
  inputs in esbuild's recorded dependency graph. After `npm run build:dev`, pass
  `--development` to require the inline map and decode served component lines
  back to their embedded TSX. Each mode refuses staging built in the other.
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
- Extractor's `test_dirty_file_extractor.js` imports typed selection, filtered
  mutations and queue modules; `test_dirty_file_extractor_ui.js` renders its
  compiled TSX through `extractor_harness.js` and exercises the real picker DOM,
  registration, async races, capture masking and cleanup. Its opt-in fixture is
  `python -B tests/test_dirty_file_extractor_stash_integration.py --binary
  /path/to/stash`: synthetic scene/image/marker copies, dry runs, collisions,
  progress/cancellation, unchanged originals and the exact served bundle.
  Add `--serve --stop-file <path>` for browser review and graceful cleanup.

- Tidy's settings/preview helpers, manual workflow and automation monitor are
  imported from selected CommonJS test modules. `test_dirty_tidy_ui.js` renders
  the sole compiled bundle through `tidy_harness.js` to check explicit saves,
  confirmation, approval, capture masking, dirty reports and registration.
  `python -B tests/test_dirty_tidy_stash_integration.py --binary /path/to/stash`
  checks confined native moves/renames, unknown metadata/missing files,
  collisions, stale/unreviewed plans, approved Scan automation and deduplication,
  byte/entity preservation and the exact served bundle. Add
  `--serve --stop-file <path>` for browser review and graceful cleanup.

- Captions language/track/native filter and Scan behavior use five selected
  CommonJS modules. `test_dirty_captions_ui.js` exercises the sole browser
  bundle through `captions_harness.js`; `captions_native_filter.js` models the
  native enum/custom-field URL/bookmark contract. Checks cover owned cleanup,
  guard failures, retry/late responses, status-poll races and action locking.
  `python -B tests/test_dirty_captions_stash_integration.py --binary /path/to/stash`
  checks synthetic multilingual WebVTT, no subtitle sidecars, partial fields,
  unchanged-file skipping, forced errors/recovery, Scan identity deduplication,
  media/entity preservation and the exact served bundle. Add
  `--serve --stop-file <path>` for player/filter/settings browser review.

- Multiscreen's settings/playlists/items/context/query/cache domains use seven
  selected CommonJS modules in `test_dirty_multiscreen.js`.
  `test_dirty_multiscreen_ui.js` executes its sole browser bundle through
  `multiscreen_harness.js`: context order/counts, guard/partial registration,
  pane limits, markers, audio, hidden-tab pause/resume, counters, async races
  and player/listener/observer cleanup. The opt-in fixture is
  `python -B tests/test_dirty_multiscreen_stash_integration.py --binary /path/to/stash`:
  synthetic scene/marker/performer/studio contexts, native order/counts,
  HTTP seeking, byte/entity preservation and the exact served bundle.
  Add `--serve --stop-file <path>` for browser acceptance and graceful cleanup.

- Rank's seven selected CJS modules test domains and UI/session behavior.
  The seeded domain fixture compares 405 combinations with the pre-port
  0.7.68 implementation. Registration tests execute the sole compiled IIFE,
  including missing dependencies, duplicate/partial registration and cleanup.
  `python -B tests/test_dirty_rank_stash_integration.py --binary /path/to/stash`
  verifies synthetic portraits/media/markers, rating/undo, HTTP seeking and
  the exact served bundle. Add `--serve --stop-file <path>` for browser review.

- Stats' twelve selected CJS modules test registry, data/chart lifetimes,
  settings, analytics, native filters and dashboard components. Its seeded
  fixture compares 331 growth/age/registry scenarios against pre-port 0.6.41.
  Registration tests run the sole compiled IIFE with its modular ECharts and
  map inputs (every configured series type must be registered in
  `src/echarts.ts`), a map-free release bundle, partial-registration guards and
  cleanup. Run
  `python -B tests/test_dirty_stats_stash_integration.py --binary /path/to/stash`
  for synthetic portraits/videos, native ratings/dates/tags/studios/view counters,
  exact served bundle and unchanged media/native metadata.
  Add `--serve --stop-file <path>` for browser acceptance and graceful cleanup.

Keep architectural source/manifest checks for dependency order, shared GraphQL
access and runtime exports. Exercise queues, undo, cancellation, navigation and
cleanup through real controllers or components with explicit scenario assertions.
The transport suite instantiates its factory directly rather than slicing a
function out of source text. The Rank session suite exercises serialized votes,
optimistic undo, failed saves, keyboard handling and cleanup directly through the
extracted hook. The media suite still checks rendered behavior. Its Python
contract retains UI metadata checks without depending on internal setter or
queue variable names.

The build-pipeline suite compares every copied install file byte-for-byte with
source. Its disposable checkout checks unsafe cleanup, missing assets, extra
manifest scripts, missing bundles, stale inputs,
runtime-artifact exclusion, shared-input package identities, TSX host React,
duplicate bundle evaluation, and selected test-module compilation. Build and
package commands share staging, so run them sequentially. Watch rebuilds files
only; it does not copy into Stash or refresh the browser. Stop watch for checks.

`test_bundle_size.js` guards release output: every compiled bundle stays within
its recorded budget in `fixtures/bundle-sizes.json` (never above the plugin's
pre-migration JavaScript), carries no source map, and bundles only its own
inputs; chart code may appear only in Stats. Raise a budget only with a reason
recorded in `docs/build-migration-status.md`.

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
