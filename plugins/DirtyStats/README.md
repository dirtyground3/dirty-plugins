# DirtyStats

Explore Stash statistics from the **pie chart icon** in the utility navigation.
The statistic selector offers **Performer origin**, **Content growth**,
**Age at scene**, **Scene ratings**, **Performer ratings**, and
**Cast constellation**.

**Cast constellation** uses native scene filters and their saved defaults to
build a force-directed performer network. Node size represents the number of
matching scenes, while line thickness represents the number of scenes shared by
two performers. Node colors distinguish performer genders, with a compact
legend and a separate color for missing gender information. Hovering highlights a performer and their displayed
collaborators. Click a performer to show their matching scene cards below, or
click a connection to show the pair's shared scenes; clicking the same item
again clears the selection. The graph can be panned, zoomed, and rearranged by
dragging performers.

**Maximum performers** keeps large libraries readable by displaying the most
frequent 50, 100, 200, 500, or 1,000 performers while scene cards continue to
use the complete filtered scene set. The force layout adapts its spacing, node
size, label count, edge opacity, and initial zoom to the selected graph size.
**Minimum shared scenes** hides weaker connections.
These settings remain selected when scene filters change during the current
session. **Export PNG** saves the displayed constellation.

**Performer ratings** provides the same rating pie for distinct performers,
using native performer filters and their saved defaults. Unrated performers
have a separate slice, and the shared **Rating rounding** control adjusts how
many slices the pie is split into. Selecting a slice filters the native
performer cards below, with at most five per row; clicking again clears it.
PNG export is available inside the chart.

**Scene ratings** uses native scene filters and saved defaults to count distinct
scenes by their rating out of ten; unrated scenes are included separately.
**Rating rounding** controls how many slices the pie is split into: **Exact**
keeps every decimal rating separate, **0.5** (the default) rounds to half
points, and **1** rounds to whole ratings. Click a slice to filter the native
scene cards below; click it again or **Show all ratings** to clear the
selection. The plot includes **Export PNG**. Changing filters or rounding clears
the slice selection.

**Age at scene** is a histogram using native scene filters and their saved
defaults. The x-axis is the performer's completed age on the scene's `date`,
calculated from `birthdate`; the y-axis counts distinct performer IDs at each
age. Multiple scenes at the same age count a performer once, while scenes at
different ages can place them in multiple bars. Missing, partial, invalid, or
chronologically inconsistent dates are excluded and reported. Hover for counts,
zoom or use the range slider to explore ages, and **Export PNG** to save the plot.
Native performer cards appear below, with 24 per page and at most five per row.
Click an age bar to highlight it and show its distinct performers. **Show all
ages** restores everyone counted in the histogram. Scene filters determine
the matching scenes. **Performer filters** opens Stash's native performer filter
panel; these filters apply to both the histogram and the cards, together with
the scene filters. Changes apply immediately and remain selected when the panel
is closed. Changing either filter clears the age selection.

**Content growth** reuses Stash's native scene filters and their saved default.
The timeline sums current sizes of all files attached to matching scenes,
grouped by the selected date in UTC, and displays the cumulative total through
today. **Group by** combines additions by day, calendar month, or calendar year
in UTC and preserves the cumulative total. The grouping survives filter changes.
Period selection includes whole months or years when grouped.
**Show forecast** adds a dashed projection and estimated capacity date using
average daily additions over the past 365 days (or the selected period).
The forecast uses daily data regardless of grouping and assumes constant growth
of matching content. Other disk usage is excluded; a flat reference period or
unavailable capacity produces an explanation instead of a projected date.
Hover for dates and sizes; zoom or use the range slider to explore a
period. **Export PNG** saves the displayed timeline. Missing dates or sizes
are reported and excluded. Deleted scenes and historical file-size changes
cannot be reconstructed from current scene metadata.

The growth plot includes a dashed **Capacity** line: total filesystem capacity
of volumes containing configured sources enabled for video. Multiple folders
on one volume count once. This is total capacity, not free space, and includes
space occupied by other content. Capacity stays independent of scene filters.
The read-only Python backend uses only the standard library on the Stash host.
Inaccessible sources are reported; a partial line is labeled **Known capacity**.
Network shares without a volume identity are counted by resolved share root;
distinct shares on the same physical drive cannot always be deduplicated.
**Refresh** checks capacity again. PNG exports include the capacity line.
**Show capacity** inside the plot controls toggles the line and adjusts the
vertical scale. It is enabled by default and stays selected when filters change
during the current session. PNG exports follow the checkbox setting.

Stash's native scene cards appear below the growth timeline, with 24 cards per
page, following the scene filters' sort order and direction. Cards include all
matching scenes, including those missing dates or sizes excluded from the plot.

Click two dates inside the growth plot to select an inclusive period in either
order. The plot highlights it and reports the size added during that period;
scene cards show matching scenes for the selected date basis. In file modification
mode, a scene appears if at least one valid file falls in the period. **Clear
period** restores all matching scenes. Changing filters or date basis clears
the selection. Zoom controls remain available; PNG export includes the highlight.

**Date basis** offers **Created at** (the default, scene `created_at`),
**File modified at** (each file's `mod_time`), or **Scene date** (scene `date`,
the recorded date). Scene dates apply to all attached files; file modification
dates apply separately to each file. Changing the date basis keeps scene filters.

Switching statistics opens a separate URL with the corresponding native
default filters, so performer criteria are never carried into scene filters.
Both URLs support explicit filters and bookmarks.

Stash's native performer cards appear below the map, with 24 cards per page.
Cards follow the native filters' selected sort order and direction, including
when a country is selected. Changing sorting preserves the selected country.
Click a country to show only its performers within the current performer
filters. **Show all countries** clears the map selection. Changing the native
performer filters clears the country selection and updates both map and cards.

The Eckert IV equal-area world map counts each performer once by Stash's `country` field, combining
country codes and recognized country names. Hover for exact counts, drag to pan,
scroll to zoom, or enable **Show numbers** inside the map. The map opens with a
closer view and adapts its height to the available width. Native filters appear
first, without a separate page heading.

The page reuses Stash's **native performer filter block**, including search,
the filter editor, every supported performer criterion, and saved filters.
Use the same controls and operators as on the Performers page. Filters are
converted by Stash and applied by the server; DirtyStats does not reimplement
their behavior. The map and exports include **all matching performers**,
regardless of the native list page size. **Refresh** reloads map metadata.
Filter state is stored in the DirtyStats URL and can be bookmarked.
Opening DirtyStats without query parameters applies Stash's saved default
Performers filter. Explicit URL filters override that default, as on the
Performers page.

**Export PNG**, inside the map, saves the displayed map, including its current zoom and labels.
Missing or unrecognized country values are reported separately,
never assigned to a guessed country. Natural Earth's 1:110m boundaries omit some
small territories; those values appear in the unmapped report. Country metadata
is interpreted as a single country, not split into guessed multiple origins.

Install DirtyStats and its **DirtyPlugins** dependency from the package source,
or copy both sibling directories to Stash's plugins directory, reload plugins,
and refresh the browser. Python is required for source capacity; no extra Python
packages or external chart service are required.
The repository's package builder discovers `dirtyStats.yml` automatically.

Future statistics will use the same selector with their own filters and optional
settings: scene bitrates. That view is not implemented yet.

## Bundled dependencies

- Apache ECharts **5.6.0**, Apache-2.0: https://echarts.apache.org/
  (`vendor/ECHARTS-LICENSE`, `vendor/ECHARTS-NOTICE`). Used for interactive maps,
  charts, and the force-directed constellation; documentation:
  https://echarts.apache.org/en/api.html.
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
