"use strict";
const assert = require("node:assert/strict");
const { installJobHelpers } = require("./shared_runtime");
const window = {};
installJobHelpers(window);
const { completedJob, createReplayTracker, createJobHook } = window.DirtyPlugins;
const { createHooks } = require("./ui_harness");
const event = (overrides = {}, type = "REMOVE") => ({ type, job: {id: "1", startTime: "2026-10-03T12:00:00Z", status: "FINISHED", description: "Scanning...", ...overrides} });
const scan = completedJob(event());
assert.equal(scan.kind, "scan");
assert.equal(completedJob(event({ description: "Generating..." })).kind, "generate");
for (const invalid of [event({}, "UPDATE"), event({status: "FAILED"}), event({status: "STOPPED"}), event({startTime: null}), event({id: null}), event({description: "Other"}), null]) {
  assert.equal(completedJob(invalid), null);
}
assert.notEqual(scan.key, completedJob(event({startTime: "later"})).key, "reused job ID after restart is a distinct completion");
const seen = createReplayTracker(2);
assert.equal(seen.claim(scan.key), true);
assert.equal(seen.claim(scan.key), false);
seen.release(scan.key);
assert.equal(seen.claim(scan.key), true, "failed queueing can retry");
seen.claim("second"); seen.claim("third");
assert.equal(seen.claim(scan.key), true, "replay memory is bounded");
console.log("Completed jobs, restart identities, replay bounds and retry passed");

(async () => {
  const owner = {slots: [], effects: [], cursor: 0}, calls = [], errors = [];
  const useCompletedJob = createJobHook(createHooks(() => owner));
  let fail = false;
  function render(value) {
    owner.cursor = 0;
    useCompletedJob(value, completion => {
      calls.push(completion);
      return fail ? Promise.reject(new Error("offline")) : Promise.resolve();
    }, error => errors.push(error.message), "scan");
    owner.effects.splice(0).forEach(effect => effect());
  }
  render(event()); render(event());
  assert.equal(calls.length, 1, "a new event object or callback cannot repeat the same completion");
  render(null); render(event());
  assert.equal(calls.length, 1, "local replay claims survive unrelated events");
  render(event({description: "Generating...", startTime: "generate"}));
  assert.equal(calls.length, 1, "scan-only consumers ignore Generate");
  fail = true;
  render(event({startTime: "retry"}));
  await new Promise(setImmediate);
  assert.deepEqual(errors, ["offline"]);
  fail = false;
  render(null); render(event({startTime: "retry"}));
  assert.equal(calls.length, 3, "a rejected queue releases its local claim for retry");
  assert.equal(calls.at(-1).startTime, "retry");
})().catch(error => { console.error(error); process.exitCode = 1; });
