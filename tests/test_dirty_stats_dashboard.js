const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = {
  console,
  window: {
    PluginApi: { React: {}, libraries: { ReactRouterDOM: {} } },
    DirtyPlugins: { react: {} },
    __dirtyStatsPlugin: { route: "/plugins/dirty-stats", algorithms: {} }
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("plugins/DirtyStats/dirtyStatsDashboard.js", "utf8"), context);

const dashboard = context.window.__dirtyStatsDashboard;
const helpers = dashboard.algorithms;
const plain = (value) => JSON.parse(JSON.stringify(value));

assert.equal(Object.keys(dashboard.registry).length, 13, "every DirtyStats statistic must be available as a widget");
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
  { id: "six", statistic: "constellation", size: "large", options: { maxPerformers: "0", minShared: 2 } }
]));
assert.equal(normalized.length, 5, "duplicate statistics are allowed while unknown types are rejected");
assert.equal(normalized[0].size, "large", "invalid sizes must use the statistic default");
assert.equal(normalized[0].options.grouping, "month", "invalid options must use their defaults");
assert.equal(normalized[0].options.dateBasis, "mod_time");
assert.equal(normalized[0].options.showCapacity, true);
assert.equal(normalized[1].statistic, "growth", "a second widget may use the same statistic");
assert.equal(normalized[2].options.rounding, 1, "stringified persisted values must coerce to an allowed option");
assert.deepEqual(normalized[2].filter, { find: { q: "favorite" }, object: { favorite: true }, count: 2 }, "widget filters must persist without pagination state");
assert.deepEqual(normalized[3].options, { metric: "play_count", maxTags: 0 }, "Tag DNA widget options must normalize and persist its unlimited choice");
assert.deepEqual(normalized[4].options, { maxPerformers: 0, minShared: 2 }, "Cast constellation must normalize and persist its all-performers choice");
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

console.log("DirtyStats dashboard layout validation, migration and data grouping passed");
