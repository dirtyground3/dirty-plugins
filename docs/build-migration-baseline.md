# Pre-migration baseline

Captured 4 October 2026 from commit `34e1611` before build/test changes.

Local Stash: v0.31.1 (`4de2351e`), served React and ReactDOM 17.0.2.
Tooling: Node 24.13.0, Python 3.13.6, TypeScript 5.9.3.
Browser build target remains ES2020; do not imply support for older browsers
from Stash's separate legacy bundle. At the exact host commit, the
[frontend package](https://github.com/stashapp/stash/blob/4de2351e/ui/v2.5/package.json)
declares React/ReactDOM 17.0.2, Vite 5.4.21, and the legacy plugin 5.4.3.
The [Vite configuration](https://github.com/stashapp/stash/blob/4de2351e/ui/v2.5/vite.config.js)
uses `legacy()` unless disabled, without an explicit browser-version support
list or build target. This migration explicitly adopts ES2020 for modern
plugin browsers. Actual served-bundle/browser and source-map acceptance remains
part of the Compactor pilot; host legacy fallback does not transpile plugin assets.

## Plugin inventory

| Directory / installed ID | Version | Browser scripts in manifest order | JS bytes | Installable file bytes |
| --- | --- | --- | ---: | ---: |
| DirtyCaptions / `dirtyCaptions` | 0.2.3 | `dirtyCaptionsTracks.js`, `dirtyCaptionsIndex.js`, `dirtyCaptions.js` | 29,442 | 80,207 |
| DirtyCompactor / `dirtyCompactor` | 0.3.2 | `dirtyCompactorRules.js`, `dirtyCompactorAutomation.js`, `dirtyCompactor.js` | 58,156 | 152,334 |
| DirtyFileExtractor / `extractScenes` | 0.4.6 | `extractScenesPicker.js`, `extractScenes.js` | 24,613 | 70,460 |
| DirtyMultiscreen / `multiscreen` | 0.4.9 | `multiscreenPlaylists.js`, `multiscreenSettings.js`, `multiscreen.js` | 55,369 | 66,197 |
| DirtyPlugins / `dirtyPlugins` | 0.5.6 | `vendor/htm.umd.js`, `dirtyPluginsValues.js`, `dirtyPluginsSave.js`, `dirtyPluginsJobs.js`, `dirtyPluginsMetadata.js`, `dirtyPluginsSceneFilter.js`, `dirtyPluginsDebug.js`, `dirtyPluginsTransport.js`, `dirtyPluginsReact.js`, `dirtyPluginsTheme.js`, `dirtyPluginsNative.js`, `dirtyPlugins.js` | 95,942 | 206,343 |
| DirtyRank / `dirtyRank` | 0.7.68 | `dirtyRankSettings.js`, `dirtyRankRating.js`, `dirtyRankMatchmaking.js`, `dirtyRankSettingsPanel.js`, `dirtyRankBattleSession.js`, `dirtyRank.js` | 248,889 | 376,267 |
| DirtyStats / `dirtyStats` | 0.6.41 | `vendor/echarts.min.js`, `vendor/world.js`, `dirtyStatsRegistry.js`, `dirtyStatsGrowth.js`, `dirtyStatsAges.js`, `dirtyStatsData.js`, `dirtyStatsCharts.js`, `dirtyStatsChartOptions.js`, `dirtyStats.js`, `dirtyStatsDashboard.js` | 1,554,684 | 1,624,999 |
| DirtyTidy / `dirtyTidy` | 0.4.1 | `dirtyTidySettings.js`, `dirtyTidyPreview.js`, `dirtyTidy.js` | 37,846 | 97,191 |

Install-file allowlisting intentionally omits contributor-only `DirtyPlugins/STYLE.md`
and `DirtyTidy/TODO.md` from new packages. All manifests, runtime files, README,
licenses, and vendor attribution must be retained. Compactor's `/previews` mapping
continues to target `runtime/previews`; the runtime creates its contents.

## Regression checkpoints

- Registration: repeat asset loads, missing host dependency, partial Rank registration failure.
- Settings: visible invalid raw input, debounce, dirty/leave protection, errors and retry.
- Persistence: edits during an in-flight save, serialized writes, revisions and conflicts.
- Jobs: cancelled/stale completions, scan job deduplication, cleanup on unmount.
- Media/resources: owned tracks, players, listeners, observers, timers and preview cleanup.
- Domains: `tests/fixtures/domain-parity.json`, existing rating/rules/backend tests.

## Original test result

`npm ci` and the original `npm test` passed: TypeScript diagnostics, 24 JavaScript
suites, and 276 Python tests in 49.883s, with two expected combined-runner skips
for Rank's already-run JavaScript suites. No pre-existing failures found.
The original output remains in ignored `.build/baseline-test.log` on this machine.

### DirtyCaptions

Original package files (relative to the ZIP root):

- `dirty_captions.py` (3241 bytes)
- `dirty_captions_index.py` (23539 bytes)
- `dirty_captions_media.py` (6238 bytes)
- `dirtyCaptions.css` (606 bytes)
- `dirtyCaptions.js` (5839 bytes)
- `dirtyCaptions.yml` (2103 bytes)
- `dirtyCaptionsIndex.js` (15268 bytes)
- `dirtyCaptionsTracks.js` (8335 bytes)
- `LICENSE` (1069 bytes)
- `README.md` (13969 bytes)

### DirtyCompactor

Original package files (relative to the ZIP root):

- `dirty_compactor.py` (55506 bytes)
- `dirty_compactor_quality.py` (8730 bytes)
- `dirty_compactor_rules.py` (7870 bytes)
- `dirty_compactor_workflow.py` (3225 bytes)
- `dirtyCompactor.css` (3673 bytes)
- `dirtyCompactor.js` (37937 bytes)
- `dirtyCompactor.yml` (657 bytes)
- `dirtyCompactorAutomation.js` (1085 bytes)
- `dirtyCompactorRules.js` (19134 bytes)
- `LICENSE` (1069 bytes)
- `README.md` (13448 bytes)

### DirtyFileExtractor

Original package files (relative to the ZIP root):

- `extract_scenes.py` (30641 bytes)
- `extract_scenes_destinations.py` (3643 bytes)
- `extract_scenes_plan.py` (2388 bytes)
- `extractScenes.css` (1833 bytes)
- `extractScenes.js` (14547 bytes)
- `extractScenes.yml` (1362 bytes)
- `extractScenesPicker.js` (10066 bytes)
- `LICENSE` (1069 bytes)
- `README.md` (4911 bytes)

### DirtyMultiscreen

Original package files (relative to the ZIP root):

- `LICENSE` (1069 bytes)
- `multiscreen.css` (5068 bytes)
- `multiscreen.js` (50679 bytes)
- `multiscreen.yml` (1675 bytes)
- `multiscreenPlaylists.js` (1819 bytes)
- `multiscreenSettings.js` (2871 bytes)
- `README.md` (3016 bytes)

### DirtyPlugins

Original package files (relative to the ZIP root):

- `dirty_plugins.py` (3810 bytes)
- `dirty_plugins_client.py` (4354 bytes)
- `dirty_plugins_protocol.py` (3594 bytes)
- `dirty_plugins_storage.py` (16583 bytes)
- `dirtyPlugins.css` (47587 bytes)
- `dirtyPlugins.js` (34826 bytes)
- `dirtyPlugins.yml` (774 bytes)
- `dirtyPluginsDebug.js` (10322 bytes)
- `dirtyPluginsJobs.js` (2475 bytes)
- `dirtyPluginsMetadata.js` (1028 bytes)
- `dirtyPluginsNative.js` (5790 bytes)
- `dirtyPluginsReact.js` (20750 bytes)
- `dirtyPluginsSave.js` (2930 bytes)
- `dirtyPluginsSceneFilter.js` (4201 bytes)
- `dirtyPluginsTheme.js` (2990 bytes)
- `dirtyPluginsTransport.js` (7400 bytes)
- `dirtyPluginsValues.js` (1866 bytes)
- `LICENSE` (1069 bytes)
- `README.md` (10388 bytes)
- `STYLE.md` (10724 bytes)
- `vendor/HTM-LICENSE` (11341 bytes)
- `vendor/HTM-NOTICE` (177 bytes)
- `vendor/htm.umd.js` (1364 bytes)

### DirtyRank

Original package files (relative to the ZIP root):

- `dirty_rank.py` (41753 bytes)
- `dirty_rank_rating.py` (4360 bytes)
- `dirtyRank.css` (51371 bytes)
- `dirtyRank.js` (130497 bytes)
- `dirtyRank.yml` (5909 bytes)
- `dirtyRankBattleSession.js` (26730 bytes)
- `dirtyRankMatchmaking.js` (23553 bytes)
- `dirtyRankRating.js` (2135 bytes)
- `dirtyRankSettings.js` (23354 bytes)
- `dirtyRankSettingsPanel.js` (42620 bytes)
- `LICENSE` (1069 bytes)
- `README.md` (22916 bytes)

### DirtyStats

Original package files (relative to the ZIP root):

- `dirty_stats.py` (3274 bytes)
- `dirtyStats.css` (29638 bytes)
- `dirtyStats.js` (162334 bytes)
- `dirtyStats.yml` (678 bytes)
- `dirtyStatsAges.js` (7493 bytes)
- `dirtyStatsChartOptions.js` (16784 bytes)
- `dirtyStatsCharts.js` (2253 bytes)
- `dirtyStatsDashboard.js` (71566 bytes)
- `dirtyStatsData.js` (3487 bytes)
- `dirtyStatsGrowth.js` (7577 bytes)
- `dirtyStatsRegistry.js` (4090 bytes)
- `LICENSE` (1069 bytes)
- `README.md` (23498 bytes)
- `vendor/ECHARTS-LICENSE` (11990 bytes)
- `vendor/ECHARTS-NOTICE` (168 bytes)
- `vendor/echarts.min.js` (1034102 bytes)
- `vendor/world.js` (244998 bytes)

### DirtyTidy

Original package files (relative to the ZIP root):

- `dirty_tidy.py` (32190 bytes)
- `dirty_tidy_templates.py` (14454 bytes)
- `dirtyTidy.css` (5067 bytes)
- `dirtyTidy.js` (25679 bytes)
- `dirtyTidy.yml` (404 bytes)
- `dirtyTidyPreview.js` (5817 bytes)
- `dirtyTidySettings.js` (6350 bytes)
- `LICENSE` (1069 bytes)
- `README.md` (5353 bytes)
- `TODO.md` (808 bytes)
