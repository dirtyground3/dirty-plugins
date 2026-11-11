"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { test } = require("node:test");

const root = path.join(__dirname, "..");
const release = () => import("../scripts/release.mjs");

test("main publishes releases only and prerelease adds newer release candidates", async () => {
  const { versionProblems } = await release();
  assert.deepEqual(versionProblems("main", { a: "1.0.3", b: "2.10.0" }), []);
  assert.match(versionProblems("main", { a: "1.0.4-rc" })[0], /a: 1\.0\.4-rc is a release candidate/);
  assert.deepEqual(versionProblems("prerelease", { a: "1.0.4-rc", b: "1.0.3" }, { a: "1.0.3", b: "1.0.3" }), []);
  // A new plugin has no released version to compare with.
  assert.deepEqual(versionProblems("prerelease", { c: "1.0.0-rc" }, {}), []);
  assert.match(versionProblems("prerelease", { a: "1.0.3-rc" }, { a: "1.0.3" })[0], /newer than the released 1\.0\.3/);
  assert.match(versionProblems("prerelease", { a: "1.0.9-rc" }, { a: "1.1.0" })[0], /newer than the released 1\.1\.0/);
  assert.deepEqual(versionProblems("prerelease", { a: "1.10.0-rc" }, { a: "1.9.9" }), []);
  for (const value of ["1.0", "1.0.3-beta", "1.0.3-rc.1", "v1.0.3", ""])
    assert.equal(versionProblems("prerelease", { a: value }).length, 1, value);
});

test("finalizing removes only the version's -rc", async () => {
  const { finalManifest } = await release();
  const manifest = "name: DirtyRank\ndescription: Keeps 1.0.4-rc notes.\nversion: 1.0.4-rc\nui:\n  css: []\n";
  assert.equal(finalManifest(manifest), manifest.replace("version: 1.0.4-rc", "version: 1.0.4"));
  assert.equal(finalManifest("version: 1.0.4\n"), "version: 1.0.4\n");
});

test("GitHub Releases take their notes from the README and skip versions that have one", async () => {
  const { missingReleases, releaseNotes, releaseTag } = await release();
  const readme = [
    "# Plugins",
    "",
    "## Release notes",
    "",
    "- **DirtyMultiscreen 1.0.25:** the grid button opens edit mode, see",
    "  [For plugin authors](#for-plugin-authors) and [the plugin](plugins/DirtyMultiscreen/).",
    "",
    "- **DirtyTasks 1.0.11 and DirtyCaptions 1.0.9:** encoding runs no longer",
    "  block organization.",
    "  - A nested point stays a nested point.",
    "",
    "- **DirtyMultiscreen 1.0.2:** an older release.",
    "",
    "- **DirtyMultiscreen 1.0.250:** not this one.",
    "",
    "## License",
    "",
    "- **DirtyMultiscreen 1.0.25:** outside the notes.",
  ].join("\n");
  const tag = releaseTag("multiscreen", "1.0.25");
  assert.equal(tag, "multiscreen-v1.0.25");
  assert.equal(
    releaseNotes(readme, "DirtyMultiscreen", "1.0.25", "owner/repo", tag),
    "- **DirtyMultiscreen 1.0.25:** the grid button opens edit mode, see " +
      "[For plugin authors](https://github.com/owner/repo/blob/multiscreen-v1.0.25/README.md#for-plugin-authors) and " +
      "[the plugin](https://github.com/owner/repo/blob/multiscreen-v1.0.25/plugins/DirtyMultiscreen/).",
  );
  // A note shared by two plugins belongs to both, and nested items keep their own lines.
  const shared =
    "- **DirtyTasks 1.0.11 and DirtyCaptions 1.0.9:** encoding runs no longer block organization.\n" +
    "  - A nested point stays a nested point.";
  assert.equal(releaseNotes(readme, "DirtyCaptions", "1.0.9", "owner/repo", "t"), shared);
  assert.equal(releaseNotes(readme, "DirtyTasks", "1.0.11", "owner/repo", "t"), shared);
  assert.equal(releaseNotes(readme, "DirtyStats", "1.0.14", "owner/repo", "t"), "");

  const plugins = [
    { id: "multiscreen", name: "DirtyMultiscreen", version: "1.0.25" },
    { id: "dirtyStats", name: "DirtyStats", version: "1.0.14" },
  ];
  assert.deepEqual(
    missingReleases(plugins, new Set(["dirtyStats-v1.0.14", "multiscreen-v1.0.24"])).map(plugin => plugin.tag),
    ["multiscreen-v1.0.25"],
  );
  assert.deepEqual(missingReleases(plugins, new Set(["dirtyStats-v1.0.14", "multiscreen-v1.0.25"])), []);
});

function serve(files) {
  const requests = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    requests.push(url.pathname + url.search);
    const body = files[url.pathname];
    response.writeHead(body === undefined ? 404 : 200);
    response.end(body);
  });
  return new Promise(resolve =>
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, requests, base: `http://127.0.0.1:${server.address().port}` }),
    ),
  );
}

function fetchChannel(source, directory) {
  return new Promise(resolve =>
    execFile(
      process.execPath,
      [path.join(root, "scripts", "fetch-channel.mjs"), source, directory],
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }),
    ),
  );
}

test("a deploy keeps the other channel's published packages", async t => {
  const zip = Buffer.from("zip bytes");
  const sha256 = crypto.createHash("sha256").update(zip).digest("hex");
  const index = (checksum, file = "dirtyRank.zip") =>
    `- id: dirtyRank\n  version: 1.0.4-rc-abc1234-0123456789ab\n  path: ${file}\n  sha256: ${checksum}\n`;
  const { server, requests, base } = await serve({
    "/site/prerelease/index.yml": index(sha256),
    "/site/prerelease/dirtyRank.zip": zip,
    "/site/broken/index.yml": index("0".repeat(64)),
    "/site/broken/dirtyRank.zip": zip,
    "/site/outside/index.yml": index(sha256, "../main/dirtyRank.zip"),
  });
  t.after(() => server.close());
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dirty-channel-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const kept = await fetchChannel(base + "/site/prerelease/index.yml", path.join(directory, "prerelease"));
  assert.equal(kept.code, 0, kept.stderr);
  assert.equal(fs.readFileSync(path.join(directory, "prerelease", "index.yml"), "utf8"), index(sha256));
  assert.deepEqual(fs.readFileSync(path.join(directory, "prerelease", "dirtyRank.zip")), zip);
  // Every request bypasses the CDN copy.
  assert.ok(
    requests.every(request => /[?&]fresh=\d+/.test(request)),
    requests.join(", "),
  );

  const missing = await fetchChannel(base + "/site/main/index.yml", path.join(directory, "main"));
  assert.equal(missing.code, 0, missing.stderr);
  assert.match(missing.stdout, /Nothing is published/);
  assert.equal(fs.existsSync(path.join(directory, "main")), false);

  const broken = await fetchChannel(base + "/site/broken/index.yml", path.join(directory, "broken"));
  assert.notEqual(broken.code, 0);
  assert.match(broken.stderr, /does not match its checksum: dirtyRank\.zip/);
  assert.equal(fs.existsSync(path.join(directory, "broken", "index.yml")), false);

  const outside = await fetchChannel(base + "/site/outside/index.yml", path.join(directory, "outside"));
  assert.notEqual(outside.code, 0);
  assert.match(outside.stderr, /Unexpected package path/);
});
