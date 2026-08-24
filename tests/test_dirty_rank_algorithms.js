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
    graphql: noop,
    runPluginOperation: function () { return Promise.resolve({ version: 2, revision: 0, states: {} }); },
    react: {},
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

require(path.join(__dirname, "..", "plugins", "DirtyRank", "dirtyRank.js"));

const algorithms = global.window.__dirtyRankPlugin.algorithms;
const baseSettings = algorithms.settingsFromConfiguration({});
const category = { id: "appearance", name: "Appearance", enabled: true, weight: 1 };
const ratingStates = {};

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

console.log("DirtyRank information-gain algorithm tests passed");
