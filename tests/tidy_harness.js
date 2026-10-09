"use strict";
const vm = require("node:vm"), {sourceFor} = require("./load_plugin_scripts");
const {createHooks, findAll, text} = require("./ui_harness");
const {installJobHelpers} = require("./shared_runtime");
const copy = value => JSON.parse(JSON.stringify(value));
function createTidyHarness(options = {}) {
  let panel, appPatch, owner, changed = true, tree, event;
  let configuration = copy(options.settings || {});
  const owners = new Map(), patches = [], registrations = [], writes = [], calls = [], requests = [], dirty = [], notifications = [], errors = [];
  const hooks = createHooks(() => owner);
  const React = {...hooks, Fragment: Symbol("host Fragment"),
    createElement: (type, props, ...children) => ({type, props: {...props, children}, children}),
    useState(initial) {const [value, set] = hooks.useState(initial); return [value, next => {set(next); changed = true;}];},
  };
  const controls = Object.fromEntries(["SettingsSection", "SettingsToggle", "Field", "Pagination", "Button", "ActionMenu", "Badge", "Dialog", "SaveStatus"].map(name =>
    [name, props => name === "Dialog" && !props.open ? null : React.createElement(name, props, props.children)]));
  const hub = {react: controls, captureEnabled: () => Boolean(options.capture), ui: {notify: message => notifications.push(message)},
    getPluginSettings: async () => options.load ? options.load() : copy(configuration),
    configurePlugin: async (id, settings) => {writes.push(copy(settings)); if (options.save) await options.save(settings); configuration = copy(settings); return {revision: writes.length};},
    runPluginOperation: async (id, args) => {calls.push(copy(args)); return options.operation ? options.operation(args) : {
      settings: copy(args.settings || configuration), strategy_hash: "b".repeat(64), plan_digest: "c".repeat(64), total: 1,
      summary: {ready: 1, moves: 1, renames: 0}, operations: [{file_id: "1", scene_id: "1", scene_title: "Synthetic", status: "ready", source_path: "/old/a.mp4", destination_path: "/new/a.mp4", actions: ["move"], warnings: []}],
    };},
    graphql: async (query, variables) => {requests.push({query, variables: copy(variables)}); return options.queue ? options.queue(variables) : {runPluginTask: "10"};},
    registerSettingsPanel(id, component) {registrations.push(id); panel = component; options.register?.();},
    unregisterSettingsPanel(id, component) {if (panel === component) {panel = null; changed = true;}}, debugLog() {},
  };
  const window = {location: {search: options.capture ? "?docsCapture=1" : ""}, DirtyPlugins: hub,
    PluginApi: {React, GQL: {useJobsSubscribeSubscription: () => ({data: {jobsSubscribe: event}})},
      patch: {after(name, callback) {patches.push(name); appPatch = callback; options.patch?.();}}}};
  installJobHelpers(window);
  const context = vm.createContext({window, console: {error: (...args) => errors.push(args)}});
  const load = () => vm.runInContext(sourceFor("DirtyTidy"), context);
  function release(item) {for (const slot of item.slots) slot?.cleanup?.();}
  function render() {
    changed = false; const seen = new Set();
    function visit(node, address) {
      if (Array.isArray(node)) return node.map((child, index) => visit(child, address + "/" + (child?.props?.key ?? index)));
      if (!node || typeof node !== "object" || !node.type) return node;
      if (typeof node.type === "function") {
        const key = address + ":" + node.type.name; seen.add(key);
        if (!owners.has(key)) owners.set(key, {slots: [], cursor: 0, effects: []});
        owner = owners.get(key); owner.cursor = 0; return visit(node.type(node.props), key);
      }
      const children = [...node.children]; if (node.type === "Field") children.push(node.props.action);
      return {...node, children: visit(children, address + "/children")};
    }
    tree = visit([panel && React.createElement(panel, {plugin: {id: "dirtyTidy"}, configuration, onDirtyChange: (id, value) => dirty.push(value)}),
      appPatch && appPatch(React.createElement("host-app", {}))], "root");
    for (const [key, item] of owners) if (!seen.has(key)) {release(item); owners.delete(key);}
    for (const item of owners.values()) for (const effect of item.effects.splice(0)) effect();
    return tree;
  }
  async function flush() {for (let i = 0; i < 30; i++) {if (changed) render(); await Promise.resolve();} return tree;}
  return {window, context, hub, load, flush, writes, calls, requests, dirty, notifications, patches, registrations, errors,
    get tree() {return tree;}, get panel() {return panel;}, get appPatch() {return appPatch;},
    nodes: predicate => findAll(tree, predicate),
    button(label) {return findAll(tree, node => (node.type === "Button" || node.type === "button") && text(node) === label)[0];},
    async click(label) {const button = this.button(label); if (!button) throw Error("Missing button: " + label); button.props.onClick(); await flush();},
    async input(label, value) {let control = findAll(tree, node => node.type === "input" && node.props["aria-label"] === label)[0];
      if (!control) control = findAll(findAll(tree, node => node.type === "Field" && node.props.label === label)[0], node => node.type === "input")[0];
      if (!control) throw Error("Missing input: " + label); control.props.onChange({target: {value}}); await flush();},
    async toggle(label, value) {const node = findAll(tree, node => node.type === "SettingsToggle" && text(node.props.label) === label)[0];
      if (!node) throw Error("Missing toggle: " + label); node.props.onChange(value); await flush();},
    async mode(value) {findAll(tree, node => node.type === "select")[0].props.onChange({target: {value}}); await flush();},
    async event(value) {event = value; changed = true; await flush();},
    async unmount() {panel = null; appPatch = null; changed = true; await flush();},
  };
}
module.exports = {createTidyHarness};
