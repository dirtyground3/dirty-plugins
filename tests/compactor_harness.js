"use strict";

const fs = require("node:fs");
const vm = require("node:vm");
const { scriptPaths } = require("./load_plugin_scripts");
const { createRenderer, findAll, text } = require("./ui_harness");
const copy = value => JSON.parse(JSON.stringify(value));

// Host React owns element creation and hook state. Shared save/job behavior is
// real staged hub code; only Stash transport, controls, clock and media are fake.
function createCompactorHarness(options = {}) {
  let panel,
    appPatch,
    now = 0,
    nextTimer = 0;
  let settings = copy(options.settings || { rules: [], automationPaused: true });
  let execution = copy(options.execution || { move: "manual", rename: "manual", tags: "manual", encoding: {} });
  let preview = options.preview || null,
    run = options.run || null;
  let event = null;
  const timers = new Map(),
    calls = [],
    writes = [],
    dirty = [];
  const notifications = [],
    players = [],
    registrations = [],
    patches = [];
  const listeners = new Map();
  const renderer = createRenderer({
    host(node) {
      // Video elements get a fake media element; Field and StateView render their action slots.
      if (node.type === "video" && node.props.ref && !node.props.ref.current) {
        const player = {
          paused: 0,
          cleared: 0,
          loaded: 0,
          pause() {
            this.paused++;
          },
          removeAttribute(name) {
            if (name === "src") this.cleared++;
          },
          load() {
            this.loaded++;
          },
        };
        node.props.ref.current = player;
        players.push(player);
      }
      if (node.type === "Field") return [node.props.action];
      if (node.type === "StateView") return [node.props.actions];
    },
  });
  const React = {
    ...renderer.hooks,
    Fragment: Symbol("Stash React.Fragment"),
    createElement(type, props, ...children) {
      return { type, props: { ...props, children }, children };
    },
  };
  const schedule = (fn, delay, interval) => {
    const id = ++nextTimer;
    timers.set(id, { fn, at: now + delay, interval });
    return id;
  };
  const clock = {
    setTimeout: (fn, delay) => schedule(fn, delay),
    clearTimeout: id => timers.delete(id),
    setInterval: (fn, delay) => schedule(fn, delay, delay),
    clearInterval: id => timers.delete(id),
  };
  const ui = Object.fromEntries(
    [
      "SettingsCard",
      "SettingsSection",
      "SettingsToggle",
      "Badge",
      "Button",
      "Field",
      "SceneFilterEditor",
      "StateView",
      "Pagination",
      "SaveStatus",
      "Dialog",
      "ActionMenu",
      "Metric",
      "IconButton",
    ].map(name => [name, name]),
  );
  ui.usePageTitle = () => {};
  const hub = {
    react: ui,
    notifyConfigurationChanged() {},
    captureEnabled: () => Boolean(options.capture),
    ui: { notify: message => notifications.push(message) },
    registerSettingsPanel(id, component) {
      registrations.push(id);
      panel = component;
      options.register?.(id, component);
    },
    getPluginSettings: async () => copy(settings),
    configurePlugin: async (id, value) => {
      writes.push(copy(value));
      if (options.save) await options.save(value);
      settings = copy(value);
      return { revision: writes.length };
    },
    graphql: async () => ({
      findScenes: {
        count: 1,
        filesize: 100e6,
        scenes: [
          { files: [{ size: 100e6, duration: 100, width: 1920, height: 1080, bit_rate: 50e6, frame_rate: 30 }] },
        ],
      },
    }),
    runPluginOperation: async (id, args) => {
      if (args.mode === "getTaskSettings")
        return {
          settings: copy(
            args.section === "organization"
              ? options.organization || {}
              : args.section === "execution"
                ? execution
                : settings,
          ),
          revision: writes.length,
        };
      if (args.mode === "saveTaskSettings") {
        if (args.section === "execution") {
          writes.push(copy(args.settings));
          if (options.saveExecution) await options.saveExecution(args.settings);
          execution = copy(args.settings);
          return { revision: writes.length };
        }
        if (args.section === "organization") {
          writes.push(copy(args.settings));
          return { revision: writes.length };
        }
        return hub.configurePlugin(id, args.settings);
      }
      if (args.mode === "migrationStatus") return options.migration ? copy(options.migration) : {};
      calls.push(copy(args));
      if (options.operation) {
        const value = await options.operation(args);
        if (value !== undefined) return value;
      }
      switch (args.mode) {
        case "organizationRecoveryStatus":
          return { required: false };
        case "listRuns":
          return run ? [run] : [];
        case "latestPreview":
          return preview;
        case "getPreview":
          return preview;
        case "getRun":
          return run;
        case "preview":
          return preview;
        case "startRun":
          return run;
        case "capabilities":
          return { encoders: { h264: ["cpu", "nvenc"], hevc: ["cpu"] } };
        default:
          return {};
      }
    },
  };
  const window = {
    ...clock,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    location: { search: options.capture ? "?docsCapture=1" : "" },
    DirtyPlugins: hub,
    PluginApi: {
      React,
      GQL: { useJobsSubscribeSubscription: () => ({ data: { jobsSubscribe: event } }) },
      patch: {
        after(name, callback) {
          patches.push(name);
          appPatch = callback;
          options.patch?.(name, callback);
        },
      },
    },
  };
  const context = vm.createContext({ window, ...clock, console });
  const errors = [];
  require("./shared_runtime").installRegistration(window, { error: (...args) => errors.push(args) });
  hub.createSaveController = require("./shared_runtime").loadFeature(window, "Save").createSaveController;
  hub.createJobHook = require("./shared_runtime").loadFeature(window, "Jobs").createJobHook;
  hub.react.useSettingsDraft = require("./shared_runtime")
    .loadFeature(window, "SettingsDraft")
    .createSettingsDraftHook(React);
  function load() {
    vm.runInContext(
      options.combined
        ? fs.readFileSync(scriptPaths("DirtyTasks")[0], "utf8")
        : require("./task_test_entry").featureEntry("encoding"),
      context,
    );
  }
  const render = () =>
    renderer.render([
      panel &&
        React.createElement(panel, {
          plugin: { id: "dirtyTasks" },
          configuration: options.combined ? { encoding: settings } : settings,
          onDirtyChange: (id, value) => dirty.push(value),
        }),
      appPatch && appPatch(React.createElement("host-app", {})),
    ]);
  const flush = () => renderer.flush(render);
  async function advance(duration) {
    const until = now + duration;
    await flush();
    for (;;) {
      const entry = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, timer] = entry;
      now = timer.at;
      if (timer.interval) timer.at += timer.interval;
      else timers.delete(id);
      timer.fn();
      await flush();
    }
    now = until;
    await flush();
  }
  return {
    window,
    context,
    errors,
    hub,
    load,
    flush,
    advance,
    calls,
    writes,
    dirty,
    notifications,
    players,
    registrations,
    patches,
    timers,
    listeners,
    async focus() {
      listeners.get("focus")?.forEach(listener => listener());
      await flush();
    },
    get tree() {
      return renderer.tree;
    },
    get panel() {
      return panel;
    },
    get appPatch() {
      return appPatch;
    },
    nodes: predicate => findAll(renderer.tree, predicate),
    button(label) {
      return findAll(renderer.tree, node => node.type === "Button" && text(node) === label)[0];
    },
    async click(label) {
      const button = this.button(label);
      if (!button) throw Error("Missing button: " + label);
      button.props.onClick();
      await flush();
    },
    async field(label, value) {
      const field = findAll(renderer.tree, node => node.type === "Field" && node.props.label === label)[0];
      if (!field) throw Error("Missing field: " + label);
      const control = findAll(field, node => node.type === "select" || node.type === "input")[0];
      control.props.onChange({ target: { value } });
      await flush();
    },
    async event(value) {
      event = value;
      renderer.invalidate();
      await flush();
    },
    async preview(value) {
      preview = value;
      await advance(2000);
    },
    async run(value) {
      run = value;
      await advance(2000);
    },
    unmount() {
      renderer.unmount();
      panel = null;
      appPatch = null;
    },
  };
}
module.exports = { createCompactorHarness };
