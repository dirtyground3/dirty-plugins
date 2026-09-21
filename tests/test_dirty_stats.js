"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const routes = [], patches = [], savedSettings = [];
const storedSettings = {
  visualTheme: "candy",
  showMapNumbers: true,
  sceneRatingRounding: 1,
  performerRatingRounding: 0,
  growthGrouping: "month",
  constellationMaxPerformers: 500,
  scatterMinRating: 8,
  studioMinScenes: 5,
  tagDnaColorMetric: "play_count",
  tagDnaMaxTags: 100,
  bogusSetting: "ignored"
};
const context = {
  window: {
    PluginApi: { React: {}, libraries: {}, register: { route: (...args) => routes.push(args) }, patch: { before: (...args) => patches.push(args), instead: (...args) => patches.push(args) } },
    DirtyPlugins: {
      graphql() {},
      getPluginSettings: () => Promise.resolve(storedSettings),
      configurePlugin: (pluginId, settings) => {
        savedSettings.push({ pluginId, settings: JSON.parse(JSON.stringify(settings)) });
        return Promise.resolve({ revision: savedSettings.length, settings });
      }
    },
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (handle) => clearTimeout(handle)
  },
  Intl,
  URLSearchParams,
  console,
  setTimeout,
  clearTimeout
};
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
// Large constellations: the node cap bounds nodes and links, and only visible
// performers may form edges.
const largeScene = { id: "big", performers: Array.from({ length: 6 }, (_, index) => ({ id: "p" + index, name: "P" + index })) };
const large = a.aggregateConstellation([largeScene], 100, 1);
assert.equal(large.nodes.length, 6);
assert.equal(large.totalPerformers, 6);
assert.equal(large.totalScenes, 1);
assert.equal(large.links.length, 15, "six performers in one scene form C(6,2) pairs");
assert.equal(large.nodes.every(node => node.collaborators === 5), true);
const capped = a.aggregateConstellation([largeScene], 3, 1);
assert.equal(capped.nodes.length, 3, "maximum performers caps the node set");
assert.equal(capped.totalPerformers, 6, "the cap must not change the reported total");
assert.equal(capped.links.length, 3, "only visible performers form links");
assert.equal(a.aggregateConstellation([largeScene], 0, 1).nodes.length, 6, "zero displays all performers");
assert.equal(a.aggregateConstellation([{ id: "dup", performers: [{ id: "a", name: "A" }, { id: "a", name: "A" }] }], 100, 1).nodes[0].value, 1, "a repeated performer counts once per scene");
const sharedPairs = [
  { id: "x", performers: [{ id: "a", name: "A" }, { id: "b", name: "B" }] },
  { id: "y", performers: [{ id: "a", name: "A" }, { id: "b", name: "B" }] },
  { id: "z", performers: [{ id: "a", name: "A" }, { id: "c", name: "C" }] }
];
assert.deepEqual(JSON.parse(JSON.stringify(a.aggregateConstellation(sharedPairs, 100, 2).links.map(link => [link.source, link.target, link.value]))), [["a", "b", 2]], "minimum shared scenes filters weaker links");
assert.deepEqual(JSON.parse(JSON.stringify(a.aggregateConstellation([], 100, 1).nodes)), []);
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
assert.equal(a.nearestScatterOption([0, 5, 6, 7, 8, 9], 7.4), 7);
assert.equal(a.nearestScatterOption([0, 5, 6, 7, 8, 9], 4.6), 5);
assert.equal(a.nearestScatterOption([0, 5, 10, 20, 50, 100], 13), 10);
assert.equal(a.nearestScatterOption([0, 5, 10, 20, 50, 100], 40), 50);
const scatterRect = {x: 50, y: 20, width: 400, height: 300};
assert.equal(a.scatterGuideForClick(scatterRect, [250, 310]), "scatterMinRating", "clicks near the bottom move the rating guide");
assert.equal(a.scatterGuideForClick(scatterRect, [60, 150]), "scatterMaxScenes", "clicks near the left move the scenes guide");
assert.equal(a.scatterGuideForClick(scatterRect, [250, 150]), "scatterMinRating", "a middle click moves the nearer guide");
assert.equal(a.scatterGuideForClick(null, [10, 10]), null);
assert.deepEqual(JSON.parse(JSON.stringify(a.scatterGuideLines(9, 10))), [
  {axis: "x", value: 5, active: false}, {axis: "x", value: 6, active: false},
  {axis: "x", value: 7, active: false}, {axis: "x", value: 8, active: false},
  {axis: "x", value: 9, active: true},
  {axis: "y", value: 5, active: false}, {axis: "y", value: 10, active: true},
  {axis: "y", value: 20, active: false}, {axis: "y", value: 50, active: false},
  {axis: "y", value: 100, active: false}
], "every selectable value must get its own guide line");
assert.equal(a.scatterGuideLines(0, 0).some((guide) => guide.active), false, "Any values must not highlight a guide");
const countRating = a.aggregateCountRating([
  {id: "1", title: "One", rating100: 90, play_count: 4, o_counter: 1},
  {id: "2", title: "Two", rating100: 50, play_count: null, o_counter: 7},
  {id: "3", title: "Three", rating100: null, play_count: 2, o_counter: 2},
  {id: "1", title: "One", rating100: 90, play_count: 4, o_counter: 1}
], "play_count");
assert.equal(countRating.total, 3);
assert.equal(countRating.missingRating, 1);
assert.deepEqual(JSON.parse(JSON.stringify(countRating.points)), [
  {id: "1", title: "One", rating: 9, count: 4},
  {id: "2", title: "Two", rating: 5, count: 0}
]);
assert.deepEqual(JSON.parse(JSON.stringify(a.aggregateCountRating([{id: "2", title: "Two", rating100: 50, play_count: 4, o_counter: 7}], "o_counter").points)), [
  {id: "2", title: "Two", rating: 5, count: 7}
]);
assert.equal(a.countRatingLabel("play_count"), "View count");
assert.equal(a.countRatingLabel("o_counter"), "O count");
const countSeries = a.countRatingSeriesData(a.aggregateCountRating([{id: "1", title: "One", rating100: 90, play_count: 4, o_counter: 1}], "play_count"), "1");
assert.deepEqual(JSON.parse(JSON.stringify(countSeries[0].value)), [9, 4], "count vs rating series uses [rating, count]");
assert.equal(countSeries[0].id, "1");
const gib = 1024 ** 3;
const efficiency = a.aggregateQualityEfficiency([
  {id: "a", title: "Balanced", rating100: 90, files: [{id: "fa", size: gib, duration: 600}]},
  {id: "b", title: "Compact", rating100: 80, files: [{id: "fb", size: gib, duration: 1200}]},
  {id: "c", title: "Dominated", rating100: 70, files: [{id: "fc", size: gib, duration: 300}]},
  {id: "d", title: "Same quality, worse efficiency", rating100: 90, files: [{id: "fd", size: gib, duration: 480}]},
  {id: "e", title: "Premium", rating100: 100, files: [{id: "fe", size: gib, duration: 240}]},
  {id: "f", title: "Unrated", rating100: null, files: [{id: "ff", size: gib, duration: 600}]},
  {id: "g", title: "No file data", rating100: 60, files: [{id: "fg", size: 0, duration: 600}]},
  {id: "a", title: "Duplicate", rating100: 10, files: [{id: "duplicate", size: gib, duration: 60}]}
]);
assert.equal(efficiency.total, 7);
assert.equal(efficiency.points.length, 5);
assert.equal(efficiency.missingRating, 1);
assert.equal(efficiency.missingFileData, 1);
assert.equal(efficiency.points.find(point => point.id === "a").efficiency, 10);
assert.equal(a.qualityEfficiencySeriesData(efficiency).every(point => point.itemStyle.color === "#54d5ca"), true, "quality-efficiency bubbles use one neutral treatment");
assert.ok(a.qualityEfficiencySymbolSize(gib, 4 * gib) < a.qualityEfficiencySymbolSize(4 * gib, 4 * gib), "larger files receive larger bubbles");
const studios = a.aggregateStudios([
  {id: "s1", rating100: 90, studio: {id: "1", name: "Alpha", image_path: "/studio/1/image?t=1"}, files: [{id: "f1", size: 1024}, {id: "f2", size: 1024}]},
  {id: "s2", rating100: 80, studio: {id: "1", name: "Alpha", image_path: "/studio/1/image?t=1"}, files: [{id: "f1", size: 1024}]},
  {id: "s3", rating100: null, studio: {id: "2", name: "Beta"}, files: [{id: "f3", size: 2048}]},
  {id: "s4", rating100: 60, studio: {id: "1", name: "Alpha", image_path: "/studio/1/image?t=1"}, files: [{id: "f4", size: null}]},
  {id: "s5", rating100: 70, studio: null, files: [{id: "f5", size: 512}]},
  {id: "s1", rating100: 90, studio: {id: "1", name: "Alpha", image_path: "/studio/1/image?t=1"}, files: [{id: "f1", size: 1024}]}
]);
assert.equal(studios.total, 5);
assert.equal(studios.studios, 2);
assert.equal(studios.missingStudio, 1);
assert.equal(studios.missingSizes, 1);
assert.equal(studios.totalBytes, 5120);
assert.deepEqual(JSON.parse(JSON.stringify(studios.points.map(point => [point.id, point.name, point.scenes, point.rated, point.unrated]))), [["1", "Alpha", 3, 3, 0], ["2", "Beta", 1, 0, 1]]);
assert.deepEqual(JSON.parse(JSON.stringify(studios.points.map(point => point.image))), ["/studio/1/image?t=1", "/studio/2/image"]);
assert.ok(Math.abs(studios.points[0].rating - 23 / 3) < 1e-9);
assert.equal(studios.points[1].rating, null);
assert.equal(studios.points[0].bytes, 3072);
assert.equal(studios.points[1].bytes, 2048);
assert.equal(a.aggregateStudios([]).points.length, 0);
const tagDna = a.aggregateTagDna([
  {id: "s1", rating100: 90, play_count: 4, tags: [{id: "a", name: "Alpha"}, {id: "b", name: "Beta"}, {id: "a", name: "Alpha"}]},
  {id: "s2", rating100: 70, play_count: 2, tags: [{id: "a", name: "Alpha"}]},
  {id: "s3", rating100: null, play_count: 10, tags: [{id: "b", name: "Beta"}]},
  {id: "s4", rating100: 100, play_count: 1, tags: []},
  {id: "s1", rating100: 10, play_count: 100, tags: [{id: "c", name: "Duplicate-only"}]}
]);
assert.equal(tagDna.totalScenes, 4);
assert.equal(tagDna.taggedScenes, 3);
assert.equal(tagDna.untaggedScenes, 1);
assert.equal(tagDna.tags, 2);
assert.equal(tagDna.assignments, 4, "a tag counts once per distinct scene");
assert.deepEqual(JSON.parse(JSON.stringify(tagDna.rows.map(row => [row.id, row.scenes, row.rated, row.unrated, row.plays, row.playsPerScene]))), [["a", 2, 2, 0, 6, 3], ["b", 2, 1, 1, 14, 7]]);
assert.equal(tagDna.rows[0].rating, 8);
assert.equal(tagDna.rows[1].rating, 9);
assert.equal(a.tagDnaMetricLabel("rating"), "Average rating");
assert.equal(a.tagDnaMetricLabel("play_count"), "Views per scene");
assert.equal(a.tagDnaSeriesData(tagDna, "rating", 1, "a").length, 1);
assert.equal(a.tagDnaSeriesData(tagDna, "rating", 1, "a")[0].itemStyle.borderColor, "#fff");
assert.equal(a.tagDnaSeriesData(tagDna, "rating", 0, null).length, 2, "zero removes the tag limit");
assert.deepEqual(JSON.parse(JSON.stringify(a.tagDnaScenes([
  {id: "s1", tags: [{id: "a"}]}, {id: "s1", tags: [{id: "a"}]}, {id: "s2", tags: [{id: "b"}]}
], "a").map(scene => scene.id))), ["s1"]);
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
assert.equal(a.birthdayInYear(2025, 2, 29).toISOString().slice(0, 10), "2025-02-28");
assert.equal(a.birthdayInYear(2024, 2, 29).toISOString().slice(0, 10), "2024-02-29");
const birthdayNow = new Date(Date.UTC(2026, 0, 15));
assert.equal(a.daysUntilBirthday(1, 15, birthdayNow), 0);
assert.equal(a.daysUntilBirthday(1, 16, birthdayNow), 1);
assert.equal(a.daysUntilBirthday(1, 14, birthdayNow), 364, "a passed birthday rolls to next year");
assert.equal(a.daysUntilBirthday(2, 14, birthdayNow), 30);
const birthdays = a.aggregateBirthdays([
  {id: "a", name: "Alice", birthdate: "2000-01-15"},
  {id: "b", name: "Bob", birthdate: "1990-02-14", death_date: "2024-03-02"},
  {id: "c", name: "Carole", birthdate: "2000-01-15"},
  {id: "d", name: "Dan", birthdate: null},
  {id: "e", name: "Eve", birthdate: "2000"},
  {id: "a", name: "Alice", birthdate: "2000-01-15"}
], birthdayNow);
assert.equal(birthdays.total, 5);
assert.equal(birthdays.valid, 3);
assert.equal(birthdays.missing, 2);
assert.equal(birthdays.today, 2);
assert.equal(birthdays.upcoming, 3);
assert.deepEqual(JSON.parse(JSON.stringify(birthdays.entries.map(entry => [entry.id, entry.month, entry.day, entry.turns, entry.daysUntil]))), [["a", 1, 15, 26, 0], ["c", 1, 15, 26, 0], ["b", 2, 14, 36, 30]]);
assert.deepEqual(JSON.parse(JSON.stringify(a.birthdayEntriesFor(birthdays.entries, 1, 15).map(entry => entry.id))), ["a", "c"]);
assert.deepEqual(JSON.parse(JSON.stringify(a.birthdayDefaultSelection(birthdays, birthdayNow))), {month: 1, day: 15, today: true});
assert.deepEqual(JSON.parse(JSON.stringify(a.birthdayEntriesFor(birthdays.entries, 1, 15, true).map(entry => entry.id))), ["a", "c"]);
assert.equal(a.birthdayDefaultSelection({today: 0}, birthdayNow), null);
assert.equal(birthdays.entries.find(entry => entry.id === "b").deceased, true);
assert.equal(birthdays.entries.find(entry => entry.id === "b").deathDate, "2024-03-02");
assert.equal(birthdays.entries.find(entry => entry.id === "a").deceased, false);
assert.equal(a.birthdayAgeText(birthdays.entries.find(entry => entry.id === "a")), "turns 26");
assert.equal(a.birthdayAgeText(birthdays.entries.find(entry => entry.id === "b")), "would have turned 36");
assert.deepEqual(JSON.parse(JSON.stringify(a.birthdayMonthCounts(birthdays.entries))), [2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
assert.equal(a.birthdayDayLabel(2, 14), "February 14");
assert.equal(a.performerImageSource({id: "9", image_path: "/performer/9/image?t=2"}), "/performer/9/image?t=2");
assert.equal(a.performerImageSource({id: "9"}), "/performer/9/image");
assert.equal(a.aggregateBirthdays([{id: "9", name: "Pic", birthdate: "2000-03-01", image_path: "/performer/9/image?t=2"}], birthdayNow).entries[0].image, "/performer/9/image?t=2");
assert.equal(a.aggregateBirthdays([], birthdayNow).entries.length, 0);
const leapBirthdayNow = new Date(Date.UTC(2025, 1, 28));
const leapBirthdays = a.aggregateBirthdays([{id: "1", name: "Leap", birthdate: "2000-02-29"}], leapBirthdayNow);
assert.equal(leapBirthdays.entries[0].daysUntil, 0, "Feb 29 falls on Feb 28 in non-leap years");
assert.deepEqual(JSON.parse(JSON.stringify(a.birthdayDefaultSelection(leapBirthdays, leapBirthdayNow))), {month: 2, day: 28, today: true});
assert.equal(a.birthdayEntriesFor(leapBirthdays.entries, 2, 28, true)[0].id, "1", "the today selection includes observed leap-day birthdays");
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
const dashboardFilter = a.serializeDashboardFilter(Object.assign({ count: () => 2 }, native));
assert.equal(dashboardFilter.find.q, "example");
assert.equal(dashboardFilter.find.page, undefined);
assert.equal(dashboardFilter.find.per_page, undefined);
assert.equal(dashboardFilter.object.gender.value, "FEMALE");
assert.equal(dashboardFilter.count, 3, "search text contributes to the visible filter count");
const variables = a.performerVariables(native, 2);
assert.equal(variables.filter.q, "example");
assert.equal(variables.filter.page, 2);
assert.equal(variables.filter.per_page, 500);
assert.equal(variables.filter.sort, "name");
assert.equal(variables.filter.direction, "DESC");
assert.equal(a.performerVariables({makeFindFilter: () => ({sort: "random_123", direction: "ASC"}), makeFilter: () => ({})}, 1).filter.sort, "random_123");
assert.deepEqual(Array.from(a.orderedCards([{id: "1"}, {id: "3"}, {id: "2"}], [3, 2, 1]), card => card.id), ["3", "2", "1"]);
assert.deepEqual(Array.from(a.orderedCards([], [1, 2])), [], "no fetched cards yields an empty list");
assert.equal(a.orderedCards([{id: "1"}, {id: "2"}], []).length, 0);
assert.deepEqual(Array.from(a.orderedCards([{id: "1"}, {id: "2"}], [1, 2]), card => card.id), ["1", "2"], "requested order is preserved");
assert.deepEqual(Array.from(a.orderedCards([{id: "1"}], [1, 1]), card => card.id), ["1", "1"], "duplicate requests are preserved");
assert.deepEqual(Array.from(a.orderedCards([{id: "1"}, {id: "2"}], [2]), card => card.id), ["2"], "unrequested cards are dropped");
assert.deepEqual(Array.from(a.orderedCards([{id: "1"}], [2])), [], "missing ids are dropped");
assert.deepEqual(Array.from(a.orderedCards([{id: "1"}], ["xyz"])), [], "non-numeric requests cannot match a numeric card");
assert.deepEqual(Array.from(a.orderedCards([{id: "abc"}], ["abc"]), card => card.id), ["abc"], "non-numeric ids match by string");
assert.deepEqual(Array.from(a.orderedCards([{id: "abc"}, {id: "def"}], ["abc"]), card => card.id), ["abc"], "distinct non-numeric ids do not collide");
assert.deepEqual(Array.from(a.orderedCards([{id: "42"}], [42]), card => card.id), ["42"], "numeric requests match string ids");
assert.equal(a.docsCaptureEnabled("?docsCapture=1"), true);
assert.equal(a.docsCaptureEnabled("?foo=bar&docsCapture=1"), true);
assert.equal(a.docsCaptureEnabled("?docsCapture=0"), false);
assert.equal(a.docsCaptureEnabled("?docsCapture"), false);
assert.equal(a.docsCaptureEnabled(""), false);
assert.equal(a.docsCaptureEnabled(undefined), false);
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

(async function () {
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(a.statsSettings.visualTheme, "candy");
  assert.equal(a.statsTheme().label, "Candy Pop");
  assert.equal(a.statsTheme("unknown").key, "classic", "unknown themes fall back to the original look");
  assert.equal(a.statsThemeClass(), "dirty-stats-theme-candy");
  assert.equal(a.themePalette().length, 8);
  assert.equal(a.themedChartOption({ color: "#54d5ca", label: { color: "#ddd" } }).color, "#ff79c6");
  assert.equal(a.statsSettings.showMapNumbers, true, "stored display settings must load");
  assert.equal(a.statsSettings.sceneRatingRounding, 1);
  assert.equal(a.statsSettings.performerRatingRounding, 0);
  assert.equal(a.statsSettings.growthGrouping, "month");
  assert.equal(a.statsSettings.constellationMaxPerformers, 500);
  assert.equal(a.statsSettings.scatterMinRating, 8);
  assert.equal(a.statsSettings.studioMinScenes, 5);
  assert.equal(a.statsSettings.tagDnaColorMetric, "play_count");
  assert.equal(a.statsSettings.tagDnaMaxTags, 100);
  assert.equal(a.statsSettings.growthShowCapacity, true, "unset settings keep their defaults");
  assert.equal(a.statsSettings.bogusSetting, undefined, "unknown stored keys are ignored");

  assert.equal(a.parseStatsSetting("sceneRatingRounding", "0.5"), 0.5, "stringified numbers must coerce");
  assert.equal(a.parseStatsSetting("constellationMaxPerformers", "0"), 0, "the all-performers option must persist");
  assert.equal(a.parseStatsSetting("scatterMinRating", 4), null, "values outside the offered options are rejected");
  assert.equal(a.parseStatsSetting("growthGrouping", "week"), null);
  assert.equal(a.parseStatsSetting("countRatingMetric", "o_counter"), "o_counter");
  assert.equal(a.parseStatsSetting("countRatingMetric", "views"), null);
  assert.equal(a.parseStatsSetting("tagDnaMaxTags", "200"), 200);
  assert.equal(a.parseStatsSetting("tagDnaMaxTags", "0"), 0, "the unlimited tag option must persist");
  assert.equal(a.parseStatsSetting("visualTheme", "paper"), "paper");
  assert.equal(a.parseStatsSetting("visualTheme", "formal"), null);
  assert.equal(a.statsSettings.countRatingMetric, "play_count", "the count metric defaults to the view count");

  const legacy = a.statsSettingsFromStorage({ ratingRounding: 1 });
  assert.deepEqual(JSON.parse(JSON.stringify(legacy)), {
    performerRatingRounding: 1,
    sceneRatingRounding: 1
  }, "a single legacy rounding value must migrate to both charts");
  const overridden = a.statsSettingsFromStorage({ ratingRounding: 1, sceneRatingRounding: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(overridden)), {
    performerRatingRounding: 1,
    sceneRatingRounding: 0
  }, "an explicit new rounding value must win over the legacy value");
  assert.deepEqual(JSON.parse(JSON.stringify(a.statsSettingsFromStorage({ ratingRounding: 2 }))), {});

  a.setStatsSetting("sceneRatingRounding", 0.5);
  a.setStatsSetting("performerRatingRounding", 1);
  a.setStatsSetting("showMapNumbers", false);
  a.setStatsSetting("scatterMinRating", 4);
  a.setStatsSetting("countRatingMetric", "o_counter");
  assert.equal(a.statsSettings.sceneRatingRounding, 0.5);
  assert.equal(a.statsSettings.performerRatingRounding, 1);
  assert.equal(a.statsSettings.showMapNumbers, false);
  assert.equal(a.statsSettings.scatterMinRating, 8, "invalid changes must not stick");
  assert.equal(a.statsSettings.countRatingMetric, "o_counter");

  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(savedSettings.length, 1, "changes must be persisted once after the debounce");
  assert.equal(savedSettings[0].pluginId, "dirtyStats");
  assert.equal(savedSettings[0].settings.sceneRatingRounding, 0.5);
  assert.equal(savedSettings[0].settings.performerRatingRounding, 1);
  assert.equal(savedSettings[0].settings.showMapNumbers, false);
  assert.equal(savedSettings[0].settings.countRatingMetric, "o_counter");
  assert.equal(
    Object.prototype.hasOwnProperty.call(savedSettings[0].settings, "ratingRounding"),
    false,
    "the legacy shared rounding key must be dropped on save"
  );

  a.setStatsSetting("growthShowForecast", true);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(savedSettings.length, 2);
  assert.equal(savedSettings[1].settings.growthShowForecast, true);

  let conflictCalls = 0;
  context.window.DirtyPlugins.getPluginSettings = () => Promise.resolve(Object.assign({}, storedSettings, { remoteOnly: "preserved" }));
  context.window.DirtyPlugins.configurePlugin = (pluginId, settings) => {
    conflictCalls += 1;
    if (conflictCalls === 1) return Promise.reject(new Error("revision conflict"));
    savedSettings.push({ pluginId, settings: JSON.parse(JSON.stringify(settings)) });
    return Promise.resolve({ revision: 99, settings });
  };
  a.setStatsSetting("growthGrouping", "year");
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal(conflictCalls, 2, "a revision conflict must refresh and retry once");
  assert.equal(savedSettings[2].settings.growthGrouping, "year", "the local change must win for its dirty key");
  assert.equal(savedSettings[2].settings.remoteOnly, "preserved", "unrelated settings from another tab must survive the merge");

  console.log("DirtyStats country aggregation, growth, filters, persisted display settings and registration passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
