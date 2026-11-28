"use strict";
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { registry, SETTINGS_DEFINITION_FILE } = require("../scripts/build-lib.cjs");
const { sourceFor } = require("./load_plugin_scripts");
const { runtimePath } = require("./plugin_paths");
const { events, createRenderer, findAll, text } = require("./ui_harness");
const copy = value => JSON.parse(JSON.stringify(value));
const stagedDefinitions = Object.fromEntries(
  registry.flatMap(plugin => {
    const file = path.join(runtimePath(plugin.directory), SETTINGS_DEFINITION_FILE);
    return fs.existsSync(file) ? [[plugin.id, JSON.parse(fs.readFileSync(file, "utf8"))]] : [];
  }),
);

function createHubHarness(options = {}) {
  let route,
    timerId = 0,
    now = 0;
  const timers = new Map(),
    requests = [],
    registrations = [],
    patches = [],
    errors = [];
  const settings = copy(
    options.settings || {
      dirtyPlugins: { visualTheme: "classic" },
      multiscreen: { markerDuration: 30, recentGrids: 5 },
    },
  );
  const revisions = Object.fromEntries(Object.keys(settings).map(id => [id, 1]));
  const settingsDefinitions = copy(options.settingsDefinitions ?? stagedDefinitions);
  const plugins = (
    options.plugins || [
      {
        id: "multiscreen",
        name: "DirtyMultiscreen",
        enabled: true,
        settings: [
          { name: "recentGrids", type: "NUMBER" },
          { name: "markerDuration", type: "NUMBER" },
        ],
      },
      { id: "dirtyPlugins", name: "DirtyPlugins", enabled: true, settings: [{ name: "visualTheme", type: "STRING" }] },
      { id: "unmanaged", name: "Other plugin", enabled: true, settings: [] },
    ]
  ).map(plugin => ({ version: stagedDefinitions[plugin.id]?.version, ...plugin }));
  const renderer = createRenderer();
  const React = {
    ...renderer.hooks,
    Fragment: Symbol("host React Fragment"),
    createElement(type, props, ...children) {
      const flat = children.flat();
      return { type, props: { ...props, children: flat.length === 1 ? flat[0] : flat }, children: flat };
    },
    isValidElement: value => Boolean(value && typeof value === "object" && "type" in value),
    cloneElement: (node, props) => ({ ...node, props: { ...node.props, ...props } }),
  };
  const clock = {
    setTimeout(fn, delay) {
      const id = ++timerId;
      timers.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  const window = events({
    ...clock,
    location: {
      pathname: "/plugins/dirty-plugins",
      search: "?plugin=multiscreen",
      href: "http://fixture/plugins/dirty-plugins?plugin=multiscreen",
    },
    history: {
      state: null,
      replaceState(_state, _title, url) {
        window.location.href = "http://fixture" + url;
        window.location.search = new URL(window.location.href).search;
      },
    },
    confirm: () => options.confirm !== false,
  });
  const classes = new Set();
  const document = events({
    title: "Stash",
    currentScript: null,
    documentElement: { classList: { add: name => classes.add(name), remove: name => classes.delete(name) } },
    getElementById: () => ({ focus() {} }),
  });
  const PluginApi = (window.PluginApi = {
    React,
    GQL: { useJobsSubscribeSubscription: () => ({ data: null }) },
    components: {},
    libraries: {
      ReactRouterDOM: { Link: "a", NavLink: "a", MemoryRouter: "memory-router" },
      Bootstrap: {
        Dropdown: Object.assign(
          function Dropdown(props) {
            return React.createElement("dropdown", props, props.children);
          },
          {
            Toggle: "dropdown-toggle",
            Menu: "dropdown-menu",
            Item: "dropdown-item",
            Divider: "dropdown-divider",
            Header: "dropdown-header",
          },
        ),
      },
    },
    patch: {
      instead(name, callback) {
        patches.push({ name, callback });
        options.patch?.(name, callback);
      },
      after(name, callback) {
        patches.push({ name, callback });
      },
    },
    register: {
      route(path, component) {
        registrations.push(path);
        route = component;
        options.register?.(path, component);
      },
    },
  });
  if (options.api) options.api(PluginApi);
  const fetch = async (_url, init) => {
    const request = JSON.parse(init.body);
    requests.push(request);
    if (options.fetch) {
      const response = await options.fetch(request);
      if (response !== undefined) return response;
    }
    if (request.query.includes("query DirtyPluginsSettings"))
      return { ok: true, json: async () => ({ data: { plugins } }) };
    if (request.query.includes("DirtyTidyTaggers"))
      return { ok: true, json: async () => ({ data: { configuration: { general: { stashBoxes: [] } } } }) };
    const args = request.variables.args;
    let output;
    if (args.mode === "getAllSettings")
      output = {
        settings: copy(settings),
        pluginRevisions: copy(revisions),
        settingsDefinitions: copy(settingsDefinitions),
      };
    else if (args.mode === "getSettings")
      output = { settings: copy(settings[args.pluginId] || {}), revision: revisions[args.pluginId] || 0 };
    else if (args.mode === "setSettings") {
      if (args.expectedRevision !== revisions[args.pluginId])
        return { ok: true, json: async () => ({ errors: [{ message: "Settings revision conflict" }] }) };
      settings[args.pluginId] = copy(args.settings);
      output = { settings: copy(args.settings), revision: ++revisions[args.pluginId] };
    } else if (args.mode === "backupDatabase") output = { path: "controlled/backup.sqlite3" };
    else if (args.mode === "migrationStatus") output = {};
    else if (args.mode === "organizationRecoveryStatus") output = { required: false };
    else if (args.mode === "getTaskSettings")
      output = { settings: copy(settings.dirtyTasks?.[args.section] || {}), revision: 0 };
    else if (args.mode === "listRuns") output = [];
    else if (args.mode === "latestPreview") output = null;
    else throw new Error("Unexpected fixture operation " + args.mode);
    return { ok: true, json: async () => ({ data: { runPluginOperation: JSON.stringify({ output }) } }) };
  };
  const context = vm.createContext({
    window,
    document,
    ...clock,
    fetch,
    URL,
    URLSearchParams,
    setInterval: () => ++timerId,
    clearInterval() {},
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    },
    console: {
      log() {},
      info() {},
      warn() {},
      error(...args) {
        errors.push(args);
      },
    },
  });
  const source = sourceFor("DirtyPlugins");
  function load() {
    vm.runInContext(source, context);
  }
  function loadCompactor() {
    vm.runInContext(sourceFor("DirtyTasks"), context);
  }
  // The settings route is the default root; mount() renders another node, such as a patch result.
  let root = () => React.createElement(route);
  const render = () => renderer.render(root());
  function mount(node) {
    root = () => node;
    render();
  }
  // Settle across macrotasks: hub saves wait on timers and fetch responses.
  async function settle() {
    for (let count = 0; count < 30; count++) {
      if (renderer.changed) render();
      await new Promise(setImmediate);
    }
    if (renderer.changed) throw new Error("Hub render did not settle after 30 rounds");
    return renderer.tree;
  }
  async function tick(delay = 400) {
    now += delay;
    for (const [id, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(id);
        timer.fn();
      }
    return settle();
  }
  const unmount = renderer.unmount;
  return {
    load,
    loadCompactor,
    render,
    mount,
    settle,
    tick,
    unmount,
    context,
    window,
    document,
    requests,
    registrations,
    patches,
    errors,
    timers,
    settings,
    settingsDefinitions,
    plugins,
    revisions,
    nodes: predicate => findAll(renderer.tree, predicate),
    text: () => text(renderer.tree),
    get route() {
      return route;
    },
  };
}
module.exports = { createHubHarness };
