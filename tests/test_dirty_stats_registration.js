"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const { runtimePath, sourcePath } = require("./plugin_paths");
const { pluginFor } = require("../scripts/build-lib.cjs");
const { element } = require("./ui_harness");
const { installRegistration } = require("./shared_runtime");
const code = fs.readFileSync(runtimePath("DirtyStats", "dirtyStats.js"), "utf8");
const manifest = fs.readFileSync(runtimePath("DirtyStats", "dirtyStats.yml"), "utf8");
assert.match(manifest, /javascript:\s*\n\s*- dirtyStats\.js\s*\n\s*css:/);
assert(!code.includes("sourceMappingURL"), "release bundles carry no source map");
// The build's boundary plugin admits only Stats source and these declared packages.
assert.deepEqual(pluginFor("DirtyStats").bundledPackages, ["echarts", "zrender", "tslib"]);
assert(code.includes("DirtyStats bundles parts of Apache ECharts 5.6.0"), "bundle keeps its third-party attribution");
// Every series type the views configure must be registered by the modular import.
const registered = fs.readFileSync(sourcePath("DirtyStats", "src/echarts.ts"), "utf8");
const sourceFiles = dir =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => (entry.isDirectory() ? sourceFiles(dir + "/" + entry.name) : [dir + "/" + entry.name]));
const seriesTypes = new Set(
  sourceFiles(sourcePath("DirtyStats", "src"))
    .filter(file => /\.tsx?$/.test(file) && !file.endsWith("echarts.ts"))
    .flatMap(file =>
      [
        ...fs
          .readFileSync(file, "utf8")
          .matchAll(
            /type: *"(line|bar|pie|scatter|effectScatter|radar|map|tree|treemap|graph|gauge|funnel|parallel|sankey|boxplot|candlestick|lines|heatmap|pictorialBar|themeRiver|sunburst|custom)"/g,
          ),
      ].map(match => match[1]),
    ),
);
assert(seriesTypes.size >= 7, "series inventory found");
for (const type of seriesTypes)
  assert(
    new RegExp("\\b" + type[0].toUpperCase() + type.slice(1) + "Chart\\b").test(registered),
    "modular ECharts must register the " + type + " series",
  );
function fixture(fail = {}) {
  const routes = [],
    patches = [],
    listeners = new Map(),
    themes = new Set(),
    errors = [];
  const noop = () => {};
  const React = {
    createElement: element,
    Fragment: "fragment",
    useState: value => [value, noop],
    useEffect: noop,
    useMemo: fn => fn(),
    useRef: value => ({ current: value }),
  };
  const host = {
    React,
    ReactDOM: { createPortal: element },
    GQL: {},
    components: {},
    libraries: { ReactRouterDOM: {} },
    register: {
      route: (path, component) => {
        routes.push({ path, component });
        if (fail.route) throw Error("route registration");
      },
    },
    patch: {
      instead: (name, handler) => {
        patches.push({ name, handler });
        if (fail.patch === name) throw Error("patch registration");
      },
      before: (name, handler) => patches.push({ name, handler }),
    },
  };
  const hub = {
    graphql: async () => ({}),
    getPluginSettings: async () => ({}),
    configurePlugin: async () => ({}),
    createSaveController: () => ({ dispose: noop }),
    native: { ensureComponents: async () => [] },
    react: { StateView: noop, StatisticSelector: noop },
    debugLog: noop,
    theme: {
      defaultKey: "classic",
      currentKey: "classic",
      normalizeKey: key => key,
      ready: Promise.resolve("classic"),
      subscribe: listener => {
        themes.add(listener);
        return () => themes.delete(listener);
      },
    },
  };
  const window = {
    PluginApi: host,
    DirtyPlugins: hub,
    location: { pathname: "/other", search: "" },
    addEventListener: (name, handler) => listeners.set(name, handler),
    removeEventListener: name => {
      listeners.delete(name);
      if (fail.cleanup) throw Error("cleanup");
    },
    setTimeout,
    clearTimeout,
  };
  const console = { warn: noop, error: (...args) => errors.push(args) };
  installRegistration(window, console);
  const context = vm.createContext({
    window,
    navigator: { userAgent: "Synthetic Stash host" },
    document: { documentElement: { style: {} } },
    console,
    URLSearchParams,
    Intl,
    Event,
    setTimeout,
    clearTimeout,
  });
  return {
    context,
    window,
    host,
    hub,
    routes,
    patches,
    listeners,
    themes,
    errors,
    load: () => vm.runInContext(code, context),
  };
}
const f = fixture();
f.load();
assert.equal(f.routes.length, 1);
assert.equal(f.routes[0].path, "/plugins/dirty-stats");
assert.deepEqual(
  f.patches.map(p => p.name),
  ["PerformerList", "SceneList", "MainNavBar.UtilityItems"],
);
assert.equal(f.listeners.size, 1);
assert.equal(f.themes.size, 1);
assert.equal(f.window.echarts, undefined, "ECharts stays private to the bundle");
assert.equal(f.window.__dirtyStatsWorld, undefined);
f.load();
assert.equal(f.routes.length, 1, "a reloaded bundle never registers twice");
assert.equal(f.patches.length, 3);
assert.equal(f.listeners.size, 1);
const original = { native: true },
  filter = {};
for (const path of ["/performers", "/scenes", "/plugins/other", "/plugins/dirty-stats"]) {
  f.window.location.pathname = path;
  assert.equal(
    f.patches[0].handler({ filter, extraCriteria: {} }, () => original),
    original,
  );
  assert.equal(
    f.patches[1].handler({ filter }, () => original),
    original,
  );
}
f.window.location.pathname = "/plugins/dirty-stats/quality-efficiency";
assert.equal(f.patches[1].handler({ filter }, () => original).type.name, "QualityEfficiencyPage");
f.window.location.pathname = "/plugins/dirty-stats/performer-ratings";
assert.equal(
  f.patches[0].handler({ filter, extraCriteria: { dirtyStats: true } }, () => original).props.performerMode,
  true,
);
// A failed registration is logged once and never retried by a reloaded bundle.
f.window.location.pathname = "/plugins/dirty-stats/performer-scene-ratings";
assert.equal(
  f.patches[0].handler({ filter, extraCriteria: { dirtyStats: true } }, () => original).type.name,
  "PerformerSceneRatingsPage",
);
assert.equal(
  f.patches[0].handler({ filter, extraCriteria: {} }, () => original),
  original,
);

for (const failure of [{ route: true }, { patch: "PerformerList" }, { patch: "SceneList" }]) {
  const partial = fixture(failure);
  partial.load();
  assert.equal(partial.errors.length, 1);
  assert.match(String(partial.errors[0][0]), /\[dirtyStats\] registration failed/);
  const count = partial.routes.length;
  partial.load();
  assert.equal(partial.routes.length, count);
  assert.equal(partial.listeners.size, 0);
  assert.equal(partial.themes.size, 0);
}
console.log(
  "DirtyStats compiled registration, modular ECharts registrations, map-free release bundle and duplicate/partial guards passed",
);
