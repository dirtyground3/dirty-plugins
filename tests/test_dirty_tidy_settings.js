"use strict";
const assert = require("node:assert/strict"), {testModulePath} = require("./plugin_paths");
const a = require(testModulePath("DirtyTidy", "settings.cjs"));
const clean = value => JSON.parse(JSON.stringify(value));
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
  hierarchyLevels: ["  {studio} ", "", " {year}"],
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
assert.deepEqual(clean(a.settingsFromConfiguration(JSON.stringify(canonical))), defaults, "pre-1.0 JSON-string configurations are not parsed");


const {groupVariables, previewSlice} = require(testModulePath("DirtyTidy", "preview.cjs"));
const groups = groupVariables([["studio", "Studio name", "Studio"], ["year", "Year", "Date"], ["parent_studio", "Parent studio", "Studio"]]);
assert.deepEqual(groups.map(group => [group.header, group.variables.map(variable => variable[0])]), [["Studio", ["studio", "parent_studio"]], ["Date", ["year"]]]);
const operations = Array.from({length: 120}, (_, index) => ({file_id: String(index), status: index < 65 ? "ready" : "blocked", actions: index % 2 ? ["move"] : ["rename"]}));
const page = previewSlice({operations}, "ready", 2);
assert.equal(page.total, 65); assert.equal(page.pages, 2); assert.equal(page.visible.length, 15); assert.equal(page.visible[0].file_id, "50");
assert.equal(previewSlice({operations}, "move", 1).total, 60);
assert.equal(previewSlice(null, "all", 1).pages, 1);
assert.deepEqual(a.parseLevels([" {year} ", null, "", 0, { template: "{studio}" }, " {title} "]), ["{year}", "{title}"]);
assert.deepEqual(a.parseLevels('["{title}"]'), defaults.hierarchyLevels, "pre-1.0 JSON-string levels are not parsed");
for (const [value, expected] of [[15,16],[256,255], [123.7,123],["123.7",180], [Infinity,180], [" -20 ",16]]) assert.equal(a.parseMaxFilenameLength(value), expected);
for (const [value, expected] of [["no",false],["OFF",false],["yes",true],["unknown",true],[null,false],[0,false]]) assert.equal(a.parseBoolean(value,false), expected);
assert.equal(a.settingsFromConfiguration({approvedStrategyHash:"A".repeat(64), approvedPlanDigest:"invalid"}).approvedStrategyHash, "a".repeat(64));
assert.equal(a.settingsFromConfiguration({approvedPlanDigest:"invalid"}).approvedPlanDigest, "");
console.log("DirtyTidy typed normalization, grouping and preview pagination passed");
