// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyPluginsMetadata";
  if (window[INSTANCE_KEY]) return;
  // Owned by the hub, which loads before feature plugins. Manifests keep typed
  // setting declarations; consumers share these browser defaults and bounds.
  /** @type {Window['DirtyPlugins']['settingsMetadata']['multiscreen']} */
  var multiscreen = {
    defaults: {
      totalScreens: 4, rows: 2, columns: 2, randomize: true, splitScenes: false,
      startMuted: true, randomStart: true, loopScenes: true, markerDuration: 30,
      pauseWhenHidden: true
    },
    order: ["totalScreens", "rows", "columns", "randomize", "splitScenes", "startMuted", "randomStart", "loopScenes", "markerDuration", "pauseWhenHidden"],
    limits: {
      totalScreens: {min: 1, max: 36, step: 1}, rows: {min: 1, max: 12, step: 1},
      columns: {min: 1, max: 12, step: 1}, markerDuration: {min: 1, max: 600, step: 1}
    }
  };
  window[INSTANCE_KEY] = { multiscreen: multiscreen };
})();
