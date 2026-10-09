"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const {testModulePath} = require("./plugin_paths");
const values = require(testModulePath("DirtyPlugins", "values.cjs"));
const {createRankDomain} = require(testModulePath("DirtyRank", "rank.cjs"));
const noop = () => {};
const hooks = {Fragment: "fragment", createElement: noop, useEffect: noop,
  useState: value => [typeof value === "function" ? value() : value, noop],
  useCallback: value => value, useMemo: fn => fn(), useRef: value => ({current: value})};
function host() {
  const storage = new Map();
  const registrations = [];
  return {registrations, location: {pathname: "/", search: ""}, addEventListener: (...args) => registrations.push(args),
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)},
    PluginApi: {React: hooks, libraries: {Intl: {}, ReactRouterDOM: {}},
      components: {}, register: {route: (...args) => registrations.push(args)},
      patch: {before: (...args) => registrations.push(args), after: (...args) => registrations.push(args), instead: (...args) => registrations.push(args)}},
    DirtyPlugins: {values, react: {html: noop}, graphql: async () => ({}),
      getPluginSettings: async () => ({}), runPluginOperation: async () => ({})}};
}
const record = process.argv.includes("--record");
const fixturePath = path.join(__dirname, "fixtures/rank-domain-port.json");
const expectedHashes = record ? [] : JSON.parse(fs.readFileSync(fixturePath, "utf8")).hashes;
let legacy, referenceMath;
if (record) {
  const referenceWindow = host(); referenceMath = Object.create(Math);
  const referenceContext = vm.createContext({window: referenceWindow, Math: referenceMath, URLSearchParams, console});
  for (const name of ["Settings", "Rating", "Matchmaking", "SettingsPanel", "BattleSession", ""]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../.build/phase4-rank-baseline/plugins/DirtyRank/dirtyRank" + name + ".js"), "utf8"), referenceContext);
  }
  legacy = referenceWindow.__dirtyRankPlugin.algorithms;
}
global.window = host();
const migrated = createRankDomain({PluginApi: window.PluginApi, DirtyPlugins: window.DirtyPlugins});
assert.equal(window.__dirtyRankPlugin, undefined, "domain factories install no route, patch, listener or instance guard");
assert.deepEqual(window.registrations, [], "import and construction own no host integrations");
const plain = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash("sha256").update(JSON.stringify(plain(value))).digest("hex");
function seed(value) {
  return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 4294967296; };
}
const cases = [{}, {genderBoxes: [{id: "BOX-1", name: "Mixed", genders: ["MALE", "FEMALE"]}],
  categories: {"BOX-1": [{name: "Face", weight: "2"}, {name: "Technique", weight: "0.5"}]}},
  {categories: {FEMALE: [{name: " Café "}, {name: "Cafe"}, {name: "overall"}, {name: "", enabled: false}]}},
  {enabledCohorts: "male,FEMALE", defaultCohort: "male", overallScoreStrategy: "power"}];
for (const raw of [undefined, null, "", "invalid", -1, 0, "1", 0.01, 4, 99, Infinity]) {
  cases.push({initialDeviation: raw, provisionalDeviation: raw, evidenceWeight: raw, overallPower: raw,
    leaderboardTopCount: raw, leaderboardPerformerCount: raw, showBattlesInMenu: raw, calibrationPercent: raw});
}
const people = Array.from({length: 7}, (_, index) => ({id: String(index + 1), name: "Fixture " + (index + 1),
  gender: index === 6 ? "MALE" : "FEMALE", image_path: "/synthetic.svg"}));
let comparisons = 0;
for (const raw of cases) {
  const settings = migrated.settingsFromConfiguration(raw);
  if (record) {
    assert.deepEqual(plain(settings), plain(legacy.settingsFromConfiguration(raw)));
    assert.deepEqual(plain(migrated.serializedSettings(settings)), plain(legacy.serializedSettings(settings)));
  }
  for (const variation of [0, 1, 2]) {
    const states = Object.fromEntries(people.map((person, index) => [person.id, {version: 2, revision: 2, pools:
      Object.fromEntries(Object.entries(settings.categoriesByCohort).flatMap(([cohort, categories]) => categories.map(category =>
        [category.id + "|" + cohort, {rating: 900 + (variation === 1 ? 0 : index * 80), deviation: 40 + index * 15,
          volatility: 0.06, matches: variation ? index * 3 : 0, wins: index, losses: index, draws: index}])))}]));
    for (const api of [migrated, legacy].filter(Boolean)) {api.applyRatingIndex({revision: 2, states}); api.setOverallReferencePerformers(people);}
    const cohort = settings.defaultCohort;
    const category = settings.categoriesByCohort[cohort][0];
    const methods = [
      ["leaderboardData", [people, category.id, cohort, settings]],
      ["leaderboardData", [people, "__overall__", cohort, settings]],
      ["sortPerformersByOverall", [people, "ASC", settings]],
      ["sortPerformersByOverall", [people, "DESC", settings]],
      ["categoryConfidence", [people, category, cohort, settings]],
      ["selectPair", [people, category, cohort, settings, ["1:2"]]],
      ["selectGauntletPair", [people, people[0], category, cohort, settings, []]],
      ["selectKingsStartingPair", [people, category, cohort, settings]],
      ["selectKingsPair", [people, people[0], "left", ["2"], category, cohort, settings]],
    ];
    for (const [name, args] of methods) {
      const originalRandom = Math.random;
      let actual;
      try { Math.random = seed(1234 + variation); actual = migrated[name](...args); }
      finally { Math.random = originalRandom; }
      const actualHash = digest({result: actual, weights: actual.activeWeights ? [...actual.activeWeights] : null});
      if (record) {
        referenceMath.random = seed(1234 + variation);
        const expected = legacy[name](...args);
        const expectedHash = digest({result: expected, weights: expected.activeWeights ? [...expected.activeWeights] : null});
        assert.equal(actualHash, expectedHash, name + " preserves the legacy result"); expectedHashes.push(expectedHash);
      } else assert.equal(actualHash, expectedHashes[comparisons], name + " preserves the recorded legacy result at case " + comparisons);
      comparisons++;
    }
  }
}
migrated.rememberCategory("FEMALE", "performance");
assert.equal(migrated.preferredCategoryId(migrated.settingsFromConfiguration({}), "FEMALE"), "performance");
const settings = migrated.settingsFromConfiguration({});
migrated.applyRatingIndex({revision: 10, states: {"1": {revision: 10, pools: {"appearance|FEMALE":
  {rating: 1300, deviation: 75, volatility: 0.06, matches: 10}}}}});
migrated.applyRatingIndex({revision: 9, states: {}});
assert.equal(migrated.poolFor(people[0], "appearance", "FEMALE", settings).rating, 1300,
  "a delayed load cannot erase a newer vote or lower the index revision");
assert.equal(migrated.getRatingIndexRevision(), 10);
assert.equal(comparisons, expectedHashes.length);
if (record) fs.writeFileSync(fixturePath, JSON.stringify({reference: "DirtyRank 0.7.68 before its TS/TSX port; 15 configurations × 3 rating states × 9 operations; seed 1234 + state", hashes: expectedHashes}, null, 2) + "\n");
console.log("Rank typed domain parity: " + comparisons + " seeded comparisons, settings, storage selection and stale revisions passed");
