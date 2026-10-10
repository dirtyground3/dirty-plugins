"use strict";

// Release size guard: recorded budgets and no shipped maps. The build's boundary plugin
// already rejects foreign inputs (other plugins, React, undeclared packages).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const lib = require("../scripts/build-lib.cjs");
const { runtimePath } = require("./plugin_paths");
const recorded = require("./fixtures/bundle-sizes.json").plugins;

assert.deepEqual(
  Object.keys(recorded).sort(),
  lib.registry.map(plugin => plugin.directory).sort(),
  "every compiled plugin has a recorded release size",
);
let total = 0;
for (const plugin of lib.registry) {
  const budget = recorded[plugin.directory].budget;
  const code = fs.readFileSync(runtimePath(plugin.directory, plugin.entry));
  total += code.length;
  assert(
    code.length <= budget,
    plugin.directory +
      " release bundle grew to " +
      code.length +
      " bytes (budget " +
      budget +
      "); explain the growth and record the new size",
  );
  assert(!code.includes("sourceMappingURL"), plugin.directory + " release bundle must not carry a source map");
}
console.log("Release bundle sizes within budget (" + total + " bytes total) and map-free");
