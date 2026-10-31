"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { runtimePath, requireSource, runSource } = require("./plugin_paths");
const { scriptPaths } = require("./load_plugin_scripts");
const { createCompactorHarness } = require("./compactor_harness");
const { text } = require("./ui_harness");
const rules = requireSource("DirtyTasks", "src/encoding/domain/rules.ts");
const rule = { ...rules.newRule(), condition: { all: true }, name: "Fixture rule" };
const settings = { rules: [rule], automationPaused: true };
const file = {
  id: "op",
  sceneId: "1",
  title: "Synthetic",
  source: "synthetic.mp4",
  rule,
  status: "ready",
  dimensions: [320, 180],
  savings: 100,
};
const preview = {
  id: "preview",
  status: "ready",
  total: 16,
  page: 1,
  pages: 2,
  operations: [file],
  counts: { ready: 1, unchanged: 12, blocked: 3 },
  readyActions: { resize: 1, reencode: 0, delete: 0 },
  skipReasons: [
    ["Already at or below target bitrate", 12],
    ["Scene has files shared with another scene", 3],
  ],
};
const run = { id: "run", status: "running", total: 1, page: 1, pages: 1, operations: [file] };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

async function registration() {
  const h = createCompactorHarness({ settings });
  h.load();
  h.load();
  assert.deepEqual(h.registrations, ["dirtyTasks"]);
  assert.deepEqual(h.patches, ["App"]);
  assert.equal(h.window.__dirtyCompactorRules, undefined);
  assert.equal(h.window.__dirtyCompactorAutomation, undefined);
  assert.equal(h.appPatch("host-result").type, h.window.PluginApi.React.Fragment);
  assert.equal(h.appPatch("host-result").children[0], "host-result");
  // Reentrant loads see the guard while the first registration is in progress.
  let reentrant;
  reentrant = createCompactorHarness({
    register() {
      reentrant.load();
    },
  });
  reentrant.load();
  assert.equal(reentrant.registrations.length, 1);
  const absent = createCompactorHarness();
  delete absent.window.DirtyPlugins;
  absent.load();
  assert.equal(absent.registrations.length, 0, "without the hub nothing registers");
  const partial = createCompactorHarness({
    patch() {
      throw Error("patch fixture");
    },
  });
  partial.load();
  partial.load();
  assert.equal(partial.patches.length, 1, "a failed registration is logged once and never retried");
  assert.match(String(partial.errors[0][0]), /\[dirtyTasks\] registration failed/);
  assert.deepEqual(
    scriptPaths("DirtyTasks").map(file => require("node:path").basename(file)),
    ["dirtyTasks.js"],
  );
  const bundle = fs.readFileSync(runtimePath("DirtyTasks", "dirtyTasks.js"), "utf8");
  assert(!bundle.includes("sourceMappingURL"), "release bundles carry no source map");
  // Importing a component module registers nothing and needs no host to evaluate.
  assert.equal(typeof runSource("DirtyTasks", "src/automation.tsx", { window: {} }).AutomationMonitor, "function");
}

async function editingAndSaving() {
  const h = createCompactorHarness({ settings, preview });
  h.load();
  await h.flush();
  assert.equal(h.dirty.at(-1), false);
  assert(h.nodes(node => node.type === "Metric" && node.props.label === "Estimated size difference").length);
  assert.equal(h.nodes(node => node.type === "table").length, 0);
  assert.equal(
    text(h.nodes(node => node.props?.className === "dirty-compactor-skipped")[0]),
    "Why 15 files were skipped12 Already at or below target bitrate3 Scene has files shared with another scene",
  );
  await h.click("Show files");
  assert.equal(h.nodes(node => node.type === "table").length, 1);
  const menu = h.nodes(node => node.type === "ActionMenu" && /^Actions for/.test(node.props.ariaLabel))[0];
  assert.deepEqual(
    Array.from(menu.props.items, item => item.label),
    ["Edit", "Move up", "Move down", "Duplicate", "Delete rule"],
  );
  menu.props.items[0].onSelect();
  await h.flush();
  assert(h.nodes(node => node.type === "Field" && node.props.label === "Quality").length);
  assert.equal(h.nodes(node => node.type === "Field" && /bitrate/i.test(node.props.label)).length, 0);
  await h.field("Quality", "custom");
  await h.field("Video bitrate (Mbps)", "");
  assert.equal(h.dirty.at(-1), true);
  assert.equal(h.button("Preview").props.disabled, true);
  assert.equal(h.nodes(node => node.type === "SaveStatus")[0].props.state, "invalid");
  await h.advance(500);
  assert.equal(h.writes.length, 0, "invalid raw input cannot persist");
  const raw = h.nodes(node => node.type === "input" && node.props.type === "number")[0];
  assert.equal(raw.props.value, "", "keep the invalid input visible");
  assert.equal(
    h.nodes(node => node.type === "SettingsSection" && node.props.title === "Preview").length,
    0,
    "edits invalidate the preview",
  );
  await h.field("Video bitrate (Mbps)", "2.5");
  await h.advance(500);
  assert.equal(h.writes.length, 1);
  assert.equal(
    h.writes[0].rules[0].mbps,
    "2.5",
    "preserve raw settings representation until the existing backend normalizes it",
  );
  assert.equal(h.dirty.at(-1), false);
  await h.click("Choose filter");
  const filter = h.nodes(node => node.type === "SceneFilterEditor")[0];
  assert.equal(filter.props.open, true);
  const condition = {
    all: false,
    scene: { rating100: { modifier: "GREATER_THAN", value: 50 } },
    find: {},
    query: "c=fixture",
  };
  filter.props.onChange(condition);
  filter.props.onClose();
  await h.flush();
  await h.advance(500);
  assert.deepEqual(h.writes.at(-1).rules[0].condition, condition, "native filter payload remains untouched");
  const updatedMenu = h.nodes(node => node.type === "ActionMenu" && /^Actions for/.test(node.props.ariaLabel))[0];
  updatedMenu.props.items[3].onSelect();
  await h.flush();
  await h.advance(500);
  const duplicated = h.writes.at(-1).rules[1];
  assert.equal(duplicated.enabled, false);
  assert.equal(duplicated.mode, undefined);
  assert.notEqual(duplicated.id, rule.id);
  await h.click("Detect");
  assert(h.nodes(node => node.type === "option" && node.props.value === "nvenc").length);
  h.unmount();
  assert.equal(h.timers.size, 0);
  assert.equal(h.dirty.at(-1), false);
}

async function serializedSavesAndFailures() {
  const first = deferred();
  let saves = 0;
  const h = createCompactorHarness({ settings, save: () => (++saves === 1 ? first.promise : Promise.resolve()) });
  h.load();
  await h.flush();
  await h.click("Add rule");
  await h.field("Name", "First draft");
  await h.advance(500);
  assert.equal(h.writes.length, 1);
  await h.field("Name", "Second draft");
  await h.advance(500);
  assert.equal(h.writes.length, 1, "writes are serialized while the first request is in flight");
  first.resolve();
  await h.flush();
  await h.advance(500);
  assert.equal(h.writes.at(-1).rules[1].name, "Second draft");
  assert.equal(h.dirty.at(-1), false);
  await h.field("Name", "Cancelled pending save");
  h.unmount();
  await h.advance(500);
  assert.equal(h.writes.length, 2, "unmount cancels the pending draft save");
  let failure = true;
  const broken = createCompactorHarness({
    settings,
    save: async () => {
      if (failure) throw Error("conflict fixture");
    },
  });
  broken.load();
  await broken.flush();
  await broken.click("Add rule");
  await broken.advance(500);
  assert.equal(broken.nodes(node => node.type === "SaveStatus")[0].props.state, "error");
  assert.match(
    text(broken.nodes(node => node.type === "StateView" && /attention/.test(node.props.title))[0].props.detail),
    /conflict fixture/,
  );
  await broken.field("Name", "Blocked draft");
  await broken.advance(500);
  assert.equal(broken.writes.length, 1, "a failed save waits for explicit reload");
  failure = false;
  await broken.click("Reload saved settings");
  await broken.click("Add rule");
  await broken.advance(500);
  assert.equal(broken.writes.length, 2);
  assert.equal(broken.dirty.at(-1), false);
  broken.unmount();
}

async function jobsReviewAndCleanup() {
  const planning = { ...preview, status: "planning", progress: { stage: "Checking synthetic files", progress: 0.2 } };
  const h = createCompactorHarness({ settings, preview: planning });
  h.load();
  await h.flush();
  assert(h.button("Cancel preview"));
  assert.equal(h.button("Run…"), undefined);
  assert.equal(h.nodes(node => node.type === "progress")[0].props.value, 0.2);
  await h.click("Cancel preview");
  assert.equal(h.button("Stopping…").props.disabled, true);
  assert(h.calls.some(call => call.mode === "cancelPreview" && call.id === preview.id));
  await h.preview(preview);
  await h.click("Run…");
  const dialog = h.nodes(node => node.type === "Dialog" && node.props.ariaLabel === "Confirm manual run")[0];
  assert.equal(dialog.props.open, true);
  await h.run(run); // Transport fixture returns this run for startRun.
  await h.click("Start run");
  assert(h.calls.some(call => call.mode === "startRun" && call.task === "encoding"));
  assert.equal(h.nodes(node => node.type === "video").length, 0);
  assert.equal(h.button("Accept and replace"), undefined);
  await h.run({ ...run, status: "recovery" });
  await h.click("Retry recovery");
  assert(h.calls.some(call => call.mode === "retryRecovery"));
  assert.equal(h.button("Restore original"), undefined);
  await h.run({ ...run, status: "running", review: undefined });
  await h.click("Cancel run");
  assert(h.calls.some(call => call.mode === "cancelRun"));
  await h.click("Pause");
  assert(h.calls.some(call => call.mode === "pauseRun" && call.id === run.id));
  await h.run({ ...run, pauseRequested: true });
  assert.equal(h.button("Pausing…").props.disabled, true);
  await h.run({ ...run, status: "paused" });
  assert.equal(h.button("Pause"), undefined);
  assert(h.button("Cancel run"), "a paused run can still be cancelled");
  await h.click("Resume");
  assert(h.calls.some(call => call.mode === "resumeRun" && call.id === run.id));
  // Encoded versions are kept beside their originals: report the size of the new file, not disk growth.
  const encoded = { ...file, status: "completed", addedBytes: 600, identity: { size: 1000 } };
  await h.run({
    ...run,
    status: "completed",
    counts: { completed: 1 },
    addedBytes: 600,
    originalBytes: 1000,
    operations: [encoded],
  });
  await h.click("Show files");
  assert(text(h.tree).includes("Created a 40% smaller file"));
  assert(text(h.tree).includes("created a 40% smaller file"), "run history compares sizes too");
  assert(!/B added|Added to disk/.test(text(h.tree)));
  assert.equal(rules.createdFiles(1100, 1000, 3), "Created 10% larger files");
  assert.equal(rules.sizeComparison(1000, 1000), "the same size");
  await h.click("Close");
  // Failed/incomplete/generation events never queue compaction.
  const event = {
    type: "REMOVE",
    job: { id: "scan-1", startTime: "2026-10-04T09:00:00Z", status: "FINISHED", description: "Scanning..." },
  };
  await h.event({ ...event, type: "UPDATE" });
  await h.event({ ...event, job: { ...event.job, status: "FAILED" } });
  assert.equal(h.calls.filter(call => call.mode === "queueAutomation").length, 0);
  await h.event(event);
  await h.event({ ...event });
  assert.equal(h.calls.filter(call => call.mode === "queueAutomation").length, 1);
  await h.event({ ...event, job: { ...event.job, startTime: "2026-10-04T10:00:00Z" } });
  assert.equal(
    h.calls.filter(call => call.mode === "queueAutomation").length,
    2,
    "new startTime distinguishes reused job IDs",
  );
  const before = h.calls.length;
  h.unmount();
  await h.advance(4000);
  assert.equal(h.calls.length, before);
  assert.equal(h.timers.size, 0);
  const capture = createCompactorHarness({ settings, run, capture: true });
  capture.load();
  await capture.flush();
  assert.equal(capture.nodes(node => node.type === "video").length, 0);
  await capture.click("Show files");
  assert(!text(capture.tree).includes("synthetic.mp4"));
  capture.unmount();
  // Pending read completions after unmount cannot restart polling or dirty state.
  const pending = deferred();
  const stale = createCompactorHarness({ operation: args => (args.mode === "listRuns" ? pending.promise : undefined) });
  stale.load();
  await stale.flush();
  stale.unmount();
  pending.resolve([run]);
  await stale.flush();
  assert.equal(stale.timers.size, 0);
  assert.equal(stale.dirty.at(-1), false);
}

async function workflowErrorAfterSave() {
  const h = createCompactorHarness({
    settings,
    operation: async args => {
      if (args.mode === "preview") throw Error("Controlled preview failure");
    },
  });
  h.load();
  await h.flush();
  await h.click("Preview");
  assert(h.nodes(node => node.type === "StateView" && /attention/.test(node.props.title)).length);
  h.nodes(node => node.type === "ActionMenu" && /^Actions for/.test(node.props.ariaLabel))[0].props.items[0].onSelect();
  await h.flush();
  await h.field("Name", "Edited after preview failure");
  await h.advance(500);
  assert.equal(
    h.nodes(node => node.type === "StateView" && /attention/.test(node.props.title)).length,
    0,
    "a successful settings save clears the previous workflow error as before extraction",
  );
  h.unmount();
}

async function main() {
  await registration();
  await editingAndSaving();
  await serializedSavesAndFailures();
  await jobsReviewAndCleanup();
  await workflowErrorAfterSave();
  console.log(
    "DirtyCompactor compiled TSX, host React, guards, settings, filters, serialized writes, cancellation, attachment, automation and cleanup passed",
  );
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
