import type { SaveController } from "../../DirtyPlugins/src/save";
import type { Runtime } from "./runtime";
import type { SettingValue, StatsSettings, StatsTheme } from "./types";
interface SaveRequest { names: string[]; snapshot: Record<string, unknown> }
export function createSettings(runtime: Runtime) {
  const { React, hub } = runtime;
  let disposed = false, loadGeneration = 0;
  var PLUGIN_ID = "dirtyStats";
  var DEFAULT_THEME = hub.theme.defaultKey;
  var STATS_SETTING_SPECS = {
    visualTheme: { options: ["classic", "candy", "tropical", "arcade", "paper", "destijl", "destijl-dark"] },
    showMapNumbers: { options: [false, true] },
    sceneRatingRounding: { options: [0, 0.5, 1] },
    performerRatingRounding: { options: [0, 0.5, 1] },
    growthDateBasis: { options: ["created_at", "mod_time", "scene_date"] },
    growthGrouping: { options: ["day", "month", "year"] },
    growthShowForecast: { options: [false, true] },
    growthShowCapacity: { options: [false, true] },
    constellationMaxPerformers: { options: [0, 50, 100, 200, 500, 1000] },
    constellationMinShared: { options: [1, 2, 3, 5, 10] },
    scatterMinRating: { options: [0, 5, 6, 7, 8, 9] },
    scatterMaxScenes: { options: [0, 5, 10, 20, 50, 100] },
    countRatingMetric: { options: ["play_count", "o_counter"] },
    studioMinScenes: { options: [1, 2, 5, 10, 20] },
    tagDnaColorMetric: { options: ["rating", "play_count"] },
    tagDnaMaxTags: { options: [0, 25, 50, 100, 200] }
  };
  var statsSettings: StatsSettings = {
    visualTheme: hub.theme.currentKey,
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
    studioMinScenes: 1,
    tagDnaColorMetric: "rating",
    tagDnaMaxTags: 50
  };
  var statsSettingsListeners = new Set<() => void>();
  var statsSettingsRevision = 0;
  var statsSettingsSaveController: SaveController<SaveRequest, Awaited<ReturnType<Runtime["hub"]["configurePlugin"]>>> | null = null;
  var statsSettingsDirtyNames = new Set<string>();
  var statsSettingsExtras: Record<string, unknown> = {};
  var statsSettingsEditRevision = 0;
  var statsSettingsSaveStatus = { state: "", message: "" };
  var statsSaveStatusListeners = new Set<() => void>();
  var statsSaveStatusRevision = 0;
  var STATS_THEMES: Record<string, StatsTheme> = {
    classic: {
      key: "classic", label: "Midnight", background: "#242b31", panel: "#2c343b", panelAlt: "#303941",
      primary: "#54d5ca", secondary: "#5687a2", accent: "#f3c779", highlight: "#bc8542",
      text: "#eeeeee", muted: "#bbbbbb", grid: "#364655", border: "#788591", selection: "#fff",
      soft: "rgba(84, 213, 202, .20)", softer: "rgba(84, 213, 202, .08)", tagLow: [54, 70, 85], tagHigh: [243, 199, 121],
      palette: ["#54d5ca", "#5687a2", "#f3c779", "#bc8542", "#8eb8f5", "#f29aaa", "#d9a6e8", "#aeb8c2"]
    },
    candy: {
      key: "candy", label: "Candy Pop", background: "#32243d", panel: "#432c50", panelAlt: "#51355e",
      primary: "#ff82cb", secondary: "#7ee7e7", accent: "#ffd166", highlight: "#b894ff",
      text: "#fff5fc", muted: "#dbc5dd", grid: "#62456b", border: "#9f78a7", selection: "#ffffff",
      soft: "rgba(255, 130, 203, .22)", softer: "rgba(255, 130, 203, .10)", tagLow: [98, 69, 107], tagHigh: [255, 209, 102],
      palette: ["#ff82cb", "#7ee7e7", "#ffd166", "#b894ff", "#ff9f68", "#82e6a8", "#ff8fab", "#9eb5ff"]
    },
    tropical: {
      key: "tropical", label: "Tropical Punch", background: "#173f43", panel: "#20545a", panelAlt: "#286269",
      primary: "#65e8ca", secondary: "#49a9d8", accent: "#ffd166", highlight: "#ff7f6e",
      text: "#fff9e8", muted: "#c5ddd5", grid: "#356f71", border: "#72a59d", selection: "#ffffff",
      soft: "rgba(101, 232, 202, .22)", softer: "rgba(101, 232, 202, .10)", tagLow: [53, 111, 113], tagHigh: [255, 127, 110],
      palette: ["#65e8ca", "#ff7f6e", "#ffd166", "#49a9d8", "#f78fb3", "#8dd17e", "#f29e4c", "#8c9eff"]
    },
    arcade: {
      key: "arcade", label: "Retro Arcade", background: "#171128", panel: "#25183c", panelAlt: "#2d1d49",
      primary: "#2de2e6", secondary: "#8b5cf6", accent: "#f9f871", highlight: "#ff3864",
      text: "#f7f0ff", muted: "#b8a9cf", grid: "#493467", border: "#78619b", selection: "#ffffff",
      soft: "rgba(45, 226, 230, .22)", softer: "rgba(45, 226, 230, .09)", tagLow: [73, 52, 103], tagHigh: [249, 248, 113],
      palette: ["#2de2e6", "#ff3864", "#f9f871", "#8b5cf6", "#ff7edb", "#62ff91", "#ff9f1c", "#4d8cff"]
    },
    paper: {
      key: "paper", label: "Paper Picnic", background: "#fff4dc", panel: "#fffaf0", panelAlt: "#f7e7c1",
      primary: "#0b7274", secondary: "#5c7cba", accent: "#f2b134", highlight: "#e76f51",
      text: "#3b3440", muted: "#706474", grid: "#e0cfaa", border: "#b9a986", selection: "#3b3440",
      soft: "rgba(11, 114, 116, .18)", softer: "rgba(11, 114, 116, .08)", tagLow: [224, 207, 170], tagHigh: [231, 111, 81],
      palette: ["#0b7274", "#e76f51", "#f2b134", "#5c7cba", "#9b6aa2", "#6a994e", "#d76d93", "#657786"]
    },
    destijl: {
      key: "destijl", label: "De Stijl", background: "#dcdcdc", panel: "#eeeeee", panelAlt: "#dcdcdc",
      primary: "#24577f", secondary: "#5b9acf", accent: "#dc5e5f", highlight: "#973637",
      text: "#282828", muted: "#515151", grid: "#b8b8b8", border: "#282828", selection: "#282828",
      soft: "rgba(91, 154, 207, .20)", softer: "rgba(91, 154, 207, .08)", tagLow: [220, 220, 220], tagHigh: [220, 94, 95],
      palette: ["#5b9acf", "#dc5e5f", "#282828", "#24577f", "#973637", "#8a8a8a", "#87b5da", "#e68c8d"]
    },
    "destijl-dark": {
      key: "destijl-dark", label: "De Stijl Dark", background: "#202020", panel: "#282828", panelAlt: "#303030",
      primary: "#87b5da", secondary: "#5b9acf", accent: "#dc5e5f", highlight: "#ee9293",
      text: "#dcdcdc", muted: "#b8b8b8", grid: "#454545", border: "#7b7b7b", selection: "#dcdcdc",
      soft: "rgba(91, 154, 207, .20)", softer: "rgba(91, 154, 207, .08)", tagLow: [69, 69, 69], tagHigh: [220, 94, 95],
      palette: ["#5b9acf", "#dc5e5f", "#dcdcdc", "#87b5da", "#ee9293", "#8a8a8a", "#a4c8e4", "#b8b8b8"]
    }
  };
  function statsTheme(value?: string) {
    return STATS_THEMES[value || statsSettings.visualTheme] || STATS_THEMES[DEFAULT_THEME] || STATS_THEMES.classic;
  }

  function themeColor(name: string): string {
    var propertyNames: Record<string, string> = {
      background: "--dirty-stats-bg", panel: "--dirty-stats-panel", panelAlt: "--dirty-stats-panel-alt",
      primary: "--dirty-stats-primary", secondary: "--dirty-stats-secondary", accent: "--dirty-stats-accent",
      highlight: "--dirty-stats-highlight", text: "--dirty-stats-text", muted: "--dirty-stats-muted",
      grid: "--dirty-stats-grid", border: "--dirty-stats-border", selection: "--dirty-stats-selection",
      soft: "--dirty-stats-soft", softer: "--dirty-stats-softer"
    };
    var page = typeof document !== "undefined" && document.querySelector ? document.querySelector(".dirty-stats-page") : null;
    var readRole = hub.theme.readRole;
    return page && propertyNames[name] ? readRole(page, propertyNames[name]) || statsTheme()[name as keyof StatsTheme] as string : statsTheme()[name as keyof StatsTheme] as string;
  }

  function themePalette() {
    return statsTheme().palette.slice();
  }

  function statsThemeClass(value?: string) {
    return "dirty-stats-theme-" + statsTheme(value).key;
  }

  function parseStatsSetting(name: string, value: unknown) {
    var spec = (STATS_SETTING_SPECS as Record<string, { options: SettingValue[] }>)[name];
    if (!spec) return null;
    for (var index = 0;index < spec.options.length;index += 1) {
      if (spec.options[index] === value) return spec.options[index];
    }
    for (var stringIndex = 0;stringIndex < spec.options.length;stringIndex += 1) {
      if (String(spec.options[stringIndex]) === String(value)) return spec.options[stringIndex];
    }
    return null;
  }

  function notifyStatsSettings() {
    statsSettingsRevision += 1;
    statsSettingsListeners.forEach(function (listener) { listener(); });
  }

  function syncSuiteTheme(key: string) {
    var next = hub.theme.normalizeKey(key);
    if (!next || statsSettings.visualTheme === next) return;
    statsSettings.visualTheme = next;
    notifyStatsSettings();
  }

  function setStatsSettingsSaveStatus(state: string, message: string) {
    statsSettingsSaveStatus = { state: state, message: message };
    statsSaveStatusRevision += 1;
    statsSaveStatusListeners.forEach(function (listener) { listener(); });
  }

  function scheduleStatsSettingsSave() {
    if (!statsSettingsSaveController) statsSettingsSaveController = hub.createSaveController({
      delay: 400,
      save: function (request) {
        request.names.forEach(function (name) {
          var current = Object.prototype.hasOwnProperty.call(statsSettings, name) ? statsSettings[name] : statsSettingsExtras[name];
          if (current === request.snapshot[name]) statsSettingsDirtyNames.delete(name);
        });
        return hub.configurePlugin(PLUGIN_ID, request.snapshot).catch(function () {
          // Reload and merge only this tab's changed keys on a revision conflict.
          return hub.getPluginSettings(PLUGIN_ID).then(function (latest) {
            var merged = Object.assign({}, latest || {});
            request.names.forEach(function (name) { merged[name] = request.snapshot[name]; });
            return hub.configurePlugin(PLUGIN_ID, merged);
          });
        });
      },
      onError: function (error, request) {
        request.names.forEach(function (name) { statsSettingsDirtyNames.add(name); });
        console.warn("DirtyStats could not save its settings", error);
        hub.ui.notify("DirtyStats settings could not be saved. Retry or reload this page.", { tone: "error" });
      },
      onStatus: function (value) {
        var message = value.state === "pending" ? "Unsaved settings."
          : value.state === "saving" ? "Saving settings…"
            : value.state === "saved" ? "Settings saved."
              : "Could not save settings. Retry or reload this page.";
        setStatsSettingsSaveStatus(value.state, message);
      },
    });
    statsSettingsSaveController.schedule({ names: Array.from(statsSettingsDirtyNames), snapshot: Object.assign({}, statsSettingsExtras, statsSettings) });
  }

  function setStatsSetting(name: string, value: unknown) {
    var next = parseStatsSetting(name, value);
    if (next === null || statsSettings[name] === next) return;
    statsSettings[name] = next;
    statsSettingsDirtyNames.add(name);
    statsSettingsEditRevision += 1;
    notifyStatsSettings();
    setStatsSettingsSaveStatus("pending", "Unsaved settings.");
    scheduleStatsSettingsSave();
  }

  function statsSettingsFromStorage(stored: Record<string, unknown> | null) {
    var source = stored && typeof stored === "object" ? stored : {};
    var parsed: Partial<StatsSettings> = {};
    Object.keys(statsSettings).forEach(function (name) {
      var value = parseStatsSetting(name, source[name]);
      if (value !== null) parsed[name] = value;
    });
    return parsed;
  }

  function loadStatsSettings() {
    const generation = ++loadGeneration;
    return hub.getPluginSettings(PLUGIN_ID).then(function (stored) {
      if (disposed || generation !== loadGeneration) return;
      var parsed = statsSettingsFromStorage(stored);
      var changed = false;
      statsSettingsExtras = {};
      Object.keys(stored || {}).forEach(function (name) {
        if (!Object.prototype.hasOwnProperty.call(statsSettings, name)) statsSettingsExtras[name] = stored[name];
      });
      Object.keys(parsed).forEach(function (name) {
        if (statsSettings[name] !== parsed[name]) {
          statsSettings[name] = parsed[name]!;
          changed = true;
        }
      });
      if (changed) notifyStatsSettings();
      return hub.theme.ready.then(function (key) { if (!disposed && generation === loadGeneration) syncSuiteTheme(key); });
    }).catch(function (error) {
      console.warn("DirtyStats could not load its display settings", error);
    });
  }

  function useStatsSetting<K extends keyof StatsSettings & string>(name: K): [StatsSettings[K], (value: unknown) => void] {
    var revisionState = React.useState(statsSettingsRevision);
    var setRevision = revisionState[1];
    React.useEffect(function () {
      var listener = function () { setRevision(statsSettingsRevision); };
      statsSettingsListeners.add(listener);
      return function () { statsSettingsListeners.delete(listener); };
    }, [setRevision]);
    return [statsSettings[name], function (value) { setStatsSetting(name, value); }];
  }

  function useChartTheme() {
    // Rebuild chart options when the suite theme changes without refetching data.
    return useStatsSetting("visualTheme")[0];
  }

  function getStatsSettingExtra<T>(name: string, fallback: T): T {
    return Object.prototype.hasOwnProperty.call(statsSettingsExtras, name) ? statsSettingsExtras[name] as T : fallback;
  }

  function setStatsSettingExtra(name: string, value: unknown) {
    if (Object.prototype.hasOwnProperty.call(statsSettingsExtras, name) &&
      JSON.stringify(statsSettingsExtras[name]) === JSON.stringify(value)) return;
    statsSettingsExtras[name] = value;
    statsSettingsDirtyNames.add(name);
    statsSettingsEditRevision += 1;
    setStatsSettingsSaveStatus("pending", "Unsaved settings.");
    scheduleStatsSettingsSave();
  }
  return { statsTheme, themeColor, themePalette, statsThemeClass, parseStatsSetting, syncSuiteTheme, scheduleStatsSettingsSave, setStatsSetting, statsSettingsFromStorage, loadStatsSettings, useStatsSetting, useChartTheme, getStatsSettingExtra, setStatsSettingExtra, statsSettings, STATS_SETTING_SPECS, getSaveStatus: () => ({ ...statsSettingsSaveStatus }), subscribeSaveStatus: (listener: () => void) => { statsSaveStatusListeners.add(listener); return () => { statsSaveStatusListeners.delete(listener) } }, getSaveStatusRevision: () => statsSaveStatusRevision, dispose: () => { disposed = true; loadGeneration++; statsSettingsSaveController?.dispose(); statsSettingsListeners.clear(); statsSaveStatusListeners.clear(); }, };
}
export type Settings = ReturnType<typeof createSettings>;
