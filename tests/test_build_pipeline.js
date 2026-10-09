"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");
const YAML = require("yaml");
const lib = require("../scripts/build-lib.cjs");
const { runtimePath, sourcePath } = require("./plugin_paths");

for (const plugin of lib.registry) {
  const destination = runtimePath(plugin.directory);
  const actual = lib.walkFiles(destination).map(file => path.relative(destination, file).split(path.sep).join("/"));
  assert.deepEqual(actual.sort(), [...plugin.files].sort(), plugin.id + " must contain only allowlisted install files");
  // Only the bundle, the manifest and generated constants are built; every other install file is copied verbatim.
  for (const file of plugin.files) {
    if (file === plugin.entry || file === plugin.id + ".yml" || (plugin.generatedFiles || []).includes(file)) continue;
    assert.deepEqual(fs.readFileSync(runtimePath(plugin.directory, file)), fs.readFileSync(sourcePath(plugin.directory, file)), file);
  }
  assert(actual.includes("LICENSE") && actual.includes("README.md"));
}
assert.equal(lib.readManifest(lib.pluginFor("DirtyCompactor"), runtimePath("DirtyCompactor")).ui.assets["/previews"], "runtime/previews");
assert.throws(() => lib.removeBuildDirectory("../plugins"), /Refusing build cleanup/);
assert.throws(() => lib.buildPath("..", "plugins"), /Unsafe build path/);
assert.throws(() => lib.relativeFile("../private.sqlite3"), /Unsafe relative file/);

// Exercise failures and TSX in a disposable checkout, never by changing real source.
const temporaryRoot = path.resolve(os.tmpdir());
const fixture = fs.mkdtempSync(path.join(temporaryRoot, "dirty-build-fixture-"));
function write(file, contents) {
  const filename = path.join(fixture, file);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, contents);
}
function run(script, ...args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: fixture, encoding: "utf8", timeout: 60000 });
}
function build() {
  const result = run("scripts/build.mjs");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return JSON.parse(fs.readFileSync(path.join(fixture, ".build/build-state.json"), "utf8"));
}
function assertNoBuild() {
  const result = run("-e", "require('./scripts/build-lib.cjs').requireBuild()");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing or stale staged plugins.*npm run build/);
}
try {
  for (const directory of ["scripts", "types", "schemas"]) fs.cpSync(path.join(lib.root, directory), path.join(fixture, directory), { recursive: true });
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "build_site.sh"]) {
    fs.copyFileSync(path.join(lib.root, file), path.join(fixture, file));
  }
  // Node resolves tools through this link; the build never follows it for inputs/output.
  fs.symlinkSync(path.join(lib.root, "node_modules"), path.join(fixture, "node_modules"), "junction");
  for (const plugin of lib.registry) {
    for (const file of plugin.files) {
      if (file === plugin.entry || (plugin.generatedFiles || []).includes(file)) continue;
      write("plugins/" + plugin.directory + "/" + file, fs.readFileSync(sourcePath(plugin.directory, file)));
    }
    fs.cpSync(sourcePath(plugin.directory, "src"), path.join(fixture, "plugins", plugin.directory, "src"), {recursive: true});
    // Bundled vendor inputs may no longer be standalone install files.
    const vendor = sourcePath(plugin.directory, "vendor");
    if (fs.existsSync(vendor)) fs.cpSync(vendor, path.join(fixture, "plugins", plugin.directory, "vendor"), {recursive: true});
  }
  assertNoBuild();
  write("plugins/DirtyCompactor/runtime/previews/private.txt", "runtime data");
  write("plugins/DirtyPlugins/dirty_plugins.sqlite3", "private database");
  write("plugins/DirtyPlugins/__pycache__/backend.pyc", "bytecode");
  write("plugins/DirtyPlugins/backup.bak", "backup");
  let state = build();
  assert.equal(state.mode, "release", "the default build is the release build used by tests and packages");
  write(".build/build.lock", String(process.pid));
  const concurrent = run("scripts/build.mjs");
  assert.notEqual(concurrent.status, 0);
  assert.match(concurrent.stderr, /Another build is in progress/);
  assertNoBuild();
  fs.unlinkSync(path.join(fixture, ".build/build.lock"));
  const before = state.plugins.DirtyCompactor.metadata.identity;
  assert(!fs.existsSync(path.join(fixture, ".build/plugins/DirtyCompactor/runtime")));
  assert(!fs.existsSync(path.join(fixture, ".build/plugins/DirtyPlugins/dirty_plugins.sqlite3")));
  const stagedFile = path.join(fixture, ".build/plugins/DirtyCompactor/dirtyCompactor.js");
  const original = fs.readFileSync(stagedFile);
  fs.writeFileSync(stagedFile, "stale output");
  build();
  assert.deepEqual(fs.readFileSync(stagedFile), original, "rebuild replaces stale staging");

  // A shared input affects every package even if plugin source did not change.
  fs.appendFileSync(path.join(fixture, "tsconfig.json"), "\n");
  assertNoBuild();
  state = build();
  assert.notEqual(state.plugins.DirtyCompactor.metadata.identity, before);
  for (const plugin of Object.values(state.plugins)) assert(plugin.metadata.date);

  const manifestPath = path.join(fixture, "plugins/DirtyCompactor/dirtyCompactor.yml");
  const sourceManifest = fs.readFileSync(manifestPath, "utf8");
  const manifest = YAML.parse(sourceManifest);
  manifest.ui.css.push("missing.css");
  fs.writeFileSync(manifestPath, YAML.stringify(manifest));
  const missing = run("scripts/build.mjs");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Missing manifest asset/);
  assertNoBuild();
  // A manifest serves only its compiled entry; extra scripts are rejected.
  manifest.ui.css.pop();
  manifest.ui.javascript.push("extra.js");
  fs.writeFileSync(manifestPath, YAML.stringify(manifest));
  const extra = run("scripts/build.mjs");
  assert.notEqual(extra.status, 0);
  assert.match(extra.stderr, /manifest must serve only its compiled dirtyCompactor\.js/);
  assertNoBuild();
  fs.writeFileSync(manifestPath, sourceManifest);

  // A schema is the one authored definition: manifests that still declare its settings are rejected.
  const rankManifestPath = path.join(fixture, "plugins/DirtyRank/dirtyRank.yml");
  const rankManifest = fs.readFileSync(rankManifestPath, "utf8");
  fs.writeFileSync(rankManifestPath, rankManifest + "\nsettings:\n  tau:\n    type: NUMBER\n");
  const duplicated = run("scripts/build.mjs");
  assert.notEqual(duplicated.status, 0);
  assert.match(duplicated.stderr, /settings are generated from schemas\/dirtyRank\.settings\.json/);
  assertNoBuild();
  fs.writeFileSync(rankManifestPath, rankManifest);

  const unsafe = run("scripts/prepare-site.mjs", "plugins/DirtyCompactor");
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /Refusing package cleanup/);
  assert.equal(fs.readFileSync(manifestPath, "utf8"), sourceManifest);
  fs.mkdirSync(path.join(fixture, "_site"), { recursive: true });
  fs.symlinkSync(path.join(fixture, "plugins/DirtyCompactor"), path.join(fixture, "_site/linked"), "junction");
  const linked = run("scripts/prepare-site.mjs", "_site/linked");
  assert.notEqual(linked.status, 0);
  assert.match(linked.stderr, /Symbolic links are not allowed/);
  assert.equal(fs.readFileSync(manifestPath, "utf8"), sourceManifest);
  write("_site/test/stale.zip", "old package");
  assert.equal(run("scripts/prepare-site.mjs", "_site/test").status, 0);
  assert(!fs.existsSync(path.join(fixture, "_site/test/stale.zip")));

  // A minimal TSX entry proves the module format, host-owned React binding and test modules.
  const configuration = JSON.parse(fs.readFileSync(path.join(fixture, "scripts/plugin-registry.json"), "utf8"));
  const pilot = configuration.find(plugin => plugin.directory === "DirtyCompactor");
  pilot.testModules = [{ entry: "src/domain.ts", output: "domain.cjs" }];
  write("scripts/plugin-registry.json", JSON.stringify(configuration));
  write("plugins/DirtyCompactor/src/domain.ts", "export function twice(value: number): number { return value * 2; }\n");
  write("plugins/DirtyCompactor/src/runtime.ts", "export const React = window.PluginApi.React;\n");
  write("plugins/DirtyCompactor/src/index.tsx", `
    /*! Pilot legal notice */
    import { React } from "./runtime";
    import { twice } from "./domain";
    function PilotButton() { return <button>{twice(3)}</button>; }
    if (!window.__pilot) {
      window.__pilot = { render: () => <><button>{twice(3)}</button></>, Button: PilotButton };
      window.PluginApi.register.route("/pilot", window.__pilot.render);
    }
  `);
  // There is deliberately no authored file with the generated entry name.
  fs.rmSync(path.join(fixture, "plugins/DirtyCompactor/dirtyCompactor.js"), {force: true});
  state = build();
  const compiledDirectory = path.join(fixture, ".build/plugins/DirtyCompactor");
  assert.deepEqual(YAML.parse(fs.readFileSync(path.join(compiledDirectory, "dirtyCompactor.yml"), "utf8")).ui.javascript, ["dirtyCompactor.js"]);
  assert(!fs.existsSync(path.join(compiledDirectory, "src")));
  assert.equal(require(path.join(fixture, ".build/test-modules/DirtyCompactor/domain.cjs")).twice(4), 8);
  let registrations = 0;
  const fragment = Symbol("host Fragment");
  const context = { window: { PluginApi: {
    React: { Fragment: fragment, createElement: (type, props, ...children) => ({ type, props, children }) },
    register: { route() { registrations++; } },
  } } };
  const compiled = fs.readFileSync(path.join(compiledDirectory, "dirtyCompactor.js"), "utf8");
  assert(!compiled.includes("sourceMappingURL"), "release bundles carry no source map");
  vm.runInNewContext(compiled, context);
  vm.runInNewContext(compiled, context);
  assert.equal(registrations, 1);
  assert.equal(context.window.__pilot.render().type, fragment);
  assert.equal(context.window.__pilot.render().children[0].children[0], 6);
  assert(Object.keys(state.plugins.DirtyCompactor.metafile.inputs).every(file => file.startsWith("plugins/DirtyCompactor/")));
  // Minified release output keeps component names, host property names and legal comments.
  assert.equal(context.window.__pilot.Button.name, "PilotButton");
  assert(!/\bfunction PilotButton\(/.test(compiled), "release identifiers are minified");
  assert(compiled.includes("window.PluginApi.register.route") || compiled.includes(".PluginApi.register.route"));
  assert(compiled.includes("Pilot legal notice"), "legal comments survive minification");

  // Development builds stay readable and add the inline map that travels with Stash's aggregated asset.
  const development = run("scripts/build.mjs", "--development");
  assert.equal(development.status, 0, development.stdout + development.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, ".build/build-state.json"), "utf8")).mode, "development");
  const mapped = fs.readFileSync(path.join(compiledDirectory, "dirtyCompactor.js"), "utf8");
  const mapAt = mapped.lastIndexOf("//# sourceMappingURL=data:application/json;base64,");
  assert(mapAt > 0, "development map must travel with the aggregated asset");
  assert(/\bfunction PilotButton\(/.test(mapped.slice(0, mapAt)), "development code stays readable");
  assert(compiled.length < mapAt, "release code is smaller than readable development code");
  assert(JSON.parse(Buffer.from(mapped.slice(mapAt).split("base64,")[1], "base64")).sources.some(source => source.endsWith("src/index.tsx")));
  // Release checks and packages refuse development staging, and vice versa.
  const wrongMode = run("-e", "require('./scripts/build-lib.cjs').requireBuild()");
  assert.notEqual(wrongMode.status, 0);
  assert.match(wrongMode.stderr, /Run `npm run build` before.*staging is a development build/);
  assert.equal(run("-e", "require('./scripts/build-lib.cjs').requireBuild('development')").status, 0);
  build();
  assert.match(run("-e", "require('./scripts/build-lib.cjs').requireBuild('development')").stderr, /Run `npm run build:dev`/);
  assert.notEqual(run("scripts/build.mjs", "--minify").status, 0, "unknown build options are rejected");
  write("plugins/DirtyCompactor/src/runtime.ts", 'import * as React from "react"; export { React };\n');
  const forbidden = run("scripts/build.mjs");
  assert.notEqual(forbidden.status, 0);
  assert.match(forbidden.stderr, /Use window.PluginApi.React/);
  assertNoBuild();
  // Only packages a plugin declares in bundledPackages (Stats' ECharts) may enter its bundle.
  write("plugins/DirtyCompactor/src/runtime.ts", 'import YAML from "yaml"; export const React = window.PluginApi.React; export const parse = YAML.parse;\n');
  const undeclared = run("scripts/build.mjs");
  assert.notEqual(undeclared.status, 0, "undeclared npm packages cannot enter a bundle");
  assert.match(undeclared.stderr, /Do not rebundle another plugin or an npm runtime|Path escapes workspace/);
  assertNoBuild();
  // Generated settings metadata enters a bundle only when the plugin declares it in generatedImports.
  write("plugins/DirtyCompactor/src/runtime.ts", 'import { defaults } from "@generated/dirtyRank.settings"; export const React = window.PluginApi.React; export const tau = defaults.tau;\n');
  const foreignMetadata = run("scripts/build.mjs");
  assert.notEqual(foreignMetadata.status, 0, "undeclared generated metadata cannot enter a bundle");
  assert.match(foreignMetadata.stderr, /Add dirtyRank to generatedImports/);
  assertNoBuild();
  // Every plugin compiles one bundle; there is no legacy script-list staging path.
  delete pilot.bundle;
  write("scripts/plugin-registry.json", JSON.stringify(configuration));
  const unbundled = run("scripts/build.mjs");
  assert.notEqual(unbundled.status, 0);
  assert.match(unbundled.stderr, /Missing bundle source for dirtyCompactor/);
  assertNoBuild();
} finally {
  // Verify the absolute disposable path before recursive cleanup on Windows.
  assert.equal(path.dirname(path.resolve(fixture)), temporaryRoot);
  assert(path.basename(fixture).startsWith("dirty-build-fixture-"));
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log("Staging parity, excluded artifacts, freshness, release/development modes, minification, safe cleanup, TSX host React, and test modules passed");
