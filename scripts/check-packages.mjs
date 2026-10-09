import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import YAML from "yaml";
import lib from "./build-lib.cjs";

const directory = path.resolve(lib.root, process.argv[2] || "_site/main");
lib.rejectLinks(directory);
const state = lib.requireBuild();
const index = YAML.parse(fs.readFileSync(path.join(directory, "index.yml"), "utf8"));
if (!Array.isArray(index) || index.length !== lib.registry.length) throw new Error("Package index must contain every registered plugin.");
const seen = new Set();
for (const item of index) {
  const plugin = lib.registry.find(value => value.id === item.id);
  if (!plugin || seen.has(item.id)) throw new Error("Unknown or duplicate package: " + item.id);
  seen.add(item.id);
  const manifest = lib.readManifest(plugin, path.join(lib.pluginsRoot, plugin.directory));
  const metadata = state.plugins[plugin.directory].metadata;
  if (item.path !== plugin.id + ".zip" || item.version !== manifest.version + "-" + metadata.identity || item.date !== metadata.date) {
    throw new Error("Package metadata differs from source/build inputs: " + plugin.id);
  }
  if (JSON.stringify(item.requires || []) !== JSON.stringify(manifest.ui.requires || [])) throw new Error("Wrong package dependencies: " + plugin.id);
  const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(directory, item.path))).digest("hex");
  if (hash !== item.sha256) throw new Error("Wrong package checksum: " + plugin.id);
}
const result = spawnSync(process.env.PYTHON || "python", ["-B", "tests/check_package_contents.py", directory], { cwd: lib.root, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error("Package content checks failed.");
console.log("All package identities, dependencies, paths, and SHA-256 checksums passed");
