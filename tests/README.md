# Running the checks

From the repository root, install development tooling and run all checks:

```powershell
npm ci
npm test
```

`npm test` runs TypeScript diagnostics without emitting files, every JavaScript
suite, and Python unittest discovery. Python 3.9+ and Node.js must be available
on PATH. Set the `PYTHON` environment variable to a different Python executable
for the combined runner if needed. TypeScript is development tooling only;
plugins still run directly in Stash without a build or runtime npm dependencies.

For a focused check:

```powershell
npm run typecheck
npm run test:js
npm run test:python
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
- `shared_runtime.js` installs actual shared save, job and metadata helpers into
  a minimal plugin host.
- `ui_harness.js` provides plain element trees, tree search/text and event
  dispatch. Suites own React hook state, component expansion and scenario data.
- `fixtures/domain-parity.json` contains shared fixed expectations for browser
  and Python settings/rules; `domain_fixtures.js` supplies the browser host.

Keep architectural source/manifest checks for dependency order, shared GraphQL
access and runtime exports. Exercise queues, undo, cancellation, navigation and
cleanup through real controllers or components with explicit scenario assertions.
The transport suite instantiates its factory directly rather than slicing a
function out of source text. The Rank session suite exercises serialized votes,
optimistic undo, failed saves, keyboard handling and cleanup directly through the
extracted hook. The media suite still checks rendered behavior. Its Python
contract retains UI metadata checks without depending on internal setter or
queue variable names.
