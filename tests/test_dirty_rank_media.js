"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Exercise the actual component and asynchronous handlers without a Stash server.
const noop = function () {};
let active;
const React = {
  createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat() }; },
  useState(initial) {
    const owner = active;
    const index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = typeof initial === "function" ? initial() : initial;
    return [owner.slots[index], value => { owner.slots[index] = value; }];
  },
  useRef(initial) {
    const index = active.cursor++;
    if (!(index in active.slots)) active.slots[index] = { current: initial };
    return active.slots[index];
  },
  useEffect(effect, deps) {
    const index = active.cursor++;
    const old = active.slots[index];
    if (!old || deps.some((dep, i) => dep !== old.deps[i])) {
      active.slots[index] = { deps };
      active.effects.push(() => {
        if (old && old.cleanup) old.cleanup();
        active.slots[index].cleanup = effect();
      });
    }
  },
};
const calls = [];
let response;
const runtime = {
  getPluginSettings: () => Promise.resolve({}),
  runPluginOperation: () => Promise.resolve({ states: {} }),
  graphql: (query, variables) => { calls.push({ query, variables }); return response(); },
  values: {
    asObject: value => value || {},
    parseMaybeJson: value => value,
    coerceBoolean: (value, fallback) => typeof value === "boolean" ? value : fallback,
  },
};
const context = vm.createContext({
  console,
  Math: Object.create(Math),
  window: {
    DirtyPlugins: runtime,
    PluginApi: {
      React,
      libraries: { Intl: {}, ReactRouterDOM: { NavLink: "a" } },
      register: { route: noop }, patch: { before: noop, after: noop, instead: noop },
    },
    addEventListener: noop,
  },
});
let source = fs.readFileSync(path.join(__dirname, "../plugins/DirtyRank/dirtyRank.js"), "utf8");
source = source.replace("algorithms: {", "testing: { PerformerCard, serializedSettings }, algorithms: {");
vm.runInContext(source, context);
const plugin = context.window.__dirtyRankPlugin;
const settings = plugin.algorithms.settingsFromConfiguration({});
const scene = { id: "top", title: "Top scene", rating100: 100, paths: { stream: "/top.mp4" } };
const markerScene = { id: "curated", title: "Curated", rating100: 80, paths: { stream: "/curated.mp4" } };
const data = { top: { scenes: [scene] }, markers: { scene_markers: [
  { id: "marker", seconds: 12, end_seconds: 18, scene: markerScene },
] } };
let nextId = 0;
function card(auto, overrides) {
  let votes = 0;
  const state = { slots: [], effects: [], cursor: 0 };
  const props = {
    performer: { id: String(++nextId), name: "Example", image_path: "/portrait.svg", scene_count: 1 },
    pool: { matches: 0 }, settings: { ...settings, autoPlayTopScenes: auto, ...overrides },
    onChoose: () => votes++,
  };
  return {
    props,
    get votes() { return votes; },
    render() {
      active = state;
      state.cursor = 0;
      const tree = plugin.testing.PerformerCard(props);
      state.effects.splice(0).forEach(effect => effect());
      return tree;
    },
    unmount() { state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); }); },
  };
}
function find(tree, predicate) {
  if (!tree || typeof tree !== "object") return null;
  if (predicate(tree)) return tree;
  return tree.children.map(child => find(child, predicate)).find(Boolean);
}
const byClass = (tree, name) => find(tree, node => (node.props.className || "").split(" ").includes(name));
const video = tree => find(tree, node => node.type === "video");
const event = () => ({ preventDefault: noop, stopPropagation() { this.stopped = true; } });
const toggle = tree => byClass(tree, "dirty-rank-play-scene").props.onClick(event());
const flush = () => new Promise(resolve => setImmediate(resolve));

async function main() {
  assert.strictEqual(settings.autoPlayTopScenes, false);
  assert.strictEqual(plugin.testing.serializedSettings(
    plugin.algorithms.settingsFromConfiguration({ autoPlayTopScenes: true })
  ).autoPlayTopScenes, true);

  response = () => Promise.resolve(data);
  const manual = card(false);
  let tree = manual.render();
  assert.strictEqual(calls.length, 0, "default mode must not request media");
  toggle(tree);
  await flush();
  tree = manual.render();
  assert.strictEqual(video(tree).props.src, "/curated.mp4", "manual playback retains curated markers");
  const clip = { currentTime: 0, play: () => Promise.resolve(), pause() { this.paused = true; } };
  video(tree).props.onLoadedMetadata({ currentTarget: clip });
  assert.strictEqual(clip.currentTime, 12);
  clip.currentTime = 18;
  video(tree).props.onTimeUpdate({ currentTarget: clip });
  assert(clip.paused);

  for (const random of [0, 0.5, 0.999999]) {
    context.Math.random = () => random;
    const automatic = card(true);
    automatic.render();
    await flush();
    tree = automatic.render();
    assert.strictEqual(calls.at(-1).variables.includeMarkers, false);
    assert.strictEqual(calls.at(-1).variables.sceneFilter.performers.value[0], automatic.props.performer.id);
    assert.strictEqual(video(tree).props.src, "/top.mp4", "autoplay must choose the highest-rated full scene");
    assert.strictEqual(video(tree).props.muted, true);
    assert(find(tree, node => node.type === "img"), "photo and video must coexist");
    assert(!byClass(tree, "dirty-rank-portrait").props.onClick, "photo clicks must reach the voting card");
    const click = event();
    byClass(tree, "dirty-rank-scene-panel").props.onClick(click);
    assert(click.stopped, "player clicks must not bubble into a vote");
    const key = event();
    byClass(tree, "dirty-rank-scene-panel").props.onKeyDown(key);
    assert(key.stopped, "player keys must not trigger battle shortcuts");
    tree.props.onClick();
    assert.strictEqual(automatic.votes, 1);
    const player = { duration: 1000, currentTime: 0, play: () => Promise.resolve(), pause() { this.paused = true; } };
    video(tree).props.onLoadedMetadata({ currentTarget: player });
    assert(player.currentTime >= 300 && player.currentTime <= 700);
    assert.strictEqual(player.currentTime, 1000 * (0.3 + random * 0.4));
    player.currentTime = 800;
    video(tree).props.onDurationChange({ currentTarget: player });
    assert.strictEqual(player.currentTime, 800, "later duration events must not reset playback");
    video(tree).props.ref.current = player;
    toggle(tree);
    assert(player.paused, "closing must stop playback");
    assert(!video(automatic.render()), "closing must not immediately reopen an automatic preview");
    automatic.unmount();
  }

  // A full-scene fallback opened manually also starts randomly, once duration is known.
  response = () => Promise.resolve({ top: { scenes: [scene] } });
  const fallback = card(false);
  toggle(fallback.render());
  await flush();
  tree = fallback.render();
  const delayed = { duration: Infinity, currentTime: 0, play: () => Promise.reject(new Error("Blocked")) };
  video(tree).props.onLoadedMetadata({ currentTarget: delayed });
  assert.strictEqual(delayed.currentTime, 0);
  delayed.duration = 200;
  video(tree).props.onDurationChange({ currentTarget: delayed });
  assert(delayed.currentTime >= 60 && delayed.currentTime <= 140);
  await flush();

  const hidden = card(true, { hidePerformerImages: true });
  hidden.render();
  await flush();
  tree = hidden.render();
  assert(video(tree));
  assert(!find(tree, node => node.type === "img"));
  const noScenes = card(true);
  noScenes.props.performer.scene_count = 0;
  const before = calls.length;
  noScenes.render();
  assert.strictEqual(calls.length, before);

  let resolve;
  response = () => new Promise(done => { resolve = done; });
  const cancelled = card(true);
  cancelled.render();
  toggle(cancelled.render());
  resolve(data);
  await flush();
  assert(!video(cancelled.render()), "cancelled requests must not reopen a scene");
  const unmounted = card(true);
  unmounted.render();
  unmounted.unmount();
  resolve(data);
  await flush();
  assert(!video(unmounted.render()), "late results must be ignored after changing battles");

  response = () => Promise.reject(new Error("Network unavailable"));
  const failed = card(true);
  failed.render();
  await flush();
  tree = failed.render();
  assert(byClass(tree, "dirty-rank-scene-error"));
  response = () => Promise.resolve({ top: { scenes: [] } });
  toggle(tree);
  await flush();
  tree = failed.render();
  assert.strictEqual(byClass(tree, "dirty-rank-scene-error").children[0], "No playable scene found.");
  assert(find(tree, node => node.type === "img"), "failures must leave voting photos available");
  console.log("DirtyRank media behavior tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
