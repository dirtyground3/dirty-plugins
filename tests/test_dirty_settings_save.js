"use strict";
const assert = require("node:assert/strict");
const { installSaveController } = require("./shared_runtime");

async function main() {
  const timers = new Map();
  let timerId = 0;
  const window = {
    DirtyPlugins: {},
    setTimeout(fn) {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
  };
  installSaveController(window);
  const create = window.DirtyPlugins.createSaveController;
  const writes = [],
    saved = [],
    states = [];
  let release;
  const controller = create({
    validate: value => (value < 0 ? "Invalid number" : ""),
    save(value) {
      writes.push(value);
      if (value === 2)
        return new Promise(resolve => {
          release = resolve;
        });
      if (value === 4) return Promise.reject(new Error("conflict"));
      return Promise.resolve(value * 10);
    },
    onSaved: (value, result, current) => saved.push({ value, result, current }),
    onStatus: value => states.push(value),
  });
  function tick() {
    const callbacks = [...timers.values()];
    timers.clear();
    callbacks.forEach(fn => fn());
  }
  controller.schedule(1);
  controller.schedule(2);
  assert.equal(timers.size, 1, "rapid edits coalesce");
  tick();
  await new Promise(setImmediate);
  controller.schedule(3);
  tick();
  assert.deepEqual(writes, [2], "the next request waits for the active write");
  release(20);
  await controller.flush();
  assert.deepEqual(writes, [2, 3]);
  assert.deepEqual(saved, [
    { value: 2, result: 20, current: false },
    { value: 3, result: 30, current: true },
  ]);
  controller.schedule(-1);
  assert.equal(timers.size, 0);
  assert.equal(states.at(-1).state, "invalid");
  controller.schedule(4);
  tick();
  await controller.flush();
  assert.equal(states.at(-1).state, "error");
  controller.schedule(5);
  tick();
  await controller.flush();
  assert.equal(controller.saved().value, 5, "a rejected write does not poison the queue");
  controller.schedule(6);
  controller.dispose();
  tick();
  await controller.flush();
  assert.deepEqual(writes, [2, 3, 4, 5], "disposal cancels pending writes");
  console.log("Shared settings debounce, serialization, validation, recovery and cleanup passed");
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
