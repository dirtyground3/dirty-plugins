"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Exercise the actual component and asynchronous handlers without a Stash server.
const noop = function () {};
let active;
const React = {
  Fragment: "fragment",
  createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat() }; },
  useState(initial) {
    const owner = active;
    const index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = typeof initial === "function" ? initial() : initial;
    return [owner.slots[index], value => { owner.slots[index] = typeof value === "function" ? value(owner.slots[index]) : value; }];
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
  useMemo(factory, deps) { return React.useCallback(factory, deps)(); },
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
  react: {
    SettingsCard: function SettingsCard() {},
    SettingsSection: function SettingsSection() {},
    SettingsToggle: function SettingsToggle() {},
  },
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
  URLSearchParams,
  Math: Object.create(Math),
  window: {
    DirtyPlugins: runtime,
    PluginApi: {
      React,
      libraries: { Intl: {}, ReactRouterDOM: { NavLink: "a" } },
      register: { route: noop }, patch: { before: noop, after: noop, instead: noop },
    },
    addEventListener: noop,
    removeEventListener: noop,
    location: { search: "" },
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id),
  },
});
let source = fs.readFileSync(path.join(__dirname, "../plugins/DirtyRank/dirtyRank.js"), "utf8");
source = source.replace("algorithms: {", "testing: { PerformerCard, PrecisionBadge, serializedSettings, LeaderboardGalleryCard, LeaderboardPodium, LeaderboardGallery, LeaderboardTable, LeaderboardPagination, DirtyRankLeaderboardsRoute, DirtyRankSettings, documentationCapture, loadNativePerformerCard, queryPerformers, scenePlaybackUrl, needsNativePreview, NativePreviewPlayer, LoadedNativePreview }, algorithms: {");
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
function findAll(tree, predicate) {
  if (!tree || typeof tree !== "object") return [];
  return (predicate(tree) ? [tree] : []).concat(tree.children.flatMap(child => findAll(child, predicate)));
}
function visibleText(tree) {
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  return tree.children.map(visibleText).join(" ");
}
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
  context.window.location.search = "?docsCapture=1";
  assert(plugin.testing.documentationCapture());
  context.window.location.search = "?censorMedia=1";
  assert(plugin.testing.documentationCapture());
  context.window.location.search = "";
  const playbackUrl = plugin.testing.scenePlaybackUrl;
  const legacyScene = {
    paths: { stream: "/scene/896/stream" },
    sceneStreams: [
      { url: "/scene/896/stream.mp4?resolution=ORIGINAL", mime_type: "video/mp4", label: "MP4" },
      { url: "/scene/896/stream.mp4?resolution=STANDARD_HD", mime_type: "video/mp4", label: "MP4 HD (720p)" },
    ],
  };
  assert.strictEqual(playbackUrl(legacyScene), legacyScene.sceneStreams[1].url,
    "WMV originals must use Stash's browser-compatible MP4 preview");
  assert.strictEqual(playbackUrl({ ...legacyScene, sceneStreams: [legacyScene.sceneStreams[0]] }),
    legacyScene.sceneStreams[0].url, "MP4 remains preferred when 720p is unavailable");
  const directMp4 = { url: "/direct.mp4", mime_type: "video/mp4", label: "Direct" };
  assert.strictEqual(playbackUrl({ ...legacyScene, sceneStreams: [...legacyScene.sceneStreams, directMp4] }),
    directMp4.url, "compatible direct MP4 streams avoid unnecessary transcoding");
  assert.strictEqual(playbackUrl({ paths: legacyScene.paths }), legacyScene.paths.stream);
  assert.strictEqual(playbackUrl(null), "");
  assert(plugin.testing.needsNativePreview(legacyScene));
  assert(!plugin.testing.needsNativePreview({ paths: { stream: "/scene/1/stream" } }));

  // Native playback receives the actual file duration and a stable random start.
  const fullScene = { id: "896", files: [{ duration: 3425.31 }] };
  const nativePlayer = function () {};
  context.window.PluginApi.components = { ScenePlayer: nativePlayer };
  context.window.PluginApi.utils = { StashService: { useFindScene: () => ({ data: { findScene: fullScene } }) } };
  const nativePreview = plugin.testing.NativePreviewPlayer({ media: { id: "896" } });
  assert.strictEqual(nativePreview.props.scene, fullScene);
  const previewState = { slots: [], effects: [], cursor: 0 };
  active = previewState;
  let nativeTree = plugin.testing.LoadedNativePreview(nativePreview.props);
  let nativeProps = find(nativeTree, node => node.type === nativePlayer).props;
  const originalStart = nativeProps.initialTimestamp;
  assert.strictEqual(typeof nativeProps.onComplete, "function", "Stash requires a completion listener");
  assert(originalStart >= 3425.31 * 0.3 && originalStart <= 3425.31 * 0.7);
  active.cursor = 0;
  nativeTree = plugin.testing.LoadedNativePreview({ ...nativePreview.props, scene: { ...fullScene } });
  nativeProps = find(nativeTree, node => node.type === nativePlayer).props;
  assert.strictEqual(nativeProps.initialTimestamp, originalStart, "card updates must not restart native playback");
  active = { slots: [], effects: [], cursor: 0 };
  nativeTree = plugin.testing.LoadedNativePreview({ scene: fullScene, marker: { seconds: 123, end_seconds: 140 } });
  assert.strictEqual(find(nativeTree, node => node.type === nativePlayer).props.initialTimestamp, 123);
  delete context.window.PluginApi.components;
  delete context.window.PluginApi.utils;

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
  runtime.native = { loadComponent: () => Promise.reject(new Error("native card unavailable")) };
  assert.strictEqual(await plugin.testing.loadNativePerformerCard(), null,
    "an unavailable native card must keep the fallback route usable");
  delete runtime.native;
  response = () => Promise.resolve({ findPerformers: { performers: [rankedPerformer] } });
  await plugin.testing.queryPerformers(true);
  assert(calls.at(-1).query.includes("favorite rating100 o_counter"));
  await plugin.testing.queryPerformers();
  assert(!calls.at(-1).query.includes("favorite rating100 o_counter"), "battle queries must remain lightweight");
  await verifyLeaderboardDisplays();
  await verifySettingsFieldValidation();
  console.log("DirtyRank media and leaderboard behavior tests passed");
}

async function verifySettingsFieldValidation() {
  const originalGetSettings = runtime.getPluginSettings;
  runtime.getPluginSettings = () => new Promise(() => {});
  const state = { slots: [], effects: [], cursor: 0 };
  const props = { configuration: {}, plugin: {} };
  function render() {
    active = state;
    state.cursor = 0;
    const tree = plugin.testing.DirtyRankSettings(props);
    state.effects.splice(0).forEach(effect => effect());
    return tree;
  }
  try {
    let tree = render();
    find(tree, node => node.props.id === "dirty-rank-confidence-goal" && node.type === "select")
      .props.onChange({ target: { value: "top" } });
    tree = render();
    const topInput = find(tree, node => node.props.id === "dirty-rank-confidence-top-n" && node.type === "input");
    topInput.props.onChange({ target: { value: "" } });
    tree = render();
    assert.strictEqual(find(tree, node => node.props.id === "dirty-rank-confidence-top-n" && node.type === "input").props.value, "",
      "clearing top N must leave the invalid draft visible");
    assert.match(find(tree, node => node.props.id === "dirty-rank-confidence-top-n" && node.props.label).props.error, /whole number/);
    assert.strictEqual(timers.size, 0, "invalid settings must not schedule an automatic save");

    const weightId = "dirty-rank-category-weight-FEMALE-0";
    find(tree, node => node.props.id === weightId && node.type === "input")
      .props.onChange({ target: { value: "" } });
    tree = render();
    assert.strictEqual(find(tree, node => node.props.id === weightId && node.type === "input").props.value, "");
    assert.match(find(tree, node => node.props.id === weightId && node.props.label).props.error, /weight/);
  } finally {
    state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
    runtime.getPluginSettings = originalGetSettings;
  }
}

async function verifyLeaderboardDisplays() {
  const { PrecisionBadge, LeaderboardPodium, LeaderboardGallery, LeaderboardGalleryCard, LeaderboardTable, LeaderboardPagination, DirtyRankLeaderboardsRoute } = plugin.testing;
  for (const [deviation, matches, tier] of [[350, 0, "Provisional"], [75, 12, "Refined"], [50, 20, "Excellent"], [75, 1, "Refined"]]) {
    const badge = PrecisionBadge({ pool: { deviation, matches }, settings });
    assert.strictEqual(visibleText(badge), tier);
    assert.strictEqual(badge.props.title, `${tier} precision · RD ${deviation.toFixed(1)} · ${matches} ${matches === 1 ? "battle" : "battles"}`);
  }
  const battle = card(false);
  battle.props.reveal = true;
  battle.props.pool = { rating: 1400, deviation: 75, matches: 12 };
  const battleTree = battle.render();
  assert(!/\bRD\b|\bbattles\b/.test(visibleText(battleTree)), "battle card details belong in the confidence tooltip");
  assert(find(battleTree, node => node.type === PrecisionBadge));
  const ranked = Array.from({ length: 49 }, (_, i) => ({
    id: "rank-" + (i + 1), name: "Performer " + (i + 1), gender: "FEMALE", image_path: "/portrait.svg", scene_count: 1,
  }));
  const props = { ranked, settings, cohort: "FEMALE", leaderboardId: "appearance", page: 1, onPageChange: noop };
  const articleIds = tree => findAll(tree, node => node.type === "article").map(node => node.props.key);
  for (const topCount of [3, 4, 5]) {
    const podium = LeaderboardPodium({ ...props, topCount });
    const expectedIds = ranked.slice(0, topCount).map(performer => performer.id);
    assert.deepStrictEqual(articleIds(podium).sort(), expectedIds.sort());
    assert.strictEqual(podium.props["aria-label"], { 3: "Podium", 4: "Mount Rushmore", 5: "Fingers" }[topCount]);
    assert(!find(podium, node => node.type === "header"), "featured cards must have no decorative header");
    assert(!/#\d|\bRD\b|\bbattles\b/.test(visibleText(podium)), "featured cards keep only scores, badges and bases");
    assert.strictEqual(findAll(podium, node => node.type === PrecisionBadge).length, topCount);
    assert.strictEqual(findAll(podium, node => node.props.className === "dirty-rank-podium-step").length, topCount === 3 ? 3 : 0);
    if (topCount > 3) assert.deepStrictEqual(articleIds(podium), ranked.slice(0, topCount).map(performer => performer.id));
    for (const [Component, pageSize] of [[LeaderboardGallery, 15], [LeaderboardTable, 25]]) {
      const collected = [];
      const totalPages = Math.ceil((ranked.length - topCount) / pageSize);
      for (let page = 1; page <= totalPages; page++) {
        const tree = Component({ ...props, topCount, page });
        const firstRank = topCount + (page - 1) * pageSize + 1;
        const lastRank = Math.min(firstRank + pageSize - 1, ranked.length);
        const expectedRanks = Array.from({ length: lastRank - firstRank + 1 }, (_, i) => firstRank + i);
        if (Component === LeaderboardGallery) {
          const cards = findAll(tree, node => node.type === LeaderboardGalleryCard);
          assert.deepStrictEqual(cards.map(node => node.props.rank), expectedRanks);
          collected.push(...cards.map(node => node.props.performer.id));
        } else {
          assert.deepStrictEqual(findAll(tree, node => node.type === "th").map(visibleText), ["Rank", "Performer", "Rating", "Confidence"]);
          const rows = find(tree, node => node.type === "tbody").children;
          assert.deepStrictEqual(rows.map(node => node.children[0].children[0]), expectedRanks.map(rank => "#" + rank));
          collected.push(...rows.map(node => node.props.key));
        }
        const pagination = find(tree, node => node.type === LeaderboardPagination).props;
        assert.strictEqual(pagination.firstRank, firstRank);
        assert.strictEqual(pagination.lastRank, lastRank);
        assert.strictEqual(pagination.totalPages, totalPages);
      }
      assert.deepStrictEqual(collected, ranked.slice(topCount).map(performer => performer.id), "standings must not duplicate or omit anyone");
      const clamped = Component({ ...props, topCount, page: 999 });
      assert.strictEqual(find(clamped, node => node.type === LeaderboardPagination).props.page, totalPages);
      for (const count of [0, 1, 2, topCount]) {
        const limited = { ...props, ranked: ranked.slice(0, count), topCount };
        assert.strictEqual(articleIds(LeaderboardPodium(limited)).length, count);
        const empty = byClass(Component(limited), "dirty-rank-empty-standings");
        assert(empty, "small pools should have no remaining standings");
        assert.strictEqual(empty.children[0], count ? "Every rated performer is featured above." : "No standings yet.");
      }
    }
  }
  assert.deepStrictEqual(articleIds(LeaderboardPodium(props)), ["rank-2", "rank-1", "rank-3"], "default podium retains silver/gold/bronze order");
  active = { slots: [], effects: [], cursor: 0 };
  const galleryCard = LeaderboardGalleryCard({ ...props, performer: ranked[0], rank: 6 });
  assert(!/\bRD\b|\bbattles\b|W-L-D/.test(visibleText(galleryCard)), "gallery cards hide rating detail and win/loss records");
  assert(find(galleryCard, node => node.type === PrecisionBadge));

  const stored = new Map();
  const storageKey = "dirtyRank:leaderboardTopCount";
  context.window.localStorage = {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  const states = Object.fromEntries(ranked.map((performer, i) => [performer.id, { pools: {
    "appearance|FEMALE": { rating: 2000 - i * 10, deviation: 50, matches: 10, wins: 10, losses: 0, draws: 0 },
  } }]));
  runtime.runPluginOperation = () => Promise.resolve({ revision: 100, states });
  response = () => Promise.resolve({ findPerformers: { performers: ranked } });
  function route() {
    const state = { slots: [], effects: [], cursor: 0 };
    return () => {
      active = state;
      state.cursor = 0;
      const tree = DirtyRankLeaderboardsRoute();
      state.effects.splice(0).forEach(effect => effect());
      return tree;
    };
  }
  const selector = tree => find(tree, node => node.type === "select" && node.props.id === "dirty-rank-leaderboard-top-count");
  let render = route();
  render();
  await flush();
  let tree = render();
  assert.strictEqual(selector(tree).props.value, 3);
  assert.deepStrictEqual(selector(tree).children.map(node => node.children[0]), ["Podium", "Mount Rushmore", "Fingers"]);
  for (const topCount of [4, 5, 3]) {
    find(tree, node => node.type === LeaderboardGallery).props.onPageChange(Math.ceil((ranked.length - selector(tree).props.value) / 15));
    tree = render();
    selector(tree).props.onChange({ target: { value: String(topCount) } });
    render();
    tree = render();
    assert.strictEqual(selector(tree).props.value, topCount);
    assert.strictEqual(find(tree, node => node.type === LeaderboardPodium).props.topCount, topCount);
    const gallery = find(tree, node => node.type === LeaderboardGallery);
    assert.strictEqual(gallery.props.entries.length, ranked.length - topCount);
    assert.strictEqual(gallery.props.entries[0].rank, topCount + 1);
    assert.strictEqual(gallery.props.page, 1, "changing the featured count resets pagination");
    assert.strictEqual(stored.get(storageKey), String(topCount));
  }
  selector(tree).props.onChange({ target: { value: "5" } });
  find(tree, node => node.props.onClick && node.children[0] === "Table").props.onClick();
  render();
  tree = render();
  assert.strictEqual(find(tree, node => node.type === LeaderboardTable).props.entries[0].rank, 6);

  const searchSelector = tree => find(tree, node => node.type === "input" && node.props.id === "dirty-rank-leaderboard-search");
  render = route();
  render();
  await flush();
  tree = render();
  assert.strictEqual(searchSelector(tree).props.value, "");
  assert(find(tree, node => node.type === LeaderboardPodium), "the featured display shows without a query");
  searchSelector(tree).props.onChange({ target: { value: "PERFORMER 4" } });
  render();
  tree = render();
  assert(!find(tree, node => node.type === LeaderboardPodium), "a search hides the featured display");
  const searchGallery = find(tree, node => node.type === LeaderboardGallery);
  assert.deepStrictEqual(searchGallery.props.entries.map(entry => entry.performer.name),
    ["Performer 4"].concat(Array.from({ length: 10 }, (_, i) => "Performer " + (40 + i))));
  assert.deepStrictEqual(searchGallery.props.entries.map(entry => entry.rank),
    [4].concat(Array.from({ length: 10 }, (_, i) => 40 + i)));
  assert.strictEqual(searchGallery.props.page, 1);
  find(tree, node => node.props.onClick && node.children[0] === "Table").props.onClick();
  render();
  tree = render();
  const searchTable = find(tree, node => node.type === LeaderboardTable);
  assert.strictEqual(searchTable.props.entries.length, 11);
  assert.strictEqual(searchTable.props.entries[0].rank, 4);
  assert.strictEqual(searchTable.props.summary, "11 matches");
  assert.strictEqual(searchTable.props.title, "Search results");
  searchSelector(tree).props.onChange({ target: { value: "zzz" } });
  render();
  tree = render();
  assert(!find(tree, node => node.type === LeaderboardPodium));
  const noMatchTable = find(tree, node => node.type === LeaderboardTable);
  assert.strictEqual(noMatchTable.props.entries.length, 0);
  assert.strictEqual(noMatchTable.props.summary, "0 matches");
  assert.strictEqual(noMatchTable.props.title, "Search results");
  assert(/No performers match/.test(noMatchTable.props.emptyMessage));
  searchSelector(tree).props.onChange({ target: { value: "" } });
  render();
  tree = render();
  assert(find(tree, node => node.type === LeaderboardPodium), "clearing the search restores the featured display");
  assert.strictEqual(find(tree, node => node.type === LeaderboardTable).props.entries[0].rank, 6,
    "clearing search restores standings after the five featured performers");

  for (const [saved, expected] of [["5", 5], ["6", 3], ["4", 4], ["broken", 3], ["7", 3], ["4.5", 3]]) {
    stored.set(storageKey, saved);
    render = route();
    render();
    await flush();
    assert.strictEqual(selector(render()).props.value, expected, "saved selections should be restored or safely defaulted");
  }
  context.window.localStorage = {
    getItem() { throw new Error("Storage blocked"); },
    setItem() { throw new Error("Storage blocked"); },
  };
  render = route();
  render();
  await flush();
  tree = render();
  assert.strictEqual(selector(tree).props.value, 3);
  selector(tree).props.onChange({ target: { value: "5" } });
  assert.strictEqual(selector(render()).props.value, 5, "selection must work when storage is blocked");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
