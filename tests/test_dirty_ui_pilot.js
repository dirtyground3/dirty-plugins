"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const noop = function () {};
const React = {
  useRef(value) { return { current: value || null }; },
  useEffect: noop,
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
  libraries: { ReactRouterDOM: { Link: "a" }, Bootstrap: {
    ButtonGroup: "button-group",
    Dropdown: Object.assign(function Dropdown() {}, { Toggle: "dropdown-toggle", Menu: "dropdown-menu", Item: "dropdown-item" }),
    InputGroup: { Prepend: "input-group-prepend" },
  } },
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
const consoleMessages = [];
vm.runInNewContext(source, { window, document, console: {
  log: (...args) => consoleMessages.push(args),
  info: (...args) => consoleMessages.push(args),
  warn: noop, error: noop,
}, URLSearchParams });
assert.equal(consoleMessages.length, 0, "routine startup must be silent by default");
const debugHub = window.DirtyPlugins;
const retainedLogs = window.__dirtyPluginsDebugLog.length;
debugHub.debugLog("dirtyRank", "routine battle update");
assert.equal(consoleMessages.length, 0, "routine activity must not flood the console");
assert.equal(window.__dirtyPluginsDebugLog.length, retainedLogs + 1, "quiet mode retains diagnostic entries");
window.localStorage = { getItem: () => "1" };
assert.equal(debugHub.debugEnabled(), true, "persistent console logging requires explicit opt-in");
debugHub.debugLog("dirtyRank", "debug update");
assert.equal(consoleMessages.length, 1);
window.__dirtyPluginsDebug = false;
assert.equal(debugHub.debugEnabled(), false, "a page override can silence persistent debug logging");
window.localStorage = { getItem: () => "0" };
window.__dirtyPluginsDebug = true;
assert.equal(debugHub.debugEnabled(), true, "a page override can enable logging for this session");
delete window.__dirtyPluginsDebug;
assert.equal(debugHub.debugEnabled(), false);
window.localStorage = { getItem: () => { throw new Error("storage unavailable"); } };
assert.equal(debugHub.debugEnabled(), false, "blocked storage must keep default logging quiet");
delete window.localStorage;

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

const titleObservers = [];
window.MutationObserver = class {
  constructor(callback) { this.callback = callback; titleObservers.push(this); }
  observe(target) { assert.equal(target, document.head); this.connected = true; }
  disconnect() { this.connected = false; }
};
document.head = {};
document.title = "Scenes | Stash";
let titleCleanup;
// The hub captures useEffect when it loads, so load a fresh instance with an
// effect harness to exercise mount, navigation, and unmount behavior.
const titleWindow = { ...window, __dirtyPluginsSettingsHub: null, DirtyPlugins: {}, PluginApi: {
  ...api, React: { ...React, useEffect: effect => { titleCleanup = effect(); } }
} };
vm.runInNewContext(source, { window: titleWindow, document, console: { info: noop, warn: noop, error: noop }, URLSearchParams });
const usePageTitle = titleWindow.DirtyPlugins.react.usePageTitle;
usePageTitle("DirtyStats", "Dashboard");
assert.equal(document.title, "Dashboard - DirtyStats");
document.title = "Performers | Stash";
titleObservers.at(-1).callback();
assert.equal(document.title, "Dashboard - DirtyStats", "late native list titles must not replace the plugin title");
titleObservers.at(-1).callback();
titleCleanup();
assert.equal(document.title, "Scenes | Stash", "leaving restores the title from before the plugin route mounted");
assert.equal(titleObservers.at(-1).connected, false, "unmount disconnects title observation");
usePageTitle("DirtyStats", "Scene ratings");
assert.equal(document.title, "Scene ratings - DirtyStats", "navigation updates the view title");
document.title = "Studios | Stash";
titleCleanup();
assert.equal(document.title, "Studios | Stash", "cleanup preserves a title already set by the destination route");
delete titleWindow.MutationObserver;
usePageTitle("DirtyMultiscreen");
assert.equal(document.title, "DirtyMultiscreen");
titleCleanup();
assert.equal(document.title, "Studios | Stash", "the basic lifecycle works without MutationObserver");

titleWindow.MutationObserver = window.MutationObserver;
usePageTitle("DirtyRank", "Battles");
const battleTitleCleanup = titleCleanup;
usePageTitle("DirtyRank", "King of the Hill");
const kingTitleCleanup = titleCleanup;
let currentTitle = document.title;
let titleWrites = 0;
Object.defineProperty(document, "title", {
  configurable: true,
  get: () => currentTitle,
  set: value => { currentTitle = value; titleWrites++; },
});
// Deliver repeated mutation batches as a browser would after a title write.
// Competing observers previously wrote two titles forever, starving input.
for (let batch = 0; batch < 10; batch++) {
  titleObservers.filter(observer => observer.connected).forEach(observer => observer.callback());
}
assert.equal(titleWrites, 0, "overlapping route observers must settle without rewriting one another's titles");
document.title = "Native scene title";
titleWrites = 0;
titleObservers.filter(observer => observer.connected).forEach(observer => observer.callback());
assert.equal(document.title, "King of the Hill - DirtyRank");
assert.equal(titleWrites, 1, "only the active owner corrects a native title");
kingTitleCleanup();
assert.equal(document.title, "Battles - DirtyRank", "unmounting the active page restores the still-mounted owner");
battleTitleCleanup();
assert.equal(document.title, "Studios | Stash");
usePageTitle("DirtyRank", "Battles");
const prefixTitleCleanup = titleCleanup;
usePageTitle("DirtyRank", "Leaderboard");
const leaderboardTitleCleanup = titleCleanup;
prefixTitleCleanup();
assert.equal(document.title, "Leaderboard - DirtyRank", "older route cleanup must not overwrite the new page title");
leaderboardTitleCleanup();
assert.equal(document.title, "Studios | Stash", "out-of-order cleanup still restores the original title");

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
const sharedDialog = ui.Dialog({ open: false, ariaLabel: "Filters", children: "Filter content" });
assert.equal(sharedDialog.children[1].props.role, "dialog");
assert.equal(sharedDialog.children[1].props["aria-label"], "Filters");
assert.equal(sharedDialog.props.style.display, "none");

const navigation = ui.NavAction({ to: "/plugins/dirty-rank", label: "Rank battles", icon: "⚔" });
assert.equal(navigation.type, "a");
assert.equal(navigation.props["aria-label"], "Rank battles");
assert.equal(navigation.children.length, 1, "navigation should have one interactive element");

let chosenStatistic = null;
const statisticSelector = ui.StatisticSelector({ id: "stat", value: "overall", options: [
  { value: "overall", label: "Overall" }, { value: "faces", label: "Faces" },
], onSelect: value => { chosenStatistic = value; } });
assert.match(statisticSelector.props.className, /dirty-ui-statistic-selector/);
assert.equal(statisticSelector.children[0].children[0].props["aria-label"], "Statistic");
assert.equal(statisticSelector.children[0].children[0].children[0], "Overall");
assert.equal(statisticSelector.children[1].children[1].props.eventKey, "faces");
statisticSelector.props.onSelect("overall");
assert.equal(chosenStatistic, null, "selecting the current statistic does nothing");
statisticSelector.props.onSelect("faces");
assert.equal(chosenStatistic, "faces");

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

const keydownListeners = new Set();
document.addEventListener = (name, listener) => { if (name === "keydown") keydownListeners.add(listener); };
document.removeEventListener = (name, listener) => { if (name === "keydown") keydownListeners.delete(listener); };
document.querySelectorAll = () => [];
const opener = { isConnected: true, focus() { document.activeElement = this; } };
const managedDialog = { ...dialog, querySelector: () => firstFocus };
document.activeElement = opener;
let closed = 0;
const releaseDialog = hub.ui.manageDialog({ dialog: managedDialog, opener, onClose() { closed += 1; }, allowNativePopup: true });
assert.equal(document.activeElement, firstFocus, "a managed dialog focuses its first control");
assert.equal(bodyClasses.has("dirty-ui-modal-open"), true);
let topClosed = 0;
const topDialog = { ...dialog, querySelector: () => lastFocus };
const releaseTop = hub.ui.manageDialog({ dialog: topDialog, opener: firstFocus, onClose() { topClosed += 1; } });
for (const listener of keydownListeners) listener({ key: "Escape", preventDefault() {} });
assert.equal(closed, 0, "only the top dialog handles Escape");
assert.equal(topClosed, 1);
releaseTop();
const nativePopup = { classList: { contains: name => name === "show" }, contains: () => false };
document.querySelectorAll = () => [nativePopup];
for (const listener of keydownListeners) listener({ key: "Escape", preventDefault() {} });
assert.equal(closed, 0, "an open native popup keeps Escape for itself");
document.querySelectorAll = () => [];
for (const listener of keydownListeners) listener({ key: "Escape", preventDefault() {} });
assert.equal(closed, 1);
releaseDialog();
releaseDialog();
assert.equal(document.activeElement, opener, "dialog cleanup restores the opener once");
assert.equal(bodyClasses.has("dirty-ui-modal-open"), false);
assert.equal(keydownListeners.size, 0);
const emptyDialog = { querySelector: () => null, focus() { document.activeElement = this; } };
const releaseEmpty = hub.ui.manageDialog({ dialog: emptyDialog, opener });
assert.equal(document.activeElement, emptyDialog, "a dialog without controls remains focusable");
releaseEmpty();

assert.equal(hub.captureEnabled("?docsCapture=1"), true);
assert.equal(hub.captureEnabled("?censorMedia=1"), true);
assert.equal(hub.captureEnabled("?docsCapture=0"), false);
assert.equal(hub.captureUrl("/plugins/dirty-stats", "?docsCapture=1"), "/plugins/dirty-stats?docsCapture=1");
assert.equal(hub.captureUrl("/plugins/dirty-plugins?plugin=dirtyTidy", "?censorMedia=1"), "/plugins/dirty-plugins?plugin=dirtyTidy&docsCapture=1");
assert.equal(hub.captureUrl("/plugins/dirty-stats?docsCapture=0", "?docsCapture=1"), "/plugins/dirty-stats?docsCapture=1");
window.location.search = "?docsCapture=1";
assert.equal(hub.captureEnabled(window.location.search), true);
window.location.search = "?sortby=date&sortdir=asc";
assert.equal(hub.captureEnabled(window.location.search), true, "capture survives Stash's filter URL rewrite in this page");
assert.equal(hub.captureUrl("/plugins/dirty-stats/dashboard"), "/plugins/dirty-stats/dashboard?docsCapture=1");
window.location.search = "?docsCapture=0";
assert.equal(hub.captureEnabled(window.location.search), false, "an explicit off switch ends the capture session");
window.location.search = "";
assert.equal(hub.captureEnabled(window.location.search), false);

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
