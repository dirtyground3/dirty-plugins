"use strict";
const vm = require("node:vm");
const { requireSource } = require("./plugin_paths");
const { runRankDomain } = require("./rank_modules");

/** Only native host interfaces are stubbed; calculations use manifest assets. */
function domainAlgorithms() {
  const noop = () => {};
  const React = {
    createElement: noop,
    Fragment: "fragment",
    useCallback: value => value,
    useEffect: noop,
    useMemo: fn => fn(),
    useRef: value => ({ current: value }),
    useState: value => [value, noop],
  };
  const context = vm.createContext({
    window: {
      addEventListener: noop,
      removeEventListener: noop,
      location: { search: "", pathname: "/" },
      PluginApi: {
        React,
        libraries: { Intl: { useIntl: () => ({ messages: {} }) }, ReactRouterDOM: { NavLink: noop } },
        patch: { before: noop, after: noop, instead: noop },
        register: { route: noop },
      },
      DirtyPlugins: {
        react: {},
        registerSettingsPanel: noop,
        getPluginSettings: async () => ({}),
        graphql: async () => ({}),
        runPluginOperation: async () => ({}),
      },
    },
    console,
    URLSearchParams,
  });
  const rank = runRankDomain(context);
  return { rank, compactor: requireSource("DirtyCompactor", "src/domain/rules.ts") };
}
module.exports = { domainAlgorithms };
