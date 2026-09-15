(function () {
  "use strict";
  if (window.__dirtyStatsPlugin) return;
  var api = window.PluginApi;
  var hub = window.DirtyPlugins;
  if (!api || !hub || !hub.graphql) return;
  var React = api.React;
  var h = React.createElement;
  var route = "/plugins/dirty-stats";
  // Keep the bundled library reference even if another plugin loads ECharts later.
  var charts = window.echarts;
  var world = window.__dirtyStatsWorld;
  var defaults = { name: "", gender: "", tag: "", favorite: "", rating: "", scenes: "", country: "" };

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
  function filterPerformers(performers, filters) {
    var search = String(filters.name || "").trim().toLowerCase();
    return performers.filter(function (p) {
      return (!search || [p.name].concat(p.alias_list || []).some(function (name) { return String(name || "").toLowerCase().includes(search); })) &&
        (!filters.gender || p.gender === filters.gender) &&
        (!filters.tag || (p.tags || []).some(function (tag) { return String(tag.id) === filters.tag; })) &&
        (!filters.favorite || Boolean(p.favorite) === (filters.favorite === "yes")) &&
        (filters.rating === "" || (p.rating100 != null && p.rating100 >= Number(filters.rating))) &&
        (filters.scenes === "" || Number(p.scene_count || 0) >= Number(filters.scenes)) &&
        (!filters.country || countries[normalize(p.country)] === filters.country);
    });
  }
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
  function csvCell(value) {
    var text = String(value);
    if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function csv(stats) {
    var rows = stats.rows.map(function (row) { return [row.name, row.value]; });
    rows.push(["Missing country", stats.missing]);
    Object.keys(stats.unknown).sort().forEach(function (name) { rows.push(["Unmapped: " + name, stats.unknown[name]]); });
    return "Country,Performers\r\n" + rows.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n");
  }
  function download(url, filename) {
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  function Field(props) {
    return h("label", { className: "dirty-stats-field" }, h("span", null, props.label), props.children);
  }
  function StatsPage() {
    var dataState = React.useState([]), performers = dataState[0], setPerformers = dataState[1];
    var loadingState = React.useState(true), loading = loadingState[0], setLoading = loadingState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var filterState = React.useState(Object.assign({}, defaults)), filters = filterState[0], setFilters = filterState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var labelState = React.useState(false), labels = labelState[0], setLabels = labelState[1];
    var chartNode = React.useRef(null), chartRef = React.useRef(null);
    var selected = React.useMemo(function () { return filterPerformers(performers, filters); }, [performers, filters]);
    var stats = React.useMemo(function () { return aggregate(selected, countries); }, [selected]);
    var tags = React.useMemo(function () {
      var all = new Map();
      performers.forEach(function (p) { (p.tags || []).forEach(function (tag) { all.set(String(tag.id), tag.name); }); });
      return Array.from(all).sort(function (a, b) { return a[1].localeCompare(b[1]); });
    }, [performers]);
    React.useEffect(function () {
      var controller = new AbortController();
      setLoading(true); setError("");
      // Bounded pages avoid a single very large GraphQL response on big libraries.
      (async function () {
        var result = [], page = 1, total;
        do {
          var data = await hub.graphql("query DirtyStatsPerformers($filter:FindFilterType!){findPerformers(filter:$filter){count performers{id name alias_list country gender favorite rating100 scene_count tags{id name}}}}", { filter: { per_page: 500, page: page, sort: "id", direction: "ASC" } }, { signal: controller.signal });
          if (controller.signal.aborted) return;
          var batch = data.findPerformers;
          total = batch.count;
          if (!batch.performers.length && result.length < total) throw new Error("The performer list changed while loading. Refresh to try again.");
          result = result.concat(batch.performers); page++;
        } while (result.length < total);
        if (!controller.signal.aborted) { setPerformers(result); setLoading(false); }
      })().catch(function (err) { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
      return function () { controller.abort(); };
    }, [refresh]);
    React.useEffect(function () {
      if (loading || error || !chartNode.current) return;
      if (!charts || !world) { setChartError("The bundled chart or map data could not be loaded. Reload the Stash page."); return; }
      var chart, observer;
      function resize() { if (chart && !chart.isDisposed()) chart.resize(); }
      try {
        charts.registerMap("dirtyStatsWorld", world);
        chart = charts.init(chartNode.current, null, { renderer: "canvas" });
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
      chart.setOption({ backgroundColor: "#242b31", title: { text: "Performer origin", subtext: stats.total + " filtered performers", left: "center", textStyle: { color: "#eee" }, subtextStyle: { color: "#bbb" } }, tooltip: { trigger: "item", renderMode: "richText", formatter: function (p) { return p.name + ": " + (Number(p.value) || 0) + " performers"; } }, visualMap: { min: 0, max: Math.max(1, stats.rows.length ? stats.rows[0].value : 0), left: 15, bottom: 15, calculable: false, text: ["More", "0"], textStyle: { color: "#ddd" }, inRange: { color: ["#364655", "#5687a2", "#54d5ca"] } }, series: [{ type: "map", map: "dirtyStatsWorld", roam: true, scaleLimit: { min: 1, max: 12 }, label: { show: labels, color: "#fff", fontSize: 10, formatter: function (p) { return Number(p.value) > 0 ? String(p.value) : ""; } }, itemStyle: { borderColor: "#788591", borderWidth: .5 }, emphasis: { label: { show: true, color: "#fff" }, itemStyle: { areaColor: "#bc8542" } }, data: world.features.map(function (feature) { return { name: feature.properties.name, value: counts.get(feature.properties.name) || 0 }; }) }] }, true);
    }, [stats, labels, loading, error]);
    function changed(key, value) { setFilters(function (current) { var next = Object.assign({}, current); next[key] = value; return next; }); }
    function select(key, label, options) {
      return h(Field, { label: label }, h("select", { className: "form-control", value: filters[key], onChange: function (event) { changed(key, event.target.value); } }, options.map(function (option) { return h("option", { key: option[0], value: option[0] }, option[1]); })));
    }
    function number(key, label, max) {
      return h(Field, { label: label }, h("input", { className: "form-control", type: "number", min: 0, max: max, step: 1, value: filters[key], placeholder: "Any", onChange: function (event) { var value = event.target.value; changed(key, value === "" ? "" : String(Math.max(0, Math.min(max || Infinity, Number(value))))); } }));
    }
    var unmapped = Object.keys(stats.unknown).reduce(function (sum, name) { return sum + stats.unknown[name]; }, 0);
    return h("main", { className: "dirty-stats-page" },
      h("header", { className: "dirty-stats-header" }, h("div", null, h("h1", null, "dirtyStats"), h("p", null, "Explore your library through statistics.")), h(Field, { label: "Statistic" }, h("select", { className: "form-control", value: "origin", onChange: function () {} }, h("option", { value: "origin" }, "Performer origin")))),
      h("section", { className: "dirty-stats-filters dirty-ui-panel", "aria-label": "Performer filters" },
        h(Field, { label: "Name or alias" }, h("input", { type: "search", className: "form-control", value: filters.name, onChange: function (event) { changed("name", event.target.value); }, placeholder: "Search performers" })),
        select("gender", "Gender", [["", "All genders"]].concat(Array.from(new Set(performers.map(function (p) { return p.gender; }).filter(Boolean))).sort().map(function (gender) { return [gender, gender.replace(/_/g, " ")]; }))),
        select("tag", "Tag", [["", "All tags"]].concat(tags)),
        select("favorite", "Favorite", [["", "All performers"], ["yes", "Favorites only"], ["no", "Non-favorites only"]]),
        select("country", "Country", [["", "All countries"]].concat(Array.from(new Set(Object.values(countries))).sort().map(function (name) { return [name, name]; }))),
        number("rating", "Minimum rating (0–100)", 100), number("scenes", "Minimum scene count")),
      h("div", { className: "dirty-stats-toolbar" }, h("span", { className: "dirty-stats-summary", role: "status" }, loading ? "Loading performers…" : stats.total + " performers · " + stats.rows.length + " countries · " + stats.missing + " missing country · " + unmapped + " unmapped"),
        h("div", { className: "dirty-stats-actions" },
          h("button", { className: "btn btn-secondary dirty-ui-button", onClick: function () { setFilters(Object.assign({}, defaults)); } }, "Reset filters"),
          h("button", { className: "btn btn-secondary dirty-ui-button", disabled: loading, onClick: function () { setRefresh(refresh + 1); } }, "Refresh"),
          h("button", { className: "btn btn-secondary dirty-ui-button", disabled: loading || Boolean(error) || Boolean(chartError), onClick: function () { if (chartRef.current) download(chartRef.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#242b31" }), "dirtyStats-performer-origin.png"); } }, "Export PNG"),
          h("button", { className: "btn btn-secondary dirty-ui-button", disabled: loading || Boolean(error), onClick: function () { var url = URL.createObjectURL(new Blob(["\uFEFF" + csv(stats)], { type: "text/csv;charset=utf-8" })); download(url, "dirtyStats-performer-origin.csv"); setTimeout(function () { URL.revokeObjectURL(url); }, 1000); } }, "Export CSV"))),
      error ? h("div", { className: "dirty-stats-alert", role: "alert" }, error, " Use Refresh to retry.") : null,
      !loading && !error ? h(React.Fragment, null,
        chartError ? h("div", { className: "dirty-stats-alert", role: "alert" }, chartError) : null,
        h("div", { className: "dirty-stats-toolbar" }, h("label", null, h("input", { type: "checkbox", checked: labels, onChange: function (event) { setLabels(event.target.checked); } }), " Show counts on map"), h("button", { className: "btn btn-secondary dirty-ui-button", onClick: function () { if (chartRef.current) chartRef.current.dispatchAction({ type: "restore" }); } }, "Reset map")),
        !stats.total ? h("p", { role: "status" }, "No performers match these filters.") : null,
        h("div", { className: "dirty-stats-layout" }, h("section", { className: "dirty-stats-map-panel dirty-ui-panel", "aria-label": "Performer origin world map" }, h("div", { ref: chartNode, className: "dirty-stats-chart", role: "img", "aria-label": "World map of performer counts. Exact values are available in the country table." })),
          h("section", { className: "dirty-stats-table-panel dirty-ui-panel" }, h("h2", { className: "h5" }, "Country counts"), h("table", null, h("thead", null, h("tr", null, h("th", { scope: "col" }, "Country"), h("th", { scope: "col" }, "Count"))), h("tbody", null, stats.rows.map(function (row) { return h("tr", { key: row.name }, h("td", null, row.name), h("td", null, row.value)); }))), !stats.rows.length ? h("p", null, "No mapped countries.") : null)),
        h("p", null, "Each performer is counted once using Stash’s country field. Hover for counts; scroll to zoom and drag to pan. Small territories may not appear at this map’s resolution."),
        unmapped > 0 ? h("details", null, h("summary", null, "Unmapped country values (" + unmapped + ")"), h("ul", null, Object.keys(stats.unknown).sort().map(function (name) { return h("li", { key: name }, name + ": " + stats.unknown[name]); }))) : null) : null);
  }
  function NavIcon() {
    return h(api.libraries.ReactRouterDOM.NavLink, { to: route, exact: true, className: "nav-utility dirty-stats-nav", title: "dirtyStats", "aria-label": "Open dirtyStats" },
      h("span", { className: "minimal d-flex align-items-center h-100 px-2" }, h("svg", { viewBox: "0 0 24 24", "aria-hidden": true }, h("path", { d: "M11 2a10 10 0 1 0 11 11H11V2zm2 0v9h9a10 10 0 0 0-9-9z" }))));
  }
  api.register.route(route, StatsPage);
  api.patch.before("MainNavBar.UtilityItems", function (props) { return [{ children: h(React.Fragment, null, props.children, h(NavIcon)) }]; });
  window.__dirtyStatsPlugin = { route: route, algorithms: { normalize: normalize, countryIndex: countryIndex, filterPerformers: filterPerformers, aggregate: aggregate, csv: csv } };
})();
