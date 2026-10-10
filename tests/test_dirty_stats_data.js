"use strict";
const { runSource } = require("./plugin_paths");
const assert = require("node:assert/strict");
const { createHooks } = require("./ui_harness");
/** The page loader bound to the given host React and hub GraphQL client. */
function createLoader({ React, graphql }) {
  const window = { PluginApi: { React }, DirtyPlugins: { graphql } };
  return runSource(
    "DirtyStats",
    "src/domain/data.ts",
    { window, AbortController },
    {
      external: ["./echarts"],
      modules: { "./echarts": {} },
    },
  );
}
const { fetchAllPages } = createLoader({ React: {}, graphql() {} });
const tick = () => new Promise(setImmediate);
async function main() {
  const controller = new AbortController(),
    pages = [];
  const request = {
    signal: controller.signal,
    query: "query",
    variables: page => ({ page, per_page: 500 }),
    collection: response => response,
    failureLabel: "changed",
    graphql: async (_query, variables) => {
      pages.push(variables);
      return { count: 3, rows: variables.page === 1 ? [1, 2] : [3] };
    },
  };
  assert.deepEqual(Array.from(await fetchAllPages(request)), [1, 2, 3]);
  assert.deepEqual(pages, [
    { page: 1, per_page: 500 },
    { page: 2, per_page: 500 },
  ]);
  assert.deepEqual(Array.from(await fetchAllPages({ ...request, singlePage: true })), [1, 2]);
  await assert.rejects(fetchAllPages({ ...request, graphql: async () => ({ count: 1, rows: [] }) }), /changed/);
  controller.abort();
  assert.deepEqual(Array.from(await fetchAllPages(request)), []);

  let cleanup, completeOld;
  const published = [],
    status = [];
  const loader = createLoader({
    React: {
      useEffect: effect => {
        cleanup = effect();
      },
    },
    graphql: () =>
      new Promise(resolve => {
        completeOld = resolve;
      }),
  });
  const options = {
    ...request,
    setLoading: value => status.push(value),
    setError() {},
    publish: rows => published.push(rows),
  };
  loader.usePageLoad(options, ["old filter"]);
  cleanup();
  completeOld({ count: 1, rows: ["stale"] });
  await tick();
  assert.equal(published.length, 0, "aborted filter response cannot publish data or completion");
  assert.deepEqual(status, [true]);
  const fresh = createLoader({
    React: {
      useEffect: effect => {
        cleanup = effect();
      },
    },
    graphql: async () => ({ count: 1, rows: ["new"] }),
  });
  fresh.usePageLoad(options, ["new filter"]);
  await tick();
  assert.deepEqual(Array.from(published[0]), ["new"]);
  assert.equal(status.at(-1), false);
  cleanup();
  const owner = { slots: [], effects: [], cursor: 0 },
    requests = [],
    loaded = [];
  const entityLoader = createLoader({
    React: createHooks(() => owner),
    graphql: (_query, variables, options) =>
      new Promise((resolve, reject) => requests.push({ variables, signal: options.signal, resolve, reject })),
  });
  function render(entity, key, extra = {}) {
    owner.cursor = 0;
    const page = entityLoader.usePageData();
    page.useLoad(
      { query: "entity", variables: request.variables, entity, onLoaded: rows => loaded.push(rows), ...extra },
      [entity, key],
    );
    owner.effects.splice(0).forEach(effect => effect());
    return page;
  }
  assert.equal(render("scenes", "first").loading, true);
  requests[0].resolve({ findScenes: { count: 1, scenes: ["scene"] } });
  await tick();
  let page = render("scenes", "first");
  assert.deepEqual(Array.from(page.rows), ["scene"]);
  assert.equal(page.loading, false);
  assert.equal(loaded.length, 1, "custom publication runs once after rows are stored");
  assert.deepEqual(requests[0].variables, { page: 1, per_page: 500 });
  page.setError("chart unavailable");
  assert.equal(
    render("scenes", "first").error,
    "chart unavailable",
    "ratings can publish chart errors through the shared state",
  );
  render("scenes", "stale");
  render("performers", "current");
  assert.equal(requests[1].signal.aborted, true, "changing the entity/filter cancels the old request");
  requests[1].resolve({ findScenes: { count: 1, scenes: ["stale"] } });
  requests[2].resolve({ findPerformers: { count: 1, performers: ["performer"] } });
  await tick();
  page = render("performers", "current");
  assert.deepEqual(Array.from(page.rows), ["performer"]);
  assert.equal(page.error, "");
  assert.equal(loaded.length, 2, "the stale request cannot run a custom publication callback");
  render("performers", "empty");
  requests[3].resolve({ findPerformers: { count: 1, performers: [] } });
  await tick();
  page = render("performers", "empty");
  assert.equal(page.error, "The performer list changed while loading. Refresh to try again.");
  assert.equal(page.loading, false);
  render("scenes", "custom", { failureLabel: "custom failure" });
  requests[4].resolve({ findScenes: { count: 1, scenes: [] } });
  await tick();
  assert.equal(render("scenes", "custom").error, "custom failure", "caller-specific failure wording is preserved");
  owner.slots.forEach(slot => {
    if (slot?.cleanup) slot.cleanup();
  });
  console.log("Stats pagination, bounded requests and stale-response protection passed");
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
