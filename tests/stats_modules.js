"use strict";
const vm = require("node:vm");
const { runSource } = require("./plugin_paths");

// Every Stats module in one bundle, so they share state as in the plugin bundle.
// ECharts stays external: suites supply a fake chart engine as window.echarts.
const COMPONENTS = [
  "Primitives",
  "Filters",
  "Cards",
  "Origin",
  "Constellation",
  "Growth",
  "Ages",
  "Birthdays",
  "Ratings",
  "Scatter",
  "PerformerSceneRatings",
  "Counters",
  "Quality",
  "Studios",
  "Tags",
  "Route",
];
const DASHBOARD = ["Chart", "Cards", "Charts", "Controls", "Filter", "Widget", "Page"];
const ENTRY = [
  ...[
    "settings:settings",
    "analytics:domain/analytics",
    "filters:domain/filters",
    "registry:domain/registry",
    "growth:domain/growth",
    "ages:domain/ages",
    "charts:domain/charts",
    "dashboardDomain:domain/dashboard",
    "dashboardResources:dashboard/resources",
  ]
    .map(item => item.split(":"))
    .map(([name, path]) => "export * as " + name + ' from "./src/' + path + '";'),
  ...COMPONENTS.map(name => "export * as " + name + ' from "./src/components/' + name + '";'),
  ...DASHBOARD.map(name => "export * as dashboard" + name + ' from "./src/dashboard/' + name + '";'),
  'export { world } from "./src/runtime";',
].join("\n");

function prepare(context) {
  const api = context.window.PluginApi,
    hub = context.window.DirtyPlugins;
  hub.react ||= {};
  // The 1.0 hub always provides the full theme API; suites override what they exercise.
  hub.theme = Object.assign(
    {
      defaultKey: "classic",
      currentKey: "classic",
      normalizeKey: key => key,
      ready: Promise.resolve("classic"),
      readRole: () => "",
      subscribe: () => () => {},
    },
    hub.theme,
  );
  api.libraries ||= {};
  api.libraries.ReactRouterDOM ||= {};
}

/** Evaluates the Stats modules against the context's window. */
function load(context) {
  if (!vm.isContext(context)) vm.createContext(context);
  prepare(context);
  return runSource("DirtyStats", "stats-test-entry.ts", context, {
    contents: ENTRY,
    external: ["./echarts"],
    modules: { "./echarts": { charts: context.window.echarts } },
  });
}

function dashboardOf(modules) {
  return {
    Component: modules.dashboardPage.DashboardPage,
    Widget: modules.dashboardWidget.DashboardWidget,
    FilterChooser: modules.dashboardFilter.DashboardFilterChooser,
    widgetOptions: modules.dashboardControls.WidgetOptions,
    algorithms: modules.dashboardDomain,
    registry: modules.dashboardDomain.WIDGETS,
    defaults: modules.dashboardDomain.DEFAULT_WIDGETS,
    settings: modules.settings,
  };
}

/** The Stats modules as the plugin wires them, with settings loading started. */
function core(context) {
  const modules = load(context);
  const views = Object.assign({}, ...COMPONENTS.map(name => modules[name]), {
    Dashboard: modules.dashboardPage.DashboardPage,
  });
  const algorithms = {
    ...modules.analytics,
    ...modules.filters,
    ...modules.settings,
    ...modules.growth,
    ...modules.ages,
    initStatsChart: modules.charts.initStatsChart,
  };
  return {
    views,
    algorithms,
    settings: modules.settings,
    analytics: modules.analytics,
    filters: modules.filters,
    registry: modules.registry,
    dashboard: dashboardOf(modules),
    world: modules.world,
    settingsReady: modules.settings.startStatsSettings(),
    getSaveStatus: modules.settings.getSaveStatus,
    getSettingExtra: modules.settings.getStatsSettingExtra,
    setSettingExtra: modules.settings.setStatsSettingExtra,
  };
}

/** Dashboard views and domain helpers evaluated against the context's window. */
function dashboard(context) {
  return dashboardOf(load(context));
}
module.exports = { core, dashboard, load };
