"use strict";
const { runSource } = require("./plugin_paths");
const FEATURES = {
  Jobs: "src/jobs.ts",
  Register: "src/register.ts",
  Save: "src/save.ts",
  SettingsDraft: "src/settingsDraft.ts",
  Values: "src/shared/values.ts",
};

/** Supply actual pure hub features to tests that stub the surrounding runtime. */
function loadFeature(window, feature, globals = {}) {
  const exports = runSource("DirtyPlugins", FEATURES[feature], { ...globals, window });
  return exports;
}

function hubOf(window) {
  if (!window.DirtyPlugins) window.DirtyPlugins = {};
  return window.DirtyPlugins;
}

/** The hub's one-time plugin registration; failures go to the given console. */
function installRegistration(window, console = globalThis.console) {
  hubOf(window).registerPlugin = loadFeature(window, "Register", { console }).registerPlugin;
}

function installJobHelpers(window) {
  Object.assign(hubOf(window), loadFeature(window, "Jobs"));
}

function installSaveController(window) {
  installJobHelpers(window);
  hubOf(window).createSaveController = loadFeature(window, "Save").createSaveController;
}

module.exports = { installRegistration, installSaveController, installJobHelpers, loadFeature };
