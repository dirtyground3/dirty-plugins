# Simplification opportunities

Reviewed on 2026-10-09 against commit `982477b` ("Simplify plugin code without
changing behavior"). The report itself changed no code; all sizes in it are
measured from that tree and its savings are estimates. Items 1-14 were
implemented on 2026-10-10: see the
[implementation record](#implementation-record--2026-10-10) at the end for
what was done, the measured effect and where the result differs from the
proposal. The proposals below are kept as written, so they describe the code
before that work.

`clean.md` (2026-10-04, since deleted; Git history keeps it) covered local
duplication: Stats loaders, Rank controls, CSS duplicates, and similar items.
Most of that work has been done.
This report looks one level up, at **structures that make every change
expensive**. Most of them are leftovers from the JavaScript-IIFE era that the
TypeScript port kept to preserve behavior, and most of them are no longer needed.

## Summary

| # | Change | Area | Estimated effect | Risk | Changes a written rule? |
| -: | --- | --- | --- | --- | --- |
| 1 | Drop runtime teardown; the hub owns registration | All plugin entries | −200–300 production lines in about 25 files | Low | Yes (AGENTS.md "tear down owned effects") |
| 2 | Plain ES modules instead of `createX(dependencies)` factories in Rank and Stats | Rank, Stats | −400–550 lines, about 40 KB of wiring | Medium (mechanical, typechecked) | No |
| 3 | One typed host binding instead of eight `readRuntime` copies | All plugins | −150–250 lines | Low | Partly ("entries validate the host") |
| 4 | Retire source-text "contract" tests | Tests | −900–1,100 test lines | Low | Yes (AGENTS.md "shared contract is guarded by…") |
| 5 | Tests compile TS on demand; drop the 47 registered `testModules` | Build, tests | −200+ lines of registry/plumbing | Low | Yes (registry convention) |
| 6 | One render loop for UI tests (or real React) | Tests | −100–200 lines, closer to real hook behavior | Low | No |
| 7 | Use `node --test`; stop running JS suites from Python | Tests | −100 lines and one env-var workaround | Low | No |
| 8 | Trim build guardrails (lock, fingerprint, link walking) | Build | −150–250 lines | Low | Partly |
| 9 | One backend protocol and `serve()` for every Python entry point | Backends | −80–150 lines | Low–medium | No |
| 10 | Finish the `schemas/` migration for Tidy and Stats | Tidy, Stats | −60–120 lines; removes two TS/Python drift points | Low | No |
| 11 | Stop instrumenting `PluginApi` globally in the debug layer | Hub | −100–130 lines and 16 global writes | Low | No |
| 12 | Plugin-owned storage helpers; managed IDs defined once | Hub storage | Clearer ownership, small net | Low | No |
| 13 | Documentation diet | Docs | −3,200 Markdown lines | None | No |
| 14 | Formatter and `.gitattributes` | Repo | Readability; removes the line-ending workaround | None | No |
| B | Bold option: one plugin instead of eight | Everything | Removes the hub/plugin boundary | High (product decision) | Yes |

The ranges overlap and should not be added up. Items 1–3 depend on each other;
item 4 makes all the others cheaper.

**Recommended order:** 13 → 4 → 5/7/8 → 1 → 3 → 2 → 10 → 9 → 11 → 6 → 12.
Delete the documentation first (no risk) and the change-detector tests second;
every later refactor then edits fewer assertions.

---

## 1. Drop runtime teardown and let the hub own registration

**What exists.** Each of the seven plugin entry points has the same machinery:

- an instance object with `status` and `destroy()`;
- a `lifetime`/`life` record of effects;
- `useOwnedEffect` and `useActive` hooks, or `owned()` wrappers;
- `lifetime.active ? … : result` checks in every patch;
- a `registrationAttempted` flag that decides whether to delete the guard
  after a failure.

It takes about 120 lines across the seven plugins. Stats goes further. In
`plugins/DirtyStats/src/index.tsx:13-25` it replaces `React` with a copy whose
`useEffect` registers cleanups for `destroy()`. Rank does the same through
`createViews({ ...runtime, useEffect: life.useOwnedEffect })`
(`plugins/DirtyRank/src/index.tsx:20`).

**Evidence that it is unused.** No production code calls `destroy()`:

- Stash cannot unregister routes or patches.
- The hub never calls plugin teardown.
- `instance.status` is never read outside tests.

`destroy()` runs in only two places: the plugins' own failed-registration path
and 26 test calls. A page reload is the only real lifecycle.

**Proposal.**

- Keep the one-time guard; delete teardown.
- Add `DirtyPlugins.registerPlugin(id, setup)` to the hub. It handles the
  `window.__dirty<Name>Plugin` key, the try/catch with
  `console.error("[<Plugin>] registration failed")`, and the debug log line.
- Each entry becomes: get the hub, call `registerPlugin`, and install patches
  inside the callback.
- Remove `lifecycle.ts` (Rank, Multiscreen), the `Lifetime` types, the
  `useEffect` substitutes, and `active` checks in patches.

**Keep.** The guard against duplicate registration on bundle reload. Keep
abort/stale-response guards inside components; they cover unmounts, not
plugin teardown.

**Cost.** AGENTS.md says "Tear down owned effects where supported". That rule
would become "register once; Stash has no plugin unload". Tests that call
`destroy()` lose that scenario (they can unmount components instead).

**Why it matters.** This is the root cause of item 2. Rank and Stats inject
dependencies mainly so that a teardown-aware `useEffect` replaces React's own
`useEffect`.

## 2. Plain modules instead of factories in DirtyRank and DirtyStats

**What exists.** The hub and Multiscreen became plain modules in `982477b`.
Rank and Stats still build everything at runtime from one growing
dependency object:

- `plugins/DirtyStats/src/views.ts:44-49` runs fifteen `create*` functions in
  order. Each one is merged into a shared bag that the next one destructures.
  The comment says it all: "Each view module may use the views created before
  it." Dashboard views repeat this at `views.ts:59`.
- `plugins/DirtyRank/src/views.ts:16-31` builds a `base` object out of about 30
  renamed hub components (`SharedButton`, `SharedBadge`, …). It then chains
  `createPrimitives(base)` → `createPerformerCard({...base, ...primitives,
  ...preview})` → …
- The types exist only for this wiring: `ViewDependencies`
  (`DirtyStats/src/view.ts`, `DirtyRank/src/view.ts`), `DashboardDependencies`,
  four `Rank*Dependencies` interfaces in `DirtyRank/src/types.ts:99-210`, and
  `Pick<ViewDependencies, "React" | "Fragment" | …>` signatures with up to 46
  names (`components/Leaderboards.tsx:6`).
- 41 files contain a `const { … } = dependencies;` line, up to 934
  characters long.

The wiring files alone are 305 lines and 22.9 KB. The destructuring and `Pick`
lines add another 13 KB.

**Proposal.** Use the Multiscreen/Tidy pattern:

- A `runtime.ts` binds `React`, `PluginApi` and `hub` once; after item 3 this
  is a few lines.
- Components and domain functions are top-level exports that `import` what
  they use.
- Module-level caches (overall-sort caches, the rating index) stay in their
  module.

**Effect.**

- "Go to definition" works again.
- The order-dependent `Object.assign` chain disappears, and the typechecker
  reports missing or circular imports.
- Pure functions such as Rank settings normalization or Compactor rules can be
  imported by tests directly. `tests/domain_fixtures.js` no longer needs a
  fake `window`/`PluginApi`/hub just to call `createRankDomain`.

**Approach.** Do it file by file. Each file goes from
`export function createX(deps) { const {...} = deps; function A() {} return { A }; }`
to top-level exports, and the typechecker guides the edits. Do Stats first
because its pages are independent. Rank's `battleSession.ts`, `rank.ts` and
`settings.ts` follow.

## 3. One typed host binding instead of eight

**What exists.**

- Seven plugin `runtime.ts` files (180 lines) plus `DirtyRank/src/host.ts`
  each rebuild a partial `Host` type for Stash's `PluginApi`.
- Most also declare a partial `Hub` type.
  `DirtyCompactor/src/runtime.ts:13-25` retypes eleven hub members by hand
  instead of using `HubApi`.
- Each validates a list of 15–20 members with
  `[…].some(value => typeof value !== "function")`.
- The hub has already validated `PluginApi` in
  `DirtyPlugins/src/runtime.ts` `readHost()`.

**Proposal.**

- Declare Stash's `PluginApi` surface once in `types/stash-globals.d.ts`,
  next to `Window.DirtyPlugins`. Plugins import `HubApi`/`Host` as types only.
- A plugin needs just `window.DirtyPlugins` to exist; the hub's validation
  stands for the host. If a version check is ever needed, add one integer,
  `DirtyPlugins.apiVersion`, instead of checking every member.
- Check optional host features where they are used, for example
  `GQL.useJobsSubscribeSubscription`, instead of in a blanket list.

**Related.** The hub's public API includes four pure helpers through
`values` (`asObject`, `parseMaybeJson`, `clampInteger`, `coerceBoolean`), and
plugins must check that they exist. Pure helpers could be compiled into each
bundle from one shared source folder. The hub API would then contain only
things that must be singletons: transport, settings registry, theme, dialogs
and the components. This needs one exception in the esbuild boundary plugin in
`scripts/build.mjs` for that folder.

## 4. Retire source-text "contract" tests

**What exists.** About 550 assertions check that exact source text exists:

- `tests/test_shared_ui_contract.py`: 824 lines, 421 `assertIn`/`assertNotIn`
  calls.
- `tests/test_dirty_rank.py`: about 110 more, for example
  `assertIn("const showMedia = showImages || Boolean(scene) || sceneLoading",
  source)` and `assertIn("UNDO_HISTORY_LIMIT = 25", source)`.
- About 60 similar checks in JS suites.

They break on every rename, reformat or refactor, while behavior stays the
same. The previous simplification had to "update source-location contracts"
for each change. They also duplicate checks that already exist:

- `scripts/build.mjs` already rejects React imports, cross-plugin imports, a
  missing `requires: dirtyPlugins`, and extra `ui.javascript` entries. The
  tests re-check the same things by regex.
- TypeScript strict mode already proves "uses typed host React and imported
  views".
- Many Rank behaviors pinned by text are already executed in
  `test_dirty_rank_media.js` and `test_dirty_rank_session.js`.

**Proposal.**

- Delete the snapshot-style assertions.
- Move the few real architecture rules into the build's existing esbuild
  boundary plugin, where they fail with a clear message:
  - no `fetch("/graphql")` outside the hub;
  - capture mode is read only through `captureEnabled`, never from a
    plugin's own query parameter;
  - manifests require the hub.
- Keep the behavior tests that render or execute code.
- For CSS guarantees that matter for privacy (docs-capture blur on media),
  keep one small focused test per plugin.

**Cost.** AGENTS.md says to "update that test intentionally rather than
weakening it". This proposal replaces the test on purpose; the rule should
then point to the build checks.

## 5. Compile TypeScript on demand in tests; drop `testModules`

**What exists.**

- `scripts/plugin-registry.json` registers 47 `testModules`, about 200 JSON
  lines. Each is compiled to `.build/test-modules/<Plugin>/<name>.cjs`.
- Tests can only import a module after someone adds it to the registry, and
  `tests/plugin_paths.js` `testModulePath()` rejects anything unregistered.
- `tests/shared_runtime.js` loads hub features through `vm` from these
  outputs.

**Proposal.** Add one test helper, `loadSource("DirtyRank/src/domain/rank.ts")`,
that calls `esbuild.buildSync({ bundle: true, write: false, format: "cjs",
platform: "node" })` with the same generated-module alias, and evaluates the
result. Each module builds in milliseconds.

**Removes.** The `testModules` arrays, their validation in `build.mjs`, the
second esbuild pass and the `test-modules/` staging directory,
`testModulePath`, and the registry edit needed for every new test. After item
2, most domain tests can import plain functions without any host fakes.

## 6. One render loop for UI tests, or real React

**What exists.**

- `tests/ui_harness.js` has a hand-written hook engine (`createHooks`).
- Five harnesses (hub, Tidy, Captions, Compactor, Multiscreen) each copy the
  same `render`/`visit`/`release`/`flush` loop, about 20 dense lines each.
  Rank's media and session suites have their own simulators.
- The engine differs from React. For example, `useMemo` calls
  `useCallback(factory, deps)()`, which re-runs the factory on every render.
  Tests can therefore pass while real React behaves differently, or fail the
  other way round.

**Options.**

- Small: move the shared loop into `ui_harness.js` as
  `createRenderer({ React, root })`. Each harness keeps only its fakes and
  helpers (`click`, `input`, `toggle`).
- Larger, more faithful: add pinned `react` and `react-test-renderer` dev
  dependencies matching the host's React major (the repo types against React
  17). Then delete the hook engine. Bundles still never include React; only
  tests use it.

## 7. Use Node's test runner; stop running JS from Python

**What exists.**

- `tests/run_js_tests.js` discovers and spawns suites.
- `tests/test_test_runner.js` (54 lines) tests that runner.
- `tests/run_tests.js` runs JS, then Python with
  `DIRTY_PLUGINS_SKIP_JS_TESTS=1`. The variable exists because
  `tests/test_dirty_rank.py:622-646` also launches two JS suites through
  `subprocess`, and they would otherwise run twice.

**Proposal.**

- Use `"test:js": "node --test --test-concurrency=1 \"tests/test_*.js\""`.
  Node 24 is installed. It runs each file in its own process and fails on a
  non-zero exit, which is what the suites already do. Concurrency 1 keeps
  today's sequential order, because some suites share `.build/` or temporary
  directories.
- Delete the custom runner, its meta-test, the Python wrappers and the
  environment variable.
- `npm test` becomes `build && typecheck && test:js && test:python`.

## 8. Trim the build guardrails

**What exists.** `scripts/build-lib.cjs` (129 lines) and `scripts/build.mjs`
(229 lines) include, beyond bundling:

- a PID-probing lock file (`build.mjs:174-196`);
- a SHA-256 fingerprint of all inputs, a versioned `build-state.json`, and
  `requireBuild()` staleness checks. Python reimplements these by spawning
  Node (`tests/plugin_paths.py:30-41`).
- symlink walking on every path (`rejectLinks`), `relativeFile` validation,
  and an allowlist of directories `removeBuildDirectory` may delete;
- `tests/test_build_pipeline.js` (231 lines), which tests that machinery.

A full release build takes about 3 s. The lock and fingerprint mainly guard
direct test runs against a stale staging directory.

**Proposal.**

- Stage into a temporary directory, then rename it (keep this: a failed build
  never leaves half-written output).
- Replace staleness detection with simplicity: `npm test` and the focused
  `npm run test:*` scripts already build first. Direct file runs print one
  line: "run npm run build first".
- Drop the lock, the fingerprint state and the link walking. Keep one check
  that output paths stay under `.build/`.
- Keep the source-control-derived package identity only where
  `build_site.sh` needs it, computed inline.

**Optional.** The explicit `files` allowlist could be derived from the
manifest:

- the manifest itself;
- `ui.css`;
- the `exec` script;
- same-directory `*.py` files;
- `README.md` and `LICENSE`.

The current denylist regex in `validatePlugin` would stay as a safety net.
This is a judgment call: the explicit list is easy to audit, so keep it if
you prefer.

## 9. One backend protocol for every Python entry point

**What exists.** `plugins/DirtyPlugins/dirty_plugins_protocol.py` supports four
envelope variants:

- `nested` JSON string or direct object;
- `ensure_ascii` on or off;
- an optional trailing `newline`;
- custom `invalid_json` and `invalid_object` messages.

On top of that, `run_logged_backend` takes seven positional callables. The
backends use the options differently:

- Rank, Tidy and Extractor wrap `read_payload`/`emit_output`/`emit_error`
  with their own option sets.
- Stats, Captions and Compactor write their own `main()` (for example
  `dirty_stats.py:61-85`).

Yet the browser accepts every variant: `pluginResult` in
`DirtyPlugins/src/values.ts` parses `output` whether it is a string or an
object.

**Proposal.** Provide one `protocol.serve(name, run, public_error=str)`
function:

- It reads stdin as UTF-8, calls `run(payload, reporter)`, logs start, finish
  and timing, and writes one envelope format.
- Each `main()` becomes `return protocol.serve("DirtyRank", run)`.
- Captions keeps its privacy rule by passing `public_error` (or by raising a
  `PublicError` subclass for messages that are safe to show).

**Choose the nested string envelope for everyone.** Stash passes a direct
object through Go maps, which re-sort object keys; the nested string arrives
unchanged. That is probably why Rank and the hub nest. Also pick
`ensure_ascii=True` everywhere, as Tidy does: ASCII output cannot fail to
encode, even for file paths that contain lone surrogates, so the
`errors="backslashreplace"` stream option is no longer needed.

**Cost.** Tests that compare exact envelope bytes need updating.

## 10. Finish the `schemas/` migration for DirtyTidy and DirtyStats

Six of eight plugins keep settings metadata in `schemas/<id>.settings.json`.
The two others still duplicate it:

- **DirtyTidy.** `DEFAULT_SETTINGS` is written twice, in
  `src/domain/settings.ts:2` and `dirty_tidy.py:28`. The template variables
  (`VARIABLES` in TS, the token table in `dirty_tidy_templates.py`) are also
  maintained in both languages.
- **DirtyStats.** `src/settings.ts:10-40` hand-writes option lists and
  defaults (`STATS_SETTING_SPECS`). Its `visualTheme` options repeat the hub
  schema's theme list.

**Proposal.** Add `schemas/dirtyTidy.settings.json` and
`schemas/dirtyStats.settings.json`. Put variables and option tables under
`constants`, list the generated Python module in `generatedFiles`, and import
the generated tables. Stats' theme options can come from the hub's
`settingsMetadata`. Normalization stays handwritten, as AGENTS.md requires.

## 11. Stop instrumenting `PluginApi` in the debug layer

**What exists.** `plugins/DirtyPlugins/src/debug.ts` (203 lines) does more than
logging:

- `instrumentPluginApi` (`debug.ts:138`) replaces Stash's global
  `PluginApi.patch.before/after/instead` and `register.route`. Every patch
  handler registered afterwards, including handlers from third-party plugins,
  is wrapped. Each call is timed and logged into a 5,000-entry
  `window.__dirtyPluginsDebugLog`. This happens even when debug output is
  turned off.
- To attribute patches, every entry sets and clears
  `window.__dirtyCurrentPluginId` (16 writes in 8 files).

**Proposal.** Keep `debugLog`/`debugElapsed`/`dumpDebugLogs` as they are.
Install the `PluginApi` wrapping and the window error listeners only when
debugging is enabled (`localStorage dirtyPluginsDebug = "1"`), or remove them.

**Effect.** Stash's patch API is no longer modified for other plugins on
normal page loads. `__dirtyCurrentPluginId` can also go, because the
`registerPlugin(id, …)` helper from item 1 already knows the plugin ID.

## 12. Clearer ownership in shared storage

- `dirty_plugins_storage.py` contains Compactor's tables and queries
  (`compactor_schema`, `compactor_get/list/put/claim_run`, `:296-369`) and the
  internal-scan claims (`:371-384`). Move them into a DirtyCompactor module
  built on the shared `connect()`/`transaction()`. The hub module then holds
  only generic storage: settings, revisions, metadata and backup. Keep the
  one database, as AGENTS.md requires.
- The managed plugin IDs are written in three places: `dirty_plugins.py:15`,
  `src/constants.ts:14`, and implicitly `scripts/plugin-registry.json`. The
  settings generator could write them into the hub's generated
  `dirtyPlugins.settings` constants, as it already does for other tables.

## 13. Documentation diet

| File | Lines | Status |
| --- | ---: | --- |
| `docs/build-migration-status.md` | 2,066 | Handoff log of a finished migration |
| `docs/build-migration-plan.md` | 393 | Finished plan |
| `docs/build-migration-baseline.md` | 188 | Pre-migration inventory |
| `clean.md` | 590 | Earlier report; refers to deleted `.js` files and line numbers |
| `TODO.md` | 269 | Still useful, but 25 references point at `.js:` line numbers that no longer exist |

**Proposal.**

- Delete the three migration documents and `clean.md`; Git history keeps
  them.
- Move the still-relevant "do not do this" list from `clean.md` (one subprocess
  runner, one filter representation, collapsing destructive workflows) into a
  short "Non-goals" section in AGENTS.md.
- Re-anchor the open `TODO.md` items to current `src/` files.
- Update the references in `README.md`, `AGENTS.md`, `tests/README.md` and the
  note in `tests/fixtures/bundle-sizes.json`.

**Also.** `.idea/` is tracked (5 files) and shows up as modified in normal
work. Untrack it and add it to `.gitignore`.

## 14. Formatter and line endings

- **Long lines.** 534 TypeScript lines exceed 160 characters, and several
  files hold multiple statements per line. For example,
  `DirtyStats/src/views.ts:38-43` puts the chart initializer, loader setup
  and route table on single lines. This line-count compression makes code
  harder to read and review, and it rewards the wrong measure. A formatter
  (pinned Prettier or dprint as a dev dependency, `npm run format`, a check
  in `npm test`) would end the issue. Line counts would rise; the code would
  not get bigger.
- **Line endings.** `git ls-files --eol` shows that every committed text file
  is already LF in the index. The working tree has 60 CRLF files and 43
  mixed ones, from `core.autocrlf=true` plus tool edits. Git normalizes all of
  them to LF on commit, so preserving each line's ending only affects the
  working tree. A `.gitattributes` with `* text=auto eol=lf` and one fresh
  checkout of the affected files would make the tree uniform. After that, the
  per-line-ending procedure used for edits is no longer needed.

## Bold option: one plugin instead of eight

All eight plugins live in one repository, ship and version together, and
require the hub. Merging them into a single Stash plugin would remove most of
the cross-bundle machinery that items 1, 3, 5 and 12 only reduce:

- the `window.DirtyPlugins` public API and its `HubApi` types;
- eight entry guards and runtime adapters;
- the registry's per-plugin sections;
- `requires:` ordering;
- `MANAGED_PLUGIN_IDS`;
- the settings-panel registration API;
- eight package versions and the README version table.

It would build to one bundle, one stylesheet, and one Python entry point that
dispatches on `args.mode` to the existing domain modules.

**What you lose.** Users could no longer install only, say, Multiscreen. Stash
would show a single enable/disable switch; the per-feature switch would move to
the hub's own settings. The package index would offer one download. Existing
installs would need a one-time migration of plugin directories. The SQLite
settings are already keyed by plugin ID and could stay.

This is a product decision, not a refactor. It is listed because it removes
the largest amount of code. If modular install matters, items 1, 3 and 5 get
most of the benefit while keeping eight plugins.

## Worth investigating (lower confidence)

- **Rank settings normalization in two languages.** The TypeScript
  `settingsFromConfiguration` (`DirtyRank/src/domain/settings.ts`) and Python
  `normalize_settings` are kept in sync by `tests/fixtures/domain-parity.json`.
  Rank writes settings only through its own backend (`save_settings`), so
  stored values are already normalized. If the Rank `getSettings` operation
  returned normalized settings, the browser might only need defaults and
  draft validation. Check every browser consumer first: battle session,
  leaderboards, native sort and settings panel.
- **Hub CSS specificity.** The hub stylesheet has 65 `#root` selectors and
  118 `!important` declarations. Some fight Stash/Bootstrap and are needed.
  A pass with rendered checks in all seven themes could find the ones that
  only fight the hub's own earlier rules. The `dirty-ui-pilot` class name is
  a migration leftover that always appears together with
  `dirty-ui-page-shell`; the two can merge.

## Not recommended

These keep coming up but don't pay off. The reasons in `clean.md` still hold;
item 13 proposes keeping them in AGENTS.md.

- Merging the separate subprocess runners, filter representations, or the
  destructive workflows of Tidy, Extractor and Compactor.
- Moving browser previews to the backend just to remove mirrored code.
  Compactor's estimate preview needs fast local math; its parity fixture is
  the right tool.
- Removing caption caches, leases or hook-loop protection.

## How to verify each step

- Keep behavior tests; delete only text-snapshot assertions (item 4) and
  tests of removed machinery (teardown, build lock, custom runner).
- After each item: `npm test`, `git diff --check`, and the bundle-size budget.
  The budget should go down for items 1–3 and 11.
- Items 1–3 and 11 change runtime bundles. Install them together with the hub,
  bump patch versions as AGENTS.md describes, and do one live check in Stash
  (Ctrl+F5). Rank battle/leaderboards, a Stats page and the dashboard, Tidy
  preview and Multiscreen launch cover the changed wiring.
- Update AGENTS.md in the same commit as any item that changes a written rule
  (1, 3, 4, 5, 8).

## Implementation record — 2026-10-10

Items 1-14 are implemented. The bold option B (one plugin instead of eight) was
excluded by the user and is untouched.

### What was done

| # | Result |
| -: | --- |
| 1 | `DirtyPlugins.registerPlugin(id, setup)` (`plugins/DirtyPlugins/src/register.ts`) runs each plugin's setup once per page. Instance keys, `destroy()` handles, lifetime objects and `useOwnedEffect` are gone from all seven plugins; `window.DirtyPlugins` is the hub's own guard. |
| 2 | DirtyRank and DirtyStats are plain ES modules. The wiring files (`views.ts`, `view.ts`, Stats' `dashboardView.ts`, Rank's `lifecycle.ts`) and the `*Dependencies` interfaces are deleted. |
| 3 | `plugins/DirtyPlugins/src/shared/host.ts` is the one host binding and `shared/values.ts` the shared value helpers, compiled into each bundle. The hub's `Host` type is the single description of the Stash API; hand-written per-plugin host types are removed. |
| 4 | `tests/test_shared_ui_contract.py` and the other source-text assertions are removed. The rules they protected moved into the build (`SOURCE_RULES` and the boundary plugin in `scripts/build.mjs`) or the type checker. `tests/test_capture_styles.py` keeps the privacy check on capture-mode styles. |
| 5 | Tests compile TypeScript on demand (`compileSource`, `requireSource`, `runSource` in `tests/plugin_paths.js`). The registry's `bundle` and `testModules` entries and `.build/test-modules/` are gone. |
| 6 | Small option: one `createRenderer` and a corrected `createHooks` in `tests/ui_harness.js`, used by the hub, Tidy, Captions, Compactor and Multiscreen harnesses, with its own `tests/test_ui_harness.js`. Real React was not added. |
| 7 | `node --test --test-concurrency=1 "tests/test_*.js"` replaces `tests/run_tests.js` and `tests/run_js_tests.js`. Python discovery no longer starts JavaScript suites, and `DIRTY_PLUGINS_SKIP_JS_TESTS` is gone. |
| 8 | The build stages into `.build/staging` and renames it over `.build/plugins`. The build lock, the input fingerprint and `build-state.json`, symlink walking and the explicit per-plugin file lists are removed; install files are derived from the manifest (`installFiles` in `scripts/build-lib.cjs`). |
| 9 | Every backend `main()` is one `dirty_plugins_protocol.serve(name, run, ...)` call with one ASCII JSON envelope. The per-backend `read_payload`/`emit_output`/`emit_error`/`configure_standard_streams` wrappers are removed. |
| 10 | DirtyTidy's defaults and template variables and DirtyStats' display defaults and options come from `schemas/`; the Tidy backend reads the generated `dirty_tidy_metadata.py`. |
| 11 | The debug layer wraps `PluginApi.patch`/`register.route` and listens for page errors only when debugging is enabled while the page loads. The `__dirtyDebugWrapped`, `__dirtyDebugInstrumented` and `__dirtyCurrentPluginId` globals are gone. |
| 12 | Compactor's table and queries live in `plugins/DirtyCompactor/dirty_compactor_store.py`. The managed plugin IDs are defined once in `schemas/dirtyPlugins.settings.json` and generated for TypeScript and Python; the build checks them against the registry. |
| 13 | The three migration documents and `clean.md` are deleted (3,237 lines; Git history keeps them). `TODO.md` is re-anchored to the current source, AGENTS.md has a "Non-goals" section, and `.idea/` is untracked and ignored. |
| 14 | Prettier 3.6.2 (`npm run format`, checked by `npm test`) for TypeScript sources, scripts and JavaScript tests; `.gitattributes` keeps text files LF. |

### Differences from the proposal

- **Item 12, internal-scan markers.** They stay in shared storage because
  Captions, Tidy and Compactor all check them. They moved from Compactor's
  record table to the generic metadata table.
- **Item 13, deleted documents.** The parts that still matter were carried
  over first: the rejected ideas as "Non-goals" in AGENTS.md and the open
  manual checks in `TODO.md`.
- **Item 6.** The small option was chosen; adding real React to the tests
  remains possible later.
- **Item 1, `script started`.** The hub logs each plugin's `script started` and
  `script finished registering` lines itself, so the "Loading plugins…"
  diagnostic in the README still works.
- **Found on the way.** The new build rule caught DirtyStats parsing the
  `docsCapture` parameter itself (`domain/filters.ts`); it now uses the hub's
  `captureEnabled`. Re-reading `TODO.md` showed items 13, 14, 16 and P7 fixed
  and items 9, 10, 12, 17, P12, R5, R6 and R7 partly fixed.

### Behavior changes

Everything else is internal. These are also in the README release notes.

- The hub API changed: `registerPlugin` is new, and `values`,
  `settingsMetadata`, the `unregister*` functions, `debugElapsed` and
  `dumpDebugLogs` are no longer on `DirtyPlugins`.
- A failed registration is logged once in the console and not retried; partial
  registrations are not undone.
- Patch and route timing in the browser debug log needs debugging enabled
  before the page loads. `dirtyPluginsDumpDebugLogs()` is unchanged.
- All backends answer with the same envelope and log failures in the same
  form. DirtyCompactor now logs its failures to Stash's log; DirtyCompactor and
  DirtyCaptions still do not log each call.
- Internal-scan markers written before the update are not read.

### Measured effect

Lines are counted with both sides formatted by the same Prettier
configuration, because the first formatter run rewrote nearly every TypeScript
line. The raw Git diff is therefore much larger than the real change.

| Area | Before | After | Change |
| --- | ---: | ---: | ---: |
| Plugin TypeScript/TSX | 25,454 | 22,943 | -2,511 |
| JavaScript tests and helpers | 14,134 | 13,636 | -498 |
| Build scripts | 744 | 575 | -169 |
| `scripts/plugin-registry.json` | 362 | 61 | -301 |
| Python backends | 5,714 | 5,606 | -108 |
| Python tests | 6,947 | 5,923 | -1,024 |
| **Code total** | **53,355** | **48,744** | **-4,611** |

- Release bundles: 1,442,609 to 1,407,411 bytes. Without DirtyStats, whose size
  is mostly ECharts, the other seven shrink from 275,046 to 256,124 bytes
  (-6.9%). Budgets in `tests/fixtures/bundle-sizes.json` are tightened.
- Tests: 37 JavaScript suites before and after; Python tests went from 283 to
  216. The removed ones asserted source text or tested removed machinery
  (teardown, build lock, custom runner, per-backend stream wrappers).

### Verification

- `npm test` passes: release build, strict typecheck, format check, 37
  JavaScript suites and 216 Python tests.
- The seven opt-in isolated Stash fixtures pass against a real Stash binary
  with a temporary database and synthetic media (hub with all eight plugins
  loaded, Compactor, Tidy, Captions, FileExtractor, Rank, Stats, Multiscreen).
  They exercise registration, the exact served bundles and every backend's new
  envelope end to end. The hub fixture also passes with `--development` after
  `npm run build:dev`.
- Installed into the live Stash on 2026-10-10: all eight plugins register
  without console errors, the served bundles equal staging, the Stats dashboard
  and a Rank battle page render and the hub, Rank, Captions and Stats backends
  answer. The remaining interactive checks are listed under "Manual checks
  still open" in `TODO.md`.
- Versions are bumped for the release: DirtyStats 1.0.5, the other seven 1.0.4.
