"use strict";

// Release size guard: recorded budgets, no shipped maps and plugin-owned dependency graphs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const lib = require("../scripts/build-lib.cjs");
const { runtimePath } = require("./plugin_paths");
const recorded = require("./fixtures/bundle-sizes.json").plugins;

const state = lib.requireBuild();
const compiled = lib.registry;
assert.deepEqual(Object.keys(recorded).sort(), compiled.map(plugin => plugin.directory).sort(),
  "every compiled plugin has a recorded release size");
let total = 0;
for (const plugin of compiled) {
  const size = recorded[plugin.directory];
  assert(size.budget <= size.legacy, plugin.directory + " budget must not exceed its pre-migration JavaScript");
  const code = fs.readFileSync(runtimePath(plugin.directory, plugin.entry));
  total += code.length;
  assert(code.length <= size.budget, plugin.directory + " release bundle grew to " + code.length +
    " bytes (budget " + size.budget + "); explain the growth and record the new size");
  assert(!code.includes("sourceMappingURL"), plugin.directory + " release bundle must not carry a source map");
  const inputs = Object.keys(state.plugins[plugin.directory].metafile.inputs);
  const owned = ["plugins/" + plugin.directory + "/", ...(plugin.bundledPackages || []).map(name => "node_modules/" + name + "/")];
  // Generated settings metadata is data; only the modules the plugin declares may enter.
  const generated = (plugin.generatedImports || []).map(id => ".build/generated/" + id + ".settings.ts");
  for (const input of inputs) {
    assert(owned.some(prefix => input.startsWith(prefix)) || generated.includes(input), plugin.directory + " bundles a foreign input: " + input);
  }
  assert(!inputs.some(input => /^node_modules\/(react|react-dom)\//.test(input)), plugin.directory + " must use Stash's React");
  if (plugin.directory !== "DirtyStats") {
    assert(!inputs.some(input => /echarts|zrender/i.test(input)), plugin.directory + " must not bundle chart code");
  }
}
console.log("Release bundle sizes within budget (" + total + " bytes total), map-free, plugin-owned or declared package inputs only");
