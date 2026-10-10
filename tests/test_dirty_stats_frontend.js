"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createRenderer, element, events, findAll } = require("./ui_harness");
const { load } = require("./stats_modules");
const { runSource } = require("./plugin_paths");

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
  const { StatsPage } = runSource(
    "DirtyStats",
    "src/components/Origin.tsx",
    { window: e.window },
    {
      external: ["./echarts", "./Cards", "../domain/data", "../domain/charts", "../settings"],
      modules: {
        "./echarts": { charts: e.window.echarts },
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
  const { GrowthPage } = runSource(
    "DirtyStats",
    "src/components/Growth.tsx",
    { window: e.window },
    {
      external: ["./echarts", "../domain/growth", "../domain/charts", "../domain/data", "./Cards"],
      modules: {
        "./echarts": { charts: e.window.echarts },
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
