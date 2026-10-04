"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/** Supply actual pure hub features to tests that stub the surrounding runtime. */
function loadFeature(window, feature) {
  const filename = path.join(__dirname, "../plugins/DirtyPlugins/dirtyPlugins" + feature + ".js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { window }, { filename });
  return window["__dirtyPlugins" + feature];
}

function installJobHelpers(window) {
  if (!window.DirtyPlugins) window.DirtyPlugins = {};
  Object.assign(window.DirtyPlugins, loadFeature(window, "Jobs"));
}

function installMetadata(window) {
  if (!window.DirtyPlugins) window.DirtyPlugins = {};
  window.DirtyPlugins.settingsMetadata = loadFeature(window, "Metadata");
}

function installSaveController(window) {
  installMetadata(window);
  installJobHelpers(window);
  window.DirtyPlugins.createSaveController = loadFeature(window, "Save").createSaveController;
}

module.exports = { installSaveController, installJobHelpers, installMetadata, loadFeature };
