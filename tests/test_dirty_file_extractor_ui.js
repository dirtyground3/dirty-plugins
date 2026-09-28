"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../plugins/DirtyFileExtractor/extractScenes.js"), "utf8");
const patches = [];
const requests = [];
const cleanups = [];
const notifications = [];
let busy = false;
let nextFrame = 0;
const noop = () => {};
const SharedButton = function SharedButton() {};
const window = {
  location: { pathname: "/performers/12", search: "" },
  DirtyPlugins: {
    react: { Button: SharedButton },
    registerFieldAction: noop,
    unregisterFieldAction: noop,
    getPluginSettings: () => Promise.resolve({ destinationFolder: "test-output" }),
    graphql: (query, variables) => { requests.push({ query, variables }); return Promise.resolve({ runPluginTask: "job-1" }); },
    ui: { notify: (...args) => notifications.push(args) },
  },
  PluginApi: {
    React: {
      Fragment: "fragment",
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      useState: () => [busy, value => { busy = value; }],
      useEffect: effect => { cleanups.push(effect()); },
    },
    patch: { after: (name, handler) => patches.push({ name, handler }) },
  },
  addEventListener: noop,
  removeEventListener: noop,
  requestAnimationFrame: () => ++nextFrame,
  cancelAnimationFrame: noop,
};
const context = vm.createContext({
  window, console,
  document: { currentScript: null, activeElement: null },
  MutationObserver: function () { throw new Error("native selection actions must not need a body observer"); },
});
vm.runInContext(source, context);
assert.deepEqual(patches.map(patch => patch.name), ["SceneList", "SceneMarkerList", "ImageList"]);
const list = { type: "native-list" };
const flush = () => new Promise(resolve => setImmediate(resolve));

(async function () {
  for (const [index, kind] of ["scene", "marker", "image"].entries()) {
    const patch = patches[index];
    assert.equal(patch.handler({ selectedIds: new Set() }, list), list, "unselected lists pass through unchanged");
    assert.equal(patch.handler({}, list), list, "non-selectable lists pass through unchanged");
    const result = patch.handler({ selectedIds: new Set(["on-page", "other-page"]) }, list);
    assert.equal(result.type, "fragment");
    assert.equal(result.children[1], list, "native list and its controls are preserved");
    const action = result.children[0];
    const tree = action.type(action.props);
    assert.equal(tree.props.className, "dirty-file-extractor-selection-actions", "action has its own row in document flow");
    const button = tree.children[0];
    assert.equal(button.type, SharedButton);
    assert.match(button.children[0], /Extract 2 selected/);
    button.props.onClick();
    button.props.onClick();
    assert.equal(busy, true, "all actions become busy while a task is queued");
    await flush();
    assert.equal(requests.length, index + 1, "rapid duplicate clicks queue only one task");
    assert.deepEqual(Array.from(requests[index].variables.args[kind + "_ids"]), ["on-page", "other-page"],
      "the native selection includes items from other pages, without scraping checked DOM boxes");
    assert.equal(busy, false, "the action becomes available after queuing");
  }
  assert.equal(notifications.length, 3);
  const oldPatch = patches[0];
  vm.runInContext(source, context);
  assert.equal(oldPatch.handler({ selectedIds: new Set(["1"]) }, list), list,
    "reload deactivates older patches instead of stacking action rows");
  const reloaded = patches[3].handler({ selectedIds: new Set(["1"]) }, list);
  assert.equal(reloaded.children[1], list);
  assert.equal(reloaded.children[0].type(reloaded.children[0].props).children[0].children[0], "Extract selected scene");
  cleanups.filter(Boolean).forEach(cleanup => cleanup());
  console.log("DirtyFileExtractor selection actions, performer-page support, queueing and reload tests passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
