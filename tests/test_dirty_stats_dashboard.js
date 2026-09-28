const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = {
  console,
  window: {
    PluginApi: { React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), Fragment: "fragment" }, libraries: { ReactRouterDOM: { Link: "Link" } } },
    DirtyPlugins: { react: {}, captureUrl: path => path },
    __dirtyStatsPlugin: { route: "/plugins/dirty-stats", algorithms: {} }
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("plugins/DirtyStats/dirtyStatsDashboard.js", "utf8"), context);

const dashboard = context.window.__dirtyStatsDashboard;
const helpers = dashboard.algorithms;
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.equal(Object.keys(dashboard.registry).length, 14, "every DirtyStats statistic and performer cards must be available as a widget");
assert.equal(dashboard.defaults.length, 5, "a curated dashboard should be created on first use");

const defaults = plain(helpers.normalizeWidgets(null));
assert.equal(defaults.length, 5);
assert.equal(helpers.dashboardNeedsInitialSave(2, defaults), false, "opening an existing dashboard must not save again");
assert.equal(helpers.dashboardNeedsInitialSave(1, defaults), true, "older dashboard layouts are migrated and saved");
assert.equal(helpers.dashboardNeedsInitialSave(2, null), true, "a new dashboard is saved once");
assert.deepEqual(defaults.map((widget) => widget.statistic), ["ratings", "performerRatings", "growth", "origin", "birthdays"]);
assert.ok(defaults.every((widget) => widget.filter.count === 0), "migrated default widgets use the full library");

const normalized = plain(helpers.normalizeWidgets([
  { id: "one", statistic: "growth", size: "huge", options: { grouping: "week", dateBasis: "mod_time", showCapacity: "true" } },
  { id: "two", statistic: "growth", size: "small" },
  { id: "three", statistic: "unknown", size: "large" },
  { id: "four", statistic: "ratings", size: "small", options: { rounding: "1" }, filter: { find: { q: "favorite", page: 9, per_page: 12 }, object: { favorite: true }, count: 2 } },
  { id: "five", statistic: "tags", size: "medium", options: { metric: "play_count", maxTags: "0" } },
  { id: "six", statistic: "constellation", size: "large", options: { maxPerformers: "0", minShared: 2 } },
  { id: "seven", statistic: "performerCards", title: "  Favorite cast  ", size: "medium", options: { cardCount: "12" }, filter: { find: { sort: "rating", direction: "DESC" }, object: { favorite: true }, count: 1 } }
]));
assert.equal(normalized.length, 6, "duplicate statistics are allowed while unknown types are rejected");
assert.equal(normalized[0].size, "large", "invalid sizes must use the statistic default");
assert.equal(normalized[0].options.grouping, "month", "invalid options must use their defaults");
assert.equal(normalized[0].options.dateBasis, "mod_time");
assert.equal(normalized[0].options.showCapacity, true);
assert.equal(normalized[0].options.showHeader, true, "existing growth widgets keep their header by default");
assert.equal(normalized[1].statistic, "growth", "a second widget may use the same statistic");
assert.equal(normalized[2].options.rounding, 1, "stringified persisted values must coerce to an allowed option");
assert.deepEqual(normalized[2].filter, { find: { q: "favorite" }, object: { favorite: true }, count: 2 }, "widget filters must persist without pagination state");
assert.deepEqual(normalized[3].options, { metric: "play_count", maxTags: 0, showHeader: true }, "Tag DNA widget options must normalize and persist its unlimited choice");
assert.deepEqual(normalized[4].options, { maxPerformers: 0, minShared: 2, showHeader: true }, "Cast constellation must normalize and persist its all-performers choice");
assert.deepEqual(normalized[5].options, { cardCount: 12, showHeader: true }, "Performer card count must persist");
assert.equal(normalized[5].title, "Favorite cast", "custom titles must persist per widget");
assert.equal(normalized[0].title, "", "existing widgets keep their default titles");
assert.equal(helpers.normalizeWidgets([{ statistic: "ratings", title: "   " }])[0].title, "", "a blank custom title restores the default label");
assert.equal(helpers.normalizeWidgets([{ statistic: "ratings", title: 42 }])[0].title, "", "invalid custom titles are ignored");
assert.equal(helpers.widgetTitle(normalized[5]), "Favorite cast", "the header uses the custom title");
assert.equal(helpers.widgetTitle(normalized[0]), "Content growth", "the header falls back to the default label");
assert.equal(helpers.widgetHeightUnits({ statistic: "ratings", size: "small", options: {} }), 1, "small widgets use one height step");
assert.equal(helpers.widgetHeightUnits({ statistic: "ratings", size: "medium", options: {} }), 1, "compact medium charts use one height step");
assert.equal(helpers.widgetHeightUnits({ statistic: "birthdays", size: "medium", options: {} }), 2, "medium calendars use two height steps");
for (const cardCount of [1, 4, 8, 24, 100]) {
  assert.equal(helpers.widgetHeightUnits({ statistic: "performerCards", size: "medium", options: { cardCount } }), 1, "Medium performer cards occupy one row regardless of card count");
}
assert.equal(helpers.widgetHeightUnits({ statistic: "ratings", size: "large", options: {} }), 2, "large charts use two height steps");
assert.equal(helpers.widgetHeightUnits({ statistic: "performerCards", size: "large", options: { cardCount: 24 } }), 3, "large card collections use three height steps");
assert.equal(helpers.normalizeOptions(dashboard.registry.performerCards, { cardCount: 100 }).cardCount, 100, "any whole card count persists");
assert.equal(helpers.normalizeOptions(dashboard.registry.performerCards, { cardCount: "17" }).cardCount, 17, "string card counts coerce to numbers");
assert.equal(helpers.normalizeOptions(dashboard.registry.performerCards, { cardCount: 0 }).cardCount, 8, "non-positive card counts use the default");
assert.equal(helpers.normalizeOptions(dashboard.registry.performerCards, { cardCount: 8.5 }).cardCount, 8, "fractional card counts use the default");
assert.equal(helpers.normalizeOptions(dashboard.registry.performerCards, { cardCount: 1000 }).cardCount, 8, "counts beyond the maximum use the default");
assert.equal(helpers.nextWidgetId("ratings", [{id: "dashboard-ratings"}, {id: "dashboard-ratings-2"}]), "dashboard-ratings-3");

assert.deepEqual(plain(helpers.normalizeWidgets([], false)), [], "an intentionally empty dashboard must remain empty");
assert.deepEqual(plain(helpers.requiredGroups([
  { statistic: "ratings" },
  { statistic: "countRating" },
  { statistic: "repeatOffenders" },
  { statistic: "qualityEfficiency" },
  { statistic: "tags" },
  { statistic: "origin" },
  { statistic: "birthdays" }
])), ["performers", "scenes", "tags"], "compatible widgets share dashboard datasets while tag payloads load only for Tag DNA");
const resources = plain(helpers.requiredResources([
  { statistic: "ratings", filter: { find: {}, object: {}, count: 0 } },
  { statistic: "countRating", filter: { find: {}, object: {}, count: 0 } },
  { statistic: "studios", filter: { find: { q: "recent" }, object: {}, count: 1 } }
]));
assert.equal(resources.length, 2, "widgets only share requests when both group and filters match");
assert.notEqual(resources[0].key, resources[1].key);
const duplicateResources = plain(helpers.requiredResources([
  { statistic: "ratings", filter: { find: {}, object: {}, count: 0 } },
  { statistic: "ratings", filter: { find: { q: "favorite" }, object: {}, count: 1 } }
]));
assert.equal(duplicateResources.length, 2, "duplicate statistics with different filters use separate resources");
const cardResources = plain(helpers.requiredResources([
  normalized[5],
  { ...normalized[5], id: "other", options: { cardCount: 4 } },
  { ...normalized[5], id: "duplicate" }
]));
assert.equal(cardResources.length, 2, "performer card requests are shared only when filters and card counts match");
assert.deepEqual(cardResources.map((resource) => resource.limit).sort((a, b) => a - b), [4, 12]);
assert.equal(helpers.resourceKey(normalized[5]), helpers.resourceKey({ ...normalized[5], title: "Another title" }), "renaming a widget does not refetch its data");

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !Object.hasOwn(tree, "type")) return [];
  return [tree, ...tree.children.flatMap(nodes)];
}
const widgetProps = { widget: normalized[2], index: 0, resources: {}, onDragStart() {}, onDragKeyDown() {}, onRemove() {}, onTitle() {}, onSize() {}, onFilter() {}, onOptions() {} };
const editNodes = nodes(dashboard.Widget({ ...widgetProps, editing: true }));
const viewNodes = nodes(dashboard.Widget({ ...widgetProps, editing: false }));
assert.ok(editNodes.some((node) => node.type === "input" && node.props.className === "dirty-stats-dashboard-title-input"), "the title is edited in the header");
assert.ok(editNodes[0].props.className.includes("dirty-stats-dashboard-height-1"), "the widget receives its quantized height class");
assert.ok(editNodes.some((node) => node.type.name === "SelectControl" && node.props.label === "Size"), "size uses a select control");
assert.ok(editNodes.some((node) => node.type === "button" && node.props.className.includes("dirty-stats-dashboard-drag-handle")), "drag handle remains available");
assert.ok(editNodes.some((node) => node.type === "button" && node.props.className.includes("dirty-stats-dashboard-remove") && node.props["aria-label"] === "Remove Scene ratings widget"), "remove is an accessible icon button");
assert.equal(editNodes.filter((node) => node.type === "button").length, 2, "the header only contains reorder and remove buttons");
const filterControl = editNodes.find(node => node.type && node.type.name === "FilterControl");
assert.ok(filterControl, "filters use a labeled control in the same grid as Size");
context.window.PluginApi.React.useRef = value => ({ current: value });
let filterOpened = false;
const filterTree = filterControl.type({ ...filterControl.props, onChange() { filterOpened = true; } });
assert.equal(filterTree.props.label, "2 active filters", "the filter summary labels its button");
const filterButton = nodes(filterTree).find(node => node.type === "button");
assert.equal(filterButton.props["aria-label"], "Change filters: 2 active filters", "the filter action retains an accessible name and summary");
assert.ok(!filterButton.props.className.includes("dirty-ui-control-compact"), "the filter button shares the select height");
filterButton.props.onClick();
assert.ok(filterOpened, "the aligned filter control still opens the filter dialog");
assert.ok(!editNodes.some((node) => node.type === "Link" || node.type === "input" && node.props.type === "radio"), "edit mode hides the full view link and size radios");
assert.ok(viewNodes.some((node) => node.type === "Link"), "the full view link returns outside edit mode");
assert.ok(!viewNodes.some((node) => node.type === "input" && node.props.className === "dirty-stats-dashboard-title-input"), "the title is plain text outside edit mode");
let chartTheme = { text: "#f0f0f0", primary: "#54d5ca" };
context.window.__dirtyStatsPlugin.algorithms.themeColor = name => chartTheme[name];
context.window.__dirtyStatsPlugin.algorithms.themePalette = () => [chartTheme.primary, "#f3c779"];
context.window.__dirtyStatsPlugin.algorithms.aggregateRatings = () => ({ rows: [{ name: "8", value: 1 }], total: 1 });
const chartWidget = helpers.normalizeWidgets([{ statistic: "ratings", size: "large" }])[0];
const chartResources = { [helpers.resourceKey(chartWidget)]: { loading: false, rows: [{}] } };
function chartOption() {
  const tree = dashboard.Widget({ ...widgetProps, widget: chartWidget, resources: chartResources, editing: false });
  return nodes(tree).find((node) => node.type && node.type.name === "Chart").props.option;
}
assert.equal(chartOption().legend.textStyle.color, "#f0f0f0", "dashboard chart text reads its current theme role");
assert.equal(chartOption().color[0], "#54d5ca", "categorical colours come from the Stats palette");
chartTheme = { text: "#3b3440", primary: "#0b7274" };
assert.equal(chartOption().legend.textStyle.color, "#3b3440", "chart chrome refreshes with the effective theme");
assert.equal(chartOption().color[0], "#0b7274", "chart data colours refresh with the selected palette");
const cardOptions = nodes(dashboard.widgetOptions({ widget: normalized[5], onChange() {} }));
assert.ok(cardOptions.some((node) => node.type.name === "NumberControl" && node.props.label === "Cards to display"), "performer cards expose a free numeric count instead of a fixed list");
for (const size of ["small", "medium", "large"]) {
  const widget = helpers.normalizeWidgets([{ statistic: "origin", size, options: { showNumbers: true, showHeader: false } }])[0];
  const controls = nodes(dashboard.widgetOptions({ widget, onChange() {} }));
  assert.equal(widget.options.showHeader, false, "the origin header preference persists");
  assert.equal(widget.options.showNumbers, true, "changing size preserves the map number preference");
  assert.equal(controls.some(node => node.props.label === "Show map numbers"), size === "large", "map number controls only appear in Large");
  assert.equal(controls.some(node => node.props.label === "Show header"), true, "every size offers the shared header control");
}
assert.equal(helpers.normalizeWidgets([{ statistic: "origin", options: { showNumbers: true } }])[0].options.showHeader, true, "existing origin widgets keep their header by default");

// Exercise the origin renderer with the real map data and shared map adapter.
const statisticPatches = {};
const originContext = { window: { PluginApi: { React: { createElement: context.window.PluginApi.React.createElement }, libraries: {}, register: { route() {} }, patch: { before() {}, instead(name, callback) { statisticPatches[name] = callback; } } }, DirtyPlugins: { graphql() {} } }, console, Intl, URLSearchParams };
vm.createContext(originContext);
vm.runInContext(fs.readFileSync("plugins/DirtyStats/vendor/world.js", "utf8"), originContext);
vm.runInContext(fs.readFileSync("plugins/DirtyStats/dirtyStats.js", "utf8"), originContext);
for (const name of ["countryIndex", "aggregate", "originMapOption", "mapLayout", "aggregateGrowth", "forecastGrowth", "formatBytes"]) context.window.__dirtyStatsPlugin.algorithms[name] = originContext.window.__dirtyStatsPlugin.algorithms[name];
context.window.__dirtyStatsWorld = originContext.window.__dirtyStatsWorld;
context.window.echarts = { registerMap() {} };
// Dashboard captures the map at load time.
delete context.window.__dirtyStatsDashboard;
vm.runInContext(fs.readFileSync("plugins/DirtyStats/dirtyStatsDashboard.js", "utf8"), context);
const originDashboard = context.window.__dirtyStatsDashboard;
let originChartComponent, originChartProps;
for (const size of ["small", "medium", "large"]) {
  for (const showHeader of [false, true]) {
    const widget = helpers.normalizeWidgets([{ statistic: "origin", size, options: { showHeader, showNumbers: true } }])[0];
    const resources = { [helpers.resourceKey(widget)]: { loading: false, rows: [{ id: "1", country: "US" }, { id: "2", country: "CA" }] } };
    const rendered = nodes(originDashboard.Widget({ ...widgetProps, widget, resources, editing: false }));
    const chart = rendered.find(node => node.type && node.type.name === "Chart");
    originChartComponent = chart.type;
    originChartProps = chart.props;
    assert.ok(chart.props.map, "every size registers and renders the world map");
    assert.equal(chart.props.option.series[0].type, "map", "Small uses a map rather than country bars");
    assert.equal(chart.props.option.series[0].label.show, size === "large", "country counts only appear in Large");
    assert.equal(rendered.some(node => node.props.className === "dirty-stats-dashboard-metrics"), size !== "small" && showHeader, "hiding the header removes its metrics");
  }
}
const resizeOptions = [];
let chartEffect, resizeCallback, observedNode, disconnected = false, disposed = false;
context.window.__dirtyStatsPlugin.algorithms.initStatsChart = () => ({ setOption: option => resizeOptions.push(option), resize() {}, isDisposed: () => disposed, dispose() { disposed = true; } });
context.ResizeObserver = function (callback) { resizeCallback = callback; this.observe = node => { observedNode = node; }; this.disconnect = () => { disconnected = true; }; };
context.window.addEventListener = () => {};
context.window.removeEventListener = () => {};
context.window.PluginApi.React.useState = value => [value, () => {}];
context.window.PluginApi.React.useRef = value => ({ current: value });
context.window.PluginApi.React.useEffect = effect => { chartEffect = effect; };
const chartNodes = nodes(originChartComponent(originChartProps));
const originNode = chartNodes.find(node => node.props.className === "dirty-stats-dashboard-chart");
originNode.props.ref.current = { clientWidth: 1000, clientHeight: 250 };
const cleanupChart = chartEffect();
assert.equal(resizeOptions[0].series[0].layoutSize, 440, "the initial Large map fits around its legend");
assert.equal(observedNode, originNode.props.ref.current);
observedNode.clientHeight = 500;
resizeCallback();
assert.equal(resizeOptions.at(-1).series[0].layoutSize, 940, "the map expands when its chart container grows");
cleanupChart();
assert.ok(disconnected && disposed, "map resize observers and charts are cleaned up on unmount");

for (const size of ["small", "medium", "large"]) {
  let previousOption;
  for (const showHeader of [false, true]) {
    const widget = helpers.normalizeWidgets([{ statistic: "growth", size, options: { showHeader, showCapacity: true, showForecast: true } }])[0];
    const resources = { [helpers.resourceKey(widget)]: { loading: false, rows: [{ id: "1", created_at: "2026-09-01", files: [{ id: "f1", size: 100 }] }], capacity: { total: 1000 } } };
    const rendered = nodes(dashboard.Widget({ ...widgetProps, widget, resources, editing: false }));
    const chart = rendered.find(node => node.type && node.type.name === "Chart");
    assert.equal(widget.options.showHeader, showHeader, "the growth header choice persists at every size");
    assert.equal(rendered.some(node => node.props.className === "dirty-stats-dashboard-metrics"), showHeader, "the growth header is optional at every size");
    assert.ok(nodes(dashboard.widgetOptions({ widget, onChange() {} })).some(node => node.props.label === "Show header"), "every growth size offers the header control");
    if (previousOption) assert.deepEqual(plain(chart.props.option), previousOption, "hiding the summary leaves chart data, capacity, and forecast unchanged");
    previousOption = plain(chart.props.option);
  }
}

// Verify the shared setting against every widget renderer and size.
Object.assign(context.window.__dirtyStatsPlugin.algorithms, originContext.window.__dirtyStatsPlugin.algorithms);
const headerScenes = [{ id: "1", date: "2026-09-01", created_at: "2026-09-01", rating100: 80, play_count: 3, o_counter: 2, files: [{ id: "f1", size: 1000, duration: 120 }], studio: { id: "s1", name: "Studio" }, tags: [{ id: "t1", name: "Tag" }], performers: [{ id: "p1", name: "Performer", birthdate: "2000-01-01", gender: "FEMALE" }, { id: "p2", name: "Other", birthdate: "2001-01-01", gender: "FEMALE" }] }];
const headerPerformers = [{ id: "p1", name: "Performer", birthdate: "2000-01-01", country: "US", rating100: 90, scene_count: 2 }];
for (const statistic of Object.keys(dashboard.registry)) {
  assert.equal(helpers.normalizeWidgets([{ statistic }])[0].options.showHeader, true, "existing " + statistic + " widgets keep their summary");
  assert.equal(helpers.normalizeWidgets([{ statistic, options: { showHeader: "false" } }])[0].options.showHeader, false, "stringified header choices persist");
  assert.equal(helpers.normalizeWidgets([{ statistic, options: { showHeader: "invalid" } }])[0].options.showHeader, true, "invalid choices use the default");
  for (const size of ["small", "medium", "large"]) {
    let previousContent;
    for (const showHeader of [false, true]) {
      const widget = helpers.normalizeWidgets([{ statistic, size, options: { showHeader } }])[0];
      let updated;
      const controls = nodes(dashboard.widgetOptions({ widget, onChange(value) { updated = value; } }));
      const headerControls = controls.filter(node => node.props.label === "Show header");
      assert.equal(headerControls.length, 1, statistic + " has exactly one shared header control");
      headerControls[0].props.onChange(!showHeader);
      assert.deepEqual(plain(updated), { ...plain(widget.options), showHeader: !showHeader }, "toggling preserves statistic options");
      assert.ok(!nodes(dashboard.widgetOptions({ widget, kind: "fields", onChange() {} })).some(node => node.props.label === "Show header"), "the toggle is not duplicated in the fields row");
      if (statistic === "performerCards") continue; // Native cards are exercised below.
      const rows = dashboard.registry[statistic].entity === "performers" ? headerPerformers : headerScenes;
      const resources = { [helpers.resourceKey(widget)]: { loading: false, rows, capacity: { total: 10000 } } };
      const rendered = nodes(originDashboard.Widget({ ...widgetProps, widget, resources, editing: false }));
      assert.equal(rendered.some(node => node.props.className === "dirty-stats-dashboard-metrics"), showHeader && !(statistic === "origin" && size === "small"), statistic + " summary follows the preference");
      assert.ok(rendered.some(node => node.type === "header"), "widget title and actions stay available");
      const content = rendered.filter(node => node.type && node.type.name === "Chart" || node.props.className === "dirty-stats-dashboard-upcoming" || node.props.className === "dirty-stats-dashboard-calendars").map(node => ({ props: node.props, children: node.children }));
      if (previousContent) assert.deepEqual(plain(content), previousContent, "hiding " + statistic + " summary preserves chart and calendar content");
      previousContent = plain(content);
    }
  }
}

const ageMetricOptions = { showPerformerCount: "performers", showModeAge: "mode age", showMedianAge: "median age", showAverageAge: "average age" };
for (const size of ["small", "medium", "large"]) {
  for (let mask = 0; mask < 16; mask++) {
    const options = Object.fromEntries(Object.keys(ageMetricOptions).map((name, index) => [name, Boolean(mask & (1 << index))]));
    const widget = helpers.normalizeWidgets([{ statistic: "ages", size, options }])[0];
    const resources = { [helpers.resourceKey(widget)]: { loading: false, rows: headerScenes } };
    const render = () => nodes(originDashboard.Widget({ ...widgetProps, widget, resources, editing: false }));
    const rendered = render();
    for (const [name, label] of Object.entries(ageMetricOptions)) {
      assert.equal(widget.options[name], options[name], "each metric preference persists");
      assert.equal(rendered.some(node => node.props.className === "dirty-stats-dashboard-metric" && node.props.label === label), options[name], label + " follows its toggle at every size");
    }
    assert.equal(rendered.some(node => node.props.className === "dirty-stats-dashboard-metrics"), mask !== 0 || size === "large", "empty summaries are omitted");
    const chart = rendered.find(node => node.type && node.type.name === "Chart");
    widget.options.showHeader = false;
    const hidden = render();
    assert.ok(!hidden.some(node => node.props.className === "dirty-stats-dashboard-metric"), "Show header overrides all individual metric toggles");
    assert.deepEqual(plain(hidden.find(node => node.type && node.type.name === "Chart").props.option), plain(chart.props.option), "metric choices preserve the histogram");
  }
}
const allAgeOptions = Object.fromEntries(Object.keys(ageMetricOptions).map(name => [name, true]));
const ageWidget = helpers.normalizeWidgets([{ statistic: "ages", options: allAgeOptions }])[0];
const ageResource = { [helpers.resourceKey(ageWidget)]: { loading: false, rows: headerScenes } };
const ageMetrics = nodes(originDashboard.Widget({ ...widgetProps, widget: ageWidget, resources: ageResource, editing: false }));
assert.equal(ageMetrics.find(node => node.props.label === "median age").props.value, 25.5);
assert.equal(ageMetrics.find(node => node.props.label === "average age").props.value, 25.5);
ageResource[helpers.resourceKey(ageWidget)].rows = [];
const emptyAgeMetrics = nodes(originDashboard.Widget({ ...widgetProps, widget: ageWidget, resources: ageResource, editing: false }));
for (const label of ["mode age", "median age", "average age"]) assert.equal(emptyAgeMetrics.find(node => node.props.label === label).props.value, "—", "missing ages display a dash");
for (const name of Object.keys(ageMetricOptions)) {
  let changed;
  const control = nodes(dashboard.widgetOptions({ widget: ageWidget, onChange(value) { changed = value; } })).find(node => node.props.value === true && node.props.label === "Show " + (name === "showPerformerCount" ? "performer count" : ageMetricOptions[name]));
  assert.ok(control, "each metric has a control");
  control.props.onChange(false);
  assert.deepEqual(plain(changed), { ...plain(ageWidget.options), [name]: false }, "individual toggles preserve other widget settings");
}

// Render the full view through its native SceneList integration.
originContext.window.location = { pathname: "/plugins/dirty-stats/scenes" };
const sceneFilter = { makeFindFilter: () => ({}), makeFilter: () => ({}) };
const growthPage = statisticPatches.SceneList({ filter: sceneFilter }, () => null).type;
let growthHookIndex = 0;
const growthReact = originContext.window.PluginApi.React;
growthReact.useRef = value => ({ current: value });
growthReact.useEffect = () => {};
growthReact.useMemo = callback => callback();
growthReact.useState = value => [growthHookIndex++ === 2 ? false : value, () => {}];
const growthView = growthPage({ filter: sceneFilter });
assert.equal(nodes(growthView).filter(node => node.type === "p").length, 0, "full Content growth renders no informational paragraphs below the timeline");
const fullGrowthChildren = growthView.children.filter(child => child && typeof child === "object");
const timelineIndex = fullGrowthChildren.findIndex(node => node.props["aria-label"] === "Scene content growth");
assert.ok(timelineIndex >= 0);
assert.ok(fullGrowthChildren.at(-1).type.name === "SceneCards", "the full view retains matching scene cards");

const ordered = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
assert.deepEqual(plain(helpers.reorderWidgets(ordered, 0, 2)).map((widget) => widget.id), ["b", "c", "a", "d"]);
assert.deepEqual(plain(helpers.reorderWidgets(ordered, 3, 1)).map((widget) => widget.id), ["a", "d", "b", "c"]);
assert.equal(helpers.reorderWidgets(ordered, 1, 1), ordered, "a no-op reorder keeps the existing array");
assert.equal(helpers.reorderWidgets(ordered, -1, 2), ordered, "invalid reorder positions are ignored");

for (const definition of Object.values(dashboard.registry)) {
  assert.ok(["small", "medium", "large"].includes(definition.size));
  assert.ok(["scenes", "performers"].includes(definition.entity));
  assert.ok(definition.route.startsWith("/plugins/dirty-stats"));
}
for (const statistic of Object.keys(dashboard.registry)) {
  for (const size of ["small", "medium", "large"]) {
    const widget = helpers.normalizeWidgets([{ statistic, size }])[0];
    const allControls = nodes(dashboard.widgetOptions({ widget, onChange() {} }));
    const fieldControls = nodes(dashboard.widgetOptions({ widget, kind: "fields", onChange() {} }));
    const toggleControls = nodes(dashboard.widgetOptions({ widget, kind: "toggles", onChange() {} }));
    assert.ok(!fieldControls.some(node => node.type && node.type.name === "CheckControl"), statistic + " keeps checkboxes out of the labeled field rows");
    assert.ok(!toggleControls.some(node => node.type && /^(SelectControl|NumberControl)$/.test(node.type.name)), statistic + " keeps labeled fields out of checkbox rows");
    const labels = controls => controls.filter(node => node.props.label).map(node => node.props.label).sort();
    assert.deepEqual(labels([...fieldControls, ...toggleControls]), labels(allControls), statistic + " retains every option when arranging its settings");
    const widgetNodes = nodes(dashboard.Widget({ ...widgetProps, widget, editing: true }));
    assert.ok(widgetNodes.some(node => node.props.className === "dirty-stats-dashboard-fields"), "every widget size uses the shared field grid");
    assert.ok(widgetNodes.some(node => node.props.className === "dirty-stats-dashboard-toggles"), "every widget size uses aligned toggle rows");
  }
}

context.window.location = { search: "?docsCapture=1" };
context.window.PluginApi.React.useState = value => [value, () => {}];
context.window.PluginApi.React.useRef = value => ({ current: value });
context.window.PluginApi.React.useEffect = () => {};
context.window.__dirtyStatsPlugin.algorithms.docsCaptureEnabled = () => true;
const capturedFilters = dashboard.FilterChooser({ entity: "scenes", onChange() {} });
assert.match(capturedFilters.props.className, /dirty-stats-capture-filter/);
assert.match(capturedFilters.children[0], /Native filter results are hidden/, "capture mode does not mount potentially explicit native results");
const cardWidget = normalized[5];
const cardResource = { [helpers.resourceKey(cardWidget)]: { loading: false, rows: [{ id: "42" }] } };
const cardRenderer = nodes(dashboard.Widget({ ...widgetProps, widget: cardWidget, resources: cardResource, editing: false }))
  .find((node) => node.type && node.type.name === "PerformerCardWidget").type;
let cardEffect, nativeLoads = 0, querySkipped = false;
context.window.PluginApi.React.useEffect = effect => { cardEffect = effect; };
context.window.PluginApi.components = {};
context.window.PluginApi.GQL = { useFindPerformersQuery: ({ skip }) => { querySkipped = skip; return { loading: true }; } };
context.window.DirtyPlugins.native = { ensureComponents: () => { nativeLoads += 1; return Promise.resolve([]); } };
cardRenderer({ widget: cardWidget, rows: [{ id: "42" }] });
cardEffect();
assert.equal(nativeLoads, 0, "capture mode does not load native performer cards");
assert.equal(querySkipped, true, "capture mode does not query native cards");
context.window.location.search = "";
context.window.__dirtyStatsPlugin.algorithms.docsCaptureEnabled = () => false;
cardRenderer({ widget: cardWidget, rows: [{ id: "42" }] });
cardEffect();
assert.equal(nativeLoads, 1, "dashboard cards use the shared Stash component loader");

context.window.PluginApi.components.PerformerCard = "PerformerCard";
context.window.PluginApi.GQL.useFindPerformersQuery = () => ({ data: { findPerformers: { performers: [{ id: "42", name: "Performer" }] } } });
for (const size of ["small", "medium", "large"]) {
  for (const showHeader of [false, true]) {
    const widget = helpers.normalizeWidgets([{ statistic: "performerCards", size, options: { showHeader } }])[0];
    const rendered = nodes(cardRenderer({ widget, rows: [{ id: "42" }] }));
    assert.equal(rendered.some(node => node.props.className === "dirty-stats-dashboard-card-count"), showHeader, "the performer count follows the shared preference");
    assert.equal(rendered.filter(node => node.type === "PerformerCard").length, 1, "hiding the count preserves native cards");
  }
}

context.window.DirtyPlugins.graphql = async (query, variables) => {
  assert.match(query, /DirtyStatsDashboardPerformerCards/, "the card widget uses its own limited performer query");
  assert.deepEqual(plain(variables), {
    filter: { sort: "rating", direction: "DESC", page: 1, per_page: 12 },
    performerFilter: { favorite: true }
  }, "the card widget preserves the chosen performer group and order");
  return { findPerformers: { count: 100, performers: [{ id: "42" }, { id: "7" }] } };
};
helpers.fetchPages("performerCards", normalized[5].filter, { aborted: false }, 12).then((rows) => {
  assert.deepEqual(plain(rows), [{ id: "42" }, { id: "7" }], "card loading stops after the requested page");
  console.log("DirtyStats dashboard layout, performer cards, migration and data grouping passed");
}).catch((error) => { console.error(error); process.exitCode = 1; });
