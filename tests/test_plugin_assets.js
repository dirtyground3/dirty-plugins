"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { scriptPaths } = require("./load_plugin_scripts");

const entries = {
  DirtyCompactor: "dirtyCompactor.js",
  DirtyFileExtractor: "extractScenes.js",
  DirtyMultiscreen: "multiscreen.js",
  DirtyPlugins: "dirtyPlugins.js",
  DirtyRank: "dirtyRank.js",
  DirtyStats: "dirtyStats.js",
  DirtyTidy: "dirtyTidy.js",
};

for (const [plugin, entry] of Object.entries(entries)) {
  const scripts = scriptPaths(plugin);
  const names = scripts.map(filename => path.basename(filename));
  const entryIndex = names.indexOf(entry);
  assert(entryIndex > 0, plugin + " must load feature modules before its entry script");
  for (const filename of scripts) {
    const source = fs.readFileSync(filename, "utf8");
    new vm.Script(source, { filename });
    if (filename.includes(path.sep + "vendor" + path.sep) || path.basename(filename) === entry ||
        path.basename(filename) === "dirtyStatsDashboard.js") continue;
    assert(names.indexOf(path.basename(filename)) < entryIndex, filename + " must load before the entry script");
    assert(/^\/\/ @ts-check\r?\n/.test(source), filename + " must enable type checking");
    assert(source.includes("var INSTANCE_KEY ="), filename + " must guard duplicate loads");
    assert(source.includes("/** @"), filename + " must document its API with JSDoc");
  }
}

console.log("All plugin JavaScript assets are listed, parseable, and ordered");
