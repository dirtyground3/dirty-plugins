# dirtyStats

Explore Stash statistics from the **pie chart icon** in the utility navigation.
The statistic selector currently offers **Performer origin**.

The world map counts each performer once by Stash's `country` field, combining
country codes and recognized country names. Hover for exact counts, drag to pan,
scroll to zoom, or enable count labels. The country table provides the same
values in an accessible form. **Reset map** restores the initial view.

Filters combine name/alias, gender, tag, favorite status, country, minimum Stash
rating (0–100), and minimum scene count. Unrated performers are excluded when a
minimum rating is set. Filters update immediately; **Refresh** reloads metadata
from Stash, and **Reset filters** clears the selection.

**Export PNG** saves the displayed map, including its current zoom and labels.
**Export CSV** saves the filtered country counts, missing-country count, and
unmapped values. Missing or unrecognized country values are reported separately,
never assigned to a guessed country. Natural Earth's 1:110m boundaries omit some
small territories; those values appear in the unmapped report. Country metadata
is interpreted as a single country, not split into guessed multiple origins.

Install dirtyStats and its **DirtyPlugins** dependency from the package source,
or copy both sibling directories to Stash's plugins directory, reload plugins,
and refresh the browser. No Python backend or external chart service is required.
The repository's package builder discovers `dirtyStats.yml` automatically.

Future statistics will use the same selector with their own filters and optional
settings: performer ages during scenes, scene file sizes over time, and scene
bitrates. Those views are not implemented in this first release.

## Bundled dependencies

- Apache ECharts **5.6.0**, Apache-2.0: https://echarts.apache.org/
  (`vendor/ECHARTS-LICENSE`, `vendor/ECHARTS-NOTICE`). Used for interactive maps
  and future charts; documentation: https://echarts.apache.org/en/api.html.
- Natural Earth **1:110m Admin 0 Countries**, public domain:
  https://www.naturalearthdata.com/about/terms-of-use/.
  `vendor/world.js` contains simplified properties from
  https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_admin_0_countries.geojson,
  excluding Antarctica. Boundary data reflects that dataset's conventions.

All plot assets are bundled: viewing the statistics sends no performer metadata
to a third-party service. Plugin code is MIT licensed; see `LICENSE`.

## Validation

Run `node --check plugins/DirtyStats/dirtyStats.js` and
`node tests/test_dirty_stats.js` from the repository root.
