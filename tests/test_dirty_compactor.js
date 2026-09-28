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
assert.equal(a.targetMbps({ quality: "balanced", codec: "h264" }, 1920, 1080, 60), 7.07, "matches the backend's frame-rate factor");
assert.equal(a.targetMbps({ quality: "source", codec: "hevc" }, 1920, 1080, 30, 7500000), 7.5);
assert.equal(a.actionSummary({ action: "reencode", codec: "hevc", quality: "source" }), "Reencode · H.265 · same bitrate");
const rulesApi = window.__dirtyCompactorRules;
const hd = { size: 100e6, duration: 100, width: 1920, height: 1080, bit_rate: 50e6, frame_rate: 30 };
const balanced = { action: "reencode", codec: "h264", quality: "balanced" };
assert.equal(Math.round(rulesApi.fileSaving(balanced, hd)), 34618000, "5 Mbps video + typical audio, with the planner's 2% margin");
assert.equal(rulesApi.fileSaving(balanced, Object.assign({}, hd, { bit_rate: 4e6 })), 0, "already below target");
assert.equal(rulesApi.fileSaving({ action: "resize", width: 1920, height: 1080, codec: "h264", quality: "balanced" }, hd), 0, "already within the resolution");
assert(rulesApi.fileSaving({ action: "resize", width: 1280, height: 720, codec: "h264", quality: "balanced" }, hd) > 34618000);
assert.equal(rulesApi.fileSaving({ action: "reencode", codec: "hevc", quality: "source" }, hd), 0, "conversions are not counted as savings");
assert.equal(rulesApi.fileSaving({ action: "delete" }, hd), 100e6);
assert.equal(JSON.stringify(rulesApi.outputSize(1080, 1920, { action: "resize", width: 1280, height: 720 })), "[720,1280]", "portrait keeps orientation");
const sampled = rulesApi.estimate(balanced, { count: 10, filesize: 1e9, scenes: [{ files: [hd] }] });
assert.equal(Math.round(sampled.saved), 346180000, "sample savings scale to the filter's total size");
assert.equal(sampled.exact, false);
assert.equal(rulesApi.estimate({ action: "delete" }, { count: 10, filesize: 5e9, scenes: [] }).saved, 5e9, "delete frees the whole filter exactly");
assert.equal(a.actionSummary({ action: "resize", width: 1280, height: 720, codec: "hevc", quality: "small" }), "Resize · max 720p · H.265 · smallest files");
assert.equal(a.actionSummary({ action: "reencode", codec: "h264", quality: "custom", mbps: 3 }), "Reencode · H.264 · 3 Mbps");
rule.width = "";
assert.match(a.validation({ rules: [rule] }), /Dimensions/);
rule.action = "reencode";
assert.equal(a.validation({ rules: [rule] }), "", "reencode does not use hidden resize dimensions");
assert.equal(a.filterSummary({ all: true }), "All scenes");
// Mirrors Stash's ListFilterModel.getEncodedParams: braces become parentheses
// outside strings, then the criterion is URI-encoded as one c= parameter.
function stashQuery(criteria) {
  return criteria.map(criterion => {
    let quoted = false, escaped = false;
    const json = [...JSON.stringify(criterion)].map(c => {
      if (escaped) { escaped = false; return c; }
      if (c === "\\" && quoted) escaped = true;
      else if (c === "\"") quoted = !quoted;
      else if (!quoted && c === "{") return "(";
      else if (!quoted && c === "}") return ")";
      return c;
    }).join("");
    let encoded = encodeURI(json);
    for (const c of "?#&;=+") encoded = encoded.replaceAll(c, encodeURIComponent(c));
    return "c=" + encoded;
  }).join("&") + "&sortby=date";
}
const labelled = { query: stashQuery([
  { type: "tags", modifier: "INCLUDES_ALL", value: { items: [{ id: "1", label: "Outdoor (sunny)" }, { id: "2", label: "B&W" }], excluded: [{ id: "3", label: "Amateur" }], depth: 0 } },
  { type: "resolution", modifier: "GREATER_THAN", value: "1080p" },
  { type: "rating100", modifier: "LESS_THAN", value: { value: 50 } },
  { type: "duration", modifier: "BETWEEN", value: { value: 90, value2: 3725 } },
  { type: "organized", value: "false" },
  { type: "path", modifier: "MATCHES_REGEX", value: "\\.wmv$" },
  { type: "performers", modifier: "IS_NULL" },
]), scene: { tags: {} }, find: { q: "beach" } };
assert.equal(a.filterSummary(labelled), "Search “beach” · Tags: all of Outdoor (sunny), B&W, not Amateur · Resolution > 1080p · " +
  "Rating < 2.5 stars · Duration between 1:30 and 1:02:05 · Organized: no · Path matches “\\.wmv$” · Performers is empty");
assert.equal(a.filterSummary(labelled, true).split(" · ")[1], "Tags: all of 2 tags, not 1 tag", "documentation capture hides names");
assert.equal(a.filterSummary({ scene: { resolution: { value: "FOUR_K", modifier: "EQUALS" }, rating100: { value: 20, modifier: "LESS_THAN" },
  studios: { value: ["4", "5"], modifier: "INCLUDES", depth: 0 }, organized: true } }),
"Resolution = 4K · Rating < 1 star · Studio: 2 studios · Organized: yes", "scene filters without a saved query still read naturally");
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
const preview = { id: "preview-1", status: "ready", total: 16, operations: [operation], counts: { ready: 1, unchanged: 12, blocked: 3 },
  skipReasons: [["Already at or below target bitrate", 12], ["Scene has files shared with another scene", 3]],
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
const flat = node => typeof node === "string" ? node : Array.isArray(node) ? node.map(flat).join("") : node && node.children ? flat(node.children) : "";
assert(nodes.some(node => node.type === "Metric" && node.props.value === "1 file"), "counts are pluralized");
const skippedBox = nodes.find(node => node.props && node.props.className === "dirty-compactor-skipped");
assert.equal(flat(skippedBox), "Why 15 files were skipped12 Already at or below target bitrate3 Scene has files shared with another scene");
assert(nodes.some(node => node.type === "Button" && node.children.includes("Show files")));
assert(nodes.some(node => node.type === "video"), "output review must render");
console.log("DirtyCompactor UI algorithms and registration passed");
