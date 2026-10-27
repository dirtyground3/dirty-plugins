"use strict";
const assert = require("node:assert/strict"),
  { createTidyHarness } = require("./tidy_harness"),
  { text } = require("./ui_harness");
(async () => {
  const h = createTidyHarness({ settings: { automationMode: "scan" } });
  h.load();
  await h.flush();
  assert.deepEqual(h.patches, ["App"]);
  assert.deepEqual(h.registrations, ["dirtyTasks"]);
  assert.equal(h.dirty.at(-1), false);
  const panel = h.panel;
  h.load();
  assert.equal(h.panel, panel);
  assert.equal(h.patches.length, 1);
  assert.equal(h.registrations.length, 1);
  assert.equal(h.window.__dirtyTidySettings, undefined);
  assert.equal(h.window.__dirtyTidyPreview, undefined);
  const row = h.nodes(node => node.type === "button" && text(node).startsWith("Move into folders"))[0];
  row.props.onClick();
  await h.flush();
  await h.input("Folder level 1", "{title}");
  assert.equal(h.dirty.at(-1), true);
  assert.equal(h.writes.length, 0);
  const menu = h.nodes(
    node => node.type === "ActionMenu" && node.props.ariaLabel === "Insert variable into folder level 1",
  )[0];
  const inserted = menu.props.items.find(item => item.key === "year");
  inserted.onSelect();
  await h.flush();
  assert.equal(
    h.nodes(node => node.type === "input" && node.props["aria-label"] === "Folder level 1")[0].props.value,
    "{title}{year}",
  );
  await h.click("Preview");
  assert.equal(h.calls[0].mode, "preview");
  assert.equal(h.writes.length, 0);
  await h.click("Show files");
  assert.match(text(h.tree), /\/old\/a.mp4/);
  await h.click("Run 1 operation…");
  assert.equal(h.nodes(node => node.type === "Dialog")[0].props.ariaLabel, "Confirm organization plan");
  await h.click("Cancel");
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
  await h.click("Run 1 operation…");
  await h.click("Approve without running");
  assert.equal(h.writes[0].approvedStrategyHash, "b".repeat(64));
  assert.equal(h.writes[0].approvedPlanDigest, "c".repeat(64));
  assert.equal(h.requests.length, 0);
  assert.equal(h.dirty.at(-1), false);
  await h.mode("generate");
  assert.equal(h.dirty.at(-1), false, "the shared mode is not an organization draft edit");
  assert.ok(h.button("Run 1 operation…"));
  await h.click("Run 1 operation…");
  await h.click("Run now");
  assert.equal(h.requests[0].variables.args.mode, "execute");
  assert.equal(h.requests[0].variables.args.expectedStrategyHash, "b".repeat(64));
  assert.equal(h.requests[0].variables.args.expectedPlanDigest, "c".repeat(64));
  assert.equal(h.dirty.at(-1), false);
  assert.match(text(h.tree), /Queued as Stash job 10/);
  await h.unmount();
  assert.equal(h.dirty.at(-1), false, "unmounting the panel clears its dirty report");
  // A failed registration is logged once and never retried by a reloaded bundle.
  const failure = createTidyHarness({
    patch: () => {
      throw Error("patch failure");
    },
  });
  failure.load();
  failure.load();
  assert.equal(failure.patches.length, 1);
  assert.ok(!failure.panel);
  assert.match(String(failure.errors[0][0]), /\[dirtyTasks\] registration failed/);
  assert.equal(failure.errors.length, 1);
  const capture = createTidyHarness({
    capture: true,
    operation: args => ({
      settings: args.settings,
      strategy_hash: "b".repeat(64),
      plan_digest: "c".repeat(64),
      total: 1,
      summary: { blocked: 1 },
      operations: [
        {
          file_id: "1",
          status: "blocked",
          source_path: "/private/source",
          destination_path: "/private/dest",
          actions: [],
          warnings: ["Private warning"],
          blocked_scenes: [{ id: "7", title: "Private name" }],
        },
      ],
    }),
  });
  capture.load();
  await capture.flush();
  await capture.click("Preview");
  await capture.click("Show files");
  assert.ok(text(capture.tree).includes("Path hidden"));
  assert.ok(text(capture.tree).includes("Details hidden for documentation"));
  assert.equal(text(capture.tree).includes("Private"), false);
  assert.equal(text(capture.tree).includes("/private"), false);
  await capture.unmount();
  assert.equal(capture.dirty.at(-1), false);
  const blocked = createTidyHarness({
    operation: args => ({
      settings: args.settings,
      strategy_hash: "b",
      plan_digest: "c",
      total: 1,
      summary: { blocked: 1 },
      operations: [
        {
          file_id: "1",
          status: "blocked",
          source_path: "/a.mp4",
          destination_path: "/b.mp4",
          actions: [],
          warnings: ["Collision"],
          blocked_scenes: [{ id: "7", title: "First" }, { id: "8" }],
        },
      ],
    }),
  });
  blocked.load();
  await blocked.flush();
  await blocked.click("Preview");
  await blocked.click("Show files");
  assert.match(text(blocked.tree), /CollisionBlocked scenes: First, Scene 8/);
  assert.deepEqual(
    blocked.nodes(node => node.type === "a").map(node => node.props.href),
    ["/scenes/7", "/scenes/8"],
  );
  const tags = createTidyHarness({
    settings: { moveEnabled: false, approvedStrategyHash: "a".repeat(64) },
    sources: async () => ({
      configuration: { general: { stashBoxes: [{ name: "stashdb", endpoint: "https://stashdb.org/graphql" }] } },
    }),
  });
  tags.load();
  await tags.flush();
  assert.equal(tags.sourceRequests.length, 1);
  await tags.toggle("Update scene tags", true);
  assert.match(text(tags.tree), /stash-box: stashdb/);
  await tags.click("Save");
  assert.equal(tags.writes.length, 0, "enabling tags requires a source");
  assert.match(text(tags.tree), /Choose a tagger source before saving/);
  const source = tags.nodes(node => node.type === "select" && node.props["aria-label"] === "Tagger source")[0];
  source.props.onChange({ target: { value: "https://stashdb.org/graphql" } });
  await tags.flush();
  await tags.click("Save");
  assert.equal(tags.writes[0].tagUpdateEnabled, true);
  assert.equal(tags.writes[0].taggerEndpoint, "https://stashdb.org/graphql");
  assert.equal(
    tags.writes[0].automationMode,
    "manual",
    "manual tag refresh remains available under the shared Manual setting",
  );
  assert.equal(tags.writes[0].approvedStrategyHash, "a".repeat(64));
  assert.equal(tags.dirty.at(-1), false);
  assert.match(text(tags.tree), /cached for one day/);
  await tags.click("Refresh tags now");
  assert.equal(tags.requests[0].variables.args.mode, "updateTags");
  assert.equal(tags.requests[0].variables.args.force, true);
  assert.match(tags.notifications.at(-1), /tag refresh queued/);
  await tags.toggle("Update scene tags", false);
  assert.equal(tags.button("Refresh tags now").props.disabled, true);
  await tags.button("Refresh tags now").props.onClick();
  await tags.flush();
  assert.equal(tags.requests.length, 1, "disabled or unsaved settings cannot queue a refresh");
  let sourceAttempts = 0;
  const unavailable = createTidyHarness({
    sources: async () => {
      if (++sourceAttempts === 1) throw Error("Offline");
      return { configuration: { general: { stashBoxes: [] } } };
    },
  });
  unavailable.load();
  await unavailable.flush();
  await unavailable.toggle("Update scene tags", true);
  assert.equal(
    unavailable.nodes(node => node.type === "Field" && node.props.label === "Tagger source")[0].props.error,
    "Could not load tagger sources.",
  );
  await unavailable.click("Retry sources");
  assert.match(text(unavailable.tree), /Add a stash-box source/);
  console.log(
    "DirtyTidy compiled TSX controls, confirmation, dirty reporting, masks, links, guards and cleanup passed",
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
