"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { sourceFor } = require("./load_plugin_scripts");
const source = sourceFor("DirtyFileExtractor");
const patches = [];
const requests = [];
const cleanups = [];
const notifications = [];
let busy = false;
let nextFrame = 0;
let refCalls = 0;
let hasSelection = false;
const observers = [];
const noop = () => {};
const htm = require("../plugins/DirtyPlugins/vendor/htm.umd.js");
const element = (type, props, ...children) => ({ type, props: props || {}, children });
const toggle = { id: "more-menu", getAttribute: () => "true", click: noop };
const menu = { isConnected: true, getAttribute: () => "more-menu" };
const toolbar = {
  classList: { contains: () => hasSelection },
  getBoundingClientRect: () => ({ width: 760 }),
  querySelector: () => hasSelection ? toggle : null,
  style: { minWidth: "", justifyContent: "" },
};
const listRoot = { clientWidth: 1200, querySelector: selector => selector === ".filtered-list-toolbar" ? toolbar : null };
const window = {
  location: { pathname: "/performers/12", search: "" },
  DirtyPlugins: {
    react: { html: htm.bind(element) },
    registerFieldAction: noop,
    unregisterFieldAction: noop,
    getPluginSettings: () => Promise.resolve({ destinationFolder: "test-output" }),
    graphql: (query, variables) => { requests.push({ query, variables }); return Promise.resolve({ runPluginTask: "job-1" }); },
    ui: { notify: (...args) => notifications.push(args) },
  },
  PluginApi: {
    React: {
      Fragment: "fragment",
      createElement: element,
      useState: initial => initial === null ? [menu, noop] : [busy, value => { busy = value; }],
      useRef: initial => (++refCalls % 3 === 1 ? { current: { parentElement: listRoot } } : { current: initial }),
      useEffect: effect => { cleanups.push(effect()); },
    },
    ReactDOM: { createPortal: (content, target) => ({ type: "portal", content, target }) },
    patch: { after: (name, handler) => patches.push({ name, handler }) },
  },
  addEventListener: noop,
  removeEventListener: noop,
  requestAnimationFrame: () => ++nextFrame,
  cancelAnimationFrame: noop,
};
const context = vm.createContext({
  window, console,
  document: {
    currentScript: null, activeElement: null, body: {},
    querySelector: () => menu,
    getElementById: () => toggle,
  },
  MutationObserver: function (callback) { observers.push(callback); this.observe = noop; this.disconnect = noop; },
});
vm.runInContext(source, context);
assert.deepEqual(patches.map(patch => patch.name), ["SceneList", "SceneMarkerList", "ImageList"]);
const list = { type: "native-list" };
const flush = () => new Promise(resolve => setImmediate(resolve));

(async function () {
  for (const [index, kind] of ["scene", "marker", "image"].entries()) {
    const patch = patches[index];
    const unselected = patch.handler({ selectedIds: new Set() }, list);
    assert.equal(unselected.children[1], list, "unselected lists keep their native content");
    assert.equal(unselected.children[0].type(unselected.children[0].props).children[1], null,
      "the Extract menu action is absent without a selection");
    if (index === 0) {
      hasSelection = true;
      observers[0]();
      assert.equal(toolbar.style.minWidth, "760px", "selection preserves the toolbar's original width");
      assert.equal(toolbar.style.justifyContent, "flex-start", "native controls retain their left position");
      hasSelection = false;
      observers[0]();
      assert.equal(toolbar.style.minWidth, "", "toolbar styling resets when selection clears");
    }
    assert.equal(patch.handler({}, list), list, "non-selectable lists pass through unchanged");
    hasSelection = true;
    const result = patch.handler({ selectedIds: new Set(["on-page", "other-page"]) }, list);
    assert.equal(result.type, "fragment");
    assert.equal(result.children[1], list, "native list and its controls are preserved");
    const action = result.children[0];
    const tree = action.type(action.props);
    assert.equal(tree.children[0].props.className, "dirty-file-extractor-action-anchor", "anchor does not take list space");
    assert.equal(tree.children[1].type, "portal", "action renders in the existing actions menu");
    assert.equal(tree.children[1].target, menu);
    const button = tree.children[1].content;
    assert.equal(button.type, "button");
    assert.match(button.props.className, /dropdown-item/);
    assert.match(button.children[0], /Extract 2 selected/);
    button.props.onClick();
    button.props.onClick();
    assert.equal(busy, true, "all actions become busy while a task is queued");
    await flush();
    assert.equal(requests.length, index + 1, "rapid duplicate clicks queue only one task");
    assert.deepEqual(Array.from(requests[index].variables.args[kind + "_ids"]), ["on-page", "other-page"],
      "the native selection includes items from other pages, without scraping checked DOM boxes");
    assert.equal(busy, false, "the action becomes available after queuing");
    hasSelection = false;
  }
  assert.equal(notifications.length, 3);
  const oldPatch = patches[0];
  vm.runInContext(source, context);
  assert.equal(oldPatch.handler({ selectedIds: new Set(["1"]) }, list), list,
    "reload deactivates older patches instead of stacking action rows");
  const reloaded = patches[3].handler({ selectedIds: new Set(["1"]) }, list);
  hasSelection = true;
  assert.equal(reloaded.children[1], list);
  assert.equal(reloaded.children[0].type(reloaded.children[0].props).children[1].content.children[0],
    "Extract selected scene");
  cleanups.filter(Boolean).forEach(cleanup => cleanup());
  console.log("DirtyFileExtractor selection actions, performer-page support, queueing and reload tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
