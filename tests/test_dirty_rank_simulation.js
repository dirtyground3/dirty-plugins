"use strict";
// A simulated voter with a known true ranking checks how DirtyRank orders battles:
// information-ordered pairs should rank better than random ones, and judged pairs
// should come back mostly when their saved verdict was a slip.
const assert = require("node:assert/strict");
const { requireRankDomain } = require("./rank_modules");

const noop = () => {};
global.window = {
  DirtyPlugins: {
    getPluginSettings: async () => ({}),
    graphql: async () => ({ findPerformers: { performers: [] } }),
    runPluginOperation: async () => ({ revision: 0, states: {} }),
    react: {},
    registerSettingsPanel: noop,
  },
  PluginApi: {
    React: {
      Fragment: "fragment",
      createElement: noop,
      useCallback: value => value,
      useEffect: noop,
      useMemo: factory => factory(),
      useRef: value => ({ current: value }),
      useState: value => [value, noop],
    },
    libraries: { Intl: { useIntl: () => ({ messages: {} }) }, ReactRouterDOM: { NavLink: noop } },
    patch: { after: noop, before: noop, instead: noop },
    register: { route: noop },
  },
  addEventListener: noop,
  location: { pathname: "/plugins/dirty-rank" },
};
const rank = requireRankDomain();
const SCALE = 173.7178;
const PERFORMERS = 40;
const VERDICTS = 260;
// How this simulated voter uses "slightly", "better" and "much better", and how often they slip.
const TRUE_THRESHOLDS = [0.8, 2.0, 3.3];
const SLIP_RATE = 0.05;

function generator(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(random) {
  return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}
function answer(random, difference) {
  if (random() < SLIP_RATE) return { score: Math.floor(random() * 7) - 3, slip: true };
  let draw = random(),
    total = 0;
  for (let score = -3; score <= 3; score += 1) {
    total += rank.verdictProbability(difference, score, TRUE_THRESHOLDS);
    if (draw <= total) return { score, slip: false };
  }
  return { score: 3, slip: false };
}

/** The backend's fit, in miniature: coordinate Newton steps on the ordinal model's posterior. */
function fit(ids, verdicts, thresholds, theta) {
  const priorPrecision = (SCALE / 500) ** 2;
  const games = new Map(ids.map(id => [id, []]));
  for (const [key, verdict] of verdicts.byPair) {
    const [low, high] = key.split(":");
    games.get(low).push([high, verdict.score]);
    games.get(high).push([low, -verdict.score]);
  }
  const terms = id => {
    let gradient = -theta.get(id) * priorPrecision,
      curvature = priorPrecision;
    for (const [opponent, score] of games.get(id)) {
      const side = score < 0 ? -1 : 1,
        size = Math.abs(score);
      const lead = side * (theta.get(id) - theta.get(opponent));
      const [low, high] =
        size === 0 ? [-thresholds[0], thresholds[0]] : [thresholds[size - 1], size === 3 ? Infinity : thresholds[size]];
      const lower = rank.sigmoid(lead - low),
        upper = high === Infinity ? 0 : rank.sigmoid(lead - high);
      gradient += side * (1 - lower - upper);
      curvature += lower * (1 - lower) + upper * (1 - upper);
    }
    return [gradient, curvature];
  };
  for (let sweep = 0; sweep < 300; sweep += 1) {
    let largest = 0;
    for (const id of ids) {
      if (!games.get(id).length) continue;
      const [gradient, curvature] = terms(id);
      const step = Math.max(-2, Math.min(2, gradient / curvature));
      theta.set(id, theta.get(id) + step);
      largest = Math.max(largest, Math.abs(step));
    }
    if (largest < 1e-6) break;
  }
  const states = {};
  for (const id of ids) {
    if (!games.get(id).length) continue;
    const [, curvature] = terms(id);
    states[id] = {
      revision: 0,
      pools: {
        "appearance|FEMALE": {
          rating: 1000 + SCALE * theta.get(id),
          deviation: Math.min(500, Math.max(30, SCALE / Math.sqrt(curvature))),
          matches: games.get(id).length,
        },
      },
    };
  }
  return states;
}
function spearman(truth, estimate) {
  const order = values =>
    new Map(
      Object.keys(values)
        .sort((left, right) => values[right] - values[left])
        .map((id, index) => [id, index]),
    );
  const truthRanks = order(truth),
    estimateRanks = order(estimate);
  const n = truthRanks.size;
  let sum = 0;
  for (const [id, position] of truthRanks) sum += (position - estimateRanks.get(id)) ** 2;
  return 1 - (6 * sum) / (n * (n * n - 1));
}

let revision = 0;
function simulate(seed, informed) {
  const random = generator(seed);
  const choice = generator(seed + 1000);
  const ids = Array.from({ length: PERFORMERS }, (_, index) => "p" + String(index).padStart(2, "0"));
  const truth = Object.fromEntries(ids.map(id => [id, 1.5 * gaussian(random)]));
  const performers = ids.map(id => ({ id, name: id, gender: "FEMALE", image_path: "/portrait.svg" }));
  const category = { id: "appearance", name: "Appearance", enabled: true, weight: 1 };
  const settings = rank.settingsFromConfiguration({ confidenceGoal: "ranking" });
  const theta = new Map(ids.map(id => [id, 0]));
  let verdicts = rank.emptyPoolVerdicts("appearance", "FEMALE");
  const slips = new Set();
  const asked = { again: 0, slips: 0 };
  let states = {};
  const originalRandom = Math.random;
  Math.random = choice;
  try {
    for (let step = 0; step < VERDICTS; step += 1) {
      rank.applyRatingIndex({ revision: ++revision, states });
      let left, right;
      if (informed) {
        [left, right] = rank.selectPair(performers, category, "FEMALE", settings, verdicts).pair;
      } else {
        do {
          left = performers[Math.floor(choice() * PERFORMERS)];
          right = performers[Math.floor(choice() * PERFORMERS)];
        } while (left === right || rank.verdictFor(verdicts, left.id, right.id));
      }
      const token = [left.id, right.id].sort().join(":");
      const previous = rank.verdictFor(verdicts, left.id, right.id);
      if (previous) {
        asked.again += 1;
        if (slips.has(token)) asked.slips += 1;
      }
      const given = answer(random, truth[left.id] - truth[right.id]);
      if (given.slip) slips.add(token);
      else slips.delete(token);
      verdicts = rank.withVerdict(verdicts, left.id, right.id, rank.chosenVerdict(previous, given.score));
      states = fit(ids, verdicts, TRUE_THRESHOLDS, theta);
      for (const state of Object.values(states)) state.revision = revision + 1;
    }
  } finally {
    Math.random = originalRandom;
  }
  const estimate = Object.fromEntries(ids.map(id => [id, theta.get(id)]));
  return { correlation: spearman(truth, estimate), asked, slipsLeft: slips.size };
}

const seeds = [11, 23, 37, 41, 53, 67];
const informed = seeds.map(seed => simulate(seed, true));
const random = seeds.map(seed => simulate(seed, false));
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const informedCorrelation = mean(informed.map(run => run.correlation));
const randomCorrelation = mean(random.map(run => run.correlation));
const again = informed.reduce((sum, run) => sum + run.asked.again, 0);
const slipsAgain = informed.reduce((sum, run) => sum + run.asked.slips, 0);
console.log(
  "simulated " +
    PERFORMERS +
    " performers, " +
    VERDICTS +
    " verdicts: rank correlation " +
    informedCorrelation.toFixed(3) +
    " informed vs " +
    randomCorrelation.toFixed(3) +
    " random; " +
    again +
    " judged pairs asked again, " +
    slipsAgain +
    " of them slips",
);
assert(informedCorrelation > 0.9, "information-ordered verdicts recover the true ranking");
assert(informedCorrelation > randomCorrelation, "information ordering ranks better than random pairs");
assert(again <= 0.05 * VERDICTS * seeds.length, "judged pairs come back rarely");
assert(slipsAgain >= 3 * SLIP_RATE * again, "a judged pair that comes back is far likelier than most to hold a slip");
console.log("DirtyRank simulated-voter matchmaking tests passed");
