"use strict";
const assert = require("node:assert/strict");
const { requireSource } = require("./plugin_paths");
const { createHooks } = require("./ui_harness");
const { createSettingsDraftHook } = requireSource("DirtyPlugins", "src/settingsDraft.ts");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

function harness(overrides = {}) {
  const owner = { slots: [], cursor: 0, effects: [] },
    timers = new Map();
  let changed = true,
    mounted = true,
    value,
    now = 0,
    timerId = 0;
  const dirty = [],
    writes = [],
    saved = [],
    failures = [];
  const hooks = createHooks(() => owner);
  const React = {
    ...hooks,
    useState(initial) {
      const [current, set] = hooks.useState(initial);
      return [
        current,
        next => {
          assert(mounted, "no state updates after unmount");
          set(next);
          changed = true;
        },
      ];
    },
  };
  const hook = createSettingsDraftHook(React);
  const options = {
    initialValue: { amount: "0" },
    load: async () => ({ amount: 1, revision: 1 }),
    normalize: raw => ({ amount: String(raw.amount) }),
    validate: draft => (draft.amount === "" || !Number.isFinite(Number(draft.amount)) ? "Amount must be a number" : ""),
    comparable: JSON.stringify,
    serialize: draft => ({ amount: Number(draft.amount) }),
    save: async input => {
      writes.push(input);
      return { revision: writes.length + 1 };
    },
    onSaved: (draft, result, current) => saved.push({ draft, result, current }),
    onError: (error, draft, current) => failures.push({ error, draft, current }),
    onDirtyChange: state => dirty.push(state),
    delay: 500,
    setTimeout(fn, delay) {
      const id = ++timerId;
      timers.set(id, { fn, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    ...overrides,
  };
  function render() {
    owner.cursor = 0;
    changed = false;
    value = hook(options);
    for (const effect of owner.effects.splice(0)) effect();
  }
  async function settle() {
    for (let n = 0; n < 30; n++) {
      if (changed) render();
      await Promise.resolve();
    }
  }
  async function tick(delay = 500) {
    await settle();
    now += delay;
    for (const [id, timer] of [...timers])
      if (timer.at <= now) {
        timers.delete(id);
        timer.fn();
      }
    await settle();
  }
  return {
    settle,
    tick,
    dirty,
    writes,
    saved,
    failures,
    timers,
    options,
    get value() {
      return value;
    },
    edit(amount) {
      value.setDraft({ amount });
    },
    unmount() {
      for (const slot of owner.slots) if (slot?.cleanup) slot.cleanup();
      mounted = false;
      changed = false;
    },
  };
}

async function main() {
  // Imports and injectable hooks work without window, registration, or React packages.
  const h = harness();
  await h.settle();
  assert.equal(h.value.ready, true);
  assert.equal(h.value.dirty, false);
  h.edit("");
  await h.tick();
  assert.equal(h.value.draft.amount, "");
  assert.match(h.value.invalid, /number/);
  assert.equal(h.writes.length, 0);
  assert.equal(h.dirty.at(-1), true);
  h.edit("3");
  await h.tick();
  assert.deepEqual(h.writes, [{ amount: 3 }]);
  assert.equal(h.value.error, "");
  assert.equal(h.value.status.state, "saved");
  assert.equal(h.dirty.at(-1), false);
  h.edit("4");
  await h.settle();
  h.unmount();
  await h.tick();
  assert.equal(h.writes.length, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.dirty.at(-1), false);

  const first = deferred(),
    writes = [];
  let revision = 0;
  const race = harness({
    onLoaded: raw => {
      revision = raw.revision;
    },
    save: async input => {
      writes.push({ input, expectedRevision: revision });
      return writes.length === 1 ? first.promise : { revision: 3 };
    },
    onSaved: (_draft, result) => {
      revision = result.revision;
    },
  });
  await race.settle();
  race.edit("2");
  await race.tick();
  race.edit("3");
  await race.tick();
  assert.equal(writes.length, 1);
  first.resolve({ revision: 2 });
  await race.settle();
  await race.tick();
  assert.deepEqual(writes, [
    { input: { amount: 2 }, expectedRevision: 1 },
    { input: { amount: 3 }, expectedRevision: 2 },
  ]);
  assert.equal(race.value.draft.amount, "3");
  assert.equal(race.value.dirty, false);
  await race.tick();
  assert.equal(writes.length, 2, "older completions must not duplicate queued writes");
  race.unmount();

  // Reverting to the initial baseline while a different draft is in flight must
  // save the revert after that write completes, preserving the visible edit.
  const active = deferred(),
    revertedWrites = [];
  const revert = harness({
    save: async input => {
      revertedWrites.push(input);
      return revertedWrites.length === 1 ? active.promise : {};
    },
  });
  await revert.settle();
  revert.edit("2");
  await revert.tick();
  revert.edit("1");
  await revert.settle();
  assert.equal(revert.value.dirty, false);
  active.resolve({});
  await revert.settle();
  assert.equal(revert.value.dirty, true);
  await revert.tick();
  assert.deepEqual(revertedWrites, [{ amount: 2 }, { amount: 1 }]);
  revert.unmount();

  let fail = true,
    attempts = 0,
    conflictCallbacks = 0;
  const conflict = harness({
    save: async () => {
      attempts++;
      if (fail) throw Error("Settings revision conflict");
      return { revision: 2 };
    },
    onError: (error, draft, current) => {
      assert.match(error.message, /conflict/);
      assert.equal(draft.amount, "2");
      assert.equal(current, true);
      conflictCallbacks++;
    },
  });
  await conflict.settle();
  conflict.edit("2");
  await conflict.tick();
  assert.equal(conflict.value.status.state, "error");
  assert.equal(conflict.value.dirty, true);
  assert.equal(conflictCallbacks, 1);
  conflict.edit("3");
  await conflict.tick();
  assert.equal(attempts, 1, "failed writes remain blocked until explicit retry/reload");
  fail = false;
  conflict.value.retry();
  await conflict.tick();
  assert.equal(attempts, 2);
  assert.equal(conflict.value.draft.amount, "3");
  assert.equal(conflict.value.dirty, false);
  await conflict.value.reload();
  await conflict.settle();
  assert.equal(conflict.value.draft.amount, "1");
  conflict.unmount();

  const lateRead = deferred(),
    lateSave = deferred();
  let callbacks = 0;
  const loading = harness({ load: () => lateRead.promise });
  await loading.settle();
  loading.unmount();
  lateRead.resolve({ amount: 8 });
  await loading.settle();
  assert.equal(loading.timers.size, 0);
  const saving = harness({ save: () => lateSave.promise, onSaved: () => callbacks++ });
  await saving.settle();
  saving.edit("2");
  await saving.tick();
  saving.unmount();
  lateSave.resolve({});
  await saving.settle();
  assert.equal(callbacks, 0);
  assert.equal(saving.dirty.at(-1), false);

  const slow = deferred();
  let reads = 0;
  const reload = harness({ load: () => (++reads === 1 ? slow.promise : Promise.resolve({ amount: 9 })) });
  await reload.settle();
  await reload.value.reload();
  await reload.settle();
  slow.resolve({ amount: 2 });
  await reload.settle();
  assert.equal(reload.value.draft.amount, "9", "obsolete load completions cannot overwrite a newer reload");
  reload.unmount();
  console.log(
    "Shared settings draft: raw validation, serialized races/revisions, reverts, conflict/retry/reload, dirty notifications and cleanup passed",
  );
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
