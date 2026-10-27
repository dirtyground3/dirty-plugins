"use strict";
// Phase 5: schemas/<pluginId>.settings.json is the one authored definition of selected settings
// metadata; manifests, TypeScript tables and Python constants are generated from it.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const lib = require("../scripts/build-lib.cjs");
const { runtimePath, sourcePath } = require("./plugin_paths");

async function main() {
  const generator = await import("../scripts/generate-settings.mjs");
  const schemas = {};
  for (const plugin of lib.registry) {
    const schema = generator.loadSchema(plugin.id);
    if (schema) schemas[plugin.id] = { plugin, schema };
  }
  assert.deepEqual(Object.keys(schemas).sort(), [
    "dirtyCaptions",
    "dirtyPlugins",
    "dirtyRank",
    "dirtyStats",
    "dirtyTasks",
    "extractScenes",
    "multiscreen",
  ]);

  for (const [id, { plugin, schema }] of Object.entries(schemas)) {
    // Repeated generation is identical and matches what the build wrote.
    const typescript = generator.typescriptModule(id, schema);
    assert.equal(
      generator.typescriptModule(id, generator.loadSchema(id)),
      typescript,
      id + " TypeScript output is deterministic",
    );
    assert.equal(
      fs.readFileSync(path.join(lib.buildRoot, "generated", id + ".settings.ts"), "utf8"),
      typescript,
      id + " generated module is current",
    );
    for (const file of plugin.generatedFiles || []) {
      assert.equal(
        fs.readFileSync(runtimePath(plugin.directory, file), "utf8"),
        generator.pythonModule(id, schema),
        id + " staged " + file,
      );
      assert(!fs.existsSync(sourcePath(plugin.directory, file)), file + " is generated, never authored");
    }
    // The source manifest keeps host metadata only; staging carries the generated settings section
    // (none for schemas that only hold constants, such as Tidy's and Stats' tables).
    assert.equal(lib.readManifest(plugin).settings, undefined, id + " source manifest must not repeat its schema");
    const staged = lib.readManifest(plugin, runtimePath(plugin.directory));
    assert.deepEqual(staged.settings || {}, generator.manifestSettings(schema), id + " staged manifest settings");
    assert.deepEqual(Object.keys(staged.settings || {}), Object.keys(schema.settings), id + " setting order");
    // Prose defaults in descriptions cannot drift from the schema.
    for (const [name, setting] of Object.entries(schema.settings)) {
      const text = setting.description;
      const label = id + "." + name;
      const stated = text.match(/Defaults to (-?[0-9.]*[0-9]|true|false)\b/);
      if (stated) assert.equal(String(setting.default), stated[1], label + " description states its default");
      const named = text.match(/(\w+) \(default\)|(-?[0-9.]*[0-9]) is the default/);
      if (named) assert.equal(String(setting.default), named[1] || named[2], label + " description names its default");
      if (/\bEnabled by default\b/.test(text)) assert.equal(setting.default, true, label);
      if (/\b(Disabled|Off) by default\b/.test(text)) assert.equal(setting.default, false, label);
    }
  }
  for (const plugin of lib.registry) {
    for (const imported of plugin.generatedImports || [])
      assert(schemas[imported], plugin.id + " imports a missing schema " + imported);
  }

  // Validation rejects ambiguous or inconsistent definitions before anything is generated.
  const valid = {
    settings: {
      count: { type: "NUMBER", displayName: "Count", description: "Count.", default: 2, integer: true, min: 1, max: 4 },
    },
  };
  assert.equal(generator.validateSchema("example", valid), valid);
  assert.deepEqual(
    generator.settingsTables(valid).integers,
    ["count"],
    "authored integer requirements reach TypeScript validation",
  );
  const invalid = [
    [{ settings: {}, constants: null }, /example\.settings\.json: constants must be an object/],
    [{ settings: { broken: null } }, /example\.settings\.json: broken must be an object/],
    [{ settings: { broken: [] } }, /broken must be an object/],
    [{ settings: { broken: 3 } }, /broken must be an object/],
    ...[null, [], "bad", { value: "a", label: "" }, { value: Infinity, label: "Bad" }].map(option => [
      { settings: { mode: { type: "STRING", displayName: "Mode", description: "Mode.", options: [option] } } },
      /example\.settings\.json: mode options must be a list/,
    ]),
    [{ settings: {}, extra: true }, /unknown key extra/],
    [{ settings: { count: { ...valid.settings.count, default: 5 } } }, /outside min\/max/],
    [{ settings: { count: { ...valid.settings.count, default: 1.5 } } }, /whole number/],
    [{ settings: { count: { ...valid.settings.count, min: 5 } } }, /min exceeds max/],
    [
      { settings: { flag: { type: "BOOLEAN", displayName: "Flag", description: "Flag.", default: true, max: 1 } } },
      /without type NUMBER/,
    ],
    [
      { settings: { flag: { type: "BOOLEAN", displayName: "Flag", description: "Flag.", default: "yes" } } },
      /must be a boolean/,
    ],
    [
      {
        settings: {
          mode: {
            type: "STRING",
            displayName: "Mode",
            description: "Mode.",
            default: "c",
            options: [{ value: "a", label: "A" }],
          },
        },
      },
      /not one of its options/,
    ],
    [
      {
        settings: {
          mode: {
            type: "STRING",
            displayName: "Mode",
            description: "Mode.",
            options: [
              { value: "a", label: "A" },
              { value: "a", label: "B" },
            ],
          },
        },
      },
      /duplicate option/,
    ],
    [{ settings: { mode: { type: "STRING", displayName: "", description: "Mode." } } }, /needs displayName/],
    [{ settings: { mode: { type: "TEXT", displayName: "Mode", description: "Mode." } } }, /needs a type/],
  ];
  for (const [schema, message] of invalid) assert.throws(() => generator.validateSchema("example", schema), message);

  // Python keeps its representations: real-valued settings stay floats, whole ones ints.
  const python = generator.pythonModule("example", {
    settings: {
      rating: { type: "NUMBER", displayName: "Rating", description: "Rating.", default: 1000, min: -5, max: 100000 },
      count: valid.settings.count,
      flag: { type: "BOOLEAN", displayName: "Flag", description: "Flag.", default: false },
      list: { type: "STRING", displayName: "List", description: "List.", default: ["A"] },
    },
    constants: { table: { a: 1, b: 1.8, c: null } },
  });
  assert.match(python, /"rating": 1000\.0,/);
  assert.match(python, /"rating": \{"min": -5\.0, "max": 100000\.0\},/);
  assert.match(python, /"count": 2,/);
  assert.match(python, /"flag": False,/);
  assert.match(python, /"list": \["A"\],/);
  assert.match(python, /"table": \{"a": 1, "b": 1\.8, "c": None\},/);
  console.log(
    "Settings schemas: deterministic TS/Python/manifest generation, staged parity, validation and stated defaults passed",
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
