"use strict";
const vm = require("node:vm");
const { sourceFor } = require("./load_plugin_scripts");
const { events, createHooks, findAll, text } = require("./ui_harness");
const copy = value => JSON.parse(JSON.stringify(value));

function createHubHarness(options = {}) {
  let route, owner, changed = true, tree, timerId = 0, now = 0;
  const owners = new Map(), timers = new Map(), requests = [], registrations = [], patches = [], errors = [];
  const settings = copy(options.settings || { dirtyPlugins: { visualTheme: "classic" }, multiscreen: { totalScreens: 4, rows: 2, columns: 2 } });
  const revisions = Object.fromEntries(Object.keys(settings).map(id => [id, 1]));
  const plugins = options.plugins || [
    { id: "multiscreen", name: "DirtyMultiscreen", enabled: true, settings: [
      { name: "columns", type: "NUMBER" }, { name: "rows", type: "NUMBER" }, { name: "totalScreens", type: "NUMBER" },
    ] },
    { id: "dirtyPlugins", name: "DirtyPlugins", enabled: true, settings: [{ name: "visualTheme", type: "STRING" }] },
    { id: "unmanaged", name: "Other plugin", enabled: true, settings: [] },
  ];
  const hooks = createHooks(() => owner);
  const React = {
    ...hooks, Fragment: Symbol("host React Fragment"),
    createElement(type, props, ...children) {
      const flat = children.flat();
      return { type, props: { ...props, children: flat.length === 1 ? flat[0] : flat }, children: flat };
    },
    isValidElement: value => Boolean(value && typeof value === "object" && "type" in value),
    cloneElement: (node, props) => ({ ...node, props: { ...node.props, ...props } }),
    useState(initial) {
      const [value, set] = hooks.useState(initial);
      return [value, next => { set(next); changed = true; }];
    },
  };
  const clock = {
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const window = events({ ...clock,
    location: { pathname: "/plugins/dirty-plugins", search: "?plugin=multiscreen", href: "http://fixture/plugins/dirty-plugins?plugin=multiscreen" },
    history: { state: null, replaceState(_state, _title, url) { window.location.href = "http://fixture" + url; window.location.search = new URL(window.location.href).search; } },
    confirm: () => options.confirm !== false,
  });
  const classes = new Set();
  const document = events({ title: "Stash", currentScript: null,
    documentElement: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } },
    getElementById: () => ({ focus() {} }),
  });
  const PluginApi = window.PluginApi = {
    React, components: {}, libraries: { ReactRouterDOM: { Link: "a", MemoryRouter: "memory-router" }, Bootstrap: {
      Dropdown: Object.assign(function Dropdown(props) { return React.createElement("dropdown", props, props.children); },
        { Toggle: "dropdown-toggle", Menu: "dropdown-menu", Item: "dropdown-item", Divider: "dropdown-divider", Header: "dropdown-header" }),
    } },
    patch: { instead(name, callback) { patches.push({ name, callback }); options.patch?.(name, callback); },
      after(name, callback) { patches.push({ name, callback }); } },
    register: { route(path, component) { registrations.push(path); route = component; options.register?.(path, component); } },
  };
  if (options.api) options.api(PluginApi);
  if (options.hub) window.DirtyPlugins = options.hub;
  const fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    requests.push(request);
    if (options.fetch) { const response = await options.fetch(request); if (response !== undefined) return response; }
    if (request.query.includes("query DirtyPluginsSettings")) return { ok: true, json: async () => ({ data: { plugins } }) };
    const args = request.variables.args;
    let output;
    if (args.mode === "getAllSettings") output = { settings: copy(settings), pluginRevisions: copy(revisions) };
    else if (args.mode === "getSettings") output = { settings: copy(settings[args.pluginId] || {}), revision: revisions[args.pluginId] || 0 };
    else if (args.mode === "setSettings") {
      if (args.expectedRevision !== revisions[args.pluginId]) return { ok: true, json: async () => ({ errors: [{ message: "Settings revision conflict" }] }) };
      settings[args.pluginId] = copy(args.settings);
      output = { settings: copy(args.settings), revision: ++revisions[args.pluginId] };
    } else if (args.mode === "backupDatabase") output = { path: "controlled/backup.sqlite3" };
    else if (args.mode === "listRuns") output = [];
    else if (args.mode === "latestPreview") output = null;
    else throw new Error("Unexpected fixture operation " + args.mode);
    return { ok: true, json: async () => ({ data: { runPluginOperation: JSON.stringify({ output }) } }) };
  };
  const context = vm.createContext({ window, document, ...clock, fetch, URL, URLSearchParams,
    setInterval: () => ++timerId, clearInterval() {},
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    console: { log() {}, info() {}, warn() {}, error(...args) { errors.push(args); } },
  });
  const source = sourceFor("DirtyPlugins");
  function load() { vm.runInContext(source, context); }
  function loadCompactor() { vm.runInContext(sourceFor("DirtyCompactor"), context); }
  function release(item) { for (const slot of item.slots) if (slot?.cleanup) slot.cleanup(); }
  function render() {
    const seen = new Set();
    function visit(node, address) {
      if (Array.isArray(node)) return node.map((child, index) => visit(child, address + "/" + (child?.props?.key || index)));
      if (!node || typeof node !== "object" || !node.type) return node;
      if (typeof node.type === "function") {
        const key = address + ":" + node.type.name;
        seen.add(key);
        if (!owners.has(key)) owners.set(key, { slots: [], cursor: 0, effects: [] });
        owner = owners.get(key); owner.cursor = 0;
        return visit(node.type(node.props), key);
      }
      return { ...node, children: visit(node.children, address + "/children") };
    }
    changed = false;
    tree = visit(React.createElement(route), "root");
    for (const [key, item] of owners) if (!seen.has(key)) { release(item); owners.delete(key); }
    for (const item of owners.values()) for (const effect of item.effects.splice(0)) effect();
    return tree;
  }
  async function settle() {
    for (let count = 0; count < 30; count++) { if (changed) render(); await new Promise(setImmediate); }
    return tree;
  }
  async function tick(delay = 400) {
    now += delay;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
    return settle();
  }
  function unmount() { for (const item of owners.values()) release(item); owners.clear(); }
  return { load, loadCompactor, render, settle, tick, unmount, context, window, document, requests, registrations, patches, errors, timers, settings,
    nodes: predicate => findAll(tree, predicate), text: () => text(tree), get route() { return route; } };
}
module.exports = { createHubHarness };
