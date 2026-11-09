// GitHub Pages replaces the whole site on every deploy, so a deploy of one channel copies the other
// channel's published index.yml and ZIPs:  node scripts/fetch-channel.mjs <index.yml URL> <directory>
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";

const [source, directory] = process.argv.slice(2);
if (!source || !directory) throw new Error("Usage: node scripts/fetch-channel.mjs <index.yml URL> <directory>");

// A unique query skips the CDN copy, which can lag a deploy by minutes.
const stamp = String(Date.now());
async function download(file) {
  const url = new URL(file, source);
  url.searchParams.set("fresh", stamp);
  const response = await fetch(url, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url.pathname} answered ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

const index = await download(source);
if (!index) {
  console.log(`Nothing is published at ${source} yet.`);
} else {
  const packages = YAML.parse(index.toString("utf8"));
  if (!Array.isArray(packages) || !packages.length) throw new Error("The published index lists no packages.");
  fs.mkdirSync(directory, { recursive: true });
  for (const item of packages) {
    if (!/^[\w.-]+\.zip$/.test(item.path ?? "")) throw new Error("Unexpected package path: " + item.path);
    const data = await download(item.path);
    if (!data) throw new Error("The published index names a missing package: " + item.path);
    if (crypto.createHash("sha256").update(data).digest("hex") !== item.sha256)
      throw new Error("A published package does not match its checksum: " + item.path);
    fs.writeFileSync(path.join(directory, item.path), data);
  }
  fs.writeFileSync(path.join(directory, "index.yml"), index);
  console.log(`Kept ${packages.length} packages from ${source}.`);
}
