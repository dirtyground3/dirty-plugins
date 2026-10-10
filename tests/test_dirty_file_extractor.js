"use strict";
const assert = require("node:assert/strict"),
  { requireSource } = require("./plugin_paths");
const { selectionFor, selectionLabel, taskRequest, pickerPathLabel } = requireSource(
  "DirtyFileExtractor",
  "src/domain/selection.ts",
);
const { createExtractionController } = requireSource("DirtyFileExtractor", "src/extraction.ts");

(async () => {
  for (const kind of ["scene", "marker", "image"]) {
    const selection = selectionFor(kind, new Set([1, "2"]));
    assert.deepEqual(selection.ids, ["1", "2"]);
    assert.deepEqual(taskRequest(selection).variables.args, { [kind + "_ids"]: ["1", "2"] });
    assert.match(selectionLabel(selection, false), /^Extract 2 selected/);
    assert.equal(selectionLabel(selection, true), "Queuing extraction…");
    assert.equal(selectionLabel(selectionFor(kind, [1]), false), "Extract selected " + kind);
  }
  assert.equal(pickerPathLabel("C:\\folder\\child\\"), "child");
  assert.equal(pickerPathLabel("/"), "/");
  assert.equal(pickerPathLabel(null), "Computer");
  let queued = 0,
    destination = "",
    release,
    published = 0;
  const notifications = [];
  const controller = createExtractionController({
    getSettings: async () => ({ destinationFolder: destination }),
    queueCopy: () => {
      queued++;
      return new Promise(resolve => {
        release = resolve;
      });
    },
    notify: (...args) => notifications.push(args),
    reportError() {},
  });
  const selection = selectionFor("scene", ["1"]);
  controller.subscribe(() => published++);
  await controller.startCopy(selection);
  assert.equal(queued, 0);
  assert.match(notifications[0][0], /No destination folder/);
  assert.equal(controller.state.busy, false);
  destination = "/output";
  const pending = controller.startCopy(selection);
  await Promise.resolve();
  await controller.startCopy(selection);
  assert.equal(queued, 1);
  assert.equal(controller.state.busy, true);
  release("job");
  await pending;
  assert.match(notifications.at(-1)[0], /File copy queued as job job/);
  assert.equal(controller.state.busy, false);
  assert.ok(published >= 3);
  console.log("DirtyFileExtractor typed selection and queue controller passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
