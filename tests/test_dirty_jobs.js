"use strict";
const assert = require("node:assert/strict");
const { installJobHelpers } = require("./shared_runtime");
const window = {};
installJobHelpers(window);
const { completedJob, createReplayTracker } = window.DirtyPlugins;
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
