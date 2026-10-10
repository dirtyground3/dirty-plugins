"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runRankDomain } = require("./rank_modules");

function domain() {
  let exponentials = 0;
  const math = Object.create(Math);
  math.exp = value => {
    exponentials++;
    return Math.exp(value);
  };
  const window = { PluginApi: { React: {} }, DirtyPlugins: { react: {} } };
  return { algorithms: runRankDomain({ window, Math: math }), calls: () => exponentials };
}
const category = { id: "appearance", name: "Appearance", enabled: true, weight: 1 };
const performer = (id, gender = "FEMALE") => ({
  id: String(id),
  name: "Person " + id,
  gender,
  image_path: "/synthetic.svg",
  scene_count: 1,
});
const pool = (rating, deviation = 300, matches = 1) => ({
  rating,
  deviation,
  matches,
  volatility: 0.06,
  wins: 0,
  losses: 0,
  draws: 0,
});

test("confidence summaries reuse entries and simulation work until their pool or inputs change", () => {
  const { algorithms: a, calls } = domain();
  const people = [performer("one"), performer("two"), performer("other", "MALE")];
  const settings = a.settingsFromConfiguration({ confidenceGoal: "all" });
  const state = (revision, deviation = 300) => ({
    revision,
    pools: {
      "appearance|FEMALE": pool(1000, deviation),
      "performance|FEMALE": pool(1100),
    },
  });
  a.applyRatingIndex({
    revision: 1,
    states: { one: state(1), two: state(1), other: { revision: 1, pools: { "appearance|MALE": pool(1100) } } },
  });
  const initial = a.categoryConfidence(people, category, "FEMALE", settings);
  assert.ok(calls() > 0);
  const warmed = calls();
  assert.equal(a.categoryEntries(people, category, "FEMALE", settings), initial.entries);
  assert.equal(a.categoryConfidence(people, { ...category }, "FEMALE", { ...settings }), initial);
  assert.equal(calls(), warmed, "equivalent settings and presentation renders reuse simulations");
  a.updatePerformerStates([{ id: "other", state: { revision: 2, pools: { "appearance|MALE": pool(1200) } } }]);
  assert.equal(a.categoryConfidence(people, category, "FEMALE", settings), initial);
  a.updatePerformerStates([
    {
      id: "one",
      state: {
        ...state(3),
        pools: {
          ...state(3).pools,
          "performance|FEMALE": pool(1400),
        },
      },
    },
  ]);
  assert.equal(a.categoryConfidence(people, category, "FEMALE", settings), initial);
  a.updatePerformerStates([{ id: "one", state: state(4, 250) }]);
  const refined = a.categoryConfidence(people, category, "FEMALE", settings);
  assert.notEqual(refined, initial, "deviation-only changes invalidate confidence");
  assert.equal(refined.entries[0].pool.deviation, 250);
  assert.ok(calls() > warmed);
  const changedGoal = a.categoryConfidence(people, category, "FEMALE", { ...settings, confidenceGoal: "ranking" });
  assert.notEqual(changedGoal, refined);
  const subset = a.categoryConfidence([people[0]], category, "FEMALE", settings);
  assert.equal(subset.eligible, 1, "different populations do not share confidence");
  const beforeReset = a.categoryConfidence(people, category, "FEMALE", settings);
  a.applyRatingIndex({ revision: 5, states: { one: state(5, 100) } });
  assert.notEqual(a.categoryConfidence(people, category, "FEMALE", settings), beforeReset);
});

test("score rebuild evaluates each distinct rating pair once with exact ties and saturated gaps", () => {
  const { algorithms: a, calls } = domain();
  const settings = a.settingsFromConfiguration({});
  const ratings = [-1e7, 800, 800, 1000, 1250, 1800, 1e7];
  const people = ratings.map((_rating, i) => performer(i));
  a.setOverallReferencePerformers(people);
  const states = Object.fromEntries(
    ratings.map((rating, i) => [i, { revision: 1, pools: { "appearance|FEMALE": pool(rating) } }]),
  );
  a.applyRatingIndex({ revision: 1, states });
  const scores = people.map(person => a.overallCategoryScoreFor(person, "appearance", "FEMALE", settings));
  const distinct = new Set(ratings).size;
  assert.equal(calls(), (distinct * (distinct - 1)) / 2);
  const scale = 173.7178;
  ratings.forEach((rating, i) => {
    const position =
      (100 *
        (ratings.filter(value => value < rating).length + (ratings.filter(value => value === rating).length - 1) / 2)) /
      (ratings.length - 1);
    const strength =
      (100 * (ratings.reduce((sum, opponent) => sum + 1 / (1 + Math.exp((opponent - rating) / scale)), 0) - 0.5)) /
      (ratings.length - 1);
    assert.ok(Math.abs(scores[i].position - position) < 1e-10);
    assert.ok(Math.abs(scores[i].strength - strength) < 1e-10);
    assert.ok(Math.abs(scores[i].rating - (0.8 * position + 0.2 * strength)) < 1e-10);
  });
  assert.equal(scores[1], scores[2], "tied ratings share the exact score object");
  const warm = calls();
  for (let i = 0; i < 1000; i++) a.overallCategoryScoreFor(people[i % people.length], "appearance", "FEMALE", settings);
  assert.equal(calls(), warm, "warm reads perform no exponentials");
});

function compareScores(actual, expected, people, settings, categories = ["appearance"]) {
  for (const categoryId of categories)
    for (const person of people) {
      const left = actual.overallCategoryScoreFor(person, categoryId, person.gender, settings);
      const right = expected.overallCategoryScoreFor(person, categoryId, person.gender, settings);
      for (const key of ["rating", "position", "strength"])
        assert.ok(
          Math.abs(left[key] - right[key]) < 1e-10,
          `${person.id} ${categoryId} ${key}: ${left[key]} vs ${right[key]}`,
        );
    }
}

test("accepted votes update warmed scores in linear work before one complete publication", () => {
  const { algorithms: actual, calls } = domain();
  const expected = domain().algorithms;
  const settings = actual.settingsFromConfiguration({});
  const people = Array.from({ length: 1200 }, (_, i) => performer(i));
  const male = performer("male", "MALE");
  people.push(male);
  const states = Object.fromEntries(
    people.map((person, i) => [
      person.id,
      {
        revision: 1,
        pools: {
          ["appearance|" + person.gender]: pool(500 + i),
          ["performance|" + person.gender]: pool(800 + i),
        },
      },
    ]),
  );
  for (const a of [actual, expected]) {
    a.setOverallReferencePerformers(people);
    a.applyRatingIndex({ revision: 1, states });
  }
  const oldScore = actual.overallCategoryScoreFor(people[0], "appearance", "FEMALE", settings);
  const oldValue = { ...oldScore };
  const unaffected = actual.overallCategoryScoreFor(people[0], "performance", "FEMALE", settings);
  const otherCohort = actual.overallCategoryScoreFor(male, "appearance", "MALE", settings);
  const warmed = calls();
  const updates = [
    {
      id: "0",
      state: { ...states["0"], revision: 2, pools: { ...states["0"].pools, "appearance|FEMALE": pool(1200) } },
    },
    {
      id: "1199",
      state: { ...states["1199"], revision: 2, pools: { ...states["1199"].pools, "appearance|FEMALE": pool(-1e9) } },
    },
  ];
  const publications = [];
  actual.subscribeToOverallSortSettings(() => {
    publications.push(
      updates.map(update => actual.overallCategoryScoreFor({ id: update.id }, "appearance", "FEMALE", settings)),
    );
  });
  actual.updatePerformerStates(updates);
  assert.equal(publications.length, 1);
  assert.ok(calls() - warmed < 6 * 1200, "a two-performer vote updates contributions instead of all rating pairs");
  assert.deepEqual({ ...oldScore }, oldValue, "previously published score objects are immutable");
  assert.equal(actual.overallCategoryScoreFor(people[0], "performance", "FEMALE", settings), unaffected);
  assert.equal(actual.overallCategoryScoreFor(male, "appearance", "MALE", settings), otherCohort);
  for (const update of updates) states[update.id] = update.state;
  expected.applyRatingIndex({ revision: 2, states });
  compareScores(actual, expected, people, settings, ["appearance", "performance"]);
  assert.deepEqual(
    publications[0],
    updates.map(update => actual.overallCategoryScoreFor({ id: update.id }, "appearance", "FEMALE", settings)),
  );
  const finished = calls();
  assert.equal(actual.updatePerformerStates(updates), false);
  assert.equal(calls(), finished, "repeated/stale replies do no score work");
});

test("repeated score updates preserve ties, additions, removals and numeric normalization", () => {
  const actual = domain().algorithms;
  const expected = domain().algorithms;
  const settings = actual.settingsFromConfiguration({});
  const people = Array.from({ length: 128 }, (_, i) => performer(i));
  const states = Object.fromEntries(
    people.map((person, i) => [
      person.id,
      {
        revision: 1,
        pools: { "appearance|FEMALE": pool(900 + (i % 24) * 10), "performance|FEMALE": pool(1000 + i) },
      },
    ]),
  );
  for (const a of [actual, expected]) {
    a.setOverallReferencePerformers(people);
    a.applyRatingIndex({ revision: 1, states });
  }
  compareScores(actual, expected, people, settings, ["appearance", "performance"]);
  for (let revision = 2; revision <= 1002; revision++) {
    const ids = [String((revision * 17) % people.length), String((revision * 17 + 31) % people.length)];
    const updates = ids.map((id, i) => ({
      id,
      state: {
        revision,
        pools: {
          ...states[id].pools,
          "appearance|FEMALE": pool(
            revision % 13 === 0
              ? "invalid"
              : revision % 17 === 0
                ? i
                  ? 1e9
                  : -1e9
                : 700 + ((revision + i * 7) % 45) * 10,
            300,
            revision % 7 === 0 ? 0 : 1,
          ),
        },
      },
    }));
    actual.updatePerformerStates(updates);
    for (const update of updates) states[update.id] = update.state;
    if (revision % 25 === 0 || revision === 1002) {
      expected.applyRatingIndex({ revision, states });
      compareScores(actual, expected, people, settings, ["appearance", "performance"]);
    }
  }
  const unknown = { revision: 1003, pools: { "appearance|FEMALE": pool(1000) } };
  actual.updatePerformerStates([{ id: "outside", state: unknown }]);
  states.outside = unknown;
  expected.applyRatingIndex({ revision: 1003, states });
  compareScores(actual, expected, people, settings);
  people.push(performer("outside"));
  for (const a of [actual, expected]) a.setOverallReferencePerformers(people);
  compareScores(actual, expected, people, settings);
  const changedSettings = { ...settings, initialRating: 1500 };
  compareScores(actual, expected, people, changedSettings);
});

test("bulk score removal, neutral populations and full snapshots rebuild consistently", () => {
  const { algorithms: actual, calls } = domain();
  const expected = domain().algorithms;
  const settings = actual.settingsFromConfiguration({});
  const people = Array.from({ length: 16 }, (_, i) => performer(i));
  const states = Object.fromEntries(
    people.map((person, i) => [person.id, { revision: 1, pools: { "appearance|FEMALE": pool(800 + i * 20) } }]),
  );
  for (const a of [actual, expected]) {
    a.setOverallReferencePerformers(people);
    a.applyRatingIndex({ revision: 1, states });
  }
  compareScores(actual, expected, people, settings);
  const warmed = calls();
  const updates = people.slice(0, 8).map(person => ({ id: person.id, state: { revision: 2, pools: {} } }));
  actual.updatePerformerStates(updates);
  assert.equal(calls() - warmed, 8, "a bulk removal rebuilds eight distinct shifted weights");
  for (const update of updates) states[update.id] = update.state;
  expected.applyRatingIndex({ revision: 2, states });
  compareScores(actual, expected, people, settings);
  const removed = people.slice(8).map(person => ({ id: person.id, state: { revision: 3, pools: {} } }));
  actual.updatePerformerStates(removed);
  for (const update of removed) states[update.id] = update.state;
  expected.applyRatingIndex({ revision: 3, states });
  compareScores(actual, expected, people, settings);
  for (const [revision, ids] of [
    [4, ["0"]],
    [5, ["1"]],
  ]) {
    const next = ids.map(id => ({ id, state: { revision, pools: { "appearance|FEMALE": pool(1000) } } }));
    actual.updatePerformerStates(next);
    for (const update of next) states[update.id] = update.state;
    expected.applyRatingIndex({ revision, states });
    compareScores(actual, expected, people, settings);
  }
  for (const a of [actual, expected])
    a.applyRatingIndex({ revision: 6, states: { 2: { revision: 6, pools: { "appearance|FEMALE": pool(1100) } } } });
  compareScores(actual, expected, people, settings);
});
