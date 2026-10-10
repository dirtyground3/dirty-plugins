"use strict";
const vm = require("node:vm"),
  { sourceFor } = require("./load_plugin_scripts");
const { createRenderer, findAll, text, events } = require("./ui_harness");
const { installJobHelpers, installRegistration } = require("./shared_runtime");
const copy = value => JSON.parse(JSON.stringify(value));
function createCaptionsHarness(options = {}) {
  let addon,
    event,
    scene = options.scene || { id: "1", files: [{ id: "10", size: 100 }] };
  let mounted = true,
    activePlayer = options.player;
  const patches = new Map(),
    patchNames = [],
    calls = [],
    errors = [],
    statuses = [],
    timers = new Map(),
    observers = [];
  let nextTimer = 0;
  // The status element's parent is the native player tile holding the current player.
  const renderer = createRenderer({
    host(node) {
      if (node.props?.ref && node.props.className?.includes("dirty-captions-status"))
        node.props.ref.current = {
          parentElement: { querySelector: () => (activePlayer ? { player: activePlayer } : null) },
        };
    },
  });
  const React = {
    ...renderer.hooks,
    Fragment: Symbol("host Fragment"),
    createElement: (type, props, ...children) => ({
      type,
      props: { ...props, children: children.length === 1 ? children[0] : children },
      children,
    }),
    isValidElement: node => !!node?.type,
    cloneElement: (node, props, ...children) => {
      const next = children.length ? (children.length === 1 ? children[0] : children) : node.props.children;
      return {
        ...node,
        props: { ...node.props, ...props, children: next },
        children: Array.isArray(next) ? next : [next],
      };
    },
    useState(initial) {
      const [value, set] = renderer.hooks.useState(initial);
      return [
        value,
        next => {
          statuses.push(next);
          set(next);
        },
      ];
    },
  };
  const controls = Object.fromEntries(
    ["SettingsSection", "Button"].map(name => [name, props => React.createElement(name, props, props.children)]),
  );
  const hub = {
    react: controls,
    captureEnabled: () => !!options.capture,
    getPluginSettings: async () => (options.load ? options.load() : options.settings || {}),
    runPluginOperation: async (id, args) => {
      calls.push(copy(args));
      return options.operation
        ? options.operation(args)
        : args.mode === "captions"
          ? { sceneId: String(scene.id), fileId: "10", tracks: [], warnings: [] }
          : { status: args.mode === "indexRefresh" ? "Running" : "Finished", checked: 2, skipped: 2 };
    },
    registerSettingsAddon(id, component) {
      addon = component;
      options.register?.();
    },
    debugLog() {},
  };
  const window = events({
    DirtyPlugins: hub,
    navigator: { language: "en-US" },
    location: { search: options.capture ? "?docsCapture=1" : "" },
    setTimeout: fn => {
      const id = ++nextTimer;
      timers.set(id, { fn, kind: "timeout" });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => {
      const id = ++nextTimer;
      timers.set(id, { fn, kind: "interval", delay });
      return id;
    },
    clearInterval: id => timers.delete(id),
    PluginApi: {
      React,
      libraries: { Intl: { useIntl: () => options.intl || { messages: {} } } },
      GQL: { useJobsSubscribeSubscription: () => ({ data: { jobsSubscribe: event } }) },
      patch: {
        after(name, callback) {
          patchNames.push(name);
          patches.set(name, callback);
          options.patch?.(name);
        },
      },
    },
  });
  installJobHelpers(window);
  const console = { error: (...args) => errors.push(args) };
  installRegistration(window, console);
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      observers.push(this);
    }
    observe() {
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
  }
  const context = vm.createContext({
    window,
    Intl,
    MutationObserver: Observer,
    console,
  });
  const load = () => vm.runInContext(sourceFor("DirtyCaptions"), context);
  function render() {
    const native = React.createElement(
      "native-player",
      { className: "VideoPlayer" },
      React.createElement("video-wrapper", {}),
    );
    return renderer.render(
      mounted
        ? [
            addon && React.createElement(addon, {}),
            patches.get("App")?.(React.createElement("native-app", {})),
            patches.get("ScenePlayer")?.({ scene }, {}, native),
          ]
        : null,
    );
  }
  const flush = () => renderer.flush(render);
  return {
    window,
    context,
    hub,
    React,
    load,
    flush,
    patches,
    patchNames,
    calls,
    errors,
    statuses,
    timers,
    observers,
    get tree() {
      return renderer.tree;
    },
    get addon() {
      return addon;
    },
    nodes: predicate => findAll(renderer.tree, predicate),
    button(label) {
      return findAll(renderer.tree, node => node.type === "Button" && text(node) === label)[0];
    },
    async click(label) {
      const node = this.button(label);
      if (!node) throw Error("Missing " + label);
      node.props.onClick();
      await flush();
    },
    async event(value) {
      event = value;
      renderer.invalidate();
      await flush();
    },
    async tick(delay) {
      for (const value of [...timers.values()]) if (value.kind === "interval" && value.delay === delay) value.fn();
      await flush();
    },
    async scene(value) {
      scene = value;
      renderer.invalidate();
      await flush();
    },
    async player(value) {
      activePlayer = value;
      for (const observer of observers) if (observer.connected) observer.callback();
      await flush();
    },
    async unmount() {
      mounted = false;
      renderer.invalidate();
      await flush();
    },
  };
}
module.exports = { createCaptionsHarness };
