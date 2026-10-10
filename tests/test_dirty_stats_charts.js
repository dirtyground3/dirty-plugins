"use strict";
const { runSource } = require("./plugin_paths");
const assert = require("node:assert/strict");
const { mountChart } = runSource(
  "DirtyStats",
  "src/domain/charts.ts",
  { window: {} },
  {
    external: ["./echarts"],
    modules: { "./echarts": {} },
  },
);
const calls = [],
  listeners = new Map(),
  ref = { current: null };
const chart = { resize: () => calls.push("resize"), isDisposed: () => false, dispose: () => calls.push("dispose") };
const dependencies = {
  init: () => chart,
  Observer: class {
    constructor(callback) {
      this.callback = callback;
    }
    observe() {
      calls.push("observe");
    }
    disconnect() {
      calls.push("disconnect");
    }
  },
  events: {
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: name => listeners.delete(name),
  },
};
const cleanup = mountChart(
  {
    node: {},
    chartRef: ref,
    configure: () => calls.push("configure"),
    resize: () => calls.push("map geometry"),
    beforeDispose: () => calls.push("save zoom"),
    onError: error => {
      throw error;
    },
  },
  dependencies,
);
assert.equal(ref.current, chart, "export reference points at mounted chart");
listeners.get("resize")();
cleanup();
cleanup();
assert.deepEqual(calls, ["configure", "observe", "resize", "map geometry", "disconnect", "save zoom", "dispose"]);
assert.equal(ref.current, null);
assert.equal(listeners.size, 0);
let error;
mountChart(
  {
    node: {},
    chartRef: ref,
    configure: () => {
      throw Error("invalid option");
    },
    onError: value => {
      error = value;
    },
  },
  dependencies,
);
assert.equal(error.message, "invalid option");
assert.equal(ref.current, null, "partially initialized charts are released after setup failure");
const throwingCleanup = mountChart(
  { node: {}, chartRef: ref, configure() {}, onError() {} },
  {
    ...dependencies,
    init: () => ({
      ...chart,
      dispose() {
        throw Error("native disposal");
      },
    }),
  },
);
assert.throws(throwingCleanup, /native disposal/);
assert.equal(ref.current, null, "a native dispose failure cannot leave a stale export reference");
throwingCleanup();
console.log("Stats chart resize, export reference, zoom cleanup and setup failure passed");
