"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHubHarness } = require("./hub_harness");
const { requireSource, runSource } = require("./plugin_paths");

const field = (h, name = "totalScreens") => h.nodes(node => node.props.id === "dirty-plugin-multiscreen-" + name)[0];
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
      { id: "multiscreen", name: "DirtyMultiscreen", settings: [{ name: "totalScreens", type: "NUMBER" }] },
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
  for (const value of ["", " ", "bad", "Infinity", "0", "37", "1.5"]) {
    edit(h, value);
    await h.tick();
    assert.equal(field(h).props.value, value);
    assert.equal(writes(h).length, 0);
    assert.equal(h.settings.multiscreen.totalScreens, 4);
    assert.match(h.text(), /Unsaved changes/);
    assert.equal(h.window.handlers.get("beforeunload").size, 1);
  }
  for (const value of ["1", "36"]) {
    edit(h, value);
    await h.tick();
    assert.equal(h.settings.multiscreen.totalScreens, Number(value));
    assert.match(h.text(), /Saved automatically/);
    assert.doesNotMatch(h.text(), /Unsaved changes/);
  }
  assert.equal(writes(h).length, 2);
  h.unmount();

  // Fractional steps use the authored minimum as their base; floating-point noise is harmless.
  const constants = requireSource("DirtyPlugins", "src/constants.ts");
  const domain = runSource(
    "DirtyPlugins",
    "src/settings.ts",
    {},
    {
      external: ["./constants"],
      modules: {
        "./constants": {
          ...constants,
          FIELD_LIMITS: { fixture: { amount: { min: 0.1, max: 1, step: 0.1 } } },
          FIELD_INTEGERS: { fixture: new Set() },
        },
      },
    },
  );
  const setting = { name: "amount", type: "NUMBER" };
  assert.equal(domain.serializeFieldValue("fixture", setting, "0.3"), 0.3);
  assert.throws(() => domain.serializeFieldValue("fixture", setting, "0.35"), /increments of 0.1/);
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
    assert.equal(h.settings.multiscreen.totalScreens, value === "8" ? 8 : 4);
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
  assert.equal(h.settings.multiscreen.totalScreens, 8);
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
  edit(h, "4");
  await h.tick();
  assert.equal(writes(h).length, 1, "the second write remains serialized");
  assert.match(h.text(), /Unsaved changes/);
  h.settings.multiscreen = firstWrite.settings;
  h.revisions.multiscreen = 2;
  write.resolve(response({ settings: firstWrite.settings, revision: 2 }));
  await h.settle();
  assert.equal(writes(h).length, 2);
  assert.equal(writes(h)[1].variables.args.expectedRevision, 2);
  assert.equal(field(h).props.value, "4");
  assert.equal(h.settings.multiscreen.totalScreens, 4);
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
  h.settings.multiscreen.totalScreens = 7;
  h.revisions.multiscreen = 3;
  reads[1].resolve(response({ settings: { totalScreens: 7, rows: 2, columns: 2 }, revision: 3 }));
  await h.settle();
  reads[0].resolve(response({ settings: { totalScreens: 6, rows: 2, columns: 2 }, revision: 2 }));
  await h.settle();
  assert.equal(field(h).props.value, 7);
  assert.doesNotMatch(h.text(), /Unsaved changes/);
  edit(h, "8");
  await h.tick();
  assert.equal(writes(h)[0].variables.args.expectedRevision, 3);
  assert.equal(h.settings.multiscreen.totalScreens, 8);
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
  h.settings.multiscreen.rows = 3;
  h.revisions.multiscreen = 2;
  read.resolve(response({ settings: { totalScreens: 4, rows: 3, columns: 2 }, revision: 2 }));
  await h.settle();
  assert.equal(field(h).props.value, "8");
  assert.equal(field(h, "rows").props.value, 3);
  assert.match(h.text(), /Unsaved changes/);
  await h.tick();
  assert.equal(h.settings.multiscreen.totalScreens, 8);
  assert.equal(h.settings.multiscreen.rows, 3, "the save merges only explicitly edited fields");
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
  read.resolve(response({ settings: { totalScreens: 7, rows: 2, columns: 2 }, revision: 2 }));
  await h.settle();
  assert.equal(h.text(), previous);
  assert.equal(writes(h).length, 0);
  assert.equal(h.window.handlers.get("beforeunload")?.size || 0, 0);
});
