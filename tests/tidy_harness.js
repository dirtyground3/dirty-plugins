"use strict";
const vm = require("node:vm"),
  { sourceFor } = require("./load_plugin_scripts");
const { createRenderer, findAll, text } = require("./ui_harness");
const { installJobHelpers, installRegistration } = require("./shared_runtime");
const copy = value => JSON.parse(JSON.stringify(value));
function createTidyHarness(options = {}) {
  let panel, appPatch, event;
  let configuration = copy(options.settings || {});
  let executionMode = configuration.automationMode || "manual";
  const patches = [],
    registrations = [],
    writes = [],
    calls = [],
    requests = [],
    sourceRequests = [],
    dirty = [],
    notifications = [],
    errors = [];
  // A Field renders its action next to the control.
  const renderer = createRenderer({ host: node => (node.type === "Field" ? [node.props.action] : []) });
  const React = {
    ...renderer.hooks,
    Fragment: Symbol("host Fragment"),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children }, children }),
  };
  const controls = Object.fromEntries(
    [
      "SettingsSection",
      "SettingsToggle",
      "Field",
      "Pagination",
      "Button",
      "ActionMenu",
      "Badge",
      "Dialog",
      "SaveStatus",
    ].map(name => [
      name,
      props => (name === "Dialog" && !props.open ? null : React.createElement(name, props, props.children)),
    ]),
  );
  const hub = {
    react: controls,
    notifyConfigurationChanged() {},
    captureEnabled: () => Boolean(options.capture),
    ui: { notify: message => notifications.push(message) },
    getPluginSettings: async () => (options.load ? options.load() : copy(configuration)),
    configurePlugin: async (id, settings) => {
      writes.push(copy(settings));
      if (options.save) await options.save(settings);
      configuration = copy(settings);
      return { revision: writes.length };
    },
    runPluginOperation: async (id, args) => {
      if (args.mode === "getTaskSettings")
        return { settings: options.load ? await options.load() : copy(configuration), revision: writes.length };
      if (args.mode === "saveTaskSettings") return hub.configurePlugin(id, args.settings);
      if (args.mode === "migrationStatus") return {};
      calls.push(copy(args));
      return options.operation
        ? options.operation(args)
        : {
            settings: copy(args.settings || configuration),
            strategy_hash: "b".repeat(64),
            plan_digest: "c".repeat(64),
            total: 1,
            summary: { ready: 1, moves: 1, renames: 0 },
            operations: [
              {
                file_id: "1",
                scene_id: "1",
                scene_title: "Synthetic",
                status: "ready",
                source_path: "/old/a.mp4",
                destination_path: "/new/a.mp4",
                actions: ["move"],
                warnings: [],
              },
            ],
          };
    },
    graphql: async (query, variables) => {
      if (query.includes("DirtyTidyTaggers")) {
        sourceRequests.push(query);
        if (options.sources) return options.sources();
        return { configuration: { general: { stashBoxes: [] } } };
      }
      requests.push({ query, variables: copy(variables) });
      return options.queue ? options.queue(variables) : { runPluginTask: "10" };
    },
    registerSettingsPanel(id, component) {
      registrations.push(id);
      panel = component;
      options.register?.();
    },
  };
  const window = {
    location: { search: options.capture ? "?docsCapture=1" : "" },
    DirtyPlugins: hub,
    PluginApi: {
      React,
      GQL: { useJobsSubscribeSubscription: () => ({ data: { jobsSubscribe: event } }) },
      patch: {
        after(name, callback) {
          patches.push(name);
          appPatch = callback;
          options.patch?.();
        },
      },
    },
  };
  installJobHelpers(window);
  const console = { error: (...args) => errors.push(args) };
  installRegistration(window, console);
  const context = vm.createContext({ window, console });
  const load = () => vm.runInContext(require("./task_test_entry").featureEntry("organization"), context);
  const render = () =>
    renderer.render([
      panel &&
        React.createElement(panel, {
          plugin: { id: "dirtyTasks" },
          configuration,
          executionMode,
          onDirtyChange: (id, value) => dirty.push(value),
        }),
      appPatch && appPatch(React.createElement("host-app", {})),
    ]);
  const flush = () => renderer.flush(render);
  return {
    window,
    context,
    hub,
    load,
    flush,
    writes,
    calls,
    requests,
    sourceRequests,
    dirty,
    notifications,
    patches,
    registrations,
    errors,
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
      return findAll(
        renderer.tree,
        node => (node.type === "Button" || node.type === "button") && text(node) === label,
      )[0];
    },
    async click(label) {
      const button = this.button(label);
      if (!button) throw Error("Missing button: " + label);
      button.props.onClick();
      await flush();
    },
    async input(label, value) {
      let control = findAll(renderer.tree, node => node.type === "input" && node.props["aria-label"] === label)[0];
      if (!control)
        control = findAll(
          findAll(renderer.tree, node => node.type === "Field" && node.props.label === label)[0],
          node => node.type === "input",
        )[0];
      if (!control) throw Error("Missing input: " + label);
      control.props.onChange({ target: { value } });
      await flush();
    },
    async toggle(label, value) {
      const node = findAll(
        renderer.tree,
        node => node.type === "SettingsToggle" && text(node.props.label) === label,
      )[0];
      if (!node) throw Error("Missing toggle: " + label);
      node.props.onChange(value);
      await flush();
    },
    async mode(value) {
      executionMode = value;
      renderer.invalidate();
      await flush();
    },
    async event(value) {
      event = value;
      renderer.invalidate();
      await flush();
    },
    async unmount() {
      panel = null;
      appPatch = null;
      renderer.invalidate();
      await flush();
    },
  };
}
module.exports = { createTidyHarness };
