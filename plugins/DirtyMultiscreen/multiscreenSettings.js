// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyMultiscreenSettings";
  if (window[INSTANCE_KEY]) return;
  var DirtyPlugins = window.DirtyPlugins;
  if (!DirtyPlugins || !DirtyPlugins.values) return;
  var MAX_SCENE_PAGE_SIZE = 240;
  var NON_RANDOM_SCENE_SORT = "title";

  var DEFAULT_SETTINGS = {
    totalScreens: 4,
    rows: 2,
    columns: 2,
    randomize: true,
    splitScenes: false,
    startMuted: true,
    randomStart: true,
    loopScenes: true,
    markerDuration: 30,
    pauseWhenHidden: true
  };
  var clampInteger = DirtyPlugins.values.clampInteger;
  var coerceBoolean = DirtyPlugins.values.coerceBoolean;
  /** @param {Record<string, *>} rawSettings */
  function normalizeSettings(rawSettings) {
    var rows = clampInteger(rawSettings.rows, DEFAULT_SETTINGS.rows, 1, 12);
    var columns = clampInteger(rawSettings.columns, DEFAULT_SETTINGS.columns, 1, 12);
    return {
      // The CSS grid only has rows x columns cells; extra tiles would play
      // off-screen while being clipped by the viewport.
      totalScreens: Math.min(clampInteger(rawSettings.totalScreens, DEFAULT_SETTINGS.totalScreens, 1, 36), rows * columns),
      rows: rows,
      columns: columns,
      randomize: coerceBoolean(rawSettings.randomize, DEFAULT_SETTINGS.randomize),
      splitScenes: coerceBoolean(rawSettings.splitScenes, DEFAULT_SETTINGS.splitScenes),
      startMuted: coerceBoolean(rawSettings.startMuted, DEFAULT_SETTINGS.startMuted),
      randomStart: coerceBoolean(rawSettings.randomStart, DEFAULT_SETTINGS.randomStart),
      loopScenes: coerceBoolean(rawSettings.loopScenes, DEFAULT_SETTINGS.loopScenes),
      markerDuration: clampInteger(rawSettings.markerDuration, DEFAULT_SETTINGS.markerDuration, 1, 600),
      pauseWhenHidden: coerceBoolean(rawSettings.pauseWhenHidden, DEFAULT_SETTINGS.pauseWhenHidden)
    };
  }
  /** @param {Record<string, *>} settings */
  function getPlaybackSettings(settings) {
    return { startMuted: settings.startMuted, randomStart: settings.randomStart,
      loop: settings.loopScenes, pauseWhenHidden: settings.pauseWhenHidden };
  }
  /** @param {Record<string, *>} settings */
  function getSceneLimit(settings) {
    var multiplier = settings.splitScenes ? 8 : 12;
    return Math.min(MAX_SCENE_PAGE_SIZE, Math.max(settings.totalScreens, settings.totalScreens * multiplier));
  }
  /** @param {Record<string, *>} settings */
  function getSceneSort(settings) {
    if (settings.randomize) return "random";
    return NON_RANDOM_SCENE_SORT;
  }
  window[INSTANCE_KEY] = { defaults: DEFAULT_SETTINGS, nonRandomSort: NON_RANDOM_SCENE_SORT, normalizeSettings: normalizeSettings, getPlaybackSettings: getPlaybackSettings, getSceneLimit: getSceneLimit, getSceneSort: getSceneSort };
})();
