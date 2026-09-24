"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const noop = () => {};
const classes = new Set();
const requests = [];
const saved = { dirtyPlugins: {}, dirtyStats: { visualTheme: "arcade" } };
const revisions = { dirtyPlugins: 0, dirtyStats: 1 };
const fetch = (_url, options) => {
  const args = JSON.parse(options.body).variables.args;
  requests.push(args);
  let output;
  if (args.mode === "getSettings") {
    output = { settings: saved[args.pluginId], revision: revisions[args.pluginId] };
  } else if (args.mode === "setSettings") {
    saved[args.pluginId] = args.settings;
    output = { revision: ++revisions[args.pluginId] };
  } else if (args.mode === "backupDatabase") {
    output = { path: "backup.sqlite3" };
  } else {
    throw new Error(`Unexpected operation: ${args.mode}`);
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { runPluginOperation: JSON.stringify(output) } }) });
};
const React = { createElement: noop, useRef: noop };
const window = {
  PluginApi: {
    React,
    libraries: { ReactRouterDOM: { Link: "a" } },
    patch: { instead: noop },
    register: { route: noop },
    components: {},
    utils: {}
  },
  addEventListener: noop,
  location: { pathname: "/plugins/dirty-plugins" }
};
const document = {
  currentScript: null,
  addEventListener: noop,
  documentElement: { classList: { add: key => classes.add(key), remove: key => classes.delete(key) } }
};
vm.runInNewContext(fs.readFileSync("plugins/DirtyPlugins/dirtyPlugins.js", "utf8"), {
  window, document, fetch, console: { info: noop, warn: noop, error: noop }, URLSearchParams
});

(async () => {
  const hub = window.DirtyPlugins;
  await hub.theme.ready;
  assert.equal(hub.theme.currentKey, "arcade", "an existing Stats choice migrates visually without a write");
  assert(classes.has("dirty-ui-theme-arcade"));
  assert.equal(requests.filter(item => item.mode === "setSettings").length, 0);

  const observed = [];
  const unsubscribe = hub.theme.subscribe(key => observed.push(key));
  await hub.configurePlugin("dirtyPlugins", { visualTheme: "paper" });
  assert.equal(hub.theme.currentKey, "paper");
  assert(classes.has("dirty-ui-theme-paper"));
  assert(!classes.has("dirty-ui-theme-arcade"));
  assert.deepEqual(observed, ["paper"]);
  await hub.theme.load();
  assert.equal(hub.theme.currentKey, "paper", "the suite choice wins over legacy Stats storage");
  unsubscribe();

  const backup = await hub.runSharedOperation({ mode: "backupDatabase" });
  assert.equal(backup.path, "backup.sqlite3");
  assert(requests.some(item => item.mode === "backupDatabase"));
  console.log("Dirty Plugins suite theme and backup routing passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
