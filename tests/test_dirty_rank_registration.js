"use strict";
// DirtyRank claims its instance before registration side effects. If a later
// step throws, a Stash asset reload must not stack duplicate routes/patches.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../plugins/DirtyRank/dirtyRank.js"), "utf8");
const noop = function () {};

const calls = { routes: 0, patches: 0 };
let throwOnPatch = true;
const window = {
  DirtyPlugins: {
    getPluginSettings: function () { return Promise.resolve({}); },
    graphql: noop,
    runPluginOperation: function () { return Promise.resolve({ version: 2, revision: 0, states: {} }); },
    react: {},
    registerSettingsPanel: noop,
    values: {
      asObject: function (value) { return value && typeof value === "object" ? value : {}; },
      coerceBoolean: function (value, fallback) { return typeof value === "boolean" ? value : fallback; },
      parseMaybeJson: function (value) { return value; },
    },
  },
  PluginApi: {
    React: {
      Fragment: "fragment",
      createElement: noop,
      isValidElement: function () { return false; },
      useCallback: function (value) { return value; },
      useEffect: noop,
      useMemo: function (factory) { return factory(); },
      useRef: function (value) { return { current: value }; },
      useState: function (value) { return [typeof value === "function" ? value() : value, noop]; },
    },
    libraries: {
      Intl: { useIntl: function () { return { messages: {} }; } },
      ReactRouterDOM: { NavLink: noop },
    },
    patch: {
      after: function () { calls.patches += 1; if (throwOnPatch) throw new Error("registration failed"); },
      before: function () { calls.patches += 1; },
      instead: function () { calls.patches += 1; if (throwOnPatch) throw new Error("registration failed"); },
    },
    register: { route: function () { calls.routes += 1; } },
  },
  addEventListener: noop,
  location: { pathname: "/plugins/dirty-rank" },
};

assert.throws(
  function () { vm.runInNewContext(source, { window: window, console: { error: noop, warn: noop } }); },
  /registration failed/,
  "the harness must fail during registration"
);
assert.ok(window.__dirtyRankPlugin, "the instance key must be claimed before registration side effects");

throwOnPatch = false;
const routesAfterFailure = calls.routes;
const patchesAfterFailure = calls.patches;
vm.runInNewContext(source, { window: window, console: { error: noop, warn: noop } });

assert.equal(calls.routes, routesAfterFailure, "a reload must not re-register routes after a failed registration");
assert.equal(calls.patches, patchesAfterFailure, "a reload must not re-register patches after a failed registration");

console.log("DirtyRank registration guard tests passed");