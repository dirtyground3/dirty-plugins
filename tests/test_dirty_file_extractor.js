"use strict";
const assert = require("node:assert/strict"), {testModulePath} = require("./plugin_paths");
const {selectionFor, selectionLabel, taskRequest, pickerPathLabel} = require(testModulePath("DirtyFileExtractor", "selection.cjs"));
const {hasRelevantMutations} = require(testModulePath("DirtyFileExtractor", "mutations.cjs"));
const {createExtractionController} = require(testModulePath("DirtyFileExtractor", "extraction.cjs"));

(async () => {
  for (const kind of ["scene", "marker", "image"]) {
    const selection = selectionFor(kind, new Set([1, "2"])); assert.deepEqual(selection.ids, ["1", "2"]);
    assert.deepEqual(taskRequest(selection).variables.args, {[kind + "_ids"]: ["1", "2"]});
    assert.match(selectionLabel(selection, false), /^Extract 2 selected/); assert.equal(selectionLabel(selection, true), "Queuing extraction…");
    assert.equal(selectionLabel(selectionFor(kind, [1]), false), "Extract selected " + kind);
  }
  assert.equal(pickerPathLabel("C:\\folder\\child\\"), "child"); assert.equal(pickerPathLabel("/"), "/"); assert.equal(pickerPathLabel(null), "Computer");
  const unrelated = {nodeType: 3}, relevant = {nodeType: 1, matches: () => true}, nested = {nodeType: 1, querySelector: () => relevant};
  assert.equal(hasRelevantMutations([{addedNodes: [unrelated], removedNodes: []}]), false);
  assert.equal(hasRelevantMutations([{addedNodes: [], removedNodes: [nested]}]), true);
  let queued = 0, destination = "", release, published = 0; const notifications = [];
  const controller = createExtractionController({getSettings: async () => ({destinationFolder: destination}),
    queueCopy: () => {queued++; return new Promise(resolve => {release = resolve;});}, notify: (...args) => notifications.push(args), scheduleRender() {}, reportError() {}});
  const selection = selectionFor("scene", ["1"]); controller.subscribe(() => published++);
  await controller.startCopy(selection); assert.equal(queued, 0); assert.match(notifications[0][0], /No destination folder/); assert.equal(controller.state.busy, false);
  destination = "/output"; const pending = controller.startCopy(selection); await Promise.resolve();
  await controller.startCopy(selection); assert.equal(queued, 1); assert.equal(controller.state.busy, true);
  controller.destroy(); const before = notifications.length; release("job"); await pending;
  assert.equal(notifications.length, before); assert.equal(controller.state.busy, false); assert.ok(published >= 3);
  await controller.startCopy(selection); assert.equal(queued, 1);
  console.log("DirtyFileExtractor typed selection, filtered mutations and queue controller passed");
})().catch(error => {console.error(error); process.exitCode = 1;});
