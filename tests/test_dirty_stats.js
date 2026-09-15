"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const routes = [], patches = [];
const context = { window: { PluginApi: { React: {}, libraries: {}, register: { route: (...args) => routes.push(args) }, patch: { before: (...args) => patches.push(args) } }, DirtyPlugins: { graphql() {} } }, Intl };
vm.createContext(context);
vm.runInContext(fs.readFileSync("plugins/DirtyStats/vendor/world.js", "utf8"), context);
vm.runInContext(fs.readFileSync("plugins/DirtyStats/dirtyStats.js", "utf8"), context);
const a = context.window.__dirtyStatsPlugin.algorithms;
const index = a.countryIndex(context.window.__dirtyStatsWorld.features);
assert.equal(index[a.normalize("US")], index[a.normalize("United States")]);
assert.equal(index[a.normalize("USA")], index[a.normalize("United States of America")]);
assert.equal(index[a.normalize("GB")], index[a.normalize("UK")]);
assert.equal(index[a.normalize("Côte d’Ivoire")], index[a.normalize("CI")]);
assert.equal(index[a.normalize("Czech Republic")], index[a.normalize("CZ")]);
assert.ok(index[a.normalize("FR")]);
const performers = [
  { id: "1", name: "Alice", alias_list: ["Example"], country: "US", gender: "FEMALE", favorite: true, rating100: 85, scene_count: 3, tags: [{ id: "1", name: "Test" }] },
  { id: "2", name: "Bob", country: "United States", gender: "MALE", favorite: false, rating100: null, scene_count: 0, tags: [] },
  { id: "3", name: "Carole", country: "FR", gender: "FEMALE", favorite: false, rating100: 40, scene_count: 5, tags: [] },
  { id: "4", name: "Missing", country: " ", tags: [] },
  { id: "5", name: "Unmapped", country: "Atlantis", tags: [] }
];
const empty = { name: "", gender: "", favorite: "", tag: "", rating: "", scenes: "", country: "" };
function filtered(patch) { return a.filterPerformers(performers, Object.assign({}, empty, patch)); }
assert.equal(filtered({}).length, 5);
assert.equal(filtered({ name: "example", gender: "FEMALE", tag: "1", favorite: "yes", rating: "80", scenes: "3" }).length, 1);
assert.equal(filtered({ favorite: "no" }).length, 4);
assert.equal(filtered({ rating: "0" }).length, 2); // unrated is not a zero rating
assert.equal(filtered({ scenes: "4" }).length, 1);
assert.equal(filtered({ country: index.us }).length, 2);
const stats = a.aggregate(performers, index);
assert.equal(stats.total, 5);
assert.equal(stats.rows[0].value, 2);
assert.equal(stats.rows.length, 2);
assert.equal(stats.missing, 1);
assert.equal(stats.unknown.Atlantis, 1);
assert.equal(stats.rows.reduce((sum, row) => sum + row.value, 0) + stats.missing + Object.values(stats.unknown).reduce((x, y) => x + y, 0), stats.total);
const exported = a.csv(a.aggregate(filtered({ gender: "FEMALE" }), index));
assert.ok(exported.includes('"France","1"'));
assert.ok(!exported.includes("Atlantis"));
assert.equal(a.aggregate([], index).rows.length, 0);
assert.equal(routes[0][0], "/plugins/dirty-stats");
assert.equal(patches[0][0], "MainNavBar.UtilityItems");
vm.runInContext(fs.readFileSync("plugins/DirtyStats/dirtyStats.js", "utf8"), context);
assert.equal(routes.length, 1);
console.log("dirtyStats country aggregation, combined filters, exports and registration passed.");
