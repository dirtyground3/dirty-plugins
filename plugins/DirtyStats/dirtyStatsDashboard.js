(function () {
  "use strict";
  if (window.__dirtyStatsDashboard) return;

  var api = window.PluginApi;
  var hub = window.DirtyPlugins;
  var core = window.__dirtyStatsPlugin;
  if (!api || !hub || !core || !core.algorithms) return;

  var React = api.React;
  var h = React.createElement;
  var algorithms = core.algorithms;
  var charts = window.echarts;
  var world = window.__dirtyStatsWorld;
  var sharedReact = hub.react || {};
  var StateView = sharedReact.StateView;
  var Field = sharedReact.Field;
  var Toggle = sharedReact.SettingsToggle;
  var controlId = 0;
  var Link = api.libraries.ReactRouterDOM.Link;
  var SIZES = ["small", "medium", "large"];
  var SIZE_LABELS = { small: "Small", medium: "Medium", large: "Large" };
  var THEME_VALUES = ["classic", "candy", "tropical", "arcade", "paper"];
  var THEME_LABELS = { classic: "Midnight", candy: "Candy Pop", tropical: "Tropical Punch", arcade: "Retro Arcade", paper: "Paper Picnic" };
  var COLORS = ["#54d5ca", "#5687a2", "#f3c779", "#bc8542", "#8eb8f5", "#f29aaa", "#d9a6e8", "#aeb8c2"];
  var DASHBOARD_VERSION = 2;
  var MAX_WIDGETS = 24;
  var EMPTY_FILTER = { find: {}, object: {}, count: 0 };

  var WIDGETS = {
    origin: { label: "Performer origin", route: core.route, entity: "performers", group: "performers", size: "medium", options: { showNumbers: false }, choices: { showNumbers: [false, true] } },
    growth: { label: "Content growth", route: core.route + "/scenes", entity: "scenes", group: "growth", size: "large", options: { dateBasis: "created_at", grouping: "month", showCapacity: true, showForecast: false }, choices: { dateBasis: ["created_at", "mod_time", "scene_date"], grouping: ["day", "month", "year"], showCapacity: [false, true], showForecast: [false, true] } },
    ages: { label: "Age at scene", route: core.route + "/ages", entity: "scenes", group: "cast", size: "medium", options: {}, choices: {} },
    ratings: { label: "Scene ratings", route: core.route + "/ratings", entity: "scenes", group: "scenes", size: "medium", options: { rounding: 0.5 }, choices: { rounding: [0, 0.5, 1] } },
    performerRatings: { label: "Performer ratings", route: core.route + "/performer-ratings", entity: "performers", group: "performers", size: "medium", options: { rounding: 0.5 }, choices: { rounding: [0, 0.5, 1] } },
    performerScatter: { label: "Rating vs scenes", route: core.route + "/performer-scatter", entity: "performers", group: "performers", size: "medium", options: { minRating: 9, maxScenes: 10 }, choices: { minRating: [0, 5, 6, 7, 8, 9], maxScenes: [0, 5, 10, 20, 50, 100] } },
    performerCards: { label: "Performer cards", route: core.route, entity: "performers", group: "performerCards", size: "large", options: { cardCount: 8 }, choices: { cardCount: [4, 8, 12, 24] } },
    countRating: { label: "Count vs rating", route: core.route + "/count-rating", entity: "scenes", group: "scenes", size: "medium", options: { metric: "play_count" }, choices: { metric: ["play_count", "o_counter"] } },
    repeatOffenders: { label: "Repeat-offender curve", route: core.route + "/repeat-offenders", entity: "scenes", group: "scenes", size: "medium", options: {}, choices: {} },
    qualityEfficiency: { label: "Quality efficiency", route: core.route + "/quality-efficiency", entity: "scenes", group: "scenes", size: "medium", options: {}, choices: {} },
    studios: { label: "Studio value map", route: core.route + "/studios", entity: "scenes", group: "scenes", size: "medium", options: { minScenes: 1 }, choices: { minScenes: [1, 2, 5, 10, 20] } },
    tags: { label: "Tag DNA", route: core.route + "/tags", entity: "scenes", group: "tags", size: "medium", options: { metric: "rating", maxTags: 50 }, choices: { metric: ["rating", "play_count"], maxTags: [0, 25, 50, 100, 200] } },
    constellation: { label: "Cast constellation", route: core.route + "/constellation", entity: "scenes", group: "cast", size: "large", options: { maxPerformers: 100, minShared: 1 }, choices: { maxPerformers: [0, 50, 100, 200, 500, 1000], minShared: [1, 2, 3, 5, 10] } },
    birthdays: { label: "Performer birthdays", route: core.route + "/birthdays", entity: "performers", group: "performers", size: "medium", options: { upcomingCount: 6 }, choices: { upcomingCount: [3, 6, 12] } }
  };
  var WIDGET_ORDER = ["origin", "growth", "ages", "ratings", "performerRatings", "performerScatter", "performerCards", "countRating", "repeatOffenders", "qualityEfficiency", "studios", "tags", "constellation", "birthdays"];
  var DEFAULT_WIDGETS = [
    { id: "dashboard-ratings", statistic: "ratings", size: "medium", options: { rounding: 0.5 } },
    { id: "dashboard-performer-ratings", statistic: "performerRatings", size: "medium", options: { rounding: 0.5 } },
    { id: "dashboard-growth", statistic: "growth", size: "large", options: { dateBasis: "created_at", grouping: "month", showCapacity: true, showForecast: false } },
    { id: "dashboard-origin", statistic: "origin", size: "medium", options: { showNumbers: false } },
    { id: "dashboard-birthdays", statistic: "birthdays", size: "medium", options: { upcomingCount: 6 } }
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function allowed(values, value) {
    for (var index = 0; index < values.length; index += 1) if (values[index] === value || String(values[index]) === String(value)) return values[index];
    return undefined;
  }

  function normalizeOptions(definition, value) {
    var source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    var result = clone(definition.options);
    Object.keys(definition.choices).forEach(function (name) {
      var parsed = allowed(definition.choices[name], source[name]);
      if (parsed !== undefined) result[name] = parsed;
    });
    return result;
  }

  function normalizeFilter(value) {
    var source = value && typeof value === "object" && !Array.isArray(value) ? value : EMPTY_FILTER;
    var find = source.find && typeof source.find === "object" && !Array.isArray(source.find) ? clone(source.find) : {};
    var object = source.object && typeof source.object === "object" && !Array.isArray(source.object) ? clone(source.object) : {};
    delete find.page;
    delete find.per_page;
    return { find: find, object: object, count: Math.max(0, Number(source.count) || 0) };
  }

  function normalizeTitle(value) {
    return typeof value === "string" ? value.trim().slice(0, 100) : "";
  }

  function widgetTitle(widget) {
    return normalizeTitle(widget.title) || WIDGETS[widget.statistic].label;
  }

  function widgetHeightUnits(widget) {
    if (widget.size === "small") return 1;
    if (widget.size === "medium") return widget.statistic === "birthdays" || widget.statistic === "performerCards" ? 2 : 1;
    return widget.statistic === "birthdays" || (widget.statistic === "performerCards" && widget.options.cardCount > 12) ? 3 : 2;
  }

  function normalizeWidgets(value, useDefaults) {
    var source = Array.isArray(value) ? value : (useDefaults === false ? [] : clone(DEFAULT_WIDGETS));
    var result = [], usedIds = new Set();
    source.slice(0, MAX_WIDGETS).forEach(function (candidate) {
      var statistic = candidate && String(candidate.statistic || "");
      if (!WIDGETS[statistic]) return;
      var id = candidate.id == null ? "dashboard-" + statistic : String(candidate.id);
      if (!id || usedIds.has(id)) {
        var base = "dashboard-" + statistic, suffix = 2;
        id = base;
        while (usedIds.has(id)) { id = base + "-" + suffix; suffix += 1; }
      }
      usedIds.add(id);
      result.push({ id: id, statistic: statistic, title: normalizeTitle(candidate.title), size: SIZES.indexOf(candidate.size) >= 0 ? candidate.size : WIDGETS[statistic].size, options: normalizeOptions(WIDGETS[statistic], candidate.options), filter: normalizeFilter(candidate.filter) });
    });
    return result;
  }

  function nextWidgetId(statistic, widgets) {
    var usedIds = new Set((widgets || []).map(function (widget) { return widget.id; }));
    var base = "dashboard-" + statistic, id = base, suffix = 2;
    while (usedIds.has(id)) { id = base + "-" + suffix; suffix += 1; }
    return id;
  }

  function requiredGroups(widgets) {
    return Array.from(new Set(widgets.map(function (widget) { return WIDGETS[widget.statistic].group; }))).sort();
  }

  function resourceKey(widget) {
    return WIDGETS[widget.statistic].group + "|" + JSON.stringify(normalizeFilter(widget.filter)) + (widget.statistic === "performerCards" ? "|" + widget.options.cardCount : "");
  }

  function requiredResources(widgets) {
    var resources = [], used = new Set();
    widgets.forEach(function (widget) {
      var key = resourceKey(widget);
      if (used.has(key)) return;
      used.add(key);
      resources.push({ key: key, group: WIDGETS[widget.statistic].group, filter: normalizeFilter(widget.filter), limit: widget.statistic === "performerCards" ? widget.options.cardCount : 0 });
    });
    return resources.sort(function (a, b) { return a.key.localeCompare(b.key); });
  }

  function reorderWidgets(widgets, from, to) {
    if (!Array.isArray(widgets) || from === to || from < 0 || to < 0 || from >= widgets.length || to >= widgets.length) return widgets;
    var reordered = widgets.slice();
    var widget = reordered.splice(from, 1)[0];
    reordered.splice(to, 0, widget);
    return reordered;
  }

  async function fetchPages(group, savedFilter, signal, limit) {
    var page = 1, total = null, rows = [];
    var query, root, field, variables;
    if (group === "performerCards") {
      query = "query DirtyStatsDashboardPerformerCards($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id death_date}}}";
      root = "findPerformers"; field = "performers";
      variables = function () { return { filter: Object.assign({ sort: "name", direction: "ASC" }, savedFilter.find, { page: 1, per_page: limit }), performerFilter: savedFilter.object }; };
    } else if (group === "performers") {
      query = "query DirtyStatsDashboardPerformers($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id name country rating100 scene_count birthdate death_date image_path}}}";
      root = "findPerformers"; field = "performers";
      variables = function (number) { return { filter: Object.assign({}, savedFilter.find, { page: number, per_page: 500, sort: "id", direction: "ASC" }), performerFilter: savedFilter.object }; };
    } else if (group === "scenes") {
      query = "query DirtyStatsDashboardScenes($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id title rating100 play_count o_counter studio{id name image_path} files{id size duration}}}}";
      root = "findScenes"; field = "scenes";
      variables = function (number) { return { filter: Object.assign({}, savedFilter.find, { page: number, per_page: 500, sort: "id", direction: "ASC" }), sceneFilter: savedFilter.object }; };
    } else if (group === "tags") {
      query = "query DirtyStatsDashboardTags($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id rating100 play_count tags{id name}}}}";
      root = "findScenes"; field = "scenes";
      variables = function (number) { return { filter: Object.assign({}, savedFilter.find, { page: number, per_page: 500, sort: "id", direction: "ASC" }), sceneFilter: savedFilter.object }; };
    } else if (group === "growth") {
      query = "query DirtyStatsDashboardGrowth($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id created_at date files{id size mod_time}}}}";
      root = "findScenes"; field = "scenes";
      variables = function (number) { return { filter: Object.assign({}, savedFilter.find, { page: number, per_page: 500, sort: "id", direction: "ASC" }), sceneFilter: savedFilter.object }; };
    } else {
      query = "query DirtyStatsDashboardCast($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id date performers{id name gender birthdate}}}}";
      root = "findScenes"; field = "scenes";
      variables = function (number) { return { filter: Object.assign({}, savedFilter.find, { page: number, per_page: 500, sort: "id", direction: "ASC" }), sceneFilter: savedFilter.object }; };
    }
    do {
      var data = await hub.graphql(query, variables(page), { signal: signal });
      if (signal.aborted) return [];
      var batch = data[root];
      total = batch.count;
      if (!batch[field].length && rows.length < total) throw new Error("The library changed while the dashboard was loading. Refresh to try again.");
      rows = rows.concat(batch[field]); page += 1;
    } while (group !== "performerCards" && rows.length < total);
    return rows;
  }

  function State(props) {
    if (StateView) return h(StateView, props);
    return h("div", { className: "dirty-stats-dashboard-state", role: props.role || "status" }, h("strong", null, props.title), props.detail ? h("p", null, props.detail) : null, props.actions || null);
  }

  function Chart(props) {
    var node = React.useRef(null);
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    React.useEffect(function () {
      if (!node.current || !props.option) return;
      if (!charts) { setError("The bundled chart library could not be loaded."); return; }
      var chart, observer;
      function resize() { if (chart && !chart.isDisposed()) chart.resize(); }
      try {
        if (props.map && world) charts.registerMap("dirtyStatsDashboardWorld", world);
        chart = algorithms.initStatsChart(node.current, { renderer: "canvas" });
        chart.setOption(props.option, true);
        if (typeof ResizeObserver === "function") { observer = new ResizeObserver(resize); observer.observe(node.current); }
        window.addEventListener("resize", resize);
        setError("");
      } catch (chartError) { setError(chartError.message); }
      return function () { if (observer) observer.disconnect(); window.removeEventListener("resize", resize); if (chart) chart.dispose(); };
    }, [props.option, props.map]);
    return error ? h("p", { className: "dirty-stats-dashboard-chart-error", role: "alert" }, error) : h("div", { ref: node, className: "dirty-stats-dashboard-chart", role: "img", "aria-label": props.label });
  }

  function axes(size, xName, yName) {
    var detailed = size === "large";
    return {
      grid: { left: detailed ? 14 : 6, right: 10, top: 12, bottom: detailed ? 42 : 18, containLabel: detailed },
      xAxis: { type: "value", name: detailed ? xName : "", nameLocation: "middle", nameGap: 28, axisLabel: { show: size !== "small", color: "#bbb" }, axisLine: { lineStyle: { color: "#788591" } }, splitLine: { show: size !== "small", lineStyle: { color: "#364655" } } },
      yAxis: { type: "value", name: detailed ? yName : "", nameLocation: "middle", nameGap: 42, axisLabel: { show: size !== "small", color: "#bbb" }, splitLine: { show: size !== "small", lineStyle: { color: "#364655" } } }
    };
  }

  function metric(label, value, detail) {
    return h(sharedReact.Metric, { className: "dirty-stats-dashboard-metric", label: label, value: value, detail: detail });
  }

  function ratingWidget(items, widget, entity) {
    var stats = algorithms.aggregateRatings(items, widget.options.rounding);
    var rated = stats.rows.filter(function (row) { return row.name !== "Unrated"; }).reduce(function (sum, row) { return sum + row.value; }, 0);
    var data = stats.rows.map(function (row) { return { name: row.name === "Unrated" ? "Unrated" : row.name + "/10", value: row.value }; });
    var option = { backgroundColor: "transparent", color: COLORS, tooltip: { trigger: "item", renderMode: "richText" }, legend: { show: widget.size === "large", type: "scroll", bottom: 0, textStyle: { color: "#ddd" } }, series: [{ type: "pie", radius: widget.size === "small" ? ["58%", "82%"] : ["34%", "70%"], center: ["50%", widget.size === "large" ? "43%" : "50%"], label: { show: widget.size !== "small", color: "#ddd", formatter: widget.size === "large" ? "{b}: {c}" : "{b}" }, data: data }] };
    return h(React.Fragment, null,
      h("div", { className: "dirty-stats-dashboard-metrics" }, metric(entity + "s", stats.total), metric("rated", stats.total ? Math.round(rated * 100 / stats.total) + "%" : "0%")),
      stats.total ? h(Chart, { option: option, label: entity + " rating distribution" }) : h(State, { title: "No " + entity + "s", detail: "The library has no data for this statistic." }));
  }

  function originWidget(performers, widget) {
    var countries = algorithms.countryIndex(world ? world.features : []);
    var stats = algorithms.aggregate(performers, countries);
    var top = stats.rows.slice(0, widget.size === "small" ? 5 : 8);
    var option;
    if (widget.size === "small" || !world) {
      option = { backgroundColor: "transparent", grid: { left: 4, right: 8, top: 4, bottom: 4, containLabel: true }, xAxis: { type: "value", show: false }, yAxis: { type: "category", inverse: true, data: top.map(function (row) { return row.name; }), axisLabel: { color: "#ddd", width: 90, overflow: "truncate" }, axisLine: { show: false }, axisTick: { show: false } }, series: [{ type: "bar", data: top.map(function (row) { return row.value; }), itemStyle: { color: "#54d5ca", borderRadius: [0, 3, 3, 0] }, label: { show: true, position: "right", color: "#ddd" } }] };
    } else {
      var counts = new Map(stats.rows.map(function (row) { return [row.name, row.value]; }));
      option = { backgroundColor: "transparent", tooltip: { trigger: "item", renderMode: "richText", formatter: function (p) { return p.name + ": " + (Number(p.value) || 0); } }, visualMap: { show: widget.size === "large", min: 0, max: Math.max(1, top.length ? top[0].value : 0), left: 8, bottom: 6, textStyle: { color: "#ddd" }, inRange: { color: ["#364655", "#5687a2", "#54d5ca"] } }, series: [{ type: "map", map: "dirtyStatsDashboardWorld", projection: algorithms.eckertIV, roam: widget.size === "large", label: { show: widget.size === "large" && widget.options.showNumbers, color: "#fff", formatter: function (p) { return Number(p.value) > 0 ? String(p.value) : ""; } }, itemStyle: { borderColor: "#788591", borderWidth: .5 }, emphasis: { itemStyle: { areaColor: "#bc8542" } }, data: world.features.map(function (feature) { return { name: feature.properties.name, value: counts.get(feature.properties.name) || 0 }; }) }] };
    }
    return h(React.Fragment, null, h("div", { className: "dirty-stats-dashboard-metrics" }, metric("performers", stats.total), metric("countries", stats.rows.length), metric("top country", top.length ? top[0].name : "—")), h(Chart, { option: option, map: widget.size !== "small", label: "Performer origin distribution" }));
  }

  function growthWidget(scenes, capacity, widget) {
    var stats = algorithms.aggregateGrowth(scenes, null, widget.options.dateBasis, widget.options.grouping);
    var daily = algorithms.aggregateGrowth(scenes, null, widget.options.dateBasis, "day");
    var forecast = algorithms.forecastGrowth(daily, capacity && capacity.total);
    var option = { backgroundColor: "transparent", useUTC: true, grid: { left: 8, right: 14, top: 12, bottom: widget.size === "large" ? 45 : 20, containLabel: widget.size !== "small" }, tooltip: { trigger: "axis", renderMode: "richText" }, xAxis: { type: "time", axisLabel: { show: widget.size !== "small", color: "#bbb", hideOverlap: true }, axisLine: { lineStyle: { color: "#788591" } } }, yAxis: { type: "value", min: 0, axisLabel: { show: widget.size !== "small", color: "#bbb", formatter: algorithms.formatBytes }, splitLine: { show: widget.size !== "small", lineStyle: { color: "#364655" } } }, dataZoom: widget.size === "large" ? [{ type: "inside" }, { type: "slider", bottom: 5, height: 16 }] : [], series: [{ type: "line", step: "end", showSymbol: false, lineStyle: { color: "#54d5ca", width: 2 }, areaStyle: { color: "#54d5ca", opacity: .15 }, data: stats.points, markLine: { silent: true, symbol: "none", data: widget.options.showCapacity && capacity && capacity.total > 0 ? [{ yAxis: capacity.total, label: { color: "#ddd", formatter: "Capacity " + algorithms.formatBytes(capacity.total) }, lineStyle: { color: "#9da8b2", type: "dashed" } }] : [] } }] };
    if (widget.options.showForecast && forecast.points) option.series.push({ name: "Forecast", type: "line", showSymbol: false, lineStyle: { color: "#f3c779", type: "dashed", width: 2 }, data: forecast.points });
    return h(React.Fragment, null, h("div", { className: "dirty-stats-dashboard-metrics" }, metric("library size", algorithms.formatBytes(stats.bytes)), metric("included scenes", stats.included), widget.size === "large" && widget.options.showForecast && forecast.reachedAt ? metric("capacity estimate", new Date(forecast.reachedAt).toISOString().slice(0, 10)) : stats.excluded ? metric("excluded", stats.excluded) : null), stats.points.length ? h(Chart, { option: option, label: "Cumulative content growth" }) : h(State, { title: "No dated content", detail: "No files have usable dates and sizes." }));
  }

  function ageWidget(scenes, widget) {
    var stats = algorithms.aggregateAges(scenes);
    var common = stats.rows.reduce(function (best, row) { return !best || row.count > best.count ? row : best; }, null);
    var option = { backgroundColor: "transparent", grid: { left: 8, right: 8, top: 8, bottom: widget.size === "large" ? 38 : 18, containLabel: widget.size !== "small" }, tooltip: { trigger: "axis", renderMode: "richText" }, xAxis: { type: "category", name: widget.size === "large" ? "Age" : "", data: stats.rows.map(function (row) { return row.age; }), axisLabel: { show: widget.size !== "small", color: "#bbb", interval: "auto" }, axisLine: { lineStyle: { color: "#788591" } } }, yAxis: { type: "value", name: widget.size === "large" ? "Performers" : "", minInterval: 1, axisLabel: { show: widget.size !== "small", color: "#bbb" }, splitLine: { show: widget.size !== "small", lineStyle: { color: "#364655" } } }, dataZoom: widget.size === "large" ? [{ type: "inside" }] : [], series: [{ type: "bar", data: stats.rows.map(function (row) { return row.count; }), itemStyle: { color: "#54d5ca" } }] };
    return h(React.Fragment, null, h("div", { className: "dirty-stats-dashboard-metrics" }, metric("performers", stats.performers), metric("most common age", common ? common.age : "—", common ? common.count + " performers" : ""), widget.size === "large" ? metric("scenes", stats.scenes) : null), stats.rows.length ? h(Chart, { option: option, label: "Performer ages at scene date" }) : h(State, { title: "No age data", detail: "Scene dates and full performer birthdates are required." }));
  }

  function scatterWidget(points, widget, names, highlighted) {
    var chartAxes = axes(widget.size, names[0], names[1]);
    var option = { backgroundColor: "transparent", grid: chartAxes.grid, xAxis: chartAxes.xAxis, yAxis: chartAxes.yAxis, tooltip: { trigger: "item", renderMode: "richText" }, series: [{ type: "scatter", symbolSize: widget.size === "small" ? 5 : 8, progressive: 4000, data: points, itemStyle: { color: "#54d5ca", opacity: .75 } }] };
    return h(React.Fragment, null, h("div", { className: "dirty-stats-dashboard-metrics" }, metric("points", points.length), highlighted != null ? metric("highlighted", highlighted) : null), points.length ? h(Chart, { option: option, label: names[0] + " versus " + names[1] }) : h(State, { title: "No rated data", detail: "No matching records contain the required values." }));
  }

  function performerScatterWidget(performers, widget) {
    var stats = algorithms.aggregateScatter(performers, widget.options.minRating, widget.options.maxScenes);
    var points = stats.points.map(function (point) { return { name: point.name, value: [point.rating, point.scenes], itemStyle: { color: point.highlight ? "#f3c779" : "#54d5ca" } }; });
    return scatterWidget(points, widget, ["Rating", "Scenes"], stats.highlights);
  }

  function countRatingWidget(scenes, widget) {
    var stats = algorithms.aggregateCountRating(scenes, widget.options.metric);
    var points = stats.points.map(function (point) { return { name: point.title, value: [point.rating, point.count] }; });
    return scatterWidget(points, widget, ["Scene rating", algorithms.countRatingLabel(widget.options.metric)], null);
  }

  function repeatOffenderWidget(scenes, widget) {
    var stats = algorithms.aggregateRepeatOffenders(scenes);
    var data = algorithms.repeatOffenderSeriesData(stats, null);
    var option = { backgroundColor: "transparent", grid: { left: 8, right: 12, top: 10, bottom: widget.size === "large" ? 42 : 18, containLabel: widget.size !== "small" }, tooltip: { trigger: "item", renderMode: "richText", formatter: function (p) { if (!p.data || !p.data.id) return p.seriesName; return p.data.title + "\n" + p.data.views + " views\nTop " + p.value[0].toFixed(1) + "% account for " + p.value[1].toFixed(1) + "% of views"; } }, xAxis: { type: "value", name: widget.size === "large" ? "Scenes ranked by views (%)" : "", min: 0, max: 100, axisLabel: { show: widget.size !== "small", color: "#bbb", formatter: "{value}%" }, axisLine: { lineStyle: { color: "#788591" } }, splitLine: { show: widget.size !== "small", lineStyle: { color: "#364655" } } }, yAxis: { type: "value", name: widget.size === "large" ? "Cumulative views (%)" : "", min: 0, max: 100, axisLabel: { show: widget.size !== "small", color: "#bbb", formatter: "{value}%" }, splitLine: { show: widget.size !== "small", lineStyle: { color: "#364655" } } }, series: [{ name: "Cumulative views", type: "line", showSymbol: false, sampling: "lttb", lineStyle: { color: "#54d5ca", width: 3 }, areaStyle: { color: "#54d5ca", opacity: .16 }, data: data, markArea: { silent: true, label: { show: widget.size === "large", color: "#ddd", formatter: "Top 5%" }, itemStyle: { color: "rgba(243,199,121,.10)" }, data: [[{ xAxis: 0 }, { xAxis: 5 }]] } }, { name: "Equal distribution", type: "line", showSymbol: false, silent: true, lineStyle: { color: "#788591", type: "dashed", width: 1 }, data: [[0, 0], [100, 100]] }] };
    var share = Math.round(stats.topShare * 10) / 10;
    return h(React.Fragment, null,
      h("div", { className: "dirty-stats-dashboard-metrics" }, metric("top 5% view share", stats.totalViews ? share.toFixed(1) + "%" : "—"), metric("recorded views", stats.totalViews), widget.size === "large" ? metric("viewed scenes", stats.viewedScenes + " / " + stats.totalScenes) : null),
      stats.totalViews ? h(Chart, { option: option, label: "Cumulative share of views by scene rank" }) : h(State, { title: "No recorded views", detail: stats.totalScenes ? "Play some scenes to reveal viewing concentration." : "No scenes match these filters." }));
  }

  function qualityEfficiencyWidget(scenes, widget) {
    var stats = algorithms.aggregateQualityEfficiency(scenes);
    var chartAxes = axes(widget.size, "Minutes per GiB", "Scene rating"); chartAxes.yAxis.max = 10;
    var bestEfficiency = stats.points.reduce(function (best, point) { return Math.max(best, point.efficiency); }, 0);
    var option = { backgroundColor: "transparent", grid: chartAxes.grid, xAxis: chartAxes.xAxis, yAxis: chartAxes.yAxis,
      tooltip: { trigger: "item", renderMode: "richText", formatter: function (p) { return p.data.title + "\nRating " + p.value[1].toFixed(1) + "/10\n" + p.value[0].toFixed(1) + " min/GiB\n" + algorithms.formatBytes(p.data.bytes); } },
      series: [{ name: "Scenes", type: "scatter", progressive: 4000, data: algorithms.qualityEfficiencySeriesData(stats) }] };
    return h(React.Fragment, null,
      h("div", { className: "dirty-stats-dashboard-metrics" }, metric("comparable scenes", stats.points.length), metric("best efficiency", bestEfficiency ? bestEfficiency.toFixed(1) + " min/GiB" : "—")),
      stats.points.length ? h(Chart, { option: option, label: "Scene quality versus storage efficiency; bubble area represents file size" }) : h(State, { title: "No comparable scenes", detail: "A rating plus file size and duration are required." }));
  }

  function studioWidget(scenes, widget) {
    var stats = algorithms.aggregateStudios(scenes);
    var points = stats.points.filter(function (point) { return point.rating != null && point.scenes >= widget.options.minScenes; });
    var maxBytes = Math.max.apply(null, [1].concat(points.map(function (point) { return point.bytes; })));
    var data = points.map(function (point) { return { name: point.name, bytes: point.bytes, value: [point.scenes, Math.round(point.rating * 10) / 10], symbolSize: 8 + 28 * Math.sqrt(point.bytes / maxBytes) }; });
    var chartAxes = axes(widget.size, "Scenes", "Average rating"); chartAxes.yAxis.max = 10;
    var option = { backgroundColor: "transparent", grid: chartAxes.grid, xAxis: chartAxes.xAxis, yAxis: chartAxes.yAxis, tooltip: { trigger: "item", renderMode: "richText", formatter: function (p) { return p.name + "\n" + p.value[0] + " scenes\nRating " + p.value[1] + "/10\n" + algorithms.formatBytes(p.data.bytes); } }, series: [{ type: "scatter", data: data, label: { show: widget.size === "large" && points.length <= 20, formatter: "{b}", color: "#ddd", position: "right" }, itemStyle: { color: "#54d5ca", opacity: .8 } }] };
    return h(React.Fragment, null, h("div", { className: "dirty-stats-dashboard-metrics" }, metric("studios", points.length), metric("scene storage", algorithms.formatBytes(stats.totalBytes))), data.length ? h(Chart, { option: option, label: "Studio scene count versus average rating" }) : h(State, { title: "No rated studios", detail: "No studios meet this widget's minimum scene count." }));
  }

  function tagDnaWidget(scenes, widget) {
    var stats = algorithms.aggregateTagDna(scenes);
    var data = algorithms.tagDnaSeriesData(stats, widget.options.metric, widget.options.maxTags, null);
    var option = { backgroundColor: "transparent", tooltip: { trigger: "item", renderMode: "richText", formatter: function (p) {
      var metric = widget.options.metric === "play_count" ? "Views per scene " + p.data.playsPerScene.toFixed(1) : p.data.rating == null ? "No rated scenes" : "Average rating " + p.data.rating.toFixed(1) + "/10";
      return p.name + "\n" + p.value + " scene" + (p.value === 1 ? "" : "s") + "\n" + metric;
    } }, series: [{ type: "treemap", roam: widget.size === "large", nodeClick: false, breadcrumb: { show: false }, top: 2, right: 2, bottom: 2, left: 2, squareRatio: 1.1, label: { show: true, color: "#fff", textBorderColor: "rgba(0,0,0,.5)", textBorderWidth: 2, overflow: "truncate", formatter: widget.size === "small" ? "{b}" : "{b}\n{c}" }, emphasis: { itemStyle: { borderColor: "#fff", borderWidth: 3 } }, data: data }] };
    return h(React.Fragment, null, h("div", { className: "dirty-stats-dashboard-metrics" }, metric("tags", stats.tags), metric("tagged scenes", stats.taggedScenes), widget.size === "large" ? metric("untagged", stats.untaggedScenes) : null), data.length ? h(Chart, { option: option, label: "Tag DNA treemap sized by scene count and colored by " + algorithms.tagDnaMetricLabel(widget.options.metric).toLowerCase() }) : h(State, { title: "No tagged scenes", detail: "No matching scenes contain tags." }));
  }

  function constellationWidget(scenes, widget) {
    var configuredLimit = Number(widget.options.maxPerformers);
    var limit = configuredLimit === 0 ? 0 : widget.size === "small" ? Math.min(30, configuredLimit) : widget.size === "medium" ? Math.min(60, configuredLimit) : configuredLimit;
    var stats = algorithms.aggregateConstellation(scenes, limit, widget.options.minShared);
    var largest = Math.max.apply(null, [1].concat(stats.nodes.map(function (node) { return node.value; })));
    var option = { backgroundColor: "transparent", tooltip: { trigger: "item", renderMode: "richText" }, series: [{ type: "graph", layout: "force", roam: widget.size === "large", draggable: widget.size === "large", data: stats.nodes.map(function (node, index) { return { id: node.id, name: node.name, value: node.value, symbolSize: 7 + 24 * Math.sqrt(node.value / largest), itemStyle: { color: node.genderColor }, label: { show: widget.size === "large" && index < 15, color: "#ddd", position: "right" } }; }), links: stats.links.map(function (link) { return { source: link.source, target: link.target, value: link.value, lineStyle: { color: "#5687a2", opacity: .25, width: 1 + Math.log(link.value) / Math.log(2) } }; }), force: { initLayout: "circular", repulsion: widget.size === "small" ? 70 : 150, edgeLength: widget.size === "small" ? 35 : 70, gravity: .05, layoutAnimation: true }, emphasis: { focus: "adjacency" } }] };
    return h(React.Fragment, null, h("div", { className: "dirty-stats-dashboard-metrics" }, metric("performers", stats.totalPerformers), metric("connections", stats.links.length), metric("scenes", stats.totalScenes)), stats.nodes.length ? h(Chart, { option: option, label: "Cast constellation network" }) : h(State, { title: "No cast connections", detail: "No performer connections meet this widget's threshold." }));
  }

  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function monthCalendar(entries, year, month) {
    var counts = {}, days = new Date(Date.UTC(year, month, 0)).getUTCDate(), start = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(), cells = [];
    entries.forEach(function (entry) { if (entry.month === month) counts[entry.day] = (counts[entry.day] || 0) + 1; });
    for (var blank = 0; blank < start; blank += 1) cells.push(h("span", { key: "b" + blank, className: "dirty-stats-dashboard-calendar-blank" }));
    for (var day = 1; day <= days; day += 1) cells.push(h("span", { key: day, className: "dirty-stats-dashboard-calendar-day" + (counts[day] ? " has-birthday" : ""), title: counts[day] ? counts[day] + " birthday" + (counts[day] === 1 ? "" : "s") : "" }, day, counts[day] > 1 ? h("small", null, counts[day]) : null));
    return h("section", { className: "dirty-stats-dashboard-calendar-month", "aria-label": MONTHS[month - 1] + " birthdays" }, h("h4", null, MONTHS[month - 1]), h("div", { className: "dirty-stats-dashboard-calendar-grid" }, cells));
  }

  function birthdayWidget(performers, widget) {
    var stats = algorithms.aggregateBirthdays(performers);
    var upcoming = stats.entries.slice().sort(function (left, right) { return left.daysUntil - right.daysUntil || left.name.localeCompare(right.name); }).slice(0, widget.options.upcomingCount);
    var now = new Date(), year = now.getUTCFullYear();
    if (widget.size === "small") return h(React.Fragment, null, h("div", { className: "dirty-stats-dashboard-metrics" }, metric("birthdays", stats.valid), metric("next 30 days", stats.upcoming)), h("ol", { className: "dirty-stats-dashboard-upcoming" }, upcoming.slice(0, 3).map(function (entry) { return h("li", { key: entry.id, className: entry.deceased ? "is-deceased" : "" }, h("strong", null, entry.name), h("span", null, algorithms.birthdayDayLabel(entry.month, entry.day) + (entry.daysUntil === 0 ? " · today" : " · " + entry.daysUntil + " day" + (entry.daysUntil === 1 ? "" : "s")) + (entry.deceased ? " · in memoriam" : ""))); })));
    var months = widget.size === "medium" ? [now.getUTCMonth() + 1] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return h(React.Fragment, null, h("div", { className: "dirty-stats-dashboard-metrics" }, metric("birthdays", stats.valid), metric("next 30 days", stats.upcoming), stats.today ? metric("today", stats.today) : null), h("ol", { className: "dirty-stats-dashboard-upcoming" }, upcoming.map(function (entry) { return h("li", { key: entry.id, className: entry.deceased ? "is-deceased" : "" }, h("strong", null, entry.name), h("span", null, algorithms.birthdayDayLabel(entry.month, entry.day) + (entry.daysUntil === 0 ? " · today" : " · " + entry.daysUntil + " day" + (entry.daysUntil === 1 ? "" : "s")) + (entry.deceased ? " · in memoriam" : ""))); })), h("div", { className: "dirty-stats-dashboard-calendars" }, months.map(function (month) { return monthCalendar(stats.entries, year, month); })));
  }

  function PerformerCardWidget(props) {
    var rows = props.rows, ids = rows.map(function (performer) { return String(performer.id); });
    var docsCapture = algorithms.docsCaptureEnabled(window.location.search);
    var readyState = React.useState(Boolean(api.components.PerformerCard)), ready = readyState[0], setReady = readyState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    React.useEffect(function () {
      if (api.components.PerformerCard) { setReady(true); return; }
      var active = true;
      if (!api.utils || !api.utils.loadComponents || !api.loadableComponents.Performers) { setError("Stash's native performer cards are unavailable."); return; }
      api.utils.loadComponents([api.loadableComponents.Performers]).then(function () {
        if (active) {
          if (api.components.PerformerCard) setReady(true);
          else setError("Stash's native performer cards could not be loaded.");
        }
      }).catch(function (loadError) { if (active) setError(loadError.message || String(loadError)); });
      return function () { active = false; };
    }, []);
    var query = api.GQL.useFindPerformersQuery({
      variables: { performer_ids: ids, filter: { page: 1, per_page: props.widget.options.cardCount }, performer_filter: {} },
      skip: docsCapture || !ready || !ids.length
    });
    if (!ids.length) return h(State, { title: "No performers", detail: "No performers match this widget's filters." });
    if (docsCapture) return h(State, { title: "Performer cards hidden", detail: "Cards are hidden while capturing documentation." });
    if (error) return h(State, { title: "Could not load performer cards", detail: error, role: "alert" });
    if (!ready || query.loading) return h(State, { title: "Loading performer cards…" });
    if (query.error) return h(State, { title: "Could not load performer cards", detail: query.error.message, role: "alert" });
    var cards = algorithms.orderedCards(query.data && query.data.findPerformers ? query.data.findPerformers.performers : [], ids);
    var deceasedIds = new Set(rows.filter(function (performer) { return performer.death_date; }).map(function (performer) { return String(performer.id); }));
    return h("div", { className: "dirty-stats-dashboard-performer-cards" },
      h("p", { className: "dirty-stats-dashboard-card-count" }, "Showing " + cards.length + " performer" + (cards.length === 1 ? "" : "s")),
      h("div", { className: "dirty-stats-dashboard-card-grid" }, cards.map(function (performer) {
        var deceased = deceasedIds.has(String(performer.id));
        return h("div", { key: performer.id, className: "dirty-stats-performer-column" + (deceased ? " is-deceased" : "") },
          deceased ? h("span", { className: "dirty-stats-memorial-label" }, "In memoriam") : null,
          h(api.components.PerformerCard, { performer: performer }));
      })));
  }

  function renderWidget(widget, resources) {
    var resource = resources[resourceKey(widget)];
    if (!resource || resource.loading) return h(State, { title: "Loading " + WIDGETS[widget.statistic].label.toLowerCase() + "…" });
    if (resource.error) return h(State, { title: "Could not load this widget", detail: resource.error, role: "alert" });
    var rows = resource.rows || [];
    if (widget.statistic === "performerCards") return h(PerformerCardWidget, { widget: widget, rows: rows });
    if (widget.statistic === "origin") return originWidget(rows, widget);
    if (widget.statistic === "growth") return growthWidget(rows, resource.capacity, widget);
    if (widget.statistic === "ages") return ageWidget(rows, widget);
    if (widget.statistic === "ratings") return ratingWidget(rows, widget, "scene");
    if (widget.statistic === "performerRatings") return ratingWidget(rows, widget, "performer");
    if (widget.statistic === "performerScatter") return performerScatterWidget(rows, widget);
    if (widget.statistic === "countRating") return countRatingWidget(rows, widget);
    if (widget.statistic === "repeatOffenders") return repeatOffenderWidget(rows, widget);
    if (widget.statistic === "qualityEfficiency") return qualityEfficiencyWidget(rows, widget);
    if (widget.statistic === "studios") return studioWidget(rows, widget);
    if (widget.statistic === "tags") return tagDnaWidget(rows, widget);
    if (widget.statistic === "constellation") return constellationWidget(rows, widget);
    return birthdayWidget(rows, widget);
  }

  function SelectControl(props) {
    var id = React.useRef(null);
    if (!id.current) id.current = "dirty-stats-dashboard-control-" + (++controlId);
    return h(Field, { id: id.current, label: props.label, className: "dirty-stats-dashboard-field" + (props.className ? " " + props.className : "") },
      h("select", { className: "form-control form-control-sm dirty-ui-select", value: props.value, onChange: function (event) { props.onChange(event.target.value); } },
        props.values.map(function (value) { return h("option", { key: String(value), value: value }, props.labels && props.labels[value] != null ? props.labels[value] : String(value)); })));
  }

  function CheckControl(props) {
    return h(Toggle, { className: "dirty-stats-dashboard-check", checked: props.value, label: props.label, onChange: props.onChange });
  }

  function WidgetOptions(props) {
    var widget = props.widget, options = widget.options;
    function set(name, value) { var next = Object.assign({}, options); next[name] = value; props.onChange(next); }
    if (widget.statistic === "origin") return h(CheckControl, { label: "Show map numbers in large view", value: options.showNumbers, onChange: function (value) { set("showNumbers", value); } });
    if (widget.statistic === "growth") return h(React.Fragment, null,
      h(SelectControl, { label: "Date basis", value: options.dateBasis, values: WIDGETS.growth.choices.dateBasis, labels: { created_at: "Created at", mod_time: "File modified", scene_date: "Scene date" }, onChange: function (value) { set("dateBasis", value); } }),
      h(SelectControl, { label: "Group by", value: options.grouping, values: WIDGETS.growth.choices.grouping, onChange: function (value) { set("grouping", value); } }),
      h(CheckControl, { label: "Show capacity", value: options.showCapacity, onChange: function (value) { set("showCapacity", value); } }),
      h(CheckControl, { label: "Show forecast", value: options.showForecast, onChange: function (value) { set("showForecast", value); } }));
    if (widget.statistic === "ratings" || widget.statistic === "performerRatings") return h(SelectControl, { label: "Rating rounding", value: options.rounding, values: WIDGETS[widget.statistic].choices.rounding, labels: { 0: "Exact", 0.5: "0.5", 1: "1" }, onChange: function (value) { set("rounding", Number(value)); } });
    if (widget.statistic === "performerScatter") return h(React.Fragment, null,
      h(SelectControl, { label: "Minimum rating", value: options.minRating, values: WIDGETS.performerScatter.choices.minRating, labels: { 0: "Any" }, onChange: function (value) { set("minRating", Number(value)); } }),
      h(SelectControl, { label: "Maximum scenes", value: options.maxScenes, values: WIDGETS.performerScatter.choices.maxScenes, labels: { 0: "Any" }, onChange: function (value) { set("maxScenes", Number(value)); } }));
    if (widget.statistic === "performerCards") return h(SelectControl, { label: "Cards to display", value: options.cardCount, values: WIDGETS.performerCards.choices.cardCount, onChange: function (value) { set("cardCount", Number(value)); } });
    if (widget.statistic === "countRating") return h(SelectControl, { label: "Count", value: options.metric, values: WIDGETS.countRating.choices.metric, labels: { play_count: "View count", o_counter: "O count" }, onChange: function (value) { set("metric", value); } });
    if (widget.statistic === "studios") return h(SelectControl, { label: "Minimum scenes", value: options.minScenes, values: WIDGETS.studios.choices.minScenes, onChange: function (value) { set("minScenes", Number(value)); } });
    if (widget.statistic === "tags") return h(React.Fragment, null,
      h(SelectControl, { label: "Color by", value: options.metric, values: WIDGETS.tags.choices.metric, labels: { rating: "Average rating", play_count: "Views per scene" }, onChange: function (value) { set("metric", value); } }),
      h(SelectControl, { label: "Maximum tags", value: options.maxTags, values: WIDGETS.tags.choices.maxTags, labels: { 0: "All" }, onChange: function (value) { set("maxTags", Number(value)); } }));
    if (widget.statistic === "constellation") return h(React.Fragment, null,
      h(SelectControl, { label: "Maximum performers", value: options.maxPerformers, values: WIDGETS.constellation.choices.maxPerformers, labels: { 0: "All" }, onChange: function (value) { set("maxPerformers", Number(value)); } }),
      h(SelectControl, { label: "Minimum shared scenes", value: options.minShared, values: WIDGETS.constellation.choices.minShared, onChange: function (value) { set("minShared", Number(value)); } }));
    if (widget.statistic === "birthdays") return h(SelectControl, { label: "Upcoming performers", value: options.upcomingCount, values: WIDGETS.birthdays.choices.upcomingCount, onChange: function (value) { set("upcomingCount", Number(value)); } });
    return h("span", { className: "dirty-stats-dashboard-no-options" }, "This statistic has no additional widget options.");
  }

  function filterSummary(filter, entity) {
    var normalized = normalizeFilter(filter);
    if (!normalized.count) return "All " + entity;
    return normalized.count + " active " + (normalized.count === 1 ? "filter" : "filters");
  }

  function DashboardFilterChooser(props) {
    var readyState = React.useState(false), ready = readyState[0], setReady = readyState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var changeRef = React.useRef(props.onChange);
    changeRef.current = props.onChange;
    React.useEffect(function () {
      var active = true;
      window.__dirtyStatsDashboardFilterActive = props.entity;
      window.__dirtyStatsDashboardFilterListener = function (entity, filter) {
        if (active && entity === props.entity) changeRef.current(normalizeFilter(filter));
      };
      (async function () {
        var componentName = props.entity === "performers" ? "FilteredPerformerList" : "FilteredSceneList";
        var loadableName = props.entity === "performers" ? "Performers" : "SceneList";
        await hub.native.ensureComponents(loadableName, [componentName]);
        if (active) setReady(true);
      })().catch(function (loadError) { if (active) setError(loadError.message || String(loadError)); });
      return function () {
        active = false;
        if (window.__dirtyStatsDashboardFilterActive === props.entity) window.__dirtyStatsDashboardFilterActive = null;
        window.__dirtyStatsDashboardFilterListener = null;
      };
    }, [props.entity]);
    if (error) return h(State, { title: "Filters unavailable", detail: error, role: "alert" });
    if (!ready) return h(State, { title: "Loading " + props.entity + " filters…" });
    var FilteredList = props.entity === "performers" ? api.components.FilteredPerformerList : api.components.FilteredSceneList;
    return h("div", { className: "dirty-stats-dashboard-native-filter dirty-stats-native-filters" },
      h(FilteredList, { key: props.filterKey, view: props.entity, alterQuery: false, extraCriteria: { dirtyStatsDashboardFilter: true } }));
  }

  function DashboardFilterDialog(props) {
    var dialog = React.useRef(null);
    React.useEffect(function () {
      var previous = document.activeElement;
      var unlockScroll = hub.ui.lockBodyScroll();
      var focusTimer = window.setTimeout(function () {
        var first = dialog.current && dialog.current.querySelector("button, input, select, [tabindex=\"0\"]");
        if (first) first.focus();
      }, 0);
      return function () {
        window.clearTimeout(focusTimer);
        unlockScroll();
        if (previous && typeof previous.focus === "function") previous.focus();
      };
    }, []);
    function keyDown(event) {
      if (event.key === "Escape") { event.preventDefault(); props.onClose(); return; }
      hub.ui.trapDialogTab(event, dialog.current);
    }
    return api.ReactDOM.createPortal(h("div", { className: "dirty-stats-dashboard-dialog-backdrop " + algorithms.statsThemeClass(), onMouseDown: function (event) { if (event.target === event.currentTarget) props.onClose(); } },
      h("section", { ref: dialog, className: "dirty-stats-dashboard-filter-dialog dirty-ui-panel", role: "dialog", "aria-modal": true, "aria-labelledby": props.labelId, onKeyDown: keyDown },
        h("header", { className: "dirty-stats-dashboard-dialog-header" }, h("h2", { id: props.labelId }, props.title), h("button", { type: "button", className: "dirty-ui-icon-button dirty-ui-icon-button-compact", onClick: props.onClose, "aria-label": "Close filter dialog" }, "×")),
        props.children)), document.body);
  }

  function DashboardWidget(props) {
    var widget = props.widget, definition = WIDGETS[widget.statistic];
    var title = widgetTitle(widget);
    var compact = widget.size !== "large" && !props.editing;
    return h("article", { className: "dirty-stats-dashboard-widget dirty-stats-dashboard-widget-" + widget.size + " dirty-stats-dashboard-height-" + widgetHeightUnits(widget) + (compact ? " is-compact" : "") + (props.dragging ? " is-dragging" : ""), "data-statistic": widget.statistic, "data-widget-index": props.index, "aria-grabbed": props.dragging ? "true" : undefined },
      h("header", { className: "dirty-stats-dashboard-widget-header" + (compact ? " is-compact" : "") },
        h("div", { className: "dirty-stats-dashboard-widget-title" }, props.editing ?
          h("input", { type: "text", className: "dirty-stats-dashboard-title-input", value: widget.title || "", placeholder: definition.label, maxLength: 100, "aria-label": definition.label + " widget title", onChange: function (event) { props.onTitle(event.target.value); } }) :
          h("h2", { title: title }, title)),
        h("div", { className: "dirty-stats-dashboard-widget-actions" },
          props.editing || widget.statistic === "performerCards" ? null : h(Link, { className: "dirty-stats-dashboard-open-link", to: hub.captureUrl(definition.route), title: "Open " + definition.label + " full view", "aria-label": "Open " + definition.label + " full view" }, h("span", { "aria-hidden": true }, "↗")),
          props.editing ? h(React.Fragment, null,
            h("button", { type: "button", className: "dirty-ui-icon-button dirty-ui-icon-button-compact dirty-stats-dashboard-drag-handle", title: "Drag to reorder; arrow keys also move this widget", "aria-label": "Reorder " + title + "; use arrow keys or drag", onPointerDown: props.onDragStart, onKeyDown: props.onDragKeyDown }, h("span", { "aria-hidden": true }, "⠿")),
            h("button", { type: "button", className: "dirty-ui-icon-button dirty-ui-icon-button-compact dirty-ui-icon-button-danger dirty-stats-dashboard-remove", title: "Remove widget", "aria-label": "Remove " + title + " widget", onClick: props.onRemove }, h("span", { "aria-hidden": true }, "×"))) : null)),
      props.editing ? h("div", { className: "dirty-stats-dashboard-editor", role: "group", "aria-label": definition.label + " widget settings" },
        h(SelectControl, { label: "Size", value: widget.size, values: SIZES, labels: SIZE_LABELS, onChange: props.onSize }),
        h("div", { className: "dirty-stats-dashboard-filter-setting" }, h("span", null, filterSummary(widget.filter, definition.entity)), h("button", { type: "button", className: "btn btn-secondary dirty-ui-button dirty-ui-control-compact", onClick: props.onFilter }, "Change filters")),
        h("div", { className: "dirty-stats-dashboard-options" }, h(WidgetOptions, { widget: widget, onChange: props.onOptions }))) : null,
      h("div", { className: "dirty-stats-dashboard-widget-body" }, renderWidget(widget, props.resources)));
  }

  function DashboardPage(props) {
    var widgetsState = React.useState([]), widgets = widgetsState[0], setWidgets = widgetsState[1];
    var readyState = React.useState(false), ready = readyState[0], setReady = readyState[1];
    var editState = React.useState(false), editing = editState[0], setEditing = editState[1];
    var addState = React.useState(false), adding = addState[0], setAdding = addState[1];
    var draftState = React.useState(null), draft = draftState[0], setDraft = draftState[1];
    var filterEditState = React.useState(null), filterEdit = filterEditState[0], setFilterEdit = filterEditState[1];
    var pendingFilterState = React.useState(null), pendingFilter = pendingFilterState[0], setPendingFilter = pendingFilterState[1];
    var dragState = React.useState(null), draggingId = dragState[0], setDraggingId = dragState[1];
    var announcementState = React.useState(""), dragAnnouncement = announcementState[0], setDragAnnouncement = announcementState[1];
    var dragCleanup = React.useRef(null);
    var resourcesState = React.useState({}), resources = resourcesState[0], setResources = resourcesState[1];
    React.useEffect(function () {
      var active = true;
      Promise.resolve(core.settingsReady).then(function () {
        if (!active) return;
        var storedVersion = core.getSettingExtra("dashboardSchemaVersion", 0);
        var storedWidgets = core.getSettingExtra("dashboardWidgets", null);
        setWidgets(normalizeWidgets(storedWidgets, storedVersion !== DASHBOARD_VERSION));
        setReady(true);
      });
      return function () { active = false; };
    }, []);
    React.useEffect(function () {
      if (!ready) return;
      core.setSettingExtra("dashboardSchemaVersion", DASHBOARD_VERSION);
      core.setSettingExtra("dashboardWidgets", widgets);
    }, [ready, widgets]);
    var resourcesKey = JSON.stringify(requiredResources(widgets));
    React.useEffect(function () {
      if (!ready) return;
      var controller = new AbortController();
      var requested = JSON.parse(resourcesKey);
      requested.forEach(function (request) {
        setResources(function (current) { var next = Object.assign({}, current); next[request.key] = { loading: true, rows: [], error: "", capacity: null }; return next; });
        fetchPages(request.group, request.filter, controller.signal, request.limit).then(async function (rows) {
          var capacity = null;
          if (request.group === "growth" && !controller.signal.aborted) {
            try {
              var configuration = await hub.graphql("query DirtyStatsDashboardSources{configuration{general{stashes{path excludeVideo}}}}", {}, { signal: controller.signal });
              var paths = configuration.configuration.general.stashes.filter(function (source) { return !source.excludeVideo; }).map(function (source) { return source.path; });
              capacity = await hub.runPluginOperation("dirtyStats", { mode: "capacity", paths: paths });
            } catch (_capacityError) { capacity = null; }
          }
          if (!controller.signal.aborted) setResources(function (current) { var next = Object.assign({}, current); next[request.key] = { loading: false, rows: rows, error: "", capacity: capacity }; return next; });
        }).catch(function (error) {
          if (!controller.signal.aborted) setResources(function (current) { var next = Object.assign({}, current); next[request.key] = { loading: false, rows: [], error: error.message || String(error), capacity: null }; return next; });
        });
      });
      return function () { controller.abort(); };
    }, [ready, resourcesKey]);
    React.useEffect(function () { return function () { if (dragCleanup.current) dragCleanup.current(false); }; }, []);
    function replace(index, patch) { setWidgets(function (current) { return current.map(function (widget, position) { return position === index ? Object.assign({}, widget, patch) : widget; }); }); }
    function startDrag(index, event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (dragCleanup.current) dragCleanup.current(false);
      event.preventDefault();
      var pointerId = event.pointerId;
      var dragged = widgets[index];
      var draggedId = dragged.id;
      var label = widgetTitle(dragged);
      var lastTarget = index;
      var moved = false;
      function finish(announce) {
        document.removeEventListener("pointermove", pointerMove);
        document.removeEventListener("pointerup", pointerEnd);
        document.removeEventListener("pointercancel", pointerEnd);
        dragCleanup.current = null;
        setDraggingId(null);
        if (announce) setDragAnnouncement(moved ? label + " placed at position " + (lastTarget + 1) + "." : label + " position unchanged.");
      }
      function pointerMove(pointerEvent) {
        if (pointerEvent.pointerId !== pointerId) return;
        pointerEvent.preventDefault();
        var target = document.elementFromPoint(pointerEvent.clientX, pointerEvent.clientY);
        var card = target && target.closest ? target.closest("[data-widget-index]") : null;
        if (!card) return;
        var targetIndex = Number(card.getAttribute("data-widget-index"));
        if (!Number.isInteger(targetIndex) || targetIndex === lastTarget) return;
        setWidgets(function (current) {
          var from = current.findIndex(function (widget) { return widget.id === draggedId; });
          return reorderWidgets(current, from, targetIndex);
        });
        lastTarget = targetIndex;
        moved = true;
        setDragAnnouncement(label + " moved to position " + (targetIndex + 1) + ".");
      }
      function pointerEnd(pointerEvent) { if (pointerEvent.pointerId === pointerId) finish(true); }
      setDraggingId(draggedId);
      setDragAnnouncement("Dragging " + label + ". Move over another widget to reorder.");
      document.addEventListener("pointermove", pointerMove, { passive: false });
      document.addEventListener("pointerup", pointerEnd);
      document.addEventListener("pointercancel", pointerEnd);
      dragCleanup.current = finish;
    }
    function remove(index) { setWidgets(function (current) { return current.filter(function (_widget, position) { return position !== index; }); }); }
    function moveWithKeyboard(index, event) {
      var delta = event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (!delta || index + delta < 0 || index + delta >= widgets.length) return;
      event.preventDefault();
      setWidgets(function (current) { return reorderWidgets(current, index, index + delta); });
      setDragAnnouncement(widgetTitle(widgets[index]) + " moved to position " + (index + delta + 1) + ".");
    }
    function beginAdd(statistic) { var definition = WIDGETS[statistic]; setDraft({ id: nextWidgetId(statistic, widgets), statistic: statistic, title: "", size: definition.size, options: clone(definition.options), filter: null }); }
    function updateDraft(patch) { setDraft(function (current) { return current ? Object.assign({}, current, patch) : current; }); }
    function addDraft() { if (!draft || !draft.filter) return; setWidgets(function (current) { return current.concat([Object.assign({}, draft, { title: normalizeTitle(draft.title), filter: normalizeFilter(draft.filter) })]); }); setDraft(null); setAdding(false); }
    function beginFilterEdit(index) { setAdding(false); setDraft(null); setFilterEdit(index); setPendingFilter(null); }
    function applyFilterEdit() { if (filterEdit == null || !pendingFilter) return; replace(filterEdit, { filter: normalizeFilter(pendingFilter) }); setFilterEdit(null); setPendingFilter(null); }
    function toggleEditing() {
      if (dragCleanup.current) dragCleanup.current(false);
      if (editing) { setAdding(false); setDraft(null); setFilterEdit(null); setPendingFilter(null); }
      setEditing(!editing);
    }
    function toggleAdding() { setAdding(!adding); setDraft(null); setFilterEdit(null); setPendingFilter(null); }
    var filterWidget = filterEdit == null ? null : widgets[filterEdit];
    if (!ready) return h(State, { title: "Loading dashboard…" });
    return h("section", { className: "dirty-stats-dashboard", "aria-label": "DirtyStats dashboard" },
      h("div", { className: "dirty-stats-dashboard-heading" }, props.selector,
        h("div", { className: "dirty-stats-actions dirty-ui-control-row" },
          editing ? h(React.Fragment, null,
            h(SelectControl, { className: "dirty-stats-dashboard-theme", label: "Theme", value: algorithms.statsSettings.visualTheme, values: THEME_VALUES, labels: THEME_LABELS, onChange: function (theme) { algorithms.setStatsSetting("visualTheme", theme); } }),
            h("button", { type: "button", className: "btn btn-secondary dirty-ui-button dirty-ui-control", disabled: !adding && widgets.length >= MAX_WIDGETS, onClick: toggleAdding }, adding ? "Close widget picker" : "Add widget")) : null,
          h("button", { type: "button", className: "btn btn-primary dirty-ui-button dirty-ui-control", onClick: toggleEditing }, editing ? "Done editing" : "Edit dashboard"))),
      h("p", { className: "dirty-stats-dashboard-visually-hidden", role: "status", "aria-live": "polite" }, dragAnnouncement),
      adding ? h("section", { className: "dirty-stats-dashboard-picker dirty-ui-panel", "aria-label": "Add a statistic widget" },
        h("h2", null, "Add widget"),
        h("p", null, "Add another view of any statistic and give it its own filters and display options."),
        h("div", { className: "dirty-stats-dashboard-picker-grid" }, WIDGET_ORDER.map(function (statistic) { return h("button", { key: statistic, type: "button", className: "btn btn-secondary dirty-ui-button", disabled: widgets.length >= MAX_WIDGETS, onClick: function () { beginAdd(statistic); } }, WIDGETS[statistic].label); }))) : null,
      draft ? h(DashboardFilterDialog, { labelId: "dirty-stats-add-widget-dialog", title: "Add " + WIDGETS[draft.statistic].label, onClose: function () { setDraft(null); } },
        h("div", { className: "dirty-stats-dashboard-add-settings" },
          h(Field, { id: "dirty-stats-widget-title", label: "Custom title", className: "dirty-stats-dashboard-field dirty-stats-dashboard-title-field" }, h("input", { type: "text", className: "form-control form-control-sm", value: draft.title || "", placeholder: WIDGETS[draft.statistic].label, maxLength: 100, onChange: function (event) { updateDraft({ title: event.target.value }); } })),
          h(SelectControl, { label: "Size", value: draft.size, values: SIZES, labels: SIZE_LABELS, onChange: function (size) { updateDraft({ size: size }); } }),
          h("div", { className: "dirty-stats-dashboard-options" }, h(WidgetOptions, { widget: draft, onChange: function (options) { updateDraft({ options: normalizeOptions(WIDGETS[draft.statistic], options) }); } }))),
        h("div", { className: "dirty-stats-dashboard-filter-heading" }, h("div", null, h("h3", null, "Filters"), h("p", null, "Use the same native filters as the full view. Changes apply to this widget only.")), draft.filter ? h("strong", null, filterSummary(draft.filter, WIDGETS[draft.statistic].entity)) : null),
        h(DashboardFilterChooser, { filterKey: "add-" + draft.id, entity: WIDGETS[draft.statistic].entity, onChange: function (filter) { updateDraft({ filter: filter }); } }),
        h("div", { className: "dirty-stats-dashboard-picker-actions" },
          h("button", { type: "button", className: "btn btn-secondary dirty-ui-button", onClick: function () { setDraft(null); } }, "Cancel"),
          h("button", { type: "button", className: "btn btn-primary dirty-ui-button", disabled: !draft.filter, onClick: addDraft }, "Add widget"))) : null,
      filterWidget ? h(DashboardFilterDialog, { labelId: "dirty-stats-edit-filter-dialog", title: "Change filters · " + WIDGETS[filterWidget.statistic].label, onClose: function () { setFilterEdit(null); setPendingFilter(null); } },
        h("p", null, "Current selection: " + filterSummary(filterWidget.filter, WIDGETS[filterWidget.statistic].entity) + ". Choose a new selection below; it will replace the current filters when applied."),
        h(DashboardFilterChooser, { filterKey: "edit-" + filterWidget.id, entity: WIDGETS[filterWidget.statistic].entity, onChange: setPendingFilter }),
        h("div", { className: "dirty-stats-dashboard-picker-actions" },
          h("button", { type: "button", className: "btn btn-secondary dirty-ui-button", onClick: function () { setFilterEdit(null); setPendingFilter(null); } }, "Cancel"),
          h("button", { type: "button", className: "btn btn-primary dirty-ui-button", disabled: !pendingFilter, onClick: applyFilterEdit }, "Apply filters"))) : null,
      !widgets.length ? h(State, { title: "Your dashboard is empty", detail: editing ? "Choose Add widget to build your library overview." : "Enter edit mode to add your first widget.", actions: editing ? h("button", { type: "button", className: "btn btn-primary dirty-ui-button", onClick: function () { setAdding(true); } }, "Add widget") : h("button", { type: "button", className: "btn btn-primary dirty-ui-button", onClick: toggleEditing }, "Edit dashboard") }) :
        h("div", { className: "dirty-stats-dashboard-grid" + (editing ? " is-editing" : "") + (draggingId ? " is-reordering" : "") }, widgets.map(function (widget, index) { return h(DashboardWidget, { key: widget.id, widget: widget, index: index, editing: editing, dragging: draggingId === widget.id, resources: resources, onDragStart: function (event) { startDrag(index, event); }, onDragKeyDown: function (event) { moveWithKeyboard(index, event); }, onRemove: function () { remove(index); }, onTitle: function (title) { replace(index, { title: title }); }, onSize: function (size) { replace(index, { size: size }); }, onFilter: function () { beginFilterEdit(index); }, onOptions: function (options) { replace(index, { options: normalizeOptions(WIDGETS[widget.statistic], options) }); } }); })));
  }

  window.__dirtyStatsDashboard = { Component: DashboardPage, Widget: DashboardWidget, algorithms: { normalizeWidgets: normalizeWidgets, normalizeOptions: normalizeOptions, normalizeFilter: normalizeFilter, widgetTitle: widgetTitle, widgetHeightUnits: widgetHeightUnits, requiredGroups: requiredGroups, requiredResources: requiredResources, resourceKey: resourceKey, fetchPages: fetchPages, reorderWidgets: reorderWidgets, nextWidgetId: nextWidgetId }, registry: WIDGETS, defaults: DEFAULT_WIDGETS, maxWidgets: MAX_WIDGETS };
})();
