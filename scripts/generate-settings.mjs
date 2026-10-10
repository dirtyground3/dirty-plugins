// Generates settings metadata from the authored schemas/<pluginId>.settings.json files:
// TypeScript modules under .build/generated (imported as "@generated/<pluginId>.settings"),
// the staged manifest's settings section, and standard-library Python constants.
// Normalization, migrations and algorithms stay handwritten in each plugin.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import lib from "./build-lib.cjs";

const { root, buildRoot, registry } = lib;
const TYPES = ["BOOLEAN", "NUMBER", "STRING"];
const SETTING_KEYS = ["type", "displayName", "description", "default", "integer", "min", "max", "step", "options"];
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

export function schemaPath(pluginId) {
  return path.join(root, "schemas", pluginId + ".settings.json");
}

function fail(pluginId, message) {
  throw new Error("schemas/" + pluginId + ".settings.json: " + message);
}

export function validateSchema(pluginId, schema) {
  if (!isObject(schema)) fail(pluginId, "must be an object");
  for (const key of Object.keys(schema))
    if (!["settings", "constants"].includes(key)) fail(pluginId, "unknown key " + key);
  if (!isObject(schema.settings)) fail(pluginId, "settings must be an object");
  if (schema.constants !== undefined && !isObject(schema.constants)) {
    fail(pluginId, "constants must be an object");
  }
  for (const [name, setting] of Object.entries(schema.settings)) {
    const where = message => fail(pluginId, name + " " + message);
    if (!isObject(setting)) where("must be an object");
    for (const key of Object.keys(setting)) if (!SETTING_KEYS.includes(key)) where("has unknown key " + key);
    if (!TYPES.includes(setting.type)) where("needs a type of " + TYPES.join(", "));
    for (const key of ["displayName", "description"])
      if (typeof setting[key] !== "string" || !setting[key].trim()) where("needs " + key);
    const numeric = ["integer", "min", "max", "step"].filter(key => setting[key] !== undefined);
    if (setting.type !== "NUMBER" && numeric.length) where("uses " + numeric.join(", ") + " without type NUMBER");
    if (setting.integer !== undefined && typeof setting.integer !== "boolean") where("integer must be true or false");
    for (const key of ["min", "max", "step"]) {
      if (setting[key] !== undefined && !Number.isFinite(setting[key])) where(key + " must be a finite number");
    }
    if (setting.min !== undefined && setting.max !== undefined && setting.min > setting.max) where("min exceeds max");
    if (setting.step !== undefined && setting.step <= 0) where("step must be positive");
    if (setting.options !== undefined) {
      const values = Array.isArray(setting.options) ? setting.options.map(option => option && option.value) : [];
      if (
        !values.length ||
        setting.options.some(
          option =>
            !isObject(option) ||
            typeof option.label !== "string" ||
            !option.label.trim() ||
            !["string", "number"].includes(typeof option.value) ||
            (typeof option.value === "number" && !Number.isFinite(option.value)) ||
            Object.keys(option).some(key => key !== "value" && key !== "label"),
        )
      ) {
        where("options must be a list of { value, label }");
      }
      if (new Set(values).size !== values.length) where("has duplicate option values");
    }
    if (setting.default === undefined) continue;
    const value = setting.default;
    if (setting.type === "BOOLEAN" && typeof value !== "boolean") where("default must be a boolean");
    if (setting.type === "NUMBER") {
      if (!Number.isFinite(value) || (setting.integer && !Number.isInteger(value)))
        where("default must be a " + (setting.integer ? "whole " : "") + "number");
      if ((setting.min !== undefined && value < setting.min) || (setting.max !== undefined && value > setting.max))
        where("default is outside min/max");
    }
    // STRING settings may hold JSON-encoded structures (for example DirtyRank's cohort lists).
    if (setting.type === "STRING" && (value === null || typeof value === "number" || typeof value === "boolean"))
      where("default must be a string or JSON structure");
    if (setting.options && !setting.options.some(option => option.value === value))
      where("default is not one of its options");
  }
  return schema;
}

export function loadSchema(pluginId) {
  const filename = schemaPath(pluginId);
  if (!fs.existsSync(filename)) return null;
  return validateSchema(pluginId, JSON.parse(fs.readFileSync(filename, "utf8")));
}

/** Language-neutral tables in schema order; every generator output derives from these. */
export function settingsTables(schema) {
  const tables = {
    order: [],
    defaults: {},
    limits: {},
    options: {},
    integers: [],
    real: [],
    constants: schema.constants || {},
  };
  for (const [name, setting] of Object.entries(schema.settings)) {
    tables.order.push(name);
    if (setting.default !== undefined) tables.defaults[name] = setting.default;
    const limits = {};
    for (const key of ["min", "max", "step"]) if (setting[key] !== undefined) limits[key] = setting[key];
    if (Object.keys(limits).length) tables.limits[name] = limits;
    if (setting.options) tables.options[name] = setting.options;
    if (setting.integer) tables.integers.push(name);
    if (setting.type === "NUMBER" && !setting.integer) tables.real.push(name);
  }
  return tables;
}

/** The Stash manifest settings section; the source manifest keeps everything else. */
export function manifestSettings(schema) {
  return Object.fromEntries(
    Object.entries(schema.settings).map(([name, setting]) => [
      name,
      { displayName: setting.displayName, description: setting.description, type: setting.type },
    ]),
  );
}

function header(pluginId, comment) {
  return (
    comment + " Generated by scripts/generate-settings.mjs from schemas/" + pluginId + ".settings.json; do not edit.\n"
  );
}

export function typescriptModule(pluginId, schema) {
  const tables = settingsTables(schema);
  return (
    header(pluginId, "//") +
    ["order", "defaults", "limits", "options", "integers", "constants"]
      .map(name => "export const " + name + " = " + JSON.stringify(tables[name], null, 2) + ";\n")
      .join("")
  );
}

// Python keeps its own number types: real-valued settings stay floats (1000.0), whole ones ints.
function pythonLiteral(value, real = false) {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") {
    const text = String(value);
    return real && Number.isInteger(value) && !/e/i.test(text) ? text + ".0" : text;
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(item => pythonLiteral(item, real)).join(", ") + "]";
  return (
    "{" +
    Object.entries(value)
      .map(([key, item]) => JSON.stringify(key) + ": " + pythonLiteral(item, real))
      .join(", ") +
    "}"
  );
}

export function pythonModule(pluginId, schema) {
  const tables = settingsTables(schema);
  const block = (name, table, real = []) =>
    name +
    " = " +
    (Object.keys(table).length
      ? "{\n" +
        Object.entries(table)
          .map(([key, value]) => "    " + JSON.stringify(key) + ": " + pythonLiteral(value, real.includes(key)) + ",\n")
          .join("") +
        "}"
      : "{}") +
    "\n";
  return (
    '"""' +
    header(pluginId, "").trim() +
    '"""\n' +
    block("DEFAULTS", tables.defaults, tables.real) +
    block("LIMITS", tables.limits, tables.real) +
    block("OPTIONS", tables.options) +
    block("CONSTANTS", tables.constants)
  );
}

/** Writes the TypeScript modules every bundle and the type checker resolve; returns the schemas by plugin ID. */
export function writeGenerated() {
  const schemas = {};
  const expected = new Map();
  for (const plugin of registry) {
    const schema = loadSchema(plugin.id);
    if (!schema) continue;
    schemas[plugin.id] = schema;
    expected.set(plugin.id + ".settings.ts", typescriptModule(plugin.id, schema));
  }
  const directory = path.join(buildRoot, "generated");
  fs.mkdirSync(directory, { recursive: true });
  for (const name of fs.readdirSync(directory)) {
    if (!expected.has(name)) fs.rmSync(path.join(directory, name), { force: true });
  }
  for (const [name, contents] of expected) {
    const filename = path.join(directory, name);
    if (!fs.existsSync(filename) || fs.readFileSync(filename, "utf8") !== contents)
      fs.writeFileSync(filename, contents);
  }
  return schemas;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const schemas = writeGenerated();
  console.log("Generated settings metadata for " + Object.keys(schemas).join(", "));
}
