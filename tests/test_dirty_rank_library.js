"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { runRankDomain } = require("./rank_modules");
function domain(graphql) {
  return runRankDomain({
    window: {
      PluginApi: {},
      DirtyPlugins: {
        graphql,
        getPluginSettings: async () => ({}),
        native: {},
        runPluginOperation: async () => ({ states: {} }),
      },
    },
  });
}
test("Rank coalesces compatible performer requests, preserves the whole population, and refreshes explicitly", async () => {
  const calls = [],
    people = Array.from({ length: 1201 }, (_, i) => ({ id: String(i), name: "P" + i, gender: "FEMALE" }));
  const a = domain(async (query, variables) => {
    calls.push({ query, variables });
    const { page, per_page: size } = variables.filter;
    return { findPerformers: { count: people.length, performers: people.slice((page - 1) * size, page * size) } };
  });
  const light = a.queryPerformers(),
    heavy = a.queryPerformers(true);
  assert.strictEqual(light, heavy, "a queued lightweight query upgrades to the card superset");
  const result = await heavy;
  assert.equal(result.length, 1201);
  assert.equal(new Set(result.map(person => person.id)).size, 1201);
  assert.equal(calls.length, 3);
  assert(calls.every(call => call.query.includes("favorite rating100 o_counter")));
  assert.strictEqual(await a.queryPerformers(false, { refresh: false }), result);
  assert.equal(calls.length, 3);
  await a.refreshOverallSortSettings();
  assert.equal(calls.length, 3, "settings refresh never reloads the library");
  a.invalidateRankLibrary();
  await a.queryPerformers(true, { refresh: false });
  assert.equal(calls.length, 6);
  await a.queryPerformers(true);
  assert.equal(calls.length, 9, "route entry/default refresh sees native library edits");
});
test("invalidated performer responses cannot replace a newer reference population", async () => {
  const pending = [];
  const a = domain(() => new Promise(resolve => pending.push(resolve)));
  const old = a.queryPerformers(true);
  await Promise.resolve();
  a.invalidateRankLibrary();
  const current = a.queryPerformers(true);
  await Promise.resolve();
  pending[1]({ findPerformers: { count: 1, performers: [{ id: "new" }] } });
  const result = await current;
  pending[0]({ findPerformers: { count: 1, performers: [{ id: "old" }] } });
  await old;
  assert.strictEqual(await a.queryPerformers(true, { refresh: false }), result);
});
test("preferred Rank media bounds both requests, preserves rating ties and nullable ratings, and invalidates", async () => {
  const calls = [],
    top = { id: "top", rating100: 100 },
    marked = { id: "marked", rating100: 80 };
  let reply;
  const a = domain(async (query, variables, options) => {
    calls.push({ query, variables, options });
    return query.includes("EarliestMarker")
      ? { markers: { scene_markers: reply || [] } }
      : { top: { scenes: [top] }, marked: { scenes: [marked] } };
  });
  reply = [{ id: "earliest", seconds: 1, end_seconds: 3, scene: { id: "tied-scene", rating100: 80 } }];
  const first = await a.loadPreferredMedia("person", false);
  assert.equal(first.id, "tied-scene");
  assert.equal(first.marker.id, "earliest");
  assert.equal(calls.length, 2);
  assert(calls.every(call => call.variables.filter.per_page === 1));
  assert.equal(calls[0].variables.markedFilter.has_markers, "true");
  assert.equal(calls[1].variables.filter.sort, "seconds");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[1].variables.markerFilter.scene_filter)), {
    rating100: { value: 80, modifier: "EQUALS" },
  });
  await a.loadPreferredMedia("person", false);
  assert.equal(calls.length, 2);
  await a.loadPreferredMedia("person", true);
  assert.equal(calls.length, 3);
  assert.equal(calls.at(-1).variables.includeMarkers, false);
  marked.rating100 = null;
  reply = [];
  a.invalidatePerformerMedia();
  assert.equal((await a.loadPreferredMedia("person", false)).id, "top");
  assert.equal(calls.at(-1).variables.markerFilter.scene_filter.rating100.modifier, "IS_NULL");
  const controller = new AbortController();
  controller.abort();
  a.invalidatePerformerMedia();
  await a.loadPreferredMedia("person", false, controller.signal);
  const before = calls.length;
  await a.loadPreferredMedia("person", false);
  assert.equal(calls.length, before + 2, "cancelled media is never cached");
});
