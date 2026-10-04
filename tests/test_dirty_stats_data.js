"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = { window: {}, AbortController };
vm.createContext(context);
vm.runInContext(fs.readFileSync("plugins/DirtyStats/dirtyStatsData.js", "utf8"), context);
const { fetchAllPages, createLoader } = context.window.__dirtyStatsData;
const tick = () => new Promise(setImmediate);
async function main() {
  const controller = new AbortController(), pages = [];
  const request = {
    signal: controller.signal, query: "query", variables: page => ({ page, per_page: 500 }),
    collection: response => response, failureLabel: "changed",
    graphql: async (_query, variables) => {
      pages.push(variables);
      return { count: 3, rows: variables.page === 1 ? [1, 2] : [3] };
    }
  };
  assert.deepEqual(Array.from(await fetchAllPages(request)), [1, 2, 3]);
  assert.deepEqual(pages, [{ page: 1, per_page: 500 }, { page: 2, per_page: 500 }]);
  assert.deepEqual(Array.from(await fetchAllPages({ ...request, singlePage: true })), [1, 2]);
  await assert.rejects(fetchAllPages({ ...request, graphql: async () => ({ count: 1, rows: [] }) }), /changed/);
  controller.abort();
  assert.deepEqual(Array.from(await fetchAllPages(request)), []);

  let cleanup, completeOld;
  const published = [], status = [];
  const loader = createLoader({ React: { useEffect: effect => { cleanup = effect(); } },
    graphql: () => new Promise(resolve => { completeOld = resolve; }) });
  const options = { ...request, setLoading: value => status.push(value), setError() {}, publish: rows => published.push(rows) };
  loader.usePageLoad(options, ["old filter"]);
  cleanup();
  completeOld({ count: 1, rows: ["stale"] });
  await tick();
  assert.equal(published.length, 0, "aborted filter response cannot publish data or completion");
  assert.deepEqual(status, [true]);
  const fresh = createLoader({ React: { useEffect: effect => { cleanup = effect(); } }, graphql: async () => ({ count: 1, rows: ["new"] }) });
  fresh.usePageLoad(options, ["new filter"]);
  await tick();
  assert.deepEqual(Array.from(published[0]), ["new"]);
  assert.equal(status.at(-1), false);
  cleanup();
  console.log("Stats pagination, bounded requests and stale-response protection passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
