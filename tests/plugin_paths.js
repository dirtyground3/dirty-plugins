"use strict";
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const vm = require("node:vm");
const esbuild = require("esbuild");
const lib = require("../scripts/build-lib.cjs");

function sourcePath(plugin, file = "") {
  lib.pluginFor(plugin);
  return path.join(lib.root, "plugins", plugin, file);
}

function runtimePath(plugin, file = "") {
  lib.pluginFor(plugin);
  lib.requireBuild();
  const filename = path.join(lib.pluginsRoot, plugin, file);
  if (!fs.existsSync(filename)) throw new Error("Missing staged runtime file: " + filename + ". Run `npm run build`.");
  return filename;
}

const compiled = new Map();
/**
 * One source module and its imports as CommonJS code, compiled on demand like the plugin bundle.
 * A test may instead pass its own entry contents (resolved from the plugin directory) and
 * imports to leave external, which it then supplies through require().
 */
function compileSource(plugin, entry, { contents, external = [] } = {}) {
  const key = JSON.stringify([plugin, entry, contents, external]);
  if (!compiled.has(key)) {
    lib.requireBuild(); // generated settings modules come from the build
    const configuration = lib.pluginFor(plugin);
    const options = {
      ...lib.compileOptions(configuration, entry, "node", "development"),
      write: false,
      outfile: "out.cjs",
      external,
    };
    if (contents !== undefined) {
      delete options.entryPoints;
      options.stdin = { contents, resolveDir: lib.pluginDirectory(configuration), loader: "ts", sourcefile: entry };
    }
    compiled.set(key, esbuild.buildSync(options).outputFiles[0].text);
  }
  return compiled.get(key);
}

const required = new Map();
/** Evaluate a source module (or a test's own entry contents) once in this realm, like require(). */
function requireSource(plugin, entry, { contents } = {}) {
  const filename = sourcePath(plugin, entry);
  const key = JSON.stringify([filename, contents]);
  if (!required.has(key)) {
    const module = new Module(filename, null);
    module.filename = filename;
    module.paths = Module._nodeModulePaths(path.dirname(filename));
    module._compile(compileSource(plugin, entry, { contents }), filename);
    required.set(key, module.exports);
  }
  return required.get(key);
}

/**
 * Evaluate a source module with the globals (such as window) a test supplies: a fresh
 * context from a plain object, or the test's own vm context. `modules` answers the
 * require() calls of imports compiled as external.
 */
function runSource(plugin, entry, globals = {}, { contents, external, modules = {} } = {}) {
  const module = { exports: {} };
  const require = name => {
    if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name];
    throw new Error("Unexpected require in " + entry + ": " + name);
  };
  const scope = { module, exports: module.exports, require };
  const code = compileSource(plugin, entry, { contents, external });
  if (vm.isContext(globals)) {
    Object.assign(globals, scope);
    vm.runInContext(code, globals, { filename: sourcePath(plugin, entry) });
  } else {
    vm.runInNewContext(
      code,
      { console, setTimeout, clearTimeout, ...globals, ...scope },
      { filename: sourcePath(plugin, entry) },
    );
  }
  return module.exports;
}

module.exports = { sourcePath, runtimePath, compileSource, requireSource, runSource };
