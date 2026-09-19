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
├── DirtyPlugins/        # shared runtime: GraphQL, settings, React components, SQLite owner
├── DirtyFileExtractor/  # selection UI + Python extraction backend
├── DirtyMultiscreen/    # multiscreen playback UI
├── DirtyRank/           # battle/leaderboard UI + Glicko-2 backend
├── DirtyStats/          # statistics/visualization UI
└── DirtyTidy/           # preview UI + file-organization backend
tests/                   # Python unittest + Node JS tests + shared UI contract tests
build_site.sh            # builds the GitHub Pages package source
docs/images/             # censored screenshots used by the README
```

Each plugin directory contains: `<manifest>.yml`, the JS/CSS assets it names,
an optional Python backend, `README.md`, and `LICENSE`. Keep directory names and
contents unchanged — Stash installs by directory.

## Shared runtime (DirtyPlugins)

Everything common lives in `plugins/DirtyPlugins/`. Do not duplicate it in
plugins. Before writing new UI or data access, check `dirtyPlugins.js` for an
existing primitive:

- `DirtyPlugins.graphql` / `hubApi.graphql` — the only GraphQL client. Plugins
  must not call `fetch("/graphql")` directly.
- `hubApi.runPluginOperation`, `hubApi.getPluginSettings`,
  `hubApi.configurePlugin`, `hubApi.values`, `hubApi.ui` — data and helpers.
- `DirtyPlugins.react` — shared components: `SettingsCard`,
  `SettingsSection`, `SettingsToggle`, `IconButton`, `StateView`, and other
  settings primitives. Prefer these over bespoke markup.
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

## JavaScript conventions

- No build step. Assets are served to Stash as-is.
- Each file is an IIFE with `"use strict"` guarded by an `INSTANCE_KEY` on
  `window`. Re-registering cleanly (tear down prior observers/handlers) is
  required because Stash can reload assets without reloading the page.
- Access React through `window.PluginApi.React` and create elements with
  `React.createElement` (aliased `h`). Do not import bundlers, JSX, or npm
  packages.
- Use ES5-compatible `var` and function style to match existing files.
- Use `useMemo`/`useCallback` where existing code does; keep components small.

## Python conventions

- Target Python 3.9+ and the standard library only (for example `sqlite3`,
  `urllib`, `subprocess`, `pathlib`). Do not add third-party dependencies.
- Backends are invoked by Stash and communicate over a JSON stdin/stdout
  contract; follow the existing `interface: raw` / `exec` manifest pattern.
- Keep shared storage logic in `dirty_plugins_storage.py`; plugins reuse the
  same SQLite database rather than creating their own.

## Settings and data

- `dirty_plugins.sqlite3` (WAL mode) in the DirtyPlugins directory is the
  authoritative store for settings and high-frequency data (for example
  DirtyRank rating pools and battle journal). It lives outside Stash entity
  hooks by design.
- Manifests still declare typed `settings:` entries so the hub can render
  controls, but plugins read/write values through the hub, not Stash config.
- Writes are debounced and serialized so an older request cannot overwrite a
  newer value. Keep that guarantee.
- Never force-add runtime artifacts (`.sqlite*`, WAL, backups, `__pycache__`)
  to the repository; `build_site.sh` also excludes them from packages.

## Dependencies

Add a library only when it clearly earns its place, and only if it is already
available through the Stash `PluginApi` runtime. Prefer the shared DirtyPlugins
code and small, plain implementations over new dependencies. Avoid cluttering
the assets and the UI.

## Testing

Run the suite from the repository root:

```powershell
python -B -m unittest discover -s tests -v
node --check plugins/DirtyRank/dirtyRank.js
node tests/test_dirty_rank_algorithms.js
node tests/test_dirty_rank_media.js
node tests/test_dirty_tidy_automation.js
node tests/test_dirty_stats.js
node tests/test_dirty_multiscreen.js
```

Add or update tests with behavior changes. Contract tests in `tests/` enforce
that plugins use the shared GraphQL client, shared visual primitives, and the
hub runtime exports.

## Build and release

- Local package build (needs Bash and `zip`):
  `./build_site.sh _site/main`
- Pushes to `main` touching `plugins/**` or `build_site.sh` publish the package
  source to GitHub Pages via `.github/workflows/deploy.yml`. Do not commit
  generated `_site/` output.
- Bump the plugin's `version` in its manifest for user-visible changes.

## Local install (this machine)

Stash runs on port `9999` with `plugins_path: C:\Users\FABIO\.stash\plugins`.
Installed directories are the plugin IDs (not the repo directory names):
`DirtyPlugins`→`dirtyPlugins`, `DirtyFileExtractor`→`extractScenes`,
`DirtyMultiscreen`→`multiscreen`, `DirtyRank`→`dirtyRank`,
`DirtyStats`→`dirtyStats`, `DirtyTidy`→`dirtyTidy`.

```powershell
# 1. Copy changed files into the installed plugin directory.
Copy-Item -LiteralPath plugins\DirtyStats\dirtyStats.js `
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
