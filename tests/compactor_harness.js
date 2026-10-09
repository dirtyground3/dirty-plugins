"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const {runtimePath} = require("./plugin_paths");
const {scriptPaths} = require("./load_plugin_scripts");
const {createHooks, findAll, text} = require("./ui_harness");
const copy = value => JSON.parse(JSON.stringify(value));

// Host React owns element creation and hook state. Shared save/job behavior is
// real staged hub code; only Stash transport, controls, clock and media are fake.
function createCompactorHarness(options = {}) {
  let panel, appPatch, owner, changed = true, tree, now = 0, nextTimer = 0;
  let settings = copy(options.settings || {rules: [], automationPaused: true});
  let preview = options.preview || null, run = options.run || null;
  let event = null;
  const owners = new Map(), timers = new Map(), calls = [], writes = [], dirty = [];
  const notifications = [], players = [], registrations = [], patches = [];
  const hooks = createHooks(() => owner);
  const React = {
    ...hooks, Fragment: Symbol("Stash React.Fragment"),
    createElement(type, props, ...children) {
      return {type, props: {...props, children}, children};
    },
    useState(initial) {
      const [value, set] = hooks.useState(initial);
      return [value, next => {set(next); changed = true;}];
    },
  };
  const schedule = (fn, delay, interval) => {
    const id = ++nextTimer;
    timers.set(id, {fn, at: now + delay, interval});
    return id;
  };
  const clock = {
    setTimeout: (fn, delay) => schedule(fn, delay), clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, delay), clearInterval: id => timers.delete(id),
  };
  const ui = Object.fromEntries(["SettingsCard", "SettingsSection", "SettingsToggle", "Badge", "Button", "Field",
    "SceneFilterEditor", "StateView", "Pagination", "SaveStatus", "Dialog", "ActionMenu", "Metric"].map(name => [name, name]));
  ui.usePageTitle = () => {};
  const hub = {
    react: ui, captureEnabled: () => Boolean(options.capture), ui: {notify: message => notifications.push(message)},
    registerSettingsPanel(id, component) {registrations.push(id); panel = component; options.register?.(id, component);},
    unregisterSettingsPanel() {panel = null;},
    getPluginSettings: async () => copy(settings),
    configurePlugin: async (id, value) => {
      writes.push(copy(value));
      if (options.save) await options.save(value);
      settings = copy(value);
      return {revision: writes.length};
    },
    graphql: async () => ({findScenes: {count: 1, filesize: 100e6, scenes: [{files: [
      {size: 100e6, duration: 100, width: 1920, height: 1080, bit_rate: 50e6, frame_rate: 30},
    ]}]}}),
    runPluginOperation: async (id, args) => {
      calls.push(copy(args));
      if (options.operation) {
        const value = await options.operation(args);
        if (value !== undefined) return value;
      }
      switch (args.mode) {
        case "listRuns": return run ? [run] : [];
        case "latestPreview": return preview;
        case "getPreview": return preview;
        case "getRun": return run;
        case "preview": return preview;
        case "startRun": return run;
        case "capabilities": return {encoders: {h264: ["cpu", "nvenc"], hevc: ["cpu"]}};
        default: return {};
      }
    },
  };
  const window = {...clock, location: {search: options.capture ? "?docsCapture=1" : ""}, DirtyPlugins: hub,
    PluginApi: {React, GQL: {useJobsSubscribeSubscription: () => ({data: {jobsSubscribe: event}})},
      patch: {after(name, callback) {patches.push(name); appPatch = callback; options.patch?.(name, callback);}}}};
  const context = vm.createContext({window, ...clock, console});
  hub.createSaveController = require("./shared_runtime").loadFeature(window, "Save").createSaveController;
  hub.createJobHook = require("./shared_runtime").loadFeature(window, "Jobs").createJobHook;
  hub.react.useSettingsDraft = require("./shared_runtime").loadFeature(window, "SettingsDraft").createSettingsDraftHook(React);
  function load() {
    for (const filename of scriptPaths("DirtyCompactor")) vm.runInContext(fs.readFileSync(filename, "utf8"), context, {filename});
  }
  function release(item) {
    for (const slot of item.slots) if (slot?.cleanup) slot.cleanup();
  }
  function render() {
    const seen = new Set();
    function visit(node, address) {
      if (Array.isArray(node)) return node.map((child, index) => visit(child, address + "/" + (child?.props?.key || index)));
      if (!node || typeof node !== "object" || !node.type) return node;
      if (typeof node.type === "function") {
        const key = address + ":" + node.type.name;
        seen.add(key);
        if (!owners.has(key)) owners.set(key, {slots: [], cursor: 0, effects: []});
        owner = owners.get(key); owner.cursor = 0;
        const result = node.type(node.props);
        return visit(result, key);
      }
      if (node.type === "video" && node.props.ref && !node.props.ref.current) {
        const player = {paused: 0, cleared: 0, loaded: 0,
          pause() {this.paused++;}, removeAttribute(name) {if (name === "src") this.cleared++;}, load() {this.loaded++;}};
        node.props.ref.current = player; players.push(player);
      }
      const children = [...node.children];
      if (node.type === "Field") children.push(node.props.action);
      if (node.type === "StateView") children.push(node.props.actions);
      return {...node, children: visit(children, address + "/children")};
    }
    changed = false;
    tree = visit([
      panel && React.createElement(panel, {configuration: settings, onDirtyChange: (id, value) => dirty.push(value)}),
      appPatch && appPatch(React.createElement("host-app", {})),
    ], "root");
    for (const [key, item] of owners) if (!seen.has(key)) {release(item); owners.delete(key);}
    for (const item of owners.values()) {
      const effects = item.effects.splice(0);
      for (const effect of effects) effect();
    }
    return tree;
  }
  async function flush() {
    for (let i = 0; i < 30; i++) {
      if (changed) render();
      await Promise.resolve();
    }
    return tree;
  }
  async function advance(duration) {
    const until = now + duration;
    await flush();
    for (;;) {
      const entry = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, timer] = entry;
      now = timer.at;
      if (timer.interval) timer.at += timer.interval; else timers.delete(id);
      timer.fn(); await flush();
    }
    now = until;
    await flush();
  }
  return {
    window, context, hub, load, flush, advance, calls, writes, dirty, notifications, players, registrations, patches, timers,
    get tree() {return tree;}, get panel() {return panel;}, get appPatch() {return appPatch;},
    nodes: predicate => findAll(tree, predicate),
    button(label) {return findAll(tree, node => node.type === "Button" && text(node) === label)[0];},
    async click(label) {const button = this.button(label); if (!button) throw Error("Missing button: " + label); button.props.onClick(); await flush();},
    async field(label, value) {
      const field = findAll(tree, node => node.type === "Field" && node.props.label === label)[0];
      if (!field) throw Error("Missing field: " + label);
      const control = findAll(field, node => node.type === "select" || node.type === "input")[0];
      control.props.onChange({target: {value}}); await flush();
    },
    async event(value) {event = value; changed = true; await flush();},
    async preview(value) {preview = value; await advance(2000);},
    async run(value) {run = value; await advance(2000);},
    unmount() {for (const item of owners.values()) release(item); owners.clear(); panel = null; appPatch = null;},
  };
}
module.exports = {createCompactorHarness, copy};
