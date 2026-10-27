"use strict";

const assert = require("node:assert/strict");
const { runSource } = require("./plugin_paths");
const noop = () => {};

// Run the real monitor with a shared backend and React effect semantics.
function browser(claims = new Map()) {
  let event, cursor, effects;
  const cleanups = [];
  const slots = [];
  const calls = [];
  const requests = [];
  const notifications = [];
  let settings = { automationMode: "scan", approvedStrategyHash: "a".repeat(64) };
  let failQueue = false;
  let skipped = false;
  const React = {
    createElement: noop,
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((value, i) => value !== old[i])) {
        slots[index] = deps;
        effects.push(effect);
      }
    },
  };
  const window = {
    PluginApi: {
      React,
      GQL: { useJobsSubscribeSubscription: () => ({ data: { jobsSubscribe: event } }) },
    },
    DirtyPlugins: {
      registerSettingsPanel: noop,
      react: {
        html: noop,
        SettingsSection: noop,
        SettingsToggle: noop,
        Field: noop,
        Pagination: noop,
        Button: noop,
        ActionMenu: noop,
        Badge: noop,
        Dialog: noop,
        SaveStatus: noop,
      },
      runPluginOperation: async (pluginId, args) => {
        assert.equal(pluginId, "dirtyTasks");
        requests.push(args);
        if (skipped || settings.automationMode !== args.automationTrigger || !settings.approvedStrategyHash) {
          return { skipped: true };
        }
        const key = JSON.stringify([args.automationTrigger, args.sourceJobId, args.sourceStartTime]);
        if (claims.has(key)) return { skipped: true, reason: "duplicate" };
        calls.push(args);
        if (failQueue) throw new Error("queue unavailable");
        claims.set(key, "100");
        return { queuedJobId: "100" };
      },
      ui: { notify: message => notifications.push(message) },
    },
  };
  require("./shared_runtime").installJobHelpers(window);
  const monitor = runSource("DirtyTasks", "src/automation.tsx", { window }).AutomationMonitor;
  return {
    calls,
    requests,
    unmount() {
      cleanups.splice(0).forEach(cleanup => cleanup());
    },
    notifications,
    setSettings: value => {
      settings = value;
    },
    setFailure: value => {
      failQueue = value;
    },
    setSkipped: value => {
      skipped = value;
    },
    async render(next) {
      event = next;
      cursor = 0;
      effects = [];
      monitor();
      for (const effect of effects) {
        const cleanup = effect();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      }
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

// Match Stash v0.31.1 graphql/subscriptions.graphql, not the broader JobData
// query fragment: subscription events do NOT contain addTime or endTime.
function completed(startTime, overrides = {}) {
  return {
    type: "REMOVE",
    job: {
      id: "1",
      description: "Scanning...",
      status: "FINISHED",
      subTasks: [],
      progress: 1,
      error: null,
      startTime,
      ...overrides,
    },
  };
}

async function main() {
  const claims = new Map();
  const first = completed("2026-09-07T08:00:00Z");
  assert.equal(Object.hasOwn(first.job, "addTime"), false);
  const restarted = completed("2026-09-08T08:00:00Z");
  const tab = browser(claims);
  // A finished scan alone suffices: no start or separate completion event needed.
  await tab.render(first);
  assert.equal(tab.calls.length, 1);
  assert.equal(tab.calls[0].mode, "queueAutomation");
  assert.equal(tab.calls[0].sourceJobId, "1");
  assert.equal(tab.calls[0].sourceStartTime, first.job.startTime);
  await tab.render(undefined);
  await tab.render(first);
  assert.equal(tab.calls.length, 1, "replayed events must not queue twice");
  await tab.render(restarted);
  assert.equal(tab.calls.length, 2, "reused IDs must work in a tab left open across restart");
  const reloaded = browser(claims);
  await reloaded.render(restarted);
  assert.equal(reloaded.calls.length, 0, "server claims survive browser reload");
  assert.equal(reloaded.notifications.length, 0, "duplicate skips must not announce a queued task");
  await reloaded.render(completed("2026-09-09T08:00:00Z"));
  assert.equal(reloaded.calls.length, 1, "reused IDs also work after browser reload");

  for (const status of ["READY", "RUNNING", "CANCELLED", "FAILED", "STOPPING"]) {
    await tab.render(completed("later", { status }));
  }
  await tab.render({ ...completed("later"), type: "UPDATE" });
  await tab.render(completed("later", { description: "Cleaning..." }));
  await tab.render(completed("later", { description: "Apply approved DirtyTidy strategy after scan" }));
  await tab.render(completed("later", { description: "DirtyTidy: rename scene files (after Scan #1)" }));
  await tab.render(completed(undefined));
  assert.equal(tab.calls.length, 2, "only successful selected jobs trigger automation");

  tab.setSettings({ automationMode: "manual", approvedStrategyHash: "a".repeat(64) });
  await tab.render(completed("manual"));
  tab.setSettings({ automationMode: "scan", approvedStrategyHash: "" });
  await tab.render(completed("unapproved"));
  assert.equal(tab.calls.length, 2);
  tab.setSettings({ automationMode: "generate", approvedStrategyHash: "a".repeat(64) });
  await tab.render(completed("generate", { description: "Generating..." }));
  await tab.render(completed("generate-restart", { description: "Generating..." }));
  assert.equal(tab.calls.length, 4);
  assert.equal(tab.calls[3].automationTrigger, "generate");

  const sharedBackend = new Map();
  const sessionOne = browser(sharedBackend);
  const sessionTwo = browser(sharedBackend);
  await Promise.all([sessionOne.render(first), sessionTwo.render(first)]);
  assert.equal(
    sessionOne.calls.length + sessionTwo.calls.length,
    1,
    "independent browser sessions must use the same backend claim",
  );
  const internal = browser();
  internal.setSkipped(true);
  await internal.render(first);
  assert.equal(internal.calls.length, 0);
  assert.equal(internal.notifications.length, 0);

  const retryStorage = new Map();
  const failing = browser(retryStorage);
  failing.setFailure(true);
  await failing.render(first);
  assert.equal(failing.calls.length, 1);
  const retry = browser(retryStorage);
  await retry.render(first);
  assert.equal(retry.calls.length, 1, "queue failures release persisted claims for retry");
  const stopped = browser();
  await stopped.render(undefined);
  stopped.unmount();
  await stopped.render(first);
  assert.equal(stopped.calls.length, 0, "unmounted monitors cannot queue new jobs");
  console.log("DirtyTidy imported automation monitor regression tests passed");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
