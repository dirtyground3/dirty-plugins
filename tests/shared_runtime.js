"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/** Supply actual pure hub features to tests that stub the surrounding runtime. */
function installJobHelpers(window) {
  if (!window.DirtyPlugins) window.DirtyPlugins = {};
  const filename = path.join(__dirname, "../plugins/DirtyPlugins/dirtyPluginsJobs.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { window }, { filename });
  Object.assign(window.DirtyPlugins, window.__dirtyPluginsJobs);
}

function installMetadata(window) {
  const filename = path.join(__dirname, "../plugins/DirtyPlugins/dirtyPluginsMetadata.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { window }, { filename });
  if (!window.DirtyPlugins) window.DirtyPlugins = {};
  window.DirtyPlugins.settingsMetadata = window.__dirtyPluginsMetadata;
}

function installSaveController(window) {
  installMetadata(window);
  installJobHelpers(window);
  const filename = path.join(__dirname, "../plugins/DirtyPlugins/dirtyPluginsSave.js");
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), { window }, { filename });
  window.DirtyPlugins.createSaveController = window.__dirtyPluginsSave.createSaveController;
}

module.exports = { installSaveController, installJobHelpers, installMetadata };
