"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { sourceFor } = require("./load_plugin_scripts");
const { installRegistration } = require("./shared_runtime");
const { events, element } = require("./ui_harness");
const source = sourceFor("DirtyRank");
const noop = () => {};
function host(failure) {
  const routes = [],
    patches = [],
    panels = new Map(),
    errors = [];
  const React = {
    Fragment: "fragment",
    createElement: element,
    useState: value => [typeof value === "function" ? value() : value, noop],
    useEffect: noop,
    useMemo: fn => fn(),
    useRef: value => ({ current: value }),
    useCallback: value => value,
  };
  const window = events({
    location: { pathname: "/plugins/dirty-rank", search: "" },
    PluginApi: {
      React,
      libraries: { Intl: { useIntl: () => ({ messages: {} }) }, ReactRouterDOM: { NavLink: "a", Prompt: "prompt" } },
      components: {},
      register: {
        route(path, component) {
          routes.push({ path, component });
          if (failure === "route" && routes.length === 2) throw Error("route failure");
        },
      },
      patch: Object.fromEntries(
        ["before", "after", "instead"].map(kind => [
          kind,
          (name, callback) => {
            patches.push({ kind, name, callback });
            if (failure === kind) throw Error("patch failure");
          },
        ]),
      ),
    },
    DirtyPlugins: {
      react: { useSettingsDraft: noop },
      graphql: async () => ({ findPerformers: { performers: [] } }),
      getPluginSettings: async () => ({}),
      runPluginOperation: async () => ({ revision: 0, states: {} }),
      registerSettingsPanel(id, component) {
        panels.set(id, component);
        if (failure === "panel") throw Error("panel failure");
      },
      debugLog: noop,
    },
  });
  const console = { error: (...args) => errors.push(args) };
  installRegistration(window, console);
  const context = vm.createContext({ window, URLSearchParams, console });
  return { window, routes, patches, panels, errors, load: () => vm.runInContext(source, context) };
}
// A failed registration is logged once and never retried by a reloaded bundle.
for (const failure of ["route", "panel", "before", "after", "instead"]) {
  const h = host(failure);
  h.load();
  const counts = [h.routes.length, h.patches.length];
  h.load();
  assert.deepEqual([h.routes.length, h.patches.length], counts, failure);
  assert.equal(h.errors.length, 1);
  assert.match(String(h.errors[0][0]), /\[dirtyRank\] registration failed/);
}
const h = host();
h.load();
assert.equal(h.routes.length, 5);
assert.equal(h.patches.length, 5);
assert.equal(h.panels.size, 1);
assert(
  !Object.keys(h.window).some(key => /^__dirtyRank(?:Settings|Rating|Matchmaking|BattleSession)/.test(key)),
  "feature modules never publish private globals",
);
assert.equal(h.routes[0].component.name, "DirtyRankRoute");
const nav = h.patches.find(p => p.name === "MainNavBar.UtilityItems").callback({ children: "Native" });
assert.equal(nav[0].children.children[0], "Native", "navigation preserves native children");
h.load();
assert.equal(h.routes.length, 5, "a reloaded bundle never registers twice");
assert.equal(h.patches.length, 5);
let nextCalls = 0;
assert.equal(
  h.patches
    .find(p => p.kind === "instead")
    .callback({}, () => {
      nextCalls++;
      return "Native list";
    }),
  "Native list",
);
assert.equal(nextCalls, 1);
console.log("DirtyRank compiled bundle: duplicate/partial registration and native fallthrough passed");
