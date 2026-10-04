"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { discoverSuites, runSuites } = require("./run_js_tests");
const { element, find, findAll, text, events } = require("./ui_harness");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dirty-plugins-runner-"));
try {
  assert.throws(() => discoverSuites(directory), /No JavaScript test suites/);
  fs.writeFileSync(path.join(directory, "test_b.js"), "process.exitCode = 7;");
  fs.writeFileSync(path.join(directory, "test_a.js"), "console.log('passed fixture');");
  fs.writeFileSync(path.join(directory, "helper.js"), "throw new Error('helper must not run');");
  const files = discoverSuites(directory);
  assert.deepEqual(files.map(file => path.basename(file)), ["test_a.js", "test_b.js"]);
  const executed = [], output = [];
  const status = runSuites(files, (command, args, options) => {
    executed.push(path.basename(args[0]));
    return spawnSync(command, args, { ...options, stdio: "pipe" });
  }, line => output.push(line));
  assert.equal(status, 1, "a failing child process fails the runner");
  assert.deepEqual(executed, ["test_a.js", "test_b.js"], "every discovered suite executes");
  assert(output.some(line => /FAILED test_b.js: exit 7/.test(line)));
  const continued = [];
  assert.equal(runSuites(files, (_command, args) => {
    continued.push(args[0]); return { status: continued.length === 1 ? 1 : 0 };
  }, () => {}), 1);
  assert.equal(continued.length, 2, "failure does not hide later suites");
  assert.equal(runSuites(files, () => ({ status: 0 }), () => {}), 0);
  assert.equal(runSuites(files, () => ({ error: new Error("spawn failed") }), () => {}), 1);
} finally {
  for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));
  fs.rmdirSync(directory);
}

const tree = element("section", null, [element("button", {id: "pick"}, "Pick"), false], "text");
assert.equal(find(tree, node => node.props.id === "pick").type, "button");
assert.equal(findAll(tree, node => node.type === "button").length, 1);
assert.equal(text(tree), "Picktext");
const target = events(), seen = [];
const first = value => seen.push("first:" + value);
const second = value => seen.push("second:" + value);
target.on("update", first); target.on("update", first); target.on("update", second);
target.emit("update", 1); target.off("update", first); target.emit("update", 2);
assert.deepEqual(seen, ["first:1", "second:1", "second:2"]);
let dispatched;
target.addEventListener("change", event => { dispatched = event; });
const event = {type: "change", defaultPrevented: true};
assert.equal(target.dispatchEvent(event), false);
assert.equal(dispatched, event);
console.log("Test discovery, failure propagation, element trees and event dispatch passed");
