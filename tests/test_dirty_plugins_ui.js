"use strict";
const assert = require("node:assert/strict");
const { createHubHarness } = require("./hub_harness");
const { loadFeature } = require("./shared_runtime");
const { requireSource } = require("./plugin_paths");

async function main() {
  const values = requireSource("DirtyPlugins", "src/shared/values.ts");
  const domain = requireSource("DirtyPlugins", "src/settings.ts");
  assert.deepEqual(values.asObject("[1,2]"), {});
  assert.deepEqual(values.pluginResult('{"output":"{\\"ok\\":true}"}'), { ok: true });
  assert.throws(() => values.pluginResult('{"error":"operation failed"}'), /operation failed/);
  assert.equal(values.parseMaybeJson("invalid JSON"), "invalid JSON");
  assert.equal(values.coerceBoolean(" FALSE ", true), false);
  assert.equal(values.clampInteger("bad", 3, 1, 10), 3);
  assert.equal(domain.serializeFieldValue("fixture", { name: "amount", type: "NUMBER" }, "5"), 5);
  assert.throws(
    () => domain.serializeFieldValue("fixture", { name: "amount", type: "NUMBER" }, "bad"),
    /must be a number/,
  );
  const inertWindow = {};
  for (const name of ["Save", "Jobs", "SettingsDraft", "Register"]) loadFeature(inertWindow, name);
  assert.deepEqual(inertWindow, {}, "imports have no browser registration effects");

  for (const missing of ["React", "register", "patch", "Link", "hook"]) {
    const h = createHubHarness({
      api(api) {
        if (missing === "React") delete api.React;
        if (missing === "register") delete api.register.route;
        if (missing === "patch") delete api.patch.instead;
        if (missing === "Link") delete api.libraries.ReactRouterDOM.Link;
        if (missing === "hook") delete api.React.useState;
      },
    });
    h.load();
    assert.equal(h.window.DirtyPlugins, undefined);
    assert.equal(h.patches.length, 0);
    assert.equal(h.registrations.length, 0);
  }
  for (const failure of ["SceneList", "PluginSettings", "route"]) {
    const h = createHubHarness({
      patch(name) {
        if (failure === name) throw new Error("controlled registration failure");
      },
      register() {
        if (failure === "route") throw new Error("controlled route failure");
      },
    });
    h.load();
    assert.equal(h.window.handlers.get("error")?.size || 0, 0, "failed initialization cleans up owned listeners");
    const before = [h.patches.length, h.registrations.length, h.requests.length];
    h.load();
    assert.deepEqual(
      [h.patches.length, h.registrations.length, h.requests.length],
      before,
      "failed guard prevents duplicate integrations",
    );
  }
  const h = createHubHarness();
  h.load();
  assert.equal(typeof h.window.DirtyPlugins.registerPlugin, "function", "the published hub is the registration guard");
  assert.deepEqual(
    h.patches.map(item => item.name),
    ["SceneList", "PluginSettings"],
  );
  const before = [h.patches.length, h.registrations.length, h.requests.length];
  h.load();
  assert.deepEqual([h.patches.length, h.registrations.length, h.requests.length], before);
  const hub = h.window.DirtyPlugins;
  for (const name of [
    "graphql",
    "runPluginOperation",
    "configurePlugin",
    "getPluginSettings",
    "createSaveController",
    "createJobHook",
    "registerPlugin",
    "registerSettingsPanel",
    "registerSettingsAddon",
  ])
    assert.equal(typeof hub[name], "function", name);
  for (const name of [
    "Button",
    "Field",
    "SettingsCard",
    "Dialog",
    "SceneFilterEditor",
    "StateView",
    "ActionMenu",
    "StatisticSelector",
    "usePageTitle",
    "useSettingsDraft",
  ])
    assert.equal(typeof hub.react[name], "function", name);
  // Members no plugin used were removed from the public API (pre-1.0 compatibility and internals).
  for (const name of [
    "runSharedOperation",
    "completedJob",
    "createReplayTracker",
    "fieldDefinition",
    "isInternalScan",
    "serializeSceneFilter",
    "fieldActions",
    "settingsPanels",
    "debugLogThrottled",
    "debugDescribe",
    "debugEnabled",
    "debugElapsed",
    "dumpDebugLogs",
    "settingsMetadata",
    "values",
    "unregisterFieldAction",
    "unregisterSettingsPanel",
    "unregisterSettingsAddon",
  ])
    assert.equal(hub[name], undefined, name);
  for (const name of ["html", "SettingsField"]) assert.equal(hub.react[name], undefined, name);
  assert.deepEqual(Object.keys(hub.ui).sort(), ["manageDialog", "notify"]);
  assert.equal(hub.theme.load, undefined);
  const numberField = domain.fieldDefinition("multiscreen", {
    name: "totalScreens",
    display_name: "Screens",
    type: "NUMBER",
  });
  assert.equal(numberField.kind, "number");
  assert.equal(numberField.min, 1);
  assert.equal(numberField.max, 36);
  assert.equal(domain.fieldDefinition("dirtyPlugins", { name: "visualTheme", type: "STRING" }).options.length, 7);
  assert.equal(domain.fieldDefinition("multiscreen", { name: "randomize", type: "BOOLEAN" }).kind, "checkbox");
  const patch = h.patches.find(item => item.name === "PluginSettings").callback;
  assert.equal(
    patch({ id: "unmanaged" }, () => "native settings"),
    "native settings",
  );
  assert.equal(patch({ id: "multiscreen" }, () => "native settings").props.pluginId, "multiscreen");
  const filter = requireSource("DirtyPlugins", "src/components/SceneFilter.tsx").serializeSceneFilter({
    makeFindFilter: () => ({ page: 2, per_page: 10, q: "fixture" }),
    makeQueryParameters: () => "page=2&per_page=10&q=fixture",
    makeFilter: () => ({ rating100: { value: 80 } }),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(filter)), {
    all: false,
    find: { q: "fixture" },
    query: "q=fixture",
    scene: { rating100: { value: 80 } },
  });

  await h.settle();
  assert.deepEqual(
    h.nodes(node => node.props.role === "tab").map(node => node.props.id),
    ["dirty-plugins-tab-dirtyPlugins", "dirty-plugins-tab-multiscreen"],
  );
  assert.equal(h.document.title, "Settings - DirtyMultiscreen");
  const inputs = h.nodes(node => node.type === "input");
  assert.deepEqual(
    inputs.map(node => node.props.id),
    ["dirty-plugin-multiscreen-totalScreens", "dirty-plugin-multiscreen-rows", "dirty-plugin-multiscreen-columns"],
  );
  inputs[0].props.onChange({ target: { value: "8" } });
  await h.settle();
  assert.match(h.text(), /Unsaved changes/);
  assert.equal(h.window.handlers.get("beforeunload").size, 1);
  assert.equal(h.requests.filter(request => request.variables?.args?.mode === "setSettings").length, 0);
  await h.tick();
  assert.equal(h.settings.multiscreen.totalScreens, 8);
  assert.match(h.text(), /Saved automatically/);
  assert.equal(h.window.handlers.get("beforeunload").size, 0);
  const write = h.requests.find(request => request.variables?.args?.mode === "setSettings").variables.args;
  assert.equal(write.expectedRevision, 1);
  assert.equal(write.settings.rows, 2);
  h.nodes(node => node.type === "input")[0].props.onChange({ target: { value: "invalid" } });
  await h.settle();
  await h.tick();
  assert.match(h.text(), /must be a number/);
  assert.equal(h.nodes(node => node.type === "input")[0].props.value, "invalid", "invalid drafts keep the raw input");
  assert.equal(h.settings.multiscreen.totalScreens, 8);
  h.nodes(node => node.type === "input")[0].props.onChange({ target: { value: "9" } });
  await h.settle();
  h.unmount();
  await h.tick();
  assert.equal(h.settings.multiscreen.totalScreens, 8, "unmount cancels pending saves");
  for (const name of [
    "beforeunload",
    "dirty-plugins:configuration-changed",
    "dirty-plugins:field-actions-changed",
    "dirty-plugins:settings-panels-changed",
  ])
    assert.equal(h.window.handlers.get(name)?.size || 0, 0, name);
  assert.equal(h.document.handlers.get("click")?.size || 0, 0);
  // Both real compiled bundles cooperate: hook dirty reports drive the existing
  // hub route's browser/tab protection, including rejecting a leave attempt.
  const combined = createHubHarness({
    confirm: false,
    settings: {
      dirtyPlugins: { visualTheme: "classic" },
      dirtyCompactor: { schemaVersion: 1, rules: [], automationPaused: true },
    },
    plugins: [
      { id: "dirtyPlugins", name: "DirtyPlugins", enabled: true, settings: [] },
      { id: "dirtyCompactor", name: "DirtyCompactor", enabled: true, settings: [] },
    ],
  });
  combined.load();
  combined.loadCompactor();
  await combined.settle();
  combined.nodes(node => node.props.id === "dirty-plugins-tab-dirtyCompactor")[0].props.onClick();
  await combined.settle();
  combined
    .nodes(node => node.type === "button" && require("./ui_harness").text(node) === "Add rule")[0]
    .props.onClick();
  await combined.settle();
  assert.equal(combined.window.handlers.get("beforeunload").size, 1);
  combined.window.DirtyPlugins.notifyConfigurationChanged("dirtyPlugins");
  await combined.settle();
  assert.equal(
    combined.nodes(node => node.type === "input" && node.props.value === "New rule").length,
    1,
    "unrelated settings refresh keeps the custom panel mounted and its workflow intact",
  );
  assert.equal(combined.window.handlers.get("beforeunload").size, 1);
  const unload = {
    preventDefault() {
      this.prevented = true;
    },
  };
  combined.window.emit("beforeunload", unload);
  assert.equal(unload.prevented, true);
  assert.equal(unload.returnValue, "");
  combined.nodes(node => node.props.id === "dirty-plugins-tab-dirtyPlugins")[0].props.onClick();
  await combined.settle();
  assert.equal(
    combined.nodes(node => node.props.id === "dirty-plugins-tab-dirtyCompactor")[0].props["aria-selected"],
    true,
  );
  assert.equal(combined.nodes(node => node.type === "input" && node.props.value === "New rule").length, 1);
  combined.unmount();
  await combined.tick(1000);
  assert.equal(combined.requests.filter(request => request.variables?.args?.mode === "setSettings").length, 0);
  assert.equal(combined.window.handlers.get("beforeunload").size, 0);
  console.log(
    "DirtyPlugins modules, host guards, partial failure, public compatibility, filters, tabs, autosave, validation and cleanup passed",
  );
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
