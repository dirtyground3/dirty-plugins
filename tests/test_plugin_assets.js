"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { scriptPaths } = require("./load_plugin_scripts");

const entries = {
  DirtyCaptions: "dirtyCaptions.js",
  DirtyTasks: "dirtyTasks.js",
  DirtyFileExtractor: "extractScenes.js",
  DirtyMultiscreen: "multiscreen.js",
  DirtyPlugins: "dirtyPlugins.js",
  DirtyRank: "dirtyRank.js",
  DirtyStats: "dirtyStats.js",
};

// Source types and registration behavior have their own checks; this guards what Stash serves.
for (const [plugin, entry] of Object.entries(entries)) {
  const scripts = scriptPaths(plugin);
  for (const filename of scripts) new vm.Script(fs.readFileSync(filename, "utf8"), { filename });
  assert.deepEqual(
    scripts.map(filename => path.basename(filename)),
    [entry],
    plugin + " must serve one compiled entry",
  );
}

console.log("Every plugin serves one parseable compiled entry script");
