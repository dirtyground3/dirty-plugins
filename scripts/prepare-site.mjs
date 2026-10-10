import fs from "node:fs";
import path from "node:path";
import lib from "./build-lib.cjs";

const value = process.argv[2];
if (!value) throw new Error("Usage: node scripts/prepare-site.mjs <_site output directory>");
const output = path.resolve(lib.root, value);
const relative = path.relative(path.join(lib.root, "_site"), output);
if (relative.startsWith("..") || path.isAbsolute(relative)) {
  throw new Error("Refusing package cleanup outside the repository's _site directory: " + output);
}
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
// Forward slashes work for native Windows Node and Git Bash tooling.
console.log(output.split(path.sep).join("/"));
