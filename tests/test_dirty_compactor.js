"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadPluginScripts } = require("./load_plugin_scripts");
let registrations = 0;
const window = { PluginApi: { React: {}, patch: { after() {} } }, DirtyPlugins: {
  react: { SceneFilterEditor() {}, html() {} }, registerSettingsPanel() { registrations++; },
} };
const context = vm.createContext({ window });
loadPluginScripts("DirtyCompactor", context);
loadPluginScripts("DirtyCompactor", context);
assert.equal(registrations, 1, "asset reload must not duplicate registrations");
const a = window.__dirtyCompactorPlugin.algorithms;
const rule = a.newRule();
assert.equal(rule.enabled, false);
assert.equal(rule.mode, "manual");
assert.equal(rule.format, "keep");
assert.equal(a.validation({ rules: [rule] }), "");
rule.enabled = true;
assert.match(a.validation({ rules: [rule] }), /filter/);
rule.condition.all = true;
assert.equal(a.validation({ rules: [rule] }), "");
rule.mbps = "bad";
assert.match(a.validation({ rules: [rule] }), /bitrate/);
rule.mbps = 4;
rule.width = "";
assert.match(a.validation({ rules: [rule] }), /Dimensions/);
rule.action = "reencode";
assert.equal(a.validation({ rules: [rule] }), "", "reencode does not use hidden resize dimensions");
assert.equal(a.filterSummary({ all: true }), "All scenes");
assert.equal(a.bytes(1024), "1.00 KiB");

let settingsPanel;
let hookIndex = 0;
let hookValues = {};
const React = {
  Fragment: "Fragment",
  createElement(type, props, ...children) { return { type, props: props || {}, children }; },
  useState(initial) { const index = hookIndex++; return [Object.hasOwn(hookValues, index) ? hookValues[index] : initial, () => {}]; },
  useRef(initial) { return { current: initial }; },
  useEffect() {},
};
const ui = Object.fromEntries(["SettingsCard", "SettingsSection", "SettingsToggle", "Badge", "Button", "Field",
  "SceneFilterEditor", "StateView", "Pagination", "SaveStatus", "Dialog"].map(name => [name, name]));
ui.usePageTitle = () => {};
const renderWindow = { location: { search: "" }, PluginApi: { React, patch: { after() {} } }, DirtyPlugins: {
  react: ui, captureEnabled: () => false, registerSettingsPanel(id, component) { settingsPanel = component; },
} };
const renderContext = vm.createContext({ window: renderWindow });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../plugins/DirtyPlugins/vendor/htm.umd.js"), "utf8"), renderContext);
ui.html = renderContext.htm.bind(React.createElement);
loadPluginScripts("DirtyCompactor", renderContext);
assert.equal(typeof settingsPanel, "function", "HTM asset must load before the settings panel");

const sampleRule = a.newRule();
sampleRule.condition.all = true;
const operation = { id: "op-1", sceneId: 1, title: "Scene", source: "source.mp4", destination: "output.mp4",
  rule: sampleRule, status: "ready", savings: 100, dimensions: [1920, 1080] };
const preview = { id: "preview-1", status: "ready", total: 1, operations: [operation], counts: { ready: 1 },
  readyActions: { resize: 1, reencode: 0, delete: 0 }, page: 1, pages: 1 };
const run = { id: "run-1", status: "running", total: 1, operations: [operation], page: 1, pages: 1,
  review: { operationId: "op-1", title: "Scene", url: "/preview", originalSize: 200, outputSize: 100,
    original: { width: 1920, height: 1080, codec: "h264", bitrate: 2000000 },
    output: { width: 1280, height: 720, codec: "h264", bitrate: 1000000 }, encoder: "cpu", destination: "output.mp4" } };
hookValues = { 4: preview, 6: run };
let root = settingsPanel({ configuration: { rules: [sampleRule], automationPaused: false } });
const nodes = [];
function visit(value) {
  if (Array.isArray(value)) return value.forEach(visit);
  if (!value || typeof value !== "object" || !Object.hasOwn(value, "type")) return;
  if (typeof value.type === "function") {
    hookIndex = 0;
    hookValues = {};
    return visit(value.type(value.props));
  }
  nodes.push(value);
  value.children.forEach(visit);
}
visit(root);
assert(nodes.some(node => node.type === "SettingsToggle" && node.props.label === "Automation active" && node.props.checked === true));
assert(nodes.some(node => node.type === "Button" && node.children.includes("Add rule")));
assert(nodes.some(node => node.type === "Field"), "rule editor must render");
assert(nodes.some(node => node.type === "table"), "preview and run results must render");
assert(nodes.some(node => node.type === "video"), "output review must render");
console.log("DirtyCompactor UI algorithms and registration passed");
