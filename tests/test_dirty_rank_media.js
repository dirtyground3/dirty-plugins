"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const htm = require("../plugins/DirtyPlugins/vendor/htm.umd.js");

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
    if (!old || !deps || deps.some((dep, i) => dep !== old.deps[i])) {
      active.slots[index] = { deps };
      active.effects.push(() => {
        if (old && old.cleanup) old.cleanup();
        active.slots[index].cleanup = effect();
      });
    }
  },
};
const calls = [];
const documentListeners = new Map();
const timers = new Map();
let nextTimer = 0;
let response = () => Promise.resolve({ findPerformers: { performers: [] } });
const runtime = {
  react: {
    html: htm.bind(React.createElement),
    usePageTitle() {},
    SettingsCard: function SettingsCard() {},
    SettingsSection: function SettingsSection() {},
    SettingsToggle: function SettingsToggle() {},
    StatisticSelector: function SharedStatisticSelector() {},
    Dialog: function SharedDialog() {},
  },
  native: { ensureComponents: () => Promise.resolve([]) },
  getPluginSettings: () => Promise.resolve({}),
  runPluginOperation: (_pluginId, args) => Promise.resolve(args.mode === "getSettings" ? { revision: 0, settings: {} } : { states: {} }),
  graphql: (query, variables, options) => { calls.push({ query, variables, signal: options && options.signal }); return response(query, variables, options && options.signal); },
  values: {
    asObject: value => value || {},
    parseMaybeJson: value => { if (typeof value === "string") { try { return JSON.parse(value); } catch (_) {} } return value; },
    coerceBoolean: (value, fallback) => typeof value === "boolean" ? value : fallback,
  },
};
const context = vm.createContext({
  console,
  AbortController,
  URLSearchParams,
  Math: Object.create(Math),
  document: {
    activeElement: null,
    addEventListener: (name, listener) => documentListeners.set(name, listener),
    removeEventListener: (name, listener) => { if (documentListeners.get(name) === listener) documentListeners.delete(name); },
  },
  window: {
    DirtyPlugins: runtime,
    PluginApi: {
      React,
      components: { FilteredPerformerList: function FilteredPerformerList() {} },
      libraries: { Intl: {}, ReactRouterDOM: {
        NavLink: "a",
        useLocation: () => context.window.location,
        useHistory: () => ({
          push: path => { context.window.location.pathname = path.split("?")[0]; context.window.location.search = path.includes("?") ? "?" + path.split("?")[1] : ""; },
          replace: path => { context.window.location.pathname = path.split("?")[0]; context.window.location.search = path.includes("?") ? "?" + path.split("?")[1] : ""; },
        }),
      }, Bootstrap: {
        ButtonGroup: "button-group",
        Dropdown: Object.assign(function Dropdown() {}, { Toggle: "dropdown-toggle", Menu: "dropdown-menu", Item: "dropdown-item" }),
        InputGroup: { Prepend: "input-group-prepend" },
      } },
      register: { route: noop }, patch: { before: noop, after: noop, instead: noop },
    },
    addEventListener: noop,
    removeEventListener: noop,
    location: { pathname: "/plugins/dirty-rank-leaderboards", search: "" },
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id),
  },
});
let source = require("./load_plugin_scripts").sourceFor("DirtyRank");
source = source.replace("algorithms: {", "testing: { PerformerCard, PrecisionBadge, leaderboardRatingText, serializedSettings, LeaderboardGalleryCard, LeaderboardPodium, LeaderboardGallery, LeaderboardTable, LeaderboardPagination, DirtyRankRoute, DirtyRankLeaderboardsRoute, DirtyRankLeaderboardFilterCapture, filteredLeaderboardEntries, serializeLeaderboardPerformerFilter, queryLeaderboardPerformerIds, DirtyRankSettings, RankStatisticSelector, leaderboardStatPath, leaderboardIdFromPath, documentationCapture, loadNativePerformerCard, queryPerformers, scenePlaybackUrl, needsNativePreview, NativePreviewPlayer, LoadedNativePreview }, algorithms: {");
source = source.replace("testing: {", "testing: { DirtyRankNavLinks, DirtyRankBattleNavLink, DirtyRankLeaderboardsNavLink, ");
vm.runInContext(source, context);
const plugin = context.window.__dirtyRankPlugin;
const settings = plugin.algorithms.settingsFromConfiguration({});
{
  const originalLocation = context.window.location;
  context.window.location = { pathname: "/plugins/dirty-rank", search: "" };
  const prefixPage = plugin.testing.DirtyRankRoute({ match: { params: {} } });
  assert.strictEqual(prefixPage.type.name, "DirtyRankBattlePage", "route ownership mounts a separate page with its own effect lifecycle");
  context.window.location.pathname = "/plugins/dirty-rank/category/appearance";
  assert.strictEqual(plugin.testing.DirtyRankRoute({ match: { params: {} } }), null,
    "the prefix route removes its page when a category route takes over, cleaning up its title observer");
  const categoryPage = plugin.testing.DirtyRankRoute({ match: { params: { categoryId: "appearance" } } });
  assert.strictEqual(categoryPage.type, prefixPage.type);
  context.window.location.pathname += "/king-of-the-hill";
  const kingsPage = plugin.testing.DirtyRankRoute({ match: { params: { categoryId: "appearance" } } });
  assert.strictEqual(kingsPage.props.routeDetails.kingsMode, true);
  context.window.location.pathname = "/plugins/dirty-rank-leaderboards";
  assert.strictEqual(plugin.testing.DirtyRankRoute({ match: { params: {} } }), null,
    "leaving battles unmounts the page even if Stash retains the route wrapper");
  context.window.location = originalLocation;
}
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
  const graphqlSource = hubSource.slice(hubSource.indexOf("  function graphql("), hubSource.indexOf("  function runPluginOperation("));
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
  calls.length = 0; // Ignore the initial full-cohort query used by overall sorting.
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
  const labeled = plugin.algorithms.settingsFromConfiguration({ categories: { FEMALE: [
    { id: "old-a", name: "Étoile & Face" },
    { id: "old-b", name: "Etoile Face" },
    { id: "old-c", name: "Étoile--Face" },
    { name: "Overall" },
  ] } });
  assert.strictEqual(labeled.categoriesByCohort.FEMALE.map(category => category.id).join(","),
    "etoile-face,etoile-face-1,etoile-face-2,overall-1");
  assert.strictEqual(plugin.testing.leaderboardStatPath(labeled.categoriesByCohort.FEMALE[1].id),
    "/plugins/dirty-rank-leaderboards/etoile-face-1");
  await verifyLeaderboardDisplays();
  const royalCard = card(false);
  royalCard.props.hillMode = true;
  royalCard.props.hillOpening = true;
  let royalTree = royalCard.render();
  assert.strictEqual(visibleText(byClass(royalTree, "dirty-rank-hill-role")).trim(), "Contender");
  royalCard.props.hillOpening = false;
  royalCard.props.kingTarget = true;
  royalTree = royalCard.render();
  assert.strictEqual(visibleText(byClass(royalTree, "dirty-rank-hill-role-champion")).trim(), "Reigning champion");
  assert(!byClass(royalTree, "dirty-rank-king-target"), "the crown banner stays outside native photos and controls");
  royalCard.props.crowned = true;
  royalTree = royalCard.render();
  assert.strictEqual(visibleText(byClass(royalTree, "dirty-rank-hill-role")).trim(), "Hill conquered");
  assert.strictEqual(royalTree.props.role, "group", "the final crown does not turn the winner into a voting button");
  royalCard.unmount();
  await verifyKingsMode();
  await verifySettingsFieldValidation();
  await verifyLeaderboardPresentationSettings();
  await verifyRatingPresets();
  await verifyCategoryResets();
  await verifyNavigationSettings();
  await verifyNamedGenderBoxes();
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

async function verifyRatingPresets() {
  const originalRunOperation = runtime.runPluginOperation;
  const originalResponse = response;
  let performerQueries = 0;
  response = (query, variables, signal) => {
    if (!query.includes("DirtyRankPerformers")) return originalResponse(query, variables, signal);
    performerQueries += 1;
    return Promise.resolve({ findPerformers: { performers: [
      { id: "estimate-female", gender: "FEMALE", image_path: "/synthetic.svg" },
      { id: "estimate-nonbinary", gender: "NON_BINARY", image_path: "/synthetic.svg" },
      { id: "estimate-male", gender: "MALE", image_path: "/synthetic.svg" },
      { id: "estimate-no-image", gender: "FEMALE", image_path: "" },
    ] } });
  };
  const configuration = {
    hideBattleStandings: true,
    genderBoxes: [{ id: "BOX-1", name: "Mixed", genders: ["FEMALE", "NON_BINARY"] }],
    categories: { "BOX-1": [{ id: "style", name: "Style", weight: 2 }] },
    evidenceWeight: 1.7, avoidRepeatWindow: 19, calibrationPercent: 7, tau: 0.8,
    initialRating: 980, initialDeviation: 320, initialVolatility: 0.07,
    deviationFloor: 35, provisionalDeviation: 95,
  };
  const saved = [];
  let holdNextSave = false;
  let completeHeldSave;
  runtime.runPluginOperation = (_pluginId, args) => {
    if (args.mode === "getSettings") return Promise.resolve({ revision: saved.length, settings: configuration });
    if (args.mode === "saveSettings") {
      assert.strictEqual(args.expectedRevision, saved.length, "preset saves preserve serialized revisions");
      saved.push(args.settings);
      if (holdNextSave) {
        holdNextSave = false;
        const revision = saved.length;
        return new Promise(resolve => { completeHeldSave = () => resolve({ revision, settings: args.settings }); });
      }
      return Promise.resolve({ revision: saved.length, settings: args.settings });
    }
    throw new Error("Selecting a preset must not reset or rewrite rating pools: " + args.mode);
  };
  runtime.notifyConfigurationChanged = noop;
  const state = { slots: [], effects: [], cursor: 0 };
  function render() {
    active = state;
    state.cursor = 0;
    const tree = plugin.testing.DirtyRankSettings({ configuration: { ...configuration, tau: 0.2 }, plugin: {} });
    state.effects.splice(0).forEach(effect => effect());
    return tree;
  }
  try {
    let tree = render();
    await flush();
    tree = render();
    const presetButtons = () => findAll(tree, node => typeof node.type === "function" && node.type.name === "RankButton" && node.props.pressed != null);
    const field = id => find(tree, node => node.type === "input" && node.props.id === id);
    const currentButton = () => find(tree, node => typeof node.type === "function" && node.type.name === "RankButton" && visibleText(node).trim() === "Current");
    assert(currentButton().props.className.includes("dirty-rank-preset-current"), "Current has its own green styling");
    assert.strictEqual(currentButton().props.disabled, false);
    assert.strictEqual(saved.length, 0, "opening advanced configuration does not choose a preset");
    assert(presetButtons().every(button => !button.props.pressed));
    const initialPayload = plugin.testing.serializedSettings(plugin.algorithms.settingsFromConfiguration(configuration));
    const estimateText = settings => plugin.algorithms.freshCategoryBattleEstimate(2, settings).battles.toLocaleString() + " battles expected to rank 1 category for 2 performers";
    const liveEstimate = () => visibleText(byClass(tree, "dirty-rank-preset-estimate")).trim();
    assert.strictEqual(liveEstimate(), estimateText(configuration), "estimate includes eligible members of every gender in the selected box");
    for (const preset of plugin.algorithms.ratingPresets) {
      presetButtons().find(button => visibleText(button).trim() === preset.name).props.onClick();
      tree = render();
      assert.strictEqual(liveEstimate(), estimateText(preset.settings), "preset estimate updates immediately before autosave");
      assert.strictEqual(presetButtons().filter(button => button.props.pressed).length, 1);
      assert.strictEqual(presetButtons().find(button => button.props.pressed).props.tone, "primary");
      assert.strictEqual(field("dirty-rank-evidence-weight").props.value, preset.settings.evidenceWeight);
      assert.strictEqual(field("dirty-rank-calibration").props.value, preset.settings.calibrationPercent);
      assert.strictEqual(field("dirty-rank-repeat-window").props.value, preset.settings.avoidRepeatWindow);
      assert.strictEqual(timers.size, 1, "all preset fields save in one debounce operation");
      const previousCount = saved.length;
      await flush();
      tree = render();
      assert.strictEqual(saved.length, previousCount + 1);
      for (const [key, value] of Object.entries(preset.settings)) assert.strictEqual(saved.at(-1)[key], value);
      for (const key of ["genderBoxes", "categories", "hideBattleStandings"]) {
        assert.strictEqual(JSON.stringify(saved.at(-1)[key]), JSON.stringify(initialPayload[key]), "presets preserve " + key);
      }
    }
    field("dirty-rank-tau").props.onChange({ target: { value: "0.42" } });
    tree = render();
    assert(presetButtons().every(button => !button.props.pressed), "manual edits show Custom instead of a stale preset name");
    assert(visibleText(tree).includes("Custom configuration"));
    await flush();
    tree = render();
    assert.strictEqual(saved.at(-1).tau, 0.42);
    find(tree, node => node.props.label === "Hide standings during battles").props.onChange(false);
    tree = render();
    await flush();
    tree = render();
    const beforeRestore = saved.length;
    currentButton().props.onClick();
    tree = render();
    assert.strictEqual(liveEstimate(), estimateText(configuration), "Current restores the opening estimate immediately");
    for (const key of Object.keys(plugin.algorithms.ratingPresets[0].settings)) {
      const id = { evidenceWeight: "evidence-weight", avoidRepeatWindow: "repeat-window", calibrationPercent: "calibration" }[key] || key;
      assert.strictEqual(field("dirty-rank-" + id).props.value, initialPayload[key], "Current restores page-open " + key);
    }
    await flush();
    tree = render();
    assert.strictEqual(saved.length, beforeRestore + 1, "Current restores all parameters in one automatic save");
    for (const key of Object.keys(plugin.algorithms.ratingPresets[0].settings)) assert.strictEqual(saved.at(-1)[key], initialPayload[key]);
    assert.strictEqual(saved.at(-1).hideBattleStandings, false, "Current preserves unrelated settings edited since opening");
    presetButtons()[0].props.onClick();
    tree = render();
    currentButton().props.onClick();
    tree = render();
    await flush();
    tree = render();
    assert.strictEqual(saved.length, beforeRestore + 1, "restoring before the debounce cancels the unsaved preset change");
    assert.strictEqual(field("dirty-rank-tau").props.value, 0.8, "the opening snapshot is stable across repeated saves and restores");
    const beforeHeldSave = saved.length;
    holdNextSave = true;
    presetButtons()[0].props.onClick();
    tree = render();
    await flush();
    tree = render();
    assert.strictEqual(saved.length, beforeHeldSave + 1, "the preset save is in flight");
    assert.strictEqual(currentButton().props.disabled, false, "Current stays available while the preset saves");
    currentButton().props.onClick();
    tree = render();
    assert.strictEqual(field("dirty-rank-tau").props.value, 0.8, "Current restores values immediately during the request");
    completeHeldSave();
    await flush();
    tree = render();
    assert.strictEqual(field("dirty-rank-tau").props.value, 0.8, "the older response cannot replace the restored draft");
    await flush();
    tree = render();
    assert.strictEqual(saved.length, beforeHeldSave + 2, "the restored values save after the older request completes");
    for (const key of Object.keys(plugin.algorithms.ratingPresets[0].settings)) assert.strictEqual(saved.at(-1)[key], initialPayload[key]);
    assert.strictEqual(saved.at(-1).hideBattleStandings, false);
    assert.strictEqual(currentButton().props.disabled, false);
    field("dirty-rank-provisionalDeviation").props.onChange({ target: { value: "70" } });
    tree = render();
    assert.strictEqual(liveEstimate(), estimateText({ ...configuration, provisionalDeviation: 70 }), "manual parameter changes recompute the estimate before saving");
    assert.strictEqual(performerQueries, 1, "parameter changes reuse the loaded performer count");
  } finally {
    state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
    runtime.runPluginOperation = originalRunOperation;
    response = originalResponse;
  }
}

async function verifyCategoryResets() {
  const originalRunOperation = runtime.runPluginOperation;
  const originalConfirm = context.window.confirm;
  const originalUi = runtime.ui;
  const prompts = [];
  const resets = [];
  const notifications = [];
  let approve = false;
  let finishReset;
  let reloads = 0;
  const configuration = {
    defaultCohort: "BOX-1",
    genderBoxes: [
      { id: "BOX-1", name: "First box", genders: ["FEMALE"] },
      { id: "BOX-2", name: "Mixed box", genders: ["MALE", "NON_BINARY"] },
    ],
    categories: {
      "BOX-1": [{ id: "appearance", name: "Appearance" }],
      "BOX-2": [{ id: "appearance", name: "Appearance" }, { id: "energy", name: "Energy", enabled: false }],
    },
  };
  context.window.confirm = message => { prompts.push(message); return approve; };
  runtime.ui = { notify: message => notifications.push(message) };
  runtime.runPluginOperation = (_pluginId, args) => {
    if (args.mode === "getSettings") return Promise.resolve({ revision: 0, settings: configuration });
    if (args.mode === "resetPool") {
      resets.push(args);
      return new Promise(resolve => { finishReset = () => resolve({ reset: 3, failed: 0 }); });
    }
    if (args.mode === "loadAll") { reloads++; return Promise.resolve({ states: {} }); }
    throw new Error("Unexpected operation during a category reset: " + args.mode);
  };
  const state = { slots: [], effects: [], cursor: 0 };
  function render() {
    active = state;
    state.cursor = 0;
    const tree = plugin.testing.DirtyRankSettings({ configuration, plugin: {} });
    state.effects.splice(0).forEach(effect => effect());
    return tree;
  }
  try {
    let tree = render();
    await flush();
    tree = render();
    const buttons = () => findAll(tree, node => (node.props.className || "").includes("dirty-rank-category-reset"));
    assert.strictEqual(buttons().length, 1);
    find(tree, node => node.type === "select" && node.props.id === "dirty-rank-category-cohort").props.onChange({ target: { value: "BOX-2" } });
    tree = render();
    assert.strictEqual(buttons().length, 2, "each category has its own reset action");
    buttons()[1].props.onClick();
    assert.strictEqual(resets.length, 0, "cancelling never calls the reset backend");
    assert(prompts[0].includes("Mixed box / Energy") && prompts[0].includes("battle history"), "confirmation describes the precise target and deleted data");
    approve = true;
    buttons()[1].props.onClick();
    tree = render();
    assert(buttons().every(button => button.props.disabled), "all reset actions wait for an in-flight reset");
    buttons()[0].props.onClick();
    assert.strictEqual(resets.length, 1, "busy guard prevents another reset");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(resets[0])), { mode: "resetPool", categoryId: "energy", cohort: "BOX-2", confirm: "RESET" }, "reset targets the clicked category in the edited box, not the default box");
    finishReset();
    await flush();
    tree = render();
    assert.strictEqual(reloads, 1, "successful reset refreshes the rating index");
    assert(visibleText(tree.props.footer).includes("Reset Mixed box / Energy: 3 rating(s); 0 failed."));
    assert(notifications[0].includes("Mixed box / Energy"));
    assert(buttons().every(button => !button.props.disabled));
  } finally {
    state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
    runtime.runPluginOperation = originalRunOperation;
    context.window.confirm = originalConfirm;
    runtime.ui = originalUi;
  }
}

async function verifyLeaderboardPresentationSettings() {
  const originalRunOperation = runtime.runPluginOperation;
  let savedPayload;
  runtime.runPluginOperation = (_pluginId, args) => {
    if (args.mode === "getSettings") return Promise.resolve({ revision: 0, settings: {} });
    if (args.mode === "saveSettings") {
      savedPayload = args.settings;
      return Promise.resolve({ revision: 1, settings: args.settings });
    }
    return originalRunOperation(_pluginId, args);
  };
  runtime.notifyConfigurationChanged = noop;
  const state = { slots: [], effects: [], cursor: 0 };
  function render() {
    active = state;
    state.cursor = 0;
    const tree = plugin.testing.DirtyRankSettings({ configuration: {}, plugin: {} });
    state.effects.splice(0).forEach(effect => effect());
    return tree;
  }
  try {
    let tree = render();
    await flush();
    tree = render();
    const select = id => find(tree, node => node.type === "select" && node.props.id === id);
    const option = label => find(tree, node => typeof node.type === "function" && node.type.name === "RankButton" && visibleText(node).trim() === label);
    assert(!find(tree, node => visibleText(node).trim() === "Backup Dirty Plugins database"), "backup belongs in shared settings");
    assert(!option("Export ratings"));
    assert(!option("Reset current pool"));
    assert.strictEqual(option("Reset ratings").props.tone, "danger");
    assert.strictEqual(select("dirty-rank-leaderboard-top-count").props.value, 3);
    const genderToggle = (gender, box = "FEMALE") => find(tree, node => node.props.id === "dirty-rank-box-gender-" + box + "-" + gender);
    assert.strictEqual(genderToggle("FEMALE").props.checked, true, "legacy boxes retain their original gender");
    assert.strictEqual(genderToggle("FEMALE").props.disabled, true, "a box always has at least one gender");
    assert.strictEqual(genderToggle("MALE").props.checked, false);
    genderToggle("MALE").props.onChange(true);
    tree = render();
    assert.strictEqual(genderToggle("MALE").props.checked, true);
    assert.strictEqual(genderToggle("FEMALE").props.disabled, false);
    assert.strictEqual(genderToggle("FEMALE", "MALE").props.checked, false, "gender selections belong to individual boxes");
    find(tree, node => node.type === "input" && node.props.id === "dirty-rank-box-name-FEMALE").props.onChange({ target: { value: "My mixed box" } });
    tree = render();
    assert.strictEqual(select("dirty-rank-leaderboard-view").props.value, "gallery");
    const countInput = () => find(tree, node => node.type === "input" && node.props.id === "dirty-rank-leaderboard-performer-count");
    assert.strictEqual(countInput().props.value, 18);
    assert.strictEqual(countInput().props.step, 3);
    select("dirty-rank-leaderboard-top-count").props.onChange({ target: { value: "4" } });
    tree = render();
    assert.strictEqual(countInput().props.value, 20, "changing layout rounds the total count up to its multiple");
    assert.strictEqual(countInput().props.step, 4);
    countInput().props.onChange({ target: { value: "21" } });
    tree = render();
    assert.strictEqual(countInput().props.value, "21", "invalid input remains visible for correction");
    assert.match(find(tree, node => node.props.id === "dirty-rank-leaderboard-performer-count" && node.props.label).props.error, /multiple of 4/);
    assert.strictEqual(timers.size, 0, "invalid page counts must not autosave");
    countInput().props.onChange({ target: { value: "24" } });
    tree = render();
    select("dirty-rank-leaderboard-top-count").props.onChange({ target: { value: "5" } });
    tree = render();
    assert.strictEqual(countInput().props.value, 25);
    assert.strictEqual(countInput().props.step, 5);
    select("dirty-rank-leaderboard-top-count").props.onChange({ target: { value: "4" } });
    tree = render();
    assert.strictEqual(countInput().props.value, 28);
    countInput().props.onChange({ target: { value: "24" } });
    tree = render();
    for (const label of ["Show Battles in the Stash header", "Show Leaderboards in the Stash header"]) {
      const toggle = find(tree, node => node.props.label === label);
      assert.strictEqual(toggle.props.checked, true);
      toggle.props.onChange(false);
      tree = render();
    }
    select("dirty-rank-leaderboard-view").props.onChange({ target: { value: "table" } });
    tree = render();
    const hideStandings = find(tree, node => node.props.label === "Hide standings during battles");
    assert.strictEqual(hideStandings.props.checked, false);
    hideStandings.props.onChange(true);
    tree = render();
    assert.strictEqual(find(tree, node => node.props.label === "Hide standings during battles").props.checked, true);
    assert.strictEqual(select("dirty-rank-leaderboard-top-count").props.value, 4);
    assert.strictEqual(select("dirty-rank-leaderboard-view").props.value, "table");
    const scoringSelect = () => select("dirty-rank-overall-strategy");
    const scoringInput = key => find(tree, node => node.type === "input" && node.props.id === "dirty-rank-" + key);
    assert.strictEqual(scoringSelect().props.value, "weighted");
    assert.deepStrictEqual(scoringSelect().children.map(node => node.props.value), ["weighted", "power"]);
    assert.deepStrictEqual(scoringSelect().children.map(node => node.children.join("")), ["Simple weighted", "Power mean"]);
    assert(!scoringInput("overallPower"), "Simple weighted has no additional scoring control");
    scoringSelect().props.onChange({ target: { value: "power" } });
    tree = render();
    assert.strictEqual(scoringInput("overallPower").props.value, 3, "power mean starts with power 3");
    assert.strictEqual(scoringInput("overallPower").props.min, 1);
    assert.strictEqual(scoringInput("overallPower").props.max, 4);
    scoringInput("overallPower").props.onChange({ target: { value: "" } });
    tree = render();
    assert.strictEqual(timers.size, 0, "empty power input must not autosave");
    assert.match(find(tree, node => node.props.id === "dirty-rank-overallPower" && node.props.label).props.error, /Enter a number from 1 to 4/);
    scoringInput("overallPower").props.onChange({ target: { value: "5" } });
    tree = render();
    assert.strictEqual(timers.size, 0, "out-of-range power input must not autosave");
    scoringInput("overallPower").props.onChange({ target: { value: "3.5" } });
    tree = render();
    assert.strictEqual(scoringInput("overallPower").props.value, "3.5", "fractional powers remain editable");
    scoringSelect().props.onChange({ target: { value: "weighted" } });
    tree = render();
    assert(!scoringInput("overallPower"), "Simple weighted hides the power control");
    scoringSelect().props.onChange({ target: { value: "power" } });
    tree = render();
    assert.strictEqual(scoringInput("overallPower").props.value, "3.5", "switching strategies preserves the power");
    assert.strictEqual(option("Reset ratings").props.disabled, true, "category reset waits for unsaved settings");
    assert.strictEqual(timers.size, 1, "presentation changes use the existing autosave");
    [...timers.values()][0]();
    tree = render();
    assert.strictEqual(option("Reset ratings").props.disabled, true, "category reset waits for autosave completion");
    await flush();
    tree = render();
    assert.strictEqual(savedPayload.overallScoreStrategy, "power");
    assert.strictEqual(savedPayload.overallPower, 3.5, "power mean selection and exponent use the existing automatic save");
    assert.strictEqual(savedPayload.leaderboardTopCount, 4);
    assert.strictEqual(savedPayload.leaderboardView, "table");
    assert.strictEqual(savedPayload.leaderboardPerformerCount, 24);
    assert.strictEqual(savedPayload.showBattlesInMenu, false);
    assert.strictEqual(savedPayload.showLeaderboardsInMenu, false);
    assert.strictEqual(savedPayload.hideBattleStandings, true, "sidebar preference uses the existing autosave");
    assert.deepStrictEqual(JSON.parse(savedPayload.genderBoxes).find(box => box.id === "FEMALE").genders, ["FEMALE", "MALE"], "multiple genders autosave in the same box");
    assert.strictEqual(JSON.parse(savedPayload.genderBoxes).find(box => box.id === "FEMALE").name, "My mixed box", "renaming retains the stable box ID");
    assert.deepStrictEqual(JSON.parse(savedPayload.genderBoxes).find(box => box.id === "MALE").genders, ["MALE"], "other boxes remain unchanged");
    assert.strictEqual(option("Reset ratings").props.disabled, false, "category reset is available after autosave");
    option("+ Add gender box").props.onClick();
    tree = render();
    assert(find(tree, node => node.props["data-box-id"] === "BOX-1"), "new boxes have independent stable IDs");
    assert.strictEqual(select("dirty-rank-category-cohort").props.value, "BOX-1", "adding a box selects its own categories");
    const newName = find(tree, node => node.type === "input" && node.props.id === "dirty-rank-box-name-BOX-1");
    newName.props.onChange({ target: { value: "New independent box" } });
    tree = render();
    find(tree, node => node.props.id === "dirty-rank-box-gender-BOX-1-NON_BINARY").props.onChange(true);
    tree = render();
    find(tree, node => node.type === "input" && node.props.id === "dirty-rank-category-name-BOX-1-0").props.onChange({ target: { value: "Energy" } });
    tree = render();
    [...timers.values()][0]();
    render();
    await flush();
    tree = render();
    const added = JSON.parse(savedPayload.genderBoxes).find(box => box.id === "BOX-1");
    assert.strictEqual(added.name, "New independent box");
    assert.deepStrictEqual(added.genders, ["FEMALE", "NON_BINARY"]);
    assert.strictEqual(JSON.parse(savedPayload.categories)["BOX-1"][0].name, "Energy", "each box owns its category definitions");
    const editor = find(tree, node => node.props["data-box-id"] === "BOX-1");
    assert(editor, "the saved box remains in settings");
    find(editor, node => typeof node.type === "function" && node.type.name === "RankButton" && visibleText(node).trim() === "Remove box").props.onClick();
    tree = render();
    assert(!find(tree, node => node.props["data-box-id"] === "BOX-1"));
    option("+ Add gender box").props.onClick();
    tree = render();
    assert(find(tree, node => node.props["data-box-id"] === "BOX-2"), "removed box IDs are never reused, protecting retained ratings");
  } finally {
    state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
    runtime.runPluginOperation = originalRunOperation;
    timers.clear();
  }
}

async function verifyNamedGenderBoxes() {
  const originalSettings = runtime.getPluginSettings;
  const originalOperation = runtime.runPluginOperation;
  const originalResponse = response;
  const originalLocation = { ...context.window.location };
  const boxes = [
    { id: "BOX-1", name: "Box 1", genders: ["FEMALE", "NON_BINARY"] },
    { id: "BOX-2", name: "Box 2", genders: ["MALE"] },
    { id: "BOX-3", name: "Box 3", genders: ["TRANSGENDER_MALE", "TRANSGENDER_FEMALE"] },
  ];
  const configuration = { genderBoxes: JSON.stringify(boxes), defaultCohort: "BOX-1", categories: JSON.stringify({
    "BOX-1": [{ name: "Style" }], "BOX-2": [{ name: "Strength" }], "BOX-3": [{ name: "Energy" }],
  }) };
  const people = ["FEMALE", "NON_BINARY", "MALE", "MALE", "TRANSGENDER_MALE", "TRANSGENDER_FEMALE"].map((gender, index) => ({
    id: "box-person-" + index, name: gender + " " + index, gender, image_path: "/portrait.svg", scene_count: 1,
  }));
  const states = Object.fromEntries(people.map((person, index) => {
    const box = boxes.find(box => box.genders.includes(person.gender));
    const category = ["style", "strength", "energy"][boxes.indexOf(box)];
    return [person.id, { revision: 10001, pools: { [category + "|" + box.id]: {
      rating: 1000 + index * 10, deviation: 75, volatility: 0.06, matches: 8, wins: 4, losses: 4, draws: 0,
    } } }];
  }));
  runtime.getPluginSettings = () => Promise.resolve(configuration);
  runtime.runPluginOperation = (_id, args) => args.mode === "loadAll" ? Promise.resolve({ revision: 10001, states }) : originalOperation(_id, args);
  response = () => Promise.resolve({ findPerformers: { count: people.length, performers: people } });
  const owner = { slots: [], effects: [], cursor: 0 };
  const component = name => node => typeof node.type === "function" && node.type.name === name;
  function renderBattle() {
    active = owner;
    owner.cursor = 0;
    const details = plugin.algorithms.battleRouteFromPath(context.window.location.pathname);
    const page = plugin.testing.DirtyRankRoute({ match: { params: { categoryId: details.categoryId } } });
    const tree = page && page.type(page.props);
    owner.effects.splice(0).forEach(effect => effect());
    return tree;
  }
  function renderLeaderboard() {
    active = owner;
    owner.cursor = 0;
    const tree = plugin.testing.DirtyRankLeaderboardsRoute();
    owner.effects.splice(0).forEach(effect => effect());
    return tree;
  }
  function reset() {
    owner.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
    owner.slots = []; owner.effects = []; timers.clear();
  }
  try {
    context.window.location.pathname = "/plugins/dirty-rank/category/style";
    context.window.location.search = "?box=BOX-1";
    renderBattle(); await flush(); renderBattle();
    let tree = renderBattle();
    const boxPicker = () => find(tree, node => node.props.id === "dirty-rank-battle-cohort");
    assert.deepStrictEqual(boxPicker().children.map(option => visibleText(option)), ["Box 1", "Box 2", "Box 3"]);
    for (const [index, category] of ["style", "strength", "energy"].entries()) {
      if (index) { boxPicker().props.onChange({ target: { value: boxes[index].id } }); renderBattle(); renderBattle(); tree = renderBattle(); }
      assert.strictEqual(boxPicker().props.value, boxes[index].id);
      assert.strictEqual(find(tree, node => node.props.id === "dirty-rank-category").props.value, category, "box selection switches its category set");
      const cards = findAll(tree, node => node.type === plugin.testing.PerformerCard);
      assert.strictEqual(cards.length, 2);
      assert(cards.every(card => boxes[index].genders.includes(card.props.performer.gender)), "battle cards stay within the selected box");
      assert.strictEqual(context.window.location.search, "?box=" + boxes[index].id);
      assert(find(tree, node => node.type === "a" && visibleText(node) === "Leaderboards").props.to.includes("box=" + boxes[index].id), "leaderboard links preserve the box");
    }
    reset();
    context.window.location.pathname = "/plugins/dirty-rank-leaderboards/style";
    context.window.location.search = "?box=BOX-1";
    renderLeaderboard(); await flush();
    tree = renderLeaderboard();
    for (const [index, category] of ["style", "strength", "energy"].entries()) {
      if (index) {
        find(tree, node => node.type === "select" && node.props.id === "dirty-rank-leaderboard-cohort").props.onChange({ target: { value: boxes[index].id } });
        tree = renderLeaderboard();
        const selector = find(tree, component("RankStatisticSelector"));
        selector.type(selector.props).props.onSelect(category);
        tree = renderLeaderboard();
      }
      const selector = find(tree, component("RankStatisticSelector"));
      assert.strictEqual(selector.props.value, category);
      assert.strictEqual(selector.props.categories.length, 1, "leaderboards only show the box's categories");
      const podium = find(tree, component("LeaderboardPodium"));
      assert.strictEqual(podium.props.ranked.length, 2);
      assert(podium.props.ranked.every(person => boxes[index].genders.includes(person.gender)), "standings stay within the selected box");
      assert(find(tree, node => node.type === "a" && visibleText(node) === "Battles").props.to.includes("box=" + boxes[index].id));
    }
    reset(); renderLeaderboard(); await flush(); tree = renderLeaderboard();
    assert.strictEqual(find(tree, node => node.type === "select" && node.props.id === "dirty-rank-leaderboard-cohort").props.value, "BOX-3", "a bookmarked leaderboard retains its box");
  } finally {
    reset(); runtime.getPluginSettings = originalSettings; runtime.runPluginOperation = originalOperation;
    response = originalResponse; Object.assign(context.window.location, originalLocation);
  }
}

async function verifyNavigationSettings() {
  const originalGetSettings = runtime.getPluginSettings;
  const originalAddListener = context.window.addEventListener;
  const originalRemoveListener = context.window.removeEventListener;
  const listeners = new Map();
  let configuration = {};
  runtime.getPluginSettings = () => Promise.resolve(configuration);
  context.window.addEventListener = (name, listener) => listeners.set(name, listener);
  context.window.removeEventListener = (name, listener) => listeners.delete(name);
  const state = { slots: [], effects: [], cursor: 0 };
  function render() {
    active = state;
    state.cursor = 0;
    const tree = plugin.testing.DirtyRankNavLinks();
    state.effects.splice(0).forEach(effect => effect());
    return tree;
  }
  try {
    render();
    await flush();
    let tree = render();
    assert(find(tree, node => node.type === plugin.testing.DirtyRankBattleNavLink));
    assert(find(tree, node => node.type === plugin.testing.DirtyRankLeaderboardsNavLink));
    for (const [battles, leaderboards] of [[false, true], [true, false], [false, false], [true, true]]) {
      configuration = { showBattlesInMenu: battles, showLeaderboardsInMenu: leaderboards };
      listeners.forEach(listener => listener({ detail: { pluginId: "dirtyRank" } }));
      await flush();
      tree = render();
      assert.strictEqual(Boolean(find(tree, node => node.type === plugin.testing.DirtyRankBattleNavLink)), battles);
      assert.strictEqual(Boolean(find(tree, node => node.type === plugin.testing.DirtyRankLeaderboardsNavLink)), leaderboards);
    }
  } finally {
    state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
    runtime.getPluginSettings = originalGetSettings;
    context.window.addEventListener = originalAddListener;
    context.window.removeEventListener = originalRemoveListener;
  }
}

async function verifyKingsMode() {
  const originalSettings = runtime.getPluginSettings;
  const originalOperation = runtime.runPluginOperation;
  const originalResponse = response;
  const originalPath = context.window.location.pathname;
  const originalSearch = context.window.location.search;
  const originalCrypto = context.window.crypto;
  let battleCounter = 0;
  context.window.crypto = { randomUUID: () => "kings-test-" + (++battleCounter) };
  context.window.location.pathname = "/plugins/dirty-rank";
  timers.clear();
  const performers = Array.from({ length: 4 }, (_, index) => ({
    id: "king-" + (index + 1), name: "Contender " + (index + 1), gender: "FEMALE",
    image_path: "/portrait.svg", scene_count: 1,
  }));
  const states = Object.fromEntries(performers.map((person, index) => [person.id, { revision: 101, pools: {
    "appearance|FEMALE": { rating: 1000 + index * 10, deviation: 250, volatility: 0.06, matches: 1, wins: 1, losses: 0, draws: 0 },
  } }]));
  const recorded = [];
  let battleConfiguration = {};
  runtime.getPluginSettings = () => Promise.resolve(battleConfiguration);
  runtime.runPluginOperation = (_pluginId, args) => {
    if (args.mode === "loadAll") return Promise.resolve({ revision: 101, states });
    if (args.mode === "record" || args.mode === "undo") {
      recorded.push(args);
      return Promise.resolve({
        left: { id: args.leftId, state: states[args.leftId] },
        right: { id: args.rightId, state: states[args.rightId] },
      });
    }
    throw new Error("Unexpected battle operation: " + args.mode);
  };
  response = () => Promise.resolve({ findPerformers: { count: performers.length, performers } });
  const state = { slots: [], effects: [], cursor: 0 };
  let routeParams = {};
  function render() {
    active = state;
    state.cursor = 0;
    const pathDetails = plugin.algorithms.battleRouteFromPath(context.window.location.pathname);
    const params = { ...routeParams, ...(pathDetails && pathDetails.categoryId ? { categoryId: pathDetails.categoryId } : {}) };
    const page = plugin.testing.DirtyRankRoute({ match: { params } });
    const tree = page && page.type(page.props);
    state.effects.splice(0).forEach(effect => effect());
    return tree;
  }
  const battleCards = tree => findAll(tree, node => node.type === plugin.testing.PerformerCard);
  const actions = tree => findAll(tree, node => typeof node.type === "function" && node.type.name === "RankButton").map(visibleText);
  render();
  await flush();
  render();
  let tree = render();
  assert(actions(tree).includes("Tie") && actions(tree).includes("Skip"), "standard battles keep tie and skip");
  assert.strictEqual(visibleText(byClass(tree, "dirty-rank-title")), "DirtyRank");
  assert(byClass(tree, "dirty-rank-leaderboards-page-title"), "page title remains accessible while hidden from the battle toolbar");
  const identity = byClass(tree, "dirty-rank-header-identity");
  const categoryPicker = find(identity, node => node.props.id === "dirty-rank-category");
  assert(categoryPicker && categoryPicker.type === runtime.react.StatisticSelector, "left-side category picker uses the leaderboard's shared dropdown");
  assert.strictEqual(categoryPicker.props.ariaLabel, "Category");
  assert(!categoryPicker.props.options.some(option => option.value === "__overall__"), "battles offer categories rather than the overall leaderboard");
  assert(!byClass(tree, "dirty-rank-subtitle"), "battle heading keeps only the title");
  assert(!byClass(tree, "dirty-rank-statusbar"), "idle battles have no session statistics row");
  assert(!find(tree, node => typeof node.type === "function" && /^(Gauntlet)?ConfidenceIndicator$/.test(node.type.name)),
    "battle page omits the confidence panel");
  assert(visibleText(byClass(tree, "dirty-rank-refinement-estimate")).includes("4 of 4 female performers need refinement"), "estimate covers the entire selected cohort");
  const currentIds = battleCards(tree).map(card => card.props.performer.id);
  const refinedStates = JSON.parse(JSON.stringify(states));
  currentIds.forEach(id => { refinedStates[id].pools["appearance|FEMALE"].deviation = 75; });
  plugin.algorithms.applyRatingIndex({ revision: 102, states: refinedStates });
  tree = render();
  assert(visibleText(byClass(tree, "dirty-rank-refinement-estimate")).includes("2 of 4 female performers need refinement"), "refined current opponents do not hide other performers needing refinement");
  Object.values(refinedStates).forEach(state => { state.pools["appearance|FEMALE"].deviation = 75; });
  plugin.algorithms.applyRatingIndex({ revision: 103, states: refinedStates });
  tree = render();
  assert(!byClass(tree, "dirty-rank-refinement-estimate"), "estimate hides only once the whole cohort is refined");
  refinedStates[currentIds[0]].pools["appearance|FEMALE"].deviation = 250;
  plugin.algorithms.applyRatingIndex({ revision: 104, states: refinedStates });
  tree = render();
  assert(byClass(tree, "dirty-rank-refinement-estimate"), "one provisional performer restores the estimate");
  const estimateSettings = plugin.algorithms.settingsFromConfiguration({});
  const refinedPool = { rating: 1000, deviation: 75, volatility: 0.06, matches: 1 };
  assert.strictEqual(plugin.algorithms.precisionTier({ ...refinedPool, deviation: 40 }, estimateSettings).id, "excellent", "Excellent also counts as refined");
  assert(plugin.algorithms.estimatedMatchesToConfidence({ ...refinedPool, matches: 0 }, 100, refinedPool, estimateSettings) > 0, "unrated performers still need a battle even below the RD threshold");
  plugin.algorithms.applyRatingIndex({ revision: 105, states });
  tree = render();
  assert(find(tree, node => typeof node.type === "function" && node.type.name === "Leaderboard"), "standard battles show the sidebar leaderboard");
  assert(!byClass(tree, "dirty-rank-hill-crest"), "standard battles have no royal mode identity");
  assert(!byClass(tree, "dirty-rank-hill-progress"));
  const mode = find(tree, node => node.props.id === "dirty-rank-battle-mode");
  assert(mode && mode.type !== "select", "hill mode is entered through a button");
  assert.strictEqual(visibleText(mode), "King of the hill");
  mode.props.onClick();
  assert.strictEqual(context.window.location.pathname, "/plugins/dirty-rank/category/appearance/king-of-the-hill", "hill mode has its own category URL");
  render();
  tree = render();
  assert.strictEqual(visibleText(find(tree, node => node.props.id === "dirty-rank-battle-mode")), "Standard battles");
  assert(!find(tree, node => typeof node.type === "function" && node.type.name === "Leaderboard"), "hill mode removes the sidebar leaderboard");
  assert(find(tree, node => (node.props.className || "").includes("dirty-rank-kings-route")), "hill mode expands into a single-column layout");
  assert.strictEqual(visibleText(byClass(tree, "dirty-rank-hill-crest")).trim(), "King of the hill");
  assert.strictEqual(visibleText(byClass(tree, "dirty-rank-hill-progress-count")), "0 / 3 defeated");
  assert.strictEqual(visibleText(byClass(tree, "dirty-rank-hill-progress-label")), "Claim the crown");
  assert(!actions(tree).includes("Tie") && !actions(tree).includes("Skip"), "Kings of the hill is winner-only");
  let cards = battleCards(tree);
  assert.strictEqual(cards.length, 2);
  assert(cards.every(card => card.props.hillMode && card.props.hillOpening), "the opening labels both performers as contenders");
  assert(cards.every(card => card.props.performer.id !== "king-4"), "Kings opens among the lower-ranked performers");
  const firstLeft = cards[0];
  const firstRight = cards[1];
  firstLeft.props.onChoose();
  tree = render();
  cards = battleCards(tree);
  assert.strictEqual(cards[0].props.performer.id, firstLeft.props.performer.id, "left winner stays in place");
  assert.strictEqual(cards[0].props.key, firstLeft.props.key, "left winner keeps its mounted scene player");
  assert.strictEqual(cards[0].props.kingTarget, true);
  assert.strictEqual(cards[0].props.hillOpening, false);
  assert.strictEqual(cards[1].props.kingTarget, false);
  assert.strictEqual(visibleText(byClass(tree, "dirty-rank-hill-progress-count")), "1 / 3 defeated");
  assert.strictEqual(visibleText(byClass(tree, "dirty-rank-hill-progress-label")), "Defend the crown");
  assert.notStrictEqual(cards[1].props.performer.id, firstRight.props.performer.id, "the defeated challenger leaves");
  await flush();
  tree = render();
  cards = battleCards(tree);
  const secondRight = cards[1];
  secondRight.props.onChoose();
  tree = render();
  cards = battleCards(tree);
  assert.strictEqual(cards[1].props.performer.id, secondRight.props.performer.id, "right winner stays on the right");
  assert.strictEqual(cards[1].props.key, secondRight.props.key, "right winner keeps its mounted scene player");
  assert.strictEqual(cards[1].props.kingTarget, true);
  assert.strictEqual(cards[0].props.kingTarget, false, "the crown moves with the new reigning performer");
  assert(!cards.some(card => card.props.performer.id === firstLeft.props.performer.id || card.props.performer.id === firstRight.props.performer.id),
    "neither earlier loser can return as a challenger");
  await flush();
  tree = render();
  const countBeforeShortcuts = recorded.length;
  for (const key of ["ArrowUp", "t", "s"]) {
    documentListeners.get("keydown")({ key, defaultPrevented: false, preventDefault: noop });
  }
  await flush();
  assert.strictEqual(recorded.length, countBeforeShortcuts, "tie and skip keys do nothing in Kings mode");
  cards[1].props.onChoose();
  tree = render();
  const crownedCards = battleCards(tree);
  assert.strictEqual(crownedCards.length, 1, "the hill ends with only the winner visible");
  assert.strictEqual(crownedCards[0].props.performer.id, secondRight.props.performer.id);
  assert.strictEqual(crownedCards[0].props.key, secondRight.props.key, "the winning card keeps its mounted scene player");
  assert.strictEqual(crownedCards[0].props.crowned, true, "the crowned card no longer accepts votes");
  assert.strictEqual(visibleText(byClass(tree, "dirty-rank-hill-progress-count")), "3 / 3 defeated");
  assert.strictEqual(byClass(tree, "dirty-rank-hill-progress-track").children[0].props.style.width, "100%");
  assert(find(tree, node => (node.props.className || "").includes("dirty-rank-coronation-right")), "the winning card moves to the center");
  assert.strictEqual(findAll(tree, node => (node.props.className || "") === "dirty-rank-firework").length, 18,
    "victory includes staggered bursts and a six-burst finale");
  assert.strictEqual(findAll(tree, node => node.props.className === "dirty-rank-firework-spark").length, 576);
  assert.strictEqual(findAll(tree, node => node.props.className === "dirty-rank-victory-confetti").length, 64);
  assert.strictEqual(byClass(tree, "dirty-rank-fireworks").props["aria-hidden"], "true");
  const cleared = find(tree, node => node.props.title === "Hill cleared");
  assert(cleared && cleared.props.detail.includes(secondRight.props.performer.name));
  const clearedActions = findAll(cleared.props.actions, node => typeof node.type === "function" && node.type.name === "RankButton");
  assert.strictEqual(clearedActions.length, 2, "the cleared hill offers undo and a new run");
  clearedActions[0].props.onClick();
  tree = render();
  cards = battleCards(tree);
  assert.strictEqual(cards.length, 2, "undo restores the final defeated challenger");
  assert.strictEqual(visibleText(byClass(tree, "dirty-rank-hill-progress-count")), "2 / 3 defeated");
  assert(!byClass(tree, "dirty-rank-fireworks"), "undo removes the victory effect");
  await flush();
  tree = render();
  cards = battleCards(tree);
  cards[1].props.onChoose();
  await flush();
  tree = render();
  const restart = findAll(find(tree, node => node.props.title === "Hill cleared").props.actions,
    node => typeof node.type === "function" && node.type.name === "RankButton")[1];
  assert.strictEqual(restart.props.disabled, false);
  restart.props.onClick();
  tree = render();
  tree = render();
  assert.strictEqual(battleCards(tree).length, 2, "a new run makes the pool available again");
  assert.strictEqual(visibleText(byClass(tree, "dirty-rank-hill-progress-count")), "0 / 3 defeated", "restarting resets the royal progress ribbon");
  find(tree, node => node.props.id === "dirty-rank-battle-mode").props.onClick();
  assert.strictEqual(context.window.location.pathname, "/plugins/dirty-rank/category/appearance", "standard mode has a distinct category URL");
  render();
  tree = render();
  assert.strictEqual(visibleText(find(tree, node => node.props.id === "dirty-rank-battle-mode")), "King of the hill");
  assert(find(tree, node => typeof node.type === "function" && node.type.name === "Leaderboard"), "returning to standard restores the sidebar");
  assert(!byClass(tree, "dirty-rank-hill-crest"));
  assert(battleCards(tree).every(card => !card.props.hillMode), "royal styling does not leak into standard cards");
  assert(actions(tree).includes("Tie") && actions(tree).includes("Skip"));
  find(tree, node => node.props.id === "dirty-rank-category").props.onSelect("performance");
  assert.strictEqual(context.window.location.pathname, "/plugins/dirty-rank/category/performance");
  render();
  tree = render();
  assert.strictEqual(find(tree, node => node.props.id === "dirty-rank-category").props.value, "performance", "category selection navigates to its own page");
  find(tree, node => node.props.id === "dirty-rank-battle-mode").props.onClick();
  render();
  tree = render();
  assert.strictEqual(context.window.location.pathname, "/plugins/dirty-rank/category/performance/king-of-the-hill");
  find(tree, node => node.props.id === "dirty-rank-category").props.onSelect("appearance");
  render();
  tree = render();
  assert.strictEqual(context.window.location.pathname, "/plugins/dirty-rank/category/appearance/king-of-the-hill", "category changes preserve hill mode");
  context.window.location.pathname = "/plugins/dirty-rank/category/performance";
  render();
  tree = render();
  assert.strictEqual(find(tree, node => node.props.id === "dirty-rank-category").props.value, "performance", "browser history restores the URL's category");
  assert(find(tree, node => typeof node.type === "function" && node.type.name === "Leaderboard"), "browser history restores standard mode");
  state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
  state.slots = [];
  state.effects = [];
  context.window.location.pathname = "/plugins/dirty-rank/category/appearance/king-of-the-hill";
  render();
  await flush();
  render();
  tree = render();
  assert.strictEqual(find(tree, node => node.props.id === "dirty-rank-category").props.value, "appearance", "direct category links override the remembered category");
  assert(!find(tree, node => typeof node.type === "function" && node.type.name === "Leaderboard"), "direct hill links open in hill mode");
  assert.strictEqual(battleCards(tree).length, 2);
  const encodedCategory = "face / body";
  const encodedPath = plugin.algorithms.battleCategoryPath(encodedCategory, true);
  assert.strictEqual(encodedPath, "/plugins/dirty-rank/category/face%20%2F%20body/king-of-the-hill");
  assert.strictEqual(plugin.algorithms.battleRouteFromPath(encodedPath).categoryId, encodedCategory);
  assert.strictEqual(plugin.algorithms.battleRouteFromPath("/plugins/dirty-rank/category/%ZZ"), null, "malformed category URLs fail safely");
  assert.strictEqual(plugin.algorithms.battleRouteFromPath("/plugins/dirty-rank/category/appearance/unknown"), null);
  state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
  state.slots = [];
  state.effects = [];
  routeParams = { performerId: "king-1" };
  context.window.location.pathname = "/plugins/dirty-rank/gauntlet/king-1";
  render();
  await flush();
  render();
  tree = render();
  const targetConfidence = find(tree, node => typeof node.type === "function" && node.type.name === "GauntletConfidenceIndicator");
  assert(targetConfidence, "Gauntlet retains its target precision bar");
  assert.strictEqual(context.window.location.pathname, "/plugins/dirty-rank/gauntlet/king-1/appearance", "Gauntlet category is also bookmarkable");
  assert(!byClass(tree, "dirty-rank-refinement-estimate"), "Gauntlet uses its own target estimate without duplication");
  assert.strictEqual(targetConfidence.props.performer.id, "king-1");
  const confidenceTree = targetConfidence.type(targetConfidence.props);
  const confidenceBar = find(confidenceTree, node => node.props.role === "progressbar");
  assert(confidenceBar && confidenceBar.props["aria-valuenow"] < 100, "provisional target shows remaining progress toward Refined");
  assert(find(confidenceTree, node => node.type === plugin.testing.PrecisionBadge), "target precision tier remains visible");
  for (const hideBattleStandings of [false, true]) {
    for (const mode of ["standard", "hill", "gauntlet"]) {
      state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
      state.slots = [];
      state.effects = [];
      battleConfiguration = { hideBattleStandings };
      routeParams = mode === "gauntlet" ? { performerId: "king-1" } : {};
      context.window.location.pathname = mode === "gauntlet" ? "/plugins/dirty-rank/gauntlet/king-1/appearance"
        : "/plugins/dirty-rank/category/appearance" + (mode === "hill" ? "/king-of-the-hill" : "");
      render();
      await flush();
      render();
      tree = render();
      const expectedHidden = hideBattleStandings || mode === "hill";
      assert.strictEqual(Boolean(find(tree, node => typeof node.type === "function" && node.type.name === "Leaderboard")), !expectedHidden,
        "hill always hides standings; other modes respect the preference");
      assert.strictEqual(Boolean(byClass(tree, "dirty-rank-standings-hidden")), expectedHidden, "hidden sidebar frees the battle width");
    }
  }
  performers[1].gender = "MALE";
  battleConfiguration = { genderBoxes: [
    { id: "FEMALE", name: "Shared", genders: ["FEMALE", "MALE"] },
    { id: "MALE", name: "Men", genders: ["MALE"], enabled: false },
  ], categories: { FEMALE: [
    { name: "Appearance" },
    { name: "Performance" },
  ] } };
  state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
  state.slots = [];
  state.effects = [];
  routeParams = { performerId: "king-2" };
  context.window.location.pathname = "/plugins/dirty-rank/gauntlet/king-2/appearance";
  context.window.location.search = "";
  render();
  await flush();
  render();
  await flush();
  render();
  await flush();
  render();
  tree = render();
  assert.strictEqual(battleCards(tree).length, 2, "Gauntlet can use a mixed category even when the target's original set is disabled");
  assert.strictEqual(battleCards(tree)[0].props.performer.id, "king-2");
  assert.strictEqual(battleCards(tree)[1].props.performer.gender, "FEMALE", "the target can battle a different selected gender");
  assert.strictEqual(context.window.location.search, "", "Gauntlet uses the default shared box");
  assert.strictEqual(find(tree, node => node.props.id === "dirty-rank-category").props.options.length, 2, "all categories in a box use its selected genders");
  assert.strictEqual(find(tree, node => typeof node.type === "function" && node.type.name === "GauntletConfidenceIndicator").props.cohort, "FEMALE");
  state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
  state.slots = [];
  state.effects = [];
  render();
  await flush();
  render();
  tree = render();
  assert.strictEqual(battleCards(tree).length, 2, "a direct mixed-category Gauntlet URL survives a fresh mount");
  battleConfiguration.genderBoxes[1].enabled = true;
  state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
  state.slots = [];
  state.effects = [];
  render();
  await flush();
  render();
  tree = render();
  const setSelector = find(tree, node => node.props.id === "dirty-rank-battle-cohort");
  assert.strictEqual(setSelector.props.value, "FEMALE");
  setSelector.props.onChange({ target: { value: "MALE" } });
  render();
  tree = render();
  assert.strictEqual(context.window.location.search, "?box=MALE", "URLs preserve a non-default box");
  assert.strictEqual(find(tree, node => node.props.id === "dirty-rank-battle-cohort").props.value, "MALE");
  context.window.location.search = "";
  render();
  render();
  tree = render();
  assert.strictEqual(find(tree, node => node.props.id === "dirty-rank-battle-cohort").props.value, "FEMALE", "browser history restores the shared category pool");
  assert.strictEqual(battleCards(tree).length, 2);
  assert.strictEqual(battleCards(tree)[1].props.performer.gender, "FEMALE");
  state.slots.forEach(slot => { if (slot && slot.cleanup) slot.cleanup(); });
  runtime.getPluginSettings = originalSettings;
  runtime.runPluginOperation = originalOperation;
  response = originalResponse;
  context.window.location.pathname = originalPath;
  context.window.location.search = originalSearch;
  context.window.crypto = originalCrypto;
}

async function verifyLeaderboardDisplays() {
  const { PrecisionBadge, LeaderboardPodium, LeaderboardGallery, LeaderboardGalleryCard, LeaderboardTable, LeaderboardPagination, DirtyRankLeaderboardsRoute } = plugin.testing;
  // Ratings use the viewer's locale; format expectations the same way so the test passes on any host.
  const n = value => value.toLocaleString();
  for (const [deviation, matches, tier] of [[350, 0, "Provisional"], [75, 12, "Refined"], [50, 20, "Excellent"], [75, 1, "Refined"]]) {
    const badge = PrecisionBadge({ pool: { deviation, matches }, settings });
    assert.strictEqual(visibleText(badge), tier);
    assert.strictEqual(badge.props.title, `${tier} precision · RD ${deviation.toFixed(1)} · ${matches} ${matches === 1 ? "battle" : "battles"}`);
    assert.strictEqual(plugin.testing.leaderboardRatingText({ rating: 1400, deviation, matches }, settings),
      n(1400) + (tier === "Provisional" ? "*" : ""), "leaderboards only mark ratings that need more comparisons");
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
  const tooltipSettings = plugin.algorithms.settingsFromConfiguration({ categories: { FEMALE: [
    { name: "Appearance", enabled: true, weight: 2 },
    { name: "Performance", enabled: true, weight: 1 },
    { name: "Ignored", enabled: false, weight: 5 },
  ] } });
  plugin.algorithms.applyRatingIndex({ revision: 1, states: { "rank-1": { pools: {
    "appearance|FEMALE": { rating: 1200, deviation: 75, matches: 2, wins: 2, losses: 0, draws: 0 },
  } } } });
  const overallProps = { ranked: [ranked[0]], settings: tooltipSettings, cohort: "FEMALE", leaderboardId: "__overall__", page: 1, onPageChange: noop };
  plugin.algorithms.setOverallReferencePerformers(ranked);
  const tooltip = `Overall: 50.0 · Simple weighted · 1/2 categories rated\nAppearance: #1 (${n(1200)}) · score 50.00\nPerformance: Unrated · score 50.00`;
  assert.strictEqual(find(LeaderboardPodium(overallProps), node => node.props.className === "dirty-rank-podium-rating").props.title, tooltip);
  active = { slots: [], effects: [], cursor: 0 };
  assert.strictEqual(find(LeaderboardGalleryCard({ ...overallProps, performer: ranked[0], rank: 1 }), node => node.type === "strong" && node.props.title).props.title, tooltip);
  assert.strictEqual(find(LeaderboardTable({ ...overallProps, entries: [{ performer: ranked[0], rank: 1 }] }), node => node.props.className === "dirty-rank-table-rating").props.title, tooltip);
  assert.strictEqual(visibleText(find(LeaderboardPodium(overallProps), node => node.props.className === "dirty-rank-podium-rating")), "50.0*");
  assert.deepStrictEqual(findAll(LeaderboardTable({ ...overallProps, entries: [{ performer: ranked[0], rank: 1 }] }), node => node.type === "th").map(visibleText), ["Rank", "Performer", "Score"]);
  const overallPool = plugin.algorithms.leaderboardPoolFor(ranked[0], "__overall__", "FEMALE", tooltipSettings);
  assert.strictEqual(visibleText(PrecisionBadge({ pool: overallPool, settings: tooltipSettings })), "Provisional");
  assert(PrecisionBadge({ pool: overallPool, settings: tooltipSettings }).props.title.includes("1/2 categories rated · mean category RD"));
  assert.strictEqual(find(LeaderboardPodium({ ...overallProps, leaderboardId: "appearance" }), node => node.props.className === "dirty-rank-podium-rating").props.title, undefined,
    "category leaderboards keep their ordinary score without an overall breakdown");
  const rankStates = { "rank-1": { pools: {
    "appearance|FEMALE": { rating: 1200, deviation: 75, matches: 2 },
  } }, "rank-2": { pools: {
    "appearance|FEMALE": { rating: 1600, deviation: 75, matches: 2 },
  } }, "rank-3": { pools: {
    "appearance|FEMALE": { rating: 1200, deviation: 75, matches: 2 },
  } }, "no-image": { pools: {
    "appearance|FEMALE": { rating: 1800, deviation: 75, matches: 2 },
  } } };
  plugin.algorithms.setOverallReferencePerformers(ranked.concat([{ id: "no-image", gender: "FEMALE", image_path: "" }]));
  plugin.algorithms.applyRatingIndex({ revision: 2, states: rankStates });
  const rankTitle = (performer, options = {}) => find(LeaderboardPodium({ ...overallProps, ...options, ranked: [performer] }),
    node => node.props.className === "dirty-rank-podium-rating").props.title;
  assert(rankTitle(ranked[0]).includes(`Appearance: #2 (${n(1200)})`), "tooltip rank must use the full category leaderboard, not the visible subset");
  assert(rankTitle(ranked[2]).includes(`Appearance: #3 (${n(1200)})`), "equal ratings must retain the category leaderboard's displayed positions");
  assert(rankTitle(ranked[0], { settings: { ...tooltipSettings, includePerformersWithoutImages: true } }).includes(`Appearance: #3 (${n(1200)})`),
    "tooltip positions must follow the leaderboard's image eligibility setting");
  rankStates["rank-1"].pools["appearance|FEMALE"].rating = 1900;
  plugin.algorithms.applyRatingIndex({ revision: 3, states: rankStates });
  assert(rankTitle(ranked[0]).includes(`Appearance: #1 (${n(1900)})`), "rating updates must invalidate cached tooltip positions");
  const props = { ranked, settings, cohort: "FEMALE", leaderboardId: "appearance", page: 1, onPageChange: noop };
  const articleIds = tree => findAll(tree, node => node.type === "article").map(node => node.props.key);
  for (const topCount of [3, 4, 5]) {
    const podium = LeaderboardPodium({ ...props, topCount });
    const expectedIds = ranked.slice(0, topCount).map(performer => performer.id);
    assert.deepStrictEqual(articleIds(podium).sort(), expectedIds.sort());
    assert.strictEqual(podium.props["aria-label"], { 3: "Podium", 4: "Mount Rushmore", 5: "Fingers" }[topCount]);
    assert(!find(podium, node => node.type === "header"), "featured cards must have no decorative header");
    assert(!/\bScore\b|\/100|\bRD\b|\bbattles\b|Refined|Excellent|Provisional/.test(visibleText(podium)), "featured cards keep rank and score without extra labels");
    assert.strictEqual(findAll(podium, node => node.type === PrecisionBadge).length, 0);
    findAll(podium, node => node.props.className === "dirty-rank-leaderboard-rating-row").forEach(row => {
      assert(/^#\d+$/.test(visibleText(row.children[0])));
      assert(row.children[1].props.className === "dirty-rank-podium-rating", "rank and score must share a row");
    });
    assert.strictEqual(findAll(podium, node => node.props.className === "dirty-rank-podium-step").length, topCount === 3 ? 3 : 0);
    if (topCount > 3) assert.deepStrictEqual(articleIds(podium), ranked.slice(0, topCount).map(performer => performer.id));
    const totalCount = Math.ceil(18 / topCount) * topCount;
    const pageSize = totalCount - topCount;
    for (const Component of [LeaderboardGallery, LeaderboardTable]) {
      const collected = [];
      const totalPages = Math.ceil((ranked.length - topCount) / pageSize);
      for (let page = 1; page <= totalPages; page++) {
        const tree = Component({ ...props, topCount, page });
        assert(!find(tree, node => node.type === "h2" || (node.props.className || "").includes("dirty-rank-panel-heading")),
          "standings must have no decorative header");
        const firstRank = topCount + (page - 1) * pageSize + 1;
        const lastRank = Math.min(firstRank + pageSize - 1, ranked.length);
        const expectedRanks = Array.from({ length: lastRank - firstRank + 1 }, (_, i) => firstRank + i);
        if (Component === LeaderboardGallery) {
          assert.strictEqual(find(tree, node => node.props.className === "dirty-rank-gallery-grid").props.style["--dirty-rank-gallery-columns"], topCount);
          const cards = findAll(tree, node => node.type === LeaderboardGalleryCard);
          assert.deepStrictEqual(cards.map(node => node.props.rank), expectedRanks);
          collected.push(...cards.map(node => node.props.performer.id));
        } else {
          assert.deepStrictEqual(findAll(tree, node => node.type === "th").map(visibleText), ["Rank", "Performer", "Rating"]);
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
  for (const [topCount, totalCount] of [[3, 12], [4, 20], [5, 30]]) {
    const pageSettings = plugin.algorithms.settingsFromConfiguration({ leaderboardTopCount: topCount, leaderboardPerformerCount: totalCount });
    for (const Component of [LeaderboardGallery, LeaderboardTable]) {
      const countEntries = tree => Component === LeaderboardGallery
        ? findAll(tree, node => node.type === LeaderboardGalleryCard).length
        : find(tree, node => node.type === "tbody").children.length;
      const pageProps = { ...props, settings: pageSettings, topCount };
      assert.strictEqual(countEntries(Component(pageProps)) + articleIds(LeaderboardPodium(pageProps)).length, totalCount,
        "configured counts include featured performers in both views");
      const filtered = Component({ ...pageProps, entries: ranked.map((performer, i) => ({ performer, rank: i + 1 })), showFeatured: false });
      assert.strictEqual(countEntries(filtered), totalCount, "filters use the whole page budget when the featured top is hidden");
    }
  }
  assert.deepStrictEqual(articleIds(LeaderboardPodium(props)), ["rank-2", "rank-1", "rank-3"], "default podium retains silver/gold/bronze order");
  active = { slots: [], effects: [], cursor: 0 };
  const galleryCard = LeaderboardGalleryCard({ ...props, performer: ranked[0], rank: 6 });
  assert(!/\bRD\b|\bbattles\b|W-L-D/.test(visibleText(galleryCard)), "gallery cards hide rating detail and win/loss records");
  assert(!find(galleryCard, node => node.type === PrecisionBadge));
  const ratingRow = find(galleryCard, node => (node.props.className || "").includes("dirty-rank-leaderboard-rating-row"));
  assert.strictEqual(visibleText(ratingRow.children[0]), "#6");
  assert(ratingRow.children[1].type === "strong", "gallery score belongs beside the rank");

  let configuration = {};
  runtime.getPluginSettings = () => Promise.resolve(configuration);
  const states = Object.fromEntries(ranked.map((performer, i) => [performer.id, { pools: {
    "appearance|FEMALE": { rating: 2000 - i * 10, deviation: 50, matches: 10, wins: 10, losses: 0, draws: 0 },
  } }]));
  runtime.runPluginOperation = () => Promise.resolve({ revision: 100, states });
  let matchingIds = [];
  response = query => Promise.resolve({ findPerformers: query.includes("DirtyRankFilteredPerformerIds")
    ? { count: matchingIds.length, performers: matchingIds.map(id => ({ id })) }
    : { performers: ranked } });
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
  let render = route();
  render();
  await flush();
  let tree = render();
  assert.strictEqual(find(tree, node => node.type === LeaderboardPodium).props.topCount, 3);
  const header = find(tree, node => node.type === "header" && node.props.className.includes("dirty-rank-leaderboards-header"));
  assert.deepStrictEqual(header.children[1].children.filter(Boolean).map(node => node.type === "a" ? visibleText(node) : node.type === plugin.testing.RankStatisticSelector ? "Statistic" : node.props.label || "Filter"), ["Statistic", "Filter", "Coverage", "Confidence", "Battles", "Options"]);
  assert.strictEqual(header.children[1].children.filter(Boolean).slice(-2)[0].props.to, "/plugins/dirty-rank", "battles sit immediately before options");
  assert.strictEqual(header.children[1].children.filter(Boolean).slice(-1)[0].props.to, "/plugins/dirty-plugins?plugin=dirtyRank", "rightmost header button opens options");
  assert(find(tree, node => node.type === runtime.react.Dialog && node.props.ariaLabel === "Performer filters"));
  assert(find(tree, node => node.type === context.window.PluginApi.components.FilteredPerformerList), "the filter dialog uses Stash's native performer filters");
  const statSelector = plugin.testing.RankStatisticSelector({ value: "__overall__", label: "Overall", categories: [{ id: "appearance", name: "Appearance" }] });
  assert.strictEqual(statSelector.type, runtime.react.StatisticSelector);
  assert(statSelector.props.options.some(option => option.value === "appearance" && option.label === "Appearance"));
  statSelector.props.onSelect("appearance");
  assert.strictEqual(context.window.location.pathname, plugin.testing.leaderboardStatPath("appearance"));
  assert.strictEqual(plugin.testing.leaderboardIdFromPath(context.window.location.pathname), "appearance");
  assert.strictEqual(plugin.testing.leaderboardIdFromPath("/plugins/dirty-rank-leaderboards"), "__overall__");
  tree = render();
  assert.strictEqual(find(tree, node => node.type === plugin.testing.RankStatisticSelector).props.value, "appearance");
  render = route();
  render();
  await flush();
  tree = render();
  assert.strictEqual(find(tree, node => node.type === plugin.testing.RankStatisticSelector).props.value, "appearance", "a bookmarked stat opens directly");
  plugin.testing.RankStatisticSelector({ value: "appearance", label: "Appearance", categories: [{ id: "appearance", name: "Appearance" }] }).props.onSelect("__overall__");
  assert.strictEqual(context.window.location.pathname, "/plugins/dirty-rank-leaderboards/overall");
  context.window.location.pathname = "/plugins/dirty-rank-leaderboards";

  configuration = { leaderboardTopCount: 5, leaderboardView: "table" };
  render = route();
  render();
  await flush();
  tree = render();
  assert.strictEqual(find(tree, node => node.type === LeaderboardPodium).props.topCount, 5);
  assert.strictEqual(find(tree, node => node.type === LeaderboardTable).props.entries[0].rank, 6);
  assert(!find(header, node => node.props.id === "dirty-rank-leaderboard-top-count" || node.props.id === "dirty-rank-leaderboard-view"));
  const savedConfiguration = plugin.testing.serializedSettings(plugin.algorithms.settingsFromConfiguration(configuration));
  assert.strictEqual(savedConfiguration.leaderboardTopCount, 5);
  assert.strictEqual(savedConfiguration.leaderboardView, "table");

  function captureFilter(findFilter, performerFilter, count) {
    const state = { slots: [], effects: [], cursor: 0 };
    active = state;
    plugin.testing.DirtyRankLeaderboardFilterCapture({ filter: {
      makeFindFilter: () => findFilter,
      makeFilter: () => performerFilter,
      count: () => count,
    } });
    state.effects.splice(0).forEach(effect => effect());
  }
  render = route();
  render();
  await flush();
  tree = render();
  assert(find(tree, node => node.type === LeaderboardPodium), "the featured display shows without filters");
  matchingIds = ["rank-4"].concat(Array.from({ length: 10 }, (_, i) => "rank-" + (40 + i)));
  captureFilter({ q: "Performer 4" }, { tags: { value: ["7"], modifier: "INCLUDES" } }, 1);
  render();
  await flush();
  tree = render();
  assert(!find(tree, node => node.type === LeaderboardPodium), "filtering hides the global podium");
  const filteredResults = find(tree, node => node.type === LeaderboardTable);
  assert.deepStrictEqual(filteredResults.props.entries.map(entry => entry.performer.name),
    ["Performer 4"].concat(Array.from({ length: 10 }, (_, i) => "Performer " + (40 + i))));
  assert.deepStrictEqual(filteredResults.props.entries.map(entry => entry.rank),
    [4].concat(Array.from({ length: 10 }, (_, i) => 40 + i)));
  assert.strictEqual(filteredResults.props.page, 1);
  assert.strictEqual(filteredResults.props.title, undefined);
  const filterCall = calls.findLast(call => call.query.includes("DirtyRankFilteredPerformerIds"));
  assert.strictEqual(filterCall.variables.filter.q, "Performer 4");
  assert.strictEqual(filterCall.variables.performerFilter.tags.value[0], "7");
  matchingIds = [];
  captureFilter({ q: "zzz" }, {}, 0);
  render();
  await flush();
  tree = render();
  assert(!find(tree, node => node.type === LeaderboardPodium));
  const noMatchTable = find(tree, node => node.type === LeaderboardTable);
  assert.strictEqual(noMatchTable.props.entries.length, 0);
  assert.strictEqual(noMatchTable.props.title, undefined);
  assert(/No rated performers match/.test(noMatchTable.props.emptyMessage));
  captureFilter({ q: "" }, {}, 0);
  render();
  tree = render();
  assert(find(tree, node => node.type === LeaderboardPodium), "clearing filters restores the featured display");
  assert.strictEqual(find(tree, node => node.type === LeaderboardTable).props.entries[0].rank, 6,
    "clearing filters restores standings after the five featured performers");

  for (const [saved, expected] of [["5", 5], ["6", 3], ["4", 4], ["broken", 3], ["7", 3], ["4.5", 3]]) {
    configuration = { leaderboardTopCount: saved };
    render = route();
    render();
    await flush();
    assert.strictEqual(find(render(), node => node.type === LeaderboardPodium).props.topCount, expected, "saved selections should be restored or safely defaulted");
  }
  const pages = [];
  response = (_query, variables) => {
    pages.push(variables.filter.page);
    const start = (variables.filter.page - 1) * 500;
    const count = Math.min(500, 501 - start);
    return Promise.resolve({ findPerformers: { count: 501, performers: Array.from({ length: count }, (_, i) => ({ id: String(start + i + 1) })) } });
  };
  const allMatchingIds = await plugin.testing.queryLeaderboardPerformerIds({ find: {}, object: {} });
  assert.strictEqual(allMatchingIds.size, 501, "native filters include every matching performer across pages");
  assert.deepStrictEqual(pages, [1, 2]);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
