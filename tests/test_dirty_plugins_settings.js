"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHubHarness } = require("./hub_harness");
const { requireSource } = require("./plugin_paths");

const field = (h, name = "markerDuration") => h.nodes(node => node.props.id === "dirty-plugin-multiscreen-" + name)[0];
const edit = (h, value, name) => field(h, name).props.onChange({ target: { value } });
const writes = h => h.requests.filter(request => request.variables?.args?.mode === "setSettings");
const refresh = (h, pluginId) => h.window.DirtyPlugins.notifyConfigurationChanged(pluginId);
const response = output => ({
  ok: true,
  json: async () => ({ data: { runPluginOperation: JSON.stringify({ output }) } }),
});
function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test("custom panels own dirty state even when their generic numeric fields have no stored values", async () => {
  const h = createHubHarness({
    plugins: [
      { id: "multiscreen", name: "DirtyMultiscreen", settings: [{ name: "markerDuration", type: "NUMBER" }] },
      { id: "dirtyRank", name: "DirtyRank", settings: [{ name: "initialRating", type: "NUMBER" }] },
    ],
  });
  h.load();
  await h.settle();
  h.window.DirtyPlugins.registerSettingsPanel("dirtyRank", function CustomRankSettings() {
    return null;
  });
  await h.settle();
  assert.doesNotMatch(h.text(), /Unsaved changes/);
  assert.equal(h.window.handlers.get("beforeunload")?.size || 0, 0);
  h.unmount();
});

test("numeric metadata rejects blank, non-finite, fractional integer and out-of-range edits without writes", async () => {
  const h = createHubHarness();
  h.load();
  await h.settle();
  for (const value of ["bad", "Infinity", "0", "601", "1.5"]) {
    edit(h, value);
    await h.tick();
    assert.equal(field(h).props.value, value);
    assert.equal(writes(h).length, 0);
    assert.equal(h.settings.multiscreen.markerDuration, 30);
    assert.match(h.text(), /Unsaved changes/);
    assert.equal(h.window.handlers.get("beforeunload").size, 1);
  }
  for (const value of ["1", "600"]) {
    edit(h, value);
    await h.tick();
    assert.equal(h.settings.multiscreen.markerDuration, Number(value));
    assert.match(h.text(), /Saved automatically/);
    assert.doesNotMatch(h.text(), /Unsaved changes/);
  }
  assert.equal(writes(h).length, 2);
  assert.equal(field(h).props.placeholder, undefined);
  for (const value of ["", " "]) {
    edit(h, value);
    await h.tick();
    assert.equal(writes(h).length, 2, "a number without a placeholder cannot stay empty");
    assert.match(h.text(), /markerDuration must be a number/i);
  }
  assert.equal(h.settings.multiscreen.markerDuration, 600);
  h.unmount();

  const domain = requireSource("DirtyPlugins", "src/settings.ts");
  // Fractional steps use the authored minimum as their base; floating-point noise is harmless.
  const setting = { name: "amount", type: "NUMBER", metadata: { min: 0.1, max: 1, step: 0.1 } };
  assert.equal(domain.serializeFieldValue(setting, "0.3"), 0.3);
  assert.throws(() => domain.serializeFieldValue(setting, "0.35"), /increments of 0.1/);
  // A number with a placeholder may be emptied: null tells the save to remove the stored value.
  const optional = { name: "optional", type: "NUMBER", metadata: { placeholder: "Automatic" } };
  assert.equal(domain.fieldDefinition("fixture", optional).placeholder, "Automatic");
  assert.equal(domain.serializeFieldValue(optional, " "), null);
  assert.equal(domain.serializeFieldValue(optional, "3"), 3);
});

test("the installed package controls validation and defaults even when the plugin is disabled", async () => {
  const h = createHubHarness({
    plugins: [
      {
        id: "multiscreen",
        name: "DirtyMultiscreen",
        enabled: false,
        version: "2.0.0",
        settings: [
          { name: "tvModeDuration", type: "NUMBER" },
          { name: "markerDuration", type: "NUMBER" },
        ],
      },
    ],
  });
  const definition = h.settingsDefinitions.multiscreen;
  definition.version = "2.0.0";
  definition.settings.tvModeDuration = { ...definition.settings.tvModeDuration, max: 420, default: 45 };
  h.load();
  await h.settle();
  assert.match(h.text(), /Disabled/);
  assert.equal(field(h, "tvModeDuration").props.value, 45);
  assert.equal(field(h, "tvModeDuration").props.max, 420);
  edit(h, "421", "tvModeDuration");
  await h.tick();
  assert.match(h.text(), /must be at most 420/);
  assert.equal(writes(h).length, 0);
  edit(h, "420", "tvModeDuration");
  await h.tick();
  assert.equal(h.settings.multiscreen.tvModeDuration, 420);
  h.settings.multiscreen.tvModeDuration = 600;
  h.revisions.multiscreen++;
  refresh(h, "multiscreen");
  await h.settle();
  assert.equal(field(h, "tvModeDuration").props.value, 600, "older saved values stay visible");
  assert.doesNotMatch(h.text(), /Unsaved changes/);
  edit(h, "40");
  await h.tick();
  assert.equal(h.settings.multiscreen.markerDuration, 40);
  assert.equal(h.settings.multiscreen.tvModeDuration, 600, "saving another field preserves older stored values");
  h.unmount();
});

test("an older package can be edited and upgraded without touching other saved values", async () => {
  const h = createHubHarness();
  const multiscreen = h.plugins.find(plugin => plugin.id === "multiscreen");
  // The released 1.1.1 package ships no definition of its own; the hub's frozen copy describes it.
  multiscreen.version = "1.1.1";
  multiscreen.settings.push({ name: "listSizeLimit", type: "NUMBER" }, { name: "oldMode", type: "STRING" });
  const definition = h.settingsDefinitions.multiscreen;
  delete h.settingsDefinitions.multiscreen;
  h.settings.multiscreen.markerDuration = 34;
  h.settings.multiscreen.listSizeLimit = 20000;
  h.settings.multiscreen.tvModeDuration = 65;
  h.settings.multiscreen.rows = 4;
  h.settings.multiscreen.oldMode = "saved by the older plugin";
  h.load();
  await h.settle();
  assert.equal(field(h).props.value, 34);
  assert.equal(field(h, "listSizeLimit").props.value, 20000);
  assert.equal(field(h, "listSizeLimit").props.max, 100000, "the older package keeps its own limits");
  assert.equal(field(h, "tvModeDuration"), undefined, "a newer setting waits for the newer package");
  assert.equal(writes(h).length, 0, "loading legacy metadata never writes settings");
  edit(h, "35");
  await h.tick();
  assert.equal(h.settings.multiscreen.markerDuration, 35);
  assert.equal(h.settings.multiscreen.rows, 4, "hidden settings survive a write");
  assert.equal(h.settings.multiscreen.tvModeDuration, 65);

  multiscreen.version = "1.1.3-rc";
  multiscreen.settings = multiscreen.settings
    .filter(setting => setting.name !== "oldMode" && setting.name !== "listSizeLimit")
    .concat({ name: "tvModeDuration", type: "NUMBER" });
  definition.version = multiscreen.version;
  definition.settings.tvModeDuration.max = 420;
  h.settingsDefinitions.multiscreen = definition;
  refresh(h);
  await h.settle();
  assert.equal(field(h).props.value, 35);
  assert.equal(field(h, "tvModeDuration").props.value, 65);
  assert.equal(field(h, "tvModeDuration").props.max, 420);
  assert.equal(h.settings.multiscreen.oldMode, "saved by the older plugin");
  assert.equal(writes(h).length, 1, "loading upgraded metadata never rewrites settings");
  h.unmount();
});

test("an older Rank panel works with its own manifest and saved settings", async () => {
  const h = createHubHarness({
    plugins: [
      {
        id: "dirtyRank",
        name: "DirtyRank",
        version: "1.1.4-rc",
        settings: [{ name: "groupTopCount", type: "NUMBER" }],
      },
    ],
    settings: { dirtyRank: { groupTopCount: 50 } },
  });
  h.load();
  h.window.DirtyPlugins.registerSettingsPanel(
    "dirtyRank",
    ({ configuration }) => `Group size ${configuration.groupTopCount}`,
  );
  await h.settle();
  assert.match(h.text(), /Group size 50/);
  assert.equal(writes(h).length, 0);
  h.unmount();
});

test("a current package missing a matching definition leaves its stored values intact", async () => {
  for (const missing of [true, false]) {
    const h = createHubHarness();
    h.plugins.find(plugin => plugin.id === "multiscreen").version = "1.1.2";
    if (missing) delete h.settingsDefinitions.multiscreen;
    else h.settingsDefinitions.multiscreen.version = "0.0.0";
    h.load();
    await h.settle();
    assert.match(h.text(), /Install the current DirtyMultiscreen package/);
    assert.doesNotMatch(h.text(), /Reset to defaults|Unsaved changes/);
    assert.equal(field(h), undefined);
    assert.equal(h.settings.multiscreen.markerDuration, 30);
    assert.equal(writes(h).length, 0);
    h.unmount();
  }
});

test("capture masking comes from the installed field's definition", async () => {
  const h = createHubHarness({
    plugins: [
      { id: "extractScenes", name: "DirtyFileExtractor", settings: [{ name: "destinationFolder", type: "STRING" }] },
    ],
    settings: { extractScenes: { destinationFolder: "private fixture path" } },
  });
  h.window.location.search = "?plugin=extractScenes&docsCapture=1";
  h.load();
  await h.settle();
  const path = h.nodes(node => node.props.id === "dirty-plugin-extractScenes-destinationFolder")[0];
  assert.equal(path.props.value, "Path hidden for documentation");
  assert.equal(path.props.disabled, true);
  assert.equal(writes(h).length, 0);
  h.unmount();
});

test("unrelated events preserve valid pending and invalid raw drafts and fetch only the affected settings", async () => {
  for (const value of ["8", "invalid"]) {
    const h = createHubHarness();
    h.load();
    await h.settle();
    edit(h, value);
    await h.settle();
    const before = h.requests.length;
    refresh(h, "dirtyPlugins");
    await h.settle();
    assert.equal(field(h).props.value, value);
    assert.match(h.text(), /Unsaved changes/);
    const reads = h.requests.slice(before);
    assert.equal(reads.length, 1);
    assert.equal(reads[0].variables.args.mode, "getSettings");
    assert.equal(reads[0].variables.args.pluginId, "dirtyPlugins");
    await h.tick();
    assert.equal(field(h).props.value, value);
    assert.equal(h.settings.multiscreen.markerDuration, value === "8" ? 8 : 30);
    h.unmount();
  }
});

test("same-plugin refresh flushes pending edits before reading the saved baseline", async () => {
  const h = createHubHarness();
  h.load();
  await h.settle();
  edit(h, "8");
  const before = h.requests.length;
  refresh(h, "multiscreen");
  await h.settle();
  assert.deepEqual(
    h.requests.slice(before).map(request => request.variables.args.mode),
    ["setSettings", "getSettings"],
  );
  assert.equal(Number(field(h).props.value), 8);
  assert.equal(h.settings.multiscreen.markerDuration, 8);
  assert.doesNotMatch(h.text(), /Unsaved changes/);
  await h.tick();
  assert.equal(writes(h).length, 1);
  h.unmount();
});

test("reverting during an in-flight write retains the explicit field intent through a concurrent reload", async () => {
  const write = deferred();
  let firstWrite;
  const h = createHubHarness({
    fetch(request) {
      if (request.variables?.args?.mode === "setSettings" && !firstWrite) {
        firstWrite = request.variables.args;
        return write.promise;
      }
    },
  });
  h.load();
  await h.settle();
  edit(h, "8");
  await h.tick();
  refresh(h, "multiscreen");
  await h.settle();
  assert.equal(
    h.requests.filter(
      request => request.variables?.args?.pluginId === "multiscreen" && request.variables.args.mode === "getSettings",
    ).length,
    0,
    "the reload waits for the active write",
  );
  edit(h, "30");
  await h.tick();
  assert.equal(writes(h).length, 1, "the second write remains serialized");
  assert.match(h.text(), /Unsaved changes/);
  h.settings.multiscreen = firstWrite.settings;
  h.revisions.multiscreen = 2;
  write.resolve(response({ settings: firstWrite.settings, revision: 2 }));
  await h.settle();
  assert.equal(writes(h).length, 2);
  assert.equal(writes(h)[1].variables.args.expectedRevision, 2);
  assert.equal(field(h).props.value, "30");
  assert.equal(h.settings.multiscreen.markerDuration, 30);
  assert.doesNotMatch(h.text(), /Unsaved changes/);
  h.unmount();
});

test("out-of-order reloads cannot regress the draft, baseline or next write revision", async () => {
  const reads = [];
  const h = createHubHarness({
    fetch(request) {
      if (request.variables?.args?.mode === "getSettings" && request.variables.args.pluginId === "multiscreen") {
        const read = deferred();
        reads.push(read);
        return read.promise;
      }
    },
  });
  h.load();
  await h.settle();
  refresh(h, "multiscreen");
  await h.settle();
  refresh(h, "multiscreen");
  await h.settle();
  h.settings.multiscreen.markerDuration = 7;
  h.revisions.multiscreen = 3;
  reads[1].resolve(response({ settings: { markerDuration: 7, recentGrids: 5 }, revision: 3 }));
  await h.settle();
  reads[0].resolve(response({ settings: { markerDuration: 6, recentGrids: 5 }, revision: 2 }));
  await h.settle();
  assert.equal(field(h).props.value, 7);
  assert.doesNotMatch(h.text(), /Unsaved changes/);
  edit(h, "8");
  await h.tick();
  assert.equal(writes(h)[0].variables.args.expectedRevision, 3);
  assert.equal(h.settings.multiscreen.markerDuration, 8);
  h.unmount();
});

test("edits made during a reload keep their value while untouched fields adopt the new baseline", async () => {
  const read = deferred();
  const h = createHubHarness({
    fetch(request) {
      if (request.variables?.args?.mode === "getSettings" && request.variables.args.pluginId === "multiscreen")
        return read.promise;
    },
  });
  h.load();
  await h.settle();
  refresh(h, "multiscreen");
  await h.settle();
  edit(h, "8");
  h.settings.multiscreen.recentGrids = 8;
  h.revisions.multiscreen = 2;
  read.resolve(response({ settings: { markerDuration: 30, recentGrids: 8 }, revision: 2 }));
  await h.settle();
  assert.equal(field(h).props.value, "8");
  assert.equal(field(h, "recentGrids").props.value, 8);
  assert.match(h.text(), /Unsaved changes/);
  await h.tick();
  assert.equal(h.settings.multiscreen.markerDuration, 8);
  assert.equal(h.settings.multiscreen.recentGrids, 8, "the save merges only explicitly edited fields");
  assert.equal(writes(h)[0].variables.args.expectedRevision, 2);
  h.unmount();
});

test("unmount discards a late reload response", async () => {
  const read = deferred();
  const h = createHubHarness({
    fetch(request) {
      if (request.variables?.args?.mode === "getSettings" && request.variables.args.pluginId === "multiscreen")
        return read.promise;
    },
  });
  h.load();
  await h.settle();
  refresh(h, "multiscreen");
  await h.settle();
  h.unmount();
  const previous = h.text();
  read.resolve(response({ settings: { markerDuration: 7, recentGrids: 5 }, revision: 2 }));
  await h.settle();
  assert.equal(h.text(), previous);
  assert.equal(writes(h).length, 0);
  assert.equal(h.window.handlers.get("beforeunload")?.size || 0, 0);
});

test("reset to defaults asks first, then saves every setting at its schema default", async () => {
  const reset = h =>
    h.nodes(node => node.type === "button" && require("./ui_harness").text(node) === "Reset to defaults")[0];
  for (const confirm of [false, true]) {
    const h = createHubHarness({
      confirm,
      settings: { multiscreen: { markerDuration: 45, recentGrids: 8, randomize: true } },
    });
    h.load();
    await h.settle();
    assert.equal(reset(h).props.disabled, false);
    reset(h).props.onClick();
    await h.settle();
    await h.tick();
    if (!confirm) {
      assert.equal(writes(h).length, 0, "a declined reset changes nothing");
      assert.equal(field(h, "recentGrids").props.value, 8);
    } else {
      assert.equal(writes(h).length, 1);
      assert.deepEqual(
        h.settings.multiscreen,
        { markerDuration: 30, recentGrids: 5, randomize: true },
        "unreported keys are kept",
      );
      assert.equal(field(h).props.value, 30);
      assert.equal(reset(h).props.disabled, true, "nothing is left to reset");
      assert.match(h.text(), /Saved automatically/);
    }
    h.unmount();
  }
});
