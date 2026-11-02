"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRenderer, element, events, findAll } = require("./ui_harness");
const { chartModule, load } = require("./stats_modules");
const fs = require("node:fs");
const vm = require("node:vm");
const { requireSource, runSource, runtimePath } = require("./plugin_paths");
const { installRegistration } = require("./shared_runtime");

/** A Stats component compiled with its own runtime, with the chart module installed as the route does. */
function runComponent(file, globals, { external, modules }) {
  const charts = chartModule(globals.window);
  const exports = runSource("DirtyStats", "component-test-entry.ts", globals, {
    contents: 'export * from "./' + file.replace(/\.tsx$/, "") + '";\nexport { installCharts } from "./src/runtime";',
    external: ["./echarts", ...external],
    modules: { "./echarts": charts, ...modules },
  });
  exports.installCharts(charts);
  return exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function environment(overrides = {}) {
  const instances = [],
    observers = [],
    registrations = [];
  const renderer = createRenderer({
    host(node) {
      if (node.props.ref && node.type === "div") node.props.ref.current ||= { clientWidth: 1000, clientHeight: 250 };
    },
  });
  const window = events({
    PluginApi: { React: { ...renderer.hooks, createElement: element, Fragment: "fragment" } },
    DirtyPlugins: { captureUrl: value => value, getPluginSettings: async () => ({}), ...overrides },
    echarts: {
      registerMap: name => registrations.push(name),
      init() {
        const instance = {
          options: [],
          option: undefined,
          handlers: new Map(),
          disposed: false,
          on(name, handler) {
            this.handlers.set(name, handler);
          },
          getOption() {
            return this.option;
          },
          setOption(option, replace) {
            this.options.push(option);
            this.option = replace
              ? option
              : {
                  ...this.option,
                  ...option,
                  ...(option.series
                    ? { series: option.series.map((series, index) => ({ ...this.option?.series?.[index], ...series })) }
                    : {}),
                };
          },
          getDataURL() {
            return "";
          },
          resize() {},
          isDisposed() {
            return this.disposed;
          },
          dispose() {
            this.disposed = true;
          },
        };
        instances.push(instance);
        return instance;
      },
    },
  });
  class Observer {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(node) {
      this.node = node;
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
  }
  const modules = load({ window, AbortController, ResizeObserver: Observer });
  return { renderer, window, modules, instances, observers, registrations };
}

test("performer versus scene ratings paginates native filters, selects performers, and refreshes", async () => {
  const requests = [];
  const rows = [
    {
      id: "1",
      name: "One",
      rating100: 80,
      scenes: [
        { id: "a", rating100: 90 },
        { id: "b", rating100: null },
      ],
    },
    {
      id: "2",
      name: "Two",
      rating100: 95,
      scenes: [
        { id: "a", rating100: 90 },
        { id: "c", rating100: 80 },
      ],
    },
  ];
  const e = environment({
    graphql(query, variables, options) {
      requests.push({ query, variables, signal: options.signal });
      return Promise.resolve({ findPerformers: { count: 2, performers: [rows[variables.filter.page - 1]] } });
    },
  });
  const { PerformerSceneRatingsPage } = runComponent(
    "src/components/PerformerSceneRatings.tsx",
    { window: e.window, AbortController },
    {
      external: ["./Cards"],
      modules: {
        "./Cards": { PerformerCards: props => element("performer-cards", props) },
      },
    },
  );
  const filter = { makeFindFilter: () => ({ q: "favorite", page: 7 }), makeFilter: () => ({ favorite: true }) };
  const render = () => e.renderer.render(element(PerformerSceneRatingsPage, { filter }));
  render();
  await e.renderer.flush(render);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].variables.filter.per_page, 100);
  assert.equal(requests[0].variables.filter.q, "favorite");
  assert.equal(requests[0].variables.performerFilter.favorite, true);
  assert.equal(requests[1].variables.filter.page, 2);
  const chart = e.instances[0];
  assert.equal(chart.option.xAxis.min, 0);
  assert.equal(chart.option.xAxis.max, 10);
  assert.equal(chart.option.yAxis.min, 0);
  assert.equal(chart.option.yAxis.max, 10);
  assert.match(chart.option.yAxis.name, /Average scene rating/);
  const guide = chart.option.series[0].markLine;
  assert.equal(guide.lineStyle.type, "dotted");
  assert.equal(guide.silent, true, "the reference line does not intercept performer selection");
  assert.deepEqual(JSON.parse(JSON.stringify(guide.data)), [[{ coord: [0, 0] }, { coord: [10, 10] }]]);
  assert.deepEqual(Array.from(chart.option.series[0].data[1].value), [9.5, 8.5]);
  const point = chart.option.series[0].data[0];
  assert.match(chart.option.tooltip.formatter({ data: point, value: point.value }), /Average scene rating 9.00\/10/);
  let tree = render();
  const cards = () => findAll(tree, node => node.type === "performer-cards")[0];
  assert.equal(cards().props.performers.length, 2);
  chart.handlers.get("click")({ componentType: "series", data: point });
  await e.renderer.flush(render);
  tree = render();
  assert.equal(cards().props.performers[0].id, "1");
  assert.equal(cards().props.performers.length, 1);
  assert.equal(chart.option.series[0].data[0].itemStyle.borderWidth, 2);
  chart.handlers.get("click")({ componentType: "series", data: point });
  await e.renderer.flush(render);
  tree = render();
  assert.equal(cards().props.performers.length, 2);
  findAll(tree, node => node.type === "button" && node.children.includes("Refresh"))[0].props.onClick();
  await e.renderer.flush(render);
  assert.equal(requests.length, 4, "refresh reloads all performer pages");
  e.renderer.unmount();
  assert.ok(requests.every(request => request.signal.aborted));
});

test("performer scene rating widget loads its own dataset and renders the same averages", async () => {
  const calls = [];
  const performer = {
    id: "1",
    rating100: 80,
    scenes: [
      { id: "a", rating100: 90 },
      { id: "b", rating100: 80 },
    ],
  };
  const e = environment({
    graphql(query, variables) {
      calls.push({ query, variables });
      return Promise.resolve({ findPerformers: { count: 1, performers: [performer] } });
    },
  });
  const domain = e.modules.dashboardDomain;
  const widget = domain.normalizeWidgets([
    { statistic: "performerSceneRatings", size: "large", filter: { find: { q: "one" }, object: { favorite: true } } },
  ])[0];
  const controller = new AbortController();
  const rows = await domain.fetchPages("performerSceneRatings", widget.filter, controller.signal, 0);
  assert.equal(calls[0].variables.filter.per_page, 100);
  assert.equal(calls[0].variables.filter.q, "one");
  assert.equal(calls[0].variables.performerFilter.favorite, true);
  const resources = { [domain.resourceKey(widget)]: { loading: false, error: "", rows } };
  function Widget() {
    return e.modules.dashboardCharts.renderWidget(widget, resources);
  }
  const render = () => e.renderer.render(element(Widget));
  render();
  await e.renderer.flush(render);
  assert.deepEqual(Array.from(e.instances[0].option.series[0].data[0].value), [8, 8.5]);
  assert.equal(e.instances[0].option.yAxis.max, 10);
  const guide = e.instances[0].option.series[0].markLine;
  assert.equal(guide.lineStyle.type, "dotted");
  assert.deepEqual(JSON.parse(JSON.stringify(guide.data)), [[{ coord: [0, 0] }, { coord: [10, 10] }]]);
  assert.notEqual(
    domain.resourceKey(widget),
    domain.resourceKey(domain.normalizeWidgets([{ statistic: "performerScatter", filter: widget.filter }])[0]),
  );
  e.renderer.unmount();
});

test("dashboard bodies reuse their own aggregate across title, drag, and unrelated resources", async () => {
  const e = environment();
  const { normalizeWidgets, resourceKey } = e.modules.dashboardDomain;
  const widget = normalizeWidgets([{ statistic: "ratings", size: "large" }])[0];
  let reads = 0;
  const rows = [
    {
      id: "one",
      get rating100() {
        reads++;
        return 80;
      },
    },
  ];
  const resource = { rows, loading: false, error: "", capacity: null };
  let props = { widget, resources: { [resourceKey(widget)]: resource }, index: 0 };
  const render = () => e.renderer.render(element(e.modules.dashboardWidget.DashboardWidget, props));
  render();
  await e.renderer.flush(render);
  const firstReads = reads;
  assert.ok(firstReads > 0);
  const option = e.instances[0].option;
  props = {
    ...props,
    widget: { ...widget, title: "A title" },
    index: 3,
    dragging: true,
    resources: { ...props.resources, unrelated: { ...resource, rows: [] } },
  };
  render();
  assert.equal(reads, firstReads);
  assert.equal(e.instances.length, 1);
  assert.equal(e.instances[0].option, option);
  props = { ...props, widget: { ...props.widget, options: { ...widget.options, rounding: 1 } } };
  render();
  assert.ok(reads > firstReads, "display options rebuild the affected aggregate");
  assert.equal(e.instances.length, 1, "options update the mounted chart");
  const beforeTheme = reads;
  e.modules.settings.syncSuiteTheme("paper");
  await e.renderer.flush(render);
  assert.ok(reads > beforeTheme);
  assert.equal(e.instances[0].option.legend.textStyle.color, "#3b3440");
  assert.equal(e.instances.length, 1);
  e.renderer.unmount();
  assert.ok(e.instances[0].disposed);
  assert.ok(e.observers.every(observer => !observer.connected));
  assert.equal(e.window.handlers.get("resize").size, 0);
});

test("dashboard charts preserve zoom/pan, update map geometry, and register the world once", () => {
  const e = environment();
  const Chart = e.modules.dashboardChart.Chart;
  let option = { dataZoom: [{ start: 0, end: 100 }], series: [{ type: "line", data: [1, 2] }] };
  const render = () => e.renderer.render(element(Chart, { option, label: "Timeline" }));
  render();
  e.instances[0].option = { ...option, dataZoom: [{ start: 25, end: 70 }] };
  option = { ...option, series: [{ type: "line", data: [3, 4] }] };
  render();
  assert.equal(e.instances.length, 1);
  assert.deepEqual(
    e.instances[0].option.dataZoom.map(zoom => [zoom.start, zoom.end]),
    [[25, 70]],
  );
  assert.deepEqual(e.instances[0].option.series[0].data, [3, 4]);
  e.renderer.unmount();
  const maps = () => e.renderer.render(["a", "b"].map(key => element(Chart, { key, option, map: true, label: "Map" })));
  option = { visualMap: { show: true }, series: [{ type: "map", map: "dirtyStatsDashboardWorld", roam: true }] };
  maps();
  assert.equal(e.registrations.length, 1);
  e.instances[1].option = { ...option, series: [{ ...option.series[0], zoom: 2.5, center: [10, 20] }] };
  option = { ...option, visualMap: { show: false } };
  maps();
  assert.equal(e.instances.length, 3);
  assert.equal(e.instances[1].option.series[0].zoom, 2.5);
  assert.deepEqual(e.instances[1].option.series[0].center, [10, 20]);
  const observer = e.observers[1];
  observer.node.clientHeight = 500;
  observer.callback();
  assert.equal(e.instances[1].options.at(-1).series[0].layoutSize, 984, "resize uses the latest legend visibility");
  e.renderer.unmount();
  assert.ok(e.instances.every(instance => instance.disposed));
});

test("full Origin retains map zoom across country, label, and theme changes and registers once", async () => {
  const e = environment({ createSaveController: () => ({ schedule() {} }) });
  const rows = [{ id: "one", country: "US" }];
  const { StatsPage } = runComponent(
    "src/components/Origin.tsx",
    { window: e.window },
    {
      external: ["./Cards", "../domain/data", "../domain/charts", "../settings"],
      modules: {
        "./Cards": { PerformerCards: props => element("performer-cards", props) },
        "../domain/data": { usePageData: () => ({ rows, loading: false, error: "", useLoad() {} }) },
        "../domain/charts": e.modules.charts,
        "../settings": e.modules.settings,
      },
    },
  );
  const filter = { makeFindFilter: () => ({}), makeFilter: () => ({}), count: () => 0 };
  const render = () => e.renderer.render(element(StatsPage, { filter }));
  render();
  await e.renderer.flush(render);
  const chart = e.instances[0];
  chart.option.series[0] = { ...chart.option.series[0], zoom: 3, center: [12, 24] };
  chart.handlers.get("click")({ componentType: "series", name: "United States of America" });
  await e.renderer.flush(render);
  assert.equal(chart.option.series[0].data.find(country => country.name === "United States of America").selected, true);
  const checkbox = findAll(e.renderer.tree, node => node.type === "input" && node.props.type === "checkbox")[0];
  checkbox.props.onChange({ target: { checked: !checkbox.props.checked } });
  await e.renderer.flush(render);
  assert.equal(chart.option.series[0].label.show, !checkbox.props.checked);
  e.modules.settings.syncSuiteTheme("paper");
  await e.renderer.flush(render);
  assert.equal(chart.option.backgroundColor, e.modules.settings.themeColor("background"));
  assert.equal(chart.option.series[0].zoom, 3);
  assert.deepEqual(chart.option.series[0].center, [12, 24]);
  assert.equal(e.instances.length, 1);
  assert.equal(e.registrations.length, 1);
  e.renderer.unmount();
  assert.ok(chart.disposed);
  render();
  await e.renderer.flush(render);
  assert.equal(e.instances.length, 2);
  assert.equal(e.registrations.length, 1, "remount uses the registered map");
  e.renderer.unmount();
});

test("dashboard reconciles requests individually, shares capacity, and rejects removed responses", async () => {
  const calls = [],
    capacities = [];
  const e = environment({
    graphql(query, variables, options) {
      const request = { ...deferred(), query, variables, signal: options.signal };
      calls.push(request);
      return request.promise;
    },
    runPluginOperation(_id, args) {
      const request = { ...deferred(), args };
      capacities.push(request);
      return request.promise;
    },
  });
  const request = (key, group) => ({ key, group, filter: { find: { q: key }, object: {}, count: 1 }, limit: 0 });
  const a = request("a", "scenes"),
    b = request("b", "growth"),
    c = request("c", "growth"),
    d = request("d", "tags");
  let requested = [a, b, c],
    state;
  function Resources() {
    state = e.modules.dashboardResources.useDashboardResources(requested, true);
    return null;
  }
  const render = () => e.renderer.render(element(Resources));
  const flush = () => e.renderer.flush(render);
  render();
  await flush();
  assert.equal(calls.length, 4, "three datasets and one shared configuration request");
  const rows = key => calls.find(call => call.variables.filter?.q === key);
  const sources = calls.find(call => call.query.includes("DashboardSources"));
  requested = [a, c, d];
  render();
  await flush();
  assert.equal(rows("b").signal.aborted, true);
  assert.equal(rows("a").signal.aborted, false, "unchanged in-flight data survives");
  assert.equal(sources.signal.aborted, false, "the remaining Growth widget owns shared capacity");
  assert.equal(Object.hasOwn(state, "b"), false);
  sources.resolve({ configuration: { general: { stashes: [{ path: "synthetic", excludeVideo: false }] } } });
  rows("a").resolve({ findScenes: { count: 1, scenes: [{ id: "a" }] } });
  rows("c").resolve({ findScenes: { count: 1, scenes: [{ id: "c" }] } });
  rows("b").resolve({ findScenes: { count: 1, scenes: [{ id: "removed" }] } });
  await flush();
  assert.equal(capacities.length, 1);
  capacities[0].resolve({ total: 1234 });
  await flush();
  assert.equal(state.c.capacity.total, 1234);
  assert.equal(Object.hasOwn(state, "b"), false);
  const retained = state.a;
  requested = [a, c];
  render();
  await flush();
  assert.equal(rows("d").signal.aborted, true);
  assert.equal(state.a, retained, "unchanged completed resources retain identity");
  requested = [a, c, d];
  render();
  await flush();
  const replacement = calls.filter(call => call.variables.filter?.q === "d")[1];
  replacement.resolve({ findScenes: { count: 1, scenes: [{ id: "new" }] } });
  rows("d").resolve({ findScenes: { count: 1, scenes: [{ id: "stale" }] } });
  await flush();
  assert.equal(state.d.rows[0].id, "new");
  requested = [a];
  render();
  await flush();
  assert.deepEqual(Object.keys(state), ["a"]);
  assert.equal(state.a, retained);
  const count = calls.length;
  render();
  await flush();
  assert.equal(calls.length, count);
  e.renderer.unmount();
  assert.ok(calls.every(call => call.signal.aborted));
});

test("dashboard capacity failure preserves rows and unmount discards delayed results", async () => {
  const requests = [];
  const e = environment({
    graphql(query) {
      if (query.includes("Sources")) return Promise.reject(Error("capacity unavailable"));
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
  });
  let state,
    requested = [{ key: "growth", group: "growth", filter: { find: {}, object: {} }, limit: 0 }];
  function Resources() {
    state = e.modules.dashboardResources.useDashboardResources(requested, true);
    return null;
  }
  const render = () => e.renderer.render(element(Resources));
  render();
  requests[0].resolve({ findScenes: { count: 1, scenes: [{ id: "one" }] } });
  await e.renderer.flush(render);
  assert.equal(state.growth.rows.length, 1);
  assert.equal(state.growth.capacity, null);
  assert.equal(state.growth.error, "");
  requested = [{ ...requested[0], key: "later" }];
  render();
  await e.renderer.flush(render);
  const before = state;
  e.renderer.unmount();
  requests[1].resolve({ findScenes: { count: 1, scenes: [{ id: "late" }] } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(state, before);
  assert.equal(e.renderer.changed, false);
});

test("full Growth period selection reuses daily aggregation and preserves forecast values", async () => {
  const e = environment({
    graphql: async () => ({ configuration: { general: { stashes: [] } } }),
    runPluginOperation: async () => ({ total: 10000, errors: [] }),
  });
  const scenes = Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    created_at: `2026-09-${String(i + 1).padStart(2, "0")}`,
    files: [{ id: String(i), size: 100 }],
  }));
  const aggregates = [],
    forecasts = [],
    descriptors = [];
  const domain = e.modules.growth;
  const { GrowthPage } = runComponent(
    "src/components/Growth.tsx",
    { window: e.window },
    {
      external: ["../domain/growth", "../domain/charts", "../domain/data", "./Cards"],
      modules: {
        "./Cards": { SceneCards: props => element("scene-cards", props) },
        "../domain/growth": {
          ...domain,
          aggregateGrowth(...args) {
            aggregates.push(args);
            return domain.aggregateGrowth(...args);
          },
          forecastGrowth(...args) {
            const value = domain.forecastGrowth(...args);
            forecasts.push({ args, value });
            return value;
          },
        },
        "../domain/charts": {
          useChart(describe) {
            descriptors.push(describe);
          },
        },
        "../domain/data": { usePageData: () => ({ rows: scenes, loading: false, error: "", useLoad() {} }) },
      },
    },
  );
  const filter = { makeFindFilter: () => ({}), makeFilter: () => ({}), count: () => 0 };
  const render = () => e.renderer.render(element(GrowthPage, { filter }));
  render();
  await e.renderer.flush(render);
  const count = aggregates.length;
  const descriptor = descriptors[0]();
  const zr = events({});
  const chart = {
    setOption() {},
    getOption: () => ({}),
    getZr: () => zr,
    containPixel: () => true,
    convertFromPixel: (_finder, pixel) => pixel,
  };
  descriptor.chartRef.current = chart;
  descriptor.configure(chart);
  for (const day of ["2026-09-02", "2026-09-15"]) {
    const event = { offsetX: Date.parse(day), offsetY: 0 };
    zr.emit("mousedown", event);
    zr.emit("click", event);
    await e.renderer.flush(render);
  }
  assert.equal(aggregates.length, count, "selected periods reuse the daily and grouped aggregates");
  const last = forecasts.at(-1);
  assert.ok(last.args[3], "the forecast receives the selected period");
  assert.deepEqual(last.value, domain.forecastGrowth(...last.args));
  assert.ok(findAll(e.renderer.tree, node => node.props["aria-label"] === "Scene content growth").length);
  e.renderer.unmount();
});

test("the chart file loads once on demand and a failed load is retried", async () => {
  // Outside the browser the import of the separate chart file fails, which exercises the retry.
  const runtime = runSource("DirtyStats", "src/runtime.ts", { window: {} });
  assert.equal(runtime.charts, null);
  const first = runtime.loadCharts();
  assert.equal(runtime.loadCharts(), first, "concurrent views share one load");
  await assert.rejects(first);
  assert.equal(runtime.charts, null);
  const retry = runtime.loadCharts();
  assert.notEqual(retry, first, "the next view retries a failed load");
  await assert.rejects(retry);
  const module = { charts: { init() {}, registerMap() {} }, world: { type: "FeatureCollection", features: [] } };
  runtime.installCharts(module);
  assert.equal(runtime.charts, module.charts);
  assert.equal(runtime.world, module.world);
});

test("replaceStatsPage sends only the native statistics page to the dashboard", async () => {
  const stored = {};
  const renderer = createRenderer();
  const patches = [];
  const replaced = [];
  const window = events({
    location: { pathname: "/stats", search: "" },
    PluginApi: {
      React: { ...renderer.hooks, createElement: element, Fragment: "fragment" },
      components: {},
      libraries: {
        ReactRouterDOM: {
          useLocation: () => window.location,
          useHistory: () => ({
            replace: path => {
              replaced.push(path);
              window.location.pathname = path;
            },
          }),
        },
      },
      register: { route() {} },
      patch: { instead() {}, before: (name, callback) => patches.push({ name, callback }) },
    },
    DirtyPlugins: {
      getPluginSettings: async () => ({ ...stored }),
      captureUrl: path => path,
      react: {},
      theme: {
        defaultKey: "classic",
        currentKey: "classic",
        normalizeKey: key => key,
        ready: Promise.resolve("classic"),
        subscribe: () => () => {},
      },
      debugLog() {},
    },
  });
  installRegistration(window);
  const context = vm.createContext({ window, document: { documentElement: { style: {} } }, console, URLSearchParams });
  vm.runInContext(fs.readFileSync(runtimePath("DirtyStats", "dirtyStats.js"), "utf8"), context);
  const app = patches.find(patch => patch.name === "App").callback;
  const render = () => renderer.render(app({ children: "Native routes" })[0].children);
  const changed = async () => {
    window.emit("dirty-plugins:configuration-changed", { detail: { pluginId: "dirtyStats" } });
    await renderer.flush(render);
  };

  render();
  await renderer.flush(render);
  assert.equal(renderer.tree.children.at(-1), "Native routes", "native routes stay in the tree");
  assert.deepEqual(replaced, [], "the native page stays by default");

  window.location.pathname = "/scenes";
  stored.replaceStatsPage = true;
  await changed();
  assert.deepEqual(replaced, [], "other pages are not redirected");

  window.location.pathname = "/stats";
  render();
  await renderer.flush(render);
  assert.deepEqual(replaced, ["/plugins/dirty-stats/dashboard"], "the native page opens the dashboard");
  render();
  await renderer.flush(render);
  assert.equal(replaced.length, 1, "the dashboard does not redirect again");

  stored.replaceStatsPage = false;
  await changed();
  window.location.pathname = "/stats";
  render();
  await renderer.flush(render);
  assert.equal(replaced.length, 1, "turning it off restores the native page");
});

test("the header button follows showInMenu without a reload", async () => {
  const stored = { showInMenu: false };
  const renderer = createRenderer();
  const patches = [];
  const window = events({
    location: { pathname: "/scenes", search: "" },
    PluginApi: {
      React: { ...renderer.hooks, createElement: element, Fragment: "fragment" },
      components: {},
      libraries: { ReactRouterDOM: {} },
      register: { route() {} },
      patch: { instead() {}, before: (name, callback) => patches.push({ name, callback }) },
    },
    DirtyPlugins: {
      getPluginSettings: async pluginId => (pluginId === "dirtyStats" ? { ...stored } : {}),
      react: { NavAction: "nav-action", NavIcon: "nav-icon" },
      theme: {
        defaultKey: "classic",
        currentKey: "classic",
        normalizeKey: key => key,
        ready: Promise.resolve("classic"),
        subscribe: () => () => {},
      },
      debugLog() {},
    },
  });
  installRegistration(window);
  const context = vm.createContext({ window, document: { documentElement: { style: {} } }, console, URLSearchParams });
  vm.runInContext(fs.readFileSync(runtimePath("DirtyStats", "dirtyStats.js"), "utf8"), context);
  const utilityItems = patches.find(patch => patch.name === "MainNavBar.UtilityItems").callback;
  const render = () => renderer.render(utilityItems({ children: "Native" })[0].children);
  const button = () => findAll(renderer.tree, node => node.type === "nav-action")[0];
  const changed = async pluginId => {
    window.emit("dirty-plugins:configuration-changed", { detail: { pluginId } });
    await renderer.flush(render);
  };

  render();
  assert.equal(renderer.tree.children[0], "Native", "native items stay first");
  assert.equal(button(), undefined, "the button waits for the stored setting instead of flashing");
  await renderer.flush(render);
  assert.equal(button(), undefined, "the stored setting hides the button");
  stored.showInMenu = true;
  await changed("multiscreen");
  assert.equal(button(), undefined, "other plugins' changes do not apply Stats settings");
  await changed("dirtyStats");
  assert.equal(button().props.to, "/plugins/dirty-stats/dashboard", "turning it on shows the button");
  stored.showInMenu = false;
  await changed("dirtyStats");
  assert.equal(button(), undefined, "turning it off hides the button again");
});

test("default stats match the figures and formats of Stash's statistics page", () => {
  const { formatLibraryDuration, formatLibrarySize, libraryTotals } = requireSource(
    "DirtyStats",
    "src/domain/totals.ts",
  );
  assert.equal(formatLibrarySize(0), "0 B");
  assert.equal(formatLibrarySize(1536), "2 KiB", "whole numbers below GiB");
  assert.equal(formatLibrarySize(4.6 * 1024 ** 4), "4.6 TiB", "one decimal from GiB up");
  assert.equal(formatLibraryDuration(0), "-");
  assert.equal(formatLibraryDuration(30 * 86400 + 7 * 86400 + 20 * 3600 + 125), "1M 1W 20h", "three largest units");
  assert.equal(formatLibraryDuration(86400 + 12 * 3600 + 55 * 60), "1D 12h 55m");
  assert.equal(formatLibraryDuration(3600 + 5), "1h 5s", "zero units are skipped");
  const totals = libraryTotals({
    scene_count: 1478,
    scenes_size: 0,
    scenes_duration: 0,
    image_count: 0,
    images_size: 0,
    gallery_count: 0,
    performer_count: 646,
    studio_count: 506,
    group_count: 0,
    tag_count: 1224,
    total_o_count: 24,
    total_play_duration: 0,
    total_play_count: 2810,
    scenes_played: 1230,
  });
  assert.equal(totals.length, 14);
  assert.deepEqual(
    totals.slice(0, 2).map(total => [total.label, total.value]),
    [
      ["Scenes size", "0 B"],
      ["Scenes", "1,478"],
    ],
  );
  assert.equal(totals.find(total => total.label === "Total play count").value, "2,810");
});

test("every entry of the page menu links to its route", () => {
  const { modules, window } = environment();
  const { StatisticSelector } = modules.Filters;
  window.DirtyPlugins.react.StatisticSelector = "selector";
  const { options } = StatisticSelector({ value: "dashboard" }).props;
  assert.equal(options.length, modules.registry.STATISTIC_ORDER.length);
  for (const option of options) assert.equal(option.to, modules.registry.STATISTIC_ROUTES[option.value]);
  assert.equal(options[0].to, modules.registry.dashboardRoute);
});

test("scenes per studio nests four levels, shows gaps for direct scenes, and follows the chart's zoom", async () => {
  const studio = (id, parent_studio = null) => ({ id, name: "Studio " + id, parent_studio });
  const network = studio("1"),
    label = studio("2", network),
    line = studio("3", label),
    series = studio("4", line),
    deepest = studio("5", series),
    other = studio("6");
  const rows = [
    { id: "a", studio: network },
    { id: "b", studio: label },
    { id: "c", studio: series },
    { id: "d", studio: deepest },
    { id: "e", studio: other },
    { id: "f", studio: null },
    { id: "a", studio: network },
  ];
  const requests = [];
  const e = environment({
    graphql(query, variables) {
      requests.push({ query, variables });
      return Promise.resolve({ findScenes: { count: rows.length, scenes: rows } });
    },
  });
  const { aggregateStudioTree, studioPath } = e.modules.analytics;
  const stats = aggregateStudioTree(rows);
  assert.deepEqual(
    Array.from(studioPath(deepest), item => item.id),
    ["1", "2", "3", "4", "5"],
  );
  assert.equal(stats.total, 5, "a scene counts once");
  assert.equal(stats.missingStudio, 1);
  assert.equal(stats.merged, 1, "the fifth level is merged");
  assert.equal(stats.studios, 5);
  assert.deepEqual(
    Array.from(stats.nodes, node => [node.id, node.value, node.direct]),
    [
      ["1", 4, 1],
      ["6", 1, 1],
    ],
    "largest first, with totals that include sub-studios",
  );
  const fourth = stats.nodes[0].children[0].children[0].children[0];
  assert.equal(fourth.id, "4");
  assert.equal(fourth.value, 2, "the fourth level absorbs deeper studios");
  assert.equal(fourth.children.length, 0);
  assert.equal(aggregateStudioTree([]).nodes.length, 0);
  const widgetLabel = size => {
    const widget = e.modules.dashboardCharts.studioTreeWidget(rows, { size, options: { showHeader: false } });
    return findAll(widget, node => node.props?.option)[0].props.option.series[0].label.show;
  };
  assert.equal(widgetLabel("medium"), false, "labels would overflow a smaller widget");
  assert.equal(widgetLabel("large"), true);

  const { StudioTreePage } = runComponent(
    "src/components/StudioTree.tsx",
    { window: e.window, AbortController },
    { external: ["./Cards"], modules: { "./Cards": { SceneCards: props => element("scene-cards", props) } } },
  );
  const filter = { makeFindFilter: () => ({}), makeFilter: () => ({}) };
  const render = () => e.renderer.render(element(StudioTreePage, { filter }));
  render();
  await e.renderer.flush(render);
  assert.match(requests[0].query, /parent_studio/);
  const chart = e.instances[0];
  const sunburst = chart.option.series[0];
  assert.equal(sunburst.type, "sunburst");
  assert.equal(sunburst.nodeClick, "rootToNode");
  assert.equal(sunburst.levels.length, 5, "the center plus four rings");
  const tooltip = chart.option.tooltip.formatter({ data: sunburst.data[0] });
  assert.match(tooltip, /Studio 1/);
  assert.match(tooltip, /4 scenes \(80%\)/);
  assert.match(tooltip, /1 directly in this studio/);
  assert.doesNotMatch(
    chart.option.tooltip.formatter({ data: { ...sunburst.data[0], direct: 0 } }),
    /directly/,
    "a studio with no scenes of its own says nothing about them",
  );
  assert.equal(chart.option.tooltip.formatter({}), "", "the center has no studio");

  const cards = () => findAll(render(), node => node.type === "scene-cards")[0];
  const zoom = async id => {
    chart.handlers.get("sunburstroottonode")({ targetNode: { getId: () => id } });
    await e.renderer.flush(render);
  };
  assert.equal(cards().props.title, "Scenes");
  await zoom("2");
  assert.equal(cards().props.title, "Scenes in Studio 2");
  assert.deepEqual(Array.from(new Set(cards().props.scenes.map(scene => scene.id))), ["b", "c", "d"]);
  await zoom("virtual root");
  assert.equal(cards().props.selection, null, "going back to the whole chart shows all scenes");
  await zoom("6");
  assert.equal(cards().props.selection, "6");
  cards().props.clearSelection();
  await e.renderer.flush(render);
  assert.equal(cards().props.selection, null);
  assert.equal(e.instances.length, 2, "clearing the selection also resets the chart's zoom");
  assert.ok(chart.disposed);
  e.renderer.unmount();
});

const taggedScene = (id, ...tags) => ({
  id,
  rating100: 80,
  play_count: 1,
  tags: tags.map(tag => ({ id: tag, name: "Tag " + tag })),
});

test("tag clusters group tags that share scenes, without letting a common tag join everything", () => {
  const { analytics } = environment().modules;
  const scenes = [];
  // Two separate themes, a tag on every scene, and a tag that shares only one scene with anything.
  for (let i = 0; i < 6; i++) scenes.push(taggedScene("a" + i, "a1", "a2", "a3", "all"));
  for (let i = 0; i < 6; i++) scenes.push(taggedScene("b" + i, "b1", "b2", "b3", "all"));
  scenes.push(taggedScene("x", "lonely", "a1"));
  scenes.push(taggedScene("a0", "a1", "duplicate scene is ignored"));
  const stats = analytics.aggregateTagDna(scenes);
  const result = analytics.aggregateTagClusters(scenes, stats, 0);
  const clusterOf = id => result.nodes.find(node => node.id === id).cluster;
  assert.equal(clusterOf("a1"), clusterOf("a2"));
  assert.equal(clusterOf("a1"), clusterOf("a3"));
  assert.equal(clusterOf("b1"), clusterOf("b2"));
  assert.notEqual(clusterOf("a1"), clusterOf("b1"), "the tag on every scene does not merge the themes");
  const lonely = result.clusters[clusterOf("lonely")];
  assert.equal(lonely.name, "No close tags");
  assert.equal(lonely.tags, 1);
  assert.equal(result.nodes.length, 8);
  assert.ok(result.links.every(link => link.shared >= 2));
  assert.ok(result.links.every(link => link.value > 0 && link.value <= 1));
  assert.equal(
    JSON.stringify(analytics.aggregateTagClusters(scenes, stats, 0)),
    JSON.stringify(result),
    "the same library always gives the same clusters",
  );
  assert.equal(analytics.aggregateTagClusters(scenes, stats, 3).nodes.length, 3, "Maximum tags applies");
  const many = analytics.aggregateTagDna(
    Array.from({ length: analytics.TAG_CLUSTER_LIMIT + 5 }, (_, index) => taggedScene("s" + index, "t" + index)),
  );
  assert.equal(analytics.aggregateTagClusters([], many, 0).nodes.length, analytics.TAG_CLUSTER_LIMIT);
  assert.equal(analytics.aggregateTagClusters([], { rows: [] }, 0).nodes.length, 0);

  const sizes = [40, 12, 12, 3, 2, 1];
  const nodes = sizes.flatMap((size, cluster) => Array.from({ length: size }, () => ({ cluster })));
  const positions = analytics.tagClusterPositions(nodes);
  assert.equal(positions.length, nodes.length);
  assert.ok(positions.every(point => Number.isFinite(point[0]) && Number.isFinite(point[1])));
  const distance = (a, b) => Math.hypot(positions[a][0] - positions[b][0], positions[a][1] - positions[b][1]);
  let closestInside = Infinity,
    closestAcross = Infinity;
  nodes.forEach((a, i) =>
    nodes.forEach((b, j) => {
      if (i >= j) return;
      if (a.cluster === b.cluster) closestInside = Math.min(closestInside, distance(i, j));
      else closestAcross = Math.min(closestAcross, distance(i, j));
    }),
  );
  assert.ok(closestInside > 0.5, "tags in a group do not sit on top of each other");
  assert.ok(closestAcross > 1, "every group is visibly apart from the others");
});

test("Tag DNA offers bar and cluster views on the page and in widgets", async () => {
  const scenes = [];
  for (let i = 0; i < 30; i++) scenes.push(taggedScene("s" + i, "t" + i, "t" + i + "b", "common"));
  scenes.push(taggedScene("again", "t0", "t0b"), taggedScene("again2", "t0", "t0b"));
  const e = environment({
    graphql: () => Promise.resolve({ findScenes: { count: scenes.length, scenes } }),
    createSaveController: () => ({ schedule() {}, flush: async () => {}, dispose() {} }),
    configurePlugin: async () => ({}),
    react: {},
  });
  const widgetOption = (view, size = "medium") => {
    const body = e.modules.dashboardCharts.tagDnaWidget(scenes, {
      size,
      options: { view, metric: "rating", maxTags: 0, showHeader: false },
    });
    return findAll(body, node => node.props?.option)[0].props.option;
  };
  assert.equal(widgetOption("treemap").series[0].type, "treemap");
  const bars = widgetOption("bars");
  assert.equal(bars.series[0].type, "bar");
  assert.equal(bars.xAxis.max, 10, "the x axis is the average rating out of ten");
  assert.equal(bars.series[0].data[0].value, 8);
  assert.equal(bars.series[0].label.formatter({ value: 8 }), "8.0");
  assert.equal(bars.yAxis.data[0], "Tag common", "equal ratings put the most common tag first");
  assert.equal(bars.dataZoom[0].endValue, 9, "a medium widget scrolls after ten bars");
  assert.notEqual(
    bars.series[0].data[0].itemStyle.color,
    bars.series[0].data[5].itemStyle.color,
    "color follows the number of scenes",
  );
  assert.equal(bars.series[0].data[0].label, undefined, "bar values use the chart's text color");
  const ranked = e.modules.analytics.tagBarSeriesData(
    e.modules.analytics.aggregateTagDna([
      { id: "1", rating100: 60, tags: [{ id: "common", name: "Common" }] },
      { id: "2", rating100: 60, tags: [{ id: "common", name: "Common" }] },
      { id: "3", rating100: 100, tags: [{ id: "best", name: "Best" }] },
      { id: "4", rating100: null, tags: [{ id: "unrated", name: "Unrated" }] },
    ]),
    0,
    "best",
  );
  assert.deepEqual(
    Array.from(ranked, item => [item.name, item.value, item.scenes, item.itemStyle.borderWidth]),
    [
      ["Best", 10, 1, 2],
      ["Common", 6, 2, 0],
    ],
    "best rated first, with unrated tags left out and the selection marked",
  );
  assert.match(bars.tooltip.formatter({ data: bars.series[0].data[0] }), /31 scenes|30 scenes/);
  const few = e.modules.dashboardCharts.tagDnaWidget(scenes, {
    size: "large",
    options: { view: "bars", metric: "rating", maxTags: 25, showHeader: false },
  });
  assert.equal(findAll(few, node => node.props?.option)[0].props.option.dataZoom.length, 0, "no slider when all fit");
  const clusters = widgetOption("clusters");
  assert.equal(clusters.series[0].type, "graph");
  assert.equal(clusters.series[0].layout, "none", "positions are fixed, so the plot never jumps");
  assert.ok(clusters.series[0].data.every(node => Number.isFinite(node.x) && Number.isFinite(node.y)));
  assert.equal(clusters.legend.show, false, "only a large widget has room for the legend");
  assert.equal(clusters.series[0].data.length, 60, "a medium widget limits the layout");
  assert.ok(clusters.series[0].data.every(node => !node.label.show));
  const large = widgetOption("clusters", "large");
  assert.ok(large.legend.data.length > 0);
  assert.ok(large.series[0].data[0].label.show, "large widgets name the top tags");
  const node = large.series[0].data[0];
  assert.match(large.tooltip.formatter({ data: node }), /Cluster: /);
  assert.match(
    large.tooltip.formatter({ dataType: "edge", data: { sourceName: "A", targetName: "B", shared: 2 } }),
    /A \+ B[^]*2 shared scenes/,
  );

  const { TagDnaPage } = runComponent(
    "src/components/Tags.tsx",
    { window: e.window, AbortController },
    { external: ["./Cards"], modules: { "./Cards": { SceneCards: props => element("scene-cards", props) } } },
  );
  const filter = { makeFindFilter: () => ({}), makeFilter: () => ({}) };
  const render = () => e.renderer.render(element(TagDnaPage, { filter }));
  render();
  await e.renderer.flush(render);
  const current = () => e.instances[e.instances.length - 1];
  assert.equal(current().option.series[0].type, "treemap", "the treemap remains the default");
  const viewSelect = () =>
    findAll(render(), node => node.type === "select").find(select =>
      findAll(select, node => node.type === "option").some(option => option.children.includes("Cluster plot")),
    );
  const choose = async value => {
    viewSelect().props.onChange({ target: { value } });
    await e.renderer.flush(render);
  };
  await choose("bars");
  assert.equal(current().option.series[0].type, "bar");
  const barChart = current();
  const created = e.instances.length;
  const cards = () => findAll(render(), node => node.type === "scene-cards")[0];
  barChart.handlers.get("click")({ componentType: "series", data: barChart.option.series[0].data[1] });
  await e.renderer.flush(render);
  assert.ok(cards().props.title.startsWith("Scenes tagged "));
  assert.equal(e.instances.length, created, "selecting a bar keeps the chart and its scroll position");
  assert.equal(barChart.option.series[0].data[0].itemStyle.borderWidth, 0);
  assert.equal(barChart.option.series[0].data[1].itemStyle.borderWidth, 2, "only the selected bar has a border");
  assert.equal(
    findAll(render(), node => node.type === "label").some(label => label.children.includes("Color by")),
    false,
    "bar color is the scene count, so Color by is hidden",
  );
  await choose("clusters");
  assert.equal(current().option.series[0].type, "graph");
  assert.equal(
    findAll(render(), node => node.type === "label").some(label => label.children.includes("Color by")),
    false,
    "cluster colors are the groups, so Color by is hidden",
  );
  const graph = current();
  graph.actions = [];
  graph.dispatchAction = action => graph.actions.push(action);
  const created2 = e.instances.length;
  graph.handlers.get("click")({ componentType: "series", dataType: "node", data: graph.option.series[0].data[0] });
  await e.renderer.flush(render);
  assert.equal(e.instances.length, created2, "selecting a dot keeps the layout");
  assert.equal(graph.actions[graph.actions.length - 1].type, "highlight");
  graph.handlers.get("click")({ componentType: "series", dataType: "edge", data: graph.option.series[0].links[0] });
  await e.renderer.flush(render);
  assert.ok(cards().props.title.startsWith("Scenes tagged "), "links are not tags");
  e.renderer.unmount();
});

test("age at scene counts and lists scenes, not performers", async () => {
  const birthdate = "2000-01-01";
  const scenes = [
    {
      id: "1",
      date: "2024-06-15",
      performers: [
        { id: "a", birthdate },
        { id: "b", birthdate: "2000-02-02" },
      ],
    },
    { id: "2", date: "2024-07-01", performers: [{ id: "a", birthdate }] },
    {
      id: "3",
      date: "2025-07-01",
      performers: [
        { id: "a", birthdate },
        { id: "c", birthdate: "1990-01-01" },
      ],
    },
    { id: "4", date: null, performers: [{ id: "a", birthdate }] },
  ];
  const e = environment({ graphql: async () => ({ findScenes: { count: scenes.length, scenes } }) });
  const { AgePage } = runComponent(
    "src/components/Ages.tsx",
    { window: e.window, AbortController },
    { external: ["./Cards"], modules: { "./Cards": { SceneCards: props => element("scene-cards", props) } } },
  );
  const filter = { makeFindFilter: () => ({}), makeFilter: () => ({}) };
  const render = () => e.renderer.render(element(AgePage, { filter }));
  render();
  await e.renderer.flush(render);
  const chart = e.instances[0];
  const counts = () => Array.from(chart.option.series[0].data, bar => bar.value);
  assert.equal(chart.option.xAxis.data[0], "24");
  assert.deepEqual(counts().slice(0, 2), [2, 1], "two scenes at 24 and one at 25, however many performers they have");
  assert.equal(chart.option.yAxis.name, "Scenes");
  assert.match(chart.option.tooltip.formatter([{ name: "24", value: 2 }]), /2 scenes/);
  const cards = () => findAll(render(), node => node.type === "scene-cards")[0];
  const ids = () => Array.from(cards().props.scenes, scene => scene.id);
  assert.equal(cards().props.title, "Scenes");
  assert.deepEqual(ids(), ["1", "2", "3"], "all ages lists every counted scene once");
  assert.equal(cards().props.selection, false);
  const click = async age => {
    chart.handlers.get("click")({ componentType: "series", name: age });
    await e.renderer.flush(render);
  };
  await click("24");
  assert.equal(cards().props.title, "Scenes with a performer aged 24");
  assert.deepEqual(ids(), ["1", "2"]);
  await click("0");
  assert.equal(cards().props.selection, true, "age zero is still a selection");
  cards().props.clearSelection();
  await e.renderer.flush(render);
  assert.equal(cards().props.title, "Scenes");
  e.renderer.unmount();
});

test("card lists drop an ID deleted after the page loaded and keep the others", async () => {
  const e = environment({ captureEnabled: () => false });
  e.window.location = { search: "" };
  e.window.PluginApi.components = { PerformerCard: "performer-card", SceneCard: "scene-card" };
  let deleted = [],
    failure = null;
  const lookup = (entity, requested) => {
    const missing = requested.find(id => deleted.includes(id));
    if (failure) return { error: { message: failure } };
    if (missing != null) return { error: { message: entity + " with id " + missing + " not found" } };
    return { rows: requested.map(id => ({ id: String(id) })) };
  };
  const requests = [];
  e.window.PluginApi.GQL = {
    useFindPerformersQuery: ({ variables }) => {
      requests.push(variables.performer_ids);
      const { error, rows } = lookup("performer", variables.performer_ids);
      return error ? { error } : { data: { findPerformers: { performers: rows } } };
    },
    useFindScenesQuery: ({ variables }) => {
      requests.push(variables.scene_ids);
      const { error, rows } = lookup("scene", variables.scene_ids);
      return error ? { error } : { data: { findScenes: { scenes: rows } } };
    },
  };
  const { PerformerCards, SceneCards } = runComponent(
    "src/components/Cards.tsx",
    { window: e.window, AbortController },
    { external: [], modules: {} },
  );
  const filter = { makeFindFilter: () => ({}), makeFilter: () => ({}) };
  const items = [{ id: "1" }, { id: "2" }, { id: "3" }];
  const lists = [
    [() => element(PerformerCards, { performers: items }), "performer-card", "Performers (2)"],
    [() => element(SceneCards, { scenes: items, filter }), "scene-card", "Scenes (2)"],
  ];
  for (const [list, card, heading] of lists) {
    deleted = [2];
    failure = null;
    requests.length = 0;
    const render = () => e.renderer.render(list());
    render();
    await e.renderer.flush(render);
    const tree = render();
    assert.deepEqual(
      findAll(tree, node => node.type === card).map(node => node.props.performer?.id ?? node.props.scene?.id),
      ["1", "3"],
      "the remaining cards appear",
    );
    assert.deepEqual(Array.from(requests[0]), [1, 2, 3]);
    assert.deepEqual(Array.from(requests.at(-1)), [1, 3], "the next request leaves out the deleted ID");
    assert.equal(findAll(tree, node => node.props?.role === "alert").length, 0, "no error is shown");
    assert.equal(
      findAll(tree, node => node.type === "h2")[0]
        .children.flat()
        .join(""),
      heading,
    );
    e.renderer.unmount();
  }

  for (const [list] of lists) {
    deleted = [];
    failure = "Failed to fetch";
    const render = () => e.renderer.render(list());
    render();
    await e.renderer.flush(render);
    assert.equal(
      findAll(render(), node => node.props?.detail === "Failed to fetch").length,
      1,
      "other failures stay visible",
    );
    e.renderer.unmount();
  }
});
