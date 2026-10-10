"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { runSource } = require("./plugin_paths");
const { runRankDomain } = require("./rank_modules");
const { createRenderer, element, text } = require("./ui_harness");

function scheduler() {
  const tasks = [];
  let closed = 0;
  class MessageChannel {
    constructor() {
      this.port1 = { onmessage: null, close: () => closed++ };
      this.port2 = { postMessage: () => tasks.push(() => this.port1.onmessage()), close: () => closed++ };
    }
  }
  async function drain() {
    for (let step = 0; step < 10000; step++) {
      for (let i = 0; i < 12; i++) await Promise.resolve();
      if (!tasks.length) return;
      tasks.shift()();
    }
    throw new Error("Score preparation did not settle");
  }
  return { MessageChannel, tasks, drain, closed: () => closed };
}
function scoreModule(clock, extra = {}) {
  return runSource("DirtyRank", "src/domain/scores.ts", {
    AbortController,
    MessageChannel: clock.MessageChannel,
    ...extra,
  });
}
function expectedScores(entries) {
  const ratings = entries.map(entry => entry.rating);
  return new Map(
    entries.map(entry => {
      const n = ratings.length;
      const position =
        n > 1
          ? (100 *
              (ratings.filter(r => r < entry.rating).length +
                (ratings.filter(r => r === entry.rating).length - 1) / 2)) /
            (n - 1)
          : 50;
      const strength =
        n > 1
          ? (100 * (ratings.reduce((sum, r) => sum + 1 / (1 + Math.exp((r - entry.rating) / 173.7178)), 0) - 0.5)) /
            (n - 1)
          : 50;
      return [entry.id, { position, strength, rating: 0.8 * position + 0.2 * strength }];
    }),
  );
}
function parity(index, expected) {
  for (const [id, value] of expected)
    for (const key of ["rating", "position", "strength"])
      assert.ok(Math.abs(index.performers.get(id).score[key] - value[key]) < 1e-10, `${id} ${key}`);
}
const entriesFor = n => Array.from({ length: n }, (_, i) => ({ id: String(i), rating: 500 + (i / n) * 1500 }));

test("cold shifted weights preserve direct logistic scores and use one exponential per distinct rating", () => {
  const clock = scheduler();
  const math = Object.create(Math);
  let calls = 0;
  math.exp = value => {
    calls++;
    return Math.exp(value);
  };
  const scores = scoreModule(clock, { Math: math });
  for (const offset of [0, -1000000, 998000]) {
    const entries = entriesFor(400).map(entry => ({ ...entry, rating: offset + Math.floor(entry.rating / 5) * 5 }));
    calls = 0;
    const index = scores.buildCategoryScoreIndex(entries);
    assert.equal(calls, new Set(entries.map(entry => entry.rating)).size);
    parity(index, expectedScores(entries));
  }
  // Just inside/outside the finite-weight boundary, including close pairs far
  // below the highest rating where naive unbounded weights would become zero.
  for (const span of [511.999, 512, 512.001, 20000]) {
    const entries = [-1000000, -999999.99, -999900, -1000000 + span * 173.7178].map((rating, i) => ({
      id: String(i),
      rating,
    }));
    calls = 0;
    parity(scores.buildCategoryScoreIndex(entries), expectedScores(entries));
    assert.equal(calls, span <= 512 ? 4 : 6);
  }
  assert.equal(clock.tasks.length, 0, "synchronous callers consume the same work without scheduling");
});

test("asynchronous score construction yields bounded batches, preserves exact addition order and closes ports", async () => {
  const clock = scheduler();
  const scores = scoreModule(clock);
  const entries = entriesFor(600);
  const expected = scores.buildCategoryScoreIndex(entries);
  let result;
  const pending = scores.buildCategoryScoreIndexAsync(entries).then(index => {
    result = index;
  });
  assert.equal(result, undefined, "no partial index is published");
  let chunks = 0;
  while (clock.tasks.length) {
    chunks++;
    clock.tasks.shift()();
    for (let i = 0; i < 4; i++) await Promise.resolve();
  }
  await pending;
  assert.equal(chunks, Math.floor((600 * 599) / 2 / 32768));
  assert.equal(clock.closed(), 2);
  for (const [id, group] of expected.performers)
    assert.deepEqual({ ...result.performers.get(id).score }, { ...group.score });
});

test("cancelled score construction never publishes an index and releases its message ports", async () => {
  const clock = scheduler();
  const scores = scoreModule(clock);
  const controller = new AbortController();
  const pending = scores.buildCategoryScoreIndexAsync(entriesFor(600), controller.signal);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  controller.abort();
  await clock.drain();
  await rejected;
  assert.equal(clock.closed(), 2);
  await assert.rejects(scores.buildCategoryScoreIndexAsync(entriesFor(600), controller.signal), { name: "AbortError" });
  assert.equal(clock.tasks.length, 0, "an already cancelled request schedules nothing");
});

function rank(clock, React = {}) {
  const window = { PluginApi: { React }, DirtyPlugins: { react: {} } };
  const globals = { window, AbortController, MessageChannel: clock.MessageChannel };
  return { globals, domain: runRankDomain(globals) };
}
function seed(domain, count = 600) {
  const people = entriesFor(count).map(entry => ({ id: entry.id, gender: "FEMALE", image_path: "/synthetic.svg" }));
  const states = Object.fromEntries(
    entriesFor(count).map(entry => [
      entry.id,
      {
        revision: 1,
        pools: Object.fromEntries(
          ["appearance", "performance"].map(category => [
            category + "|FEMALE",
            {
              rating: entry.rating,
              matches: 1,
              deviation: 300,
              volatility: 0.06,
            },
          ]),
        ),
      },
    ]),
  );
  domain.setOverallReferencePerformers(people);
  domain.applyRatingIndex({ revision: 1, states });
  return { people, states, settings: domain.settingsFromConfiguration({}) };
}

test("shared cold preparations coalesce, retry changed pools and retain unrelated work", async () => {
  const clock = scheduler();
  const math = Object.create(Math);
  let calls = 0;
  math.exp = value => {
    calls++;
    return Math.exp(value);
  };
  const { globals } = rank(clock);
  const domain = runRankDomain({ ...globals, Math: math });
  const { people, states, settings } = seed(domain);
  const first = domain.prepareOverallScores(settings, ["FEMALE"]);
  const cancelled = new AbortController();
  const second = domain.prepareOverallScores(settings, ["FEMALE"], cancelled.signal);
  assert.equal(calls, 1200, "equivalent callers share both category preparations");
  assert.equal(domain.overallScoresReady(settings, ["FEMALE"]), false);
  cancelled.abort();
  states["0"] = {
    revision: 2,
    pools: {
      ...states["0"].pools,
      "appearance|FEMALE": {
        ...states["0"].pools["appearance|FEMALE"],
        rating: 1050,
      },
    },
  };
  domain.updatePerformerStates([{ id: "0", state: states["0"] }]);
  await clock.drain();
  await Promise.all([first, second]);
  assert.equal(calls, 1799, "only the obsolete Appearance build restarts, with one new rating tie");
  assert.equal(domain.overallScoresReady(settings, ["FEMALE"]), true);
  const score = domain.overallCategoryScoreFor(people[0], "appearance", "FEMALE", settings);
  const ratings = entriesFor(600);
  ratings[0].rating = 1050;
  for (const key of ["rating", "position", "strength"])
    assert.ok(Math.abs(score[key] - expectedScores(ratings).get("0")[key]) < 1e-10);
  await domain.prepareOverallScores(settings, ["FEMALE"]);
  assert.equal(calls, 1799, "complete preparations do no further math");
});

test("reference refresh during preparation cannot restore removed performers", async () => {
  const clock = scheduler();
  const { domain } = rank(clock);
  const { people, settings } = seed(domain);
  const pending = domain.prepareOverallScores(settings, ["FEMALE"]);
  domain.setOverallReferencePerformers(people.slice(0, 350));
  await clock.drain();
  await pending;
  const removed = domain.overallCategoryScoreFor(people[599], "appearance", "FEMALE", settings);
  assert.deepEqual({ ...removed }, { rating: 50, position: 50, strength: 50 });
  const expected = expectedScores(entriesFor(600).slice(0, 350));
  const actual = domain.overallCategoryScoreFor(people[349], "appearance", "FEMALE", settings);
  for (const key of ["rating", "position", "strength"])
    assert.ok(Math.abs(actual[key] - expected.get("349")[key]) < 1e-10);
});

test("native overall sorting waits for complete scores, ignores unmounted completion and renders warm votes immediately", async () => {
  const clock = scheduler();
  const renderer = createRenderer();
  const React = { ...renderer.hooks, createElement: element, Fragment: "fragment" };
  const { globals } = rank(clock, React);
  globals.window.DirtyPlugins.react.StateView = props => element("state", props, props.title);
  const api = runSource("DirtyRank", "cold-ui.ts", globals, {
    contents:
      'export * from "./src/domain/rank"; export * from "./src/domain/settings"; export * from "./src/components/Native";',
  });
  const { people, states } = seed(api);
  let nativeCalls = 0;
  const listProps = { performers: people, filter: {} };
  const root = () =>
    element(api.DirtyRankSortedPerformerList, {
      listProps,
      next: props => {
        nativeCalls++;
        return element("rows", {}, ...props.performers.map(person => person.id));
      },
    });
  renderer.render(root());
  assert.match(text(renderer.tree), /Calculating DirtyRank scores/);
  assert.equal(nativeCalls, 0, "native rows never see incomplete neutral scores");
  renderer.unmount();
  await clock.drain();
  assert.equal(renderer.changed, false, "an unmounted preparation cannot update hook state");
  renderer.render(root());
  await renderer.flush(() => renderer.render(root()));
  assert.ok(nativeCalls > 0);
  const before = nativeCalls;
  api.updatePerformerStates([
    {
      id: "0",
      state: {
        revision: 2,
        pools: {
          ...states["0"].pools,
          "appearance|FEMALE": { ...states["0"].pools["appearance|FEMALE"], rating: 2200 },
        },
      },
    },
  ]);
  renderer.render(root());
  assert.equal(nativeCalls, before + 1);
  assert.equal(clock.tasks.length, 0, "warm accepted votes do not suspend rendering");
  renderer.unmount();
});

test("overall leaderboard ordering reads each normalized category pool once per performer", () => {
  const clock = scheduler();
  const { domain } = rank(clock);
  const { people, states, settings } = seed(domain, 80);
  let reads = 0;
  for (const state of Object.values(states)) {
    const pool = state.pools["appearance|FEMALE"];
    const rating = pool.rating;
    Object.defineProperty(pool, "rating", {
      get() {
        reads++;
        return rating;
      },
    });
  }
  domain.overallCategoryScoreFor(people[0], "appearance", "FEMALE", settings);
  domain.overallCategoryScoreFor(people[0], "performance", "FEMALE", settings);
  reads = 0;
  const sorted = domain.rankOverallPerformers([...people].reverse(), "FEMALE", settings);
  assert.equal(reads, people.length, "sorting compares retained scores instead of rebuilding pools per comparison");
  assert.deepEqual(
    Array.from(sorted, person => person.id),
    [...people].reverse().map(person => person.id),
  );
});
