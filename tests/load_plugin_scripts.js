"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "plugins");

function scriptPaths(pluginDirectory) {
  const directory = path.join(root, pluginDirectory);
  const manifestName = fs.readdirSync(directory).find(name => name.endsWith(".yml"));
  if (!manifestName) throw new Error("Missing manifest for " + pluginDirectory);
  const manifest = fs.readFileSync(path.join(directory, manifestName), "utf8");
  const block = manifest.match(/^\s*javascript:\s*\r?\n((?:\s+-\s+[^\r\n]+\r?\n)+)/m);
  if (!block) throw new Error("Missing JavaScript list in " + manifestName);
  return block[1].trim().split(/\r?\n/).map(line => {
    const name = line.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, "");
    const filename = path.join(directory, name);
    if (!fs.existsSync(filename)) throw new Error("Missing JavaScript asset " + filename);
    return filename;
  });
}

function loadPluginScripts(pluginDirectory, context) {
  for (const filename of scriptPaths(pluginDirectory)) {
    vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename });
  }
}

function sourceFor(pluginDirectory) {
  return scriptPaths(pluginDirectory).map(filename => fs.readFileSync(filename, "utf8")).join("\n");
}

module.exports = { scriptPaths, loadPluginScripts, sourceFor };
