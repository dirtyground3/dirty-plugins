"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const { loadPluginScripts } = require("./load_plugin_scripts");
const { testModulePath } = require("./plugin_paths");

/** Only native host interfaces are stubbed; calculations use manifest assets. */
function domainAlgorithms() {
  const noop = () => {};
  const React = {createElement: noop, Fragment: "fragment", useCallback: value => value,
    useEffect: noop, useMemo: fn => fn(), useRef: value => ({current: value}), useState: value => [value, noop]};
  const context = vm.createContext({window: {
    addEventListener: noop, removeEventListener: noop,
    location: {search: "", pathname: "/"},
    PluginApi: {React, libraries: {Intl: {useIntl: () => ({messages: {}})}, ReactRouterDOM: {NavLink: noop}},
      patch: {before: noop, after: noop, instead: noop}, register: {route: noop}},
    DirtyPlugins: {react: {}, registerSettingsPanel: noop,
      getPluginSettings: async () => ({}), graphql: async () => ({}), runPluginOperation: async () => ({})}
  }, console, URLSearchParams});
  context.window.DirtyPlugins.values = require("./shared_runtime").loadFeature(context.window, "Values");
  const rank = require(testModulePath("DirtyRank", "rank.cjs")).createRankDomain({
    DirtyPlugins: context.window.DirtyPlugins, PluginApi: context.window.PluginApi,
  });
  return {rank,
    compactor: require(testModulePath("DirtyCompactor", "rules.cjs"))};
}
module.exports = {domainAlgorithms};
