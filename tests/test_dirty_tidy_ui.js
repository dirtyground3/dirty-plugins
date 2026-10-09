"use strict";
const assert = require("node:assert/strict"), {createTidyHarness} = require("./tidy_harness"), {text} = require("./ui_harness");
(async () => {
  const h = createTidyHarness({settings: {automationMode: "scan"}}); h.load(); await h.flush();
  assert.deepEqual(h.patches, ["App"]); assert.deepEqual(h.registrations, ["dirtyTidy"]); assert.equal(h.dirty.at(-1), false);
  const panel = h.panel; h.load(); assert.equal(h.panel, panel); assert.equal(h.patches.length, 1); assert.equal(h.registrations.length, 1);
  assert.equal(h.window.__dirtyTidySettings, undefined); assert.equal(h.window.__dirtyTidyPreview, undefined); assert.equal(h.window.__dirtyTidyPlugin.algorithms, undefined);
  const row = h.nodes(node => node.type === "button" && text(node).startsWith("Move into folders"))[0]; row.props.onClick(); await h.flush();
  await h.input("Folder level 1", "{title}"); assert.equal(h.dirty.at(-1), true); assert.equal(h.writes.length, 0);
  const menu = h.nodes(node => node.type === "ActionMenu" && node.props.ariaLabel === "Insert variable into folder level 1")[0];
  const inserted = menu.props.items.find(item => item.key === "year"); inserted.onSelect(); await h.flush();
  assert.equal(h.nodes(node => node.type === "input" && node.props["aria-label"] === "Folder level 1")[0].props.value, "{title}{year}");
  await h.click("Preview"); assert.equal(h.calls[0].mode, "preview"); assert.equal(h.writes.length, 0);
  await h.click("Show files"); assert.match(text(h.tree), /\/old\/a.mp4/);
  await h.click("Run 1 operation…"); assert.equal(h.nodes(node => node.type === "Dialog")[0].props.ariaLabel, "Confirm DirtyTidy plan");
  await h.click("Cancel"); assert.equal(h.requests.length, 0); assert.equal(h.writes.length, 0);
  await h.click("Run 1 operation…"); await h.click("Approve without running");
  assert.equal(h.writes[0].approvedStrategyHash, "b".repeat(64)); assert.equal(h.writes[0].approvedPlanDigest, "c".repeat(64)); assert.equal(h.requests.length, 0); assert.equal(h.dirty.at(-1), false);
  await h.mode("generate"); assert.equal(h.dirty.at(-1), true); assert.ok(h.button("Run 1 operation…"));
  await h.click("Run 1 operation…"); await h.click("Run now");
  assert.equal(h.requests[0].variables.args.mode, "execute"); assert.equal(h.requests[0].variables.args.expectedStrategyHash, "b".repeat(64)); assert.equal(h.dirty.at(-1), false);
  assert.match(text(h.tree), /Queued as Stash job 10/);
  const native = {type: "native-app"}, oldPatch = h.appPatch; h.window.__dirtyTidyPlugin.destroy(); await h.flush();
  assert.equal(h.panel, null); assert.equal(oldPatch(native), native); assert.equal(h.dirty.at(-1), false); h.load(); assert.equal(h.patches.length, 1);
  for (const scenario of [{patch: () => {throw Error("patch failure");}}, {register: () => {throw Error("registration failure");}}]) {
    const failure = createTidyHarness(scenario); failure.load(); failure.load(); assert.equal(failure.patches.length, 1); assert.ok(!failure.panel);
    assert.equal(failure.window.__dirtyTidyPlugin.status, "failed"); assert.equal(failure.appPatch(native), native);
  }
  const absent = createTidyHarness(); delete absent.window.DirtyPlugins.react.Dialog; absent.load(); assert.equal(absent.patches.length, 0); assert.equal(absent.window.__dirtyTidyPlugin, undefined);
  const reversible = createTidyHarness({register: () => {throw Error("failed");}}); delete reversible.window.PluginApi.patch; reversible.load(); assert.equal(reversible.window.__dirtyTidyPlugin, undefined);
  const failedFactory = createTidyHarness(); failedFactory.hub.createJobHook = () => {throw Error("factory failure");}; failedFactory.load();
  assert.equal(failedFactory.window.__dirtyTidyPlugin, undefined); assert.equal(failedFactory.patches.length, 0);
  const capture = createTidyHarness({capture: true, operation: args => ({settings: args.settings, strategy_hash: "b".repeat(64), total: 1,
    summary: {blocked: 1}, operations: [{file_id: "1", status: "blocked", source_path: "/private/source", destination_path: "/private/dest", actions: [], warnings: ["Private warning"], blocked_scenes: [{id: "7", title: "Private name"}]}]})});
  capture.load(); await capture.flush(); await capture.click("Preview"); await capture.click("Show files");
  assert.ok(text(capture.tree).includes("Path hidden")); assert.ok(text(capture.tree).includes("Details hidden for documentation")); assert.equal(text(capture.tree).includes("Private"), false); assert.equal(text(capture.tree).includes("/private"), false);
  await capture.unmount(); assert.equal(capture.dirty.at(-1), false);
  const blocked = createTidyHarness({operation: args => ({settings: args.settings, strategy_hash: "b", total: 1, summary: {blocked: 1}, operations: [
    {file_id: "1", status: "blocked", source_path: "/a.mp4", destination_path: "/b.mp4", actions: [], warnings: ["Collision"], blocked_scenes: [{id: "7", title: "First"}, {id: "8"}]}]})});
  blocked.load(); await blocked.flush(); await blocked.click("Preview"); await blocked.click("Show files");
  assert.match(text(blocked.tree), /CollisionBlocked scenes: First, Scene 8/); assert.deepEqual(blocked.nodes(node => node.type === "a").map(node => node.props.href), ["/scenes/7", "/scenes/8"]);
  console.log("DirtyTidy compiled TSX controls, confirmation, dirty reporting, masks, links, guards and cleanup passed");
})().catch(error => {console.error(error); process.exitCode = 1;});
