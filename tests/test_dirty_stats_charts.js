"use strict";
const { testModulePath } = require("./plugin_paths");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const context = { window: {} };
vm.createContext(context);
context.module = {exports: {}};
vm.runInContext(fs.readFileSync(testModulePath("DirtyStats", "charts.cjs"), "utf8"), context);
const { mountChart } = context.module.exports;
const calls = [], listeners = new Map(), ref = { current: null };
const chart = { resize: () => calls.push("resize"), isDisposed: () => false, dispose: () => calls.push("dispose") };
const dependencies = {
  init: () => chart,
  Observer: class { constructor(callback) { this.callback = callback; } observe() { calls.push("observe"); } disconnect() { calls.push("disconnect"); } },
  events: { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
};
const cleanup = mountChart({ node: {}, chartRef: ref, configure: () => calls.push("configure"),
  resize: () => calls.push("map geometry"), beforeDispose: () => calls.push("save zoom"), onError: error => { throw error; } }, dependencies);
assert.equal(ref.current, chart, "export reference points at mounted chart");
listeners.get("resize")();
cleanup(); cleanup();
assert.deepEqual(calls, ["configure", "observe", "resize", "map geometry", "disconnect", "save zoom", "dispose"]);
assert.equal(ref.current, null);
assert.equal(listeners.size, 0);
let error;
mountChart({ node: {}, chartRef: ref, configure: () => { throw Error("invalid option"); }, onError: value => { error = value; } }, dependencies);
assert.equal(error.message, "invalid option");
assert.equal(ref.current, null, "partially initialized charts are released after setup failure");
const owned = new Set();
const ownedCleanup = mountChart({node: {}, chartRef: ref, configure() {}, onError: value => { throw value; }},
  {...dependencies, own: release => { owned.add(release); return () => owned.delete(release); }});
assert.equal(owned.size, 1);
for (const release of owned) release();
ownedCleanup();
assert.equal(owned.size, 0, "instance destruction deregisters chart cleanup before route unmount");
assert.equal(ref.current, null);
assert.equal(listeners.size, 0);
const throwingCleanup = mountChart({node: {}, chartRef: ref, configure() {}, onError() {}},
  {...dependencies, init: () => ({...chart, dispose() {throw Error("native disposal");}})});
assert.throws(throwingCleanup, /native disposal/);
assert.equal(ref.current, null, "a native dispose failure cannot leave a stale export reference");
throwingCleanup();
console.log("Stats chart resize, export reference, zoom cleanup and setup failure passed");
