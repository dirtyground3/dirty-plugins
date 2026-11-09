// Release channels: main publishes X.Y.Z versions; prerelease marks a plugin X.Y.Z-rc until it is released.
//   node scripts/release.mjs check main|prerelease   checks the versions a channel may publish
//   node scripts/release.mjs finalize                removes -rc and prints the release commit message
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_LINE = /^version:[ \t]*(.*?)[ \t]*$/m;

/** `X.Y.Z` or `X.Y.Z-rc`; anything else is null. */
export function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(-rc)?$/.exec(value);
  return match ? { numbers: match.slice(1, 4).map(Number), rc: !!match[4] } : null;
}

function newer(a, b) {
  const index = a.findIndex((value, position) => value !== b[position]);
  return index >= 0 && a[index] > b[index];
}

/** Problems that stop a channel from publishing `versions`; `released` holds main's versions. */
export function versionProblems(channel, versions, released = {}) {
  const problems = [];
  for (const [id, value] of Object.entries(versions)) {
    const version = parseVersion(value);
    if (!version) problems.push(`${id}: version ${value || "(missing)"} is not X.Y.Z or X.Y.Z-rc.`);
    else if (version.rc && channel === "main")
      problems.push(`${id}: ${value} is a release candidate; it reaches main through a prerelease release.`);
    else if (version.rc && released[id] && !newer(version.numbers, parseVersion(released[id])?.numbers ?? [0, 0, 0]))
      problems.push(`${id}: ${value} must be newer than the released ${released[id]}.`);
  }
  return problems;
}

/** The manifest without its version's -rc suffix. */
export function finalManifest(text) {
  return text.replace(/^(version:[ \t]*\d+\.\d+\.\d+)-rc([ \t]*)$/m, "$1$2");
}

function manifests() {
  const registry = JSON.parse(fs.readFileSync(path.join(root, "scripts", "plugin-registry.json"), "utf8"));
  return registry.map(plugin => ({ id: plugin.id, file: `plugins/${plugin.directory}/${plugin.id}.yml` }));
}

function git(...args) {
  return spawnSync("git", args, { cwd: root, encoding: "utf8" });
}

function versionOf(text) {
  return VERSION_LINE.exec(text)?.[1] ?? "";
}

function check(channel) {
  const versions = {},
    released = {},
    problems = [];
  for (const { id, file } of manifests()) {
    versions[id] = versionOf(fs.readFileSync(path.join(root, file), "utf8"));
    if (channel !== "prerelease") continue;
    const shown = git("show", "origin/main:" + file);
    if (shown.status === 0) released[id] = versionOf(shown.stdout);
  }
  // A release fast-forwards main, so prerelease must already contain it.
  if (channel === "prerelease" && git("merge-base", "--is-ancestor", "origin/main", "HEAD").status !== 0)
    problems.push("prerelease lacks commits from main: merge or rebase onto origin/main, then push again.");
  problems.push(...versionProblems(channel, versions, released));
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
  console.log(`Versions are valid for ${channel}.`);
}

function finalize() {
  const released = [];
  for (const { file } of manifests()) {
    const target = path.join(root, file);
    const text = fs.readFileSync(target, "utf8");
    const final = finalManifest(text);
    if (final === text) continue;
    fs.writeFileSync(target, final);
    const name = /^name:[ \t]*(.*?)[ \t]*$/m.exec(final)?.[1] ?? file;
    released.push(`${name} ${versionOf(final)}`);
  }
  if (released.length) console.log("Release " + released.join(", "));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, channel] = process.argv.slice(2);
  if (command === "check" && (channel === "main" || channel === "prerelease")) check(channel);
  else if (command === "finalize") finalize();
  else throw new Error("Usage: node scripts/release.mjs check main|prerelease | finalize");
}
