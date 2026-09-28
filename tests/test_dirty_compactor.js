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
assert.equal(rule.quality, "balanced", "new rules use a quality preset instead of a raw bitrate");
assert.equal(a.validation({ rules: [rule] }), "");
rule.enabled = true;
assert.match(a.validation({ rules: [rule] }), /filter/);
rule.condition.all = true;
assert.equal(a.validation({ rules: [rule] }), "");
rule.mbps = "bad";
assert.equal(a.validation({ rules: [rule] }), "", "presets ignore the hidden custom bitrate");
rule.quality = "custom";
assert.match(a.validation({ rules: [rule] }), /bitrate/);
rule.mbps = 4;
delete rule.quality;
assert.equal(a.validation({ rules: [rule] }), "", "rules saved before presets keep their custom bitrate");
assert.equal(a.targetMbps({ quality: "balanced", codec: "h264" }, 1920, 1080), 5);
assert.equal(a.targetMbps({ quality: "balanced", codec: "hevc" }, 3840, 2160), 8.49);
assert.equal(a.targetMbps({ quality: "small", codec: "hevc" }, 854, 480), 0.53);
assert.equal(a.targetMbps({ quality: "custom", mbps: "2.5", codec: "h264" }, 3840, 2160), 2.5);
assert.equal(a.actionSummary({ action: "resize", width: 1280, height: 720, codec: "hevc", quality: "small" }), "Resize · max 720p · H.265 · smallest files");
assert.equal(a.actionSummary({ action: "reencode", codec: "h264", quality: "custom", mbps: 3 }), "Reencode · H.264 · 3 Mbps");
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
  "SceneFilterEditor", "StateView", "Pagination", "SaveStatus", "Dialog", "ActionMenu", "Metric"].map(name => [name, name]));
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
// Settings state order: 4 preview, 6 run, 15 open rule editor.
hookValues = { 4: preview, 6: run, 15: sampleRule.id };
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
assert(nodes.some(node => node.type === "SettingsToggle" && node.props.label === "Automatic runs" && node.props.checked === true));
assert(nodes.some(node => node.type === "Button" && node.children.includes("Add rule")));
assert(nodes.some(node => node.type === "Field"), "open rule editor must render");
assert(nodes.some(node => node.type === "Field" && node.props.label === "Quality"), "encoding rules offer quality presets");
assert(!nodes.some(node => node.type === "Field" && /bitrate/i.test(node.props.label)), "custom bitrate stays hidden for presets");
const ruleMenu = nodes.find(node => node.type === "ActionMenu" && /^Actions for/.test(node.props.ariaLabel));
assert.equal(JSON.stringify(ruleMenu.props.items.map(item => item.label)), JSON.stringify(["Close editor", "Move up", "Move down", "Duplicate", "Delete rule"]));
assert(nodes.some(node => node.type === "Metric" && node.props.label === "Estimated savings"), "preview leads with totals");
assert(!nodes.some(node => node.type === "table"), "file tables stay collapsed until requested");
assert(nodes.some(node => node.type === "Button" && node.children.includes("Show files")));
assert(nodes.some(node => node.type === "video"), "output review must render");
console.log("DirtyCompactor UI algorithms and registration passed");
