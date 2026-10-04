"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const { loadPluginScripts } = require("./load_plugin_scripts");
const htm = require("../plugins/DirtyPlugins/vendor/htm.umd.js");

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
    DirtyPlugins: {react: {html: htm.bind(noop)}, registerSettingsPanel: noop,
      getPluginSettings: async () => ({}), graphql: async () => ({}), runPluginOperation: async () => ({})}
  }, console, URLSearchParams});
  vm.runInContext(fs.readFileSync("plugins/DirtyPlugins/dirtyPluginsValues.js", "utf8"), context);
  context.window.DirtyPlugins.values = context.window.__dirtyPluginsValues;
  loadPluginScripts("DirtyRank", context);
  loadPluginScripts("DirtyCompactor", context);
  return {rank: context.window.__dirtyRankPlugin.algorithms, compactor: context.window.__dirtyCompactorRules};
}
module.exports = {domainAlgorithms};
