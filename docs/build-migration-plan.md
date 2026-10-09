# TypeScript, TSX, and build migration plan

Status: proposed implementation plan. Prepared 4 October 2026. Updated
5 October 2026: bundle size reduction is a separate step after phase 4,
moved out of phase 6.

The user selected a phased migration of the whole suite using TypeScript,
TSX, and esbuild, with React supplied by Stash. This document plans that work;
it does not implement the migration or report a passing test baseline.

## Intended result

Plugin source uses normal imports, colocated types, and TSX components. A
development build produces installable plugin directories containing ordinary
JavaScript, CSS, manifests, Python backends, and required assets. Stash users
continue installing from the same package source and need no Node.js tooling.

DirtyPlugins remains the shared runtime, GraphQL client, settings/storage owner,
and component library. The build resolves dependencies within a plugin;
`ui.requires: [dirtyPlugins]` still controls the dependency between plugins.
Keep repository directory names, installed plugin IDs, entry filenames, routes,
settings keys, and stored-data formats stable.

Set each ported plugin's manifest to `version: 1.0.0` for its first released
TypeScript/TSX build, including DirtyPlugins. Plugins retain their current
versions until their port is complete. Subsequent releases use normal version
increments from that 1.0.0 baseline.

The first migrations preserve behavior. Extract the shared settings hook and
generate metadata in separate changes so regressions have a clear source.

## Target structure and build decisions

```text
plugins/<ExistingDirectory>/
  <existingManifest>.yml   # plugin identity, version, host integration
  src/
    index.ts              # guarded registration; index.tsx where needed
    runtime.ts            # typed access to Stash and DirtyPlugins
    components/*.tsx
    domain/*.ts
  <existingBackend>.py
  <existingStyles>.css
  vendor/                 # only existing, required plugin-owned assets
  README.md
  LICENSE
scripts/
  build.mjs
  generate-settings.mjs   # introduced in the metadata phase
schemas/
  <pluginId>.settings.json
.build/                   # ignored generated files
  generated/
  test-modules/
  plugins/<ExistingDirectory>/
    <existingManifest>.yml
    <existingEntry>.js
    <existingBackend>.py
    ...installable files
```

- Generate one browser IIFE bundle per migrated plugin. Keep legacy plugins'
  declared script lists during the transition. Stage both kinds of plugin into
  the same `.build/plugins/` tree; no source files are overwritten by a build.
- Use classic JSX output, `React.createElement` and `React.Fragment`, through
  a typed adapter for `window.PluginApi.React`. Avoid an automatic JSX-runtime
  import or a bundled second React/ReactDOM instance. esbuild supports
  [configurable JSX factories](https://esbuild.github.io/api/#jsx-factory).
- Retain DirtyPlugins as a runtime dependency. Feature bundles reference its
  public API through adapters; they do not import and rebundle hub components,
  storage clients, or transport implementations. Type-only hub imports are fine.
- Start with an explicit ES2020 output target, matching the current TypeScript
  target, and confirm supported Stash browsers in the baseline phase. Update
  the source convention to allow modern TypeScript in migrated directories.
  esbuild [does not fully lower modern JavaScript to ES5](https://esbuild.github.io/content-types/#javascript-caveats).
- Keep `tsc --noEmit` as a separate correctness check: esbuild's TypeScript
  transformation [does not perform type checking](https://esbuild.github.io/content-types/#typescript-caveats).
  Use strict checking for migrated TS/TSX; retain current JS/JSDoc checking for
  legacy files. Keep permissive types confined to documented host boundaries.
- Pin esbuild and compatible React type definitions as development dependencies.
  React type definitions must match Stash's supported React API. Python retains
  its standard-library-only runtime and Python 3.9 minimum.
- Use readable bundles with inline development maps while plugins are ported.
  The separate bundle size step after phase 4 then adds release builds without
  inline maps and conservative minification, after behavior parity. Preserve
  legal notices and do not mangle host/public property names. Keep the
  dependency/license inventory current.
- Keep CSS prefixes, tokens, cascade, and capture selectors. Splitting source
  CSS is optional; no CSS framework or selector renaming is needed.
- Build imports should declare functions and types without registering patches,
  routes, listeners, or observers. Validate the host and claim the entry's
  instance guard before registration side effects. Preserve cleanup ownership.
- Stash cannot unregister the patches described in the Rank entry. Preserve its
  duplicate-registration guard, including recovery after partial registration
  failure. Automatic component hot replacement is outside the initial build.
- Use watch mode to rebuild files. Validate development source maps against
  `/plugin/<id>/javascript`, since Stash aggregates declared assets. Prefer a
  single generated script and inline development maps if that works correctly
  with the served bundle. Do not assume individual asset URLs are available.
  After the size step, only explicit development builds carry inline maps.
- Keep generated output untracked. Local install copies from the staged plugin,
  and packaging reads the staged tree. Raw source directories cease to be
  directly installable as each plugin migrates; document that explicitly.

## Phase 0: establish the baseline and conventions

1. Run `npm ci` and the current `npm test`; record pre-existing failures before
   changing the architecture. Record bundle sizes, manifest script lists, and
   installation/package contents for all eight plugins.
2. Record the local Stash version, supported host React API, and supported
   browser target. Do not upgrade host libraries as part of this migration.
3. Update `AGENTS.md`, the hub UI guide, contributor/test instructions, and local
   install examples to distinguish legacy source from compiled source and to
   describe the staging layout and modern syntax rules.
4. Record focused regression scenarios for registration, unsaved settings,
   serialized writes/conflicts, cancellation, and resource cleanup. Existing
   domain-parity fixtures remain the behavioral reference.

Exit criterion: baseline results and the new build/source conventions are
recorded; existing behavior and compatibility requirements are explicit.

## Phase 1: build and test infrastructure

1. Add a cross-platform Node build script with an explicit plugin registry.
   Initially stage legacy runtime files without changing their execution order.
   Use an install-file allowlist and reject missing manifest assets. Exclude
   source-only files, tests, build tooling, SQLite/WAL/backups, bytecode, and
   Compactor runtime outputs. Preserve the configured previews asset mapping.
2. Add build/watch commands and ignore `.build/` and `_site/`. Constrain cleanup
   to verified staging/output paths; never clean source or installed plugin
   directories as a side effect of building.
3. Add shared test path helpers. JavaScript bundle tests load staged manifests;
   source architecture checks inspect authored source. Compile explicitly
   selected domain/controller modules into `.build/test-modules/` for direct
   Node tests, retaining injectable boundaries where tests need them.
4. Support staged Python-backend tests through a shared path helper, ensuring
   generated same-directory Python modules will be exercised when introduced.
   Keep protocol and standard-library compatibility tests.
5. Make `npm test` build once, typecheck, run JavaScript suites, then run Python
   discovery. Focused npm test commands prepare the needed artifacts. Document
   the build prerequisite for direct `node` or `python` test-file invocations;
   missing artifacts must produce a clear error instead of loading stale files.
6. Adapt `build_site.sh` to package staged directories. Source version/date
   metadata must come from tracked source and build inputs, never `git log` on
   `.build/`. Changes to shared build inputs must produce an update identity for
   affected packages even when their individual plugin directory is unchanged.
7. Update CI to install pinned Node tooling, run checks, build, and package.
   Expand deployment path triggers to include build scripts/configuration,
   schemas, package files, and relevant shared sources. Preserve plugin ZIP
   layouts, dependency declarations, checksums, and Pages paths.

Exit criterion: legacy plugins still pass their checks when staged and packaged
through the new pipeline; runtime package contents match the baseline. A clean
checkout can produce every package without pre-existing generated files.

## Phase 2: DirtyCompactor pilot

Compactor is a useful pilot because it combines a manageable frontend with
shared settings controls, native filters, jobs, dialogs, and output review.

1. Move its rules and automation modules to typed imports, then convert the
   component tree to TSX. Split components and domain functions by responsibility.
   Keep its Python workflows and settings semantics unchanged in this phase.
2. Emit `dirtyCompactor.js` and use it as the sole frontend script in the staged
   manifest. Keep its CSS and backend/preview asset paths stable.
3. Update tests to import domain exports and render JSX using the host harness.
   Retain bundle-level tests for required runtime checks, duplicate loading,
   partial registration failure where applicable, and cleanup.
4. Check rule editing, native filters, invalid values, autosave feedback, preview
   invalidation, job progress, review decisions, and cancellation. Exercise
   replacement/recovery behavior through fixtures and existing backend tests;
   live UI checks should use preview or controlled fixture media.
5. Compare authored source and wiring complexity with the baseline. Remove
   private global exports after their consumers/tests use imports; keep useful
   dependency injection instead of eliminating it indiscriminately.

Exit criterion: Compactor passes typecheck, domain/UI/backend tests, package
checks, and a Stash smoke check with the compiled bundle. Its TSX uses the host
React instance, and there is no functional change or duplicate registration.

## Phase 3: DirtyPlugins and the shared settings hook

1. Migrate values, save/job helpers, metadata, transport, theme, components,
   native adapters, and the hub entry to TypeScript/TSX. Keep public APIs stable
   so converted and legacy plugins can coexist. Keep `react.html` and its HTM
   runtime/license for legacy consumers during migration.
2. Replace internal factory wiring with imports where appropriate. Preserve
   explicit test seams for transport, timers, host registration, and persistence.
   Keep all frontend GraphQL requests routed through the hub transport.
3. After the hub conversion passes, add a typed `useSettingsDraft` hook around
   the existing serialized save controller. Accept callbacks for normalization,
   validation, comparable/serialized values, initial loading, and plugin-specific
   save/revision/conflict behavior. Retain visible invalid raw input until edited.
4. Move Compactor's repeated settings lifecycle into the hook in a separate
   change. Cover edits during an in-flight save, failures and retry, conflicts,
   dirty notifications, unmount, and protection when leaving unsaved changes.
   Do not merge preview/run workflow state into this settings abstraction.
5. Extend shared field definitions for ordinary controls. Keep specialized
   editors, native filters, and domain-specific validation local. DirtyTidy's
   explicit preview/confirm settings workflow remains an exception.
6. Update shared UI contract tests intentionally: verify host dependencies,
   public exports, GraphQL ownership, theme/capture behavior, and registration
   through meaningful contracts rather than compiled variable names or HTM text.

Exit criterion: the hub and all remaining legacy plugins still work together;
Compactor proves the hook's behavior; save ordering and conflict policies match
the baseline.

## Phase 4: migrate the remaining plugins individually

Use one independently reviewable change per plugin, with further splits for
Rank and Stats. Release compatible hub improvements before dependent plugins.

| Order | Plugin | Focused acceptance checks |
| --- | --- | --- |
| 1 | DirtyFileExtractor | Selection actions, server folder picker, path capture masking, planning/dry run, progress, collisions, cancellation. |
| 2 | DirtyTidy | Preview/confirm flow, approved plan validation, unsaved values, scan-event automation, confined moves/renames, unknown metadata handling. |
| 3 | DirtyCaptions | In-memory subtitle payloads, native track selection and transcode timing, plugin-owned cleanup, native enum/custom-field filter serialization, partial GraphQL writes, file-map skip behavior, hook/job deduplication. |
| 4 | DirtyMultiscreen | List order, selection contexts, grid limits, marker boundaries, playback/mute/loop behavior, hidden-tab pause, counters, player/listener cleanup. |
| 5 | DirtyRank | Settings revisions, shared draft hook, rating/matchmaking parity, optimistic voting, serialized persistence, undo, keyboard input, media lifecycle, native filtering/sorts, all leaderboard layouts. |
| 6 | DirtyStats | Registry, loaders, native filters/cards, dashboard settings, widget ordering, chart options, all themes/contrast, PNG export, capacity and forecast parity. |

For every plugin: use internal imports and colocated types, emit one guarded
bundle, replace test-only globals with module tests, retain final-bundle tests,
run focused checks followed by `npm test`, build the package, and verify the
served Stash bundle. Set the first released port's manifest version to `1.0.0`.
Preserve all captions-specific constraints in `AGENTS.md`,
including no timer-based library checks or sidecar persistence.

Use reducers only for clearly coupled UI transitions that benefit from them.
Any reducer refactor gets its own behavior tests/change after syntax conversion;
the migration is not a reason to rewrite working domain algorithms.

Exit criterion: all eight plugins use the build pipeline and imported source
modules; the full suite and package checks pass after each migration.

## Bundle size reduction (separate step after phase 4)

Readable output and inline development maps made the compiled bundles much
larger than the legacy scripts. Stash loads every enabled plugin's aggregated
`/plugin/<id>/javascript` on every page, so the cost reaches each page load.
Measured after phase 4 (5 October 2026), in bytes:

| Plugin | Served bundle | JS before map | Inline map | Legacy JS |
| --- | ---: | ---: | ---: | ---: |
| DirtyStats | 7,025,978 | 2,269,763 | 4,756,215 | 1,554,684 |
| DirtyRank | 794,824 | 253,453 | 541,371 | 248,889 |
| DirtyPlugins | 316,975 | 98,156 | 218,819 | 95,942 |
| DirtyMultiscreen | 193,262 | 60,095 | 133,167 | 55,369 |
| DirtyCompactor | 190,150 | 57,595 | 132,555 | 58,156 |
| DirtyTidy | 120,742 | 38,291 | 82,451 | 37,846 |
| DirtyCaptions | 106,081 | 31,154 | 74,927 | 29,442 |
| DirtyFileExtractor | 76,334 | 23,815 | 52,519 | 24,613 |
| **All eight** | **8,824,346** | **2,832,322** | **5,992,024** | **2,104,941** |

Stats' code is also larger because esbuild reprints the already-minified
ECharts 5.6.0 distribution in readable form. Its inline map embeds the ECharts
and world-map sources.

Run this step next, before phase 5; it does not depend on metadata generation.
Split it into three reviewable changes, in this order, and measure each one.
Save a baseline and the current 1.0.0 ZIPs under ignored `.build/` before each.

### Change A: release builds without inline maps (all plugins)

1. Add an explicit build mode. `npm run build`, packaging, tests and local
   installs use release output with no source map. `npm run build:watch` and a
   new development build command keep today's inline maps for debugging.
2. Make the mode part of the build fingerprint, so tests and packaging never
   load staging built in the wrong mode. Packaging always builds release output.
3. Do not ship external `.map` files. Stash serves only the aggregated asset and
   individual paths return 404, so a separate map would not resolve. Debug with
   a development build copied into Stash, then reload and hard-refresh.
4. Release code must be byte-identical to today's JS before the map comment,
   which makes this change behavior-neutral. Compiled-bundle tests assert that
   release bundles have no map. The build-pipeline suite checks both modes. The
   opt-in Stash fixtures check exact release bytes by default and keep
   decoded-TSX map checks behind a development-build option.
5. Update README, AGENTS, the hub UI guide and the tests README for the two modes.

Expected effect: about 6.0 MB of the 8.8 MB disappears; Stats falls from 7.03 MB
to 2.27 MB. Confirm by measurement.

### Change B: conservative minification (all plugins)

1. Enable whitespace and syntax minification and local identifier renaming for
   release builds. Never configure property mangling, so host, hub and public
   property names stay intact. Keep legal comments and every license file.
2. Check for runtime reliance on function or component names before renaming
   identifiers; use `keepNames` where names matter (for example React display
   names and error messages).
3. Run the full suite against release output, every opt-in Stash fixture, and a
   browser smoke check of each plugin's main UI with synthetic media only.

### Change C: modular ECharts for Stats

1. Replace Stats' full ECharts distribution with pinned 5.6.0 modular imports
   for the charts, components, features and renderer actually used. ECharts
   provides a [selective import interface](https://echarts.apache.org/handbook/en/basics/import/).
   Derive the list from the chart option builders and views. Add the pinned
   package as a development dependency. It and its zrender dependency are
   bundled into the Stats bundle only; record both licenses in the inventory.
2. Keep world-map geometry, chart code and attribution local to Stats. Do not
   change map data in this step.
3. Verify every chart, interaction, theme and PNG export in the isolated fixture
   before removing `vendor/echarts.min.js` and its type declaration. Keep the
   ECharts license and notice in the package.

### Size guard and release

- Add a release-size check that records each plugin's measured bundle size and
  fails on unexplained growth. It also rejects inline maps in packages,
  React/ReactDOM copies, hub implementation copies in feature bundles, and
  ECharts or zrender outside Stats.
- Install from release staging with verified backups and the manifest copied
  last, as for the ports. Increment the patch version of each plugin whose
  shipped files change, once per release. Keep the 1.0.0 ZIPs for rollback.

Exit criterion: packages and local installs contain no inline maps, while
development builds still decode maps to TSX in the served Stash context.
Minified bundles pass the full suite and every Stash fixture, and Stats renders
every chart, theme and export with modular ECharts. Each release bundle is no
larger than its plugin's legacy JavaScript, or the measured excess is justified
in the status record. The size check guards the recorded results.

## Phase 5: generate duplicated settings and constant metadata

1. Start with a small schema containing settings keys, defaults, types, display
   metadata, options, and scalar bounds. Generate TypeScript definitions/data,
   standard-library Python constants where needed, and the settings section of
   the staged manifest. Keep schemas authored and generated files ignored.
2. Keep the source manifest authoritative for identity/version, exec, tasks,
   hooks, UI dependencies, and asset mappings. Merge generated settings using a
   pinned development YAML parser if needed; avoid regex rewriting nested YAML.
3. Prove the generator with Multiscreen's simple metadata. Then migrate Rank's
   duplicated defaults/bounds/presets and Compactor's shared quality constants.
   Extend coverage to other plugins only where duplication warrants it.
4. Generate Python modules into the staged backend directory, so same-directory
   imports remain normal at runtime. Tests run the packaged backends as well as
   generation/parity checks. A built ZIP must work without schema generators,
   npm packages, or source directories.
5. Keep domain normalization, migrations, and algorithms handwritten. Preserve
   language-specific coercion behavior, unknown/error handling, field order,
   legacy settings, and existing persisted representations. Validate missing,
   null, invalid, boundary, and legacy inputs against the parity fixtures.

Exit criterion: selected metadata has one authored definition, repeated builds
produce identical generated contents, and JS/Python/manifest behavior agrees
with the pre-generation baseline.

## Phase 6: completion

ECharts modular imports and minification moved to the separate bundle size
step after phase 4.

1. Remove obsolete private global declarations, factory-only types, legacy asset
   lists, and test shims once their consumers have migrated. Remove HTM and
   `react.html` only after auditing public API compatibility; otherwise retain
   the small compatibility API and its license until a deliberate release.
2. Complete watch/source-map documentation for the development and release
   build modes and validate it in the served Stash context. The reliable
   development cycle remains build/copy/reload/hard-refresh; enabling watch mode
   does not itself make Stash refresh the browser.
3. Run the full suite, build every ZIP from a clean output directory, inspect ZIP
   contents/dependencies, and test installation into an empty plugin directory.
   Installation must not include runtime data or require development tooling.
   Recheck the dependency graph and the size guard's recorded results.
4. Verify each plugin's first released port uses manifest version `1.0.0`;
   increment versions normally for later shipped user-visible/runtime changes.
   Update README installation/development instructions and release notes.

Exit criterion: every plugin is installable from the generated packages, the
complete regression suite passes, migration conventions are documented, and
the generated dependency graph and package contents satisfy the shared-runtime
and offline-packaging contracts.

## Review and rollback checkpoints

Phase 1, the Compactor pilot, the hub conversion, the shared-hook extraction,
each remaining plugin, the size step's three changes (release maps,
minification, Stats ECharts), metadata generation, and phase 6 completion
should be separate reviewable changes. Split further when a change combines
independent behavior and tooling work.

Keep prior release ZIPs available for rollback. If a pilot fails its acceptance
checks, retain the legacy frontend while adjusting the pipeline. Source and
runtime representation changes must not migrate the SQLite database merely
because TypeScript or bundling is introduced.

Track success through removed internal wiring, meaningful typed coverage,
passing behavior tests, reproducible runtime files, bundle/package size, and
successful clean installs. Generated JavaScript line count is not a useful
measure of maintainability.
