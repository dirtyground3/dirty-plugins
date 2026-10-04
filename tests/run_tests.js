"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { discoverSuites, runSuites } = require("./run_js_tests");

const jsStatus = runSuites(discoverSuites());
console.log("\nRunning Python tests");
const python = spawnSync(process.env.PYTHON || "python", ["-B", "-m", "unittest", "discover", "-s", "tests", "-v"], {
  cwd: path.resolve(__dirname, ".."),
  stdio: "inherit",
  // These two Rank suites have already run above. Plain Python discovery retains them.
  env: { ...process.env, DIRTY_PLUGINS_SKIP_JS_TESTS: "1" },
});
if (python.error) console.error(python.error.message);
process.exitCode = jsStatus || (python.error || python.status !== 0 ? 1 : 0);
