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
  const record = recorded[plugin.directory];
  // Chunks load on demand, so each is recorded separately from the bundle every page loads.
  const files = [
    [plugin.entry, record],
    ...Object.values(plugin.chunks || {}).map(output => [output, record.chunks?.[output]]),
  ];
  for (const [file, { budget } = {}] of files) {
    assert(budget, plugin.directory + " records a release size for " + file);
    const code = fs.readFileSync(runtimePath(plugin.directory, file));
    total += code.length;
    assert(
      code.length <= budget,
      plugin.directory +
        "/" +
        file +
        " grew to " +
        code.length +
        " bytes (budget " +
        budget +
        "); explain the growth and record the new size",
    );
    assert(!code.includes("sourceMappingURL"), plugin.directory + "/" + file + " must not carry a source map");
  }
}
console.log("Release bundle sizes within budget (" + total + " bytes total) and map-free");
