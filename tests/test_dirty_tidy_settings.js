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
    react: { html: htm.bind(element), SettingsSection: noop, SettingsToggle: noop, Field: noop, Pagination: noop,
      Button: noop, ActionMenu: noop, Badge: noop, Dialog: noop, SaveStatus: noop },
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
  variables: [["studio", "Studio name", "Studio"], ["year", "Year", "Date"], ["parent_studio", "Parent studio", "Studio"]],
});
const inserted = [];
const menu = views.variableMenuItems((token) => inserted.push(token));
assert.deepEqual(clean(menu.map((item) => item.header || text(item.label))),
  ["Studio", "Studio name {studio}", "Parent studio {parent_studio}", "Date", "Year {year}"], "variables are grouped in first-seen order");
menu[2].onSelect();
assert.deepEqual(inserted, ["{parent_studio}"]);
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
assert.equal(text(summary), "5All2Ready", "empty preview categories are hidden");

// Render the panel: compact strategy rows, one primary action, and a
// confirmation dialog that replaces the old inline confirm/run buttons.
let hookValues = {}, hookIndex = 0, panel;
// Components read props.children, so this element keeps them in props too.
const renderElement = (type, props, ...children) => ({ type, props: Object.assign({}, props, { children }), children });
const renderReact = {
  Fragment: "Fragment",
  createElement: renderElement,
  useState(initial) { const index = hookIndex++; return [Object.hasOwn(hookValues, index) ? hookValues[index] : (typeof initial === "function" ? initial() : initial), noop]; },
  useMemo: (fn) => fn(),
  useEffect: noop,
  useRef: (initial) => ({ current: initial }),
};
const components = Object.fromEntries(["SettingsSection", "SettingsToggle", "Field", "Pagination", "Button", "ActionMenu", "Badge", "Dialog", "SaveStatus"]
  .map((name) => [name, name]));
const renderWindow = { location: { search: "" }, PluginApi: { React: renderReact },
  DirtyPlugins: Object.assign({}, window.DirtyPlugins, { react: Object.assign({ html: htm.bind(renderElement) }, components),
    registerSettingsPanel: (_id, component) => { panel = component; } }) };
vm.runInNewContext(source, { window: renderWindow, console: { error: noop } });
const preview = { total: 3, strategy_hash: "b".repeat(64), summary: { ready: 2, moves: 2, renames: 1, blocked: 1 }, operations: [] };
// Hook order: 0 draft, 1 saved, 2 preview, ..., 8 open row, 10 confirming.
hookValues = { 0: Object.assign({}, window.__dirtyTidySettings.defaults, { automationMode: "scan" }), 2: preview, 8: "move", 10: true };
const tree = panel({ configuration: { automationMode: "scan" } });
const nodes = [];
(function visit(node) {
  if (Array.isArray(node)) return node.forEach(visit);
  if (!node || typeof node !== "object" || !Object.hasOwn(node, "type")) return;
  if (typeof node.type === "function") { hookIndex = 0; return visit(node.type(node.props)); }
  nodes.push(node);
  (node.children || []).forEach(visit);
})(tree);
const labels = nodes.filter((node) => node.type === "Button").map((node) => text(node.children));
assert.deepEqual(clean(labels.filter((label) => /Preview|Run|Save|Approve/.test(label))),
  ["Save", "Preview", "Run 2 operations…", "Approve without running", "Run now"]);
assert(nodes.some((node) => node.props["aria-label"] === "Folder level 1"), "open folder row shows its levels");
assert(nodes.some((node) => node.type === "ActionMenu" && node.props.label === "+ Variable"), "variables insert from a menu");
assert(!nodes.some((node) => node.props.id === "dirty-tidy-rename-pattern"), "closed rename row stays collapsed");
assert(nodes.some((node) => node.type === "Dialog" && node.props.open === true), "running asks for confirmation");
assert(nodes.some((node) => node.type === "Badge" && text(node.children) === "Needs approval"));

console.log("DirtyTidy settings normalization tests passed");
