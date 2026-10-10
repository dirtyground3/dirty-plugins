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

function files(directory) {
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(directory, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"))
    .sort();
}

for (const plugin of lib.registry) {
  const destination = runtimePath(plugin.directory);
  const expected = lib.installFiles(plugin, lib.readManifest(plugin));
  assert.deepEqual(files(destination), [...expected].sort(), plugin.id + " stages exactly its install files");
  // Only the bundle, the manifest and generated constants are built; every other install file is copied verbatim.
  for (const file of expected) {
    if (file === plugin.entry || file === plugin.id + ".yml" || (plugin.generatedFiles || []).includes(file)) continue;
    assert.deepEqual(
      fs.readFileSync(runtimePath(plugin.directory, file)),
      fs.readFileSync(sourcePath(plugin.directory, file)),
      file,
    );
  }
}
assert.equal(
  lib.readManifest(lib.pluginFor("DirtyCompactor"), runtimePath("DirtyCompactor")).ui.assets["/previews"],
  "runtime/previews",
);

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
function build(...args) {
  const result = run("scripts/build.mjs", ...args);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
const stagedFile = path.join(fixture, ".build/plugins/DirtyCompactor/dirtyCompactor.js");
function fails(pattern, message) {
  const before = fs.readFileSync(stagedFile);
  const result = run("scripts/build.mjs");
  assert.notEqual(result.status, 0, message);
  assert.match(result.stderr, pattern);
  assert.deepEqual(fs.readFileSync(stagedFile), before, "a failed build leaves the previous staging intact");
}
function identity(directory) {
  return run(
    "-e",
    "const lib = require('./scripts/build-lib.cjs'); console.log(lib.sourceMetadata(lib.pluginFor(process.argv[1])).identity)",
    directory,
  ).stdout.trim();
}
try {
  // Local runtime data (Compactor previews, bytecode, databases) never leaves the checkout.
  const authored = source => !/[\\/](runtime|__pycache__)([\\/]|$)|\.sqlite/.test(path.relative(lib.root, source));
  for (const directory of ["scripts", "types", "schemas", "plugins"]) {
    fs.cpSync(path.join(lib.root, directory), path.join(fixture, directory), { recursive: true, filter: authored });
  }
  for (const file of ["package.json", "package-lock.json", "tsconfig.json", "build_site.sh"]) {
    fs.copyFileSync(path.join(lib.root, file), path.join(fixture, file));
  }
  fs.symlinkSync(path.join(lib.root, "node_modules"), path.join(fixture, "node_modules"), "junction");
  assert.match(
    run("-e", "require('./scripts/build-lib.cjs').requireBuild()").stderr,
    /Missing staged plugins. Run `npm run build` first/,
  );
  write("plugins/DirtyCompactor/runtime/previews/private.txt", "runtime data");
  write("plugins/DirtyPlugins/dirty_plugins.sqlite3", "private database");
  write("plugins/DirtyPlugins/__pycache__/backend.pyc", "bytecode");
  write("plugins/DirtyPlugins/backup.bak", "backup");
  build();
  assert.equal(run("-e", "require('./scripts/build-lib.cjs').requireBuild()").status, 0);
  assert(!fs.existsSync(path.join(fixture, ".build/plugins/DirtyCompactor/runtime")));
  for (const file of ["dirty_plugins.sqlite3", "__pycache__", "backup.bak"])
    assert(!fs.existsSync(path.join(fixture, ".build/plugins/DirtyPlugins", file)));
  const original = fs.readFileSync(stagedFile);
  fs.writeFileSync(stagedFile, "stale output");
  build();
  assert.deepEqual(fs.readFileSync(stagedFile), original, "rebuild replaces stale staging");

  // Package identity covers plugin files and shared build inputs.
  const before = identity("DirtyCompactor");
  assert.match(before, /^[0-9a-f]+-[0-9a-f]{12}$|^local-[0-9a-f]{12}$/);
  fs.appendFileSync(path.join(fixture, "tsconfig.json"), "\n");
  assert.notEqual(identity("DirtyCompactor"), before);

  const manifestPath = path.join(fixture, "plugins/DirtyCompactor/dirtyCompactor.yml");
  const sourceManifest = fs.readFileSync(manifestPath, "utf8");
  const manifest = YAML.parse(sourceManifest);
  manifest.ui.css.push("missing.css");
  fs.writeFileSync(manifestPath, YAML.stringify(manifest));
  fails(/missing install file missing\.css/, "manifest assets must exist");
  // A manifest serves only its compiled entry; extra scripts are rejected.
  manifest.ui.css.pop();
  manifest.ui.javascript.push("extra.js");
  fs.writeFileSync(manifestPath, YAML.stringify(manifest));
  fails(/manifest must serve only its compiled dirtyCompactor\.js/, "extra scripts are rejected");
  delete manifest.ui.requires;
  manifest.ui.javascript.pop();
  fs.writeFileSync(manifestPath, YAML.stringify(manifest));
  fails(/missing hub dependency/, "plugins require the hub");
  fs.writeFileSync(manifestPath, sourceManifest);

  // A schema is the one authored definition: manifests that still declare its settings are rejected.
  const rankManifestPath = path.join(fixture, "plugins/DirtyRank/dirtyRank.yml");
  const rankManifest = fs.readFileSync(rankManifestPath, "utf8");
  fs.writeFileSync(rankManifestPath, rankManifest + "\nsettings:\n  tau:\n    type: NUMBER\n");
  fails(/settings are generated from schemas\/dirtyRank\.settings\.json/, "schema settings stay out of manifests");
  fs.writeFileSync(rankManifestPath, rankManifest);

  const unsafe = run("scripts/prepare-site.mjs", "plugins/DirtyCompactor");
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /Refusing package cleanup/);
  assert.equal(fs.readFileSync(manifestPath, "utf8"), sourceManifest);
  write("_site/test/stale.zip", "old package");
  assert.equal(run("scripts/prepare-site.mjs", "_site/test").status, 0);
  assert(!fs.existsSync(path.join(fixture, "_site/test/stale.zip")));

  // A minimal TSX entry proves the module format and host-owned React binding.
  fs.rmSync(path.join(fixture, "plugins/DirtyCompactor/src"), { recursive: true });
  write("plugins/DirtyCompactor/src/domain.ts", "export function twice(value: number): number { return value * 2; }\n");
  write("plugins/DirtyCompactor/src/runtime.ts", "export const React = window.PluginApi.React;\n");
  write(
    "plugins/DirtyCompactor/src/index.tsx",
    `
    /*! Pilot legal notice */
    import { React } from "./runtime";
    import { twice } from "./domain";
    function PilotButton() { return <button>{twice(3)}</button>; }
    if (!window.__pilot) {
      window.__pilot = { render: () => <><button>{twice(3)}</button></>, Button: PilotButton };
      window.PluginApi.register.route("/pilot", window.__pilot.render);
    }
  `,
  );
  build();
  const compiledDirectory = path.join(fixture, ".build/plugins/DirtyCompactor");
  assert.deepEqual(
    YAML.parse(fs.readFileSync(path.join(compiledDirectory, "dirtyCompactor.yml"), "utf8")).ui.javascript,
    ["dirtyCompactor.js"],
  );
  assert(!fs.existsSync(path.join(compiledDirectory, "src")));
  let registrations = 0;
  const fragment = Symbol("host Fragment");
  const context = {
    window: {
      PluginApi: {
        React: { Fragment: fragment, createElement: (type, props, ...children) => ({ type, props, children }) },
        register: {
          route() {
            registrations++;
          },
        },
      },
    },
  };
  const compiled = fs.readFileSync(stagedFile, "utf8");
  assert(!compiled.includes("sourceMappingURL"), "release bundles carry no source map");
  vm.runInNewContext(compiled, context);
  vm.runInNewContext(compiled, context);
  assert.equal(registrations, 1);
  assert.equal(context.window.__pilot.render().type, fragment);
  assert.equal(context.window.__pilot.render().children[0].children[0], 6);
  // Minified release output keeps component names, host property names and legal comments.
  assert.equal(context.window.__pilot.Button.name, "PilotButton");
  assert(!/\bfunction PilotButton\(/.test(compiled), "release identifiers are minified");
  assert(compiled.includes("window.PluginApi.register.route") || compiled.includes(".PluginApi.register.route"));
  assert(compiled.includes("Pilot legal notice"), "legal comments survive minification");

  // Development builds stay readable and add the inline map that travels with Stash's aggregated asset.
  build("--development");
  const mapped = fs.readFileSync(stagedFile, "utf8");
  const mapAt = mapped.lastIndexOf("//# sourceMappingURL=data:application/json;base64,");
  assert(mapAt > 0, "development map must travel with the aggregated asset");
  assert(/\bfunction PilotButton\(/.test(mapped.slice(0, mapAt)), "development code stays readable");
  assert(compiled.length < mapAt, "release code is smaller than readable development code");
  assert(
    JSON.parse(Buffer.from(mapped.slice(mapAt).split("base64,")[1], "base64")).sources.some(source =>
      source.endsWith("src/index.tsx"),
    ),
  );
  build();
  assert.notEqual(run("scripts/build.mjs", "--minify").status, 0, "unknown build options are rejected");

  // Bundle boundaries: host React, declared packages and generated imports only, and the plugin source rules.
  const runtime = "plugins/DirtyCompactor/src/runtime.ts";
  for (const [source, pattern] of [
    ['import * as React from "react"; export { React };\n', /Use window.PluginApi.React/],
    [
      'import YAML from "yaml"; export const React = window.PluginApi.React; export const parse = YAML.parse;\n',
      /Do not bundle another plugin or an npm runtime/,
    ],
    [
      'import { defaults } from "@generated/dirtyRank.settings"; export const React = window.PluginApi.React; export const tau = defaults.tau;\n',
      /Add dirtyRank to generatedImports/,
    ],
    [
      'export const React = window.PluginApi.React; export const load = () => fetch("/graphql");\n',
      /use DirtyPlugins\.graphql/,
    ],
    [
      'export const React = window.PluginApi.React; export const capture = new URLSearchParams(location.search).get("docsCapture");\n',
      /through DirtyPlugins\.captureEnabled/,
    ],
  ]) {
    write(runtime, source);
    fails(pattern, "boundary violation: " + source);
  }
} finally {
  // Verify the absolute disposable path before recursive cleanup on Windows.
  assert.equal(path.dirname(path.resolve(fixture)), temporaryRoot);
  assert(path.basename(fixture).startsWith("dirty-build-fixture-"));
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log(
  "Staging parity, excluded artifacts, failed-build safety, package identity, release/development modes, minification, safe cleanup and bundle boundaries passed",
);
