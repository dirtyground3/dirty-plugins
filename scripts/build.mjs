import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import YAML from "yaml";
import lib from "./build-lib.cjs";
import { manifestSettings, pythonModule, writeGenerated } from "./generate-settings.mjs";

const {
  root,
  buildRoot,
  pluginsRoot,
  registry,
  FORBIDDEN_INSTALL_FILE,
  pluginDirectory,
  installPath,
  recoverBuild,
  promoteBuild,
  readManifest,
  installFiles,
  compileOptions,
} = lib;
const HUB_ID = "dirtyPlugins";
// Architecture rules for plugin source; the hub owns transport and capture detection.
const SOURCE_RULES = [
  [/\bfetch\(\s*["'`]\/graphql/, 'use DirtyPlugins.graphql; only the hub calls fetch("/graphql")'],
  [/["'`](docsCapture|censorMedia)["'`]/, "read documentation capture mode through DirtyPlugins.captureEnabled"],
];

/** Checks the manifest and returns the plugin's install files. */
function validatePlugin(plugin, manifest, schemas) {
  const fail = message => {
    throw new Error(plugin.directory + ": " + message);
  };
  const scripts = manifest.ui?.javascript || [];
  if (scripts.length !== 1 || scripts[0] !== plugin.entry)
    fail("the manifest must serve only its compiled " + plugin.entry + "; got " + JSON.stringify(scripts));
  if (plugin.id !== HUB_ID && !manifest.ui?.requires?.includes(HUB_ID))
    fail("missing hub dependency (ui.requires: dirtyPlugins)");
  if (schemas[plugin.id] && manifest.settings)
    fail("settings are generated from schemas/" + plugin.id + ".settings.json; remove them from the manifest");
  for (const file of plugin.generatedFiles || [])
    if (!file.endsWith(".py") || !schemas[plugin.id]) fail("invalid generated file " + file);
  for (const id of plugin.generatedImports || []) if (!schemas[id]) fail("missing schemas/" + id + ".settings.json");
  for (const name of plugin.bundledPackages || []) {
    if (!fs.existsSync(path.join(root, "node_modules", name, "package.json")))
      fail("missing bundled package " + name + "; run npm ci");
  }
  const files = installFiles(plugin, manifest);
  const exec = (manifest.exec || [])
    .filter(argument => /^\{pluginDir\}[\\/]/.test(argument))
    .map(argument => argument.slice(12));
  for (const file of [...exec, ...Object.values(manifest.ui?.assets || {}), ...(plugin.runtimeDirectories || [])])
    installPath(pluginDirectory(plugin), file);
  const assets = Object.values(manifest.ui?.assets || {}).filter(asset => !plugin.runtimeDirectories?.includes(asset));
  for (const file of [...exec, ...assets])
    if (!files.some(installed => installed === file || installed.startsWith(file + "/")))
      fail("manifest references a file that is not installed: " + file);
  for (const output of Object.values(plugin.chunks || {}))
    if (!chunkUrl(plugin, manifest, output)) fail("no ui.assets mapping serves the chunk " + output);
  for (const file of files) {
    const source = installPath(pluginDirectory(plugin), file);
    if (FORBIDDEN_INSTALL_FILE.test(file.replaceAll("\\", "/")))
      fail("source or runtime data in install files: " + file);
    if (file === plugin.entry || plugin.generatedFiles?.includes(file) || isChunk(plugin, file)) continue;
    if (!fs.statSync(source, { throwIfNoEntry: false })?.isFile()) fail("missing install file " + file);
    const relative = path.relative(fs.realpathSync(pluginDirectory(plugin)), fs.realpathSync(source));
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative))
      fail("install source resolves outside the plugin: " + file);
  }
  return files;
}

const isChunk = (plugin, file) => Object.values(plugin.chunks || {}).includes(file);

/** The URL Stash serves a chunk at, through the manifest's ui.assets mapping (prefix -> plugin directory). */
function chunkUrl(plugin, manifest, output) {
  for (const [prefix, directory] of Object.entries(manifest.ui?.assets || {}))
    if (output.startsWith(directory + "/"))
      return "/plugin/" + plugin.id + "/assets" + prefix.replace(/\/?$/, "/") + output.slice(directory.length + 1);
  return null;
}

/**
 * Chunks are compiled separately and loaded on demand: the entry's import("./module") of a
 * chunk source becomes an import of its served URL, and a static import of one is an error.
 */
function chunkImports(plugin, manifest) {
  const sources = new Map(
    Object.entries(plugin.chunks || {}).map(([source, output]) => [
      path.join(pluginDirectory(plugin), source.replace(/\.tsx?$/, "")),
      chunkUrl(plugin, manifest, output),
    ]),
  );
  return {
    name: "plugin-chunks",
    setup(build) {
      build.onResolve({ filter: /^\./ }, args => {
        const url = sources.get(path.resolve(args.resolveDir, args.path).replace(/\.tsx?$/, ""));
        if (!url) return null;
        if (args.kind === "dynamic-import") return { path: url, external: true };
        return { errors: [{ text: "Load " + args.path + " with import(); it is compiled as a separate chunk" }] };
      });
    },
  };
}

/** Each bundle may contain only its own source, declared npm packages and declared generated settings. */
function boundaries(plugin) {
  const pluginRoot = pluginDirectory(plugin) + path.sep;
  const packageRoots = (plugin.bundledPackages || []).map(
    name => fs.realpathSync(path.join(root, "node_modules", name)) + path.sep,
  );
  const generatedRoot = path.join(buildRoot, "generated") + path.sep;
  const generatedImports = new Set(
    (plugin.generatedImports || []).map(id => path.join(generatedRoot, id + ".settings.ts")),
  );
  // Pure helpers shared by every bundle; the hub keeps everything that must be a single instance.
  const sharedRoot = path.join(root, "plugins", "DirtyPlugins", "src", "shared") + path.sep;
  return {
    name: "plugin-boundaries",
    setup(build) {
      build.onResolve({ filter: /^(react|react-dom)(\/|$)/ }, args => ({
        errors: [{ text: "Use window.PluginApi.React through the plugin runtime; do not import " + args.path }],
      }));
      build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, args => {
        if (packageRoots.some(prefix => args.path.startsWith(prefix)) || args.path.startsWith(sharedRoot)) return null;
        if (args.path.startsWith(generatedRoot))
          return generatedImports.has(args.path)
            ? null
            : {
                errors: [
                  {
                    text:
                      "Add " +
                      path.basename(args.path, ".settings.ts") +
                      " to generatedImports before importing " +
                      args.path,
                  },
                ],
              };
        if (!args.path.startsWith(pluginRoot))
          return { errors: [{ text: "Do not bundle another plugin or an npm runtime: " + args.path }] };
        if (plugin.id === HUB_ID) return null;
        const source = fs.readFileSync(args.path, "utf8");
        const broken = SOURCE_RULES.filter(([pattern]) => pattern.test(source)).map(([, message]) => ({
          text: path.relative(root, args.path) + ": " + message,
        }));
        return broken.length ? { errors: broken } : null;
      });
    },
  };
}

/** Stage every plugin, retain the previous build, then promote with rollback on failure. */
export async function buildPlugins(mode = "release") {
  if (!["release", "development"].includes(mode)) throw new Error("Unknown build mode: " + mode);
  const staging = path.join(buildRoot, "staging");
  recoverBuild(pluginsRoot);
  fs.rmSync(staging, { recursive: true, force: true });
  const schemas = writeGenerated();
  // The hub lists the suite in tab order; it must name exactly the registered plugins.
  const managed = schemas[HUB_ID]?.constants?.managedPluginIds || [];
  if (
    [...managed].sort().join() !==
    registry
      .map(plugin => plugin.id)
      .sort()
      .join()
  ) {
    throw new Error("schemas/" + HUB_ID + ".settings.json managedPluginIds must list every registered plugin once");
  }
  for (const plugin of registry) {
    const manifest = readManifest(plugin);
    const files = validatePlugin(plugin, manifest, schemas);
    const destination = installPath(staging, plugin.directory);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of files) {
      const output = installPath(destination, file);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      if (file === plugin.entry || file === plugin.id + ".yml" || isChunk(plugin, file)) continue;
      if (plugin.generatedFiles?.includes(file)) fs.writeFileSync(output, pythonModule(plugin.id, schemas[plugin.id]));
      else fs.copyFileSync(installPath(pluginDirectory(plugin), file), output);
    }
    await esbuild.build({
      ...compileOptions(plugin, "src/index.tsx", "browser", mode),
      outfile: path.join(destination, plugin.entry),
      plugins: [chunkImports(plugin, manifest), boundaries(plugin)],
    });
    for (const [source, output] of Object.entries(plugin.chunks || {}))
      await esbuild.build({
        ...compileOptions(plugin, source, "browser", mode),
        format: "esm",
        outfile: installPath(destination, output),
        plugins: [boundaries(plugin)],
      });
    const settings = schemas[plugin.id] && manifestSettings(schemas[plugin.id]);
    if (settings && Object.keys(settings).length) manifest.settings = settings;
    fs.writeFileSync(path.join(destination, plugin.id + ".yml"), YAML.stringify(manifest));
  }
  promoteBuild(staging, pluginsRoot);
  console.log("Staged " + registry.length + " plugins in .build/plugins (" + mode + " build)");
}

function watchPlugins(mode) {
  let timer,
    running = Promise.resolve();
  const rebuild = () => {
    running = running.then(() => buildPlugins(mode)).catch(error => console.error(error.message));
  };
  rebuild();
  for (const directory of ["plugins", "schemas", "types"]) {
    fs.watch(path.join(root, directory), { recursive: true }, (_event, filename) => {
      if (/(^|[\\/])(runtime|__pycache__)([\\/]|$)/.test(filename || "")) return;
      clearTimeout(timer);
      timer = setTimeout(rebuild, 200);
    });
  }
  console.log(
    "Watching plugins, schemas and types. Copy staged files, reload plugins, and hard-refresh Stash after changes.",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = process.argv.slice(2);
  if (options.some(value => value !== "--watch" && value !== "--development")) {
    throw new Error("Usage: node scripts/build.mjs [--watch] [--development]");
  }
  const mode = options.includes("--development") ? "development" : "release";
  if (options.includes("--watch")) watchPlugins(mode);
  else await buildPlugins(mode);
}
