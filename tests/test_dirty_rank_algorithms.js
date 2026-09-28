"use strict";

const assert = require("assert");
const path = require("path");

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

const htm = require("../plugins/DirtyPlugins/vendor/htm.umd.js");
const noop = function () {};
const React = {
  Fragment: "fragment",
  createElement: noop,
  isValidElement: function () { return false; },
  useCallback: function (value) { return value; },
  useEffect: noop,
  useMemo: function (factory) { return factory(); },
  useRef: function (value) { return { current: value }; },
  useState: function (value) { return [typeof value === "function" ? value() : value, noop]; },
};

global.window = {
  DirtyPlugins: {
    getPluginSettings: function () { return Promise.resolve({}); },
    graphql: function () { return Promise.resolve({ findPerformers: { performers: [] } }); },
    runPluginOperation: function () { return Promise.resolve({ version: 2, revision: 0, states: {} }); },
    react: { html: htm.bind(noop) },
    registerSettingsPanel: noop,
    values: {
      asObject: function (value) { return value && typeof value === "object" ? value : {}; },
      coerceBoolean: function (value, fallback) { return typeof value === "boolean" ? value : fallback; },
      parseMaybeJson: parseMaybeJson,
    },
  },
  PluginApi: {
    React: React,
    libraries: {
      Intl: { useIntl: function () { return { messages: {} }; } },
      ReactRouterDOM: { NavLink: noop },
    },
    patch: { after: noop, before: noop, instead: noop },
    register: { route: noop },
  },
  addEventListener: noop,
  location: { pathname: "/plugins/dirty-rank" },
};

require(path.join(__dirname, "..", "plugins", "DirtyRank", "dirtyRankSettings.js"));
require(path.join(__dirname, "..", "plugins", "DirtyRank", "dirtyRankRating.js"));
require(path.join(__dirname, "..", "plugins", "DirtyRank", "dirtyRankMatchmaking.js"));
require(path.join(__dirname, "..", "plugins", "DirtyRank", "dirtyRank.js"));

const algorithms = global.window.__dirtyRankPlugin.algorithms;
const baseSettings = algorithms.settingsFromConfiguration({});
const category = { id: "appearance", name: "Appearance", enabled: true, weight: 1 };
const ratingStates = {};

{
  const presets = algorithms.ratingPresets;
  assert.strictEqual(presets.map(preset => preset.name).join(","), "Default,Chess,Confident,Extremely confident");
  assert.strictEqual(algorithms.ratingPresetFor(baseSettings), presets[0], "the original settings are recognized as Default without changing values");
  assert.deepStrictEqual(presets[0].settings, { initialRating: 1000, initialDeviation: 350, initialVolatility: 0.06,
    deviationFloor: 30, provisionalDeviation: 100, evidenceWeight: 2, avoidRepeatWindow: 12, calibrationPercent: 10, tau: 0.5 });
  const chess = presets.find(preset => preset.id === "chess").settings;
  assert.deepStrictEqual([chess.initialRating, chess.initialDeviation, chess.initialVolatility,
    chess.deviationFloor, chess.provisionalDeviation, chess.tau, chess.evidenceWeight],
  [1500, 500, 0.09, 45, 110, 0.75, 1], "Chess matches Lichess core parameters");
  const estimates = {};
  presets.forEach(preset => {
    const selected = algorithms.settingsFromConfiguration(preset.settings);
    assert.strictEqual(algorithms.ratingPresetFor(selected), preset);
    assert.strictEqual(algorithms.ratingPresetFor(Object.assign({}, selected, { hideBattleStandings: true })), preset,
      "presentation settings do not change the selected rating preset");
    assert.strictEqual(algorithms.ratingPresetFor(Object.assign({}, selected, { tau: 0.42 })), null,
      "manual parameter changes return to Custom");
    const initial = Object.assign(pool(selected.initialRating, selected.initialDeviation, 0), { volatility: selected.initialVolatility });
    estimates[preset.id] = algorithms.estimatedMatchesToConfidence(initial, selected.provisionalDeviation, initial, selected);
  });
  assert(estimates["extremely-confident"] < estimates.confident && estimates.confident < estimates.chess, "stronger presets predict fewer informative battles");
  assert.strictEqual(estimates.default, estimates.confident, "Default and Confident share rating evidence and differ in matchmaking controls");
  assert.deepStrictEqual(presets.map(preset => [preset.settings.evidenceWeight, preset.settings.avoidRepeatWindow,
    preset.settings.calibrationPercent, preset.settings.tau]), [[2, 12, 10, 0.5], [1, 12, 10, 0.75], [2, 24, 5, 0.5], [3, 48, 0, 0.3]]);
}

{
  const mixedSettings = algorithms.settingsFromConfiguration({ genderBoxes: [
    { id: "BOX-1", name: "Shared", genders: ["male", "FEMALE", "NON_BINARY", "MALE", "UNKNOWN"] },
  ], categories: { "BOX-1": [
    { name: "Appearance" },
    { name: "Performance" },
  ] } });
  const mixed = mixedSettings.categoriesByCohort["BOX-1"][0];
  assert.strictEqual(mixedSettings.genderBoxes[0].genders.join(","), "FEMALE,MALE,NON_BINARY", "genders are normalized, ordered, and deduplicated");
  assert.strictEqual(baseSettings.genderBoxes.find(box => box.id === "MALE").genders.join(","), "MALE", "legacy groups become boxes with the same gender and ID");
  const people = ["FEMALE", "MALE", "NON_BINARY", "TRANSGENDER_FEMALE"].map((gender, index) => ({
    id: "mixed-" + index, gender, name: gender, image_path: "/portrait.svg",
  }));
  algorithms.applyRatingIndex({ revision: 1, states: Object.fromEntries(people.map((person, index) => [person.id, { pools: {
    "appearance|BOX-1": pool(1000 + index * 100, 75, 10),
    "appearance|MALE": pool(3000, 75, 40),
  } }])) });
  algorithms.setOverallReferencePerformers(people);
  const board = algorithms.leaderboardData(people, "appearance", "BOX-1", mixedSettings);
  assert.strictEqual(board.eligible, 3, "mixed standings include every selected gender");
  assert.strictEqual(board.ranked.map(person => person.gender).join(","), "NON_BINARY,MALE,FEMALE");
  assert.strictEqual(algorithms.sortPerformersByOverall(people, "DESC", mixedSettings).map(person => person.gender).join(","), "NON_BINARY,MALE,FEMALE,TRANSGENDER_FEMALE", "native performer sorting uses the shared box and keeps unrated outsiders last");
  assert.strictEqual(algorithms.leaderboardPoolFor(people[1], "appearance", "BOX-1", mixedSettings).rating, 1100, "members share the box pool rather than borrowing ratings from another box");
  assert.strictEqual(algorithms.leaderboardPoolFor(people[1], "__overall__", "BOX-1", mixedSettings).totalCategories, 2, "all members share the box's categories");
  assert.strictEqual(algorithms.categoryConfidence(people, mixed, "BOX-1", mixedSettings).eligible, 3, "refinement estimates cover the entire box");
  for (const pair of [
    algorithms.selectPair(people.slice(0, 2), mixed, "BOX-1", mixedSettings, []).pair,
    algorithms.selectKingsStartingPair(people.slice(0, 2), mixed, "BOX-1", mixedSettings).pair,
    algorithms.selectGauntletPair(people, people[1], mixed, "BOX-1", mixedSettings, []).pair,
  ]) {
    assert.strictEqual(pair.length, 2);
    assert.notStrictEqual(pair[0].gender, pair[1].gender, "all battle modes allow comparisons across selected genders");
  }
  const singleSettings = algorithms.settingsFromConfiguration({ genderBoxes: [{ id: "BOX-1", name: "Renamed", genders: ["FEMALE"] }] });
  assert.strictEqual(algorithms.leaderboardData(people, "appearance", "BOX-1", singleSettings).eligible, 1, "removing a gender hides it without erasing its rating");
  assert.strictEqual(algorithms.leaderboardData(people, "appearance", "BOX-1", mixedSettings).ranked.length, 3, "selecting it again restores its standings");
  assert.strictEqual(algorithms.battleCategoryPath("appearance", true, "", "BOX-1"), "/plugins/dirty-rank/category/appearance/king-of-the-hill?box=BOX-1");
  assert.strictEqual(algorithms.battleCategoryPath("appearance", false, people[1].id, "BOX-1"), "/plugins/dirty-rank/gauntlet/mixed-1/appearance?box=BOX-1");
  algorithms.setOverallReferencePerformers([]);
  algorithms.applyRatingIndex({ revision: 1, states: {} });
}

function pool(rating, deviation, matches) {
  return {
    rating: rating,
    deviation: deviation,
    volatility: 0.06,
    matches: matches,
    wins: 0,
    losses: 0,
    draws: 0,
  };
}

function performer(id, rating, deviation, matches) {
  ratingStates[String(id)] = {
    version: 2,
    revision: 1,
    pools: { "appearance|FEMALE": pool(rating, deviation, matches) },
  };
  algorithms.applyRatingIndex({ revision: 1, states: ratingStates });
  return {
    id: String(id),
    name: "Performer " + id,
    gender: "FEMALE",
    image_path: "/performer/" + id + "/image",
    scene_count: 1,
  };
}

{
  const uncertain = pool(1000, 350, 0);
  const close = pool(1000, 50, 20);
  const far = pool(1800, 50, 20);
  const closeResult = algorithms.expectedDeviationAfterBattle(uncertain, close, baseSettings);
  const farResult = algorithms.expectedDeviationAfterBattle(uncertain, far, baseSettings);
  const standardResult = algorithms.expectedDeviationAfterBattle(uncertain, close, Object.assign({}, baseSettings, { evidenceWeight: 1 }));

  assert(closeResult < uncertain.deviation, "an informative battle must lower expected deviation");
  assert(closeResult < farResult, "a close opponent must provide more information than an implausible result");
  assert(closeResult < standardResult, "the default evidence multiplier must reduce expected deviation more than standard Glicko-2");
}

{
  const left = pool(1000, 200, 5);
  const right = pool(1000, 200, 5);
  const before = algorithms.estimatedMatchesToConfidence(left, 100, right, baseSettings);
  const nextLeft = Object.assign({}, left, {
    deviation: algorithms.expectedDeviationAfterBattle(left, right, baseSettings),
    matches: left.matches + 1,
  });
  const nextRight = Object.assign({}, right, {
    deviation: algorithms.expectedDeviationAfterBattle(right, left, baseSettings),
    matches: right.matches + 1,
  });
  const after = algorithms.estimatedMatchesToConfidence(nextLeft, 100, nextRight, baseSettings);

  assert.strictEqual(before - after, 1, "one simulated physical battle must consume one estimated battle");
}

{
  const refinedClosePerformers = [
    performer(21, 1030, 80, 20),
    performer(22, 1000, 80, 20),
    performer(23, 970, 80, 20),
  ];
  const refinedRanking = algorithms.categoryConfidence(
    refinedClosePerformers,
    category,
    "FEMALE",
    Object.assign({}, baseSettings, { confidenceGoal: "ranking" })
  );

  assert.strictEqual(refinedRanking.refined, 3);
  assert.strictEqual(refinedRanking.established, 2, "overlapping refined ratings must establish tie boundaries");
  assert.strictEqual(refinedRanking.remainingBattles, 0, "an all-refined leaderboard must not remain permanently unfinished");
  assert.strictEqual(refinedRanking.progress, 100);
}

{
  const performers = [
    performer(1, 1600, 40, 20),
    performer(2, 1500, 40, 20),
    performer(3, 900, 150, 1),
    performer(4, 900, 150, 1),
    performer(5, 900, 150, 1),
    performer(6, 900, 150, 1),
  ];
  const topSettings = Object.assign({}, baseSettings, { confidenceGoal: "top", confidenceTopN: 2 });
  const allSettings = Object.assign({}, baseSettings, { confidenceGoal: "all" });
  const rankingSettings = Object.assign({}, baseSettings, { confidenceGoal: "ranking" });
  const top = algorithms.categoryConfidence(performers, category, "FEMALE", topSettings);
  const all = algorithms.categoryConfidence(performers, category, "FEMALE", allSettings);
  const ranking = algorithms.categoryConfidence(performers, category, "FEMALE", rankingSettings);

  assert.strictEqual(top.remainingBattles, 0, "clear top performers should not require lower-table refinement");
  assert(all.remainingBattles > 0, "all-performer mode must refine every high-deviation rating");
  assert(ranking.remainingBattles > 0, "ranking mode must refine unresolved lower-table ties");
  assert.strictEqual(ranking.refined, 2, "rating precision must be reported separately from order confidence");
  assert.strictEqual(
    ranking.progress,
    ranking.completedBattles / (ranking.completedBattles + ranking.remainingBattles) * 100,
    "confidence percentage must be completed battles divided by completed plus expected battles"
  );
}

{
  const performers = [
    performer(1, 1000, 350, 0),
    performer(2, 1000, 45, 20),
    performer(3, 1300, 45, 20),
  ];
  const settings = Object.assign({}, baseSettings, { confidenceGoal: "all", calibrationPercent: 0 });
  const originalRandom = Math.random;
  Math.random = function () { return 0.5; };
  const selected = algorithms.selectPair(performers, category, "FEMALE", settings, []);
  Math.random = originalRandom;

  assert(selected.pair.some(function (item) { return item.id === "1"; }), "the optimizer must include the only uncertain performer");
  assert(selected.expectedRdReduction > 0, "the selected pair must report expected uncertainty reduction");
}

{
  const performers = [
    performer(1, 1000, 350, 0),
    performer(2, 1000, 45, 20),
    performer(3, 1400, 45, 20),
  ];
  const settings = Object.assign({}, baseSettings, { calibrationPercent: 0 });
  const originalRandom = Math.random;
  Math.random = function () { return 0.5; };
  const selected = algorithms.selectGauntletPair(performers, performers[0], category, "FEMALE", settings, []);
  Math.random = originalRandom;

  assert.strictEqual(selected.pair[0].id, "1", "Gauntlet must keep the target performer fixed on the left");
  assert.notStrictEqual(selected.pair[1].id, "1", "Gauntlet must select a different opponent");
  assert(selected.expectedRdReduction > 0, "Gauntlet must report the target's expected RD reduction");
}

{
  const performers = [
    performer(11, 1000, 300, 1),
    performer(12, 1000, 300, 1),
    performer(13, 1000, 300, 1),
  ];
  const settings = Object.assign({}, baseSettings, { calibrationPercent: 0 });
  const leftWinner = algorithms.selectKingsPair(performers, performers[0], "left", ["12"], category, "FEMALE", settings);
  const rightWinner = algorithms.selectKingsPair(performers, performers[0], "right", ["12"], category, "FEMALE", settings);
  assert.deepStrictEqual(leftWinner.pair.map(function (item) { return item.id; }), ["11", "13"], "left winner stays while the defeated challenger leaves");
  assert.deepStrictEqual(rightWinner.pair.map(function (item) { return item.id; }), ["13", "11"], "right winner stays on the right");
  assert.strictEqual(rightWinner.incumbentId, "11");
  assert.strictEqual(leftWinner.incumbentSide, "left");
  assert.strictEqual(rightWinner.incumbentSide, "right");
  const lastChallenger = algorithms.selectKingsPair(performers.slice(0, 2), performers[0], "left", ["12"], category, "FEMALE", settings);
  assert.strictEqual(lastChallenger.pair, null, "a two-person hill ends after its sole challenger loses");
  const largerPool = performers.concat([performer(14, 1000, 300, 1), performer(15, 1000, 300, 1)]);
  const laterRound = algorithms.selectKingsPair(largerPool, performers[0], "left", ["12", "13", "14"], category, "FEMALE", settings);
  assert.deepStrictEqual(laterRound.pair.map(function (item) { return item.id; }), ["11", "15"], "all previous losers stay out of later rounds");
  assert.strictEqual(laterRound.eligible, 5, "rank and eligible count still cover the full pool");
}

{
  const performers = [
    performer(21, 1700, 100, 10),
    performer(22, 1600, 100, 10),
    performer(23, 1500, 100, 10),
    performer(24, 1400, 100, 10),
    performer(25, 1300, 100, 10),
    performer(26, 1200, 100, 10),
  ];
  const originalRandom = Math.random;
  try {
    Math.random = () => 0;
    const opening = algorithms.selectKingsStartingPair(performers, category, "FEMALE", baseSettings);
    assert.deepStrictEqual(opening.pair.map(item => item.id), ["26", "25"], "Kings starts with the lowest-ranked performers");
    assert.strictEqual(opening.ranks["26"], 6, "Kings uses the current global ranking");
    const next = algorithms.selectKingsPair(performers, performers[5], "left", ["25"], category, "FEMALE", baseSettings);
    assert.deepStrictEqual(next.pair.map(item => item.id), ["26", "24"], "the challenger climbs to the next available rank");

    Math.random = () => 0.99;
    const variedOpening = algorithms.selectKingsStartingPair(performers, category, "FEMALE", baseSettings);
    assert(variedOpening.pair.every(item => ["24", "25", "26"].includes(item.id)), "opening variation stays near the bottom");
    const variedNext = algorithms.selectKingsPair(performers, performers[5], "left", ["25"], category, "FEMALE", baseSettings);
    assert.strictEqual(variedNext.pair[1].id, "22", "a challenger can vary within the next three available ranks");

    Math.random = () => 0;
    const unrated = performers.concat([performer(27, 1500, 350, 0), performer(28, 1500, 350, 0)]);
    const unratedOpening = algorithms.selectKingsStartingPair(unrated, category, "FEMALE", baseSettings);
    assert(unratedOpening.pair.every(item => ["27", "28"].includes(item.id)), "unrated performers enter before the established ranking");
  } finally {
    Math.random = originalRandom;
  }
}

{
  const performers = [
    performer(41, 1000, 350, 0),
    performer(42, 1000, 300, 0),
    performer(43, 1000, 45, 20),
    performer(44, 1400, 45, 20),
  ];
  const settings = Object.assign({}, baseSettings, {
    avoidRepeatWindow: 0,
    calibrationPercent: 0,
    confidenceGoal: "all",
  });
  const originalRandom = Math.random;
  Math.random = function () { return 0.5; };
  const baseline = algorithms.selectPair(performers, category, "FEMALE", settings, []);
  const baselineToken = baseline.pair.map(function (item) { return item.id; }).sort().join(":");
  const recalled = algorithms.selectPair(
    performers, category, "FEMALE", settings, [baselineToken]
  );
  const penalized = algorithms.selectPair(
    performers, category, "FEMALE",
    Object.assign({}, settings, { avoidRepeatWindow: 1 }), [baselineToken]
  );
  Math.random = originalRandom;

  assert.strictEqual(
    recalled.pair.map(function (item) { return item.id; }).sort().join(":"),
    baselineToken,
    "avoidRepeatWindow 0 must disable the repeat penalty for selectPair"
  );
  assert.notStrictEqual(
    penalized.pair.map(function (item) { return item.id; }).sort().join(":"),
    baselineToken,
    "a positive avoidRepeatWindow must penalize the remembered selectPair pair"
  );
}

{
  const performers = [
    performer(51, 1000, 350, 0),
    performer(52, 1000, 45, 20),
    performer(53, 1100, 45, 20),
  ];
  const settings = Object.assign({}, baseSettings, {
    avoidRepeatWindow: 0,
    calibrationPercent: 0,
  });
  const originalRandom = Math.random;
  Math.random = function () { return 0.5; };
  const baseline = algorithms.selectGauntletPair(
    performers, performers[0], category, "FEMALE", settings, []
  );
  const baselineToken = [baseline.pair[0].id, baseline.pair[1].id].sort().join(":");
  const recalled = algorithms.selectGauntletPair(
    performers, performers[0], category, "FEMALE", settings, [baselineToken]
  );
  const penalized = algorithms.selectGauntletPair(
    performers, performers[0], category, "FEMALE",
    Object.assign({}, settings, { avoidRepeatWindow: 1 }), [baselineToken]
  );
  Math.random = originalRandom;

  assert.strictEqual(
    [recalled.pair[0].id, recalled.pair[1].id].sort().join(":"),
    baselineToken,
    "avoidRepeatWindow 0 must disable the repeat penalty for the gauntlet"
  );
  assert.notStrictEqual(
    [penalized.pair[0].id, penalized.pair[1].id].sort().join(":"),
    baselineToken,
    "a positive avoidRepeatWindow must penalize the remembered gauntlet pair"
  );
}

{
  const performers = [
    performer(1, 1300, 40, 12),
    performer(2, 1100, 80, 10),
    performer(3, 900, 140, 8),
  ];
  const board = algorithms.leaderboardData(performers, "appearance", "FEMALE", baseSettings);

  assert.deepStrictEqual(board.ranked.map(function (item) { return item.id; }), ["1", "2", "3"]);
  assert.strictEqual(board.stats.completedBattles, 15);
  assert.strictEqual(board.stats.stable, 2);
  assert.strictEqual(board.stats.refined, 1);
  assert.strictEqual(board.stats.excellent, 1);
  assert.strictEqual(Math.round(board.stats.ratingSpread), 400);
  assert.strictEqual(algorithms.precisionTier({ matches: 8, deviation: 140 }, baseSettings).id, "provisional");
  assert.strictEqual(algorithms.precisionTier({ matches: 8, deviation: 80 }, baseSettings).id, "refined");
  assert.strictEqual(algorithms.precisionTier({ matches: 8, deviation: 40 }, baseSettings).id, "excellent");
}

{
  // A slow loadAll response must not erase state written by a newer vote.
  algorithms.applyRatingIndex({
    revision: 5,
    states: { "1": { version: 2, revision: 5, pools: { "appearance|FEMALE": pool(1500, 100, 10) } } },
  });
  algorithms.applyRatingIndex({
    revision: 2,
    states: { "1": { version: 2, revision: 2, pools: { "appearance|FEMALE": pool(900, 300, 1) } } },
  });
  const staleTarget = {
    id: "1",
    name: "Performer 1",
    gender: "FEMALE",
    image_path: "/performer/1/image",
  };
  const stalePool = algorithms.leaderboardPoolFor(staleTarget, "appearance", "FEMALE", baseSettings);
  assert.strictEqual(stalePool.rating, 1500, "a stale rating index response must be ignored");
  assert.strictEqual(stalePool.matches, 10, "stale pools must not overwrite newer matches");

  // A newer response still applies.
  algorithms.applyRatingIndex({
    revision: 6,
    states: { "1": { version: 2, revision: 6, pools: { "appearance|FEMALE": pool(1600, 90, 11) } } },
  });
  assert.strictEqual(
    algorithms.leaderboardPoolFor(staleTarget, "appearance", "FEMALE", baseSettings).rating,
    1600,
    "a newer rating index response must apply"
  );
}

{
  const settings = algorithms.settingsFromConfiguration({ categories: { FEMALE: [
    { name: "Appearance", enabled: true, weight: 1 },
    { name: "Performance", enabled: true, weight: 1 },
    { name: "Ignored", enabled: false, weight: 1000 },
  ] } });
  const performers = ["a", "b", "c", "d", "unrated"].map(id => ({ id, name: id, gender: "FEMALE", image_path: "/portrait.svg" }));
  const states = {};
  [[3000, 1000], [1500, 1500], [1400, 1400], [1000, 2000]].forEach((ratings, i) => {
    states[performers[i].id] = { pools: {
      "appearance|FEMALE": pool(ratings[0], 50, 10),
      "performance|FEMALE": pool(ratings[1], 50, 10),
      "ignored|FEMALE": pool(1000000, 50, 10),
    } };
  });
  states.deleted = { pools: { "appearance|FEMALE": pool(1000000, 50, 10) } };
  states.male = { pools: { "appearance|MALE": pool(1000000, 50, 10) } };
  states.changed = { pools: { "appearance|FEMALE": pool(1000000, 50, 10) } };
  algorithms.setOverallReferencePerformers(performers.concat([{ id: "male", gender: "MALE" }, { id: "changed", gender: "MALE" }]));
  algorithms.applyRatingIndex({ revision: 7, states });
  const overall = performer => algorithms.leaderboardPoolFor(performer, "__overall__", "FEMALE", settings);
  const a = overall(performers[0]);
  const b = overall(performers[1]);
  assert(b.rating > a.rating, "consistent second places must beat a huge rating in one category and last place in another");
  assert.strictEqual(b.ratedCategories, 2);
  assert.strictEqual(b.totalCategories, 2, "disabled categories must not contribute");
  assert.strictEqual(b.precision.id, "excellent");
  assert.strictEqual(algorithms.leaderboardPoolFor(performers[0], "appearance", "FEMALE", settings).rating, 3000,
    "normalizing the overall score must preserve category Glicko ratings");
  const appearance = algorithms.overallCategoryScoreFor(performers[0], "appearance", "FEMALE", settings);
  const performance = algorithms.overallCategoryScoreFor(performers[3], "performance", "FEMALE", settings);
  assert.strictEqual(appearance.position, 100, "deleted performers and outdated cohort pools must not affect percentiles");
  assert.strictEqual(performance.position, 100);
  assert(appearance.rating > performance.rating, "a greater lead must still earn a small bonus");
  assert(appearance.rating - performance.rating < 20, "equal positions must have a bounded strength bonus");
  performers.forEach(performer => assert(overall(performer).rating >= 0 && overall(performer).rating <= 100));
  assert.strictEqual(overall(performers[4]).rating, 50);
  assert.strictEqual(overall(performers[4]).precision.id, "provisional");
  const ranked = algorithms.leaderboardData(performers, "__overall__", "FEMALE", settings).ranked;
  const sorted = algorithms.sortPerformersByOverall(performers, "DESC", settings);
  assert.deepStrictEqual(sorted.slice(0, 4).map(p => p.id), ranked.map(p => p.id), "native sort and leaderboard must agree");
  assert.strictEqual(sorted[4].id, "unrated", "unrated performers remain last even with neutral scores");
  assert.strictEqual(algorithms.sortPerformersByOverall(performers, "ASC", settings)[4].id, "unrated");
  const beforeFilter = b.rating;
  algorithms.leaderboardData([performers[1]], "__overall__", "FEMALE", settings);
  algorithms.sortPerformersByOverall([performers[1]], "DESC", settings);
  assert.strictEqual(overall(performers[1]).rating, beforeFilter, "filtered subsets must not change normalization");

  const weighted = algorithms.settingsFromConfiguration({ categories: { FEMALE: [
    { name: "Appearance", enabled: true, weight: 3 },
    { name: "Performance", enabled: true, weight: 1 },
  ] } });
  const weightedA = algorithms.leaderboardPoolFor(performers[0], "__overall__", "FEMALE", weighted);
  const weakA = algorithms.overallCategoryScoreFor(performers[0], "performance", "FEMALE", settings);
  assert(Math.abs(weightedA.rating - (appearance.rating * 3 + weakA.rating) / 4) < 1e-10,
    "configured category weights must apply after normalization");

  const nextStates = Object.assign({}, states, { b: { pools: {
    "appearance|FEMALE": pool(3500, 50, 11),
    "performance|FEMALE": pool(1500, 50, 10),
  } } });
  algorithms.applyRatingIndex({ revision: 8, states: nextStates });
  assert.notStrictEqual(overall(performers[1]).rating, beforeFilter, "new rating data must invalidate normalized scores");
  const afterUpdate = overall(performers[1]).rating;
  algorithms.applyRatingIndex({ revision: 7, states });
  assert.strictEqual(overall(performers[1]).rating, afterUpdate, "stale loads must not invalidate the newer scores");
  algorithms.applyRatingIndex({ revision: 9, states });
  assert.strictEqual(overall(performers[1]).rating, beforeFilter, "undo must restore the earlier normalized score");
}

{
  const settings = algorithms.settingsFromConfiguration({ categories: { FEMALE: [
    { name: "Appearance", enabled: true, weight: 1 },
    { name: "Performance", enabled: true, weight: 1 },
  ] } });
  const performers = ["top", "bottom", "missing"].map(id => ({ id, name: id, gender: "FEMALE", image_path: "/portrait.svg" }));
  algorithms.setOverallReferencePerformers(performers);
  let revision = 10;
  const load = (top, bottom) => algorithms.applyRatingIndex({ revision: revision++, states: {
    top: { pools: { "appearance|FEMALE": pool(top, 50, 10) } },
    bottom: { pools: { "appearance|FEMALE": pool(bottom, 300, 1) } },
    missing: { pools: { "appearance|FEMALE": pool(1000000, 350, 0) } },
  } });
  const score = id => algorithms.overallCategoryScoreFor({ id }, "appearance", "FEMALE", settings);
  load(1400, 1000);
  assert.strictEqual(score("top").position, 100);
  assert(Math.abs(score("top").strength - 100 * 10 / 11) < 1e-5, "strength must exclude self and use the logistic rating gap");
  assert.strictEqual(score("bottom").position, 0);
  assert(Math.abs(score("top").rating + score("bottom").rating - 100) < 1e-10, "pairwise scores must be symmetric despite different RD");
  const original = score("top").rating;
  load(-600, -1000);
  assert.strictEqual(score("top").rating, original, "moving the arbitrary rating origin must not affect scores");
  const partial = algorithms.leaderboardPoolFor(performers[0], "__overall__", "FEMALE", settings);
  assert.strictEqual(partial.rating, (original + 50) / 2, "missing categories must contribute neutral 50, not be omitted");
  assert.strictEqual(partial.ratedCategories, 1);
  assert.strictEqual(partial.totalCategories, 2);
  assert.strictEqual(partial.precision.id, "provisional", "incomplete category coverage must stay provisional");
  load(1000, 1000);
  assert.strictEqual(score("top").rating, 50, "ties must share the middle position and strength");
  assert.strictEqual(score("bottom").rating, 50);
  load(1000000, -1000000);
  assert.strictEqual(score("top").rating, 100, "extreme ratings must saturate without NaN or unbounded scores");
  assert.strictEqual(score("bottom").rating, 0);
  const cached = score("top");
  assert.strictEqual(score("top"), cached, "unchanged pools should reuse cached scores");
  algorithms.setOverallReferencePerformers([performers[0]]);
  assert.strictEqual(score("top").rating, 50, "a singleton pool has no comparison evidence");
  const emptySettings = Object.assign({}, settings, { categories: { FEMALE: [] } });
  assert.strictEqual(algorithms.leaderboardPoolFor(performers[0], "__overall__", "FEMALE", emptySettings).rating, 50);
}

{
  const malePerformers = Array.from({ length: 300 }, (_, index) => ({
    id: "male-refinement-" + index, name: "Male " + index, gender: "MALE",
    image_path: "/synthetic.svg", scene_count: 1,
  }));
  const maleSettings = Object.assign({}, baseSettings, { confidenceGoal: "all", enabledCohorts: ["MALE"] });
  const cohort = algorithms.categoryConfidence(malePerformers, category, "MALE", maleSettings);
  assert.strictEqual(cohort.eligible, 300);
  assert.strictEqual(cohort.refined, 0);
  assert(cohort.remainingBattles >= 150, "300 unrated performers cannot be refined in eight cohort-wide battles");
  const perPerformer = algorithms.estimatedMatchesToConfidence(pool(1000, 350, 0), maleSettings.provisionalDeviation, pool(1000, 350, 1), maleSettings);
  assert.strictEqual(cohort.remainingBattles, Math.ceil(300 * perPerformer / 2), "each physical battle contributes to two performer ratings");
  const maleStates = Object.fromEntries(malePerformers.map(person => [person.id, { pools: { "appearance|MALE": pool(1000, 75, 10) } }]));
  maleStates[malePerformers[0].id].pools["appearance|MALE"] = pool(1000, 250, 1);
  algorithms.applyRatingIndex({ revision: 1000, states: maleStates });
  const singleRemaining = algorithms.categoryConfidence(malePerformers, category, "MALE", maleSettings);
  assert.strictEqual(singleRemaining.refined, 299);
  const targetBattles = algorithms.estimatedMatchesToConfidence(pool(1000, 250, 1), 100, pool(1000, 75, 1), maleSettings);
  assert.strictEqual(singleRemaining.remainingBattles, targetBattles, "one remaining performer cannot participate twice in the same battle");
}

{
  const estimate = algorithms.freshCategoryBattleEstimate;
  const presets = algorithms.ratingPresets;
  const defaults = presets.find(preset => preset.name === "Default").settings;
  const normal = estimate(300, defaults);
  const perPerson = algorithms.estimatedMatchesToConfidence(
    { rating: defaults.initialRating, deviation: defaults.initialDeviation, volatility: defaults.initialVolatility, matches: 0 },
    defaults.provisionalDeviation, null, algorithms.settingsFromConfiguration(defaults));
  assert.strictEqual(normal.battles, Math.ceil(300 * perPerson / 2), "fresh estimates account for both battle participants");
  assert.strictEqual(estimate(301, defaults).battles, Math.ceil(301 * perPerson / 2));
  assert.strictEqual(estimate(0, defaults).battles, 0);
  assert.strictEqual(estimate(1, defaults).battles, 0, "one performer cannot battle alone");
  assert(estimate(300, presets.find(preset => preset.name === "Chess").settings).battles > normal.battles);
  assert(estimate(300, presets.find(preset => preset.name === "Extremely confident").settings).battles < normal.battles);
  assert(estimate(300, { ...defaults, provisionalDeviation: 70 }).battles > normal.battles, "stricter refinement requires more battles");
  assert.strictEqual(estimate(300, { ...defaults, initialRating: 2000 }).battles, normal.battles, "a common rating offset does not invent extra uncertainty");
  assert.strictEqual(estimate(300, { ...defaults, initialVolatility: 1, provisionalDeviation: 30 }).capped, true, "unreachable refinement is marked as a lower bound");
}


{
  const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-9, message);
  const definitions = { FEMALE: [
    { name: "Appearance", weight: 3 }, { name: "Performance", weight: 1 },
    { name: "Disabled", enabled: false, weight: 1000 },
  ] };
  const settingsFor = (strategy, extra) => algorithms.settingsFromConfiguration(Object.assign({
    categories: definitions, overallScoreStrategy: strategy,
  }, extra));
  const people = Array.from({ length: 7 }, (_, index) => ({
    id: "strategy-" + index, name: "Strategy " + index, gender: "FEMALE", image_path: index === 0 ? "" : "/portrait.svg",
  }));
  const states = {};
  for (let i = 0; i < 6; i += 1) {
    states[people[i].id] = { pools: {
      "appearance|FEMALE": pool(i === 0 ? 2000 : 1000, 50, 10),
      "performance|FEMALE": pool(i === 0 ? 1000 : 2000, 75, 15),
      "disabled|FEMALE": pool(1000000, 50, 10),
    } };
  }
  states.deleted = { pools: { "appearance|FEMALE": pool(1000000, 50, 10) } };
  algorithms.setOverallReferencePerformers(people);
  algorithms.applyRatingIndex({ revision: 2000, states });
  const target = people[0];
  const categoryScore = (id, settings) => algorithms.overallCategoryScoreFor(target, id, "FEMALE", settings);
  const overall = (person, settings) => algorithms.leaderboardPoolFor(person, "__overall__", "FEMALE", settings).rating;
  const balanced = settingsFor("weighted");
  const a = categoryScore("appearance", balanced);
  const b = categoryScore("performance", balanced);
  near(overall(target, balanced), (3 * a.rating + b.rating) / 4);
  assert.strictEqual(settingsFor("unknown").overallScoreStrategy, "weighted", "unknown strategies fall back to the existing calculation");

  const powerSettings = settingsFor("power");
  assert.strictEqual(powerSettings.overallPower, 3);
  near(categoryScore("appearance", powerSettings).rating, a.rating, "power mean combines balanced scores without applying other strategies");
  const expectedPower = exponent => Math.pow((3 * Math.pow(a.rating, exponent) + Math.pow(b.rating, exponent)) / 4, 1 / exponent);
  near(overall(target, powerSettings), expectedPower(3), "power mean must respect weights and exclude disabled categories");
  assert.strictEqual(overall(target, settingsFor("power", { overallPower: 1 })), overall(target, balanced), "power 1 exactly preserves the current average");
  let previous = overall(target, balanced);
  for (const exponent of [2, 2.5, 3, 4]) {
    const value = overall(target, settingsFor("power", { overallPower: exponent }));
    near(value, expectedPower(exponent), "integer and fractional powers use the weighted power mean");
    assert(value >= previous && value <= a.rating + 1e-9, "higher powers increasingly emphasize strengths without exceeding the highest category score");
    previous = value;
  }
  assert.strictEqual(settingsFor("power", { overallPower: 0 }).overallPower, 1);
  assert.strictEqual(settingsFor("power", { overallPower: 99 }).overallPower, 4);
  assert.strictEqual(settingsFor("power", { overallPower: NaN }).overallPower, 3);

  for (const settings of [balanced, powerSettings]) {
    near(overall(people[6], settings), 50, "unrated categories remain neutral in every strategy");
    assert.strictEqual(algorithms.leaderboardPoolFor(target, "appearance", "FEMALE", settings).rating, 2000, "strategies never change category Glicko ratings");
    const visible = people.slice(1);
    const sorted = algorithms.sortPerformersByOverall(visible, "DESC", settings);
    const ranked = algorithms.leaderboardData(visible, "__overall__", "FEMALE", settings).ranked;
    assert.deepStrictEqual(sorted.slice(0, 5).map(p => p.id), ranked.map(p => p.id), "native sorting and the overall leaderboard use the same strategy");
    assert.strictEqual(sorted[5].id, people[6].id);
    assert.strictEqual(algorithms.sortPerformersByOverall(visible, "ASC", settings)[5].id, people[6].id, "unrated performers stay last in both sort directions");
    const before = overall(target, settings);
    algorithms.leaderboardData([people[1]], "__overall__", "FEMALE", settings);
    near(overall(target, settings), before, "page filters must not alter population metrics");
    const roundTrip = algorithms.settingsFromConfiguration(algorithms.serializedSettings(settings));
    for (const key of ["overallScoreStrategy", "overallPower"]) {
      assert.strictEqual(roundTrip[key], settings[key], key + " survives settings serialization");
    }
  }
  const shifted = {};
  for (const [id, state] of Object.entries(states)) {
    shifted[id] = { pools: Object.fromEntries(Object.entries(state.pools).map(([key, value]) => [
      key, Object.assign({}, value, { rating: value.rating + 5000 }),
    ])) };
  }
  const beforeShift = overall(target, powerSettings);
  algorithms.applyRatingIndex({ revision: 2001, states: shifted });
  near(overall(target, powerSettings), beforeShift, "power mean ignores the arbitrary Glicko rating origin");

  algorithms.setOverallReferencePerformers([target]);
  for (const strategy of ["weighted", "power"]) {
    near(overall(target, settingsFor(strategy)), 50, "singleton pools stay neutral");
  }
  algorithms.setOverallReferencePerformers(people);
  const tiedStates = {};
  people.slice(0, 6).forEach(person => { tiedStates[person.id] = { pools: {
    "appearance|FEMALE": pool(1200, 50, 10),
  } }; });
  algorithms.applyRatingIndex({ revision: 2002, states: tiedStates });
  for (const strategy of ["weighted", "power"]) {
    near(overall(target, settingsFor(strategy)), 50, "tied and missing categories stay neutral");
  }
  const oneCategory = Object.assign({}, balanced, { categoriesByCohort: { FEMALE: [{ name: "Appearance", id: "appearance", enabled: true, weight: 1 }] } });
  algorithms.applyRatingIndex({ revision: 2003, states });
  assert.notStrictEqual(overall(target, oneCategory), 50, "new ratings invalidate cached category scores");
  const onePowerCategory = Object.assign({}, oneCategory, { overallScoreStrategy: "power" });
  near(overall(target, onePowerCategory), a.rating, "one category keeps its original balanced score");
  const missingCategoryStates = JSON.parse(JSON.stringify(states));
  delete missingCategoryStates[target.id].pools["performance|FEMALE"];
  algorithms.applyRatingIndex({ revision: 2004, states: missingCategoryStates });
  near(overall(target, powerSettings), Math.pow((3 * Math.pow(a.rating, 3) + Math.pow(50, 3)) / 4, 1 / 3),
    "missing categories keep their neutral 50 contribution and weight");
  const extremes = {};
  people.slice(0, 6).forEach((person, index) => { extremes[person.id] = { pools: {
    "appearance|FEMALE": pool(index === 0 ? -1000000 : 1000000, 50, 10),
    "performance|FEMALE": pool(index === 0 ? -1000000 : 1000000, 50, 10),
  } }; });
  algorithms.applyRatingIndex({ revision: 2005, states: extremes });
  assert.strictEqual(overall(target, powerSettings), 0, "all-zero category scores stay zero without NaN");
  near(overall(people[1], powerSettings), algorithms.overallCategoryScoreFor(people[1], "appearance", "FEMALE", balanced).rating,
    "identical category scores are unchanged by the power mean");
  near(overall(target, Object.assign({}, powerSettings, { categoriesByCohort: { FEMALE: [] } })), 50, "empty category sets remain neutral");
}

console.log("DirtyRank information-gain and overall scoring algorithm tests passed");
