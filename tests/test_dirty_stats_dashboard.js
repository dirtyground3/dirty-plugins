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
assert.equal(normalized[1].statistic, "growth", "a second widget may use the same statistic");
assert.equal(normalized[2].options.rounding, 1, "stringified persisted values must coerce to an allowed option");
assert.deepEqual(normalized[2].filter, { find: { q: "favorite" }, object: { favorite: true }, count: 2 }, "widget filters must persist without pagination state");
assert.deepEqual(normalized[3].options, { metric: "play_count", maxTags: 0 }, "Tag DNA widget options must normalize and persist its unlimited choice");
assert.deepEqual(normalized[4].options, { maxPerformers: 0, minShared: 2 }, "Cast constellation must normalize and persist its all-performers choice");
assert.deepEqual(normalized[5].options, { cardCount: 12 }, "Performer card count must persist");
assert.equal(normalized[5].title, "Favorite cast", "custom titles must persist per widget");
assert.equal(normalized[0].title, "", "existing widgets keep their default titles");
assert.equal(helpers.normalizeWidgets([{ statistic: "ratings", title: "   " }])[0].title, "", "a blank custom title restores the default label");
assert.equal(helpers.normalizeWidgets([{ statistic: "ratings", title: 42 }])[0].title, "", "invalid custom titles are ignored");
assert.equal(helpers.widgetTitle(normalized[5]), "Favorite cast", "the header uses the custom title");
assert.equal(helpers.widgetTitle(normalized[0]), "Content growth", "the header falls back to the default label");
assert.equal(helpers.widgetHeightUnits({ statistic: "ratings", size: "small", options: {} }), 1, "small widgets use one height step");
assert.equal(helpers.widgetHeightUnits({ statistic: "ratings", size: "medium", options: {} }), 1, "compact medium charts use one height step");
assert.equal(helpers.widgetHeightUnits({ statistic: "birthdays", size: "medium", options: {} }), 2, "medium calendars use two height steps");
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
assert.equal(editNodes.filter((node) => node.type === "button").length, 3, "the drag handle replaces separate position arrows");
assert.ok(!editNodes.some((node) => node.type === "Link" || node.type === "input" && node.props.type === "radio"), "edit mode hides the full view link and size radios");
assert.ok(viewNodes.some((node) => node.type === "Link"), "the full view link returns outside edit mode");
assert.ok(!viewNodes.some((node) => node.type === "input" && node.props.className === "dirty-stats-dashboard-title-input"), "the title is plain text outside edit mode");
const cardOptions = nodes(dashboard.widgetOptions({ widget: normalized[5], onChange() {} }));
assert.ok(cardOptions.some((node) => node.type.name === "NumberControl" && node.props.label === "Cards to display"), "performer cards expose a free numeric count instead of a fixed list");

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
