"use strict";
// Parity contract for DirtyTidy settings normalization. The expectations here
// mirror plugins/DirtyTidy/dirty_tidy.py normalize_settings() and the matching
// assertions in tests/test_dirty_tidy.py. If one side changes, both tests must.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../plugins/DirtyTidy/dirtyTidy.js"), "utf8");
const noop = () => {};

const window = {
  PluginApi: {
    React: { createElement: noop, useEffect: noop, useMemo: noop, useRef: noop, useState: noop },
  },
  DirtyPlugins: {
    registerSettingsPanel: noop,
    react: { SettingsCard: noop, SettingsSection: noop, SettingsToggle: noop },
    values: {
      asObject: (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {}),
    },
  },
};
vm.runInNewContext(source, { window, console: { error: noop } });
const a = window.__dirtyTidyPlugin.algorithms;
// Values cross the vm realm boundary, so compare plain JSON copies.
const clean = (value) => JSON.parse(JSON.stringify(value));

const defaults = {
  moveEnabled: true,
  moveRequireStashId: false,
  hierarchyLevels: ["{studio}", "{year}"],
  renameEnabled: false,
  renameRequireStashId: false,
  renamePattern: "{date} - {studio} - {title}",
  maxFilenameLength: 180,
  multiValueSeparator: ", ",
  automationMode: "manual",
  approvedStrategyHash: "",
  approvedPlanDigest: "",
};
assert.deepEqual(clean(a.settingsFromConfiguration(undefined)), defaults, "missing configuration uses the shared defaults");

const canonical = a.settingsFromConfiguration({
  hierarchyLevels: ["  {studio} ", "", { template: "{year}" }],
  renamePattern: "  {title}  ",
  maxFilenameLength: "250",
  multiValueSeparator: "abcdefghijklmnop",
  automationMode: " Scan ",
  moveEnabled: "yes",
});
assert.deepEqual(clean(canonical.hierarchyLevels), ["{studio}", "{year}"]);
assert.equal(canonical.renamePattern, "{title}");
assert.equal(canonical.maxFilenameLength, 250);
assert.equal(canonical.multiValueSeparator, "abcdefghij");
assert.equal(canonical.automationMode, "scan");
assert.equal(canonical.moveEnabled, true);

// The backend must never see different values than the panel shows: an explicit
// empty list stays empty instead of reverting to the defaults it would never plan with.
const empties = a.settingsFromConfiguration({
  hierarchyLevels: [],
  renamePattern: "",
  multiValueSeparator: null,
  maxFilenameLength: null,
});
assert.deepEqual(clean(empties.hierarchyLevels), []);
assert.equal(empties.renamePattern, "");
assert.equal(empties.multiValueSeparator, ", ");
assert.equal(empties.maxFilenameLength, 180);

assert.deepEqual(
  clean(a.settingsFromConfiguration({ hierarchyLevels: null }).hierarchyLevels),
  ["{studio}", "{year}"],
  "a missing list falls back to the defaults, but an explicit empty list does not"
);

// Adopting the server's normalized settings and normalizing again is a no-op.
assert.deepEqual(clean(a.settingsFromConfiguration(canonical)), clean(canonical));
assert.deepEqual(clean(a.settingsFromConfiguration(empties)), clean(empties));

console.log("DirtyTidy settings normalization tests passed");