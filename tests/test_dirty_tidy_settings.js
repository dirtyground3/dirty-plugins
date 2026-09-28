"use strict";
// Parity contract for DirtyTidy settings normalization. The expectations here
// mirror plugins/DirtyTidy/dirty_tidy.py normalize_settings() and the matching
// assertions in tests/test_dirty_tidy.py. If one side changes, both tests must.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { sourceFor } = require("./load_plugin_scripts");

const source = sourceFor("DirtyTidy");
const noop = () => {};
const htm = require("../plugins/DirtyPlugins/vendor/htm.umd.js");
const element = (type, props, ...children) => ({ type, props: props || {}, children });

const window = {
  PluginApi: {
    React: { createElement: noop, useEffect: noop, useMemo: noop, useRef: noop, useState: noop },
  },
  DirtyPlugins: {
    registerSettingsPanel: noop,
    react: { html: htm.bind(element), SettingsCard: noop, SettingsSection: noop, SettingsToggle: noop, Field: noop, Pagination: noop, IconButton: noop },
    values: {
      asObject: (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {}),
    },
  },
};
vm.runInNewContext(source, { window, console: { error: noop } });
const a = window.__dirtyTidyPlugin.algorithms;
// Values cross the vm realm boundary, so compare plain JSON copies.
const clean = (value) => JSON.parse(JSON.stringify(value));

const defaults = {
  moveEnabled: true,
  moveRequireStashId: false,
  hierarchyLevels: ["{studio}", "{year}"],
  renameEnabled: false,
  renameRequireStashId: false,
  renamePattern: "{date} - {studio} - {title}",
  maxFilenameLength: 180,
  multiValueSeparator: ", ",
  automationMode: "manual",
  approvedStrategyHash: "",
  approvedPlanDigest: "",
};
assert.deepEqual(clean(a.settingsFromConfiguration(undefined)), defaults, "missing configuration uses the shared defaults");

const canonical = a.settingsFromConfiguration({
  hierarchyLevels: ["  {studio} ", "", { template: "{year}" }],
  renamePattern: "  {title}  ",
  maxFilenameLength: "250",
  multiValueSeparator: "abcdefghijklmnop",
  automationMode: " Scan ",
  moveEnabled: "yes",
});
assert.deepEqual(clean(canonical.hierarchyLevels), ["{studio}", "{year}"]);
assert.equal(canonical.renamePattern, "{title}");
assert.equal(canonical.maxFilenameLength, 250);
assert.equal(canonical.multiValueSeparator, "abcdefghij");
assert.equal(canonical.automationMode, "scan");
assert.equal(canonical.moveEnabled, true);

// The backend must never see different values than the panel shows: an explicit
// empty list stays empty instead of reverting to the defaults it would never plan with.
const empties = a.settingsFromConfiguration({
  hierarchyLevels: [],
  renamePattern: "",
  multiValueSeparator: null,
  maxFilenameLength: null,
});
assert.deepEqual(clean(empties.hierarchyLevels), []);
assert.equal(empties.renamePattern, "");
assert.equal(empties.multiValueSeparator, ", ");
assert.equal(empties.maxFilenameLength, 180);

assert.deepEqual(
  clean(a.settingsFromConfiguration({ hierarchyLevels: null }).hierarchyLevels),
  ["{studio}", "{year}"],
  "a missing list falls back to the defaults, but an explicit empty list does not"
);

// Adopting the server's normalized settings and normalizing again is a no-op.
assert.deepEqual(clean(a.settingsFromConfiguration(canonical)), clean(canonical));
assert.deepEqual(clean(a.settingsFromConfiguration(empties)), clean(empties));

// The preview views render through the shared htm template tag.
const text = (node) => node == null || node === false ? "" :
  Array.isArray(node) ? node.map(text).join("") :
  typeof node === "object" ? text(node.children) : String(node);
const find = (node, match) => {
  if (Array.isArray(node)) return node.map((child) => find(child, match)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return match(node) ? node : find(node.children, match);
};
const views = window.__dirtyTidyPreview.createPreview({
  html: window.DirtyPlugins.react.html,
  React: { Fragment: "Fragment" },
  DirtyPlugins: {},
  variables: [["studio", "Studio name"]],
});
const picker = views.VariablePicker({ onInsert: noop });
assert.equal(picker.type, "div");
assert.equal(picker.props["aria-label"], "Template variables");
assert.equal(text(picker), "{studio}");
const table = views.PreviewTable({ operations: [{
  file_id: 1, status: "blocked", source_path: "/a.mp4", destination_path: "/b.mp4",
  warnings: ["Collision"], blocked_scenes: [{ id: "7", title: "First" }, { id: "8" }],
}] });
const row = find(table, (node) => node.type === "tr" && node.props.className);
assert.equal(row.props.className, "dirty-tidy-row-blocked");
assert.equal(text(row), "blocked/a.mp4/b.mp4");
const notes = views.PreviewNotes(find(row, (node) => node.props.operation).props);
assert.equal(text(notes), "CollisionBlocked scenes: First, Scene 8");
assert.equal(text(views.PreviewTable({ operations: [] })), "No operations match this filter.");
const summary = views.Summary({ summary: { ready: 2 }, total: 5, value: "ready", onChange: noop });
const ready = find(summary, (node) => node.props["aria-pressed"] === true);
assert.equal(ready.props.className.includes("dirty-tidy-summary-active"), true);
assert.equal(text(ready), "2Ready");

console.log("DirtyTidy settings normalization tests passed");
