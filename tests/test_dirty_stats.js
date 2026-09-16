"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const routes = [], patches = [];
const context = { window: { PluginApi: { React: {}, libraries: {}, register: { route: (...args) => routes.push(args) }, patch: { before: (...args) => patches.push(args), instead: (...args) => patches.push(args) } }, DirtyPlugins: { graphql() {} } }, Intl };
vm.createContext(context);
vm.runInContext(fs.readFileSync("plugins/DirtyStats/vendor/world.js", "utf8"), context);
vm.runInContext(fs.readFileSync("plugins/DirtyStats/dirtyStats.js", "utf8"), context);
const a = context.window.__dirtyStatsPlugin.algorithms;
assert.deepEqual(JSON.parse(JSON.stringify(a.constellationGender("TRANSGENDER_FEMALE"))), {key: "TRANSGENDER_FEMALE", label: "Transgender female", color: "#d9a6e8"});
assert.equal(a.constellationGender(null).label, "Unknown");
assert.notEqual(a.constellationGender("NON_BINARY").color, a.constellationGender("MALE").color);
assert.ok(a.constellationLayout(100).repulsion[0] > a.constellationLayout(50).repulsion[0]);
assert.ok(a.constellationLayout(600).symbolMin < a.constellationLayout(100).symbolMin);
assert.ok(a.constellationLayout(600).zoom < a.constellationLayout(100).zoom);
assert.ok(a.constellationLayout(600).gravity < a.constellationLayout(100).gravity);
const constellationSource = [
  {id: "s1", performers: [{id: "a", name: "Alice"}, {id: "b", name: "Bob", gender: "MALE"}, {id: "a", name: "Alice"}]},
  {id: "s2", performers: [{id: "a", name: "Alice", gender: "FEMALE"}, {id: "b", name: "Bob", gender: "MALE"}, {id: "c", name: "Carole", gender: "NON_BINARY"}]},
  {id: "s3", performers: [{id: "a", name: "Alice", gender: "FEMALE"}, {id: "c", name: "Carole", gender: "NON_BINARY"}]},
  {id: "s4", performers: [{id: "d", name: "Dana"}]},
  {id: "s1", performers: [{id: "a", name: "Alice"}, {id: "b", name: "Bob"}]}
];
const constellation = a.aggregateConstellation(constellationSource, 3, 1);
assert.equal(constellation.totalScenes, 4);
assert.equal(constellation.totalPerformers, 4);
assert.deepEqual(JSON.parse(JSON.stringify(constellation.nodes.map(node => [node.id, node.value, node.collaborators, node.gender]))), [["a", 3, 2, "FEMALE"], ["b", 2, 2, "MALE"], ["c", 2, 2, "NON_BINARY"]]);
assert.deepEqual(JSON.parse(JSON.stringify(constellation.links.map(link => [link.source, link.target, link.value]))), [["a", "b", 2], ["a", "c", 2], ["b", "c", 1]]);
const strongConstellation = a.aggregateConstellation(constellationSource, 2, 2);
assert.deepEqual(JSON.parse(JSON.stringify(strongConstellation.nodes.map(node => node.id))), ["a", "b"]);
assert.deepEqual(JSON.parse(JSON.stringify(strongConstellation.links.map(link => [link.source, link.target, link.value]))), [["a", "b", 2]]);
assert.deepEqual(JSON.parse(JSON.stringify(a.constellationScenes(constellationSource, {ids: ["a", "b"]}).map(scene => scene.id))), ["s1", "s2"]);
assert.deepEqual(JSON.parse(JSON.stringify(a.constellationScenes(constellationSource, {ids: ["d"]}).map(scene => scene.id))), ["s4"]);
assert.equal(a.constellationScenes(constellationSource, null).length, 4);
const ratingStats = a.aggregateRatings([{id: "1", rating100: 80}, {id: "2", rating100: 85}, {id: "3", rating100: null}, {id: "4", rating100: 0}, {id: "1", rating100: 80}, {id: "5", rating100: 80}]);
assert.equal(ratingStats.total, 5);
assert.deepEqual(JSON.parse(JSON.stringify(ratingStats.rows)), [{name: "0", value: 1}, {name: "8", value: 2}, {name: "8.5", value: 1}, {name: "Unrated", value: 1}]);
assert.equal(a.aggregateRatings([]).rows.length, 0);
assert.deepEqual(JSON.parse(JSON.stringify(a.aggregateRatings([{id: "1", rating100: 80}, {id: "2", rating100: 85}, {id: "3", rating100: null}, {id: "4", rating100: 0}, {id: "5", rating100: 80}], 0.5).rows)), [{name: "0", value: 1}, {name: "8", value: 2}, {name: "8.5", value: 1}, {name: "Unrated", value: 1}]);
assert.deepEqual(JSON.parse(JSON.stringify(a.aggregateRatings([{id: "1", rating100: 80}, {id: "2", rating100: 85}, {id: "3", rating100: null}, {id: "4", rating100: 0}, {id: "5", rating100: 80}], 1).rows)), [{name: "0", value: 1}, {name: "8", value: 2}, {name: "9", value: 1}, {name: "Unrated", value: 1}]);
const scatter = a.aggregateScatter([
  {id: "1", name: "Hidden gem", rating100: 90, scene_count: 3},
  {id: "2", name: "Prolific", rating100: 95, scene_count: 80},
  {id: "3", name: "Average", rating100: 60, scene_count: 5},
  {id: "4", name: "Unrated", rating100: null, scene_count: 10},
  {id: "5", name: "No scenes", rating100: 80, scene_count: null},
  {id: "1", name: "Hidden gem", rating100: 90, scene_count: 3}
], 8, 10);
assert.equal(scatter.total, 5);
assert.equal(scatter.points.length, 3);
assert.deepEqual(JSON.parse(JSON.stringify(scatter.points.map(point => [point.id, point.rating, point.scenes, point.highlight]))), [["1", 9, 3, true], ["2", 9.5, 80, false], ["3", 6, 5, false]]);
assert.equal(scatter.highlights, 1);
assert.equal(scatter.missingRating, 1);
assert.equal(scatter.missingScenes, 1);
assert.equal(a.aggregateScatter([{id: "1", rating100: 50, scene_count: 1}], 0, 0).points[0].highlight, false);
assert.equal(a.aggregateScatter([], 8, 10).points.length, 0);
const studios = a.aggregateStudios([
  {id: "s1", rating100: 90, studio: {id: "1", name: "Alpha"}, files: [{id: "f1", size: 1024}, {id: "f2", size: 1024}]},
  {id: "s2", rating100: 80, studio: {id: "1", name: "Alpha"}, files: [{id: "f1", size: 1024}]},
  {id: "s3", rating100: null, studio: {id: "2", name: "Beta"}, files: [{id: "f3", size: 2048}]},
  {id: "s4", rating100: 60, studio: {id: "1", name: "Alpha"}, files: [{id: "f4", size: null}]},
  {id: "s5", rating100: 70, studio: null, files: [{id: "f5", size: 512}]},
  {id: "s1", rating100: 90, studio: {id: "1", name: "Alpha"}, files: [{id: "f1", size: 1024}]}
]);
assert.equal(studios.total, 5);
assert.equal(studios.studios, 2);
assert.equal(studios.missingStudio, 1);
assert.equal(studios.missingSizes, 1);
assert.equal(studios.totalBytes, 5120);
assert.deepEqual(JSON.parse(JSON.stringify(studios.points.map(point => [point.id, point.name, point.scenes, point.rated, point.unrated]))), [["1", "Alpha", 3, 3, 0], ["2", "Beta", 1, 0, 1]]);
assert.ok(Math.abs(studios.points[0].rating - 23 / 3) < 1e-9);
assert.equal(studios.points[1].rating, null);
assert.equal(studios.points[0].bytes, 3072);
assert.equal(studios.points[1].bytes, 2048);
assert.equal(a.aggregateStudios([]).points.length, 0);
assert.equal(a.roundRating(8.4, 0.5), 8.5);
assert.equal(a.roundRating(8.5, 1), 9);
assert.equal(a.sceneRating({rating100: 86}, 0.5), "8.5");
assert.equal(a.sceneRating({rating100: 85}, 1), "9");
assert.equal(a.sceneRating({rating100: null}, 1), "Unrated");
assert.equal(a.sceneRating({rating100: null}), "Unrated");
assert.equal(a.sceneRating({rating100: 100}), "10");
assert.equal(a.ageAtScene("2000-06-15", "2025-06-14"), 24);
assert.equal(a.ageAtScene("2000-06-15", "2025-06-15"), 25);
assert.equal(a.ageAtScene("2000-02-29", "2025-02-28"), 24);
assert.equal(a.ageAtScene("2000-02-29", "2025-03-01"), 25);
assert.equal(a.ageAtScene("2000-02-30", "2025-03-01"), null);
assert.equal(a.ageAtScene("2000", "2025-03-01"), null);
assert.equal(a.ageAtScene("2025-03-02", "2025-03-01"), null);
const ages = a.aggregateAges([
  {id: "1", date: "2024-06-15", performers: [{id: "a", birthdate: "2000-06-15"}, {id: "a", birthdate: "2000-06-15"}, {id: "b", birthdate: "2000-01-01"}]},
  {id: "2", date: "2024-07-01", performers: [{id: "a", birthdate: "2000-06-15"}, {id: "c", birthdate: null}]},
  {id: "3", date: "2026-06-15", performers: [{id: "a", birthdate: "2000-06-15"}]},
  {id: "4", date: null, performers: [{id: "a", birthdate: "2000-06-15"}]},
  {id: "1", date: "2024-06-15", performers: [{id: "a", birthdate: "2000-06-15"}]}
]);
assert.deepEqual(JSON.parse(JSON.stringify(ages.rows)), [{age: 24, count: 2}, {age: 25, count: 0}, {age: 26, count: 1}]);
assert.equal(ages.performers, 2);
assert.equal(ages.scenes, 4);
assert.equal(ages.missingSceneDates, 1);
assert.equal(ages.missingBirthdates, 1);
assert.equal(a.aggregateAges([]).rows.length, 0);
const ageScenes = [
  {date: "2024-06-15", performers: [{id: "a", birthdate: "2000-06-15"}, {id: "a", birthdate: "2000-06-15"}]},
  {date: "2025-06-15", performers: [{id: "a", birthdate: "2000-06-15"}, {id: "b", birthdate: "1990-01-01"}]},
  {date: null, performers: [{id: "c", birthdate: "2000-01-01"}]}
];
assert.equal(a.performersAtAge(ageScenes, null).length, 2);
assert.equal(a.performersAtAge(ageScenes, 24).length, 1);
assert.equal(a.performersAtAge(ageScenes, 35)[0].id, "b");
assert.equal(a.performersAtAge(ageScenes, 26).length, 0);
const eligibleScenes = a.filterAgeScenes(ageScenes.map((scene, i) => ({...scene, id: String(i)})), ["b"]);
assert.equal(a.performersAtAge(eligibleScenes, null).length, 1);
assert.equal(a.performersAtAge(eligibleScenes, 24).length, 0);
assert.equal(a.aggregateAges(eligibleScenes).performers, 1);
assert.equal(a.performersAtAge(a.filterAgeScenes(ageScenes, []), null).length, 0);
assert.equal(a.filterAgeScenes(ageScenes, null), ageScenes);
assert.equal(a.performersAtAge(ageScenes, null).length, 2);
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
  { id: "5", name: "Unmapped", country: "Atlantis", tags: [] },
  { id: "6", name: "Namibian", country: "NA", tags: [] },
  { id: "7", name: "Not available", country: "N/A", tags: [] },
  { id: "8", name: "Dashed", country: "-", tags: [] },
  { id: "9", name: "Undisclosed", country: "Unknown", tags: [] }
];
const native = { makeFindFilter: () => ({ q: "example", page: 8, per_page: 20, sort: "name", direction: "DESC" }), makeFilter: () => ({ gender: { value: "FEMALE", modifier: "EQUALS" }, tags: { value: ["1"], modifier: "INCLUDES_ALL" }, AND: { favorite: true } }) };
const variables = a.performerVariables(native, 2);
assert.equal(variables.filter.q, "example");
assert.equal(variables.filter.page, 2);
assert.equal(variables.filter.per_page, 500);
assert.equal(variables.filter.sort, "name");
assert.equal(variables.filter.direction, "DESC");
assert.equal(a.performerVariables({makeFindFilter: () => ({sort: "random_123", direction: "ASC"}), makeFilter: () => ({})}, 1).filter.sort, "random_123");
assert.deepEqual(Array.from(a.orderedCards([{id: "1"}, {id: "3"}, {id: "2"}], [3, 2, 1]), card => card.id), ["3", "2", "1"]);
assert.equal(variables.performerFilter.gender.value, "FEMALE");
assert.equal(variables.performerFilter.AND.favorite, true);
assert.equal(variables.performerFilter.tags.value[0], "1");
assert.equal(native.makeFindFilter().page, 8); // native pagination is never mutated
const sceneVars = a.sceneVariables(native, 3);
assert.equal(sceneVars.filter.page, 3);
assert.equal(sceneVars.filter.q, "example");
assert.equal(sceneVars.filter.per_page, 500);
assert.equal(sceneVars.filter.sort, "name");
assert.equal(sceneVars.filter.direction, "DESC");
assert.equal(sceneVars.sceneFilter.AND.favorite, true);
const growth = a.aggregateGrowth([
  { id: "2", created_at: "2026-01-02T01:00:00Z", files: [{ id: "2", size: "2048" }, { id: "3", size: 1024 }] },
  { id: "1", created_at: "2026-01-01T23:00:00-02:00", files: [{ id: "1", size: 1024 }, { id: "1", size: 1024 }] },
  { id: "3", created_at: "2026-01-04T12:00:00Z", files: [{ id: "4", size: 512 }, { size: -1 }] },
  { id: "2", created_at: "2026-01-02T01:00:00Z", files: [{ size: 2048 }] },
  { id: "4", created_at: "bad", files: [{ size: 4096 }] },
  { id: "5", created_at: "2026-01-02", files: [] },
  { id: "6", created_at: "2026-01-02", files: [{ size: null }] }
], Date.parse("2026-01-06T00:00:00Z"));
assert.equal(growth.bytes, 4608);
assert.equal(growth.included, 3);
assert.equal(growth.excluded, 3);
assert.equal(growth.invalidFiles, 2);
assert.equal(growth.total, 6);
assert.deepEqual(JSON.parse(JSON.stringify(growth.points)), [
  [Date.parse("2026-01-01"), 0], [Date.parse("2026-01-02"), 4096],
  [Date.parse("2026-01-04"), 4608], [Date.parse("2026-01-06"), 4608]
]);
assert.equal(a.aggregateGrowth([], 0).points.length, 0);
assert.equal(a.aggregateGrowth([{id: "0", created_at: "2026-01-02", files: [{size: 0}]}], 0).included, 1);
assert.equal(a.formatBytes(1024 ** 4), "1 TiB");
assert.equal(a.formatBytes(0), "0 B");
const datedScenes = [
  {id: "1", created_at: "2026-01-03", date: "2020-05-01", files: [
    {id: "a", size: 1024, mod_time: "2025-12-01T23:30:00-02:00"},
    {id: "b", size: 2048, mod_time: "2025-12-05"}]},
  {id: "2", created_at: "2026-01-04", date: null, files: [{id: "c", size: 512, mod_time: null}]}
];
const modified = a.aggregateGrowth(datedScenes, 0, "mod_time");
const monthly = a.aggregateGrowth(datedScenes, 0, "mod_time", "month");
assert.deepEqual(JSON.parse(JSON.stringify(monthly.points)), [[Date.parse("2025-11-01"), 0], [Date.parse("2025-12-01"), 3072]]);
const yearly = a.aggregateGrowth(datedScenes, 0, "created_at", "year");
const forecastNow = Date.parse("2026-01-10");
const forecastStats = a.aggregateGrowth([{id: "forecast", created_at: "2026-01-01", files: [{size: 100}]}], forecastNow);
const forecast = a.forecastGrowth(forecastStats, 200, forecastNow, [Date.parse("2026-01-01"), Date.parse("2026-01-10")]);
assert.equal(forecast.rate, 10);
assert.equal(forecast.reachedAt, Date.parse("2026-01-20"));
assert.equal(forecast.points[1][1], 200);
assert.ok(a.forecastGrowth(forecastStats, 100, forecastNow).reason.includes("already"));
assert.ok(a.forecastGrowth(forecastStats, 0, forecastNow).reason.includes("unavailable"));
assert.ok(a.forecastGrowth(forecastStats, 200, forecastNow, [Date.parse("2026-01-02"), forecastNow]).reason.includes("No growth"));
assert.ok(a.forecastGrowth(a.aggregateGrowth([], forecastNow), 200, forecastNow).reason.includes("No matching"));
assert.deepEqual(JSON.parse(JSON.stringify(yearly.points)), [[Date.parse("2025-01-01"), 0], [Date.parse("2026-01-01"), 3584]]);
assert.equal(monthly.bytes, modified.bytes);
assert.equal(modified.bytes, 3072);
assert.equal(modified.excluded, 1);
assert.equal(modified.invalidDates, 1);
assert.deepEqual(Array.from(modified.points, p => Array.from(p)), [
  [Date.parse("2025-12-01"), 0], [Date.parse("2025-12-02"), 1024], [Date.parse("2025-12-05"), 3072]
]);
const recorded = a.aggregateGrowth(datedScenes, 0, "scene_date");
assert.equal(recorded.bytes, 3072);
assert.equal(recorded.excluded, 1);
assert.equal(recorded.points[1][0], Date.parse("2020-05-01"));
assert.equal(a.aggregateGrowth(datedScenes, 0).bytes, 3584);
const datePeriod = [Date.parse("2025-12-02"), Date.parse("2025-12-02")];
assert.equal(a.scenesInPeriod(datedScenes, "mod_time", datePeriod).length, 1);
assert.equal(a.periodGrowth(modified.points, datePeriod), 1024);
assert.equal(a.scenesInPeriod(datedScenes, "created_at", datePeriod).length, 0);
assert.equal(a.scenesInPeriod(datedScenes, "scene_date", [Date.parse("2020-05-01"), Date.parse("2020-05-01")]).length, 1);
assert.equal(a.scenesInPeriod(datedScenes, "created_at", null).length, 2);
const stats = a.aggregate(performers, index);
assert.equal(a.countryPerformers(performers, "").length, 9);
assert.equal(a.countryPerformers(performers, index.us).length, 2);
assert.equal(a.countryPerformers(performers, index.fr)[0].id, "3");
assert.equal(a.countryPerformers(performers, index.jp).length, 0);
assert.equal(a.countryName("NA", index), "Namibia");
assert.equal(a.countryName("N/A", index), null);
assert.equal(a.countryName("N.A.", index), null);
assert.equal(a.countryName("-", index), null);
assert.equal(a.countryName("Unknown", index), null);
assert.equal(a.countryName("Atlantis", index), null);
assert.equal(a.countryPerformers(performers, index[a.normalize("NA")]).map(p => p.id).join(","), "6");
assert.equal(stats.total, 9);
assert.equal(stats.rows[0].value, 2);
assert.equal(stats.rows.length, 3);
assert.equal(stats.missing, 5);
// Every dropped performer (blank, placeholder, or unrecognized) is counted in missing.
assert.equal(stats.rows.reduce((sum, row) => sum + row.value, 0) + stats.missing, stats.total);
for (const lon of [-180, -90, 0, 45, 180]) {
  for (const lat of [-90, -80, -45, 0, 45, 80, 90]) {
    const projected = a.eckertIV.project([lon, lat]);
    assert.ok(projected.every(Number.isFinite));
    const inverse = a.eckertIV.unproject(projected);
    assert.ok(Math.abs(inverse[0] - lon) < 1e-6);
    assert.ok(Math.abs(inverse[1] - lat) < 1e-6);
  }
}
assert.ok(a.eckertIV.project([0, 45])[1] < 0); // north is above the equator
assert.equal(a.aggregate([], index).rows.length, 0);
assert.equal(routes[0][0], "/plugins/dirty-stats");
assert.equal(patches[0][0], "PerformerList");
assert.equal(patches[1][0], "SceneList");
assert.equal(patches[2][0], "MainNavBar.UtilityItems");
context.window.location = { pathname: "/performers" };
const original = { original: true };
assert.equal(patches[0][1]({ extraCriteria: { dirtyStats: true } }, () => original), original);
context.window.location.pathname = "/plugins/dirty-stats";
assert.equal(patches[0][1]({ extraCriteria: {} }, () => original), original);
assert.equal(patches[1][1]({ filter: native }, () => original), original);
context.window.location.pathname = "/scenes";
assert.equal(patches[1][1]({ filter: native }, () => original), original);
vm.runInContext(fs.readFileSync("plugins/DirtyStats/dirtyStats.js", "utf8"), context);
assert.equal(routes.length, 1);
console.log("DirtyStats country aggregation, cumulative growth, native filters and registration passed.");
