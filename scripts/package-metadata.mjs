import lib from "./build-lib.cjs";

const id = process.argv[2];
const plugin = lib.registry.find(value => value.id === id);
if (!plugin) throw new Error("Unknown package ID: " + id);
const metadata = lib.sourceMetadata(plugin);
console.log(metadata.identity);
console.log(metadata.date);
