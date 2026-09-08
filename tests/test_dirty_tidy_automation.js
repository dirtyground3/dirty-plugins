"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../plugins/DirtyTidy/dirtyTidy.js"), "utf8");
const noop = () => {};

// Run the real monitor with persisted browser storage and React effect semantics.
function browser(storage = new Map()) {
  let event, cursor, effects;
  const slots = [];
  const calls = [];
  let settings = { automationMode: "scan", approvedStrategyHash: "a".repeat(64) };
  let failQueue = false;
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
    localStorage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
    PluginApi: {
      React,
      GQL: { useJobsSubscribeSubscription: () => ({ data: { jobsSubscribe: event } }) },
    },
    DirtyPlugins: {
      registerSettingsPanel: noop,
      react: { SettingsCard: noop, SettingsSection: noop, SettingsToggle: noop },
      values: {
        asObject: value => value,
        coerceBoolean: (value, fallback) => value === undefined ? fallback : value,
        clampInteger: (value, fallback) => value === undefined ? fallback : value,
      },
      getPluginSettings: async () => settings,
      graphql: async (_query, variables) => {
        calls.push(variables.args);
        if (failQueue) throw new Error("queue unavailable");
        return { runPluginTask: "100" };
      },
      ui: { notify: noop },
    },
  };
  vm.runInNewContext(source, { window, console: { error: noop } });
  return {
    calls,
    setSettings: value => { settings = value; },
    setFailure: value => { failQueue = value; },
    async render(next) {
      event = next;
      cursor = 0;
      effects = [];
      window.__dirtyTidyPlugin.automationMonitor();
      effects.forEach(effect => effect());
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

function completed(addTime, overrides = {}) {
  return { type: "REMOVE", job: {
    id: "1", description: "Scanning...", status: "FINISHED", addTime, ...overrides,
  } };
}

async function main() {
  const storage = new Map([["dirtyTidy.automationJobs", '["1"]']]);
  const first = completed("2026-09-07T08:00:00Z");
  const restarted = completed("2026-09-08T08:00:00Z");
  const tab = browser(storage);
  // A finished scan alone suffices: no start or separate completion event needed.
  await tab.render(first);
  assert.equal(tab.calls.length, 1, "legacy ID-only claims must not suppress scans");
  assert.equal(tab.calls[0].sourceJobId, "1");
  await tab.render(undefined);
  await tab.render(first);
  assert.equal(tab.calls.length, 1, "replayed events must not queue twice");
  await tab.render(restarted);
  assert.equal(tab.calls.length, 2, "reused IDs must work in a tab left open across restart");
  const reloaded = browser(storage);
  await reloaded.render(restarted);
  assert.equal(reloaded.calls.length, 0, "persisted claims survive browser reload");
  await reloaded.render(completed("2026-09-09T08:00:00Z"));
  assert.equal(reloaded.calls.length, 1, "reused IDs also work after browser reload");

  for (const status of ["READY", "RUNNING", "CANCELLED", "FAILED", "STOPPING"]) {
    await tab.render(completed("later", { status }));
  }
  await tab.render({ ...completed("later"), type: "UPDATE" });
  await tab.render(completed("later", { description: "Cleaning..." }));
  await tab.render(completed("later", { description: "Apply approved DirtyTidy strategy after scan" }));
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

  const retryStorage = new Map();
  const failing = browser(retryStorage);
  failing.setFailure(true);
  await failing.render(first);
  assert.equal(failing.calls.length, 1);
  const retry = browser(retryStorage);
  await retry.render(first);
  assert.equal(retry.calls.length, 1, "queue failures release persisted claims for retry");
  console.log("DirtyTidy automation regression tests passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
