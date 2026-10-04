"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");

function discoverSuites(directory = __dirname) {
  const files = fs.readdirSync(directory).filter(name => /^test_.*\.js$/.test(name)).sort();
  if (!files.length) throw new Error("No JavaScript test suites found in " + directory);
  return files.map(name => path.join(directory, name));
}

function runSuites(files, execute = spawnSync, log = console.log) {
  let failed = 0;
  for (const file of files) {
    log("\nRunning " + path.basename(file));
    const result = execute(process.execPath, [file], { cwd: root, stdio: "inherit" });
    if (result.error || result.status !== 0) {
      failed++;
      log("FAILED " + path.basename(file) + ": " + (result.error?.message || result.signal || "exit " + result.status));
    }
  }
  log("\nJavaScript suites: " + (files.length - failed) + " passed, " + failed + " failed");
  return failed ? 1 : 0;
}

if (require.main === module) process.exitCode = runSuites(discoverSuites());
module.exports = { discoverSuites, runSuites };
