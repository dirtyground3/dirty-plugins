(function () {
  "use strict";
  if (window.__dirtyStatsPlugin) {
    if (window.DirtyPlugins && window.DirtyPlugins.debugLog) {
      window.DirtyPlugins.debugLog("dirtyStats", "skipped: duplicate load");
    }
    return;
  }
  var api = window.PluginApi;
  var hub = window.DirtyPlugins;
  if (!api || !hub || !hub.graphql) {
    if (window.DirtyPlugins && window.DirtyPlugins.debugLog) {
      window.DirtyPlugins.debugLog("dirtyStats", "skipped: required runtime missing", {
        hasPluginApi: Boolean(api),
        hasDirtyPlugins: Boolean(hub),
      });
    }
    return;
  }
  window.__dirtyCurrentPluginId = "dirtyStats";
  var debugLog = hub.debugLog || function () {};
  var debugScriptSrc = null;
  try {
    debugScriptSrc = (typeof document !== "undefined" && document.currentScript) ? document.currentScript.src : null;
  } catch (_debugError) {}
  debugLog("dirtyStats", "script started", { script: debugScriptSrc });
  var React = api.React;
  var h = React.createElement;
  var route = "/plugins/dirty-stats";
  var growthRoute = route + "/scenes";
  var ageRoute = route + "/ages";
  var ratingRoute = route + "/ratings";
  var performerRatingRoute = route + "/performer-ratings";
  var performerScatterRoute = route + "/performer-scatter";
  var countRatingRoute = route + "/count-rating";
  var constellationRoute = route + "/constellation";
  var studioRoute = route + "/studios";
  var birthdayRoute = route + "/birthdays";
  var agePerformerFilter = null;
  var performerFilterEvent = "dirty-stats:performer-filter";
  var PLUGIN_ID = "dirtyStats";
  // Display options persist through the shared hub settings so every statistic
  // reopens with the view the user last chose.
  var STATS_SETTING_SPECS = {
    showMapNumbers: { options: [false, true] },
    sceneRatingRounding: { options: [0, 0.5, 1] },
    performerRatingRounding: { options: [0, 0.5, 1] },
    growthDateBasis: { options: ["created_at", "mod_time", "scene_date"] },
    growthGrouping: { options: ["day", "month", "year"] },
    growthShowForecast: { options: [false, true] },
    growthShowCapacity: { options: [false, true] },
    constellationMaxPerformers: { options: [50, 100, 200, 500, 1000] },
    constellationMinShared: { options: [1, 2, 3, 5, 10] },
    scatterMinRating: { options: [0, 5, 6, 7, 8, 9] },
    scatterMaxScenes: { options: [0, 5, 10, 20, 50, 100] },
    countRatingMetric: { options: ["play_count", "o_counter"] },
    studioMinScenes: { options: [1, 2, 5, 10, 20] }
  };
  var statsSettings = {
    showMapNumbers: false,
    sceneRatingRounding: 0.5,
    performerRatingRounding: 0.5,
    growthDateBasis: "created_at",
    growthGrouping: "day",
    growthShowForecast: false,
    growthShowCapacity: true,
    constellationMaxPerformers: 100,
    constellationMinShared: 1,
    scatterMinRating: 9,
    scatterMaxScenes: 10,
    countRatingMetric: "play_count",
    studioMinScenes: 1
  };
  var statsSettingsListeners = new Set();
  var statsSettingsRevision = 0;
  var statsSettingsSaveTimer = null;

  function parseStatsSetting(name, value) {
    var spec = STATS_SETTING_SPECS[name];
    if (!spec) return null;
    for (var index = 0; index < spec.options.length; index += 1) {
      if (spec.options[index] === value) return spec.options[index];
    }
    for (var stringIndex = 0; stringIndex < spec.options.length; stringIndex += 1) {
      if (String(spec.options[stringIndex]) === String(value)) return spec.options[stringIndex];
    }
    return null;
  }

  function notifyStatsSettings() {
    statsSettingsRevision += 1;
    statsSettingsListeners.forEach(function (listener) { listener(); });
  }

  function scheduleStatsSettingsSave() {
    if (typeof hub.configurePlugin !== "function") return;
    if (statsSettingsSaveTimer !== null) window.clearTimeout(statsSettingsSaveTimer);
    statsSettingsSaveTimer = window.setTimeout(function () {
      statsSettingsSaveTimer = null;
      hub.configurePlugin(PLUGIN_ID, statsSettings).catch(function (error) {
        console.warn("DirtyStats could not save its display settings", error);
      });
    }, 400);
  }

  function setStatsSetting(name, value) {
    var next = parseStatsSetting(name, value);
    if (next === null || statsSettings[name] === next) return;
    statsSettings[name] = next;
    notifyStatsSettings();
    scheduleStatsSettingsSave();
  }

  function statsSettingsFromStorage(stored) {
    var source = stored && typeof stored === "object" ? stored : {};
    var parsed = {};
    Object.keys(statsSettings).forEach(function (name) {
      var value = parseStatsSetting(name, source[name]);
      if (value !== null) parsed[name] = value;
    });
    // Older builds stored one rounding value shared by both ratings charts.
    var legacyRounding = parseStatsSetting("sceneRatingRounding", source.ratingRounding);
    if (legacyRounding !== null) {
      if (parsed.performerRatingRounding === undefined) parsed.performerRatingRounding = legacyRounding;
      if (parsed.sceneRatingRounding === undefined) parsed.sceneRatingRounding = legacyRounding;
    }
    return parsed;
  }

  function loadStatsSettings() {
    if (typeof hub.getPluginSettings !== "function") return Promise.resolve();
    return hub.getPluginSettings(PLUGIN_ID).then(function (stored) {
      var parsed = statsSettingsFromStorage(stored);
      var changed = false;
      Object.keys(parsed).forEach(function (name) {
        if (statsSettings[name] !== parsed[name]) {
          statsSettings[name] = parsed[name];
          changed = true;
        }
      });
      if (changed) notifyStatsSettings();
    }).catch(function (error) {
      console.warn("DirtyStats could not load its display settings", error);
    });
  }

  function useStatsSetting(name) {
    var revisionState = React.useState(statsSettingsRevision);
    var setRevision = revisionState[1];
    React.useEffect(function () {
      var listener = function () { setRevision(statsSettingsRevision); };
      statsSettingsListeners.add(listener);
      return function () { statsSettingsListeners.delete(listener); };
    }, [setRevision]);
    return [statsSettings[name], function (value) { setStatsSetting(name, value); }];
  }
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
  function countryPlaceholder(value) {
    var text = String(value || "").trim().toLowerCase();
    if (!text) return true;
    if (text === "unknown" || text === "none" || text === "?") return true;
    if (/^[-\u2013\u2014]+$/.test(text)) return true;
    // Only a bare 2-3 letter code may stand in for an ISO code: "N/A" and its
    // punctuation variants must not collapse into Namibia's "NA".
    return normalize(text) === "na" && text !== "na";
  }
  function countryName(value, index) {
    var text = String(value || "").trim();
    if (!text || countryPlaceholder(text)) return null;
    return index[normalize(text)] || null;
  }
  function aggregate(performers, index) {
    var counts = Object.create(null);
    var missing = 0;
    performers.forEach(function (p) {
      var country = countryName(p.country, index);
      if (!country) { missing++; return; }
      counts[country] = (counts[country] || 0) + 1;
    });
    return { rows: Object.keys(counts).map(function (name) { return { name: name, value: counts[name] }; }).sort(function (a, b) { return b.value - a.value || a.name.localeCompare(b.name); }), missing: missing, total: performers.length };
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
  // Birthdays recur every year, so the year is stripped and Feb 29 falls back to
  // Feb 28 in non-leap years instead of silently rolling into March.
  function birthdayInYear(year, month, day) {
    var date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCMonth() !== month - 1) date = new Date(Date.UTC(year, month - 1, day - 1));
    return date;
  }
  function daysUntilBirthday(month, day, now) {
    now = now == null ? new Date() : now;
    var today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    var next = birthdayInYear(today.getUTCFullYear(), month, day);
    if (next < today) next = birthdayInYear(today.getUTCFullYear() + 1, month, day);
    return Math.round((next.getTime() - today.getTime()) / 86400000);
  }
  function performerImageSource(performer) {
    var path = performer && performer.image_path ? String(performer.image_path).trim() : "";
    if (path) return path;
    return performer && performer.id != null && performer.id !== "" ? "/performer/" + encodeURIComponent(performer.id) + "/image" : "";
  }
  function aggregateBirthdays(performers, now) {
    now = now == null ? new Date() : now;
    var entries = [], seen = new Set(), missing = 0;
    performers.forEach(function (performer) {
      var id = String(performer.id == null ? "" : performer.id);
      if (!id || seen.has(id)) return;
      seen.add(id);
      var birth = fullDate(performer.birthdate);
      if (!birth) { missing++; return; }
      var month = birth.getUTCMonth() + 1, day = birth.getUTCDate();
      var daysUntil = daysUntilBirthday(month, day, now);
      var next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + daysUntil * 86400000);
      entries.push({
        id: id,
        name: String(performer.name || "Performer #" + id),
        birthdate: String(performer.birthdate || ""),
        month: month,
        day: day,
        turns: next.getUTCFullYear() - birth.getUTCFullYear(),
        daysUntil: daysUntil,
        image: performerImageSource(performer)
      });
    });
    entries.sort(function (a, b) { return a.month - b.month || a.day - b.day || a.name.localeCompare(b.name) || a.id.localeCompare(b.id); });
    return {
      entries: entries,
      total: seen.size,
      valid: entries.length,
      missing: missing,
      today: entries.filter(function (entry) { return entry.daysUntil === 0; }).length,
      upcoming: entries.filter(function (entry) { return entry.daysUntil <= 30; }).length
    };
  }
  function birthdayEntriesFor(entries, month, day) {
    return entries.filter(function (entry) { return entry.month === month && entry.day === day; });
  }
  function birthdayMonthCounts(entries) {
    var counts = [];
    for (var month = 1; month <= 12; month++) counts.push(entries.filter(function (entry) { return entry.month === month; }).length);
    return counts;
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
  var STATISTIC_ROUTES = {
    origin: route,
    growth: growthRoute,
    ages: ageRoute,
    ratings: ratingRoute,
    performerRatings: performerRatingRoute,
    performerScatter: performerScatterRoute,
    countRating: countRatingRoute,
    studios: studioRoute,
    constellation: constellationRoute,
    birthdays: birthdayRoute
  };
  var STATISTIC_LABELS = {
    origin: "Performer origin",
    growth: "Content growth",
    ages: "Age at scene",
    ratings: "Scene ratings",
    performerRatings: "Performer ratings",
    performerScatter: "Rating vs scenes",
    countRating: "Count vs rating",
    studios: "Studio value map",
    constellation: "Cast constellation",
    birthdays: "Performer birthdays"
  };
  var STATISTIC_ORDER = ["origin", "growth", "ages", "ratings", "performerRatings", "performerScatter", "countRating", "studios", "constellation", "birthdays"];
  function StatisticSelector(props) {
    var history = api.libraries.ReactRouterDOM.useHistory();
    var bootstrap = api.libraries.Bootstrap, Dropdown = bootstrap.Dropdown;
    return h(Dropdown, { as: bootstrap.ButtonGroup, className: "sort-by-select dirty-stats-selector", onSelect: function (value) { if (value && value !== props.value && STATISTIC_ROUTES[value]) history.push(STATISTIC_ROUTES[value]); } },
      h(bootstrap.InputGroup.Prepend, null, h(Dropdown.Toggle, { variant: "secondary", id: "dirty-stats-statistic", "aria-label": "Statistic" }, STATISTIC_LABELS[props.value] || STATISTIC_LABELS.origin)),
      h(Dropdown.Menu, { className: "bg-secondary text-white" },
        STATISTIC_ORDER.map(function (key) { return h(Dropdown.Item, { key: key, className: "bg-secondary text-white", eventKey: key, active: props.value === key }, STATISTIC_LABELS[key]); })));
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
    return country ? performers.filter(function (p) { return countryName(p.country, countries) === country; }) : performers;
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
    var labelState = useStatsSetting("showMapNumbers"), labels = labelState[0], setLabels = labelState[1];
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
    return h("section", { className: "dirty-stats-content" },
      h("div", { className: "dirty-stats-toolbar" }, h("span", { className: "dirty-stats-summary", role: "status" }, loading ? "Loading performers..." : stats.total + " performers \u00b7 " + stats.rows.length + " countries \u00b7 " + stats.missing + " missing or unrecognized country"),
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
        h(PerformerCards, { performers: countryPerformers(performers, selectedCountry), country: selectedCountry, filter: props.filter, clearCountry: function () { setSelectedCountry(""); } })) : null);
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
    var maxState = useStatsSetting("constellationMaxPerformers"), maxPerformers = maxState[0], setMaxPerformers = maxState[1];
    var sharedState = useStatsSetting("constellationMinShared"), minShared = sharedState[0], setMinShared = sharedState[1];
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
          h("label", { className: "dirty-stats-date-basis" }, "Maximum performers", h("select", { className: "form-control form-control-sm", value: maxPerformers, onChange: function (event) { setMaxPerformers(Number(event.target.value)); } }, STATS_SETTING_SPECS.constellationMaxPerformers.options.map(function (value) { return h("option", { key: value, value: value }, value); }))),
          h("label", { className: "dirty-stats-date-basis" }, "Minimum shared scenes", h("select", { className: "form-control form-control-sm", value: minShared, onChange: function (event) { setMinShared(Number(event.target.value)); } }, STATS_SETTING_SPECS.constellationMinShared.options.map(function (value) { return h("option", { key: value, value: value }, value); }))),
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
    var showCapacityState = useStatsSetting("growthShowCapacity"), showCapacity = showCapacityState[0], setShowCapacity = showCapacityState[1];
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
    var dateState = useStatsSetting("growthDateBasis"), dateBasis = dateState[0], setDateBasis = dateState[1];
    var groupingState = useStatsSetting("growthGrouping"), grouping = groupingState[0], setGrouping = groupingState[1];
    var forecastState = useStatsSetting("growthShowForecast"), showForecast = forecastState[0], setShowForecast = forecastState[1];
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
            h("select", { className: "form-control dirty-stats-statistic", value: dateBasis, onChange: function (event) { setDateBasis(event.target.value); } },
              h("option", { value: "created_at" }, "Created at"), h("option", { value: "mod_time" }, "File modified at"), h("option", { value: "scene_date" }, "Scene date"))),
          h("label", { className: "dirty-stats-numbers" }, h("input", { type: "checkbox", checked: showCapacity, onChange: function (event) { setShowCapacity(event.target.checked); } }), "Show capacity"),
          h("label", { className: "dirty-stats-numbers" }, h("input", { type: "checkbox", checked: showForecast, onChange: function (event) { setShowForecast(event.target.checked); } }), "Show forecast"),
          h("label", { className: "dirty-stats-date-basis" }, "Group by",
            h("select", { className: "form-control dirty-stats-statistic", value: grouping, onChange: function (event) { setGrouping(event.target.value); } },
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
        chart.setOption({ backgroundColor: "#242b31", grid: { left: 48, right: 20, top: 22, bottom: 55, containLabel: true },
          tooltip: { trigger: "axis", renderMode: "richText", axisPointer: { type: "shadow" }, formatter: function (items) { return "Age " + items[0].name + " years\n" + items[0].value + " distinct performers"; } },
          xAxis: { type: "category", name: "Age (years)", nameLocation: "middle", nameGap: 28, nameTextStyle: { color: "#bbb" }, data: stats.rows.map(function (row) { return String(row.age); }), axisLabel: { color: "#bbb", hideOverlap: true }, axisLine: { lineStyle: { color: "#788591" } } },
          yAxis: { type: "value", name: "Distinct performers", nameLocation: "middle", nameGap: 35, min: 0, minInterval: 1, nameTextStyle: { color: "#bbb" }, axisLabel: { color: "#bbb" }, splitLine: { lineStyle: { color: "#364655" } } },
          dataZoom: [{ type: "inside" }],
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
  function scatterBound(value) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : null;
  }
  function aggregateScatter(performers, minRating, maxScenes) {
    var floor = scatterBound(minRating), ceiling = scatterBound(maxScenes);
    var hasBounds = floor != null || ceiling != null;
    var seen = new Set(), points = [], missingRating = 0, missingScenes = 0;
    performers.forEach(function (performer) {
      var id = String(performer.id == null ? "" : performer.id);
      if (!id || seen.has(id)) return;
      seen.add(id);
      var rating = ratingNumber(performer);
      var scenes = performer.scene_count == null || performer.scene_count === "" ? NaN : Number(performer.scene_count);
      if (rating == null) { missingRating++; return; }
      if (!Number.isFinite(scenes) || scenes < 0) { missingScenes++; return; }
      var highlight = hasBounds && (floor == null || rating >= floor) && (ceiling == null || scenes <= ceiling);
      points.push({ id: id, name: String(performer.name || "Performer #" + id), rating: rating, scenes: scenes, highlight: highlight });
    });
    return { points: points, total: seen.size, missingRating: missingRating, missingScenes: missingScenes, highlights: points.filter(function (point) { return point.highlight; }).length };
  }
  function studioSymbolSize(bytes, maxBytes) {
    if (!(maxBytes > 0) || !(bytes > 0)) return 10;
    return 10 + 34 * Math.sqrt(bytes / maxBytes);
  }
  // Studio logos are composited into circular markers so each bubble reads as the
  // studio's logo inside a dot. Rendering uses an offscreen canvas; Stash serves the
  // images same-origin, which keeps the PNG export free of cross-origin taint.
  var studioImagePromises = Object.create(null);
  var studioImages = Object.create(null);
  var studioLogoSymbols = Object.create(null);
  function studioImageSource(studio) {
    var path = studio && studio.image_path ? String(studio.image_path).trim() : "";
    if (path) return path;
    return studio && studio.id != null && studio.id !== "" ? "/studio/" + encodeURIComponent(studio.id) + "/image" : "";
  }
  function loadStudioImage(path) {
    if (!path) return Promise.resolve(null);
    if (!studioImagePromises[path]) {
      studioImagePromises[path] = new Promise(function (resolve) {
        var image = new Image();
        image.onload = function () { studioImages[path] = image; resolve(image); };
        image.onerror = function () { resolve(null); };
        image.src = path;
      });
    }
    return studioImagePromises[path];
  }
  function renderStudioLogo(image, active) {
    var size = 96, radius = size / 2 - 3, sourceWidth = image.naturalWidth || image.width, sourceHeight = image.naturalHeight || image.height;
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) return "";
    var canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    var context = canvas.getContext("2d");
    if (!context) return "";
    context.save();
    context.beginPath();
    context.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    context.closePath();
    context.clip();
    var scale = Math.max(size / sourceWidth, size / sourceHeight);
    var width = sourceWidth * scale, height = sourceHeight * scale;
    context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
    context.restore();
    context.beginPath();
    context.arc(size / 2, size / 2, radius, 0, Math.PI * 2);
    context.lineWidth = 5;
    context.strokeStyle = active ? "#fff" : "#54d5ca";
    context.stroke();
    return canvas.toDataURL("image/png");
  }
  function studioLogoSymbol(path, active) {
    if (!path || !studioImages[path]) return "";
    var key = path + (active ? "|active" : "");
    if (studioLogoSymbols[key] == null) {
      try { studioLogoSymbols[key] = renderStudioLogo(studioImages[path], active) || ""; }
      catch (err) { studioLogoSymbols[key] = ""; }
    }
    return studioLogoSymbols[key];
  }
  function studioSeriesData(points, maxBytes, selected) {
    return points.map(function (point) {
      var active = point.id === selected, logo = studioLogoSymbol(point.image, active);
      var item = { id: point.id, name: point.name, bytes: point.bytes, unrated: point.unrated, value: [point.scenes, Math.round(point.rating * 10) / 10], symbolSize: studioSymbolSize(point.bytes, maxBytes) };
      if (logo) item.symbol = "image://" + logo;
      else item.itemStyle = { color: "#54d5ca", opacity: .8, borderColor: active ? "#fff" : "transparent", borderWidth: active ? 2 : 0 };
      return item;
    });
  }
  function aggregateStudios(scenes) {
    var seen = new Set(), studios = new Map(), missingStudio = 0, missingSizes = 0;
    scenes.forEach(function (scene) {
      if (seen.has(scene.id)) return;
      seen.add(scene.id);
      if (!scene.studio || scene.studio.id == null || !String(scene.studio.name || "").trim()) { missingStudio++; return; }
      var id = String(scene.studio.id);
      if (!studios.has(id)) studios.set(id, { id: id, name: String(scene.studio.name), image: studioImageSource(scene.studio), scenes: 0, rated: 0, ratingSum: 0, bytes: 0 });
      var entry = studios.get(id);
      entry.scenes++;
      var rating = ratingNumber(scene);
      if (rating != null) { entry.rated++; entry.ratingSum += rating; }
      var files = new Set();
      (scene.files || []).forEach(function (file) {
        if (file.id != null) { if (files.has(file.id)) return; files.add(file.id); }
        var size = file.size == null || file.size === "" ? NaN : Number(file.size);
        if (!Number.isFinite(size) || size < 0) { missingSizes++; return; }
        entry.bytes += size;
      });
    });
    var points = Array.from(studios.values()).map(function (entry) {
      return { id: entry.id, name: entry.name, image: entry.image, scenes: entry.scenes, rated: entry.rated, unrated: entry.scenes - entry.rated, rating: entry.rated ? entry.ratingSum / entry.rated : null, bytes: entry.bytes };
    }).sort(function (a, b) { return b.scenes - a.scenes || a.name.localeCompare(b.name); });
    return { points: points, total: seen.size, studios: points.length, missingStudio: missingStudio, missingSizes: missingSizes, totalBytes: points.reduce(function (sum, point) { return sum + point.bytes; }, 0) };
  }
var BIRTHDAY_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var BIRTHDAY_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
  function birthdayDayLabel(month, day) {
    return BIRTHDAY_MONTHS[month - 1] + " " + day;
  }
  function BirthdayCalendar(props) {
    var entries = props.entries, year = props.year, selected = props.selected, nowMonth = props.nowMonth, nowDay = props.nowDay;
    return h("div", { className: "dirty-stats-calendar" },
      BIRTHDAY_MONTHS.map(function (name, index) {
        var month = index + 1;
        var counts = Object.create(null), monthTotal = 0;
        entries.forEach(function (entry) { if (entry.month === month) { counts[entry.day] = (counts[entry.day] || 0) + 1; monthTotal++; } });
        var startWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
        var daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        var cells = [];
        // A factory keeps each day's click bound to its own number; a bare
        // closure in the loop would capture the final loop value.
        var selectDay = function (targetDay) { return function () { props.onSelect(month, targetDay); }; };
        for (var blank = 0; blank < startWeekday; blank++) cells.push(h("span", { key: "blank-" + blank, className: "dirty-stats-calendar-blank" }));
        for (var day = 1; day <= daysInMonth; day++) {
          var count = counts[day] || 0;
          var isSelected = Boolean(selected && selected.month === month && selected.day === day);
          var classes = ["dirty-stats-calendar-day"];
          if (count) classes.push("has-birthday");
          if (month === nowMonth && day === nowDay) classes.push("today");
          if (isSelected) classes.push("selected");
          cells.push(h("button", {
            key: "day-" + day,
            type: "button",
            className: classes.join(" "),
            disabled: !count,
            "aria-pressed": isSelected,
            "aria-label": name + " " + day + (count ? ": " + count + " birthday" + (count === 1 ? "" : "s") : ": no birthdays"),
            onClick: count ? selectDay(day) : undefined
          }, String(day), count > 1 ? h("span", { className: "dirty-stats-calendar-count" }, count) : null));
        }
        return h("section", { key: name, className: "dirty-stats-calendar-month" + (month === nowMonth ? " is-current" : ""), "aria-label": name + (monthTotal ? ", " + monthTotal + " birthdays" : ", no birthdays") },
          h("h3", null, h("span", null, name), monthTotal ? h("span", { className: "dirty-stats-calendar-total" }, monthTotal) : null),
          h("div", { className: "dirty-stats-calendar-grid" },
            BIRTHDAY_WEEKDAYS.map(function (label, weekday) { return h("span", { key: "weekday-" + weekday, className: "dirty-stats-calendar-weekday", "aria-hidden": true }, label); }),
            cells));
      }));
  }
  function BirthdayPage(props) {
    var dataState = React.useState([]), performers = dataState[0], setPerformers = dataState[1];
    var loadingState = React.useState(true), loading = loadingState[0], setLoading = loadingState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var selectionState = React.useState(null), selected = selectionState[0], setSelected = selectionState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var nowState = React.useState(function () { return new Date(); }), now = nowState[0];
    var docsCapture = React.useMemo(function () { try { return new URLSearchParams(window.location.search).get("docsCapture") === "1"; } catch (err) { return false; } }, []);
    var queryKey = JSON.stringify(performerVariables(props.filter, 1));
    var stats = React.useMemo(function () { return aggregateBirthdays(performers, now); }, [performers, now]);
    var upcoming = React.useMemo(function () {
      return stats.entries.slice().sort(function (a, b) { return a.daysUntil - b.daysUntil || a.name.localeCompare(b.name); });
    }, [stats]);
    React.useEffect(function () { setSelected(null); }, [queryKey]);
    React.useEffect(function () {
      var controller = new AbortController();
      setLoading(true); setError("");
      (async function () {
        var result = [], page = 1, total;
        do {
          var data = await hub.graphql("query DirtyStatsBirthdays($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id name birthdate image_path}}}", performerVariables(props.filter, page), { signal: controller.signal });
          if (controller.signal.aborted) return;
          var batch = data.findPerformers; total = batch.count;
          if (!batch.performers.length && result.length < total) throw new Error("The performer list changed while loading. Refresh to try again.");
          result = result.concat(batch.performers); page++;
        } while (result.length < total);
        if (!controller.signal.aborted) { setPerformers(result); setLoading(false); }
      })().catch(function (err) { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
      return function () { controller.abort(); };
    }, [queryKey, refresh]);
    var nowMonth = now.getUTCMonth() + 1, nowDay = now.getUTCDate(), year = now.getUTCFullYear();
    var cardPerformers = React.useMemo(function () { return selected ? birthdayEntriesFor(stats.entries, selected.month, selected.day) : stats.entries; }, [stats, selected]);
    function choose(month, day) { setSelected(function (current) { return current && current.month === month && current.day === day ? null : { month: month, day: day }; }); }
    var monthCounts = React.useMemo(function () { return birthdayMonthCounts(stats.entries); }, [stats]);
    return h("section", { className: "dirty-stats-content" },
      h("div", { className: "dirty-stats-toolbar" }, h("span", { className: "dirty-stats-summary", role: "status" }, loading ? "Loading performers..." : stats.valid + " birthdays \u00b7 " + stats.upcoming + " in the next 30 days" + (stats.missing ? " \u00b7 " + stats.missing + " missing birthdate" : "")),
        h("button", { className: "btn btn-secondary dirty-ui-button", disabled: loading, onClick: function () { setRefresh(refresh + 1); } }, "Refresh")),
      error ? h("div", { className: "dirty-stats-alert", role: "alert" }, error, " Use Refresh to retry.") : null,
      !loading && !error && stats.valid ? h("section", { className: "dirty-stats-map-panel dirty-ui-panel", "aria-label": "Performer birthday calendar" },
        h("div", { className: "dirty-stats-map-controls" },
          h("span", { className: "dirty-stats-summary" }, "A year of birthdays (" + year + ")"),
          selected ? h("button", { className: "btn btn-secondary dirty-ui-button", onClick: function () { setSelected(null); } }, "Show all birthdays") : null),
        h("div", { className: "dirty-stats-birthday-next", role: "list", "aria-label": "Upcoming birthdays" },
          upcoming.slice(0, 5).map(function (entry) {
            return h("button", { key: entry.id, type: "button", role: "listitem", className: "dirty-stats-birthday-next-item", onClick: function () { choose(entry.month, entry.day); } },
              h("span", { className: "dirty-stats-birthday-next-photo" },
                !docsCapture && entry.image ? h("img", { src: entry.image, alt: "", loading: "lazy" }) : h("span", { className: "dirty-stats-birthday-next-initial", "aria-hidden": true }, (String(entry.name || "?").charAt(0) || "?").toUpperCase())),
              h("span", { className: "dirty-stats-birthday-next-text" },
                h("span", { className: "dirty-stats-birthday-next-name" }, entry.name),
                h("span", { className: "dirty-stats-birthday-next-date" }, birthdayDayLabel(entry.month, entry.day) + " \u00b7 " + (entry.daysUntil === 0 ? "today" : "in " + entry.daysUntil + " day" + (entry.daysUntil === 1 ? "" : "s")) + " \u00b7 turns " + entry.turns)));
          })),
        h(BirthdayCalendar, { entries: stats.entries, year: year, selected: selected, nowMonth: nowMonth, nowDay: nowDay, onSelect: choose })) : null,
      !loading && !error && !stats.total ? h("p", { role: "status" }, "No performers match these filters.") : null,
      !loading && !error && stats.total && !stats.valid ? h("p", { role: "status" }, "No matching performer has a valid full birthdate.") : null,
      !loading && !error ? h("div", { className: "dirty-stats-toolbar" }, h("span", { className: "dirty-stats-summary", role: "status" }, monthCounts.map(function (count, index) { return count ? BIRTHDAY_MONTHS[index].slice(0, 3) + " " + count : null; }).filter(Boolean).join(" \u00b7 "))) : null,
      h("p", null, "Each day shows how many matching performers have that birthday, across every year. Click a highlighted day to show those performers below; the panel marks today and lists the nearest birthdays first. Invalid or partial birthdates are excluded and reported."),
      !loading && !error ? h(PerformerCards, { performers: cardPerformers, filter: props.filter, title: selected ? "Birthdays on " + birthdayDayLabel(selected.month, selected.day) : "Performers with birthdays", selection: selected, clearSelection: function () { setSelected(null); }, clearLabel: "Show all birthdays" }) : null);
  }
  function RatingPage(props) {
    var performerMode = Boolean(props.performerMode), entity = performerMode ? "performers" : "scenes", title = performerMode ? "Performer ratings" : "Scene ratings";
    var variables = performerMode ? performerVariables : sceneVariables;
    var dataState = React.useState([]), scenes = dataState[0], setScenes = dataState[1];
    var loadingState = React.useState(true), loading = loadingState[0], setLoading = loadingState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var selectionState = React.useState(null), selected = selectionState[0], setSelected = selectionState[1];
    var roundingState = useStatsSetting(performerMode ? "performerRatingRounding" : "sceneRatingRounding"), rounding = roundingState[0], setRounding = roundingState[1];
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
          series: [{ type: "pie", radius: [0, "72%"], center: ["50%", "46%"], selectedMode: "single", label: { show: false }, labelLine: { show: false }, itemStyle: { borderColor: "#242b31", borderWidth: 2 }, data: stats.rows }] });
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
            h("select", { className: "form-control dirty-stats-statistic", value: rounding, onChange: function (event) { setRounding(Number(event.target.value)); setSelected(null); } },
              STATS_SETTING_SPECS.sceneRatingRounding.options.map(function (value) { return h("option", { key: String(value), value: value }, value === 0 ? "Exact" : value); }))),
          h("button", { className: "btn btn-secondary dirty-stats-export", onClick: function () { if (chartRef.current) download(chartRef.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#242b31" }), performerMode ? "DirtyStats-performer-ratings.png" : "DirtyStats-scene-ratings.png"); } }, "Export PNG")),
        h("div", { ref: node, className: "dirty-stats-growth-chart", role: "img", "aria-label": "Pie chart of distinct " + entity + " by rating out of ten, including unrated " + entity + "." })) : null,
      !loading && !error ? h(React.Fragment, null, selected != null ? h("p", { role: "status" }, selected === "Unrated" ? "Unrated " + entity : title + ": " + selected + "/10") : null, performerMode ? h(PerformerCards, { performers: matching, filter: props.filter }) : h(SceneCards, { scenes: matching, filter: props.filter })) : null);
  }
  function scatterSeriesData(stats, selected) {
    return stats.points.map(function (point) {
      var active = point.id === selected;
      return { id: point.id, name: point.name, value: [point.rating, point.scenes], itemStyle: { color: point.highlight ? "#f3c779" : "#54d5ca", opacity: .85, borderColor: active ? "#fff" : "transparent", borderWidth: active ? 2 : 0 } };
    });
  }
  function nearestScatterOption(options, value) {
    var best = options[0];
    for (var index = 1; index < options.length; index += 1) {
      if (Math.abs(options[index] - value) < Math.abs(best - value)) best = options[index];
    }
    return best;
  }
  function scatterGuideLines(minRating, maxScenes) {
    var lines = [];
    STATS_SETTING_SPECS.scatterMinRating.options.forEach(function (value) {
      if (value > 0) lines.push({ axis: "x", value: value, active: value === minRating });
    });
    STATS_SETTING_SPECS.scatterMaxScenes.options.forEach(function (value) {
      if (value > 0) lines.push({ axis: "y", value: value, active: value === maxScenes });
    });
    return lines;
  }
  function scatterGuideForClick(rect, pixel) {
    if (!rect || !pixel) return null;
    // The x-axis is horizontal at the bottom (rating) and the y-axis vertical
    // at the left (scenes); the nearer axis decides which guide to move.
    var distanceToXAxis = rect.y + rect.height - pixel[1];
    var distanceToYAxis = pixel[0] - rect.x;
    return distanceToXAxis <= distanceToYAxis ? "scatterMinRating" : "scatterMaxScenes";
  }
  function scatterClickHitsPoint(chart, points, pixel) {
    for (var index = 0; index < points.length; index += 1) {
      var pointPixel = chart.convertToPixel({ gridIndex: 0 }, [points[index].rating, points[index].scenes]);
      if (!pointPixel) continue;
      if (Math.abs(pointPixel[0] - pixel[0]) <= 7 && Math.abs(pointPixel[1] - pixel[1]) <= 7) return true;
    }
    return false;
  }
  function countRatingLabel(metric) {
    return metric === "o_counter" ? "O count" : "View count";
  }
  function countRatingSeriesData(stats, selected) {
    return stats.points.map(function (point) {
      var active = point.id === selected;
      return { id: point.id, title: point.title, value: [point.rating, point.count], itemStyle: { color: "#54d5ca", opacity: .85, borderColor: active ? "#fff" : "transparent", borderWidth: active ? 2 : 0 } };
    });
  }
  function aggregateCountRating(scenes, metric) {
    var seen = new Set(), points = [], missingRating = 0;
    scenes.forEach(function (scene) {
      var id = String(scene.id == null ? "" : scene.id);
      if (!id || seen.has(id)) return;
      seen.add(id);
      var rating = ratingNumber(scene);
      if (rating == null) { missingRating++; return; }
      var raw = metric === "o_counter" ? scene.o_counter : scene.play_count;
      var count = Number(raw);
      if (!Number.isFinite(count) || count < 0) count = 0;
      points.push({ id: id, title: String(scene.title || "Scene #" + id), rating: rating, count: count });
    });
    return { points: points, total: seen.size, missingRating: missingRating };
  }
  function PerformerScatterPage(props) {
    var dataState = React.useState([]), performers = dataState[0], setPerformers = dataState[1];
    var loadingState = React.useState(true), loading = loadingState[0], setLoading = loadingState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var selectionState = React.useState(null), selected = selectionState[0], setSelected = selectionState[1];
    var minState = useStatsSetting("scatterMinRating"), minRating = minState[0], setMinRating = minState[1];
    var maxState = useStatsSetting("scatterMaxScenes"), maxScenes = maxState[0], setMaxScenes = maxState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var node = React.useRef(null), chartRef = React.useRef(null);
    var queryKey = JSON.stringify(performerVariables(props.filter, 1));
    var stats = React.useMemo(function () { return aggregateScatter(performers, minRating, maxScenes); }, [performers, minRating, maxScenes]);
    React.useEffect(function () { setSelected(null); }, [queryKey, minRating, maxScenes]);
    React.useEffect(function () {
      var controller = new AbortController();
      setLoading(true); setError("");
      (async function () {
        var result = [], page = 1, total;
        do {
          var data = await hub.graphql("query DirtyStatsPerformerScatter($filter:FindFilterType!,$performerFilter:PerformerFilterType){findPerformers(filter:$filter,performer_filter:$performerFilter){count performers{id name rating100 scene_count}}}", performerVariables(props.filter, page), { signal: controller.signal });
          if (controller.signal.aborted) return;
          var batch = data.findPerformers; total = batch.count;
          if (!batch.performers.length && result.length < total) throw new Error("The performer list changed while loading. Refresh to try again.");
          result = result.concat(batch.performers); page++;
        } while (result.length < total);
        if (!controller.signal.aborted) { setPerformers(result); setLoading(false); }
      })().catch(function (err) { if (!controller.signal.aborted) { setError(err.message); setLoading(false); } });
      return function () { controller.abort(); };
    }, [queryKey, refresh]);
    React.useEffect(function () {
      if (loading || error || !node.current || !stats.points.length) return;
      var chart, observer;
      function resize() { if (chart && !chart.isDisposed()) chart.resize(); }
      try {
        if (!charts) throw new Error("The bundled chart library could not be loaded. Reload Stash.");
        chart = charts.init(node.current, null, { renderer: "canvas" }); chartRef.current = chart;
        chart.on("click", function (event) { if (event.componentType === "series" && event.data && event.data.id) setSelected(function (current) { return current === event.data.id ? null : event.data.id; }); });
        chart.getZr().on("click", function (event) {
          var pixel = [event.offsetX, event.offsetY];
          if (!stats.points.length || !chart.containPixel({ gridIndex: 0 }, pixel)) return;
          if (scatterClickHitsPoint(chart, stats.points, pixel)) return;
          var value = chart.convertFromPixel({ gridIndex: 0 }, pixel);
          if (!value || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) return;
          var rect = { x: 0, y: 0, width: chart.getWidth(), height: chart.getHeight() };
          try {
            var gridModel = chart.getModel().getComponent("grid");
            if (gridModel && gridModel.coordinateSystem) rect = gridModel.coordinateSystem.getRect();
          } catch (_error) { /* keep the container fallback */ }
          var guide = scatterGuideForClick(rect, pixel);
          if (guide === "scatterMinRating") {
            setMinRating(nearestScatterOption(STATS_SETTING_SPECS.scatterMinRating.options, value[0]));
          } else if (guide === "scatterMaxScenes") {
            setMaxScenes(nearestScatterOption(STATS_SETTING_SPECS.scatterMaxScenes.options, value[1]));
          }
        });
        chart.setOption({ backgroundColor: "#242b31", grid: { left: 12, right: 24, top: 22, bottom: 60, containLabel: true },
          tooltip: { trigger: "item", renderMode: "richText", formatter: function (p) { return p.data.name + "\nRating " + p.value[0] + "/10\n" + p.value[1] + " scene" + (p.value[1] === 1 ? "" : "s"); } },
          xAxis: { type: "value", name: "Rating (out of 10)", nameLocation: "middle", nameGap: 28, min: 0, max: 10, nameTextStyle: { color: "#bbb" }, axisLabel: { color: "#bbb" }, axisLine: { lineStyle: { color: "#788591" } }, splitLine: { lineStyle: { color: "#364655" } } },
          yAxis: { type: "value", name: "Scenes", nameLocation: "middle", nameGap: 45, min: 0, minInterval: 1, max: function (value) { return maxScenes > 0 ? Math.max(value.max, maxScenes) : value.max; }, nameTextStyle: { color: "#bbb" }, axisLabel: { color: "#bbb" }, splitLine: { lineStyle: { color: "#364655" } } },
          series: [{ type: "scatter", symbolSize: 9, progressive: 4000, data: scatterSeriesData(stats, selected),
            markLine: { silent: true, symbol: "none", label: { color: "#ddd", fontSize: 10 }, lineStyle: { color: "#f3c779", type: "dashed" }, data: scatterGuideLines(minRating, maxScenes).filter(function (guide) { return guide.active; }).map(function (guide) {
              return guide.axis === "x" ? { xAxis: guide.value, label: { formatter: "Rating " + guide.value + "+" } } : { yAxis: guide.value, label: { formatter: guide.value + " scenes" } };
            }) } }] });
        setChartError("");
        if (typeof ResizeObserver === "function") { observer = new ResizeObserver(resize); observer.observe(node.current); }
        window.addEventListener("resize", resize);
      } catch (err) { setChartError(err.message); }
      return function () { if (observer) observer.disconnect(); window.removeEventListener("resize", resize); if (chart) chart.dispose(); chartRef.current = null; };
    }, [stats, loading, error]);
    React.useEffect(function () { if (chartRef.current) chartRef.current.setOption({ series: [{ data: scatterSeriesData(stats, selected) }] }); }, [selected, stats, loading, error]);
    var matching = React.useMemo(function () { return selected == null ? stats.points : stats.points.filter(function (point) { return point.id === selected; }); }, [stats, selected]);
    return h("section", { className: "dirty-stats-content" },
      h("div", { className: "dirty-stats-toolbar" }, h("span", { className: "dirty-stats-summary", role: "status" }, loading ? "Loading performers..." : stats.points.length + " rated performers \u00b7 " + stats.highlights + " high rating, few scenes"),
        h("button", { className: "btn btn-secondary dirty-ui-button", disabled: loading, onClick: function () { setRefresh(refresh + 1); } }, "Refresh")),
      error ? h("div", { className: "dirty-stats-alert", role: "alert" }, error, " Use Refresh to retry.") : null,
      !loading && !error && stats.points.length ? h("section", { className: "dirty-stats-map-panel dirty-ui-panel", "aria-label": "Performer rating versus scene count" },
        h("div", { className: "dirty-stats-map-controls" },
          selected != null ? h("button", { className: "btn btn-secondary dirty-ui-button", onClick: function () { setSelected(null); } }, "Show all performers") : null,
          h("label", { className: "dirty-stats-date-basis" }, "Minimum rating",
            h("select", { className: "form-control dirty-stats-statistic", value: minRating, onChange: function (event) { setMinRating(Number(event.target.value)); } },
              STATS_SETTING_SPECS.scatterMinRating.options.map(function (value) { return h("option", { key: value, value: value }, value ? value + "+" : "Any"); }))),
          h("label", { className: "dirty-stats-date-basis" }, "Maximum scenes",
            h("select", { className: "form-control dirty-stats-statistic", value: maxScenes, onChange: function (event) { setMaxScenes(Number(event.target.value)); } },
              STATS_SETTING_SPECS.scatterMaxScenes.options.map(function (value) { return h("option", { key: value, value: value }, value ? value : "Any"); }))),
          h("button", { className: "btn btn-secondary dirty-ui-button dirty-stats-export", disabled: loading || Boolean(error) || Boolean(chartError), onClick: function () { if (chartRef.current) download(chartRef.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#242b31" }), "DirtyStats-rating-vs-scenes.png"); } }, "Export PNG")),
        h("div", { ref: node, className: "dirty-stats-growth-chart", role: "img", "aria-label": "Scatter plot of performer rating out of ten versus number of scenes. Highlighted points have a high rating and few scenes." })) : null,
      chartError ? h("div", { className: "dirty-stats-alert", role: "alert" }, chartError) : null,
      !loading && !error && !stats.points.length ? h("p", { role: "status" }, "No rated performers match these filters.") : null,
      h("p", null, "Each dot is a distinct performer: rating out of ten on the x-axis and scene count on the y-axis. The upper-left corner holds promising performers with a high rating and few scenes; highlighted dots meet both limits. Click a dot to show that performer below. Click empty space near the bottom (rating axis) to set the minimum rating, or near the left (scenes axis) to set the maximum scenes."),
      !loading && !error && (stats.missingRating || stats.missingScenes) ? h("p", { role: "status" }, stats.missingRating + " performers without a rating and " + stats.missingScenes + " with an unavailable scene count were omitted.") : null,
      !loading && !error ? h(PerformerCards, { performers: matching, filter: props.filter, title: selected == null ? "Performers" : "Selected performer", selection: selected, clearSelection: function () { setSelected(null); }, clearLabel: "Show all performers" }) : null);
  }
  function CountRatingPage(props) {
    var dataState = React.useState([]), scenes = dataState[0], setScenes = dataState[1];
    var loadingState = React.useState(true), loading = loadingState[0], setLoading = loadingState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var selectionState = React.useState(null), selected = selectionState[0], setSelected = selectionState[1];
    var metricState = useStatsSetting("countRatingMetric"), metric = metricState[0], setMetric = metricState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var node = React.useRef(null), chartRef = React.useRef(null);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var stats = React.useMemo(function () { return aggregateCountRating(scenes, metric); }, [scenes, metric]);
    React.useEffect(function () { setSelected(null); }, [queryKey, metric]);
    React.useEffect(function () {
      var controller = new AbortController();
      setLoading(true); setError("");
      (async function () {
        var result = [], page = 1, total;
        do {
          var data = await hub.graphql("query DirtyStatsCountRating($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id title rating100 play_count o_counter}}}", sceneVariables(props.filter, page), { signal: controller.signal });
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
      if (loading || error || !node.current || !stats.points.length) return;
      var chart, observer;
      function resize() { if (chart && !chart.isDisposed()) chart.resize(); }
      try {
        if (!charts) throw new Error("The bundled chart library could not be loaded. Reload Stash.");
        chart = charts.init(node.current, null, { renderer: "canvas" }); chartRef.current = chart;
        chart.on("click", function (event) { if (event.componentType === "series" && event.data && event.data.id) setSelected(function (current) { return current === event.data.id ? null : event.data.id; }); });
        chart.setOption({ backgroundColor: "#242b31", grid: { left: 12, right: 24, top: 22, bottom: 60, containLabel: true },
          tooltip: { trigger: "item", renderMode: "richText", formatter: function (p) { return p.data.title + "\nScene rating " + p.value[0] + "/10\n" + p.value[1] + " " + countRatingLabel(metric).toLowerCase(); } },
          xAxis: { type: "value", name: "Scene rating (out of 10)", nameLocation: "middle", nameGap: 28, min: 0, max: 10, nameTextStyle: { color: "#bbb" }, axisLabel: { color: "#bbb" }, axisLine: { lineStyle: { color: "#788591" } }, splitLine: { lineStyle: { color: "#364655" } } },
          yAxis: { type: "value", name: countRatingLabel(metric), nameLocation: "middle", nameGap: 45, min: 0, minInterval: 1, nameTextStyle: { color: "#bbb" }, axisLabel: { color: "#bbb" }, splitLine: { lineStyle: { color: "#364655" } } },
          series: [{ type: "scatter", symbolSize: 9, progressive: 4000, data: countRatingSeriesData(stats, selected), emphasis: { itemStyle: { borderColor: "#fff", borderWidth: 2 } } }] });
        setChartError("");
        if (typeof ResizeObserver === "function") { observer = new ResizeObserver(resize); observer.observe(node.current); }
        window.addEventListener("resize", resize);
      } catch (err) { setChartError(err.message); }
      return function () { if (observer) observer.disconnect(); window.removeEventListener("resize", resize); if (chart) chart.dispose(); chartRef.current = null; };
    }, [stats, metric, loading, error]);
    React.useEffect(function () { if (chartRef.current) chartRef.current.setOption({ series: [{ data: countRatingSeriesData(stats, selected) }] }); }, [selected, stats, metric, loading, error]);
    var matching = React.useMemo(function () { return selected == null ? scenes : scenes.filter(function (scene) { return String(scene.id) === selected; }); }, [scenes, selected]);
    return h("section", { className: "dirty-stats-content" },
      h("div", { className: "dirty-stats-toolbar" }, h("span", { className: "dirty-stats-summary", role: "status" }, loading ? "Loading scenes..." : stats.points.length + " rated scenes"), h("button", { className: "btn btn-secondary dirty-ui-button", disabled: loading, onClick: function () { setRefresh(refresh + 1); } }, "Refresh")),
      error ? h("div", { className: "dirty-stats-alert", role: "alert" }, error, " Use Refresh to retry.") : null,
      !loading && !error && stats.points.length ? h("section", { className: "dirty-stats-map-panel dirty-ui-panel", "aria-label": "Scene rating versus " + countRatingLabel(metric).toLowerCase() },
        h("div", { className: "dirty-stats-map-controls" },
          selected != null ? h("button", { className: "btn btn-secondary dirty-ui-button", onClick: function () { setSelected(null); } }, "Show all scenes") : null,
          h("label", { className: "dirty-stats-date-basis" }, "Count",
            h("select", { className: "form-control dirty-stats-statistic", value: metric, onChange: function (event) { setMetric(event.target.value); } },
              STATS_SETTING_SPECS.countRatingMetric.options.map(function (value) { return h("option", { key: value, value: value }, countRatingLabel(value)); }))),
          h("button", { className: "btn btn-secondary dirty-ui-button dirty-stats-export", disabled: loading || Boolean(error) || Boolean(chartError), onClick: function () { if (chartRef.current) download(chartRef.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#242b31" }), "DirtyStats-" + metric + "-vs-scene-rating.png"); } }, "Export PNG")),
        h("div", { ref: node, className: "dirty-stats-growth-chart", role: "img", "aria-label": "Scatter plot of scene rating out of ten versus scene " + countRatingLabel(metric).toLowerCase() + "." })) : null,
      chartError ? h("div", { className: "dirty-stats-alert", role: "alert" }, chartError) : null,
      !loading && !error && !stats.points.length ? h("p", { role: "status" }, "No rated scenes match these filters.") : null,
      h("p", null, "Each dot is a distinct scene: scene rating out of ten on the x-axis and " + countRatingLabel(metric).toLowerCase() + " on the y-axis. Use Count to switch between the scene's view count and its O count. Click a dot to show that scene below."),
      !loading && !error && stats.missingRating ? h("p", { role: "status" }, stats.missingRating + " scenes without a rating were omitted.") : null,
      !loading && !error ? h(SceneCards, { scenes: matching, filter: props.filter, title: selected == null ? "Scenes" : "Selected scene", selection: selected, clearSelection: function () { setSelected(null); }, clearLabel: "Show all scenes" }) : null);
  }
  function StudioValuePage(props) {
    var dataState = React.useState([]), scenes = dataState[0], setScenes = dataState[1];
    var loadingState = React.useState(true), loading = loadingState[0], setLoading = loadingState[1];
    var errorState = React.useState(""), error = errorState[0], setError = errorState[1];
    var chartErrorState = React.useState(""), chartError = chartErrorState[0], setChartError = chartErrorState[1];
    var refreshState = React.useState(0), refresh = refreshState[0], setRefresh = refreshState[1];
    var minState = useStatsSetting("studioMinScenes"), minScenes = minState[0], setMinScenes = minState[1];
    var selectionState = React.useState(null), selected = selectionState[0], setSelected = selectionState[1];
    var logoState = React.useState(0), logoVersion = logoState[0], setLogoVersion = logoState[1];
    var docsCapture = React.useMemo(function () { try { return new URLSearchParams(window.location.search).get("docsCapture") === "1"; } catch (err) { return false; } }, []);
    var node = React.useRef(null), chartRef = React.useRef(null);
    var queryKey = JSON.stringify(sceneVariables(props.filter, 1));
    var stats = React.useMemo(function () { return aggregateStudios(scenes); }, [scenes]);
    var points = React.useMemo(function () { return stats.points.filter(function (point) { return point.rating != null && point.scenes >= minScenes; }); }, [stats, minScenes]);
    var maxBytes = React.useMemo(function () { return points.reduce(function (max, point) { return Math.max(max, point.bytes); }, 0); }, [points]);
    var selectedStudio = React.useMemo(function () { return selected == null ? null : stats.points.find(function (point) { return point.id === selected; }); }, [stats, selected]);
    var matching = React.useMemo(function () { return selected == null ? scenes : scenes.filter(function (scene) { return scene.studio && String(scene.studio.id) === selected; }); }, [scenes, selected]);
    React.useEffect(function () { setSelected(null); }, [queryKey, minScenes]);
    React.useEffect(function () {
      var controller = new AbortController();
      setLoading(true); setError("");
      (async function () {
        var result = [], page = 1, total;
        do {
          var data = await hub.graphql("query DirtyStatsStudios($filter:FindFilterType!,$sceneFilter:SceneFilterType){findScenes(filter:$filter,scene_filter:$sceneFilter){count scenes{id rating100 studio{id name image_path} files{id size}}}}", sceneVariables(props.filter, page), { signal: controller.signal });
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
      if (loading || error || docsCapture || !points.length) return;
      var active = true;
      var paths = points.map(function (point) { return point.image; }).filter(Boolean);
      if (!paths.length) return;
      Promise.all(paths.map(loadStudioImage)).then(function () {
        if (active) setLogoVersion(function (version) { return version + 1; });
      });
      return function () { active = false; };
    }, [points, loading, error, docsCapture]);
    React.useEffect(function () {
      if (loading || error || !node.current || !points.length) return;
      var chart, observer;
      function resize() { if (chart && !chart.isDisposed()) chart.resize(); }
      try {
        if (!charts) throw new Error("The bundled chart library could not be loaded. Reload Stash.");
        chart = charts.init(node.current, null, { renderer: "canvas" }); chartRef.current = chart;
        chart.on("click", function (event) { if (event.componentType === "series" && event.data && event.data.id) setSelected(function (current) { return current === event.data.id ? null : event.data.id; }); });
        chart.setOption({ backgroundColor: "#242b31", grid: { left: 12, right: 24, top: 22, bottom: 60, containLabel: true },
          tooltip: { trigger: "item", renderMode: "richText", formatter: function (p) { return p.data.name + "\n" + p.value[0] + " scene" + (p.value[0] === 1 ? "" : "s") + "\nAverage rating " + p.value[1].toFixed(1) + "/10\n" + formatBytes(p.data.bytes) + (p.data.unrated ? "\n" + p.data.unrated + " unrated" : ""); } },
          xAxis: { type: "value", name: "Scenes", nameLocation: "middle", nameGap: 28, min: 0, minInterval: 1, nameTextStyle: { color: "#bbb" }, axisLabel: { color: "#bbb" }, axisLine: { lineStyle: { color: "#788591" } }, splitLine: { lineStyle: { color: "#364655" } } },
          yAxis: { type: "value", name: "Average rating (out of 10)", nameLocation: "middle", nameGap: 45, min: 0, max: 10, nameTextStyle: { color: "#bbb" }, axisLabel: { color: "#bbb" }, splitLine: { lineStyle: { color: "#364655" } } },
          series: [{ type: "scatter", data: studioSeriesData(points, maxBytes, selected), emphasis: { itemStyle: { borderColor: "#fff", borderWidth: 2 } } }] });
        setChartError("");
        if (typeof ResizeObserver === "function") { observer = new ResizeObserver(resize); observer.observe(node.current); }
        window.addEventListener("resize", resize);
      } catch (err) { setChartError(err.message); }
      return function () { if (observer) observer.disconnect(); window.removeEventListener("resize", resize); if (chart) chart.dispose(); chartRef.current = null; };
    }, [points, maxBytes, loading, error, logoVersion]);
    React.useEffect(function () { if (chartRef.current) chartRef.current.setOption({ series: [{ data: studioSeriesData(points, maxBytes, selected) }] }); }, [selected, points, maxBytes, loading, error, logoVersion]);
    var unratedStudios = stats.points.filter(function (point) { return point.rating == null; }).length;
    return h("section", { className: "dirty-stats-content" },
      h("div", { className: "dirty-stats-toolbar" }, h("span", { className: "dirty-stats-summary", role: "status" }, loading ? "Loading scenes..." : points.length + " studios \u00b7 " + stats.total + " matching scenes \u00b7 " + formatBytes(stats.totalBytes)),
        h("button", { className: "btn btn-secondary dirty-ui-button", disabled: loading, onClick: function () { setRefresh(refresh + 1); } }, "Refresh")),
      error ? h("div", { className: "dirty-stats-alert", role: "alert" }, error, " Use Refresh to retry.") : null,
      !loading && !error && points.length ? h("section", { className: "dirty-stats-map-panel dirty-ui-panel", "aria-label": "Studio scene count versus average rating" },
        h("div", { className: "dirty-stats-map-controls" },
          selected != null ? h("button", { className: "btn btn-secondary dirty-ui-button", onClick: function () { setSelected(null); } }, "Show all scenes") : null,
          h("label", { className: "dirty-stats-date-basis" }, "Minimum scenes",
            h("select", { className: "form-control dirty-stats-statistic", value: minScenes, onChange: function (event) { setMinScenes(Number(event.target.value)); } },
              STATS_SETTING_SPECS.studioMinScenes.options.map(function (value) { return h("option", { key: value, value: value }, value === 1 ? "All" : value); }))),
          h("button", { className: "btn btn-secondary dirty-ui-button dirty-stats-export", disabled: loading || Boolean(error) || Boolean(chartError), onClick: function () { if (chartRef.current) download(chartRef.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#242b31" }), "DirtyStats-studio-value.png"); } }, "Export PNG")),
        h("div", { ref: node, className: "dirty-stats-growth-chart", role: "img", "aria-label": "Scatter plot of studio scene count versus average scene rating. Bubble size represents total file size." })) : null,
      chartError ? h("div", { className: "dirty-stats-alert", role: "alert" }, chartError) : null,
      !loading && !error && !points.length ? h("p", { role: "status" }, "No rated studios match these filters.") : null,
      h("p", null, "Each bubble is a studio: scene count on the x-axis, average scene rating out of ten on the y-axis, and bubble size representing total file size. Highly rated studios with few scenes appear near the upper left. Click a bubble to show that studio's scenes below."),
      !loading && !error && (stats.missingStudio || unratedStudios || stats.missingSizes) ? h("p", { role: "status" }, stats.missingStudio + " scenes without a studio, " + unratedStudios + " studios without a rated scene and " + stats.missingSizes + " files with an unavailable size were omitted.") : null,
      !loading && !error ? h(SceneCards, { scenes: matching, filter: props.filter, title: selectedStudio ? "Scenes by " + selectedStudio.name : "Scenes", selection: selected, clearSelection: function () { setSelected(null); }, clearLabel: "Show all scenes" }) : null);
  }
  function DirtyStatsRoute() {
    var page = React.useRef(null);
    var location = api.libraries.ReactRouterDOM.useLocation();
    var statistic = location.pathname === performerScatterRoute ? "performerScatter" : location.pathname === countRatingRoute ? "countRating" : location.pathname === studioRoute ? "studios" : location.pathname === constellationRoute ? "constellation" : location.pathname === birthdayRoute ? "birthdays" : location.pathname === performerRatingRoute ? "performerRatings" : location.pathname === ratingRoute ? "ratings" : location.pathname === ageRoute ? "ages" : location.pathname === growthRoute ? "growth" : "origin";
    var sceneView = statistic !== "origin" && statistic !== "performerRatings" && statistic !== "performerScatter" && statistic !== "birthdays";
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
    if (window.location.pathname === performerScatterRoute && props && props.extraCriteria && props.extraCriteria.dirtyStats) return h(PerformerScatterPage, { filter: props.filter });
    if (window.location.pathname === birthdayRoute && props && props.extraCriteria && props.extraCriteria.dirtyStats) return h(BirthdayPage, { filter: props.filter });
    if (window.location.pathname !== route || !props || !props.extraCriteria || !props.extraCriteria.dirtyStats) return next.apply(null, args);
    return h(StatsPage, { filter: props.filter });
  });
  api.patch.instead("SceneList", function () {
    var args = Array.prototype.slice.call(arguments), next = args.pop(), props = args[0];
    var pages = {};
    pages[constellationRoute] = ConstellationPage;
    pages[ratingRoute] = RatingPage;
    pages[ageRoute] = AgePage;
    pages[growthRoute] = GrowthPage;
    pages[studioRoute] = StudioValuePage;
    pages[countRatingRoute] = CountRatingPage;
    var PageComponent = pages[window.location.pathname];
    if (!PageComponent || !props || !props.filter) return next.apply(null, args);
    return h(PageComponent, { filter: props.filter });
  });
  api.patch.before("MainNavBar.UtilityItems", function (props) { return [{ children: h(React.Fragment, null, props.children, h(NavIcon)) }]; });
  loadStatsSettings();
  window.__dirtyStatsPlugin = { route: route, algorithms: { constellationLayout: constellationLayout, constellationGender: constellationGender, aggregateConstellation: aggregateConstellation, constellationScenes: constellationScenes, aggregateRatings: aggregateRatings, sceneRating: sceneRating, roundRating: roundRating, forecastGrowth: forecastGrowth, filterAgeScenes: filterAgeScenes, performersAtAge: performersAtAge, ageAtScene: ageAtScene, aggregateAges: aggregateAges, birthdayInYear: birthdayInYear, daysUntilBirthday: daysUntilBirthday, aggregateBirthdays: aggregateBirthdays, performerImageSource: performerImageSource, birthdayEntriesFor: birthdayEntriesFor, birthdayMonthCounts: birthdayMonthCounts, birthdayDayLabel: birthdayDayLabel, scenesInPeriod: scenesInPeriod, periodGrowth: periodGrowth, orderedCards: orderedCards, sceneVariables: sceneVariables, aggregateGrowth: aggregateGrowth, formatBytes: formatBytes, normalize: normalize, countryIndex: countryIndex, countryName: countryName, performerVariables: performerVariables, aggregate: aggregate, countryPerformers: countryPerformers, eckertIV: eckertIV, aggregateScatter: aggregateScatter, scatterSeriesData: scatterSeriesData, nearestScatterOption: nearestScatterOption, scatterGuideForClick: scatterGuideForClick, scatterGuideLines: scatterGuideLines, countRatingLabel: countRatingLabel, countRatingSeriesData: countRatingSeriesData, aggregateCountRating: aggregateCountRating, aggregateStudios: aggregateStudios, statsSettings: statsSettings, parseStatsSetting: parseStatsSetting, statsSettingsFromStorage: statsSettingsFromStorage, setStatsSetting: setStatsSetting, loadStatsSettings: loadStatsSettings } };
  debugLog("dirtyStats", "script finished registering", {
    elapsedMs: hub.debugElapsed ? hub.debugElapsed() : null,
  });
  window.__dirtyCurrentPluginId = null;
})();
