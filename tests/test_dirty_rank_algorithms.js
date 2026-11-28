"use strict";
const { requireRankDomain } = require("./rank_modules");
const { requireSource } = require("./plugin_paths");

const assert = require("assert");

const noop = function () {};
const registrations = [];
const record = function () {
  registrations.push(Array.from(arguments));
};
const React = {
  Fragment: "fragment",
  createElement: noop,
  isValidElement: function () {
    return false;
  },
  useCallback: function (value) {
    return value;
  },
  useEffect: noop,
  useMemo: function (factory) {
    return factory();
  },
  useRef: function (value) {
    return { current: value };
  },
  useState: function (value) {
    return [typeof value === "function" ? value() : value, noop];
  },
};

global.window = {
  DirtyPlugins: {
    getPluginSettings: function () {
      return Promise.resolve({});
    },
    graphql: function () {
      return Promise.resolve({ findPerformers: { performers: [] } });
    },
    runPluginOperation: function () {
      return Promise.resolve({ version: 2, revision: 0, states: {} });
    },
    react: {},
    registerSettingsPanel: noop,
  },
  PluginApi: {
    React: React,
    libraries: {
      Intl: {
        useIntl: function () {
          return { messages: {} };
        },
      },
      ReactRouterDOM: { NavLink: noop },
    },
    patch: { after: record, before: record, instead: record },
    register: { route: record },
  },
  addEventListener: record,
  location: { pathname: "/plugins/dirty-rank" },
};

const algorithms = { ...requireRankDomain() };
assert.strictEqual(
  global.window.__dirtyRankPlugin,
  undefined,
  "domain factories install no route, patch, listener or instance guard",
);
assert.deepStrictEqual(registrations, [], "import and construction own no host integrations");
const baseSettings = algorithms.settingsFromConfiguration({});
const category = { id: "appearance", name: "Appearance", enabled: true, weight: 1 };
const ratingStates = {};

{
  assert.deepStrictEqual(
    [baseSettings.initialRating, baseSettings.initialDeviation, baseSettings.evidenceWeight],
    [1000, 500, 1],
    "the battle fit starts from a wide prior and counts each vote once",
  );
  for (const retired of ["tau", "initialVolatility"]) {
    assert(!(retired in baseSettings), retired + " belonged to Glicko-2 and is gone");
  }
  assert.deepStrictEqual(
    Object.keys(algorithms.ratingParameters(baseSettings)),
    Array.from(algorithms.RATING_PARAMETER_KEYS),
    "Undo changes restores every advanced rating and matchmaking value",
  );
  const initial = pool(baseSettings.initialRating, baseSettings.initialDeviation, 0);
  const battlesAt = evidenceWeight =>
    algorithms.estimatedMatchesToConfidence(
      initial,
      baseSettings.provisionalDeviation,
      initial,
      Object.assign({}, baseSettings, { evidenceWeight }),
    );
  assert(battlesAt(2) < battlesAt(1) && battlesAt(1) < battlesAt(0.5), "more evidence per vote refines sooner");
}

{
  const mixedSettings = algorithms.settingsFromConfiguration({
    genderBoxes: [{ id: "BOX-1", name: "Shared", genders: ["male", "FEMALE", "NON_BINARY", "MALE", "UNKNOWN"] }],
    categories: { "BOX-1": [{ name: "Appearance" }, { name: "Performance" }] },
  });
  const mixed = mixedSettings.categoriesByCohort["BOX-1"][0];
  assert.strictEqual(
    mixedSettings.genderBoxes[0].genders.join(","),
    "FEMALE,MALE,NON_BINARY",
    "genders are normalized, ordered, and deduplicated",
  );
  assert.strictEqual(
    baseSettings.genderBoxes.find(box => box.id === "MALE").genders.join(","),
    "MALE",
    "default boxes cover one gender with the same ID",
  );
  const people = ["FEMALE", "MALE", "NON_BINARY", "TRANSGENDER_FEMALE"].map((gender, index) => ({
    id: "mixed-" + index,
    gender,
    name: gender,
    image_path: "/portrait.svg",
  }));
  algorithms.applyRatingIndex({
    revision: 1,
    states: Object.fromEntries(
      people.map((person, index) => [
        person.id,
        {
          pools: {
            "appearance|BOX-1": pool(1000 + index * 100, 75, 10),
            "appearance|MALE": pool(3000, 75, 40),
          },
        },
      ]),
    ),
  });
  algorithms.setOverallReferencePerformers(people);
  const board = algorithms.leaderboardData(people, "appearance", "BOX-1", mixedSettings);
  assert.strictEqual(board.eligible, 3, "mixed standings include every selected gender");
  assert.strictEqual(board.ranked.map(person => person.gender).join(","), "NON_BINARY,MALE,FEMALE");
  assert.strictEqual(
    algorithms
      .sortPerformersByOverall(people, "DESC", mixedSettings)
      .map(person => person.gender)
      .join(","),
    "NON_BINARY,MALE,FEMALE,TRANSGENDER_FEMALE",
    "native performer sorting uses the shared box and keeps unrated outsiders last",
  );
  assert.strictEqual(
    algorithms.leaderboardPoolFor(people[1], "appearance", "BOX-1", mixedSettings).rating,
    1100,
    "members share the box pool rather than borrowing ratings from another box",
  );
  assert.strictEqual(
    algorithms.leaderboardPoolFor(people[1], "__overall__", "BOX-1", mixedSettings).totalCategories,
    2,
    "all members share the box's categories",
  );
  assert.strictEqual(
    algorithms.categoryConfidence(people, mixed, "BOX-1", mixedSettings).eligible,
    3,
    "refinement estimates cover the entire box",
  );
  for (const pair of [
    algorithms.selectPair(people.slice(0, 2), mixed, "BOX-1", mixedSettings, null).pair,
    algorithms.selectGauntletPair(people, people[1], mixed, "BOX-1", mixedSettings, null).pair,
  ]) {
    assert.strictEqual(pair.length, 2);
    assert.notStrictEqual(pair[0].gender, pair[1].gender, "all battle modes allow comparisons across selected genders");
  }
  const singleSettings = algorithms.settingsFromConfiguration({
    genderBoxes: [{ id: "BOX-1", name: "Renamed", genders: ["FEMALE"] }],
  });
  assert.strictEqual(
    algorithms.leaderboardData(people, "appearance", "BOX-1", singleSettings).eligible,
    1,
    "removing a gender hides it without erasing its rating",
  );
  assert.strictEqual(
    algorithms.leaderboardData(people, "appearance", "BOX-1", mixedSettings).ranked.length,
    3,
    "selecting it again restores its standings",
  );
  assert.strictEqual(
    algorithms.battleCategoryPath("appearance", "", "BOX-1"),
    "/plugins/dirty-rank/category/appearance?box=BOX-1",
  );
  assert.strictEqual(
    algorithms.battleCategoryPath("appearance", people[1].id, "BOX-1"),
    "/plugins/dirty-rank/gauntlet/mixed-1/appearance?box=BOX-1",
  );
  assert.strictEqual(
    algorithms.battleRouteFromPath("/plugins/dirty-rank/category/appearance/king-of-the-hill"),
    null,
    "battles have one mode",
  );
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
  const weightedResult = algorithms.expectedDeviationAfterBattle(
    uncertain,
    close,
    Object.assign({}, baseSettings, { evidenceWeight: 2 }),
  );
  const uncertainOpponent = algorithms.expectedDeviationAfterBattle(uncertain, pool(1000, 350, 1), baseSettings);

  assert(closeResult < uncertain.deviation, "an informative battle must lower expected deviation");
  assert(closeResult < farResult, "a close opponent must provide more information than an implausible result");
  assert(weightedResult < closeResult, "more evidence per vote reduces expected deviation more");
  assert(closeResult < uncertainOpponent, "an established opponent tells more than an uncertain one");
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
  const refinedClosePerformers = [performer(21, 1030, 80, 20), performer(22, 1000, 80, 20), performer(23, 970, 80, 20)];
  const refinedRanking = algorithms.categoryConfidence(
    refinedClosePerformers,
    category,
    "FEMALE",
    Object.assign({}, baseSettings, { confidenceGoal: "ranking" }),
  );

  assert.strictEqual(refinedRanking.refined, 3);
  assert.strictEqual(refinedRanking.established, 2, "overlapping refined ratings must establish tie boundaries");
  assert.strictEqual(
    refinedRanking.remainingBattles,
    0,
    "an all-refined leaderboard must not remain permanently unfinished",
  );
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
    (ranking.completedBattles / (ranking.completedBattles + ranking.remainingBattles)) * 100,
    "confidence percentage must be completed battles divided by completed plus expected battles",
  );
}

{
  const performers = [performer(1, 1000, 350, 0), performer(2, 1000, 45, 20), performer(3, 1300, 45, 20)];
  const settings = Object.assign({}, baseSettings, { confidenceGoal: "all" });
  const originalRandom = Math.random;
  Math.random = function () {
    return 0.5;
  };
  const selected = algorithms.selectPair(performers, category, "FEMALE", settings, null);
  Math.random = originalRandom;

  assert(
    selected.pair.some(function (item) {
      return item.id === "1";
    }),
    "the optimizer must include the only uncertain performer",
  );
  assert(selected.expectedInformation > 0, "the selected pair must report its expected information");
}

{
  // Every verdict is refitted together, so a battle between two newcomers places both of
  // them and comes before a newcomer against a settled performer.
  const rated = [940, 980, 1000, 1020, 1060].map(function (rating, index) {
    return performer(71 + index, rating, 50, 20);
  });
  const originalRandom = Math.random;
  Math.random = function () {
    return 0.5;
  };
  ["all", "ranking", "top"].forEach(function (confidenceGoal) {
    const settings = Object.assign({}, baseSettings, { confidenceGoal, confidenceTopN: 3 });
    [
      [performer(61, 1000, 350, 0), performer(62, 1000, 350, 0)],
      [performer(63, 1000, 253, 1), performer(64, 1000, 253, 1)],
    ].forEach(function (fresh) {
      const ids = fresh
        .map(function (item) {
          return item.id;
        })
        .sort()
        .join(":");
      const selected = algorithms.selectPair(rated.concat(fresh), category, "FEMALE", settings, null);
      const pair = selected.pair
        .map(function (item) {
          return item.id;
        })
        .sort()
        .join(":");
      assert.strictEqual(pair, ids, confidenceGoal + ": two newcomers meet each other first");
    });
  });
  // Gauntlet's opponents do not keep battling, so a settled opponent tells its target more.
  const target = performer(81, 1000, 350, 0);
  const settled = performer(82, 1000, 50, 20);
  const unknown = performer(83, 1000, 350, 0);
  const gauntlet = algorithms.selectGauntletPair(
    [target, unknown, settled],
    target,
    category,
    "FEMALE",
    baseSettings,
    null,
  );
  assert.strictEqual(gauntlet.pair[1].id, settled.id, "Gauntlet prefers a settled opponent for its target");
  const unrated = [performer(65, 1000, 350, 0), performer(66, 1000, 350, 0), performer(67, 1000, 350, 0)];
  const start = algorithms.selectPair(
    unrated.concat(performer(68, 1100, 253, 1)),
    category,
    "FEMALE",
    baseSettings,
    null,
  );
  Math.random = originalRandom;
  assert(
    start.pair.every(function (item) {
      return unrated.indexOf(item) >= 0;
    }),
    "without rated opponents, unrated performers get their first verdict before anyone gets a second",
  );
}

{
  const performers = [performer(1, 1000, 350, 0), performer(2, 1000, 45, 20), performer(3, 1400, 45, 20)];
  const originalRandom = Math.random;
  Math.random = function () {
    return 0.5;
  };
  const selected = algorithms.selectGauntletPair(performers, performers[0], category, "FEMALE", baseSettings, null);
  Math.random = originalRandom;

  assert.strictEqual(selected.pair[0].id, "1", "Gauntlet must keep the target performer fixed on the left");
  assert.notStrictEqual(selected.pair[1].id, "1", "Gauntlet must select a different opponent");
  assert(selected.expectedInformation > 0, "Gauntlet must report the target's expected information");
}

{
  // A judged pair's answer replaces its verdict, so a verdict that fits the others is not asked again.
  const performers = [performer(41, 1000, 350, 0), performer(42, 1000, 45, 20), performer(43, 1400, 45, 20)];
  const settings = Object.assign({}, baseSettings, { confidenceGoal: "all" });
  const originalRandom = Math.random;
  Math.random = () => 0.5;
  try {
    const fresh = algorithms.emptyPoolVerdicts("appearance", "FEMALE");
    const first = algorithms.selectPair(performers, category, "FEMALE", settings, fresh);
    const token = first.pair
      .map(item => item.id)
      .sort()
      .join(":");
    assert.strictEqual(first.saved, null, "an unjudged pair has no saved verdict");
    assert(first.expectedInformation > 0, "the selected pair must report its expected information");
    const judged = algorithms.withVerdict(fresh, first.pair[0].id, first.pair[1].id, { score: 0, confirmations: 0 });
    const next = algorithms.selectPair(performers, category, "FEMALE", settings, judged);
    assert.notStrictEqual(
      next.pair
        .map(item => item.id)
        .sort()
        .join(":"),
      token,
      "a verdict that agrees with the ratings leaves its pair for new ones",
    );
    const excluded = algorithms.selectPair(performers, category, "FEMALE", settings, fresh, new Set([token]));
    assert.notStrictEqual(
      excluded.pair
        .map(item => item.id)
        .sort()
        .join(":"),
      token,
      "an excluded pair is skipped",
    );
    const gauntlet = algorithms.selectGauntletPair(performers, performers[0], category, "FEMALE", settings, fresh);
    const gauntletJudged = algorithms.withVerdict(fresh, "41", gauntlet.pair[1].id, { score: 0, confirmations: 0 });
    assert.notStrictEqual(
      algorithms.selectGauntletPair(performers, performers[0], category, "FEMALE", settings, gauntletJudged).pair[1].id,
      gauntlet.pair[1].id,
      "Gauntlet also moves on from a judged opponent",
    );
  } finally {
    Math.random = originalRandom;
  }
}

{
  // A verdict the other verdicts make improbable looks like a slip and comes back.
  const strong = pool(1700, 40, 30);
  const weak = pool(700, 40, 30);
  const thresholds = algorithms.DEFAULT_THRESHOLDS;
  const agreeing = algorithms.verdictInformation(strong, weak, baseSettings, thresholds, {
    score: 3,
    confirmations: 0,
  });
  const contradicting = algorithms.verdictInformation(strong, weak, baseSettings, thresholds, {
    score: -3,
    confirmations: 0,
  });
  const confirmed = algorithms.verdictInformation(strong, weak, baseSettings, thresholds, {
    score: -3,
    confirmations: 2,
  });
  assert(agreeing.slipChance < 0.05, "a verdict that fits the ratings is unlikely to be a slip");
  assert(contradicting.slipChance > 0.9, "a reversed verdict between distant performers is probably a slip");
  assert(confirmed.slipChance < contradicting.slipChance / 10, "each confirmation makes a slip much less likely");
  assert(contradicting.leftGain > agreeing.leftGain * 100, "correcting a slip is worth far more than asking again");
  const open = algorithms.verdictInformation(pool(1000, 200, 5), pool(1000, 200, 5), baseSettings, thresholds, null);
  assert.strictEqual(open.slipChance, 0, "a new pair has no saved verdict to correct");
  assert(open.leftGain > 0 && Math.abs(open.leftGain - open.rightGain) < 1e-12, "a new close pair informs both");

  const performers = [performer(31, 1700, 40, 30), performer(32, 700, 40, 30), performer(33, 1200, 40, 30)];
  const settings = Object.assign({}, baseSettings, { confidenceGoal: "all" });
  let verdicts = algorithms.emptyPoolVerdicts("appearance", "FEMALE");
  verdicts = algorithms.withVerdict(verdicts, "31", "33", { score: 3, confirmations: 0 });
  verdicts = algorithms.withVerdict(verdicts, "33", "32", { score: 3, confirmations: 0 });
  verdicts = algorithms.withVerdict(verdicts, "32", "31", { score: 2, confirmations: 0 });
  const selected = algorithms.selectPair(performers, category, "FEMALE", settings, verdicts);
  assert.deepStrictEqual(
    selected.pair.map(item => item.id).sort(),
    ["31", "32"],
    "the verdict that breaks the chain is asked again",
  );
  const left = selected.pair[0].id;
  assert.strictEqual(selected.saved.score, left === "32" ? 2 : -2, "the saved verdict is shown from the left side");
}

{
  // A performer who stays for the next battle keeps their side.
  const [a, b, c, d] = ["a", "b", "c", "d"].map(id => ({ id }));
  const ids = result => result.pair.map(item => item.id).join("");
  const next = (pair, saved = null) => ({ pair, eligible: 4, ranks: {}, saved });
  assert.strictEqual(ids(algorithms.keepSides([a, b], next([c, a]))), "ac", "the left performer stays left");
  assert.strictEqual(ids(algorithms.keepSides([a, b], next([b, c]))), "cb", "the right performer stays right");
  assert.strictEqual(ids(algorithms.keepSides([a, b], next([a, c]))), "ac");
  assert.strictEqual(ids(algorithms.keepSides([a, b], next([c, d]))), "cd", "a new pair keeps its own sides");
  assert.strictEqual(ids(algorithms.keepSides([a, b], next([b, a]))), "ab", "a returning pair keeps both sides");
  assert.strictEqual(ids(algorithms.keepSides(null, next([b, a]))), "ba");
  assert.deepStrictEqual(
    algorithms.keepSides([a, b], next([c, a], { score: 2, confirmations: 1 })).saved,
    { score: -2, confirmations: 1 },
    "the saved verdict follows the swap",
  );
}

{
  const thresholds = algorithms.DEFAULT_THRESHOLDS;
  for (const difference of [-3, -0.4, 0, 1.1, 5]) {
    const chances = [-3, -2, -1, 0, 1, 2, 3].map(score => algorithms.verdictProbability(difference, score, thresholds));
    assert(
      Math.abs(chances.reduce((sum, value) => sum + value, 0) - 1) < 1e-12,
      "the seven verdicts cover every answer",
    );
    const predicted = algorithms.predictedVerdicts(difference, 0, thresholds);
    chances.forEach((chance, index) =>
      assert(Math.abs(chance - predicted[index]) < 1e-12, "a certain lead predicts exactly"),
    );
  }
  const certain = algorithms.predictedVerdicts(4, 0, thresholds);
  const uncertain = algorithms.predictedVerdicts(4, 9, thresholds);
  assert(uncertain[6] < certain[6], "an uncertain lead predicts a strong verdict less confidently");
  assert.deepStrictEqual(
    ["KeyA", "KeyS", "KeyD", "KeyG", "KeyJ", "KeyK", "KeyL"].map(algorithms.scoreForCode),
    [3, 2, 1, 0, -1, -2, -3],
    "home-row key positions choose the scale from left to right",
  );
  assert.deepStrictEqual(
    ["Numpad1", "Numpad2", "Numpad3", "Numpad0", "Numpad4", "Numpad5", "Numpad6"].map(algorithms.scoreForCode),
    [1, 2, 3, 0, -1, -2, -3],
    "the keypad gives the strength: 1 2 3 left, 0 equal, 4 5 6 right",
  );
  assert.deepStrictEqual(["KeyF", "KeyH", "KeyQ", "Digit1", "Numpad7", ""].map(algorithms.scoreForCode), [
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  assert.strictEqual(algorithms.verdictLabel(2, "Ann", "Bea"), "Ann is better than Bea");
  assert.strictEqual(algorithms.verdictLabel(-3, "Ann", "Bea"), "Bea is much better than Ann");
  assert.strictEqual(algorithms.verdictLabel(-1, "Ann", "Bea"), "Bea is slightly better than Ann");
  assert.strictEqual(algorithms.verdictLabel(0, "Ann", "Bea"), "Ann and Bea are equal");
  let verdicts = algorithms.poolVerdictsFromResult("appearance", "FEMALE", {
    thresholds: [0.7, 1.9, 3.1],
    verdicts: [
      ["10", "9", 2, 1],
      ["bad", "entry"],
      ["1", "2", 9, 0],
    ],
  });
  assert.deepStrictEqual(Array.from(verdicts.thresholds), [0.7, 1.9, 3.1]);
  // Scores arrive from the first ID in text order: "10" sorts before "9".
  assert.deepStrictEqual(algorithms.verdictFor(verdicts, "10", "9"), { score: 2, confirmations: 1 });
  assert.deepStrictEqual(algorithms.verdictFor(verdicts, "9", "10"), { score: -2, confirmations: 1 });
  assert.strictEqual(algorithms.verdictFor(verdicts, "1", "2"), null, "invalid entries are ignored");
  verdicts = algorithms.applyVerdictResult(verdicts, { verdict: ["10", "9", null, 0], thresholds: [0, 1, 2] });
  assert.strictEqual(algorithms.verdictFor(verdicts, "10", "9"), null, "a removed verdict leaves the pair unjudged");
  assert.deepStrictEqual(Array.from(verdicts.thresholds), [0.7, 1.9, 3.1], "invalid thresholds are ignored");
  assert.deepStrictEqual(algorithms.chosenVerdict({ score: 1, confirmations: 2 }, 1), { score: 1, confirmations: 3 });
  assert.deepStrictEqual(algorithms.chosenVerdict({ score: 1, confirmations: 2 }, -1), { score: -1, confirmations: 0 });
  assert.deepStrictEqual(algorithms.chosenVerdict(null, 0), { score: 0, confirmations: 0 });
}

{
  const performers = [performer(1, 1300, 40, 12), performer(2, 1100, 80, 10), performer(3, 900, 140, 8)];
  const board = algorithms.leaderboardData(performers, "appearance", "FEMALE", baseSettings);

  assert.deepStrictEqual(
    board.ranked.map(function (item) {
      return item.id;
    }),
    ["1", "2", "3"],
  );
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
    states: { 1: { version: 2, revision: 5, pools: { "appearance|FEMALE": pool(1500, 100, 10) } } },
  });
  algorithms.applyRatingIndex({
    revision: 2,
    states: { 1: { version: 2, revision: 2, pools: { "appearance|FEMALE": pool(900, 300, 1) } } },
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
    states: { 1: { version: 2, revision: 6, pools: { "appearance|FEMALE": pool(1600, 90, 11) } } },
  });
  assert.strictEqual(
    algorithms.leaderboardPoolFor(staleTarget, "appearance", "FEMALE", baseSettings).rating,
    1600,
    "a newer rating index response must apply",
  );
}

{
  const settings = algorithms.settingsFromConfiguration({
    categories: {
      FEMALE: [
        { name: "Appearance", enabled: true, weight: 1 },
        { name: "Performance", enabled: true, weight: 1 },
        { name: "Ignored", enabled: false, weight: 1000 },
      ],
    },
  });
  const performers = ["a", "b", "c", "d", "unrated"].map(id => ({
    id,
    name: id,
    gender: "FEMALE",
    image_path: "/portrait.svg",
  }));
  const states = {};
  [
    [3000, 1000],
    [1500, 1500],
    [1400, 1400],
    [1000, 2000],
  ].forEach((ratings, i) => {
    states[performers[i].id] = {
      pools: {
        "appearance|FEMALE": pool(ratings[0], 50, 10),
        "performance|FEMALE": pool(ratings[1], 50, 10),
        "ignored|FEMALE": pool(1000000, 50, 10),
      },
    };
  });
  states.deleted = { pools: { "appearance|FEMALE": pool(1000000, 50, 10) } };
  states.male = { pools: { "appearance|MALE": pool(1000000, 50, 10) } };
  states.changed = { pools: { "appearance|FEMALE": pool(1000000, 50, 10) } };
  algorithms.setOverallReferencePerformers(
    performers.concat([
      { id: "male", gender: "MALE" },
      { id: "changed", gender: "MALE" },
    ]),
  );
  algorithms.applyRatingIndex({ revision: 7, states });
  const overall = performer => algorithms.leaderboardPoolFor(performer, "__overall__", "FEMALE", settings);
  const a = overall(performers[0]);
  const b = overall(performers[1]);
  assert(
    b.rating > a.rating,
    "consistent second places must beat a huge rating in one category and last place in another",
  );
  assert.strictEqual(b.ratedCategories, 2);
  assert.strictEqual(b.totalCategories, 2, "disabled categories must not contribute");
  assert.strictEqual(b.precision.id, "excellent");
  assert.strictEqual(
    algorithms.leaderboardPoolFor(performers[0], "appearance", "FEMALE", settings).rating,
    3000,
    "normalizing the overall score must preserve category Glicko ratings",
  );
  const appearance = algorithms.overallCategoryScoreFor(performers[0], "appearance", "FEMALE", settings);
  const performance = algorithms.overallCategoryScoreFor(performers[3], "performance", "FEMALE", settings);
  assert.strictEqual(
    appearance.position,
    100,
    "deleted performers and outdated cohort pools must not affect percentiles",
  );
  assert.strictEqual(performance.position, 100);
  assert(appearance.rating > performance.rating, "a greater lead must still earn a small bonus");
  assert(appearance.rating - performance.rating < 20, "equal positions must have a bounded strength bonus");
  performers.forEach(performer => assert(overall(performer).rating >= 0 && overall(performer).rating <= 100));
  assert.strictEqual(overall(performers[4]).rating, 50);
  assert.strictEqual(overall(performers[4]).precision.id, "provisional");
  const ranked = algorithms.leaderboardData(performers, "__overall__", "FEMALE", settings).ranked;
  const sorted = algorithms.sortPerformersByOverall(performers, "DESC", settings);
  assert.deepStrictEqual(
    sorted.slice(0, 4).map(p => p.id),
    ranked.map(p => p.id),
    "native sort and leaderboard must agree",
  );
  assert.strictEqual(sorted[4].id, "unrated", "unrated performers remain last even with neutral scores");
  assert.strictEqual(algorithms.sortPerformersByOverall(performers, "ASC", settings)[4].id, "unrated");
  const beforeFilter = b.rating;
  algorithms.leaderboardData([performers[1]], "__overall__", "FEMALE", settings);
  algorithms.sortPerformersByOverall([performers[1]], "DESC", settings);
  assert.strictEqual(overall(performers[1]).rating, beforeFilter, "filtered subsets must not change normalization");

  const weighted = algorithms.settingsFromConfiguration({
    categories: {
      FEMALE: [
        { name: "Appearance", enabled: true, weight: 3 },
        { name: "Performance", enabled: true, weight: 1 },
      ],
    },
  });
  const weightedA = algorithms.leaderboardPoolFor(performers[0], "__overall__", "FEMALE", weighted);
  const weakA = algorithms.overallCategoryScoreFor(performers[0], "performance", "FEMALE", settings);
  assert(
    Math.abs(weightedA.rating - (appearance.rating * 3 + weakA.rating) / 4) < 1e-10,
    "configured category weights must apply after normalization",
  );

  const nextStates = Object.assign({}, states, {
    b: {
      pools: {
        "appearance|FEMALE": pool(3500, 50, 11),
        "performance|FEMALE": pool(1500, 50, 10),
      },
    },
  });
  algorithms.applyRatingIndex({ revision: 8, states: nextStates });
  assert.notStrictEqual(
    overall(performers[1]).rating,
    beforeFilter,
    "new rating data must invalidate normalized scores",
  );
  const afterUpdate = overall(performers[1]).rating;
  algorithms.applyRatingIndex({ revision: 7, states });
  assert.strictEqual(overall(performers[1]).rating, afterUpdate, "stale loads must not invalidate the newer scores");
  algorithms.applyRatingIndex({ revision: 9, states });
  assert.strictEqual(overall(performers[1]).rating, beforeFilter, "undo must restore the earlier normalized score");
}

{
  const settings = algorithms.settingsFromConfiguration({
    categories: {
      FEMALE: [
        { name: "Appearance", enabled: true, weight: 1 },
        { name: "Performance", enabled: true, weight: 1 },
      ],
    },
  });
  const performers = ["top", "bottom", "missing"].map(id => ({
    id,
    name: id,
    gender: "FEMALE",
    image_path: "/portrait.svg",
  }));
  algorithms.setOverallReferencePerformers(performers);
  let revision = 10;
  const load = (top, bottom) =>
    algorithms.applyRatingIndex({
      revision: revision++,
      states: {
        top: { pools: { "appearance|FEMALE": pool(top, 50, 10) } },
        bottom: { pools: { "appearance|FEMALE": pool(bottom, 300, 1) } },
        missing: { pools: { "appearance|FEMALE": pool(1000000, 350, 0) } },
      },
    });
  const score = id => algorithms.overallCategoryScoreFor({ id }, "appearance", "FEMALE", settings);
  load(1400, 1000);
  assert.strictEqual(score("top").position, 100);
  assert(
    Math.abs(score("top").strength - (100 * 10) / 11) < 1e-5,
    "strength must exclude self and use the logistic rating gap",
  );
  assert.strictEqual(score("bottom").position, 0);
  assert(
    Math.abs(score("top").rating + score("bottom").rating - 100) < 1e-10,
    "pairwise scores must be symmetric despite different RD",
  );
  const original = score("top").rating;
  load(-600, -1000);
  assert.strictEqual(score("top").rating, original, "moving the arbitrary rating origin must not affect scores");
  const partial = algorithms.leaderboardPoolFor(performers[0], "__overall__", "FEMALE", settings);
  assert.strictEqual(
    partial.rating,
    (original + 50) / 2,
    "missing categories must contribute neutral 50, not be omitted",
  );
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
    id: "male-refinement-" + index,
    name: "Male " + index,
    gender: "MALE",
    image_path: "/synthetic.svg",
    scene_count: 1,
  }));
  const maleSettings = Object.assign({}, baseSettings, { confidenceGoal: "all", enabledCohorts: ["MALE"] });
  const cohort = algorithms.categoryConfidence(malePerformers, category, "MALE", maleSettings);
  assert.strictEqual(cohort.eligible, 300);
  assert.strictEqual(cohort.refined, 0);
  assert(cohort.remainingBattles >= 150, "300 unrated performers cannot be refined in eight cohort-wide battles");
  const perPerformer = algorithms.estimatedMatchesToConfidence(
    pool(1000, maleSettings.initialDeviation, 0),
    maleSettings.provisionalDeviation,
    pool(1000, maleSettings.initialDeviation, 1),
    maleSettings,
  );
  assert.strictEqual(
    cohort.remainingBattles,
    Math.ceil((300 * perPerformer) / 2),
    "each physical battle contributes to two performer ratings",
  );
  const maleStates = Object.fromEntries(
    malePerformers.map(person => [person.id, { pools: { "appearance|MALE": pool(1000, 75, 10) } }]),
  );
  maleStates[malePerformers[0].id].pools["appearance|MALE"] = pool(1000, 250, 1);
  algorithms.applyRatingIndex({ revision: 1000, states: maleStates });
  const singleRemaining = algorithms.categoryConfidence(malePerformers, category, "MALE", maleSettings);
  assert.strictEqual(singleRemaining.refined, 299);
  const targetBattles = algorithms.estimatedMatchesToConfidence(
    pool(1000, 250, 1),
    maleSettings.provisionalDeviation,
    pool(1000, 75, 1),
    maleSettings,
  );
  assert.strictEqual(
    singleRemaining.remainingBattles,
    targetBattles,
    "one remaining performer cannot participate twice in the same battle",
  );
}

{
  const estimate = algorithms.freshCategoryBattleEstimate;
  const defaults = algorithms.ratingParameters(baseSettings);
  const normal = estimate(300, defaults);
  const perPerson = algorithms.estimatedMatchesToConfidence(
    {
      rating: defaults.initialRating,
      deviation: defaults.initialDeviation,
      matches: 0,
    },
    defaults.provisionalDeviation,
    null,
    algorithms.settingsFromConfiguration(defaults),
  );
  assert.strictEqual(
    normal.battles,
    Math.ceil((300 * perPerson) / 2),
    "fresh estimates account for both battle participants",
  );
  assert.strictEqual(estimate(301, defaults).battles, Math.ceil((301 * perPerson) / 2));
  assert.strictEqual(estimate(0, defaults).battles, 0);
  assert.strictEqual(estimate(1, defaults).battles, 0, "one performer cannot battle alone");
  assert(estimate(300, { ...defaults, evidenceWeight: 0.5 }).battles > normal.battles);
  assert(estimate(300, { ...defaults, evidenceWeight: 3 }).battles < normal.battles);
  assert(
    estimate(300, { ...defaults, provisionalDeviation: 70 }).battles > normal.battles,
    "stricter refinement requires more battles",
  );
  assert.strictEqual(
    estimate(300, { ...defaults, initialRating: 2000 }).battles,
    normal.battles,
    "a common rating offset does not invent extra uncertainty",
  );
  assert.strictEqual(
    estimate(300, { ...defaults, evidenceWeight: 0.25, deviationFloor: 1, provisionalDeviation: 1 }).capped,
    true,
    "unreachable refinement is marked as a lower bound",
  );
}

{
  const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-9, message);
  const definitions = {
    FEMALE: [
      { name: "Appearance", weight: 3 },
      { name: "Performance", weight: 1 },
      { name: "Disabled", enabled: false, weight: 1000 },
    ],
  };
  const settingsFor = (strategy, extra) =>
    algorithms.settingsFromConfiguration(
      Object.assign(
        {
          categories: definitions,
          overallScoreStrategy: strategy,
        },
        extra,
      ),
    );
  const people = Array.from({ length: 7 }, (_, index) => ({
    id: "strategy-" + index,
    name: "Strategy " + index,
    gender: "FEMALE",
    image_path: index === 0 ? "" : "/portrait.svg",
  }));
  const states = {};
  for (let i = 0; i < 6; i += 1) {
    states[people[i].id] = {
      pools: {
        "appearance|FEMALE": pool(i === 0 ? 2000 : 1000, 50, 10),
        "performance|FEMALE": pool(i === 0 ? 1000 : 2000, 75, 15),
        "disabled|FEMALE": pool(1000000, 50, 10),
      },
    };
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
  assert.strictEqual(
    settingsFor("unknown").overallScoreStrategy,
    "weighted",
    "unknown strategies fall back to the existing calculation",
  );

  const powerSettings = settingsFor("power");
  assert.strictEqual(powerSettings.overallPower, 3);
  near(
    categoryScore("appearance", powerSettings).rating,
    a.rating,
    "power mean combines balanced scores without applying other strategies",
  );
  const expectedPower = exponent =>
    Math.pow((3 * Math.pow(a.rating, exponent) + Math.pow(b.rating, exponent)) / 4, 1 / exponent);
  near(
    overall(target, powerSettings),
    expectedPower(3),
    "power mean must respect weights and exclude disabled categories",
  );
  assert.strictEqual(
    overall(target, settingsFor("power", { overallPower: 1 })),
    overall(target, balanced),
    "power 1 exactly preserves the current average",
  );
  let previous = overall(target, balanced);
  for (const exponent of [2, 2.5, 3, 4]) {
    const value = overall(target, settingsFor("power", { overallPower: exponent }));
    near(value, expectedPower(exponent), "integer and fractional powers use the weighted power mean");
    assert(
      value >= previous && value <= a.rating + 1e-9,
      "higher powers increasingly emphasize strengths without exceeding the highest category score",
    );
    previous = value;
  }
  assert.strictEqual(settingsFor("power", { overallPower: 0 }).overallPower, 1);
  assert.strictEqual(settingsFor("power", { overallPower: 99 }).overallPower, 4);
  assert.strictEqual(settingsFor("power", { overallPower: NaN }).overallPower, 3);

  for (const settings of [balanced, powerSettings]) {
    near(overall(people[6], settings), 50, "unrated categories remain neutral in every strategy");
    assert.strictEqual(
      algorithms.leaderboardPoolFor(target, "appearance", "FEMALE", settings).rating,
      2000,
      "strategies never change category Glicko ratings",
    );
    const visible = people.slice(1);
    const sorted = algorithms.sortPerformersByOverall(visible, "DESC", settings);
    const ranked = algorithms.leaderboardData(visible, "__overall__", "FEMALE", settings).ranked;
    assert.deepStrictEqual(
      sorted.slice(0, 5).map(p => p.id),
      ranked.map(p => p.id),
      "native sorting and the overall leaderboard use the same strategy",
    );
    assert.strictEqual(sorted[5].id, people[6].id);
    assert.strictEqual(
      algorithms.sortPerformersByOverall(visible, "ASC", settings)[5].id,
      people[6].id,
      "unrated performers stay last in both sort directions",
    );
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
    shifted[id] = {
      pools: Object.fromEntries(
        Object.entries(state.pools).map(([key, value]) => [
          key,
          Object.assign({}, value, { rating: value.rating + 5000 }),
        ]),
      ),
    };
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
  people.slice(0, 6).forEach(person => {
    tiedStates[person.id] = {
      pools: {
        "appearance|FEMALE": pool(1200, 50, 10),
      },
    };
  });
  algorithms.applyRatingIndex({ revision: 2002, states: tiedStates });
  for (const strategy of ["weighted", "power"]) {
    near(overall(target, settingsFor(strategy)), 50, "tied and missing categories stay neutral");
  }
  const oneCategory = Object.assign({}, balanced, {
    categoriesByCohort: { FEMALE: [{ name: "Appearance", id: "appearance", enabled: true, weight: 1 }] },
  });
  algorithms.applyRatingIndex({ revision: 2003, states });
  assert.notStrictEqual(overall(target, oneCategory), 50, "new ratings invalidate cached category scores");
  const onePowerCategory = Object.assign({}, oneCategory, { overallScoreStrategy: "power" });
  near(overall(target, onePowerCategory), a.rating, "one category keeps its original balanced score");
  const missingCategoryStates = JSON.parse(JSON.stringify(states));
  delete missingCategoryStates[target.id].pools["performance|FEMALE"];
  algorithms.applyRatingIndex({ revision: 2004, states: missingCategoryStates });
  near(
    overall(target, powerSettings),
    Math.pow((3 * Math.pow(a.rating, 3) + Math.pow(50, 3)) / 4, 1 / 3),
    "missing categories keep their neutral 50 contribution and weight",
  );
  const extremes = {};
  people.slice(0, 6).forEach((person, index) => {
    extremes[person.id] = {
      pools: {
        "appearance|FEMALE": pool(index === 0 ? -1000000 : 1000000, 50, 10),
        "performance|FEMALE": pool(index === 0 ? -1000000 : 1000000, 50, 10),
      },
    };
  });
  algorithms.applyRatingIndex({ revision: 2005, states: extremes });
  assert.strictEqual(overall(target, powerSettings), 0, "all-zero category scores stay zero without NaN");
  near(
    overall(people[1], powerSettings),
    algorithms.overallCategoryScoreFor(people[1], "appearance", "FEMALE", balanced).rating,
    "identical category scores are unchanged by the power mean",
  );
  near(
    overall(target, Object.assign({}, powerSettings, { categoriesByCohort: { FEMALE: [] } })),
    50,
    "empty category sets remain neutral",
  );
}

{
  const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-9, message);
  const settingsFor = strategy =>
    algorithms.settingsFromConfiguration({
      categories: { FEMALE: [{ name: "Appearance" }, { name: "Performance" }] },
      overallScoreStrategy: strategy,
    });
  const people = ["star", "allround", "a", "b", "c", "d", "unrated"].map(id => ({
    id: "strength-" + id,
    name: id,
    gender: "FEMALE",
    image_path: "/portrait.svg",
  }));
  const [star, allround, unrated] = [people[0], people[1], people[6]];
  // The star leads one category by far with few battles; the all-rounder is second and first.
  const appearance = [4000, 1700, 700, 1000, 1300, 1600];
  const performance = [1050, 1700, 700, 1000, 1300, 1600];
  const deviations = [340, 50, 50, 50, 50, 50];
  const performanceDeviations = [300, 50, 50, 50, 50, 50];
  const states = {};
  for (let i = 0; i < 6; i += 1) {
    states[people[i].id] = {
      pools: {
        "appearance|FEMALE": pool(appearance[i], deviations[i], 10),
        "performance|FEMALE": pool(performance[i], performanceDeviations[i], 10),
      },
    };
  }
  algorithms.setOverallReferencePerformers(people);
  algorithms.applyRatingIndex({ revision: 3000, states });
  const overall = (person, settings) => algorithms.leaderboardPoolFor(person, "__overall__", "FEMALE", settings).rating;
  const strength = (values, value) => {
    const mean = values.reduce((sum, item) => sum + item, 0) / values.length;
    const spread = Math.sqrt(values.reduce((sum, item) => sum + (item - mean) ** 2, 0) / values.length);
    return (value - mean) / spread;
  };
  const rating = settingsFor("rating");
  const proven = settingsFor("proven");
  near(
    overall(star, rating),
    (strength(appearance, 4000) + strength(performance, 1050)) / 2,
    "rating strength averages standard deviations above each category mean",
  );
  near(
    overall(star, proven),
    (strength(appearance, 4000 - 340) + strength(performance, 1050 - 300)) / 2,
    "proven strength subtracts each category RD before comparing",
  );
  const leader = settings => algorithms.leaderboardData(people, "__overall__", "FEMALE", settings).ranked[0].id;
  assert.strictEqual(leader(settingsFor("weighted")), allround.id, "percentiles favor the all-rounder");
  assert.strictEqual(leader(rating), star.id, "rating strength keeps the star's large rating gap");
  assert.strictEqual(leader(proven), allround.id, "proven strength discounts the star's uncertain ratings");
  assert(overall(unrated, proven) < overall(unrated, rating), "unrated categories carry the initial RD penalty");
  for (const settings of [rating, proven]) {
    assert.deepStrictEqual(
      algorithms.sortPerformersByOverall(people, "DESC", settings).map(person => person.id),
      algorithms
        .leaderboardData(people, "__overall__", "FEMALE", settings)
        .ranked.map(person => person.id)
        .concat(unrated.id),
      "native sorting and the overall leaderboard use the same strategy",
    );
    assert.strictEqual(
      algorithms.leaderboardPoolFor(star, "appearance", "FEMALE", settings).rating,
      4000,
      "strategies never change category Glicko ratings",
    );
    assert.strictEqual(
      algorithms.settingsFromConfiguration(algorithms.serializedSettings(settings)).overallScoreStrategy,
      settings.overallScoreStrategy,
      "rating strategies survive settings serialization",
    );
  }
  const display = { overallScore: true, rating: -0.4567, deviation: 50, matches: 20, precision: { id: "refined" } };
  assert.strictEqual(algorithms.leaderboardRatingText(display, rating), "-0.46", "rating strengths show two decimals");
  assert.strictEqual(algorithms.leaderboardRatingText(display, settingsFor("weighted")), "-0.5");
}

{
  const stored = new Map();
  global.window.localStorage = {
    getItem: key => (stored.has(key) ? stored.get(key) : null),
    setItem: (key, value) => stored.set(key, value),
  };
  algorithms.rememberCategory("FEMALE", "performance");
  assert.strictEqual(
    algorithms.preferredCategoryId(algorithms.settingsFromConfiguration({}), "FEMALE"),
    "performance",
    "the last chosen category is remembered per gender box",
  );
  delete global.window.localStorage;
}

{
  const settings = algorithms.settingsFromConfiguration({
    categories: {
      FEMALE: [{ name: "Appearance" }, { name: "Performance" }],
      MALE: [{ name: "Appearance" }],
    },
  });
  const people = [
    { id: "pair-left", name: "Left", gender: "FEMALE", image_path: "/portrait.svg" },
    { id: "pair-right", name: "Right", gender: "FEMALE", image_path: "/portrait.svg" },
    { id: "other-left", name: "Other left", gender: "MALE", image_path: "/portrait.svg" },
    { id: "other-right", name: "Other right", gender: "MALE", image_path: "/portrait.svg" },
  ];
  const state = (revision, appearance, performance, cohort = "FEMALE") => ({
    revision,
    pools: {
      ["appearance|" + cohort]: pool(appearance, 70, 10),
      ...(performance === undefined ? {} : { ["performance|" + cohort]: pool(performance, 70, 10) }),
    },
  });
  algorithms.setOverallReferencePerformers(people);
  algorithms.applyRatingIndex({
    revision: 3000,
    states: {
      "pair-left": state(3000, 1100, 1000),
      "pair-right": state(3000, 1200, 1200),
      "other-left": state(3000, 1100, undefined, "MALE"),
      "other-right": state(3000, 1200, undefined, "MALE"),
    },
  });
  const score = (person, category, cohort) => algorithms.overallCategoryScoreFor(person, category, cohort, settings);
  const beforeAppearance = score(people[0], "appearance", "FEMALE");
  const beforePerformance = score(people[0], "performance", "FEMALE");
  const beforeOtherCohort = score(people[2], "appearance", "MALE");
  assert.match(algorithms.overallCategoryScoresTitle(people[0], "__overall__", "FEMALE", settings), /Appearance: #2/);
  const publications = [];
  const unsubscribe = algorithms.subscribeToOverallSortSettings(() => {
    publications.push(
      people.slice(0, 2).map(person => algorithms.poolFor(person, "appearance", "FEMALE", settings).rating),
    );
  });
  const updates = [
    { id: "pair-left", state: state(3001, 1300, 1000) },
    { id: "pair-right", state: state(3001, 900, 1200) },
  ];
  assert.strictEqual(algorithms.updatePerformerStates(updates), true);
  assert.deepStrictEqual(publications, [[1300, 900]], "one publication exposes both accepted vote states together");
  assert.notStrictEqual(score(people[0], "appearance", "FEMALE"), beforeAppearance, "the changed pool cache rebuilds");
  assert.strictEqual(
    score(people[0], "performance", "FEMALE"),
    beforePerformance,
    "an unchanged category retains its cache",
  );
  assert.strictEqual(
    score(people[2], "appearance", "MALE"),
    beforeOtherCohort,
    "an unrelated cohort retains its cache",
  );
  assert.match(algorithms.overallCategoryScoresTitle(people[0], "__overall__", "FEMALE", settings), /Appearance: #1/);
  assert.match(algorithms.overallCategoryScoresTitle(people[1], "__overall__", "FEMALE", settings), /Appearance: #2/);
  assert.strictEqual(algorithms.updatePerformerStates(updates), false, "an identical revision is not republished");
  algorithms.updatePerformerState(people[0], state(3000, 800, 1000));
  assert.strictEqual(
    algorithms.poolFor(people[0], "appearance", "FEMALE", settings).rating,
    1300,
    "a stale individual vote cannot regress a performer",
  );
  assert.strictEqual(publications.length, 1, "stale and repeated updates publish nothing");

  algorithms.updatePerformerState(people[2], state(3003, 1250, undefined, "MALE"));
  algorithms.updatePerformerState(people[1], state(3002, 1000, 1200));
  assert.strictEqual(
    algorithms.poolFor(people[1], "appearance", "FEMALE", settings).rating,
    1000,
    "another performer's global maximum cannot reject this performer's newer state",
  );

  algorithms.updatePerformerState(people[0], { revision: 3002, pools: { "performance|FEMALE": pool(1000, 70, 10) } });
  assert.strictEqual(
    score(people[1], "appearance", "FEMALE").rating,
    50,
    "undo removing a pool invalidates the category population",
  );
  algorithms.applyRatingIndex({ revision: 3004, states: { "pair-right": state(3004, 1400, 1200) } });
  const beforeStaleUndo = publications.length;
  algorithms.updatePerformerStates([
    { id: "pair-left", state: state(3003, 1100, 1000) },
    { id: "pair-right", state: state(3003, 1200, 1200) },
  ]);
  assert.strictEqual(
    algorithms.poolFor(people[1], "appearance", "FEMALE", settings).rating,
    1400,
    "a stale undo cannot regress the latest full snapshot",
  );
  assert.strictEqual(
    algorithms.poolFor(people[0], "appearance", "FEMALE", settings).matches,
    0,
    "a stale reply cannot resurrect a performer absent from the full snapshot",
  );
  assert.strictEqual(publications.length, beforeStaleUndo);
  unsubscribe();
}

{
  const near = (actual, expected, message) => assert(Math.abs(actual - expected) < 1e-9, message);
  // Likely positions: a clear order keeps exact ranks, overlapping ratings widen them.
  assert.deepStrictEqual(
    algorithms.rankRanges([
      { rating: 2000, deviation: 30 },
      { rating: 1500, deviation: 30 },
      { rating: 1000, deviation: 30 },
    ]),
    [
      { low: 1, high: 1 },
      { low: 2, high: 2 },
      { low: 3, high: 3 },
    ],
  );
  assert.deepStrictEqual(
    algorithms.rankRanges([
      { rating: 1010, deviation: 150 },
      { rating: 1005, deviation: 150 },
      { rating: 1000, deviation: 150 },
      { rating: 400, deviation: 40 },
    ]),
    [
      { low: 1, high: 3 },
      { low: 1, high: 3 },
      { low: 1, high: 3 },
      { low: 4, high: 4 },
    ],
    "close uncertain ratings share their likely positions; a clearly weaker one does not",
  );
  // The Breasts top four: if the leader could drop, a rival behind it could lead.
  const breasts = algorithms.rankRanges(
    [
      [1875, 81],
      [1814, 68],
      [1810, 67],
      [1752, 73],
      [1500, 60],
    ].map(([rating, deviation]) => ({ rating, deviation })),
  );
  assert(breasts[0].high > 1);
  assert.deepStrictEqual(
    breasts.slice(1, 4).map(range => range.low),
    [1, 1, 1],
    "rivals too close to call with the leader can also be first",
  );
  assert.deepStrictEqual(breasts[4], { low: 5, high: 5 }, "a clearly weaker performer cannot reach the top");

  const scores = requireSource("DirtyRank", "src/domain/scores.ts");
  const index = scores.buildCategoryScoreIndex(
    [900, 1000, 1000, 1150, 1400].map((rating, position) => ({ id: "score-" + position, rating })),
  );
  for (const [id, group] of index.performers) {
    near(scores.categoryScoreAt(index, group.rating, group.rating), group.score.rating, id + " matches its own score");
  }
  assert(scores.categoryScoreAt(index, 2000, null) > scores.categoryScoreAt(index, 1400, 1400));

  const settings = algorithms.settingsFromConfiguration({ overallScoreStrategy: "rating" });
  const people = ["range-a", "range-b", "range-c"].map(id => ({ id, name: id, gender: "FEMALE", image_path: "/x" }));
  algorithms.setOverallReferencePerformers(people);
  algorithms.applyRatingIndex({
    revision: 5000,
    states: {
      "range-a": { pools: { "appearance|FEMALE": pool(1400, 60, 20), "performance|FEMALE": pool(1300, 60, 20) } },
      "range-b": { pools: { "appearance|FEMALE": pool(1100, 60, 20), "performance|FEMALE": pool(1000, 60, 20) } },
      "range-c": { pools: { "appearance|FEMALE": pool(1050, 200, 2) } },
    },
  });
  const board = algorithms.leaderboardData(people, "appearance", "FEMALE", settings);
  const entries = algorithms.leaderboardEntries(board.ranked, "appearance", "FEMALE", settings);
  assert.deepStrictEqual(
    entries.map(entry => entry.range),
    algorithms.leaderboardRanges(board.ranked, "appearance", "FEMALE", settings),
    "standings carry the same cached likely positions",
  );
  assert.deepStrictEqual(entries[0].range, { low: 1, high: 1 });
  assert(entries[2].range.low < 3, "an uncertain performer may rank higher than its position");
  const deviation = index => algorithms.overallScoreDeviation(people[index], "FEMALE", settings);
  assert(deviation(1) > 0);
  assert(deviation(2) > deviation(1), "an unrated category makes the overall score less certain");
  const overall = algorithms.leaderboardData(people, "__overall__", "FEMALE", settings);
  algorithms.leaderboardRanges(overall.ranked, "__overall__", "FEMALE", settings).forEach((range, position) => {
    assert(range.low <= position + 1 && position + 1 <= range.high, "a likely range always holds the shown rank");
  });
  algorithms.setOverallReferencePerformers([]);
}

console.log("DirtyRank information-gain and overall scoring algorithm tests passed");
