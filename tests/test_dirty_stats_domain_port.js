"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const {testModulePath} = require("./plugin_paths");
const growth = require(testModulePath("DirtyStats", "growth.cjs")), ages = require(testModulePath("DirtyStats", "ages.cjs"));
const registry = require(testModulePath("DirtyStats", "registry.cjs")).createRegistry();
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const fixturePath = path.join(__dirname, "fixtures/stats-domain-port.json"), record = process.argv.includes("--record");
let reference;
if (record) {
  const context = vm.createContext({window: {}});
  for (const name of ["Growth", "Ages", "Registry"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../.build/phase4-stats-baseline/plugins/DirtyStats/dirtyStats" + name + ".js"), "utf8"), context);
  reference = {growth: context.window.__dirtyStatsGrowth, ages: context.window.__dirtyStatsAges, registry: context.window.__dirtyStatsRegistry};
}
const cases = [];
function check(name, action) {
  const actual = hash(action({growth, ages, registry}));
  if (record) assert.equal(actual, hash(action(reference)), name);
  cases.push({name, hash: actual});
}
check("registry definitions, choices and order", api => api.registry);
for (let seed = 0; seed < 30; seed++) {
  const people = Array.from({length: 8}, (_, i) => ({id: String(i), name: "Person " + i,
    birthdate: ["1980-02-29", "1999-12-31", "2000-01-01", "bad", null, "2001-02-29", "1987-06-15", "1990-08-20"][(i + seed) % 8],
    death_date: i % 3 ? null : "2020-01-01", image_path: i % 2 ? " /portrait.png " : ""}));
  const dates = ["2024-02-29", "2023-01-01", null, "bad", "2020-06-01", "2025-12-31"];
  const scenes = Array.from({length: 12}, (_, i) => ({id: String(i % 10), date: dates[(i + seed) % dates.length], created_at: dates[(i + seed + 1) % dates.length],
    performers: [people[i % 8], people[(i + 1) % 8], people[i % 8]],
    files: [{id: "a", size: [0, "20", "", null, -1, "bad", 1500][(i + seed) % 7], mod_time: dates[(i + 2) % 6]},
            {id: "a", size: 800, mod_time: "2024-01-01"}, {id: "b", size: 1024 + seed * 100, mod_time: dates[(i + seed) % 6]}]}));
  const now = Date.UTC(2026, 0, 1), period = [Date.UTC(2023, 0, 1), Date.UTC(2025, 11, 31)];
  for (const basis of ["created_at", "mod_time", "scene_date"]) for (const grouping of ["day", "month", "year"]) {
    check(`${seed} growth ${basis}/${grouping}`, api => {
      const summary = api.growth.aggregateGrowth(scenes, now, basis, grouping);
      return [summary, api.growth.scenesInPeriod(scenes, basis, period), api.growth.periodGrowth(summary.points, period),
        api.growth.forecastGrowth(summary, 100000, now, period), api.growth.forecastGrowth(summary, 1, now, null), api.growth.formatBytes(summary.bytes)];
    });
  }
  check(`${seed} ages`, api => [api.ages.aggregateAges(scenes), api.ages.performersAtAge(scenes, seed), api.ages.performersAtAge(scenes, null)]);
  check(`${seed} birthdays`, api => {
    const summary = api.ages.aggregateBirthdays(people, new Date(Date.UTC(2024 + seed % 3, seed % 12, 28)));
    return [summary, api.ages.birthdayMonthCounts(summary.entries), api.ages.birthdayEntriesFor(summary.entries, 2, 29),
      api.ages.birthdayEntriesFor(summary.entries, 2, 28, true), api.ages.birthdayDefaultSelection(summary, new Date(Date.UTC(2025, 1, 28))),
      summary.entries.map(api.ages.birthdayAgeText)];
  });
}
if (record) fs.writeFileSync(fixturePath, JSON.stringify({reference: "pre-port DirtyStats 0.6.41", cases}, null, 2) + "\n");
else assert.deepEqual(cases, JSON.parse(fs.readFileSync(fixturePath, "utf8")).cases);
console.log(`Stats registry/growth/forecast/ages/birthdays: ${cases.length} deterministic legacy comparisons passed`);
