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
  useCallback(callback, deps) {
    const index = active.cursor++;
    const old = active.slots[index];
    if (!old || deps.some((dep, i) => dep !== old.deps[i])) active.slots[index] = { deps, callback };
    return active.slots[index].callback;
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
const timers = new Map();
let nextTimer = 0;
let response;
const runtime = {
  getPluginSettings: () => Promise.resolve({}),
  runPluginOperation: () => Promise.resolve({ states: {} }),
  graphql: (query, variables, options) => { calls.push({ query, variables, signal: options && options.signal }); return response(options && options.signal); },
  values: {
    asObject: value => value || {},
    parseMaybeJson: value => value,
    coerceBoolean: (value, fallback) => typeof value === "boolean" ? value : fallback,
  },
};
const context = vm.createContext({
  console,
  AbortController,
  Math: Object.create(Math),
  window: {
    DirtyPlugins: runtime,
    PluginApi: {
      React,
      libraries: { Intl: {}, ReactRouterDOM: { NavLink: "a" } },
      register: { route: noop }, patch: { before: noop, after: noop, instead: noop },
    },
    addEventListener: noop,
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id),
  },
});
let source = fs.readFileSync(path.join(__dirname, "../plugins/DirtyRank/dirtyRank.js"), "utf8");
source = source.replace("algorithms: {", "testing: { PerformerCard, serializedSettings, LeaderboardGalleryCard, LeaderboardPodium, loadNativePerformerCard, queryPerformers }, algorithms: {");
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
  let tree;
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
      tree = plugin.testing.PerformerCard(props);
      state.effects.splice(0).forEach(effect => effect());
      return tree;
    },
    unmount() {
      // React detaches the ref before running passive effect cleanups.
      if (video(tree)) video(tree).props.ref(null);
      state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
    },
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
const flush = () => {
  const pending = Array.from(timers.values());
  timers.clear();
  pending.forEach(callback => callback());
  return new Promise(resolve => setImmediate(resolve));
};
function attachPlayer(tree, attributes) {
  const player = {
    src: video(tree).props.src,
    loadCalls: 0,
    pause() { this.paused = true; },
    removeAttribute(name) { delete this[name]; },
    load() { this.loadCalls++; },
    ...attributes,
  };
  video(tree).props.ref(player);
  return player;
}

async function main() {
  const hubSource = fs.readFileSync(path.join(__dirname, "../plugins/DirtyPlugins/dirtyPlugins.js"), "utf8");
  const graphqlSource = hubSource.slice(hubSource.indexOf("  function graphql("), hubSource.indexOf("  function parseMaybeJson("));
  const graphql = vm.runInNewContext("(" + graphqlSource.trim() + ")", {
    fetch: (_url, options) => {
      if (!options.signal) return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: { ok: true } }) });
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(Object.assign(new Error("Cancelled"), { name: "AbortError" })));
      });
    },
  });
  const requestController = new AbortController();
  const abortedRequest = graphql("query { ok }", {}, { signal: requestController.signal });
  requestController.abort();
  await assert.rejects(abortedRequest, { name: "AbortError" }, "the shared helper must forward cancellation to fetch");
  assert.strictEqual((await graphql("query { ok }", {})).ok, true, "existing callers must work without cancellation options");

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
  const clip = attachPlayer(tree, { currentTime: 0, play: () => Promise.resolve() });
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
    tree.props.onClick({ ...event(), target: {} });
    assert.strictEqual(automatic.votes, 1);
    const player = attachPlayer(tree, { duration: 1000, currentTime: 0, play: () => Promise.resolve() });
    video(tree).props.onLoadedMetadata({ currentTarget: player });
    assert(player.currentTime >= 300 && player.currentTime <= 700);
    assert.strictEqual(player.currentTime, 1000 * (0.3 + random * 0.4));
    player.currentTime = 800;
    video(tree).props.onDurationChange({ currentTarget: player });
    assert.strictEqual(player.currentTime, 800, "later duration events must not reset playback");
    toggle(tree);
    assert(player.paused, "closing must stop playback");
    assert.strictEqual(player.src, undefined, "closing must release the download URL");
    assert.strictEqual(player.loadCalls, 1, "closing must abort the active media resource");
    assert(!video(automatic.render()), "closing must not immediately reopen an automatic preview");
    automatic.unmount();
  }

  // A full-scene fallback opened manually also starts randomly, once duration is known.
  response = () => Promise.resolve({ top: { scenes: [scene] } });
  const fallback = card(false);
  toggle(fallback.render());
  await flush();
  tree = fallback.render();
  const delayed = attachPlayer(tree, { duration: Infinity, currentTime: 0, play: () => Promise.reject(new Error("Blocked")) });
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
  await flush();
  const cancelledSignal = calls.at(-1).signal;
  toggle(cancelled.render());
  assert(cancelledSignal.aborted, "closing must abort pending metadata requests");
  resolve(data);
  await flush();
  assert(!video(cancelled.render()), "cancelled requests must not reopen a scene");
  const unmounted = card(true);
  unmounted.render();
  await flush();
  const unmountedSignal = calls.at(-1).signal;
  unmounted.unmount();
  assert(unmountedSignal.aborted, "navigation must abort pending metadata requests");
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

  response = () => Promise.resolve(data);
  const released = card(true);
  released.render();
  await flush();
  tree = released.render();
  const loadingVideo = attachPlayer(tree, { duration: NaN, currentTime: 0, play: noop });
  const originalRef = video(tree).props.ref;
  assert.strictEqual(video(released.render()).props.ref, originalRef, "ordinary rerenders must not detach a video");
  released.unmount();
  assert(loadingVideo.paused);
  assert.strictEqual(loadingVideo.src, undefined);
  assert.strictEqual(loadingVideo.loadCalls, 1, "detach must cancel a loading stream before effect cleanup");
  loadingVideo.duration = 1000;
  video(tree).props.onLoadedMetadata({ currentTarget: loadingVideo });
  assert.strictEqual(loadingVideo.currentTime, 0, "late metadata events must not restart a released video");

  const requestsBeforeBurst = calls.length;
  for (let i = 0; i < 20; i++) {
    const skipped = card(true);
    skipped.render();
    skipped.unmount();
  }
  await flush();
  assert.strictEqual(calls.length, requestsBeforeBurst, "rapid battles must not queue obsolete previews");
  const latest = card(true);
  latest.render();
  await flush();
  assert(video(latest.render()), "the last battle must still load after a rapid burst");

  // Standings delegate the actual performer card to Stash, retaining theme/plugin hooks.
  const api = context.window.PluginApi;
  const nativeCard = function NativePerformerCard() {};
  api.components = {};
  api.loadableComponents = { PerformerCard: "native-performer-module" };
  let loadedModule;
  api.utils = { loadComponents: modules => {
    loadedModule = modules[0];
    api.components.PerformerCard = nativeCard;
    return Promise.resolve();
  } };
  await plugin.testing.loadNativePerformerCard();
  assert.strictEqual(loadedModule, "native-performer-module");
  const rankedPerformer = { ...manual.props.performer, rating100: 87, favorite: true };
  const standingsProps = {
    performer: rankedPerformer, rank: 4, ranked: [rankedPerformer],
    cohort: "FEMALE", leaderboardId: "appearance", settings,
  };
  active = { slots: [], effects: [], cursor: 0 };
  const gallery = plugin.testing.LeaderboardGalleryCard(standingsProps);
  const nativeGallery = find(gallery, node => node.type === nativeCard);
  assert(nativeGallery, "gallery must use the real native component");
  assert.strictEqual(nativeGallery.props.performer, rankedPerformer);
  assert.strictEqual(nativeGallery.props.performer.rating100, 87, "DirtyRank scores must not replace Stash ratings");
  const nativeBattle = card(false);
  const battleTree = nativeBattle.render();
  assert(find(battleTree, node => node.type === nativeCard), "battles must render the native card");
  const portrait = byClass(battleTree, "dirty-rank-native-portrait");
  const photoEvent = { ...event(), button: 0, target: { closest: selector => selector === ".thumbnail-section" ? {} : null } };
  portrait.props.onClickCapture(photoEvent);
  assert.strictEqual(nativeBattle.votes, 1, "native photo clicks must vote");
  assert(photoEvent.stopped, "photo voting must suppress profile navigation");
  const nativeButtonEvent = { ...event(), button: 0, target: { closest: () => ({}) } };
  portrait.props.onClickCapture(nativeButtonEvent);
  battleTree.props.onClick(nativeButtonEvent);
  assert.strictEqual(nativeBattle.votes, 1, "native buttons must not vote");
  assert(!nativeButtonEvent.stopped, "native buttons must retain their own handlers");
  const nativeLinkEvent = { ...event(), target: { closest: selector => selector === ".dirty-rank-native-portrait" ? {} : null } };
  battleTree.props.onClick(nativeLinkEvent);
  assert.strictEqual(nativeBattle.votes, 1, "native profile links must not vote");
  nativeBattle.props.disabled = true;
  byClass(nativeBattle.render(), "dirty-rank-native-portrait").props.onClickCapture(photoEvent);
  assert.strictEqual(nativeBattle.votes, 1, "disabled battles must reject photo votes");
  assert(!find(card(false, { hidePerformerImages: true }).render(), node => node.type === nativeCard));
  assert(!byClass(gallery, "dirty-rank-gallery-image-link"), "native mode must not duplicate the image markup");
  const podium = plugin.testing.LeaderboardPodium(standingsProps);
  assert(find(podium, node => node.type === nativeCard), "podium must use the same native card");
  delete api.components.PerformerCard;
  active = { slots: [], effects: [], cursor: 0 };
  assert(byClass(plugin.testing.LeaderboardGalleryCard(standingsProps), "dirty-rank-gallery-image-link"), "older Stash builds keep the fallback card");
  response = () => Promise.resolve({ findPerformers: { performers: [rankedPerformer] } });
  await plugin.testing.queryPerformers(true);
  assert(calls.at(-1).query.includes("favorite rating100 o_counter"));
  await plugin.testing.queryPerformers();
  assert(!calls.at(-1).query.includes("favorite rating100 o_counter"), "battle queries must remain lightweight");
  console.log("DirtyRank media behavior tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
