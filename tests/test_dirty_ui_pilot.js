"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const noop = function () {};
const React = {
  createElement(type, props, ...children) {
    const flat = children.flat();
    const nextProps = { ...(props || {}) };
    if (flat.length) nextProps.children = flat.length === 1 ? flat[0] : flat;
    return { type, props: nextProps, children: flat };
  },
  isValidElement(value) { return Boolean(value && typeof value === "object" && "type" in value); },
  cloneElement(element, override) {
    return { type: element.type, props: { ...element.props, ...override }, children: element.children };
  },
};
const api = {
  React,
  libraries: { ReactRouterDOM: { Link: "a" } },
  patch: { instead: noop },
  register: { route: noop },
  components: {},
  loadableComponents: { PerformerCard: "performer-module", ScenePlayer: "scene-module" },
  utils: {},
};
const window = {
  PluginApi: api,
  addEventListener: noop,
  location: { pathname: "/plugins/dirty-rank" },
};
const document = { currentScript: null, addEventListener: noop };
const source = fs.readFileSync(path.join(__dirname, "../plugins/DirtyPlugins/dirtyPlugins.js"), "utf8");
vm.runInNewContext(source, { window, document, console: { info: noop, warn: noop, error: noop }, URLSearchParams });

for (const filename of ["../plugins/DirtyPlugins/dirtyPlugins.css", "../plugins/DirtyRank/dirtyRank.css", "../plugins/DirtyStats/dirtyStats.css", "../plugins/DirtyTidy/dirtyTidy.css", "../plugins/DirtyFileExtractor/extractScenes.css", "../plugins/DirtyMultiscreen/multiscreen.css"]) {
  const css = fs.readFileSync(path.join(__dirname, filename), "utf8");
  const structural = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
  let depth = 0;
  for (const character of structural) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    assert(depth >= 0, `${filename} has an unmatched closing brace`);
  }
  assert.equal(depth, 0, `${filename} has an unmatched opening brace`);
  assert(!/,\s*@(media|supports|keyframes)/.test(structural), `${filename} has a dangling selector before an at-rule`);
}

const hub = window.DirtyPlugins;
const ui = hub.react;
assert(hub && ui, "the shared hub should expose the pilot components");
assert.equal(hub.theme.defaultKey, "classic", "the hub owns the suite's default visual theme");

const input = React.createElement("input", { type: "number", "aria-describedby": "existing-help" });
const field = ui.Field({ id: "rank-weight", label: "Weight", help: "Positive only", error: "Enter a weight", children: input });
assert.equal(field.children[0].props.htmlFor, "rank-weight");
assert.equal(field.children[1].props.id, "rank-weight");
assert.equal(field.children[1].props["aria-invalid"], "true");
assert.equal(field.children[1].props["aria-describedby"], "existing-help rank-weight-help rank-weight-error");
assert.equal(field.children[2].props.id, "rank-weight-help");
assert.equal(field.children[3].props.id, "rank-weight-error");

const busyButton = ui.Button({ tone: "danger", busy: true, compact: true, children: "Reset" });
assert.equal(busyButton.type, "button");
assert.equal(busyButton.props.type, "button");
assert.equal(busyButton.props.disabled, true);
assert.equal(busyButton.props["aria-busy"], "true");
assert.match(busyButton.props.className, /dirty-ui-control-compact/);
const quietButton = ui.Button({ tone: "quiet", children: "More" });
assert.match(quietButton.props.className, /dirty-ui-control-quiet/);
const alert = ui.SaveStatus({ state: "error", message: "Save failed" });
assert.equal(alert.props.role, "alert");
assert.equal(alert.props["data-state"], "error");

const navigation = ui.NavAction({ to: "/plugins/dirty-rank", label: "Rank battles", icon: "⚔" });
assert.equal(navigation.type, "a");
assert.equal(navigation.props["aria-label"], "Rank battles");
assert.equal(navigation.children.length, 1, "navigation should have one interactive element");

let page = 2;
const pagination = ui.Pagination({ page: 2, totalPages: 3, onPageChange: value => { page = value; } });
assert.equal(pagination.props["aria-label"], "Pages");
ui.Button(pagination.children[0].props).props.onClick();
assert.equal(page, 1);
ui.Button(pagination.children[2].props).props.onClick();
assert.equal(page, 3);
assert.equal(ui.Pagination({ page: 1, totalPages: 1 }), null);

const firstFocus = { disabled: false, getClientRects: () => [1], focus() { document.activeElement = this; } };
const lastFocus = { disabled: false, getClientRects: () => [1], focus() { document.activeElement = this; } };
const dialog = { querySelectorAll: () => [firstFocus, lastFocus], contains: item => item === firstFocus || item === lastFocus, focus() { document.activeElement = this; } };
document.activeElement = lastFocus;
let prevented = false;
hub.ui.trapDialogTab({ key: "Tab", shiftKey: false, preventDefault() { prevented = true; } }, dialog);
assert.equal(prevented, true);
assert.equal(document.activeElement, firstFocus, "Tab wraps to the first dialog control");
document.activeElement = firstFocus;
hub.ui.trapDialogTab({ key: "Tab", shiftKey: true, preventDefault() {} }, dialog);
assert.equal(document.activeElement, lastFocus, "Shift+Tab wraps to the last dialog control");
const bodyClasses = new Set();
document.body = { classList: { add: name => bodyClasses.add(name), remove: name => bodyClasses.delete(name) } };
const unlockFirst = hub.ui.lockBodyScroll();
const unlockSecond = hub.ui.lockBodyScroll();
unlockFirst();
assert.equal(bodyClasses.has("dirty-ui-modal-open"), true, "a second dialog keeps background scroll locked");
unlockSecond();
assert.equal(bodyClasses.has("dirty-ui-modal-open"), false);

assert.equal(hub.captureEnabled("?docsCapture=1"), true);
assert.equal(hub.captureEnabled("?censorMedia=1"), true);
assert.equal(hub.captureEnabled("?docsCapture=0"), false);
assert.equal(hub.captureUrl("/plugins/dirty-stats", "?docsCapture=1"), "/plugins/dirty-stats?docsCapture=1");
assert.equal(hub.captureUrl("/plugins/dirty-plugins?plugin=dirtyTidy", "?censorMedia=1"), "/plugins/dirty-plugins?plugin=dirtyTidy&docsCapture=1");
assert.equal(hub.captureUrl("/plugins/dirty-stats?docsCapture=0", "?docsCapture=1"), "/plugins/dirty-stats?docsCapture=1");

async function checkNativeLoading() {
  const NativeCard = function NativeCard() {};
  let loadCount = 0;
  api.utils.loadComponents = modules => {
    loadCount += 1;
    assert.deepEqual(Array.from(modules), ["performer-module"]);
    api.components.PerformerCard = NativeCard;
    return Promise.resolve();
  };
  const [first, second] = await Promise.all([
    hub.native.loadComponent("PerformerCard"),
    hub.native.loadComponent("PerformerCard"),
  ]);
  assert.equal(first, NativeCard);
  assert.equal(second, NativeCard);
  assert.equal(loadCount, 1, "concurrent consumers should share a single native load");
  api.loadableComponents.SceneList = "scene-module";
  api.utils.loadComponents = modules => {
    loadCount += 1;
    assert.deepEqual(Array.from(modules), ["scene-module"]);
    api.components.FilteredSceneList = function FilteredSceneList() {};
    api.components.SceneCard = function SceneCard() {};
    return Promise.resolve();
  };
  const [sceneParts, dashboardParts] = await Promise.all([
    hub.native.ensureComponents("SceneList", ["FilteredSceneList", "SceneCard"]),
    hub.native.ensureComponents("SceneList", ["FilteredSceneList"]),
  ]);
  assert.equal(sceneParts.length, 2);
  assert.equal(dashboardParts.length, 1);
  assert.equal(loadCount, 2, "native bundle consumers should share one load");
  await assert.rejects(hub.native.loadComponent("NotAvailable"), /does not expose/);
  console.log("Dirty UI pilot component tests passed");
}

checkNativeLoading().catch(error => { console.error(error); process.exitCode = 1; });
