"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHubHarness } = require("./hub_harness");

const field = (h, name = "useNavHub") => h.nodes(node => node.props.id === "dirty-plugin-dirtyPlugins-" + name)[0];
const reset = h => h.nodes(node => node.children.includes("Reset to defaults"))[0].props.onClick();

function fixture(settings) {
  const h = createHubHarness({
    plugins: [
      {
        id: "dirtyPlugins",
        name: "DirtyPlugins",
        settings: [
          { name: "showSettingsInMenu", type: "BOOLEAN" },
          { name: "useNavHub", type: "BOOLEAN" },
        ],
      },
    ],
    settings: { dirtyPlugins: settings },
  });
  const entries = new Map();
  let registrations = 0;
  const api = {
    register(entry) {
      registrations++;
      entries.set(entry.id, entry);
      return () => entries.delete(entry.id);
    },
  };
  return { h, entries, api, registrations: () => registrations };
}

test("Nav Hub integration is opt-in, saves automatically and unregisters when reset", async () => {
  const { h, entries, api, registrations } = fixture({});
  h.window.NavHub = api;
  h.load();
  await h.settle();
  assert.equal(field(h).props.checked, false);
  assert.equal(entries.size, 0);

  field(h).props.onChange({ target: { checked: true } });
  await h.settle();
  assert.equal(entries.size, 0, "wait for autosave before grouping the buttons");
  await h.tick();
  assert.equal(h.settings.dirtyPlugins.useNavHub, true);
  assert.deepEqual([...entries.keys()].sort(), [
    "dirtyMultiscreen",
    "dirtyPlugins",
    "dirtyRank-battles",
    "dirtyRank-leaderboards",
    "dirtyStats",
  ]);
  assert.equal(new Set([...entries.values()].map(entry => entry.selector)).size, entries.size);
  assert.ok([...entries.values()].every(entry => entry.selector && !entry.onClick));

  h.window.emit("navhub:ready");
  h.window.DirtyPlugins.notifyConfigurationChanged("dirtyPlugins");
  await h.settle();
  assert.equal(registrations(), 5, "a refresh does not replace existing registrations");
  reset(h);
  await h.tick();
  assert.equal(h.settings.dirtyPlugins.useNavHub, false);
  assert.equal(entries.size, 0);
  h.unmount();
});

test("Nav Hub setting is hidden and preserved until a compatible Nav Hub becomes available", async () => {
  const { h, entries, api } = fixture({ useNavHub: true, showSettingsInMenu: false });
  h.window.NavHub = {};
  h.load();
  await h.settle();
  assert.equal(field(h), undefined);
  assert.equal(entries.size, 0);
  reset(h);
  await h.tick();
  assert.equal(h.settings.dirtyPlugins.showSettingsInMenu, true);
  assert.equal(h.settings.dirtyPlugins.useNavHub, true, "reset preserves the hidden preference");

  h.window.NavHub = api;
  h.window.emit("navhub:ready");
  await h.settle();
  assert.equal(field(h).props.checked, true);
  assert.equal(entries.size, 5);

  field(h).props.onChange({ target: { checked: false } });
  await h.tick();
  assert.equal(h.settings.dirtyPlugins.useNavHub, false);
  assert.equal(entries.size, 0);
  h.unmount();
  assert.equal(h.window.handlers.get("navhub:ready")?.size, 0);
});
