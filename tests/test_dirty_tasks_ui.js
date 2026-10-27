"use strict";
const assert = require("node:assert/strict");
const { createCompactorHarness } = require("./compactor_harness");
const { requireSource } = require("./plugin_paths");
const { text } = require("./ui_harness");

async function main() {
  const rule = requireSource("DirtyTasks", "src/encoding/domain/rules.ts").newRule();
  const h = createCompactorHarness({ combined: true, settings: { rules: [rule], automationPaused: true } });
  h.load();
  h.load();
  await h.flush();
  assert.deepEqual(h.registrations, ["dirtyTasks"]);
  assert.deepEqual(h.patches, ["App"]);
  assert(h.nodes(node => node.type === "SettingsSection" && node.props.title === "File organization and tags").length);
  assert(h.nodes(node => node.type === "SettingsSection" && node.props.title === "Encoding").length);
  assert.equal(
    h.nodes(node => node.type === "select" && node.props["aria-label"] === "Move into folders trigger").length,
    1,
  );
  assert.equal(h.nodes(node => node.props["aria-label"] === "Organization automation mode").length, 0);
  assert.equal(h.nodes(node => node.type === "SettingsToggle" && node.props.label === "Automatic runs").length, 0);
  assert.equal(h.dirty.at(-1), false);
  const folder = h.nodes(node => node.type === "button" && text(node).startsWith("Move into folders"))[0];
  folder.props.onClick();
  await h.flush();
  const input = h.nodes(node => node.type === "input" && node.props["aria-label"] === "Folder level 1")[0];
  input.props.onChange({ target: { value: "{title}" } });
  await h.flush();
  assert.equal(h.dirty.at(-1), true);
  await h.click("Add rule");
  await h.advance(500);
  assert.equal(h.writes.length, 1, "encoding autosaves independently");
  assert.equal(h.writes[0].rules.length, 2);
  assert.equal(h.writes[0].hierarchyLevels, undefined, "autosave never includes the unsaved organization draft");
  assert.equal(h.dirty.at(-1), true, "encoding becoming clean cannot clear organization's dirty report");
  h.nodes(node => node.type === "select" && node.props["aria-label"] === "Move into folders trigger")[0].props.onChange(
    {
      target: { value: "generate" },
    },
  );
  await h.advance(500);
  assert.deepEqual(
    h.writes[1],
    { move: "generate", rename: "manual", tags: "manual", encoding: {} },
    "action triggers save in their own section",
  );
  assert.equal(h.dirty.at(-1), true, "saving triggers preserves an unsaved organization draft");
  assert.equal(
    h.nodes(node => node.type === "input" && node.props["aria-label"] === "Folder level 1")[0].props.value,
    "{title}",
  );
  await h.click("Save");
  assert.equal(h.writes.length, 3);
  assert.equal(h.writes[2].hierarchyLevels[0], "{title}");
  assert.equal(h.writes[2].rules, undefined);
  assert.equal(h.dirty.at(-1), false);
  assert.equal(h.nodes(node => node.props["aria-label"] === "Running strategy").length, 0);
  const changeTrigger = (label, value) =>
    h
      .nodes(node => node.type === "select" && node.props["aria-label"] === label + " trigger")[0]
      .props.onChange({ target: { value } });
  changeTrigger("Rename files", "scan");
  await h.flush();
  changeTrigger("Update scene tags", "generate");
  await h.flush();
  changeTrigger(rule.name, "scan");
  await h.advance(500);
  assert.deepEqual(h.writes.at(-1), {
    move: "generate",
    rename: "scan",
    tags: "generate",
    encoding: { [rule.id]: "scan" },
  });
  const selectors = h.nodes(node => node.type === "select" && node.props["aria-label"] === "New rule trigger");
  assert.equal(selectors.length, 2);
  assert.equal(selectors[1].props.value, "manual", "new rules start with a Manual trigger");
  assert.equal(h.dirty.at(-1), false, "all trigger saves leave the content editors clean");
  const failed = createCompactorHarness({
    combined: true,
    saveExecution: async () => {
      throw Error("Strategy save failed");
    },
  });
  failed.load();
  await failed.flush();
  failed
    .nodes(node => node.type === "select" && node.props["aria-label"] === "Move into folders trigger")[0]
    .props.onChange({ target: { value: "scan" } });
  await failed.advance(500);
  assert(failed.button("Reload triggers"));
  assert.equal(failed.dirty.at(-1), true);
  await failed.click("Reload triggers");
  assert.equal(
    failed.nodes(node => node.type === "select" && node.props["aria-label"] === "Move into folders trigger")[0].props
      .value,
    "manual",
  );
  assert.equal(failed.dirty.at(-1), false);
  failed.unmount();
  assert.equal(h.button("Accept and replace"), undefined);
  assert.equal(h.button("Restore original"), undefined);
  assert(!text(h.tree).includes("Delete scene and files"));
  assert.equal(h.button("Recover organization task"), undefined, "healthy tasks have no recovery action");
  assert.equal(
    h.nodes(node => node.type === "ActionMenu" && node.props.ariaLabel === "More organization actions").length,
    0,
  );
  let recoveryRequired = false;
  let recoveryFails = false;
  let statusFails = false;
  const recovery = createCompactorHarness({
    combined: true,
    operation: async args => {
      if (args.mode === "organizationRecoveryStatus") {
        if (statusFails) throw Error("Unavailable");
        return { required: recoveryRequired };
      }
      if (args.mode === "recoverOrganization") {
        if (recoveryFails) throw Error("Recovery failed");
        recoveryRequired = false;
        return { recovered: true };
      }
    },
  });
  recovery.load();
  await recovery.flush();
  assert.equal(recovery.button("Recover organization task"), undefined);
  recoveryRequired = true;
  await recovery.event({
    type: "REMOVE",
    job: { id: "7", status: "FAILED", description: "DirtyTasks: organization: apply confirmed file organization plan" },
  });
  assert.equal(
    recovery.nodes(
      node =>
        node.type === "StateView" && node.props.role === "alert" && node.props.className === "dirty-tasks-recovery",
    ).length,
    1,
  );
  assert(recovery.button("Recover organization task"));
  recoveryFails = true;
  await recovery.click("Recover organization task");
  assert(recovery.button("Recover organization task"), "a failed recovery keeps the warning actionable");
  assert(
    recovery.nodes(node => node.type === "StateView" && node.props.detail === "Recovery could not finish. Try again.")
      .length,
  );
  recoveryFails = false;
  const recoveryButton = recovery.button("Recover organization task");
  recoveryButton.props.onClick();
  recoveryButton.props.onClick();
  await recovery.flush();
  assert.equal(
    recovery.calls.filter(args => args.mode === "recoverOrganization").length,
    2,
    "one failed attempt and one successful attempt; rapid clicks are ignored",
  );
  assert.equal(recovery.button("Recover organization task"), undefined, "recovery clears the warning");
  statusFails = true;
  await recovery.focus();
  assert.equal(recovery.button("Recover organization task"), undefined, "unknown status never offers recovery");
  assert(recovery.button("Check again"));
  statusFails = false;
  recoveryRequired = true;
  await recovery.click("Check again");
  assert(recovery.button("Recover organization task"));
  recoveryRequired = false;
  await recovery.focus();
  assert.equal(recovery.button("Recover organization task"), undefined);
  recovery.unmount();
  assert.equal(recovery.listeners.get("focus").size, 0, "the status listener is removed when the page closes");
  let dismissFails = true;
  const imported = createCompactorHarness({
    combined: true,
    migration: { imported: true, removedDeleteRules: 1 },
    operation: async args => {
      if (args.mode !== "dismissMigrationNotice") return undefined;
      if (dismissFails) throw Error("Unavailable");
      return { imported: true, removedDeleteRules: 1, dismissed: true };
    },
  });
  imported.load();
  await imported.flush();
  const dismissButton = () =>
    imported.nodes(node => node.type === "IconButton" && node.props.ariaLabel === "Dismiss import summary")[0];
  assert(text(imported.tree).includes("Removed Delete rules: 1."));
  dismissButton().props.onClick();
  await imported.flush();
  assert(dismissButton(), "a failed dismissal keeps the summary");
  dismissFails = false;
  dismissButton().props.onClick();
  await imported.flush();
  assert.equal(dismissButton(), undefined);
  assert(!text(imported.tree).includes("Existing task settings imported"));
  assert.equal(imported.calls.filter(args => args.mode === "dismissMigrationNotice").length, 2);
  imported.unmount();
  const dismissed = createCompactorHarness({ combined: true, migration: { imported: true, dismissed: true } });
  dismissed.load();
  await dismissed.flush();
  assert(!text(dismissed.tree).includes("Existing task settings imported"), "a dismissed summary stays hidden");
  dismissed.unmount();
  h.unmount();
  await h.flush();
  assert.equal(h.timers.size, 0);
  assert.equal(h.dirty.at(-1), false);
  console.log(
    "DirtyTasks staged combined panel, one registration, isolated saves, aggregate dirty state and cleanup passed",
  );
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
