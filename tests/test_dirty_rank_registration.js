"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const {sourceFor} = require("./load_plugin_scripts");
const {testModulePath} = require("./plugin_paths");
const {events, element} = require("./ui_harness");
const source = sourceFor("DirtyRank");
const noop = () => {};
function host(failure) {
  const routes = [], patches = [], panels = new Map(), errors = [];
  const React = {Fragment: "fragment", createElement: element, useState: value => [typeof value === "function" ? value() : value, noop],
    useEffect: noop, useMemo: fn => fn(), useRef: value => ({current: value}), useCallback: value => value};
  const window = events({location: {pathname: "/plugins/dirty-rank", search: ""}, PluginApi: {
    React, libraries: {Intl: {useIntl: () => ({messages: {}})}, ReactRouterDOM: {NavLink: "a", Prompt: "prompt"}},
    components: {}, register: {route(path, component) {routes.push({path, component}); if (failure === "route" && routes.length === 2) throw Error("route failure");}},
    patch: Object.fromEntries(["before", "after", "instead"].map(kind => [kind, (name, callback) => {
      patches.push({kind, name, callback}); if (failure === kind) throw Error("patch failure");
    }]))},
    DirtyPlugins: {values: require(testModulePath("DirtyPlugins", "values.cjs")),
      react: {useSettingsDraft: noop}, graphql: async () => ({findPerformers: {performers: []}}),
      getPluginSettings: async () => ({}), runPluginOperation: async () => ({revision: 0, states: {}}),
      registerSettingsPanel(id, component) {panels.set(id, component); if (failure === "panel") throw Error("panel failure");},
      unregisterSettingsPanel(id, component) {if (panels.get(id) === component) panels.delete(id);}, debugLog: noop}});
  const context = vm.createContext({window, URLSearchParams, console: {error: (...args) => errors.push(args)}});
  return {window, routes, patches, panels, errors, load: () => vm.runInContext(source, context)};
}
for (const missing of ["React", "graphql", "draft", "route", "values"]) {
  const h = host();
  if (missing === "React") delete h.window.PluginApi.React;
  if (missing === "graphql") delete h.window.DirtyPlugins.graphql;
  if (missing === "draft") delete h.window.DirtyPlugins.react.useSettingsDraft;
  if (missing === "route") delete h.window.PluginApi.register.route;
  if (missing === "values") delete h.window.DirtyPlugins.values;
  h.load(); assert.equal(h.window.__dirtyRankPlugin, undefined); assert.equal(h.routes.length, 0);
}
for (const failure of ["route", "panel", "before", "after", "instead"]) {
  const h = host(failure); h.load();
  const counts = [h.routes.length, h.patches.length];
  assert.equal(h.window.__dirtyRankPlugin.status, "failed", failure);
  assert.equal(h.panels.size, 0, "partial settings registration removes only its owned panel");
  assert.equal(h.window.handlers.get("dirty-plugins:configuration-changed")?.size || 0, 0);
  h.load(); assert.deepEqual([h.routes.length, h.patches.length], counts, "failed non-removable integrations retain the guard");
  assert.equal(h.errors.length, 1);
}
const early = host(), originalValues = early.window.DirtyPlugins.values;
early.window.DirtyPlugins.values = {...originalValues, asObject() {throw Error("domain setup failure");}};
early.load(); assert.equal(early.window.__dirtyRankPlugin, undefined, "failure before non-removable registration permits retry");
assert.equal(early.routes.length, 0);
early.window.DirtyPlugins.values = originalValues; early.load(); assert.equal(early.routes.length, 5);
early.window.__dirtyRankPlugin.destroy();
const brokenCleanup = host(); brokenCleanup.load();
brokenCleanup.window.DirtyPlugins.unregisterSettingsPanel = () => {throw Error("host cleanup failed");};
brokenCleanup.window.__dirtyRankPlugin.destroy();
assert.equal(brokenCleanup.window.handlers.get("dirty-plugins:configuration-changed").size, 0, "one failed cleanup cannot retain other owned listeners");
const h = host(); h.load();
assert.equal(h.window.__dirtyRankPlugin.status, "active");
assert.equal(h.routes.length, 5); assert.equal(h.patches.length, 5); assert.equal(h.panels.size, 1);
assert.equal(h.window.__dirtyCurrentPluginId, null);
assert(!Object.keys(h.window).some(key => /^__dirtyRank(?:Settings|Rating|Matchmaking|BattleSession)/.test(key)), "feature modules never publish private globals");
const firstRoute = h.routes[0].component({}); assert.equal(firstRoute.type.name, "DirtyRankRoute");
const nav = h.patches.find(p => p.name === "MainNavBar.UtilityItems").callback({children: "Native"});
assert.equal(nav[0].children.children[0], "Native", "navigation preserves native children");
h.load(); assert.equal(h.routes.length, 5); assert.equal(h.patches.length, 5);
h.window.__dirtyRankPlugin.destroy();
assert.equal(h.panels.size, 0); assert.equal(h.routes[0].component({}), null);
assert.equal(h.window.handlers.get("dirty-plugins:configuration-changed").size, 0);
const props = {children: "Native"}; assert.equal(h.patches.find(p => p.name === "MainNavBar.UtilityItems").callback(props)[0], props);
let nextCalls = 0;
assert.equal(h.patches.find(p => p.kind === "instead").callback({}, () => {nextCalls++; return "Native list";}), "Native list");
assert.equal(nextCalls, 1); h.load(); assert.equal(h.routes.length, 5);
console.log("DirtyRank compiled bundle: dependencies, duplicate/partial registration, native fallthrough and owned cleanup passed");
