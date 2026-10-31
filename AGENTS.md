# AGENTS.md

Guidance for working in this repository. See `README.md` for user-facing
documentation; this file covers architecture and the conventions to follow.

## What this project is

A collection of integrated plugins for [Stash](https://stashapp.cc/). Each
plugin ships as a self-contained directory under `plugins/`, and all of them
depend on the shared, unlisted **DirtyPlugins** hub runtime.

## Repository layout

```text
plugins/
├── DirtyCaptions/       # embedded text subtitles via in-memory WebVTT tracks
├── DirtyPlugins/        # shared runtime: GraphQL, settings, React components, SQLite owner
├── DirtyFileExtractor/  # selection UI + Python extraction backend
├── DirtyMultiscreen/    # multiscreen playback UI
├── DirtyRank/           # battle/leaderboard UI + Glicko-2 backend
├── DirtyStats/          # statistics/visualization UI
└── DirtyTasks/          # file organization, additive encoding and tag updates
tests/                   # Node test suites, Python unittest and opt-in Stash fixtures
scripts/                 # staged build, settings generator and plugin registry
schemas/                 # authored settings metadata, one <pluginId>.settings.json each
types/                   # the only global TypeScript declarations
.build/plugins/          # ignored installable output, never authored source
build_site.sh            # packages staged plugins for GitHub Pages
docs/images/             # censored screenshots used by the README
```

Each plugin directory contains: `<manifest>.yml`, the JS/CSS assets it names,
an optional Python backend and helper modules, `README.md`, and `LICENSE`.
Keep directory names stable — Stash installs by directory.

## Shared runtime (DirtyPlugins)

Everything common lives in `plugins/DirtyPlugins/`. Do not duplicate it in
plugins. Before writing new UI or data access, check `src/index.tsx` and the
typed public contract in `src/types.ts` for an
existing primitive:

- `DirtyPlugins.graphql` / `hubApi.graphql` — the only GraphQL client. Plugins
  must not call `fetch("/graphql")` directly.
- `hubApi.runPluginOperation`, `hubApi.getPluginSettings`,
  `hubApi.configurePlugin`, `hubApi.ui` — data and helpers.
- `hubApi.registerPlugin(pluginId, setup)` — the one registration entry point
  (see the conventions below).
- `DirtyPlugins.react` — shared components: `SettingsCard`,
  `SettingsSection`, `SettingsToggle`, `IconButton`, `StateView`, and other
  settings primitives. Prefer these over bespoke markup.
- `DirtyPlugins.react.useSettingsDraft` — typed loading, validation, dirty
  reporting and serialized autosave. Keep revision/conflict policy and workflow
  state local.
- `hubApi.registerSettingsPanel(pluginId, component)` — mounts a plugin's
  settings UI inside the shared hub.
- CSS custom properties prefixed `--dirty-ui-*` (tokens, radius, shadow, etc.)
  are the shared visual language.
- `plugins/DirtyPlugins/src/shared/` — the typed host binding (`host.ts`:
  `PluginApi`, `hub`, `React`, `ui`) and pure value helpers (`values.ts`). It is
  the only hub source compiled into the other bundles. Put only stateless code
  there; anything that must exist once (GraphQL client, settings, React
  components, debug log) stays on the hub object.

The typed contract in `src/types.ts` is enforced by `npm run typecheck`: `Host`
is the single description of the Stash plugin API and `HubApi` of the hub. The
build enforces the architecture rules (`SOURCE_RULES` and the boundary plugin in
`scripts/build.mjs`). Add a rule there rather than a test that matches source
text.

Every plugin manifest must declare the hub as a UI dependency:

```yaml
ui:
  requires:
    - dirtyPlugins
```

## UI and UX conventions

- Keep the interface homogeneous across plugins. Reuse the shared components,
  class-name prefixes, layout, spacing, and `--dirty-ui-*` tokens. A new plugin
  should feel like the others.
- Match established naming: CSS classes are prefixed per plugin (for example
  `ms-`, `dirty-rank-`, `dirty-tidy-`).
- Standard settings save automatically after a short debounce. Only DirtyTasks file organization
  keeps an explicit preview/confirm workflow because its strategy moves and
  renames files. Preserve that exception.
- Mark unsaved or invalid values visibly and protect against leaving with
  unsaved changes.
- Support the documentation-capture mode (`?docsCapture=1`) mechanics already
  used to blur private paths and adult media in screenshots.

## JavaScript and TypeScript conventions

- Run `npm run build` to stage all seven plugins under `.build/plugins/`. The
  build stages into `.build/staging`, renames the previous output to a backup,
  and promotes staging. Failed promotion restores the previous output; if a
  file lock also prevents restoration, `.build/plugins.previous` retains it
  and the next build recovers it. Builds never overwrite
  source or installed plugins.
- Install files are derived from the manifest: the manifest itself, its
  `ui.javascript` and `ui.css` entries, the top-level `*.py` modules, the
  registry's `chunks`, `generatedFiles` and `extraFiles`, `README.md` and
  `LICENSE`. `scripts/plugin-registry.json` holds only what cannot be derived
  (`directory`, `id`, `entry`, `chunks`, `generatedImports`, `generatedFiles`,
  `bundledPackages`, `extraFiles`, `runtimeDirectories`). Never place runtime
  data, source tooling, or tests where they would be installed.
- `npm run build` stages minified release bundles without source maps for
  tests, packages and installs; property names are never mangled and
  `keepNames` preserves function/component names. `npm run build:dev` and
  `npm run build:watch` stage readable bundles with inline maps for debugging;
  never package or install a development build.
- Every plugin authors `src/index.ts` or `src/index.tsx` with internal imports,
  colocated types, and small TSX components, and compiles to one browser IIFE
  with the existing entry filename; its manifest's `ui.javascript` lists only
  that entry. Source manifests keep host metadata (identity, version, exec, tasks,
  hooks, dependencies, asset mappings).
- Stash loads every plugin's entry on every page. Code that only some pages
  need may be a registry `chunk` (source -> output under a `ui.assets`
  directory): the build compiles it as a separate ES module and turns the
  entry's `import("./module")` into an import of its served
  `/plugin/<id>/assets/...` URL; a static import of a chunk fails the build.
  Stats keeps ECharts and the world map in `assets/dirtyStatsCharts.js`, which
  `DirtyStatsRoute` waits for through `loadCharts()`.
- Write plain ES modules with named exports. Do not wrap a plugin's modules in
  `createX(dependencies)` factories; tests compile the modules they need on
  demand and replace an import where a fake is required
  (`tests/plugin_paths.js`).
- Selected settings metadata (keys, labels, descriptions, defaults, bounds,
  options, headed `sections` and `disabledWhen` rules) and constants shared by
  TS and Python live only in
  `schemas/<pluginId>.settings.json`. The build generates `@generated/<id>.settings`
  TS modules in `.build/generated/`, the staged manifest's `settings:` section,
  and same-directory Python constants for registry `generatedFiles`. A bundle may
  import only the modules in its registry `generatedImports`. Never put `settings:`
  back into a source manifest that has a schema. Keep normalization, coercion,
  migrations and algorithms handwritten in each language.
- An entry is `hub?.registerPlugin(ID, () => { ... })`. The hub runs each
  plugin's setup once, attributes its debug log lines, and logs a failed
  registration once without retrying or undoing it. Imported modules must not
  install routes, patches, or listeners at load; do that inside the setup
  callback. Stash cannot unregister routes or patches, so plugins have no
  `destroy()` handles or instance keys; clean up only what a React effect owns.
  `window.DirtyPlugins` is the hub's own guard.
- Source is strict TypeScript (`tsconfig.json`). Run `npm ci` and
  `npm run typecheck`, which generates `.build/generated/` first; esbuild does
  not replace checking and TypeScript is never shipped to Stash. The only global
  declarations are in `types/stash-globals.d.ts`; use `import type` for hub types.
- Access the host through the shared binding: each plugin's `runtime.ts`
  re-exports `React`, `PluginApi`, `hub` and `ui` from
  `plugins/DirtyPlugins/src/shared/host`. Output stays classic
  `React.createElement`/`React.Fragment`. Never bundle
  React/ReactDOM or another plugin's implementation; type-only imports and the
  `shared/` folder are the only cross-plugin imports. Shared runtime APIs remain
  on DirtyPlugins; the hub exposes only members that a plugin uses.
- `npm run format` (Prettier, 120 columns) formats the TypeScript sources,
  `scripts/` and the JavaScript tests; `npm test` checks it. Run only that
  script: CSS, Markdown, vendor files and fixtures are not formatted.
  `.gitattributes` keeps every text file LF.
- Versions before 1.0.0 were developer builds. Do not keep compatibility with
  their APIs, URLs, file layouts or hub versions. Code that reads older stored
  data is removed only after a read-only check shows real data no longer needs it.
- Bundles target ES2020. Check browser behavior with the opt-in isolated Stash
  fixtures (synthetic media); `tests/library_copy_fixture.py` adds read-only
  checks against a path-redirected copy of the local library.
- Use `useMemo`/`useCallback` where existing code does; keep components small.

## Python conventions

- Target Python 3.9+ and the standard library only (for example `sqlite3`,
  `urllib`, `subprocess`, `pathlib`). Do not add third-party dependencies.
- Backends are invoked by Stash and communicate over a JSON stdin/stdout
  contract; follow the existing `interface: raw` / `exec` manifest pattern.
- Keep the manifest's executable script as the JSON protocol entry point and
  import same-directory modules for domain logic.
- Every `main()` is one call to `dirty_plugins_protocol.serve(name, run, ...)`.
  It reads the payload, logs started/finished/failed with the mode and
  duration, applies the exit policy and writes one ASCII JSON envelope;
  `run(payload, reporter)` returns the result. Backends that the browser polls
  (Captions, Compactor) pass `quiet=True` and log only failures. Use
  `public_error` when an error message could expose private paths.
- Keep shared storage logic in `dirty_plugins_storage.py`; plugins reuse the
  same SQLite database rather than creating their own. A table that only one
  plugin uses belongs to that plugin (`dirty_compactor_store.py`).

## Settings and data

- `dirty_plugins.sqlite3` (WAL mode) in the DirtyPlugins directory is the
  authoritative store for settings and high-frequency data (for example
  DirtyRank rating pools and battle journal). It lives outside Stash entity
  hooks by design.
- Staged manifests declare typed `settings:` entries (generated from `schemas/`)
  so the hub can render controls, but plugins read/write values through the hub,
  not Stash config.
- Writes are debounced and serialized so an older request cannot overwrite a
  newer value. Keep that guarantee.
- Never force-add runtime artifacts (`.sqlite*`, WAL, backups, `__pycache__`)
  to the repository; `build_site.sh` also excludes them from packages.

## Dependencies

Prefer libraries already available through Stash `PluginApi`, the shared
DirtyPlugins code, and small plain implementations. DirtyStats has one existing
exception: modular ECharts 5.6.0 (with ZRender and tslib, pinned npm development
dependencies declared as `bundledPackages`) and Natural Earth map data, with
licenses under `plugins/DirtyStats/vendor/`. Register only the chart types and
components Stats uses in `src/echarts.ts`, the on-demand chart chunk. Keep these local to Stats; the other
plugins and the hub must not load a chart library. A new dependency needs a
clear use case, license inventory, offline packaging, and no equivalent shared
or native Stash capability. See `plugins/DirtyPlugins/STYLE.md` for the UI
component and theme conventions.

## Testing

Run the suite from the repository root:

```powershell
npm ci
npm test
```

`npm test` builds once, then runs typecheck, the format check, every
`tests/test_*.js` suite through `node --test`, and Python unittest discovery.
Focused npm test commands also prepare staging. Direct Node/Python test-file
invocations require `npm run build` first, and again after changing source: a
missing build fails clearly, a stale one is not detected. Runtime tests use
staged path helpers; module tests compile authored source on demand. See
`tests/README.md` for details.

Add or update tests with behavior changes. Test behavior, not source text: the
build and the type checker enforce that plugins use the shared GraphQL client,
the hub's capture mode and its typed API.

## Build and release

- Local package build (needs Node dependencies, Bash and `zip`):
  `./build_site.sh _site/main`
- The package script builds staging and limits output cleanup to `_site/`.
  Package update identities include plugin source and shared build inputs.
- Pushes to `main` touching plugins or shared build/test inputs publish the package
  source to GitHub Pages via `.github/workflows/deploy.yml`. Do not commit
  generated `_site/` output.
- Every plugin's first TS/TSX release was `1.0.0`. Bump the patch version of
  each plugin whose runtime files (bundle, manifest content, styles, backends)
  change, once per release, and update the README version table and release
  notes. README-only and staging-only changes keep versions.

## Local install (this machine)

Stash runs on port `9999` with `plugins_path: C:\Users\FABIO\.stash\plugins`.
Installed directories are the plugin IDs (not the repo directory names):
`DirtyPlugins`→`dirtyPlugins`, `DirtyFileExtractor`→`extractScenes`,
`DirtyMultiscreen`→`multiscreen`, `DirtyRank`→`dirtyRank`,
`DirtyStats`→`dirtyStats`, `DirtyTasks`→`dirtyTasks`,
`DirtyCaptions`→`dirtyCaptions`.


DirtyCaptions keeps subtitle payloads in memory: its backend converts through
FFmpeg stdout and its frontend uses data URLs accepted by Stash's default CSP.
Register tracks with the native source selector to preserve transcode timing
adjustments, and remove only plugin-owned tracks on cleanup. Do not persist
subtitle text or create sidecars as part of this playback feature.
The caption index stores fingerprints and status through shared storage metadata;
only its three owned scene custom fields are updated with partial GraphQL writes.
Preserve unknown/error results and hook-loop protection. Server hooks queue work;
optional refresh after Scan uses the browser's successful job-completion events,
as in DirtyTidy. Deduplicate by job ID plus startTime in shared storage and skip
internal scans. Do not add timer-based library checks.
The persistent file-ID map must skip unchanged media before statting or probing
files. Discover changes using Stash's stored size, mod_time, and content hashes;
do not calculate hashes again. Preserve a separate forced reprobe action.
Playback reads the same map first: an unchanged file without subtitle streams
returns no tracks without media access, and a probe that matches the saved
result queues no index work. The player retries a request that got no answer
with a doubled wait and never reports it.
Caption choices belong in one Embedded captions criterion in the native scene
filter dialog. Reuse native enum criterion prototypes and value controls,
preserve unrelated custom fields in either criterion order,
and serialize URLs and saved filters as normal Stash custom-field criteria.

```powershell
# 1. Build and copy changed runtime files from staging.
npm run build
Copy-Item -LiteralPath .build\plugins\DirtyStats\dirtyStats.js `
  -Destination C:\Users\FABIO\.stash\plugins\dirtyStats\dirtyStats.js -Force

# 2. Reload plugins in the running Stash.
Invoke-RestMethod -Uri http://localhost:9999/graphql -Method Post `
  -ContentType application/json -Body (@{query='mutation { reloadPlugins }'} | ConvertTo-Json)

# 3. Verify the loaded version and the served bundle.
$body = @{query='{ plugins { id version enabled } }'} | ConvertTo-Json
Invoke-RestMethod -Uri http://localhost:9999/graphql -Method Post `
  -ContentType application/json -Body $body
Invoke-WebRequest -Uri http://localhost:9999/plugin/dirtyStats/javascript -UseBasicParsing
```

Do not copy `__pycache__/`, `*.pyc`, or SQLite artifacts. Stash aggregates a
plugin's declared JS/CSS into `/plugin/<id>/javascript` and `/plugin/<id>/css`
(the individual source paths 404). Reloading does not refresh the browser: the
user must hard-refresh (Ctrl+F5) the Stash tab.

## Non-goals

These simplifications keep coming up and do not pay off.

- Another save framework. The shared save controller and `useSettingsDraft`
  exist; Rank's revisions, Stats' key merging and Compactor's blocking after a
  failed save are different policies, and Tasks organization keeps preview/confirm.
- One chart definition for Stats pages and dashboard widgets, or one table of
  Stats defaults. They share aggregates and leaf helpers; presentation,
  defaults and persistence keys differ on purpose.
- One filter representation or editor for the hub, Stats and Rank.
- One subprocess runner. Captions bounds in-memory output with a timeout,
  Compactor journals progress and cancellation, Extractor produces marker
  clips; only child containment is shared.
- Collapsing the destructive workflows of Tidy, Extractor and Compactor. Their
  plans, reservations, approvals and journals are different contracts.
- Removing caption caches, leases, unknown/error states or hook-loop
  protection, or adding timer-based library checks.
- Replacing rules mirrored in TypeScript and Python with one language. Browser
  previews need fast local math and the server must validate; parity fixtures
  keep them in step.

## Content safety

Never commit uncensored adult media. Any screenshot in the repository must
fully blur, pixelate, or cover every performer image, thumbnail, video frame,
and potentially explicit region before it is committed. Cropping alone is not
sufficient. Keep uncensored captures outside the repository and its history.
