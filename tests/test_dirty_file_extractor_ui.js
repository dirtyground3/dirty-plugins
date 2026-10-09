"use strict";
const assert = require("node:assert/strict");
const {createExtractorHarness} = require("./extractor_harness");
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};

(async () => {
  const h = createExtractorHarness(); h.load();
  assert.deepEqual(h.patches.map(patch => patch.name), ["SceneList", "SceneMarkerList", "ImageList"]);
  assert.equal(typeof h.fieldAction.onClick, "function", "Browse captures the initialized imported picker");
  for (const [index, kind] of ["scene", "marker", "image"].entries()) {
    h.select(false); const empty = h.mount(index, []);
    assert.equal(empty.tree.children[1], empty.native); assert.equal(empty.render().children[1], null);
    h.select(true); assert.equal(h.toolbar.style.minWidth, "760px");
    h.root.clientWidth = 600; h.select(true); assert.equal(h.toolbar.style.minWidth, "600px"); h.root.clientWidth = 1200;
    h.select(false); assert.equal(h.toolbar.style.minWidth, ""); empty.unmount();
    h.select(true); const mounted = h.mount(index, ["on-page", "other-page"]);
    assert.equal(mounted.tree.children[1], mounted.native);
    const portal = mounted.render().children[1]; assert.equal(portal.type, "portal"); assert.equal(portal.target, h.menu);
    const button = portal.content; assert.match(button.children[0], /Extract 2 selected/);
    button.props.onClick(); button.props.onClick(); assert.equal(mounted.render().children[1].content.props.disabled, true);
    await h.flush(); assert.equal(h.requests.length, index + 1);
    assert.deepEqual(Array.from(h.requests[index].variables.args[kind + "_ids"]), ["on-page", "other-page"]);
    assert.equal(h.requests[index].variables.description, "Copy files for 2 selected " + (kind === "image" ? "images" : kind + "s"));
    assert.equal(mounted.render().children[1].content.props.disabled, false); mounted.unmount();
    assert.equal(h.patches[index].handler({}, mounted.native), mounted.native);
  }
  h.load(); assert.equal(h.patches.length, 3, "duplicate bundles cannot install non-removable patches again");
  h.open(); await h.flush();
  const input = h.pickerNode("form-control"), status = h.pickerNode("dirty-file-extractor-picker-status");
  assert.equal(input.value, "/exports"); assert.match(status.textContent, /1 subfolder/);
  h.pickerNode("dirty-file-extractor-folder").click(); await h.flush(); assert.equal(input.value, "/exports/subfolder");
  const dialog = h.pickerNode("dirty-ui-dialog"); dialog.children.at(-1).children[1].click(); await h.flush();
  assert.equal(h.writes[0].destinationFolder, "/exports/subfolder"); assert.equal(h.writes[0].unknown, "preserved");
  assert.equal(h.configurationEvents, 1); assert.equal(h.body.children.length, 0); assert.equal(h.dialogReleases, 1);
  assert.equal(h.document.activeElement.focused, true);
  h.open(); await h.flush(); h.window.__extractScenesFloatingAction.destroy();
  assert.equal(h.fieldAction, null); assert.equal(h.frames.size, 0); assert.equal(h.body.children.length, 0);
  assert.ok(h.observers.every(observer => observer.disconnected)); assert.ok([...h.window.handlers.values()].every(set => !set.size));
  assert.equal(h.toolbar.style.minWidth, ""); h.load(); assert.equal(h.patches.length, 3);
  const native = {type: "native"}; assert.equal(h.patches[0].handler({selectedIds: new Set(["1"])}, native), native);

  for (const failPatch of [1, 2, 3]) {
    const failing = createExtractorHarness({failPatch}); failing.load(); failing.load();
    assert.equal(failing.patches.length, failPatch); assert.equal(failing.window.__extractScenesFloatingAction.status, "failed");
    assert.equal(failing.fieldAction, null); assert.ok([...failing.window.handlers.values()].every(set => !set.size));
    assert.equal(failing.patches[0].handler({selectedIds: new Set(["1"])}, native), native);
  }
  const missing = createExtractorHarness(); delete missing.window.PluginApi; missing.load();
  assert.equal(missing.patches.length, 0); assert.equal(missing.window.__extractScenesFloatingAction, undefined);
  const reversible = createExtractorHarness({register: () => {throw Error("field registration failure");}}); reversible.load();
  assert.equal(reversible.window.__extractScenesFloatingAction, undefined); assert.equal(reversible.fieldAction, null);

  const loading = deferred(), late = createExtractorHarness({getSettings: () => loading.promise}); late.load(); late.select(true);
  const action = late.mount(0, ["1"]); action.render().children[1].content.props.onClick(); late.window.__extractScenesFloatingAction.destroy();
  loading.resolve({destinationFolder: "/exports"}); await late.flush(); assert.equal(late.requests.length, 0); assert.equal(late.notifications.length, 0);

  const first = deferred(), second = deferred(); let directoryRequest = 0;
  const race = createExtractorHarness({graphql: () => (++directoryRequest === 1 ? first.promise : second.promise)}); race.load(); race.open(); await race.flush();
  race.pickerNode("form-control").value = "/new";
  race.pickerNode("form-control").emit("keydown", {key: "Enter", preventDefault() {}}); await race.flush();
  second.resolve({directory: {path: "/new", directories: []}}); await race.flush();
  first.resolve({directory: {path: "/old", directories: []}}); await race.flush(); assert.equal(race.pickerNode("form-control").value, "/new");
  race.window.__extractScenesFloatingAction.destroy();
  const fallback = createExtractorHarness({settings: {destinationFolder: "/missing"}, graphql: (query, args) => {
    if (args.path) throw Error("missing folder"); return {directory: {path: "/home", directories: []}};
  }}); fallback.load(); fallback.open(); await fallback.flush(); assert.equal(fallback.pickerNode("form-control").value, "/home");
  assert.equal(fallback.requests[1].variables.path, null); fallback.window.__extractScenesFloatingAction.destroy();

  const save = deferred(), concurrent = createExtractorHarness({save: () => save.promise}); concurrent.load(); concurrent.open(); await concurrent.flush();
  concurrent.pickerNode("dirty-ui-dialog").children.at(-1).children[1].click(); await concurrent.flush();
  concurrent.open(); await concurrent.flush(); const newer = concurrent.pickerNode("dirty-ui-dialog");
  save.resolve(); await concurrent.flush(); assert.equal(concurrent.pickerNode("dirty-ui-dialog"), newer, "old save cannot close a newer dialog");
  concurrent.window.__extractScenesFloatingAction.destroy();
  const capture = createExtractorHarness({capture: true, save: () => {throw Error("Conflict in /private/path");}}); capture.load(); capture.open(); await capture.flush();
  assert.equal(capture.pickerNode("form-control").disabled, true); assert.equal(capture.pickerNode("form-control").value, "Path hidden for documentation");
  assert.equal(capture.pickerNode("dirty-file-extractor-folder").textContent, "Folder 1");
  const use = capture.pickerNode("dirty-ui-dialog").children.at(-1).children[1]; use.click(); await capture.flush();
  assert.equal(use.disabled, false); assert.equal(capture.body.textContent.includes("/private"), false);
  assert.equal(capture.pickerNode("dirty-file-extractor-picker-status").textContent, "Folder unavailable during documentation capture.");
  capture.window.__extractScenesFloatingAction.destroy();
  const oldHub = createExtractorHarness({fallback: true}); oldHub.load(); oldHub.frame();
  const relevant = {nodeType: 1, matches: () => true}; oldHub.observers[0].callback([{addedNodes: [], removedNodes: [relevant]}]);
  oldHub.observers[0].callback([{addedNodes: [relevant], removedNodes: []}]); assert.equal(oldHub.timers.size, 1);
  oldHub.window.__extractScenesFloatingAction.destroy(); assert.equal(oldHub.timers.size, 0); assert.equal(oldHub.body.children.length, 0);
  console.log("DirtyFileExtractor bundle selection, queueing, picker, races, masking, guards and cleanup passed");
})().catch(error => {console.error(error); process.exitCode = 1;});
