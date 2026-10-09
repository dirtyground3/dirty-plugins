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
├── DirtyCompactor/      # media compaction UI and backend
├── DirtyFileExtractor/  # selection UI + Python extraction backend
├── DirtyMultiscreen/    # multiscreen playback UI
├── DirtyRank/           # battle/leaderboard UI + Glicko-2 backend
├── DirtyStats/          # statistics/visualization UI
└── DirtyTidy/           # preview UI + file-organization backend
tests/                   # Python unittest + Node JS tests + shared UI contract tests
scripts/                 # staged build, settings generator and install-file registry
schemas/                 # authored settings metadata, one <pluginId>.settings.json each
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
  `hubApi.configurePlugin`, `hubApi.values`, `hubApi.ui` — data and helpers.
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

The shared contract is guarded by `tests/test_shared_ui_contract.py`. If you
change the runtime, update that test intentionally rather than weakening it.

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
- Standard settings save automatically after a short debounce. Only DirtyTidy
  keeps an explicit preview/confirm workflow because its strategy moves and
  renames files. Preserve that exception.
- Mark unsaved or invalid values visibly and protect against leaving with
  unsaved changes.
- Support the documentation-capture mode (`?docsCapture=1`) mechanics already
  used to blur private paths and adult media in screenshots.

## JavaScript and TypeScript conventions

- Run `npm run build` to stage all eight plugins under `.build/plugins/`.
  `scripts/plugin-registry.json` explicitly lists installable files. Builds never
  overwrite source or installed plugins. Add required runtime files to the
  allowlist; never add runtime data, source tooling, or tests.
- `npm run build` stages minified release bundles without source maps for
  tests, packages and installs; property names are never mangled and
  `keepNames` preserves function/component names. `npm run build:dev` and
  `npm run build:watch` stage readable bundles with inline maps for debugging;
  never package or install a development build.
- Every plugin authors `src/index.ts` or `src/index.tsx` with internal imports,
  colocated types, and small TSX components, and compiles to one browser IIFE
  with the existing entry filename; its manifest's `ui.javascript` lists only
  that entry. Configure `bundle` and selected CommonJS `testModules` in the
  registry. Source manifests keep host metadata (identity, version, exec, tasks,
  hooks, dependencies, asset mappings).
- Selected settings metadata (keys, labels, descriptions, defaults, bounds,
  options) and constants shared by TS and Python live only in
  `schemas/<pluginId>.settings.json`. The build generates `@generated/<id>.settings`
  TS modules in `.build/generated/`, the staged manifest's `settings:` section,
  and same-directory Python constants for registry `generatedFiles`. A bundle may
  import only the modules in its registry `generatedImports`. Never put `settings:`
  back into a source manifest that has a schema. Keep normalization, coercion,
  migrations and algorithms handwritten in each language.
- Entries validate the host and claim their instance guard before registration.
  Imported modules must not install routes, patches, or listeners. Tear down
  owned effects where supported; preserve one-time guards for host integrations
  that cannot unregister.
- Source is strict TypeScript (`tsconfig.json`). Run `npm ci` and
  `npm run typecheck`, which generates `.build/generated/` first; esbuild does
  not replace checking and TypeScript is never shipped to Stash. The only global
  declarations are in `types/stash-globals.d.ts`; use `import type` for hub types.
- Access React through `window.PluginApi.React` with a typed host adapter and
  classic `React.createElement`/`React.Fragment` output. Never bundle
  React/ReactDOM or another plugin's implementation; type-only imports are
  allowed. Shared runtime APIs remain on DirtyPlugins; the hub exposes only
  members that a plugin uses.
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
- Keep shared storage logic in `dirty_plugins_storage.py`; plugins reuse the
  same SQLite database rather than creating their own.

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
components Stats uses in `src/echarts.ts`. Keep these local to Stats; the other
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

`npm test` builds once, then runs typecheck, every `tests/test_*.js` suite, and
Python unittest discovery. Focused npm test commands also prepare staging.
Direct Node/Python test-file invocations require `npm run build` first. Runtime
tests use staged path helpers; architecture checks use authored source.
Missing/stale builds fail clearly. See `tests/README.md` for details.

Add or update tests with behavior changes. Contract tests in `tests/` enforce
that plugins use the shared GraphQL client, shared visual primitives, and the
hub runtime exports.

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
  `docs/build-migration-status.md` records the completed migration's handoffs.

## Local install (this machine)

Stash runs on port `9999` with `plugins_path: C:\Users\FABIO\.stash\plugins`.
Installed directories are the plugin IDs (not the repo directory names):
`DirtyPlugins`→`dirtyPlugins`, `DirtyFileExtractor`→`extractScenes`,
`DirtyMultiscreen`→`multiscreen`, `DirtyRank`→`dirtyRank`,
`DirtyStats`→`dirtyStats`, `DirtyTidy`→`dirtyTidy`,
`DirtyCaptions`→`dirtyCaptions`.
`DirtyCompactor`→`dirtyCompactor`.

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

## Content safety

Never commit uncensored adult media. Any screenshot in the repository must
fully blur, pixelate, or cover every performer image, thumbnail, video frame,
and potentially explicit region before it is committed. Cropping alone is not
sufficient. Keep uncensored captures outside the repository and its history.
