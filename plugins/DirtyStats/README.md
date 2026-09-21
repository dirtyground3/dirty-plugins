# DirtyStats

Explore Stash statistics from the **pie chart icon** in the utility navigation.
The icon opens a customizable **Dashboard** at
`/plugins/dirty-stats/dashboard`. Choose **Edit dashboard** to change its
theme, add or remove any available statistic,
reorder widgets by dragging their edit-mode handle or using the arrow controls,
edit statistic-specific options, choose the same native scene
or performer filters available in the full view, and select a **Small**,
**Medium**, or **Large** presentation. The responsive twelve-column layout
collapses to wider cards on tablets and one column on phones. Dashboard layout
and widget options save automatically through the shared DirtyPlugins settings
store and are restored on the next visit.

DirtyStats can wear five visual themes. **Midnight** preserves the original
look, while **Candy Pop**, **Tropical Punch**, **Retro Arcade**, and the light
**Paper Picnic** theme give pages, dashboard cards, controls, calendars, Tag
DNA, and charts their own colors and character. Choose a theme while editing
the dashboard or from the **Visual theme** control on the DirtyStats tab in the
shared DirtyPlugins settings page; the choice saves automatically and applies
the next time DirtyStats is opened.

Filter selection opens in a dedicated responsive dialog so native filter
dropdowns have room to expand. The dialog becomes full-screen on narrow
displays and can be closed with Escape, its close button, or the backdrop.

Dashboard widgets summarize the selected filter, or the entire library when no
filter is active. Small widgets emphasize key
figures and compact visualizations, medium widgets add chart context, and large
widgets expose the richest dashboard view and relevant controls. Use the open
icon on a widget for detailed selections, scene or
performer cards, and PNG export. A statistic can be added more than once, so
each copy can represent a different filter or presentation.

Every widget keeps a compact title row. Small and medium cards use reduced
type, spacing, and icon sizing so the title consumes as little chart space as
possible.
The dashboard shares compatible performer and scene requests when their filters
match, so widgets do not independently download the same records; a failure
remains isolated to the affected data group and filter.

The statistic selector offers **Performer origin**, **Content growth**,
**Age at scene**, **Scene ratings**, **Performer ratings**,
**Rating vs scenes**, **Count vs rating**, **Quality efficiency**, **Studio value map**,
**Tag DNA**, **Cast constellation**, and **Performer birthdays**.
Display choices such as map numbers, rating rounding, growth options, and the
constellation, scatter, and studio limits are saved to the DirtyStats plugin
settings and restored the next time the page is opened.

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
frequent 50, 100, 200, 500, or 1,000 performers, while **All** removes the
limit; scene cards continue to use the complete filtered scene set. The force layout adapts its spacing, node
size, label count, edge opacity, and initial zoom to the selected graph size.
**Minimum shared scenes** hides weaker connections.
These settings remain selected when scene filters change and are restored on the
next visit. **Export PNG** saves the displayed constellation.

**Performer ratings** provides the same rating pie for distinct performers,
using native performer filters and their saved defaults. Unrated performers
have a separate slice, and **Rating rounding** adjusts how
many slices the pie is split into; scene and performer ratings keep their own
rounding choice. Selecting a slice filters the native
performer cards below, with at most five per row; clicking again clears it.
PNG export is available inside the chart.

**Rating vs scenes** is a scatter plot using native performer filters and their
saved defaults. Each dot is a distinct performer: the x-axis is the performer's
rating out of ten and the y-axis is their scene count, so the upper-left corner
holds promising performers with a high rating and few scenes. **Minimum rating**
and **Maximum scenes** outline that region with dashed guide lines and highlight
the dots that meet both limits; they start at **9+** and **10** scenes and either
can be set to **Any**. Click a dot to show
that performer below, or click it again to clear the selection. Clicking empty
space inside the plot also moves the nearer guide: clicks near the bottom
(rating axis) set the minimum rating, and clicks near the left (scenes axis) set
the maximum scenes, snapped to the options offered by the controls. Unrated
performers and performers without a scene count are omitted and reported.
PNG export is available inside the chart.

**Count vs rating** is a scatter plot using native scene filters and their saved
defaults. Each dot is a distinct scene: the x-axis is the scene's rating out of
ten and the y-axis is the scene's view count or O count, chosen by the **Count**
control and remembered for next time. Scenes without a rating are omitted and
reported. Click a dot to show that scene below, or click it again to clear the
selection. PNG export is available inside the chart.

**Quality efficiency** is a bubble plot using native scene filters. Each bubble
compares a scene's rating with its storage efficiency in playable minutes per
GiB, while bubble area represents its actual total file size. All scenes use
the same visual treatment. Scenes need a rating, file size, and duration to
participate; omissions are reported. Click a bubble to show that scene below,
and use **Export PNG** to save the chart.

**Studio value map** is a scatter plot using native scene filters and their saved
defaults. Each bubble is a studio: the x-axis is its number of matching scenes,
the y-axis is the average rating out of ten of its rated scenes, and bubble size
represents the total size of its matching files. Each bubble shows the studio's
image, composited into a circular marker; studios without an image keep a plain
marker. Highly rated studios with few
scenes appear near the upper left. **Minimum scenes** hides smaller studios;
scenes without a studio, studios with no rated scene, and files with an
unavailable size are omitted and reported. Click a bubble to show that studio's
scenes below, or click it again to clear the selection. PNG export is available
inside the chart.

**Tag DNA** is an interactive treemap using native scene filters and their saved
defaults. Rectangle area represents the number of distinct matching scenes carrying
the tag. Color can represent either the tag's average scene rating or average views
per scene, making common, highly rated, and frequently revisited themes visible at
a glance. Tags without rated scenes remain gray in rating mode. **Maximum tags**
keeps large libraries readable by showing the 25, 50, 100, or 200 most common tags,
or **All** removes the limit;
the summary continues to report the complete tag and untagged-scene totals. Click a
rectangle to show that tag's scene cards below, or click it again to clear the
selection. Both display choices are remembered, and PNG export is available inside
the chart.

**Scene ratings** uses native scene filters and saved defaults to count distinct
scenes by their rating out of ten; unrated scenes are included separately.
**Rating rounding** controls how many slices the pie is split into: **Exact**
keeps every decimal rating separate, **0.5** (the default) rounds to half
points, and **1** rounds to whole ratings. Scene ratings remember their own
rounding choice, separate from performer ratings. Click a slice to filter the native
scene cards below; click it again or **Show all ratings** to clear the
selection. The plot includes **Export PNG**. Changing filters or rounding clears
the slice selection.

**Age at scene** is a histogram using native scene filters and their saved
defaults. The x-axis is the performer's completed age on the scene's `date`,
calculated from `birthdate`; the y-axis counts distinct performer IDs at each
age. Multiple scenes at the same age count a performer once, while scenes at
different ages can place them in multiple bars. Missing, partial, invalid, or
chronologically inconsistent dates are excluded and reported. Hover for counts,
zoom with the mouse wheel to explore ages, and **Export PNG** to save the plot.
Native performer cards appear below, with 24 per page and at most five per row.
Click an age bar to highlight it and show its distinct performers. **Show all
ages** restores everyone counted in the histogram. Scene filters determine
the matching scenes. **Performer filters** opens Stash's native performer filter
panel; these filters apply to both the histogram and the cards, together with
the scene filters. Changes apply immediately and remain selected when the panel
is closed. Changing either filter clears the age selection.

**Performer birthdays** shows a year of matching performers' birthdays as a
calendar, using native performer filters and their saved defaults. Each month
is a small grid; days with a birthday are highlighted and show how many
performers share the date, the current month and day are marked, and the
nearest birthdays are listed first above the calendar. Click a highlighted day
to show those performers below, or click it again to clear the selection.
When matching performers have a birthday today, that day and its performers are
selected automatically on first load. Deceased performers use "would have
turned" wording and an **In memoriam** double-border treatment in the upcoming
list and performer cards.
Birthdays recur every year, so only the month and day are used; February 29
falls back to February 28 in non-leap years. Performers with missing, partial,
or invalid birthdates are excluded and reported. The performer filter block
appears at the top of the page and applies to both the calendar and the cards.

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
vertical scale. It is enabled by default and stays selected when filters change;
the choice is restored on the next visit. PNG exports follow the checkbox setting.

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
Performers without a country are omitted from the map and reported as **missing
country**; values are never assigned to a guessed country. Country metadata
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

Run `node --check plugins/DirtyStats/dirtyStats.js`,
`node --check plugins/DirtyStats/dirtyStatsDashboard.js`,
`node tests/test_dirty_stats.js`, and
`node tests/test_dirty_stats_dashboard.js` from the repository root.
