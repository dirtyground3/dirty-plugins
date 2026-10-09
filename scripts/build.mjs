import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import YAML from "yaml";
import lib from "./build-lib.cjs";
import { manifestSettings, pythonModule, writeGenerated } from "./generate-settings.mjs";

const { root, buildRoot, registry, relativeFile, rejectLinks, buildPath, removeBuildDirectory,
  readManifest, inputFingerprint, sourceMetadata, BUILD_MODES, BUILD_STATE_FORMAT } = lib;

function validatePlugin(plugin, schemas) {
  relativeFile(plugin.directory);
  relativeFile(plugin.id);
  relativeFile(plugin.entry);
  // Every plugin compiles its TS/TSX source into one browser bundle with the existing entry filename.
  if (typeof plugin.bundle !== "string") throw new Error("Missing bundle source for " + plugin.id);
  relativeFile(plugin.bundle);
  const directory = path.join(root, "plugins", plugin.directory);
  const files = new Set(plugin.files.map(relativeFile));
  if (files.size !== plugin.files.length) throw new Error("Duplicate install file in " + plugin.directory);
  // Generated install files are standard-library Python constants from the plugin's own schema.
  const generated = new Set(plugin.generatedFiles || []);
  for (const file of generated) {
    if (!files.has(file) || !file.endsWith(".py") || !schemas[plugin.id]) throw new Error("Invalid generated file for " + plugin.id + ": " + file);
  }
  for (const id of plugin.generatedImports || []) {
    if (!schemas[id]) throw new Error("Missing schemas/" + id + ".settings.json imported by " + plugin.id);
  }
  for (const file of files) {
    if (/(^|\/)(src|runtime|__pycache__|node_modules|tests)(\/|$)|\.sqlite|\.(pyc|pyo|bak|ts|tsx|map)$/i.test(file)) {
      throw new Error("Source or runtime artifact in install allowlist: " + file);
    }
    if (file === plugin.entry || generated.has(file)) continue;
    const source = path.join(directory, file);
    rejectLinks(source);
    if (!fs.statSync(source).isFile()) throw new Error("Missing install file: " + source);
  }
  const manifest = readManifest(plugin);
  if (!files.has(plugin.id + ".yml")) throw new Error("Manifest missing from install allowlist: " + plugin.id);
  if (schemas[plugin.id] && manifest.settings) {
    throw new Error(plugin.id + " settings are generated from schemas/" + plugin.id + ".settings.json; remove them from the manifest");
  }
  if (plugin.id !== "dirtyPlugins" && !manifest.ui?.requires?.includes("dirtyPlugins")) {
    throw new Error("Missing hub dependency: " + plugin.id);
  }
  const scripts = manifest.ui?.javascript || [];
  if (scripts.length !== 1 || scripts[0] !== plugin.entry) {
    throw new Error(plugin.id + " manifest must serve only its compiled " + plugin.entry + "; got " + JSON.stringify(scripts));
  }
  for (const file of manifest.ui?.css || []) {
    if (!files.has(relativeFile(file))) throw new Error("Missing manifest asset in install allowlist: " + plugin.directory + "/" + file);
  }
  for (const argument of manifest.exec || []) {
    if (argument.startsWith("{pluginDir}/") && !files.has(relativeFile(argument.slice(12)))) {
      throw new Error("Missing executable asset: " + argument);
    }
  }
  for (const asset of Object.values(manifest.ui?.assets || {})) {
    relativeFile(asset);
    if (!files.has(asset) && !plugin.runtimeDirectories?.includes(asset)) {
      throw new Error("Missing manifest asset mapping: " + asset);
    }
  }
  // Pinned npm packages a plugin may compile into its own bundle (licenses ship as install files).
  for (const name of plugin.bundledPackages || []) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error("Invalid bundled package for " + plugin.id + ": " + name);
    if (!fs.existsSync(path.join(root, "node_modules", name, "package.json"))) throw new Error("Missing bundled package " + name + "; run npm ci");
  }
  for (const module of plugin.testModules) {
    relativeFile(module.entry);
    relativeFile(module.output);
    if (!module.output.endsWith(".cjs")) throw new Error("Test module must emit CommonJS: " + module.output);
  }
  return manifest;
}

function bundleOptions(plugin, entry, outfile, platform, mode) {
  const release = platform === "browser" && mode === "release";
  // Declared npm packages are dependency inputs, read from their resolved install
  // directories (node_modules may itself be a link); everything else stays link-free.
  const packageRoots = (plugin.bundledPackages || []).map(name => fs.realpathSync(path.join(root, "node_modules", name)) + path.sep);
  // Generated settings metadata is data, and only the modules a plugin declares may enter its bundle.
  const generatedRoot = path.join(buildRoot, "generated") + path.sep;
  const generatedImports = new Set((plugin.generatedImports || []).map(id => path.join(generatedRoot, id + ".settings.ts")));
  return {
    absWorkingDir: root,
    entryPoints: [path.join(root, "plugins", plugin.directory, entry)],
    outfile, bundle: true, platform, format: platform === "browser" ? "iife" : "cjs",
    target: "es2020", jsx: "transform", jsxFactory: "React.createElement", jsxFragment: "React.Fragment",
    tsconfig: path.join(root, "tsconfig.json"),
    // Stash serves only the aggregated asset, so a map must be inline to resolve.
    // Release bundles omit it; test modules are never installed and keep theirs.
    sourcemap: release ? false : "inline",
    // Release bundles are minified without property mangling, so host, hub and
    // public names stay intact; keepNames preserves function/component names.
    minify: release, keepNames: release, legalComments: "inline", metafile: true, logLevel: "warning",
    plugins: [{
      name: "host-runtime-boundaries",
      setup(build) {
        build.onResolve({ filter: /^(react|react-dom)(\/|$)/ }, args => ({
          errors: [{ text: "Use window.PluginApi.React through the plugin adapter; do not import " + args.path }],
        }));
        build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, args => {
          if (packageRoots.some(prefix => args.path.startsWith(prefix))) return null;
          rejectLinks(args.path);
          if (args.path.startsWith(generatedRoot)) return generatedImports.has(args.path) ? null : {
            errors: [{ text: "Add " + path.basename(args.path, ".settings.ts") + " to generatedImports before importing " + args.path }],
          };
          const pluginRoot = path.join(root, "plugins", plugin.directory) + path.sep;
          if (!args.path.startsWith(pluginRoot)) return {
            errors: [{ text: "Do not rebundle another plugin or an npm runtime: " + args.path }],
          };
          return null;
        });
      },
    }],
  };
}

async function stagePlugins(mode) {
  rejectLinks(buildRoot);
  fs.mkdirSync(buildRoot, { recursive: true });
  // Invalidate first: a failed build must never authorize tests against old output.
  fs.rmSync(buildPath("build-state.json"), { force: true });
  removeBuildDirectory("staging");
  const staging = buildPath("staging");
  const stagedPlugins = path.join(staging, "plugins");
  const modules = path.join(staging, "test-modules");
  fs.mkdirSync(stagedPlugins, { recursive: true });
  fs.mkdirSync(modules, { recursive: true });
  const fingerprint = inputFingerprint();
  const state = { format: BUILD_STATE_FORMAT, mode, fingerprint, plugins: {} };
  const schemas = writeGenerated();
  const names = new Set();
  for (const plugin of registry) {
    if (names.has(plugin.directory) || names.has(plugin.id)) throw new Error("Duplicate plugin identity: " + plugin.id);
    names.add(plugin.directory); names.add(plugin.id);
    const manifest = validatePlugin(plugin, schemas);
    const schema = schemas[plugin.id];
    const destination = path.join(stagedPlugins, plugin.directory);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of plugin.files) {
      if (file === plugin.entry) continue;
      const output = path.join(destination, file);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      if ((plugin.generatedFiles || []).includes(file)) fs.writeFileSync(output, pythonModule(plugin.id, schema));
      else fs.copyFileSync(path.join(root, "plugins", plugin.directory, file), output);
    }
    const { metafile } = await esbuild.build(bundleOptions(plugin, plugin.bundle, path.join(destination, plugin.entry), "browser", mode));
    if (schema) manifest.settings = manifestSettings(schema);
    fs.writeFileSync(path.join(destination, plugin.id + ".yml"), YAML.stringify(manifest));
    for (const module of plugin.testModules) {
      await esbuild.build(bundleOptions(plugin, module.entry, path.join(modules, plugin.directory, module.output), "node", mode));
    }
    state.plugins[plugin.directory] = { id: plugin.id, entry: plugin.entry,
      files: plugin.files, metadata: sourceMetadata(plugin), metafile };
  }
  if (fingerprint !== inputFingerprint()) throw new Error("Build inputs changed during staging; run the build again.");
  removeBuildDirectory("plugins");
  removeBuildDirectory("test-modules");
  fs.renameSync(stagedPlugins, buildPath("plugins"));
  fs.renameSync(modules, buildPath("test-modules"));
  removeBuildDirectory("staging");
  fs.writeFileSync(buildPath("build-state.json"), JSON.stringify(state, null, 2) + "\n");
  console.log("Staged " + registry.length + " plugins in .build/plugins (" + mode + " build)");
  return state;
}

export async function buildPlugins(mode = "release") {
  if (!BUILD_MODES.includes(mode)) throw new Error("Unknown build mode: " + mode);
  rejectLinks(buildRoot);
  fs.mkdirSync(buildRoot, { recursive: true });
  const lock = buildPath("build.lock");
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt++) {
    try {
      const descriptor = fs.openSync(lock, "wx");
      fs.writeFileSync(descriptor, String(process.pid));
      fs.closeSync(descriptor);
      acquired = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = Number(fs.readFileSync(lock, "utf8"));
      if (!Number.isInteger(owner) || owner <= 0) throw new Error("Invalid build lock; remove .build/build.lock before retrying.");
      try { process.kill(owner, 0); }
      catch (probe) {
        if (probe.code === "ESRCH") { fs.rmSync(lock); continue; }
      }
      throw new Error("Another build is in progress (PID " + owner + "). Wait for it before building or testing.");
    }
  }
  if (!acquired) throw new Error("Could not acquire build lock.");
  try { return await stagePlugins(mode); }
  finally { fs.rmSync(lock, { force: true }); }
}

async function watchPlugins(mode) {
  let previous;
  let running = false;
  async function rebuild() {
    if (running) return;
    running = true;
    try {
      const current = inputFingerprint();
      if (current !== previous) {
        await buildPlugins(mode);
        previous = current;
      }
    } catch (error) {
      console.error(error.message);
    } finally { running = false; }
  }
  await rebuild();
  console.log("Watching build inputs. Copy staged files, reload plugins, and hard-refresh Stash after changes.");
  const timer = setInterval(rebuild, 500);
  process.on("SIGINT", () => { clearInterval(timer); process.exit(0); });
  process.on("SIGTERM", () => { clearInterval(timer); process.exit(0); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some(value => value !== "--watch" && value !== "--development")) {
    throw new Error("Usage: node scripts/build.mjs [--watch] [--development]");
  }
  const mode = arguments_.includes("--development") ? "development" : "release";
  if (arguments_.includes("--watch")) await watchPlugins(mode);
  else await buildPlugins(mode);
}
