"use strict";
const assert = require("node:assert/strict"),
  { requireSource } = require("./plugin_paths");
const { createWorkflow } = requireSource("DirtyTidy", "src/workflow.ts");
const { settingsFromConfiguration } = requireSource("DirtyTidy", "src/domain/settings.ts");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function setup(options = {}) {
  const writes = [],
    queued = [],
    events = [],
    notifications = [];
  const workflow = createWorkflow(options.settings, {
    getSettings: options.load || (async () => options.settings || {}),
    configurePlugin: async settings => {
      writes.push(settings);
      events.push("save");
      if (options.save) await options.save(settings);
    },
    runPreview:
      options.preview ||
      (async settings => ({
        settings: settingsFromConfiguration(settings),
        strategy_hash: "a".repeat(64),
        plan_digest: "b".repeat(64),
        total: 1,
        summary: { ready: 1 },
        operations: [],
      })),
    queueExecution: async hash => {
      events.push("queue");
      queued.push(hash);
      if (options.queue) return options.queue(hash);
      return "123";
    },
    notify: value => notifications.push(value),
  });
  return { workflow, writes, queued, events, notifications };
}
(async () => {
  const h = setup(),
    w = h.workflow;
  await w.load();
  assert.equal(w.dirty(), false);
  w.changed({ renameEnabled: true, renamePattern: "  {title}  " });
  assert.equal(w.dirty(), true);
  assert.equal(h.writes.length, 0);
  await w.generatePreview();
  assert.equal(h.writes.length, 0, "preview never persists a draft");
  assert.equal(w.state.draft.renamePattern, "{title}");
  assert.equal(w.dirty(), true);
  w.openConfirmation();
  assert.equal(w.state.confirming, true);
  w.view({ confirming: false });
  assert.equal(h.queued.length, 0, "opening/cancelling confirmation cannot queue work");
  const apply = w.applyPlan(true);
  await w.applyPlan(true);
  await apply;
  assert.deepEqual(h.events, ["save", "queue"]);
  assert.equal(h.queued[0], "a".repeat(64));
  assert.equal(w.dirty(), false);
  assert.equal(w.state.preview, null);
  assert.equal(w.state.confirming, false);
  assert.match(w.state.status, /Queued as Stash job 123/);

  const automation = setup({ settings: { automationMode: "scan" } });
  await automation.workflow.generatePreview();
  await automation.workflow.applyPlan(false);
  assert.equal(automation.writes[0].approvedStrategyHash, "a".repeat(64));
  assert.equal(automation.writes[0].approvedPlanDigest, "b".repeat(64));
  assert.equal(automation.queued.length, 0);
  assert.match(automation.workflow.state.status, /Automation is on after every Scan/);
  automation.workflow.changed({ automationMode: "generate" }, false);
  assert.ok(automation.workflow.state.preview);
  assert.equal(automation.workflow.state.draft.approvedStrategyHash, "a".repeat(64));
  await automation.workflow.applyPlan(false);
  assert.equal(automation.writes[1].automationMode, "generate");
  automation.workflow.changed({ renamePattern: "new" });
  assert.equal(automation.workflow.state.preview, null);
  assert.equal(automation.workflow.state.draft.approvedPlanDigest, "");
  const unapproved = setup({ settings: { automationMode: "scan" } });
  await unapproved.workflow.generatePreview();
  unapproved.workflow.view({ approve: false });
  await unapproved.workflow.applyPlan(true);
  assert.equal(unapproved.writes[0].approvedStrategyHash, "");

  const save = deferred(),
    saving = setup({ save: () => save.promise });
  saving.workflow.changed({ renamePattern: "first" });
  const pendingSave = saving.workflow.saveStrategy();
  saving.workflow.changed({ renamePattern: "second" });
  await saving.workflow.saveStrategy();
  assert.equal(saving.writes.length, 1);
  save.resolve();
  await pendingSave;
  assert.equal(saving.workflow.state.draft.renamePattern, "second");
  assert.equal(saving.workflow.state.savedSettings.renamePattern, "first");
  assert.equal(saving.workflow.dirty(), true);
  const result = deferred(),
    previewing = setup({ preview: () => result.promise });
  const pendingPreview = previewing.workflow.generatePreview();
  previewing.workflow.changed({ renamePattern: "new edit" });
  result.resolve({ settings: { renamePattern: "stale" }, strategy_hash: "old", summary: {}, operations: [] });
  await pendingPreview;
  assert.equal(previewing.workflow.state.preview, null);
  assert.equal(previewing.workflow.state.draft.renamePattern, "new edit");
  const load = deferred(),
    loading = setup({ load: () => load.promise });
  const pendingLoad = loading.workflow.load();
  await loading.workflow.generatePreview();
  load.resolve({ renamePattern: "stale load" });
  await pendingLoad;
  assert.notEqual(loading.workflow.state.draft.renamePattern, "stale load");

  for (const phase of ["save", "preview", "apply"]) {
    const wait = deferred(),
      destroyed = setup({ save: () => wait.promise, preview: () => wait.promise });
    if (phase === "apply")
      destroyed.workflow.state.preview = { strategy_hash: "a", summary: { ready: 1 }, operations: [] };
    const task =
      phase === "save"
        ? destroyed.workflow.saveStrategy()
        : phase === "preview"
          ? destroyed.workflow.generatePreview()
          : destroyed.workflow.applyPlan(true);
    destroyed.workflow.destroy();
    wait.resolve({ settings: {}, strategy_hash: "a", summary: {}, operations: [] });
    await task;
    assert.equal(destroyed.queued.length, 0);
    assert.equal(destroyed.notifications.length, 0);
  }
  const staleSave = deferred(),
    edited = setup({ save: () => staleSave.promise });
  await edited.workflow.generatePreview();
  const pendingApply = edited.workflow.applyPlan(true);
  edited.workflow.changed({ renamePattern: "changed during confirm save" });
  staleSave.resolve();
  await pendingApply;
  assert.equal(edited.queued.length, 0);
  assert.equal(edited.workflow.dirty(), true);
  assert.match(edited.workflow.state.status, /Generate a new preview/);
  const conflict = setup({
    save: () => {
      throw Error("revision conflict");
    },
  });
  await conflict.workflow.generatePreview();
  conflict.workflow.openConfirmation();
  await conflict.workflow.applyPlan(true);
  assert.equal(conflict.queued.length, 0);
  assert.equal(conflict.workflow.state.confirming, true);
  assert.match(conflict.workflow.state.error, /revision conflict/);
  const failedQueue = setup({
    queue: () => {
      throw Error("stale plan");
    },
  });
  await failedQueue.workflow.generatePreview();
  failedQueue.workflow.openConfirmation();
  await failedQueue.workflow.applyPlan(true);
  assert.equal(failedQueue.workflow.dirty(), false);
  assert.ok(failedQueue.workflow.state.preview);
  assert.equal(failedQueue.workflow.state.confirming, true);
  assert.match(failedQueue.workflow.state.error, /stale plan/);
  const levels = setup().workflow;
  levels.moveLevel(0, 1);
  assert.deepEqual(levels.state.draft.hierarchyLevels, ["{year}", "{studio}"]);
  levels.removeLevel(0);
  levels.addLevel();
  assert.deepEqual(levels.state.draft.hierarchyLevels, ["{studio}", "{title}"]);
  console.log(
    "DirtyTidy manual save, preview/confirm/approval, ordering, races, failure recovery and destruction passed",
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
