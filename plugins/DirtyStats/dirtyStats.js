(function () {
  "use strict";
  if (window.__dirtyStatsPlugin) return;
  var api = window.PluginApi;
  var hub = window.DirtyPlugins;
  if (!api || !hub || !hub.graphql) return;
  var React = api.React;
  var h = React.createElement;
  var route = "/plugins/dirty-stats";
  var growthRoute = route + "/scenes";
  var ageRoute = route + "/ages";
  var ratingRoute = route + "/ratings";
  var performerRatingRoute = route + "/performer-ratings";
  var constellationRoute = route + "/constellation";
  var agePerformerFilter = null;
  var performerFilterEvent = "dirty-stats:performer-filter";
  // Native filters can remount the scene list; keep its date choice for this session.
  var growthDateBasis = "created_at";
  var growthGrouping = "day";
  var growthShowForecast = false;
  var growthShowCapacity = true;
  var constellationMaxPerformers = 100;
  var constellationMinShared = 1;
  var ratingRounding = 0.5;
  // Keep the bundled library reference even if another plugin loads ECharts later.
  var charts = window.echarts;
  var world = window.__dirtyStatsWorld;

  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function countryIndex(features) {
    var index = Object.create(null);
    var display = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
    features.forEach(function (feature) {
      var p = feature.properties;
      [p.name, p.iso2, p.iso3].concat(p.aliases || []).forEach(function (name) {
        if (name && name !== "-99") index[normalize(name)] = p.name;
      });
      if (display && /^[A-Z]{2}$/.test(p.iso2)) index[normalize(display.of(p.iso2))] = p.name;
    });
    var aliases = { USA: "United States of America", US: "United States of America", "United States": "United States of America", UK: "United Kingdom", "Great Britain": "United Kingdom", "Czech Republic": "Czechia", "Russian Federation": "Russia", "South Korea": "South Korea", "Republic of Korea": "South Korea", "North Korea": "North Korea", "Ivory Coast": "Ivory Coast", "Cote d'Ivoire": "Ivory Coast", "Democratic Republic of the Congo": "Democratic Republic of the Congo", "DR Congo": "Democratic Republic of the Congo", "Republic of the Congo": "Republic of the Congo" };
    Object.keys(aliases).forEach(function (name) {
      var target = index[normalize(aliases[name])];
      if (target) index[normalize(name)] = target;
    });
    return index;
  }
  var countries = countryIndex(world ? world.features : []);
  function aggregate(performers, index) {
    var counts = Object.create(null);
    var unknown = Object.create(null);
    var missing = 0;
    performers.forEach(function (p) {
      if (!String(p.country || "").trim()) { missing++; return; }
      var country = index[normalize(p.country)];
      if (country) counts[country] = (counts[country] || 0) + 1;
      else unknown[p.country] = (unknown[p.country] || 0) + 1;
    });
    return { rows: Object.keys(counts).map(function (name) { return { name: name, value: counts[name] }; }).sort(function (a, b) { return b.value - a.value || a.name.localeCompare(b.name); }), missing: missing, unknown: unknown, total: performers.length };
  }
  function fullDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return null;
    var date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
  }
  function ageAtScene(birthdate, sceneDate) {
    var birth = fullDate(birthdate), scene = fullDate(sceneDate);
    if (!birth || !scene || birth > scene) return null;
    var age = scene.getUTCFullYear() - birth.getUTCFullYear();
    if (scene.getUTCMonth() < birth.getUTCMonth() || (scene.getUTCMonth() === birth.getUTCMonth() && scene.getUTCDate() < birth.getUTCDate())) age--;
    return age;
  }
  function aggregateAges(scenes) {
    var buckets = new Map(), performers = new Set(), seen = new Set(), missingSceneDates = 0, missingBirthdates = 0;
    scenes.forEach(function (scene) {
      if (seen.has(scene.id)) return;
      seen.add(scene.id);
      if (!fullDate(scene.date)) { missingSceneDates++; return; }
      var scenePerformers = new Set();
      (scene.performers || []).forEach(function (performer) {
        if (scenePerformers.has(performer.id)) return;
        scenePerformers.add(performer.id);
        var age = ageAtScene(performer.birthdate, scene.date);
        if (age == null) { missingBirthdates++; return; }
        if (!buckets.has(age)) buckets.set(age, new Set());
        buckets.get(age).add(performer.id); performers.add(performer.id);
      });
    });
    var ages = Array.from(buckets.keys()).sort(function (a, b) { return a - b; }), rows = [];
    if (ages.length) for (var age = ages[0]; age <= ages[ages.length - 1]; age++) rows.push({ age: age, count: buckets.has(age) ? buckets.get(age).size : 0 });
    return { rows: rows, performers: performers.size, scenes: seen.size, missingSceneDates: missingSceneDates, missingBirthdates: missingBirthdates };
  }
  function performersAtAge(scenes, selectedAge) {
    var found = new Map();
    scenes.forEach(function (scene) {
      (scene.performers || []).forEach(function (performer) {
        var age = ageAtScene(performer.birthdate, scene.date);
        if (age != null && (selectedAge == null || age === selectedAge)) found.set(performer.id, { id: performer.id });
      });
    });
    return Array.from(found.values());
  }
  function download(url, filename) {
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  function StatisticSelector(props) {
    var history = api.libraries.ReactRouterDOM.useHistory();
    var bootstrap = api.libraries.Bootstrap, Dropdown = bootstrap.Dropdown;
    return h(Dropdown, { as: bootstrap.ButtonGroup, className: "sort-by-select dirty-stats-selector", onSelect: function (value) { if (value && value !== props.value) history.push(value === "growth" ? growthRoute : value === "ages" ? ageRoute : value === "ratings" ? ratingRoute : value === "performerRatings" ? performerRatingRoute : value === "constellation" ? constellationRoute : route); } },
      h(bootstrap.InputGroup.Prepend, null, h(Dropdown.Toggle, { variant: "secondary", id: "dirty-stats-statistic", "aria-label": "Statistic" }, props.value === "growth" ? "Content growth" : props.value === "ages" ? "Age at scene" : props.value === "ratings" ? "Scene ratings" : props.value === "performerRatings" ? "Performer ratings" : props.value === "constellation" ? "Cast constellation" : "Performer origin")),
      h(Dropdown.Menu, { className: "bg-secondary text-white" },
        h(Dropdown.Item, { className: "bg-secondary text-white", eventKey: "origin", active: props.value === "origin" }, "Performer origin"),
        h(Dropdown.Item, { className: "bg-secondary text-white", eventKey: "growth", active: props.value === "growth" }, "Content growth"),
        h(Dropdown.Item, { className: "bg-secondary text-white", eventKey: "ages", active: props.value === "ages" }, "Age at scene"),
        h(Dropdown.Item, { className: "bg-secondary text-white", eventKey: "ratings", active: props.value === "ratings" }, "Scene ratings"),
        h(Dropdown.Item, { className: "bg-secondary text-white", eventKey: "performerRatings", active: props.value === "performerRatings" }, "Performer ratings"),
        h(Dropdown.Item, { className: "bg-secondary text-white", eventKey: "constellation", active: props.value === "constellation" }, "Cast constellation")));
  }
  function FilterStatisticSelector(props) {
    var state = React.useState(null), toolbar = state[0], setToolbar = state[1];
    React.useEffect(function () {
      var root = props.page.current;
      if (!root) return;
      function findToolbar() { setToolbar(root.querySelector(".filtered-list-toolbar")); }
      findToolbar();
      var observer = new MutationObserver(findToolbar);
      observer.observe(root, { childList: true, subtree: true });
      return function () { observer.disconnect(); };
    }, [props.value]);
    var selector = h("div", { className: "dirty-stats-filter-statistic" }, h(StatisticSelector, { value: props.value }), props.value === "ages" ? h(AgePerformerControls) : null);
    return toolbar && props.page.current && props.page.current.contains(toolbar) ? api.ReactDOM.createPortal(selector, toolbar) : selector;
  }
  function useAgePerformerFilter() {
    var state = React.useState(agePerformerFilter), model = state[0], setModel = state[1];
    React.useEffect(function () {
      function changed() { setModel(agePerformerFilter); }
      window.addEventListener(performerFilterEvent, changed); changed();
      return function () { window.removeEventListener(performerFilterEvent, changed); };
    }, []);
    return model;
  }
  function PerformerFilterCapture(props) {
    var key = JSON.stringify(performerVariables(props.filter, 1));
    React.useEffect(function () {
      agePerformerFilter = props.filter;
      window.dispatchEvent(new Event(performerFilterEvent));
    }, [key]);
    return null;
  }
  function AgePerformerControls() {
    var state = React.useState(false), open = state[0], setOpen = state[1];
    var model = useAgePerformerFilter(), close = React.useRef(null), trigger = React.useRef(null);
    var count = model ? model.count() + (model.makeFindFilter().q ? 1 : 0) : 0;
    React.useEffect(function () {
      if (!open) return;
      if (close.current) close.current.focus();
      function escape(event) { if (event.key === "Escape" && !document.querySelector(".modal.show")) setOpen(false); }
      window.addEventListener("keydown", escape);
      return function () { window.removeEventListener("keydown", escape); if (trigger.current) trigger.current.focus(); };
    }, [open]);
    return h(React.Fragment, null,
      h("button", { ref: trigger, type: "button", className: "btn btn-secondary", "aria-haspopup": "dialog", "aria-expanded": open, onClick: function () { setOpen(true); } }, "Performer filters" + (count ? " (" + count + ")" : "")),
      api.ReactDOM.createPortal(h("div", { className: "dirty-stats-performer-overlay", style: { display: open ? "flex" : "none" } },
        h("div", { className: "dirty-stats-performer-backdrop", onClick: function () { setOpen(false); } }),
        h("section", { id: "dirty-stats-performer-dialog", className: "dirty-stats-performer-dialog dirty-stats-page dirty-stats-native-filters", role: "dialog", "aria-modal": true, "aria-label": "Performer filters", onKeyDown: function (event) {
          if (event.key !== "Tab") return;
          var items = Array.from(event.currentTarget.querySelectorAll('button, input, select, a[href], [tabindex="0"]')).filter(function (item) { return !item.disabled && item.getClientRects().length; });
          if (!items.length) return;
          if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
          else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
        } },
          h("div", { className: "dirty-stats-toolbar" }, h("h2", { className: "h5" }, "Performer filters"), h("button", { ref: close, className: "btn btn-secondary", onClick: function () { setOpen(false); } }, "Done")),
          h("p", null, "Choose which performers contribute to the age histogram and cards. Scene filters remain active. Changes apply immediately."),
          h(api.components.FilteredPerformerList, { alterQuery: false, extraCriteria: { dirtyStatsAgeFilters: true } }))), document.body));
  }
  function filterAgeScenes(scenes, ids) {
    if (ids == null) return scenes;
    var allowed = new Set(ids.map(String));
    return scenes.map(function (scene) { return Object.assign({}, scene, { performers: (scene.performers || []).filter(function (performer) { return allowed.has(String(performer.id)); }) }); });
  }
  function sceneVariables(filter, page) {
    return { filter: Object.assign({}, filter.makeFindFilter(), { page: page, per_page: 500 }), sceneFilter: filter.makeFilter() };
  }
  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    var units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"], unit = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(1024))));
    return (bytes / Math.pow(1024, unit)).toLocaleString("en", { maximumFractionDigits: 2 }) + " " + units[unit];
  }
  function growthBucket(timestamp, grouping) {
    var date = new Date(timestamp);
    if (grouping === "year") return Date.UTC(date.getUTCFullYear(), 0, 1);
    if (grouping === "month") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
    return Math.floor(timestamp / 86400000) * 86400000;
  }
  function growthBucketEnd(timestamp, grouping) {
    var date = new Date(timestamp);
    if (grouping === "year") return Date.UTC(date.getUTCFullYear() + 1, 0, 1) - 86400000;
    if (grouping === "month") return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 86400000;
    return growthBucket(timestamp, grouping);
  }
  function aggregateGrowth(scenes, now, dateBasis, grouping) {
    dateBasis = dateBasis || "created_at";
    var days = new Map(), seen = new Set(), excluded = 0, invalidFiles = 0, invalidDates = 0, included = 0;
    scenes.forEach(function (scene) {
      if (seen.has(scene.id)) return;
      seen.add(scene.id);
      var sceneDate = dateBasis === "scene_date" ? scene.date : scene.created_at;
      var timestamp = sceneDate ? Date.parse(sceneDate) : NaN;
      if (dateBasis !== "mod_time" && !Number.isFinite(timestamp)) { excluded++; return; }
      var valid = 0, files = new Set();
      (scene.files || []).forEach(function (file) {
        if (file.id != null && files.has(file.id)) return;
        if (file.id != null) files.add(file.id);
        var bytes = file.size == null || file.size === "" ? NaN : Number(file.size);
        if (!Number.isFinite(bytes) || bytes < 0) { invalidFiles++; return; }
        var fileTimestamp = dateBasis === "mod_time" ? (file.mod_time ? Date.parse(file.mod_time) : NaN) : timestamp;
        if (!Number.isFinite(fileTimestamp)) { invalidDates++; return; }
        var day = growthBucket(fileTimestamp, grouping);
        days.set(day, (days.get(day) || 0) + bytes); valid++;
      });
      if (!valid) { excluded++; return; }
      included++;
    });
    var total = 0, points = [];
    Array.from(days.keys()).sort(function (a, b) { return a - b; }).forEach(function (day) { total += days.get(day); points.push([day, total]); });
    if (points.length) {
      points.unshift([growthBucket(points[0][0] - 86400000, grouping), 0]);
      var today = growthBucket(now == null ? Date.now() : now, grouping);
      if (today > points[points.length - 1][0]) points.push([today, total]);
    }
    return { points: points, bytes: total, included: included, excluded: excluded, invalidFiles: invalidFiles, invalidDates: invalidDates, total: seen.size };
  }
  function scenesInPeriod(scenes, dateBasis, period) {
    if (!period) return scenes;
    return scenes.filter(function (scene) {
      return (scene.files || []).some(function (file) {
        var value = dateBasis === "mod_time" ? file.mod_time : dateBasis === "scene_date" ? scene.date : scene.created_at;
        var time = value ? Date.parse(value) : NaN;
        var bytes = file.size == null || file.size === "" ? NaN : Number(file.size);
        return Number.isFinite(time) && Number.isFinite(bytes) && bytes >= 0 && time >= period[0] && time < period[1] + 86400000;
      });
    });
  }
  function periodGrowth(points, period) {
    var before = 0, after = 0;
    points.forEach(function (point) { if (point[0] < period[0]) before = point[1]; if (point[0] <= period[1]) after = point[1]; });
    return after - before;
  }
  function forecastGrowth(stats, capacity, now, period) {
    var today = growthBucket(now == null ? Date.now() : now, "day");
    if (!(capacity > 0)) return { reason: "Source capacity is unavailable." };
    if (!stats.included || !stats.points.length) return { reason: "No matching content to forecast." };
    if (stats.bytes >= capacity) return { reason: "Matching content already reaches the source capacity." };
    var end = period ? Math.min(period[1], today) : today;
    var start = Math.max(period ? period[0] : today - 365 * 86400000, stats.points[0][0]);
    if (end < start) return { reason: "Select a period before today to calculate a growth rate." };
    var bytes = periodGrowth(stats.points, [start, end]);
    var days = (end - start) / 86400000 + 1;
    var rate = bytes / days;
    if (!(rate > 0)) return { reason: "No growth in the reference period; capacity date cannot be estimated." };
    var reachedAt = today + Math.ceil((capacity - stats.bytes) / rate) * 86400000;
    if (!Number.isFinite(reachedAt) || reachedAt > 8640000000000000) return { reason: "Growth is too slow to estimate a capacity date." };
    return { rate: rate, reachedAt: reachedAt, points: [[today, stats.bytes], [reachedAt, capacity]], start: start, end: end };
  }
  // Eckert IV equal-area projection; ECharts receives degrees and planar units.
  var eckertIV = {
    project: function (point) {
      var radians = Math.PI / 180, lambda = point[0] * radians;
      var phi = Math.max(-90, Math.min(90, point[1])) * radians;
      var theta = phi / 2, target = (2 + Math.PI / 2) * Math.sin(phi);
      if (Math.abs(Math.abs(phi) - Math.PI / 2) < 1e-10) theta = phi;
      else for (var i = 0; i < 30; i++) {
        var sin = Math.sin(theta), cos = Math.cos(theta);
        var delta = (theta + sin * cos + 2 * sin - target) / (2 * cos * (1 + cos));
        theta -= delta;
        if (Math.abs(delta) < 1e-12) break;
      }
      return [2 * lambda * (1 + Math.cos(theta)) / Math.sqrt(Math.PI * (4 + Math.PI)), -2 * Math.sqrt(Math.PI / (4 + Math.PI)) * Math.sin(theta)];
    },
    unproject: function (point) {
      var theta = Math.asin(Math.max(-1, Math.min(1, -point[1] / (2 * Math.sqrt(Math.PI / (4 + Math.PI))))));
      var sin = Math.sin(theta), cos = Math.cos(theta);
      var phi = Math.asin(Math.max(-1, Math.min(1, (theta + sin * cos + 2 * sin) / (2 + Math.PI / 2))));
      var lambda = point[0] * Math.sqrt(Math.PI * (4 + Math.PI)) / (2 * (1 + cos));
      return [lambda * 180 / Math.PI, phi * 180 / Math.PI];
    }
  };
  function mapLayout(node) {
    return { layoutCenter: ["50%", (node.clientHeight - 20) / 2], layoutSize: Math.max(100, Math.min(node.clientWidth - 12, (node.clientHeight - 50) * 2)) };
  }
  function performerVariables(filter, page) {
    return { filter: Object.assign({}, filter.makeFindFilter(), { page: page, per_page: 500 }), performerFilter: filter.makeFilter() };
  }
  function orderedCards(cards, ids) {
    var byId = new Map(cards.map(function (card) { return [Number(card.id), card]; }));
    return ids.map(function (id) { return byId.get(Number(id)); }).filter(Boolean);
  }
  function countryPerformers(performers, country) {
    return country ? performers.filter(function (p) { return countries[normalize(p.country)] === country; }) : performers;
  }
  function PerformerCards(props) {
    var state = React.useState(1), page = state[0], setPage = state[1];
    var ids = props.performers.map(function (p) { return Number(p.id); });
    var key = JSON.stringify(ids);
    React.useEffect(function () { setPage(1); }, [key]);
    var pages = Math.max(1, Math.ceil(ids.length / 24));
    var current = Math.min(page, pages);
    var pageIds = ids.slice((current - 1) * 24, current * 24);
    var query = api.GQL.useFindPerformersQuery({
      variables: { performer_ids: pageIds, filter: Object.assign({}, props.filter ? props.filter.makeFindFilter() : { sort: "name", direction: "ASC" }, { page: current, per_page: 24 }), performer_filter: props.filter ? props.filter.makeFilter() : {} },
      skip: !ids.length
    });
    var cards = orderedCards(query.data && query.data.findPerformers ? query.data.findPerformers.performers : [], pageIds);
    return h("section", { className: "dirty-stats-performers", "aria-label": "Matching performers" },
      h("div", { className: "dirty-stats-toolbar" }, h("h2", { className: "h5" }, props.title ? props.title + " (" + ids.length + ")" : props.country ? "Performers from " + props.country + " (" + ids.length + ")" : "Performers (" + ids.length + ")"),
        (props.country || props.selection != null) ? h("button", { className: "btn btn-secondary dirty-ui-button", onClick: props.clearCountry || props.clearSelection }, props.clearLabel || "Show all countries") : null),
      !ids.length ? h("p", { role: "status" }, "No performers match this selection and the current filters.") : query.loading ? h("p", { role: "status" }, "Loading performer cards...") : query.error ? h("p", { role: "alert" }, query.error.message) :
        h("div", { className: "row" }, cards.map(function (performer) { return h("div", { key: performer.id, className: "col-6 col-md-4 col-lg-3 dirty-stats-performer-column mb-3" }, h(api.components.PerformerCard, { performer: performer })); })),
      ids.length > 24 ? h("nav", { className: "dirty-stats-toolbar", "aria-label": "Performer pages" },
        h("button", { className: "btn btn-secondary", disabled: current <= 1, onClick: function () { setPage(current - 1); } }, "Previous"),
        h("span", null, "Page " + current + " of " + pages),
        h("button", { className: "btn btn-secondary", disabled: current >= pages, onClick: function () { setPage(current + 1); } }, "Next")) : null);
  }
  function StatsPage(props) {
    var dataState = React.useState([]), performers = dataState[0], setPerformers = dataState[1];
    var loadingState = React.useState(true), loading = loadingState[0], setLoading = loadingState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var countryState = React.useState(""), selectedCountry = countryState[0], setSelectedCountry = countryState[1];
    var queryKey = JSON.stringify(performerVariables(props.filter, 1));
    var criteriaVariables = performerVariables(props.filter, 1);
    criteriaVariables.filter.sort = "id"; criteriaVariables.filter.direction = "ASC";
    var criteriaKey = JSON.stringify(criteriaVariables);
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var labelState = React.useState(false), labels = labelState[0], setLabels = labelState[1];
    var chartNode = React.useRef(null), chartRef = React.useRef(null);
    var stats = React.useMemo(function () { return aggregate(performers, countries); }, [performers]);
    React.useEffect(function () { setSelectedCountry(""); }, [criteriaKey]);
    React.useEffect(function () {
      var controller = new AbortController();
      setLoading(true); setError("");
      // Bounded pages avoid a single very large GraphQL response on big libraries.
      (async function () {
        var result = [], page = 1, total;
        do {
          var data = await hub.graphql("query DirtyStatsPerformers($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id country}}}", performerVariables(props.filter, page), { signal: controller.signal });
          if (controller.signal.aborted) return;
          var batch = data.findPerformers;
          total = batch.count;
          if (!batch.performers.length && result.length < total) throw new Error("The performer list changed while loading. Refresh to try again.");
          result = result.concat(batch.performers); page++;
        } while (result.length < total);
        if (!controller.signal.aborted) { setPerformers(result); setLoading(false); }
      })().catch(function (err) { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
      return function () { controller.abort(); };
    }, [refresh, queryKey]);
    React.useEffect(function () {
      if (loading || error || !chartNode.current) return;
      if (!charts || !world) { setChartError("The bundled chart or map data could not be loaded. Reload the Stash page."); return; }
      var chart, observer;
      function resize() { if (chart && !chart.isDisposed()) { chart.resize(); chart.setOption({ series: [mapLayout(chartNode.current)] }); } }
      try {
        charts.registerMap("dirtyStatsWorld", world);
        chart = charts.init(chartNode.current, null, { renderer: "canvas" });
        chart.on("click", function (event) { if (event.componentType === "series" && event.name) setSelectedCountry(function (current) { return current === event.name ? "" : event.name; }); });
        chartRef.current = chart; setChartError("");
        if (typeof ResizeObserver === "function") { observer = new ResizeObserver(resize); observer.observe(chartNode.current); }
        window.addEventListener("resize", resize);
      } catch (err) { setChartError(err.message); }
      return function () { if (observer) observer.disconnect(); window.removeEventListener("resize", resize); if (chart) chart.dispose(); chartRef.current = null; };
    }, [loading, error]);
    React.useEffect(function () {
      var chart = chartRef.current;
      if (!chart) return;
      var counts = new Map(stats.rows.map(function (row) { return [row.name, row.value]; }));
      chart.setOption({ backgroundColor: "#242b31", tooltip: { trigger: "item", renderMode: "richText", formatter: function (p) { return p.name + ": " + (Number(p.value) || 0) + " performers"; } }, visualMap: { min: 0, max: Math.max(1, stats.rows.length ? stats.rows[0].value : 0), left: 15, bottom: 15, calculable: false, orient: "horizontal", itemWidth: 8, itemHeight: 70, textGap: 5, padding: 0, text: ["More", "0"], textStyle: { color: "#ddd", fontSize: 10 }, inRange: { color: ["#364655", "#5687a2", "#54d5ca"] } }, series: [{ type: "map", map: "dirtyStatsWorld", projection: eckertIV, zoom: 1.08, layoutCenter: mapLayout(chartNode.current).layoutCenter, layoutSize: mapLayout(chartNode.current).layoutSize, roam: true, selectedMode: "single", select: { label: { color: "#fff" }, itemStyle: { areaColor: "#bc8542" } }, scaleLimit: { min: 1, max: 12 }, label: { show: labels, color: "#fff", fontSize: 10, formatter: function (p) { return Number(p.value) > 0 ? String(p.value) : ""; } }, itemStyle: { borderColor: "#788591", borderWidth: .5 }, emphasis: { label: { show: true, color: "#fff" }, itemStyle: { areaColor: "#bc8542" } }, data: world.features.map(function (feature) { return { name: feature.properties.name, value: counts.get(feature.properties.name) || 0, selected: selectedCountry === feature.properties.name }; }) }] }, true);
    }, [stats, labels, loading, error, selectedCountry]);
    var unmapped = Object.keys(stats.unknown).reduce(function (sum, name) { return sum + stats.unknown[name]; }, 0);
    return h("section", { className: "dirty-stats-content" },
      h("div", { className: "dirty-stats-toolbar" }, h("span", { className: "dirty-stats-summary", role: "status" }, loading ? "Loading performers..." : stats.total + " performers \u00b7 " + stats.rows.length + " countries \u00b7 " + stats.missing + " missing country \u00b7 " + unmapped + " unmapped"),
        h("div", { className: "dirty-stats-actions" },
          h("button", { className: "btn btn-secondary dirty-ui-button", disabled: loading, onClick: function () { setRefresh(refresh + 1); } }, "Refresh"))),
      error ? h("div", { className: "dirty-stats-alert", role: "alert" }, error, " Use Refresh to retry.") : null,
      !loading && !error ? h(React.Fragment, null,
        chartError ? h("div", { className: "dirty-stats-alert", role: "alert" }, chartError) : null,
        !stats.total ? h("p", { role: "status" }, "No performers match these filters.") : null,
        h("section", { className: "dirty-stats-map-panel dirty-ui-panel", "aria-label": "Performer origin world map" },
          h("div", { className: "dirty-stats-map-controls" },
            h("label", { className: "dirty-stats-numbers" }, h("input", { type: "checkbox", checked: labels, onChange: function (event) { setLabels(event.target.checked); } }), " Show numbers"),
          h("button", { className: "btn btn-secondary dirty-ui-button dirty-stats-export", disabled: Boolean(chartError), onClick: function () { if (chartRef.current) download(chartRef.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#242b31" }), "DirtyStats-performer-origin.png"); } }, "Export PNG")),
          h("div", { ref: chartNode, className: "dirty-stats-chart", role: "img", "aria-label": "Eckert IV world map of performer counts. Hover a country for its count." })),
        h("p", null, "Click a country to filter performers. Hover for counts; scroll to zoom and drag to pan."),
        h(PerformerCards, { performers: countryPerformers(performers, selectedCountry), country: selectedCountry, filter: props.filter, clearCountry: function () { setSelectedCountry(""); } }),
        unmapped > 0 ? h("details", null, h("summary", null, "Unmapped country values (" + unmapped + ")"), h("ul", null, Object.keys(stats.unknown).sort().map(function (name) { return h("li", { key: name }, name + ": " + stats.unknown[name]); }))) : null) : null);
  }
  function SceneCards(props) {
    var state = React.useState(1), page = state[0], setPage = state[1];
    var ids = props.scenes.map(function (scene) { return Number(scene.id); });
    var key = JSON.stringify(ids);
    React.useEffect(function () { setPage(1); }, [key]);
    var pages = Math.max(1, Math.ceil(ids.length / 24)), current = Math.min(page, pages);
    var pageIds = ids.slice((current - 1) * 24, current * 24);
    var query = api.GQL.useFindScenesQuery({
      variables: { scene_ids: pageIds, filter: Object.assign({}, props.filter.makeFindFilter(), { page: current, per_page: 24 }), scene_filter: props.filter.makeFilter() },
      skip: !ids.length
    });
    var cards = orderedCards(query.data && query.data.findScenes ? query.data.findScenes.scenes : [], pageIds);
    return h("section", { className: "dirty-stats-scenes", "aria-label": "Matching scenes" },
      h("div", { className: "dirty-stats-toolbar" }, h("h2", { className: "h5" }, (props.title || "Scenes") + " (" + ids.length + ")"),
        props.selection ? h("button", { className: "btn btn-secondary dirty-ui-button", onClick: props.clearSelection }, props.clearLabel || "Show all scenes") : null),
      !ids.length ? h("p", { role: "status" }, "No scenes match these filters.") : query.loading ? h("p", { role: "status" }, "Loading scene cards...") : query.error ? h("p", { role: "alert" }, query.error.message) :
        h("div", { className: "row" }, cards.map(function (scene) { return h("div", { key: scene.id, className: "col-12 col-sm-6 col-lg-4 col-xl-3 mb-3" }, h(api.components.SceneCard, { scene: scene })); })),
      ids.length > 24 ? h("nav", { className: "dirty-stats-toolbar", "aria-label": "Scene pages" },
        h("button", { className: "btn btn-secondary", disabled: current <= 1, onClick: function () { setPage(current - 1); } }, "Previous"),
        h("span", null, "Page " + current + " of " + pages),
        h("button", { className: "btn btn-secondary", disabled: current >= pages, onClick: function () { setPage(current + 1); } }, "Next")) : null);
  }
  var constellationGenderStyles = {
    FEMALE: { label: "Female", color: "#f29aaa" },
    MALE: { label: "Male", color: "#8eb8f5" },
    TRANSGENDER_FEMALE: { label: "Transgender female", color: "#d9a6e8" },
    TRANSGENDER_MALE: { label: "Transgender male", color: "#8fd5dd" },
    NON_BINARY: { label: "Non-binary", color: "#f4df86" },
    INTERSEX: { label: "Intersex", color: "#b9a2e8" },
    UNKNOWN: { label: "Unknown", color: "#aeb8c2" }
  };
  function constellationGender(value) {
    var key = String(value || "UNKNOWN").trim().toUpperCase().replace(/[ -]+/g, "_") || "UNKNOWN";
    if (constellationGenderStyles[key]) return Object.assign({ key: key }, constellationGenderStyles[key]);
    var hash = 0;
    for (var i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return { key: key, label: key.toLowerCase().replace(/_/g, " ").replace(/(^|\s)\S/g, function (letter) { return letter.toUpperCase(); }), color: "hsl(" + (hash % 360) + ", 55%, 72%)" };
  }
  function constellationLayout(count) {
    if (count > 500) return { symbolMin: 6, symbolRange: 24, labelLimit: 8, repulsion: [280, 1200], edgeLength: [85, 250], gravity: .018, zoom: .52, edgeOpacity: .1 };
    if (count > 200) return { symbolMin: 8, symbolRange: 28, labelLimit: 10, repulsion: [240, 980], edgeLength: [78, 225], gravity: .024, zoom: .62, edgeOpacity: .13 };
    if (count > 80) return { symbolMin: 10, symbolRange: 32, labelLimit: 12, repulsion: [190, 760], edgeLength: [70, 205], gravity: .032, zoom: .76, edgeOpacity: .18 };
    return { symbolMin: 13, symbolRange: 35, labelLimit: 15, repulsion: [150, 620], edgeLength: [65, 185], gravity: .04, zoom: .9, edgeOpacity: .24 };
  }
  function aggregateConstellation(scenes, maxPerformers, minShared) {
    var uniqueScenes = new Map(), performers = new Map();
    scenes.forEach(function (scene) { if (!uniqueScenes.has(String(scene.id))) uniqueScenes.set(String(scene.id), scene); });
    uniqueScenes.forEach(function (scene) {
      var seen = new Set();
      (scene.performers || []).forEach(function (performer) {
        var id = String(performer.id == null ? "" : performer.id);
        if (!id || seen.has(id)) return;
        seen.add(id);
        var gender = constellationGender(performer.gender);
        if (!performers.has(id)) performers.set(id, { id: id, name: String(performer.name || "Performer #" + id), gender: gender.key, genderLabel: gender.label, genderColor: gender.color, value: 0 });
        var saved = performers.get(id);
        if (saved.gender === "UNKNOWN" && gender.key !== "UNKNOWN") { saved.gender = gender.key; saved.genderLabel = gender.label; saved.genderColor = gender.color; }
        saved.value++;
      });
    });
    var ranked = Array.from(performers.values()).sort(function (a, b) { return b.value - a.value || a.name.localeCompare(b.name) || a.id.localeCompare(b.id); });
    var limit = Math.max(1, Number(maxPerformers) || 100), nodes = ranked.slice(0, limit), visible = new Set(nodes.map(function (node) { return node.id; })), pairs = new Map();
    uniqueScenes.forEach(function (scene) {
      var scenePerformers = new Map();
      (scene.performers || []).forEach(function (performer) {
        var id = String(performer.id == null ? "" : performer.id);
        if (id && visible.has(id) && !scenePerformers.has(id)) scenePerformers.set(id, String(performer.name || performers.get(id).name));
      });
      var ids = Array.from(scenePerformers.keys()).sort();
      for (var i = 0; i < ids.length; i++) for (var j = i + 1; j < ids.length; j++) {
        var key = ids[i] + "\u0000" + ids[j];
        if (!pairs.has(key)) pairs.set(key, { id: key, source: ids[i], target: ids[j], sourceName: scenePerformers.get(ids[i]), targetName: scenePerformers.get(ids[j]), value: 0, sceneIds: [] });
        var pair = pairs.get(key); pair.value++; pair.sceneIds.push(String(scene.id));
      }
    });
    var threshold = Math.max(1, Number(minShared) || 1);
    var links = Array.from(pairs.values()).filter(function (link) { return link.value >= threshold; }).sort(function (a, b) { return b.value - a.value || a.sourceName.localeCompare(b.sourceName) || a.targetName.localeCompare(b.targetName); });
    var collaborators = new Map();
    links.forEach(function (link) {
      if (!collaborators.has(link.source)) collaborators.set(link.source, new Set());
      if (!collaborators.has(link.target)) collaborators.set(link.target, new Set());
      collaborators.get(link.source).add(link.target); collaborators.get(link.target).add(link.source);
    });
    nodes = nodes.map(function (node) { return Object.assign({}, node, { collaborators: collaborators.has(node.id) ? collaborators.get(node.id).size : 0 }); });
    return { nodes: nodes, links: links, totalScenes: uniqueScenes.size, totalPerformers: performers.size };
  }
  function constellationScenes(scenes, selection) {
    var seen = new Set(), ids = selection ? new Set(selection.ids.map(String)) : null;
    return scenes.filter(function (scene) {
      var sceneId = String(scene.id);
      if (seen.has(sceneId)) return false;
      seen.add(sceneId);
      if (!ids) return true;
      var present = new Set((scene.performers || []).map(function (performer) { return String(performer.id); }));
      return Array.from(ids).every(function (id) { return present.has(id); });
    });
  }
  function ConstellationPage(props) {
    var dataState = React.useState([]), scenes = dataState[0], setScenes = dataState[1];
    var loadingState = React.useState(true), loading = loadingState[0], setLoading = loadingState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var maxState = React.useState(function () { return constellationMaxPerformers; }), maxPerformers = maxState[0], setMaxPerformers = maxState[1];
    var sharedState = React.useState(function () { return constellationMinShared; }), minShared = sharedState[0], setMinShared = sharedState[1];
    var selectionState = React.useState(null), selected = selectionState[0], setSelected = selectionState[1];
    var node = React.useRef(null), chartRef = React.useRef(null);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var stats = React.useMemo(function () { return aggregateConstellation(scenes, maxPerformers, minShared); }, [scenes, maxPerformers, minShared]);
    var matching = React.useMemo(function () { return constellationScenes(scenes, selected); }, [scenes, selected]);
    React.useEffect(function () { setSelected(null); }, [queryKey, maxPerformers, minShared]);
    React.useEffect(function () {
      var controller = new AbortController();
      setLoading(true); setError("");
      (async function () {
        var result = [], page = 1, total;
        do {
          var data = await hub.graphql("query DirtyStatsConstellation($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id performers{id name gender}}}}", sceneVariables(props.filter, page), { signal: controller.signal });
          if (controller.signal.aborted) return;
          var batch = data.findScenes; total = batch.count;
          if (!batch.scenes.length && result.length < total) throw new Error("The scene list changed while loading. Refresh to try again.");
          result = result.concat(batch.scenes); page++;
        } while (result.length < total);
        if (!controller.signal.aborted) { setScenes(result); setLoading(false); }
      })().catch(function (err) { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
      return function () { controller.abort(); };
    }, [queryKey, refresh]);
    React.useEffect(function () {
      if (loading || error || !node.current || !stats.nodes.length) return;
      var chart, observer;
      function resize() { if (chart && !chart.isDisposed()) chart.resize(); }
      try {
        if (!charts) throw new Error("The bundled chart library could not be loaded. Reload Stash.");
        chart = charts.init(node.current, null, { renderer: "canvas" }); chartRef.current = chart;
        var largest = Math.max.apply(null, stats.nodes.map(function (item) { return item.value; }));
        var layout = constellationLayout(stats.nodes.length);
        var categoryMap = new Map();
        stats.nodes.forEach(function (item) { if (!categoryMap.has(item.gender)) categoryMap.set(item.gender, { name: item.genderLabel, itemStyle: { color: item.genderColor } }); });
        var categories = Array.from(categoryMap.values()), categoryIndexes = new Map(Array.from(categoryMap.keys()).map(function (key, index) { return [key, index]; }));
        chart.setOption({ backgroundColor: "#242b31", legend: { type: "scroll", top: 8, left: 10, right: 10, selectedMode: false, data: categories.map(function (category) { return category.name; }), textStyle: { color: "#ddd", fontSize: 10 }, itemWidth: 11, itemHeight: 11, pageTextStyle: { color: "#ddd" } }, tooltip: { trigger: "item", renderMode: "richText", formatter: function (p) {
          if (p.dataType === "edge") return p.data.sourceName + " + " + p.data.targetName + "\n" + p.data.value + " shared scene" + (p.data.value === 1 ? "" : "s");
          return p.data.name + "\n" + p.data.genderLabel + "\n" + p.data.value + " matching scene" + (p.data.value === 1 ? "" : "s") + "\n" + p.data.collaborators + " displayed collaborator" + (p.data.collaborators === 1 ? "" : "s");
        } }, series: [{ type: "graph", layout: "force", top: 40, left: 12, right: 12, bottom: 12, zoom: layout.zoom, roam: true, draggable: true, selectedMode: "single", categories: categories, data: stats.nodes.map(function (item, index) { return Object.assign({}, item, { category: categoryIndexes.get(item.gender), symbolSize: layout.symbolMin + layout.symbolRange * Math.sqrt(item.value / largest), itemStyle: { borderColor: "#d8fffb", borderWidth: 1 }, label: { show: index < layout.labelLimit } }); }), links: stats.links.map(function (link) { return Object.assign({}, link, { lineStyle: { width: 1 + Math.log(link.value) / Math.log(2), opacity: layout.edgeOpacity + Math.min(.42, link.value / 22), color: "#5687a2", curveness: .06 } }); }), force: { initLayout: "circular", repulsion: layout.repulsion, gravity: layout.gravity, edgeLength: layout.edgeLength, friction: .6, layoutAnimation: true }, label: { position: "right", color: "#eee", fontSize: 11, formatter: "{b}" }, emphasis: { focus: "adjacency", label: { show: true }, itemStyle: { borderColor: "#fff", borderWidth: 2 }, lineStyle: { opacity: .9, color: "#f3c779" } } }] });
        chart.on("click", function (event) {
          if (event.componentType !== "series") return;
          var choice = event.dataType === "edge" ? { type: "pair", ids: [event.data.source, event.data.target], label: event.data.sourceName + " + " + event.data.targetName, key: "pair:" + event.data.id } : { type: "performer", ids: [event.data.id], label: event.data.name, key: "performer:" + event.data.id };
          setSelected(function (current) { return current && current.key === choice.key ? null : choice; });
        });
        setChartError("");
        if (typeof ResizeObserver === "function") { observer = new ResizeObserver(resize); observer.observe(node.current); }
        window.addEventListener("resize", resize);
      } catch (err) { setChartError(err.message); }
      return function () { if (observer) observer.disconnect(); window.removeEventListener("resize", resize); if (chart) chart.dispose(); chartRef.current = null; };
    }, [stats, loading, error]);
    React.useEffect(function () {
      var chart = chartRef.current;
      if (!chart) return;
      chart.dispatchAction({ type: "downplay", seriesIndex: 0 });
      if (!selected) return;
      var dataType = selected.type === "pair" ? "edge" : "node";
      var dataIndex = dataType === "edge" ? stats.links.findIndex(function (link) { return "pair:" + link.id === selected.key; }) : stats.nodes.findIndex(function (item) { return "performer:" + item.id === selected.key; });
      if (dataIndex >= 0) chart.dispatchAction({ type: "highlight", seriesIndex: 0, dataType: dataType, dataIndex: dataIndex });
    }, [selected, stats]);
    var selectionTitle = !selected ? "Scenes" : selected.type === "pair" ? "Scenes shared by " + selected.label : "Scenes with " + selected.label;
    return h("section", { className: "dirty-stats-content" },
      h("div", { className: "dirty-stats-toolbar" }, h("span", { className: "dirty-stats-summary", role: "status" }, loading ? "Building constellation..." : stats.totalScenes + " matching scenes · " + stats.totalPerformers + " performers · " + stats.nodes.length + " shown · " + stats.links.length + " connections"),
        h("button", { className: "btn btn-secondary dirty-ui-button", disabled: loading, onClick: function () { setRefresh(refresh + 1); } }, "Refresh")),
      error ? h("div", { className: "dirty-stats-alert", role: "alert" }, error) : null,
      !loading && !error && stats.nodes.length ? h("section", { className: "dirty-stats-map-panel dirty-ui-panel", "aria-label": "Cast constellation" },
        h("div", { className: "dirty-stats-map-controls" },
          h("label", { className: "dirty-stats-date-basis" }, "Maximum performers", h("select", { className: "form-control form-control-sm", value: maxPerformers, onChange: function (event) { constellationMaxPerformers = Number(event.target.value); setMaxPerformers(constellationMaxPerformers); } }, [50, 100, 200, 500, 1000].map(function (value) { return h("option", { key: value, value: value }, value); }))),
          h("label", { className: "dirty-stats-date-basis" }, "Minimum shared scenes", h("select", { className: "form-control form-control-sm", value: minShared, onChange: function (event) { constellationMinShared = Number(event.target.value); setMinShared(constellationMinShared); } }, [1, 2, 3, 5, 10].map(function (value) { return h("option", { key: value, value: value }, value); }))),
          selected ? h("button", { className: "btn btn-secondary dirty-ui-button", onClick: function () { setSelected(null); } }, "Show all scenes") : null,
          h("button", { className: "btn btn-secondary dirty-ui-button dirty-stats-export", disabled: Boolean(chartError), onClick: function () { if (chartRef.current) download(chartRef.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#242b31" }), "DirtyStats-cast-constellation.png"); } }, "Export PNG")),
        h("div", { ref: node, className: "dirty-stats-constellation-chart", role: "img", "aria-label": "Network of performers connected by matching scenes. Larger performers appear in more scenes; thicker lines represent more shared scenes." })) : null,
      chartError ? h("div", { className: "dirty-stats-alert", role: "alert" }, chartError) : null,
      !loading && !error && !stats.nodes.length ? h("p", { role: "status" }, "No performers occur in the matching scenes.") : null,
      !loading && !error && stats.nodes.length ? h("p", null, "Click a performer to show their scenes, or click a connection to show shared scenes. Click the same item again to clear it. Drag performers to rearrange the graph; scroll to zoom and drag the background to pan.") : null,
      !loading && !error ? h(SceneCards, { scenes: matching, filter: props.filter, title: selectionTitle, selection: selected, clearSelection: function () { setSelected(null); }, clearLabel: "Show all scenes" }) : null);
  }
  function GrowthPage(props) {
    var dataState = React.useState([]), scenes = dataState[0], setScenes = dataState[1];
    var loadingState = React.useState(true), loading = loadingState[0], setLoading = loadingState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var node = React.useRef(null), chartRef = React.useRef(null);
    var capacityState = React.useState(null), capacity = capacityState[0], setCapacity = capacityState[1];
    var showCapacityState = React.useState(function () { return growthShowCapacity; }), showCapacity = showCapacityState[0], setShowCapacity = showCapacityState[1];
    var capacityErrorState = React.useState(""), capacityError = capacityErrorState[0], setCapacityError = capacityErrorState[1];
    React.useEffect(function () {
      var active = true;
      setCapacity(null); setCapacityError("");
      hub.graphql("query DirtyStatsSources{configuration{general{stashes{path excludeVideo}}}}", {}).then(function (data) {
        var paths = data.configuration.general.stashes.filter(function (source) { return !source.excludeVideo; }).map(function (source) { return source.path; });
        return hub.runPluginOperation("dirtyStats", { mode: "capacity", paths: paths });
      }).then(function (result) { if (active) setCapacity(result); }).catch(function (err) { if (active) setCapacityError(err.message); });
      return function () { active = false; };
    }, [refresh]);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var dateState = React.useState(function () { return growthDateBasis; }), dateBasis = dateState[0], setDateBasis = dateState[1];
    var groupingState = React.useState(function () { return growthGrouping; }), grouping = groupingState[0], setGrouping = groupingState[1];
    var forecastState = React.useState(function () { return growthShowForecast; }), showForecast = forecastState[0], setShowForecast = forecastState[1];
    var dateLabel = dateBasis === "mod_time" ? "file modification date" : dateBasis === "scene_date" ? "scene date" : "scene creation date";
    var periodState = React.useState(null), period = periodState[0], setPeriod = periodState[1];
    var anchorState = React.useState(null), anchor = anchorState[0], setAnchor = anchorState[1];
    var selectionRef = React.useRef(null);
    selectionRef.current = function (day) {
      day = growthBucket(day, grouping);
      if (anchor == null) { setPeriod(null); setAnchor(day); }
      else { setPeriod([Math.min(anchor, day), growthBucketEnd(Math.max(anchor, day), grouping)]); setAnchor(null); }
    };
    React.useEffect(function () { setPeriod(null); setAnchor(null); }, [queryKey, dateBasis, grouping]);
    var selectedScenes = React.useMemo(function () { return scenesInPeriod(scenes, dateBasis, period); }, [scenes, dateBasis, period]);
    var stats = React.useMemo(function () { return aggregateGrowth(scenes, null, dateBasis, grouping); }, [scenes, dateBasis, grouping]);
    var forecast = React.useMemo(function () { return forecastGrowth(aggregateGrowth(scenes, null, dateBasis), capacity && capacity.total, null, period); }, [scenes, dateBasis, capacity, period]);
    React.useEffect(function () {
      var controller = new AbortController();
      setLoading(true); setError("");
      (async function () {
        var result = [], page = 1, total;
        do {
          var data = await hub.graphql("query DirtyStatsGrowth($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id created_at date files{id size mod_time}}}}", sceneVariables(props.filter, page), { signal: controller.signal });
          if (controller.signal.aborted) return;
          var batch = data.findScenes;
          total = batch.count;
          if (!batch.scenes.length && result.length < total) throw new Error("The scene list changed while loading. Refresh to try again.");
          result = result.concat(batch.scenes); page++;
        } while (result.length < total);
        if (!controller.signal.aborted) { setScenes(result); setLoading(false); }
      })().catch(function (err) { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
      return function () { controller.abort(); };
    }, [queryKey, refresh]);
    React.useEffect(function () {
      if (loading || error || !node.current) return;
      var chart, observer;
      function resize() { if (chart && !chart.isDisposed()) chart.resize(); }
      try {
        if (!charts) throw new Error("The bundled chart library could not be loaded. Reload the Stash page.");
        chart = charts.init(node.current, null, { renderer: "canvas" }); chartRef.current = chart;
        chart.setOption({ backgroundColor: "#242b31", useUTC: true, grid: { left: 12, right: 20, top: 22, bottom: 60, containLabel: true },
          tooltip: { trigger: "axis", renderMode: "richText", formatter: function (items) { return items.map(function (item) { var point = item.value; return new Date(point[0]).toISOString().slice(0, item.seriesName === "Forecast" ? 10 : grouping === "year" ? 4 : grouping === "month" ? 7 : 10) + " (UTC)\n" + formatBytes(point[1]) + (item.seriesName === "Forecast" ? " forecast" : " cumulative"); }).join("\n"); } },
          xAxis: { type: "time", axisLabel: { color: "#bbb", hideOverlap: true }, axisLine: { lineStyle: { color: "#788591" } } },
          yAxis: { type: "value", min: 0, axisLabel: { color: "#bbb", formatter: formatBytes }, splitLine: { lineStyle: { color: "#364655" } } },
          dataZoom: [{ type: "inside" }, { type: "slider", bottom: 8, height: 18, borderColor: "#5687a2", textStyle: { color: "#bbb" } }],
          series: [{ name: "Cumulative size", type: "line", step: "end", showSymbol: stats.included === 1, lineStyle: { color: "#54d5ca", width: 2 }, itemStyle: { color: "#54d5ca" }, areaStyle: { color: "#54d5ca", opacity: .15 }, data: stats.points }] });
        var pointerDown = null, zr = chart.getZr();
        zr.on("mousedown", function (event) { pointerDown = [event.offsetX, event.offsetY]; });
        zr.on("click", function (event) {
          var pixel = [event.offsetX, event.offsetY];
          if (pointerDown && Math.hypot(pixel[0] - pointerDown[0], pixel[1] - pointerDown[1]) > 5) return;
          if (!stats.points.length || !chart.containPixel({ gridIndex: 0 }, pixel)) return;
          var value = chart.convertFromPixel({ gridIndex: 0 }, pixel);
          if (!value || !Number.isFinite(value[0])) return;
          var day = Math.floor(Math.max(stats.points[0][0], Math.min(stats.points[stats.points.length - 1][0], value[0])) / 86400000) * 86400000;
          selectionRef.current(day);
        });
        setChartError("");
        if (typeof ResizeObserver === "function") { observer = new ResizeObserver(resize); observer.observe(node.current); }
        window.addEventListener("resize", resize);
      } catch (err) { setChartError(err.message); }
      return function () { if (observer) observer.disconnect(); window.removeEventListener("resize", resize); if (chart) chart.dispose(); chartRef.current = null; };
    }, [stats, loading, error]);
    React.useEffect(function () {
      var chart = chartRef.current;
      if (!chart) return;
      var capacityLine = showCapacity && capacity && capacity.total > 0 ? [{ yAxis: capacity.total, lineStyle: { color: "#9da8b2", type: "dashed" }, label: { show: true, position: "insideEndTop", color: "#ddd", fontSize: 10, formatter: (capacity.errors.length ? "Known capacity: " : "Capacity: ") + formatBytes(capacity.total) } }] : [];
      chart.setOption({ yAxis: { max: capacityLine.length || (showForecast && forecast.points) ? Math.max(stats.bytes, capacity.total) * 1.05 : null }, series: [{
        markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "#f3c779", type: "dashed" }, data: capacityLine.concat(anchor == null ? [] : [{ xAxis: anchor }]) },
        markArea: { silent: true, label: { show: false }, itemStyle: { color: "rgba(243,199,121,.2)" }, data: period ? [[{ xAxis: period[0] }, { xAxis: period[1] + 86400000 }]] : [] }
      }, { name: "Forecast", type: "line", showSymbol: false, lineStyle: { color: "#f3c779", type: "dashed", width: 2 }, itemStyle: { color: "#f3c779" }, data: showForecast && forecast.points ? forecast.points : [] }] });
    }, [period, anchor, stats, loading, error, capacity, showCapacity, showForecast, forecast]);
    return h("section", { className: "dirty-stats-content" },
      h("div", { className: "dirty-stats-toolbar" }, h("span", { className: "dirty-stats-summary", role: "status" }, loading ? "Loading scenes..." : stats.included + " scenes \u00b7 " + formatBytes(stats.bytes) + (stats.excluded ? " \u00b7 " + stats.excluded + " excluded" : "")),
        h("button", { className: "btn btn-secondary dirty-ui-button", disabled: loading, onClick: function () { setRefresh(refresh + 1); } }, "Refresh")),
      error ? h("div", { className: "dirty-stats-alert", role: "alert" }, error, " Use Refresh to retry.") : null,
      h("section", { className: "dirty-stats-map-panel dirty-ui-panel", "aria-label": "Scene content growth" },
        h("div", { className: "dirty-stats-map-controls" },
          h("label", { className: "dirty-stats-date-basis" }, "Date basis",
            h("select", { className: "form-control dirty-stats-statistic", value: dateBasis, onChange: function (event) { growthDateBasis = event.target.value; setDateBasis(growthDateBasis); } },
              h("option", { value: "created_at" }, "Created at"), h("option", { value: "mod_time" }, "File modified at"), h("option", { value: "scene_date" }, "Scene date"))),
          h("label", { className: "dirty-stats-numbers" }, h("input", { type: "checkbox", checked: showCapacity, onChange: function (event) { growthShowCapacity = event.target.checked; setShowCapacity(growthShowCapacity); } }), "Show capacity"),
          h("label", { className: "dirty-stats-numbers" }, h("input", { type: "checkbox", checked: showForecast, onChange: function (event) { growthShowForecast = event.target.checked; setShowForecast(growthShowForecast); } }), "Show forecast"),
          h("label", { className: "dirty-stats-date-basis" }, "Group by",
            h("select", { className: "form-control dirty-stats-statistic", value: grouping, onChange: function (event) { growthGrouping = event.target.value; setGrouping(growthGrouping); } },
              h("option", { value: "day" }, "Day"), h("option", { value: "month" }, "Month"), h("option", { value: "year" }, "Year"))),
          period || anchor != null ? h("button", { className: "btn btn-secondary dirty-ui-button", onClick: function () { setPeriod(null); setAnchor(null); } }, "Clear period") : null,
          h("button", { className: "btn btn-secondary dirty-ui-button dirty-stats-export", disabled: loading || Boolean(error) || Boolean(chartError), onClick: function () { if (chartRef.current) download(chartRef.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#242b31" }), "DirtyStats-content-growth-" + dateBasis + ".png"); } }, "Export PNG")),
        !loading && !error ? h("div", { ref: node, className: "dirty-stats-growth-chart", role: "img", "aria-label": "Cumulative scene file size over time, grouped by " + dateLabel + " in UTC." }) : null),
      showForecast && !loading && !error ? h("p", { className: "dirty-stats-forecast", role: "status" }, forecast.reason || "Estimated capacity date: " + new Date(forecast.reachedAt).toISOString().slice(0, 10) + " (UTC), at " + formatBytes(forecast.rate) + "/day. Reference: " + new Date(forecast.start).toISOString().slice(0, 10) + " to " + new Date(forecast.end).toISOString().slice(0, 10) + ".", " Assumes steady growth of matching content; other disk usage is not included.") : null,
      capacityError ? h("p", { role: "status" }, "Source capacity unavailable: " + capacityError) : capacity ? h("p", { className: "dirty-stats-capacity", role: "status" },
        capacity.total > 0 ? (capacity.errors.length ? "Known source capacity: " : "Source capacity: ") + formatBytes(capacity.total) + " across " + capacity.volumes.length + (capacity.volumes.length === 1 ? " volume." : " volumes.") : "No accessible scene source volumes were found.",
        capacity.errors.length ? " Capacity unavailable for " + capacity.errors.map(function (source) { return source.path; }).join(", ") + "." : "") : h("p", { role: "status" }, "Loading source capacity..."),
      !loading && !error ? h("p", { className: "dirty-stats-period-status", role: "status" },
        period ? new Date(period[0]).toISOString().slice(0, 10) + " to " + new Date(period[1]).toISOString().slice(0, 10) + " (UTC) \u00b7 " + formatBytes(periodGrowth(stats.points, period)) + " added \u00b7 " + selectedScenes.length + " scenes" : anchor != null ? "Start: " + new Date(anchor).toISOString().slice(0, 10) + " (UTC). Click the end date to complete the period." : "Click a start date and an end date in the timeline to select a period.") : null,
      chartError ? h("div", { className: "dirty-stats-alert", role: "alert" }, chartError) : null,
      !loading && !error && !stats.included ? h("p", { role: "status" }, "No scenes with a valid selected date and file size match these filters.") : null,
      h("p", null, "Cumulative current file sizes, added by " + dateLabel + " (UTC). " + (dateBasis === "mod_time" ? "Each file uses its own modification date. " : "Each scene uses its selected date for all attached files. ") + "Deleted scenes and past size changes are not recorded."),
      stats.invalidDates ? h("p", { role: "status" }, stats.invalidDates + " files with unavailable or invalid modification dates were excluded.") : null,
      stats.invalidFiles ? h("p", { role: "status" }, stats.invalidFiles + " files with unavailable or invalid sizes were excluded.") : null,
      !loading && !error ? h(SceneCards, { scenes: selectedScenes, filter: props.filter }) : null);
  }
  function AgePage(props) {
    var dataState = React.useState([]), scenes = dataState[0], setScenes = dataState[1];
    var loadingState = React.useState(true), sceneLoading = loadingState[0], setLoading = loadingState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var node = React.useRef(null), chartRef = React.useRef(null);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var performerModel = useAgePerformerFilter();
    var matchingState = React.useState(null), matchingIds = matchingState[0], setMatchingIds = matchingState[1];
    var matchingLoadingState = React.useState(false), matchingLoading = matchingLoadingState[0], setMatchingLoading = matchingLoadingState[1];
    var matchingErrorState = React.useState(""), matchingError = matchingErrorState[0], setMatchingError = matchingErrorState[1];
    var performerKey = JSON.stringify(performerModel ? performerVariables(performerModel, 1) : null);
    var loading = sceneLoading || matchingLoading;
    React.useEffect(function () {
      var controller = new AbortController();
      setMatchingError("");
      if (!performerModel) { setMatchingIds(null); setMatchingLoading(false); return; }
      setMatchingLoading(true);
      (async function () {
        var result = [], page = 1, total;
        do {
          var variables = performerVariables(performerModel, page);
          variables.filter.sort = "id"; variables.filter.direction = "ASC";
          var data = await hub.graphql("query DirtyStatsAgePerformers($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id}}}", variables, { signal: controller.signal });
          if (controller.signal.aborted) return;
          var batch = data.findPerformers; total = batch.count;
          if (!batch.performers.length && result.length < total) throw new Error("The performer list changed while loading. Try Refresh.");
          result = result.concat(batch.performers.map(function (performer) { return performer.id; })); page++;
        } while (result.length < total);
        if (!controller.signal.aborted) { setMatchingIds(result); setMatchingLoading(false); }
      })().catch(function (err) { if (!controller.signal.aborted) { setMatchingIds([]); setMatchingError(err.message); setMatchingLoading(false); } });
      return function () { controller.abort(); };
    }, [performerKey, refresh]);
    var matchingScenes = React.useMemo(function () { return filterAgeScenes(scenes, matchingIds); }, [scenes, matchingIds]);
    var ageState = React.useState(null), selectedAge = ageState[0], setSelectedAge = ageState[1];
    React.useEffect(function () { setSelectedAge(null); }, [queryKey, performerKey]);
    var selectedPerformers = React.useMemo(function () { return performersAtAge(matchingScenes, selectedAge); }, [matchingScenes, selectedAge]);
    var stats = React.useMemo(function () { return aggregateAges(matchingScenes); }, [matchingScenes]);
    React.useEffect(function () {
      var controller = new AbortController();
      setLoading(true); setError("");
      (async function () {
        var result = [], page = 1, total;
        do {
          var data = await hub.graphql("query DirtyStatsAges($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id date performers{id birthdate}}}}", sceneVariables(props.filter, page), { signal: controller.signal });
          if (controller.signal.aborted) return;
          var batch = data.findScenes; total = batch.count;
          if (!batch.scenes.length && result.length < total) throw new Error("The scene list changed while loading. Refresh to try again.");
          result = result.concat(batch.scenes); page++;
        } while (result.length < total);
        if (!controller.signal.aborted) { setScenes(result); setLoading(false); }
      })().catch(function (err) { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
      return function () { controller.abort(); };
    }, [queryKey, refresh]);
    React.useEffect(function () {
      if (loading || error || !node.current) return;
      var chart, observer;
      function resize() { if (chart && !chart.isDisposed()) chart.resize(); }
      try {
        if (!charts) throw new Error("The bundled chart library could not be loaded. Reload the Stash page.");
        chart = charts.init(node.current, null, { renderer: "canvas" }); chartRef.current = chart;
        chart.on("click", function (event) { if (event.componentType === "series" && Number.isFinite(Number(event.name))) setSelectedAge(Number(event.name)); });
        chart.setOption({ backgroundColor: "#242b31", grid: { left: 48, right: 20, top: 22, bottom: 75, containLabel: true },
          tooltip: { trigger: "axis", renderMode: "richText", axisPointer: { type: "shadow" }, formatter: function (items) { return "Age " + items[0].name + " years\n" + items[0].value + " distinct performers"; } },
          xAxis: { type: "category", name: "Age (years)", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: "#bbb" }, data: stats.rows.map(function (row) { return String(row.age); }), axisLabel: { color: "#bbb", hideOverlap: true }, axisLine: { lineStyle: { color: "#788591" } } },
          yAxis: { type: "value", name: "Distinct performers", nameLocation: "middle", nameGap: 35, min: 0, minInterval: 1, nameTextStyle: { color: "#bbb" }, axisLabel: { color: "#bbb" }, splitLine: { lineStyle: { color: "#364655" } } },
          dataZoom: [{ type: "inside" }, { type: "slider", bottom: 8, height: 18, borderColor: "#5687a2", textStyle: { color: "#bbb" } }],
          series: [{ name: "Distinct performers", type: "bar", barCategoryGap: "5%", itemStyle: { color: "#54d5ca" }, data: stats.rows.map(function (row) { return row.count; }) }] });
        setChartError("");
        if (typeof ResizeObserver === "function") { observer = new ResizeObserver(resize); observer.observe(node.current); }
        window.addEventListener("resize", resize);
      } catch (err) { setChartError(err.message); }
      return function () { if (observer) observer.disconnect(); window.removeEventListener("resize", resize); if (chart) chart.dispose(); chartRef.current = null; };
    }, [stats, loading, error]);
    React.useEffect(function () {
      if (chartRef.current) chartRef.current.setOption({ series: [{ data: stats.rows.map(function (row) { return { value: row.count, itemStyle: { color: selectedAge === row.age ? "#f3c779" : "#54d5ca" } }; }) }] });
    }, [selectedAge, stats, loading, error]);
    return h("section", { className: "dirty-stats-content" },
      h("div", { className: "dirty-stats-toolbar" }, h("span", { className: "dirty-stats-summary", role: "status" }, loading ? "Loading scene ages..." : stats.performers + " distinct performers across " + stats.scenes + " matching scenes"),
        h("button", { className: "btn btn-secondary dirty-ui-button", disabled: loading, onClick: function () { setRefresh(refresh + 1); } }, "Refresh")),
      matchingError ? h("div", { className: "dirty-stats-alert", role: "alert" }, "Performer filters: " + matchingError) : null,
      error ? h("div", { className: "dirty-stats-alert", role: "alert" }, error) : null,
      h("section", { className: "dirty-stats-map-panel dirty-ui-panel", "aria-label": "Performer age histogram" },
        h("div", { className: "dirty-stats-map-controls" }, h("button", { className: "btn btn-secondary dirty-ui-button dirty-stats-export", disabled: loading || Boolean(error) || Boolean(chartError), onClick: function () { if (chartRef.current) download(chartRef.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#242b31" }), "DirtyStats-age-at-scene.png"); } }, "Export PNG")),
        !loading && !error ? h("div", { ref: node, className: "dirty-stats-growth-chart dirty-stats-age-chart", role: "img", "aria-label": "Histogram of age in completed years at scene date versus distinct performer count." }) : null),
      chartError ? h("div", { className: "dirty-stats-alert", role: "alert" }, chartError) : null,
      !loading && !error && !stats.rows.length ? h("p", { role: "status" }, "No performers with valid birthdates and scene dates match these filters.") : null,
      h("p", null, "Click an age bar to show its performers below. Each bar counts distinct performers at that age on matching scene dates. Repeated scenes at the same age count once; a performer may appear in several age bars."),
      !loading && !error && (stats.missingSceneDates || stats.missingBirthdates) ? h("p", { role: "status" }, stats.missingSceneDates + " scenes without valid full dates and " + stats.missingBirthdates + " performer appearances without usable birthdates were excluded.") : null,
      !loading && !error ? h(PerformerCards, { performers: selectedPerformers, title: selectedAge == null ? "Performers" : "Performers aged " + selectedAge, selection: selectedAge, clearSelection: function () { setSelectedAge(null); }, clearLabel: "Show all ages" }) : null);
  }
  function ratingNumber(scene) {
    var rating = scene.rating100 == null || scene.rating100 === "" ? NaN : Number(scene.rating100);
    return Number.isFinite(rating) && rating >= 0 && rating <= 100 ? rating / 10 : null;
  }
  function roundRating(value, step) {
    if (!step) return value;
    return Math.min(10, Math.max(0, Math.round(value / step) * step));
  }
  function sceneRating(scene, step) {
    var rating = ratingNumber(scene);
    return rating == null ? "Unrated" : String(roundRating(rating, step));
  }
  function aggregateRatings(scenes, step) {
    var counts = new Map(), seen = new Set();
    scenes.forEach(function (scene) {
      if (seen.has(scene.id)) return;
      seen.add(scene.id);
      var rating = sceneRating(scene, step);
      counts.set(rating, (counts.get(rating) || 0) + 1);
    });
    return { total: seen.size, rows: Array.from(counts, function (item) { return { name: item[0], value: item[1] }; }).sort(function (a, b) { return a.name === "Unrated" ? 1 : b.name === "Unrated" ? -1 : Number(a.name) - Number(b.name); }) };
  }
  function RatingPage(props) {
    var performerMode = Boolean(props.performerMode), entity = performerMode ? "performers" : "scenes", title = performerMode ? "Performer ratings" : "Scene ratings";
    var variables = performerMode ? performerVariables : sceneVariables;
    var dataState = React.useState([]), scenes = dataState[0], setScenes = dataState[1];
    var loadingState = React.useState(true), loading = loadingState[0], setLoading = loadingState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var selectionState = React.useState(null), selected = selectionState[0], setSelected = selectionState[1];
    var roundingState = React.useState(function () { return ratingRounding; }), rounding = roundingState[0], setRounding = roundingState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var node = React.useRef(null), chartRef = React.useRef(null);
    var queryKey = JSON.stringify(variables(props.filter, 1));
    React.useEffect(function () {
      var controller = new AbortController();
      setLoading(true); setError(""); setSelected(null);
      (async function () {
        var result = [], page = 1, total;
        do {
          var data = await hub.graphql(performerMode ? "query DirtyStatsPerformerRatings($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id rating100}}}" : "query DirtyStatsRatings($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id rating100}}}", variables(props.filter, page), { signal: controller.signal });
          if (controller.signal.aborted) return;
          var batch = performerMode ? data.findPerformers : data.findScenes;
          total = batch.count;
          if (!batch[entity].length && result.length < total) throw new Error("The " + entity + " list changed while loading. Refresh to try again.");
          result = result.concat(batch[entity]); page++;
        } while (result.length < total);
        setScenes(result); setLoading(false);
      })().catch(function (err) { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
      return function () { controller.abort(); };
    }, [queryKey, refresh, performerMode]);
    var stats = React.useMemo(function () { return aggregateRatings(scenes, rounding); }, [scenes, rounding]);
    var matching = React.useMemo(function () { return selected == null ? scenes : scenes.filter(function (scene) { return sceneRating(scene, rounding) === selected; }); }, [scenes, selected, rounding]);
    React.useEffect(function () {
      if (loading || error || !node.current || !stats.total) return;
      var chart, observer;
      function resize() { if (chart && !chart.isDisposed()) chart.resize(); }
      try {
        if (!charts) throw new Error("The bundled chart library could not be loaded. Reload Stash.");
        chart = charts.init(node.current, null, { renderer: "canvas" }); chartRef.current = chart;
        chart.setOption({ backgroundColor: "#242b31", tooltip: { trigger: "item", renderMode: "richText", formatter: function (p) { return (p.name === "Unrated" ? p.name : "Rating " + p.name + "/10") + "\n" + p.value + " " + entity + " (" + p.percent + "%)"; } },
          legend: { type: "scroll", bottom: 8, textStyle: { color: "#ddd", fontSize: 11 }, itemWidth: 12, itemHeight: 12, pageTextStyle: { color: "#ddd" } },
          series: [{ type: "pie", radius: [0, "72%"], center: ["50%", "46%"], selectedMode: "single", label: { color: "#ddd", formatter: "{b}: {d}%" }, itemStyle: { borderColor: "#242b31", borderWidth: 2 }, data: stats.rows }] });
        chart.on("click", function (event) { if (event.componentType === "series") setSelected(function (current) { return current === event.name ? null : event.name; }); });
        if (typeof ResizeObserver === "function") { observer = new ResizeObserver(resize); observer.observe(node.current); }
        window.addEventListener("resize", resize);
      } catch (err) { setError(err.message); }
      return function () { if (observer) observer.disconnect(); window.removeEventListener("resize", resize); if (chart) chart.dispose(); chartRef.current = null; };
    }, [stats, loading, error]);
    React.useEffect(function () { if (chartRef.current) chartRef.current.setOption({ series: [{ data: stats.rows.map(function (row) { return Object.assign({}, row, { selected: row.name === selected }); }) }] }); }, [selected, stats, loading, error]);
    return h("section", { className: "dirty-stats-content" },
      h("div", { className: "dirty-stats-toolbar" }, h("span", { className: "dirty-stats-summary", role: "status" }, loading ? "Loading " + entity + "..." : stats.total + " matching " + entity), h("button", { className: "btn btn-secondary", disabled: loading, onClick: function () { setRefresh(refresh + 1); } }, "Refresh")),
      error ? h("p", { role: "alert" }, error) : null,
      !loading && !error && stats.total ? h("section", { className: "dirty-stats-map-panel dirty-ui-panel", "aria-label": title },
          h("div", { className: "dirty-stats-map-controls" }, selected != null ? h("button", { className: "btn btn-secondary", onClick: function () { setSelected(null); } }, "Show all ratings") : null,
          h("label", { className: "dirty-stats-date-basis" }, "Rating rounding",
            h("select", { className: "form-control dirty-stats-statistic", value: rounding, onChange: function (event) { ratingRounding = Number(event.target.value); setRounding(ratingRounding); setSelected(null); } },
              h("option", { value: 0 }, "Exact"), h("option", { value: 0.5 }, "0.5"), h("option", { value: 1 }, "1"))),
          h("button", { className: "btn btn-secondary dirty-stats-export", onClick: function () { if (chartRef.current) download(chartRef.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#242b31" }), performerMode ? "DirtyStats-performer-ratings.png" : "DirtyStats-scene-ratings.png"); } }, "Export PNG")),
        h("div", { ref: node, className: "dirty-stats-growth-chart", role: "img", "aria-label": "Pie chart of distinct " + entity + " by rating out of ten, including unrated " + entity + "." })) : null,
      !loading && !error ? h(React.Fragment, null, selected != null ? h("p", { role: "status" }, selected === "Unrated" ? "Unrated " + entity : title + ": " + selected + "/10") : null, performerMode ? h(PerformerCards, { performers: matching, filter: props.filter }) : h(SceneCards, { scenes: matching, filter: props.filter })) : null);
  }
  function DirtyStatsRoute() {
    var page = React.useRef(null);
    var location = api.libraries.ReactRouterDOM.useLocation();
    var statistic = location.pathname === constellationRoute ? "constellation" : location.pathname === performerRatingRoute ? "performerRatings" : location.pathname === ratingRoute ? "ratings" : location.pathname === ageRoute ? "ages" : location.pathname === growthRoute ? "growth" : "origin";
    var sceneView = statistic !== "origin" && statistic !== "performerRatings";
    var state = React.useState(false), ready = state[0], setReady = state[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    React.useEffect(function () {
      var active = true;
      setReady(false); setError("");
      (async function () {
        if (sceneView) {
          if (!api.components.FilteredSceneList || !api.components.SceneCard) {
            if (!api.utils || !api.utils.loadComponents || !api.loadableComponents.SceneList) throw new Error("This Stash version does not expose the native scene filters.");
            await api.utils.loadComponents([api.loadableComponents.SceneList]);
          }
          if (!api.components.FilteredSceneList || !api.components.SceneCard) throw new Error("Stash's native scene filters or cards could not be loaded.");
        } else {
          if (!api.components.FilteredPerformerList || !api.components.PerformerCard) {
            if (!api.utils || !api.utils.loadComponents || !api.loadableComponents.Performers) throw new Error("This Stash version does not expose the native performer filters.");
            await api.utils.loadComponents([api.loadableComponents.Performers]);
          }
          if (!api.components.FilteredPerformerList || !api.components.PerformerCard) throw new Error("Stash's native performer filter component could not be loaded.");
        }
        if (statistic === "ages" && (!api.components.PerformerCard || !api.components.FilteredPerformerList)) {
          await api.utils.loadComponents([api.loadableComponents.Performers]);
          if (!api.components.PerformerCard || !api.components.FilteredPerformerList) throw new Error("Stash's native performer filters and cards could not be loaded.");
        }
        if (active) setReady(true);
      })().catch(function (err) { if (active) setError(err.message); });
      return function () { active = false; };
    }, [sceneView, statistic === "ages"]);
    return h("main", { ref: page, className: "dirty-stats-page dirty-stats-native-filters" },
      ready ? h(FilterStatisticSelector, { page: page, value: statistic }) : null,
      error ? h("div", { className: "dirty-stats-alert", role: "alert" }, error) : ready && (statistic !== "ages" || api.components.PerformerCard) && (sceneView ? api.components.FilteredSceneList : api.components.FilteredPerformerList) ? h(sceneView ? api.components.FilteredSceneList : api.components.FilteredPerformerList, { key: statistic, view: sceneView ? "scenes" : "performers", alterQuery: true, extraCriteria: { dirtyStats: true } }) : h("p", { role: "status" }, "Loading filters..."));
  }
  function NavIcon() {
    return h(api.libraries.ReactRouterDOM.NavLink, { to: route, exact: true, className: "nav-utility dirty-stats-nav", title: "DirtyStats", "aria-label": "Open DirtyStats" },
      h("button", { type: "button", title: "DirtyStats", className: "minimal d-flex align-items-center h-100 btn btn-primary dirty-stats-nav-button" }, h("svg", { viewBox: "0 0 24 24", "aria-hidden": true }, h("path", { d: "M12.149 11.980L15.420 2.743A9.8 9.8 0 0 1 17.699 20.057Z", fill: "#e40606" }),
        h("path", { d: "M12.013 12.149L17.134 20.505A9.8 9.8 0 0 1 8.421 21.268Z", fill: "#060607" }),
        h("path", { d: "M11.855 12.039L7.791 20.956A9.8 9.8 0 0 1 3.877 6.348Z", fill: "#060784" }),
        h("path", { d: "M11.955 11.857L4.285 5.756A9.8 9.8 0 0 1 14.738 2.461Z", fill: "#faf710" }))));
  }
  api.register.route(route, DirtyStatsRoute);
  api.patch.instead("PerformerList", function () {
    var args = Array.prototype.slice.call(arguments), next = args.pop(), props = args[0];
    if (window.location.pathname === ageRoute && props && props.extraCriteria && props.extraCriteria.dirtyStatsAgeFilters) return h(PerformerFilterCapture, { filter: props.filter });
    if (window.location.pathname === performerRatingRoute && props && props.extraCriteria && props.extraCriteria.dirtyStats) return h(RatingPage, { filter: props.filter, performerMode: true });
    if (window.location.pathname !== route || !props || !props.extraCriteria || !props.extraCriteria.dirtyStats) return next.apply(null, args);
    return h(StatsPage, { filter: props.filter });
  });
  api.patch.instead("SceneList", function () {
    var args = Array.prototype.slice.call(arguments), next = args.pop(), props = args[0];
    if ((window.location.pathname !== growthRoute && window.location.pathname !== ageRoute && window.location.pathname !== ratingRoute && window.location.pathname !== constellationRoute) || !props || !props.filter) return next.apply(null, args);
    return h(window.location.pathname === constellationRoute ? ConstellationPage : window.location.pathname === ratingRoute ? RatingPage : window.location.pathname === ageRoute ? AgePage : GrowthPage, { filter: props.filter });
  });
  api.patch.before("MainNavBar.UtilityItems", function (props) { return [{ children: h(React.Fragment, null, props.children, h(NavIcon)) }]; });
  window.__dirtyStatsPlugin = { route: route, algorithms: { constellationLayout: constellationLayout, constellationGender: constellationGender, aggregateConstellation: aggregateConstellation, constellationScenes: constellationScenes, aggregateRatings: aggregateRatings, sceneRating: sceneRating, roundRating: roundRating, forecastGrowth: forecastGrowth, filterAgeScenes: filterAgeScenes, performersAtAge: performersAtAge, ageAtScene: ageAtScene, aggregateAges: aggregateAges, scenesInPeriod: scenesInPeriod, periodGrowth: periodGrowth, orderedCards: orderedCards, sceneVariables: sceneVariables, aggregateGrowth: aggregateGrowth, formatBytes: formatBytes, normalize: normalize, countryIndex: countryIndex, performerVariables: performerVariables, aggregate: aggregate, countryPerformers: countryPerformers, eckertIV: eckertIV } };
})();
