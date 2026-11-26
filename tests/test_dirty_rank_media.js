"use strict";
const { runSource } = require("./plugin_paths");

const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const { element, find, findAll, text, createHooks } = require("./ui_harness");
const { createMultiscreenHarness } = require("./multiscreen_harness");

// Exercise the actual component and asynchronous handlers without a Stash server.
const noop = function () {};
let active;
const React = {
  Fragment: "fragment",
  createElement(type, props, ...children) {
    // Render the extracted, hook-free settings sections just as React would.
    if (
      typeof type === "function" &&
      [
        "GenderBoxEditor",
        "BattleSettings",
        "LeaderboardSettings",
        "OverallScoringSettings",
        "CategoryEditor",
        "RatingSettings",
        "ParameterFields",
      ].includes(type.name)
    )
      return type(props || {});
    return element(type, props, ...children.flat());
  },
  ...createHooks(() => active),
};
const calls = [];
const documentListeners = new Map();
const timers = new Map();
let nextTimer = 0;
let response = () => Promise.resolve({ findPerformers: { performers: [] } });
const runtime = {
  react: {
    usePageTitle() {},
    SettingsCard: function SettingsCard() {},
    SettingsSection: function SettingsSection() {},
    SettingsToggle: function SettingsToggle() {},
    StatisticSelector: function SharedStatisticSelector() {},
    Dialog: function SharedDialog() {},
    Button: function SharedButton() {},
    Badge: function SharedBadge() {},
    Field: function SharedField() {},
    Metric: function SharedMetric() {},
    Pagination: function SharedPagination() {},
    NavAction: function SharedNavAction() {},
    NavIcon: function SharedNavIcon() {},
    IconButton: function SharedIconButton() {},
    SaveStatus: function SharedSaveStatus() {},
  },
  native: { ensureComponents: () => Promise.resolve([]), loadComponent: () => Promise.resolve(null) },
  captureEnabled: search => new URLSearchParams(search).get("docsCapture") === "1",
  captureUrl: path => path,
  getPluginSettings: () => Promise.resolve({}),
  runPluginOperation: (_pluginId, args) =>
    Promise.resolve(args.mode === "getSettings" ? { revision: 0, settings: {} } : { states: {} }),
  graphql: (query, variables, options) => {
    calls.push({ query, variables, signal: options && options.signal });
    return response(query, variables, options && options.signal);
  },
};
const context = vm.createContext({
  console,
  AbortController,
  CustomEvent,
  URLSearchParams,
  Math: Object.create(Math),
  document: {
    activeElement: null,
    addEventListener: (name, listener) => documentListeners.set(name, listener),
    removeEventListener: (name, listener) => {
      if (documentListeners.get(name) === listener) documentListeners.delete(name);
    },
  },
  window: {
    DirtyPlugins: runtime,
    PluginApi: {
      React,
      components: { FilteredPerformerList: function FilteredPerformerList() {} },
      libraries: {
        Intl: {},
        ReactRouterDOM: {
          NavLink: "a",
          useLocation: () => context.window.location,
          useHistory: () => ({
            push: path => {
              context.window.location.pathname = path.split("?")[0];
              context.window.location.search = path.includes("?") ? "?" + path.split("?")[1] : "";
            },
            replace: path => {
              context.window.location.pathname = path.split("?")[0];
              context.window.location.search = path.includes("?") ? "?" + path.split("?")[1] : "";
            },
          }),
        },
        Bootstrap: {
          ButtonGroup: "button-group",
          Dropdown: Object.assign(function Dropdown() {}, {
            Toggle: "dropdown-toggle",
            Menu: "dropdown-menu",
            Item: "dropdown-item",
          }),
          InputGroup: { Prepend: "input-group-prepend" },
        },
      },
      register: { route: noop },
      patch: { before: noop, after: noop, instead: noop },
    },
    addEventListener: noop,
    removeEventListener: noop,
    location: { pathname: "/plugins/dirty-rank-leaderboards", search: "" },
    setTimeout: callback => {
      timers.set(++nextTimer, callback);
      return nextTimer;
    },
    clearTimeout: id => timers.delete(id),
  },
});
require("./shared_runtime").installSaveController(context.window);
runtime.react.useSettingsDraft = require("./shared_runtime")
  .loadFeature(context.window, "SettingsDraft")
  .createSettingsDraftHook(React);
// Every Rank module in one bundle, evaluated against this context's window.
const VIEWS = [
  "domain/navigation",
  "domain/settings",
  "domain/matchmaking",
  "domain/rating",
  "domain/rank",
  "domain/verdicts",
  "components/Primitives",
  "components/Preview",
  "components/PerformerCard",
  "components/Leaderboards",
  "components/Battles",
  "components/Native",
  "settingsPanel",
  "battleSession",
  "runtime",
]
  .map(name => 'export * from "./src/' + name + '";')
  .join(";");
const views = { ...runSource("DirtyRank", "rank-test-views.ts", context, { contents: VIEWS }) };
const plugin = { testing: views, algorithms: views };
const settings = plugin.algorithms.settingsFromConfiguration({});
{
  const originalLocation = context.window.location;
  context.window.location = { pathname: "/plugins/dirty-rank", search: "" };
  const prefixPage = plugin.testing.DirtyRankRoute({ match: { params: {} } });
  assert.strictEqual(
    prefixPage.type.name,
    "DirtyRankBattlePage",
    "route ownership mounts a separate page with its own effect lifecycle",
  );
  context.window.location.pathname = "/plugins/dirty-rank/category/appearance";
  assert.strictEqual(
    plugin.testing.DirtyRankRoute({ match: { params: {} } }),
    null,
    "the prefix route removes its page when a category route takes over, cleaning up its title observer",
  );
  const categoryPage = plugin.testing.DirtyRankRoute({ match: { params: { categoryId: "appearance" } } });
  assert.strictEqual(categoryPage.type, prefixPage.type);
  context.window.location.pathname += "/king-of-the-hill";
  assert.strictEqual(
    plugin.testing.DirtyRankRoute({ match: { params: { categoryId: "appearance" } } }),
    null,
    "battles have one mode and no second category URL",
  );
  context.window.location.pathname = "/plugins/dirty-rank-leaderboards";
  assert.strictEqual(
    plugin.testing.DirtyRankRoute({ match: { params: {} } }),
    null,
    "leaving battles unmounts the page even if Stash retains the route wrapper",
  );
  context.window.location = originalLocation;
}
const scene = { id: "top", title: "Top scene", rating100: 100, paths: { stream: "/top.mp4" } };
const markerScene = { id: "curated", title: "Curated", rating100: 80, paths: { stream: "/curated.mp4" } };
const data = {
  top: { scenes: [scene] },
  marked: { scenes: [markerScene] },
  markers: { scene_markers: [{ id: "marker", seconds: 12, end_seconds: 18, scene: markerScene }] },
};
let nextId = 0;
function card(auto, overrides) {
  const state = { slots: [], effects: [], cursor: 0 };
  let tree;
  const props = {
    performer: { id: String(++nextId), name: "Example", image_path: "/portrait.svg", scene_count: 1 },
    pool: { matches: 0 },
    settings: { ...settings, autoPlayTopScenes: auto, ...overrides },
  };
  return {
    props,
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
      state.slots.forEach(slot => {
        if (slot && slot.cleanup) slot.cleanup();
      });
    },
  };
}
const byClass = (tree, name) => find(tree, node => (node.props.className || "").split(" ").includes(name));
const visibleText = tree => text(tree, " ");
const video = tree => find(tree, node => node.type === "video");
const event = () => ({
  preventDefault: noop,
  stopPropagation() {
    this.stopped = true;
  },
});
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
    pause() {
      this.paused = true;
    },
    removeAttribute(name) {
      delete this[name];
    },
    load() {
      this.loadCalls++;
    },
    ...attributes,
  };
  video(tree).props.ref(player);
  return player;
}

async function main() {
  context.window.location.search = "?docsCapture=1";
  assert(plugin.testing.documentationCapture(), "capture mode follows the hub's docsCapture detection");
  context.window.location.search = "";
  const playbackUrl = plugin.testing.scenePlaybackUrl;
  const legacyScene = {
    paths: { stream: "/scene/896/stream" },
    sceneStreams: [
      { url: "/scene/896/stream.mp4?resolution=ORIGINAL", mime_type: "video/mp4", label: "MP4" },
      { url: "/scene/896/stream.mp4?resolution=STANDARD_HD", mime_type: "video/mp4", label: "MP4 HD (720p)" },
    ],
  };
  assert.strictEqual(
    playbackUrl(legacyScene),
    legacyScene.sceneStreams[1].url,
    "WMV originals must use Stash's browser-compatible MP4 preview",
  );
  assert.strictEqual(
    playbackUrl({ ...legacyScene, sceneStreams: [legacyScene.sceneStreams[0]] }),
    legacyScene.sceneStreams[0].url,
    "MP4 remains preferred when 720p is unavailable",
  );
  const directMp4 = { url: "/direct.mp4", mime_type: "video/mp4", label: "Direct" };
  assert.strictEqual(
    playbackUrl({ ...legacyScene, sceneStreams: [...legacyScene.sceneStreams, directMp4] }),
    directMp4.url,
    "compatible direct MP4 streams avoid unnecessary transcoding",
  );
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

  assert.strictEqual(settings.autoPlayTopScenes, false);
  assert.strictEqual(
    plugin.testing.serializedSettings(plugin.algorithms.settingsFromConfiguration({ autoPlayTopScenes: true }))
      .autoPlayTopScenes,
    true,
  );

  response = () => Promise.resolve(data);
  calls.length = 0; // Ignore the initial full-cohort query used by overall sorting.
  const manual = card(false);
  const previewIds = [];
  manual.props.onSceneChange = id => previewIds.push(id);
  let tree = manual.render();
  assert.strictEqual(calls.length, 0, "default mode must not request media");
  toggle(tree);
  await flush();
  tree = manual.render();
  assert.strictEqual(video(tree).props.src, "/curated.mp4", "manual playback retains curated markers");
  assert.deepStrictEqual(previewIds, [markerScene.id], "a marker preview reports its underlying scene");
  const clip = attachPlayer(tree, { currentTime: 0, play: () => Promise.resolve() });
  video(tree).props.onLoadedMetadata({ currentTarget: clip });
  assert.strictEqual(clip.currentTime, 12);
  clip.currentTime = 18;
  video(tree).props.onTimeUpdate({ currentTarget: clip });
  assert(clip.paused);
  manual.unmount();
  assert.deepStrictEqual(previewIds, [markerScene.id, null], "unmounting withdraws the preview");

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
    assert(
      find(tree, node => node.type === "img"),
      "photo and video must coexist",
    );
    assert.strictEqual(tree.props.role, "group", "a battle card is not a voting button");
    assert(!tree.props.onClick && !tree.props.onKeyDown, "verdicts come only from the numbered scale");
    assert(!byClass(tree, "dirty-rank-photo-vote-hint"), "photos no longer offer a vote");
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
  const delayed = attachPlayer(tree, {
    duration: Infinity,
    currentTime: 0,
    play: () => Promise.reject(new Error("Blocked")),
  });
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
  response = () =>
    new Promise(done => {
      resolve = done;
    });
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
  assert(
    find(tree, node => node.type === "img"),
    "failures must leave voting photos available",
  );

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
  let loadedComponent;
  runtime.native.loadComponent = name => {
    loadedComponent = name;
    api.components.PerformerCard = nativeCard;
    return Promise.resolve(nativeCard);
  };
  await plugin.testing.loadNativePerformerCard();
  assert.strictEqual(loadedComponent, "PerformerCard", "native cards load through the hub's component loader");
  const rankedPerformer = { ...manual.props.performer, rating100: 87, favorite: true };
  const standingsProps = {
    performer: rankedPerformer,
    rank: 4,
    ranked: [rankedPerformer],
    cohort: "FEMALE",
    leaderboardId: "appearance",
    settings,
  };
  active = { slots: [], effects: [], cursor: 0 };
  const gallery = plugin.testing.LeaderboardGalleryCard(standingsProps);
  const nativeGallery = find(gallery, node => node.type === nativeCard);
  assert(nativeGallery, "gallery must use the real native component");
  assert.strictEqual(nativeGallery.props.performer, rankedPerformer);
  assert.strictEqual(nativeGallery.props.performer.rating100, 87, "DirtyRank scores must not replace Stash ratings");
  const nativeBattle = card(false);
  const battleTree = nativeBattle.render();
  assert(
    find(battleTree, node => node.type === nativeCard),
    "battles must render the native card",
  );
  const portrait = byClass(battleTree, "dirty-rank-native-portrait");
  assert(!portrait.props.onClickCapture, "native photo clicks keep Stash's own behaviour");
  assert(!byClass(battleTree, "dirty-rank-native-vote-hint"), "native photos no longer offer a vote");
  assert(!find(card(false, { hidePerformerImages: true }).render(), node => node.type === nativeCard));
  assert(!byClass(gallery, "dirty-rank-gallery-image-link"), "native mode must not duplicate the image markup");
  const podium = plugin.testing.LeaderboardPodium(standingsProps);
  assert(
    find(podium, node => node.type === nativeCard),
    "podium must use the same native card",
  );
  delete api.components.PerformerCard;
  active = { slots: [], effects: [], cursor: 0 };
  assert(
    byClass(plugin.testing.LeaderboardGalleryCard(standingsProps), "dirty-rank-gallery-image-link"),
    "older Stash builds keep the fallback card",
  );
  const hubNative = runtime.native;
  runtime.native = { loadComponent: () => Promise.reject(new Error("native card unavailable")) };
  assert.strictEqual(
    await plugin.testing.loadNativePerformerCard(),
    null,
    "an unavailable native card must keep the fallback route usable",
  );
  runtime.native = hubNative;
  response = () => Promise.resolve({ findPerformers: { performers: [rankedPerformer] } });
  await plugin.testing.queryPerformers(true);
  assert(calls.at(-1).query.includes("favorite rating100 o_counter"));
  await plugin.testing.queryPerformers();
  assert(!calls.at(-1).query.includes("favorite rating100 o_counter"), "battle queries must remain lightweight");
  const labeled = plugin.algorithms.settingsFromConfiguration({
    categories: {
      FEMALE: [
        { id: "old-a", name: "Étoile & Face" },
        { id: "old-b", name: "Etoile Face" },
        { id: "old-c", name: "Étoile--Face" },
        { name: "Overall" },
      ],
    },
  });
  assert.strictEqual(
    labeled.categoriesByCohort.FEMALE.map(category => category.id).join(","),
    "etoile-face,etoile-face-1,etoile-face-2,overall-1",
  );
  assert.strictEqual(
    plugin.testing.leaderboardStatPath(labeled.categoriesByCohort.FEMALE[1].id),
    "/plugins/dirty-rank-leaderboards/etoile-face-1",
  );
  await verifyLeaderboardDisplays();
  await verifyBattleScreen();
  await verifySettingsFieldValidation();
  await verifyLeaderboardPresentationSettings();
  await verifyRatingParameters();
  await verifyCategoryResets();
  await verifyNavigationSettings();
  await verifyNamedGenderBoxes();
  await verifySettingsTabs();
  console.log("DirtyRank media and leaderboard behavior tests passed");
}

async function verifySettingsTabs() {
  const originalRunOperation = runtime.runPluginOperation;
  const configuration = {
    categories: {
      FEMALE: [
        { name: "Face", weight: 3 },
        { name: "Body", weight: 1 },
        { name: "Voice", weight: 5, enabled: false },
      ],
    },
  };
  runtime.runPluginOperation = (pluginId, args) =>
    args.mode === "getSettings"
      ? Promise.resolve({ revision: 0, settings: configuration })
      : originalRunOperation(pluginId, args);
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
    const tabs = ["categories", "battles", "leaderboards", "boxes", "advanced"];
    const hidden = () =>
      tabs.map(id => find(tree, node => node.props.id === "dirty-rank-settings-panel-" + id).props.hidden);
    assert.deepStrictEqual(
      hidden(),
      [false, true, true, true, true],
      "Categories opens first; other tabs stay mounted",
    );
    assert.deepStrictEqual(
      findAll(tree, node => node.props.className === "dirty-rank-category-share").map(node => visibleText(node).trim()),
      ["75%", "25%", "—"],
      "each enabled category shows its share of the overall weight",
    );
    find(tree, node => typeof node.type === "function" && node.type.name === "SettingsTabs").props.onSelect("advanced");
    tree = render();
    assert.deepStrictEqual(hidden(), [true, true, true, true, false]);
    find(
      tree,
      node =>
        typeof node.type === "function" &&
        node.type.name === "RankButton" &&
        visibleText(node).trim() === "Edit categories",
    ).props.onClick();
    tree = render();
    assert.deepStrictEqual(hidden(), [false, true, true, true, true], "Edit categories returns to the Categories tab");
  } finally {
    state.slots.forEach(slot => {
      if (slot && slot.cleanup) slot.cleanup();
    });
    runtime.runPluginOperation = originalRunOperation;
    timers.clear();
  }
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
    find(tree, node => node.props.id === "dirty-rank-confidence-goal" && node.type === "select").props.onChange({
      target: { value: "top" },
    });
    tree = render();
    const topInput = find(tree, node => node.props.id === "dirty-rank-confidence-top-n" && node.type === "input");
    topInput.props.onChange({ target: { value: "" } });
    tree = render();
    assert.strictEqual(
      find(tree, node => node.props.id === "dirty-rank-confidence-top-n" && node.type === "input").props.value,
      "",
      "clearing top N must leave the invalid draft visible",
    );
    assert.match(
      find(tree, node => node.props.id === "dirty-rank-confidence-top-n" && node.props.label).props.error,
      /whole number/,
    );
    assert.strictEqual(timers.size, 0, "invalid settings must not schedule an automatic save");

    const weightId = "dirty-rank-category-weight-FEMALE-0";
    find(tree, node => node.props.id === weightId && node.type === "input").props.onChange({ target: { value: "" } });
    tree = render();
    assert.strictEqual(find(tree, node => node.props.id === weightId && node.type === "input").props.value, "");
    assert.match(find(tree, node => node.props.id === weightId && node.props.label).props.error, /weight/);
  } finally {
    state.slots.forEach(slot => {
      if (slot && slot.cleanup) slot.cleanup();
    });
    runtime.getPluginSettings = originalGetSettings;
  }
}

async function verifyRatingParameters() {
  const originalRunOperation = runtime.runPluginOperation;
  const originalResponse = response;
  let performerQueries = 0;
  response = (query, variables, signal) => {
    if (!query.includes("DirtyRankPerformers")) return originalResponse(query, variables, signal);
    performerQueries += 1;
    return Promise.resolve({
      findPerformers: {
        performers: [
          { id: "estimate-female", gender: "FEMALE", image_path: "/synthetic.svg" },
          { id: "estimate-nonbinary", gender: "NON_BINARY", image_path: "/synthetic.svg" },
          { id: "estimate-male", gender: "MALE", image_path: "/synthetic.svg" },
          { id: "estimate-no-image", gender: "FEMALE", image_path: "" },
        ],
      },
    });
  };
  const configuration = {
    hideBattleStandings: true,
    genderBoxes: [{ id: "BOX-1", name: "Mixed", genders: ["FEMALE", "NON_BINARY"] }],
    categories: { "BOX-1": [{ id: "style", name: "Style", weight: 2 }] },
    evidenceWeight: 1.7,
    initialRating: 980,
    initialDeviation: 320,
    deviationFloor: 35,
    provisionalDeviation: 95,
  };
  const saved = [];
  let holdNextSave = false;
  let completeHeldSave;
  runtime.runPluginOperation = (_pluginId, args) => {
    if (args.mode === "getSettings") return Promise.resolve({ revision: saved.length, settings: configuration });
    if (args.mode === "saveSettings") {
      assert.strictEqual(args.expectedRevision, saved.length, "parameter saves preserve serialized revisions");
      saved.push(args.settings);
      if (holdNextSave) {
        holdNextSave = false;
        const revision = saved.length;
        return new Promise(resolve => {
          completeHeldSave = () => resolve({ revision, settings: args.settings });
        });
      }
      return Promise.resolve({ revision: saved.length, settings: args.settings });
    }
    throw new Error("Editing rating parameters must not reset or rewrite rating pools: " + args.mode);
  };
  runtime.notifyConfigurationChanged = noop;
  const state = { slots: [], effects: [], cursor: 0 };
  function render() {
    active = state;
    state.cursor = 0;
    const tree = plugin.testing.DirtyRankSettings({
      configuration: { ...configuration, initialDeviation: 200 },
      plugin: {},
    });
    state.effects.splice(0).forEach(effect => effect());
    return tree;
  }
  try {
    let tree = render();
    await flush();
    tree = render();
    const field = id => find(tree, node => node.type === "input" && node.props.id === id);
    const fieldId = key => "dirty-rank-" + ({ evidenceWeight: "evidence-weight" }[key] || key);
    const edit = (key, value) => {
      field(fieldId(key)).props.onChange({ target: { value: String(value) } });
      tree = render();
    };
    const currentButton = () =>
      find(
        tree,
        node =>
          typeof node.type === "function" &&
          node.type.name === "RankButton" &&
          visibleText(node).trim() === "Undo changes",
      );
    assert(!find(tree, node => node.props && node.props["aria-label"] === "Rating presets"), "presets are gone");
    for (const retired of [
      "dirty-rank-tau",
      "dirty-rank-initialVolatility",
      "dirty-rank-repeat-window",
      "dirty-rank-calibration",
    ])
      assert(!field(retired), retired);
    assert.notStrictEqual(currentButton().props.tone, "primary");
    assert.strictEqual(currentButton().props.disabled, false);
    assert.strictEqual(saved.length, 0, "opening advanced configuration saves nothing");
    const initialPayload = plugin.testing.serializedSettings(
      plugin.algorithms.settingsFromConfiguration(configuration),
    );
    const estimateText = settings =>
      plugin.algorithms.freshCategoryBattleEstimate(2, settings).battles.toLocaleString() +
      " verdicts expected to rank 1 category for 2 performers";
    const liveEstimate = () => visibleText(byClass(tree, "dirty-rank-preset-estimate")).trim();
    assert.strictEqual(
      liveEstimate(),
      estimateText(configuration),
      "estimate includes eligible members of every gender in the selected box",
    );
    edit("evidenceWeight", 2.5);
    assert.strictEqual(liveEstimate(), estimateText({ ...configuration, evidenceWeight: 2.5 }));
    assert.strictEqual(timers.size, 1, "a parameter edit saves in one debounce operation");
    await flush();
    tree = render();
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved.at(-1).evidenceWeight, 2.5);
    for (const key of ["genderBoxes", "categories", "hideBattleStandings"]) {
      assert.strictEqual(JSON.stringify(saved.at(-1)[key]), JSON.stringify(initialPayload[key]), "keeps " + key);
    }
    assert(!("tau" in saved.at(-1)) && !("initialVolatility" in saved.at(-1)), "retired settings are not saved");
    find(tree, node => node.props.label === "Hide standings during battles").props.onChange(false);
    tree = render();
    await flush();
    tree = render();
    const beforeRestore = saved.length;
    currentButton().props.onClick();
    tree = render();
    assert.strictEqual(liveEstimate(), estimateText(configuration), "Undo changes restores the opening estimate");
    for (const key of plugin.algorithms.RATING_PARAMETER_KEYS) {
      assert.strictEqual(field(fieldId(key)).props.value, initialPayload[key], "Undo changes restores " + key);
    }
    await flush();
    tree = render();
    assert.strictEqual(saved.length, beforeRestore + 1, "Undo changes restores all parameters in one save");
    for (const key of plugin.algorithms.RATING_PARAMETER_KEYS)
      assert.strictEqual(saved.at(-1)[key], initialPayload[key]);
    assert.strictEqual(saved.at(-1).hideBattleStandings, false, "unrelated edits since opening are kept");
    edit("deviationFloor", 40);
    currentButton().props.onClick();
    tree = render();
    await flush();
    tree = render();
    assert.strictEqual(saved.length, beforeRestore + 1, "restoring before the debounce cancels the unsaved edit");
    assert.strictEqual(field(fieldId("initialDeviation")).props.value, 320, "the opening snapshot stays stable");
    const beforeHeldSave = saved.length;
    holdNextSave = true;
    edit("evidenceWeight", 0.5);
    await flush();
    tree = render();
    assert.strictEqual(saved.length, beforeHeldSave + 1, "the edit's save is in flight");
    assert.strictEqual(currentButton().props.disabled, false, "Undo changes stays available while saving");
    currentButton().props.onClick();
    tree = render();
    assert.strictEqual(field(fieldId("evidenceWeight")).props.value, 1.7, "values restore during the request");
    completeHeldSave();
    await flush();
    tree = render();
    assert.strictEqual(field(fieldId("evidenceWeight")).props.value, 1.7, "the older response cannot win");
    await flush();
    tree = render();
    assert.strictEqual(saved.length, beforeHeldSave + 2, "the restored values save after the older request");
    for (const key of plugin.algorithms.RATING_PARAMETER_KEYS)
      assert.strictEqual(saved.at(-1)[key], initialPayload[key]);
    assert.strictEqual(currentButton().props.disabled, false);
    edit("provisionalDeviation", 70);
    assert.strictEqual(
      liveEstimate(),
      estimateText({ ...configuration, provisionalDeviation: 70 }),
      "manual parameter changes recompute the estimate before saving",
    );
    assert.strictEqual(performerQueries, 1, "parameter changes reuse the loaded performer count");
  } finally {
    state.slots.forEach(slot => {
      if (slot && slot.cleanup) slot.cleanup();
    });
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
      "BOX-2": [
        { id: "appearance", name: "Appearance" },
        { id: "energy", name: "Energy", enabled: false },
      ],
    },
  };
  context.window.confirm = message => {
    prompts.push(message);
    return approve;
  };
  runtime.ui = { notify: message => notifications.push(message) };
  runtime.runPluginOperation = (_pluginId, args) => {
    if (args.mode === "getSettings") return Promise.resolve({ revision: 0, settings: configuration });
    if (args.mode === "resetPool") {
      resets.push(args);
      return new Promise(resolve => {
        finishReset = () => resolve({ reset: 3 });
      });
    }
    if (args.mode === "loadAll") {
      reloads++;
      return Promise.resolve({ states: {} });
    }
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
    find(tree, node => node.type === "select" && node.props.id === "dirty-rank-category-cohort").props.onChange({
      target: { value: "BOX-2" },
    });
    tree = render();
    assert.strictEqual(buttons().length, 2, "each category has its own reset action");
    buttons()[1].props.onClick();
    assert.strictEqual(resets.length, 0, "cancelling never calls the reset backend");
    assert(
      prompts[0].includes("Mixed box / Energy") && prompts[0].includes("battle history"),
      "confirmation describes the precise target and deleted data",
    );
    approve = true;
    buttons()[1].props.onClick();
    tree = render();
    assert(
      buttons().every(button => button.props.disabled),
      "all reset actions wait for an in-flight reset",
    );
    buttons()[0].props.onClick();
    assert.strictEqual(resets.length, 1, "busy guard prevents another reset");
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(resets[0])),
      { mode: "resetPool", categoryId: "energy", cohort: "BOX-2", confirm: "RESET" },
      "reset targets the clicked category in the edited box, not the default box",
    );
    finishReset();
    await flush();
    tree = render();
    assert.strictEqual(reloads, 1, "successful reset refreshes the rating index");
    assert(
      find(tree.props.footer, node => node.type === runtime.react.SaveStatus).props.message.includes(
        "Reset Mixed box / Energy: 3 rating(s).",
      ),
    );
    assert(notifications[0].includes("Mixed box / Energy"));
    assert(buttons().every(button => !button.props.disabled));
  } finally {
    state.slots.forEach(slot => {
      if (slot && slot.cleanup) slot.cleanup();
    });
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
    const option = label =>
      find(
        tree,
        node =>
          typeof node.type === "function" && node.type.name === "RankButton" && visibleText(node).trim() === label,
      );
    assert(
      !find(tree, node => visibleText(node).trim() === "Backup Dirty Plugins database"),
      "backup belongs in shared settings",
    );
    assert(!option("Export ratings"));
    assert(!option("Reset current pool"));
    assert.strictEqual(option("Reset ratings").props.tone, "danger");
    assert.strictEqual(select("dirty-rank-leaderboard-top-count").props.value, 3);
    const genderToggle = (gender, box = "FEMALE") =>
      find(tree, node => node.props.id === "dirty-rank-box-gender-" + box + "-" + gender);
    assert.strictEqual(genderToggle("FEMALE").props.checked, true, "legacy boxes retain their original gender");
    assert.strictEqual(genderToggle("FEMALE").props.disabled, true, "a box always has at least one gender");
    assert.strictEqual(genderToggle("MALE").props.checked, false);
    genderToggle("MALE").props.onChange(true);
    tree = render();
    assert.strictEqual(genderToggle("MALE").props.checked, true);
    assert.strictEqual(genderToggle("FEMALE").props.disabled, false);
    assert.strictEqual(
      genderToggle("FEMALE", "MALE").props.checked,
      false,
      "gender selections belong to individual boxes",
    );
    find(tree, node => node.type === "input" && node.props.id === "dirty-rank-box-name-FEMALE").props.onChange({
      target: { value: "My mixed box" },
    });
    tree = render();
    assert.strictEqual(select("dirty-rank-leaderboard-view").props.value, "gallery");
    const countInput = () =>
      find(tree, node => node.type === "input" && node.props.id === "dirty-rank-leaderboard-performer-count");
    assert.strictEqual(countInput().props.value, 18);
    assert.strictEqual(countInput().props.step, 3);
    select("dirty-rank-leaderboard-top-count").props.onChange({ target: { value: "4" } });
    tree = render();
    assert.strictEqual(countInput().props.value, 20, "changing layout rounds the total count up to its multiple");
    assert.strictEqual(countInput().props.step, 4);
    countInput().props.onChange({ target: { value: "21" } });
    tree = render();
    assert.strictEqual(countInput().props.value, "21", "invalid input remains visible for correction");
    assert.match(
      find(tree, node => node.props.id === "dirty-rank-leaderboard-performer-count" && node.props.label).props.error,
      /multiple of 4/,
    );
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
    assert.deepStrictEqual(
      scoringSelect().children.map(node => node.props.value),
      ["weighted", "power", "rating", "proven"],
    );
    assert.deepStrictEqual(
      scoringSelect().children.map(node => node.children.join("")),
      ["Simple weighted", "Power mean", "Rating strength", "Proven rating strength"],
    );
    assert(!scoringInput("overallPower"), "Simple weighted has no additional scoring control");
    scoringSelect().props.onChange({ target: { value: "power" } });
    tree = render();
    assert.strictEqual(scoringInput("overallPower").props.value, 3, "power mean starts with power 3");
    assert.strictEqual(scoringInput("overallPower").props.min, 1);
    assert.strictEqual(scoringInput("overallPower").props.max, 4);
    scoringInput("overallPower").props.onChange({ target: { value: "" } });
    tree = render();
    assert.strictEqual(timers.size, 0, "empty power input must not autosave");
    assert.match(
      find(tree, node => node.props.id === "dirty-rank-overallPower" && node.props.label).props.error,
      /Enter a number from 1 to 4/,
    );
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
    assert.strictEqual(
      savedPayload.overallPower,
      3.5,
      "power mean selection and exponent use the existing automatic save",
    );
    assert.strictEqual(savedPayload.leaderboardTopCount, 4);
    assert.strictEqual(savedPayload.leaderboardView, "table");
    assert.strictEqual(savedPayload.leaderboardPerformerCount, 24);
    assert.strictEqual(savedPayload.showBattlesInMenu, false);
    assert.strictEqual(savedPayload.showLeaderboardsInMenu, false);
    assert.strictEqual(savedPayload.hideBattleStandings, true, "sidebar preference uses the existing autosave");
    assert.deepStrictEqual(
      JSON.parse(savedPayload.genderBoxes).find(box => box.id === "FEMALE").genders,
      ["FEMALE", "MALE"],
      "multiple genders autosave in the same box",
    );
    assert.strictEqual(
      JSON.parse(savedPayload.genderBoxes).find(box => box.id === "FEMALE").name,
      "My mixed box",
      "renaming retains the stable box ID",
    );
    assert.deepStrictEqual(
      JSON.parse(savedPayload.genderBoxes).find(box => box.id === "MALE").genders,
      ["MALE"],
      "other boxes remain unchanged",
    );
    assert.strictEqual(option("Reset ratings").props.disabled, false, "category reset is available after autosave");
    assert(
      find(tree.props.footer, node => node.type === runtime.react.SaveStatus).props.message.includes(
        "Saved automatically.",
      ),
      "accepted normalized settings report Saved after the draft-hook callbacks",
    );
    option("+ Add gender box").props.onClick();
    tree = render();
    assert(
      find(tree, node => node.props["data-box-id"] === "BOX-1"),
      "new boxes have independent stable IDs",
    );
    assert.strictEqual(
      select("dirty-rank-category-cohort").props.value,
      "BOX-1",
      "adding a box selects its own categories",
    );
    const newName = find(tree, node => node.type === "input" && node.props.id === "dirty-rank-box-name-BOX-1");
    newName.props.onChange({ target: { value: "New independent box" } });
    tree = render();
    find(tree, node => node.props.id === "dirty-rank-box-gender-BOX-1-NON_BINARY").props.onChange(true);
    tree = render();
    find(tree, node => node.type === "input" && node.props.id === "dirty-rank-category-name-BOX-1-0").props.onChange({
      target: { value: "Energy" },
    });
    tree = render();
    [...timers.values()][0]();
    render();
    await flush();
    tree = render();
    const added = JSON.parse(savedPayload.genderBoxes).find(box => box.id === "BOX-1");
    assert.strictEqual(added.name, "New independent box");
    assert.deepStrictEqual(added.genders, ["FEMALE", "NON_BINARY"]);
    assert.strictEqual(
      JSON.parse(savedPayload.categories)["BOX-1"][0].name,
      "Energy",
      "each box owns its category definitions",
    );
    const editor = find(tree, node => node.props["data-box-id"] === "BOX-1");
    assert(editor, "the saved box remains in settings");
    find(
      editor,
      node =>
        typeof node.type === "function" && node.type.name === "RankButton" && visibleText(node).trim() === "Remove box",
    ).props.onClick();
    tree = render();
    assert(!find(tree, node => node.props["data-box-id"] === "BOX-1"));
    option("+ Add gender box").props.onClick();
    tree = render();
    assert(
      find(tree, node => node.props["data-box-id"] === "BOX-2"),
      "removed box IDs are never reused, protecting retained ratings",
    );
  } finally {
    state.slots.forEach(slot => {
      if (slot && slot.cleanup) slot.cleanup();
    });
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
  const configuration = {
    genderBoxes: JSON.stringify(boxes),
    defaultCohort: "BOX-1",
    categories: JSON.stringify({
      "BOX-1": [{ name: "Style" }],
      "BOX-2": [{ name: "Strength" }],
      "BOX-3": [{ name: "Energy" }],
    }),
  };
  const people = ["FEMALE", "NON_BINARY", "MALE", "MALE", "TRANSGENDER_MALE", "TRANSGENDER_FEMALE"].map(
    (gender, index) => ({
      id: "box-person-" + index,
      name: gender + " " + index,
      gender,
      image_path: "/portrait.svg",
      scene_count: 1,
    }),
  );
  const states = Object.fromEntries(
    people.map((person, index) => {
      const box = boxes.find(box => box.genders.includes(person.gender));
      const category = ["style", "strength", "energy"][boxes.indexOf(box)];
      return [
        person.id,
        {
          revision: 10001,
          pools: {
            [category + "|" + box.id]: {
              rating: 1000 + index * 10,
              deviation: 75,
              volatility: 0.06,
              matches: 8,
              wins: 4,
              losses: 4,
              draws: 0,
            },
          },
        },
      ];
    }),
  );
  runtime.getPluginSettings = () => Promise.resolve(configuration);
  runtime.runPluginOperation = (_id, args) =>
    args.mode === "loadAll" ? Promise.resolve({ revision: 10001, states }) : originalOperation(_id, args);
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
    owner.slots.forEach(slot => {
      if (slot && slot.cleanup) slot.cleanup();
    });
    owner.slots = [];
    owner.effects = [];
    timers.clear();
  }
  try {
    context.window.location.pathname = "/plugins/dirty-rank/category/style";
    context.window.location.search = "?box=BOX-1";
    renderBattle();
    await flush();
    renderBattle();
    await flush();
    renderBattle();
    let tree = renderBattle();
    const boxPicker = () => find(tree, node => node.props.id === "dirty-rank-battle-cohort");
    assert.deepStrictEqual(
      boxPicker().children.map(option => visibleText(option)),
      ["Box 1", "Box 2", "Box 3"],
    );
    for (const [index, category] of ["style", "strength", "energy"].entries()) {
      if (index) {
        boxPicker().props.onChange({ target: { value: boxes[index].id } });
        renderBattle();
        await flush();
        renderBattle();
        tree = renderBattle();
      }
      assert.strictEqual(boxPicker().props.value, boxes[index].id);
      assert.strictEqual(
        find(tree, node => node.props.id === "dirty-rank-category").props.value,
        category,
        "box selection switches its category set",
      );
      const cards = findAll(tree, node => node.type === plugin.testing.PerformerCard);
      assert.strictEqual(cards.length, 2);
      assert(
        cards.every(card => boxes[index].genders.includes(card.props.performer.gender)),
        "battle cards stay within the selected box",
      );
      assert.strictEqual(context.window.location.search, "?box=" + boxes[index].id);
      assert(
        find(tree, node => node.type === "a" && visibleText(node) === "Leaderboards").props.to.includes(
          "box=" + boxes[index].id,
        ),
        "leaderboard links preserve the box",
      );
    }
    reset();
    context.window.location.pathname = "/plugins/dirty-rank-leaderboards/style";
    context.window.location.search = "?box=BOX-1";
    renderLeaderboard();
    await flush();
    tree = renderLeaderboard();
    for (const [index, category] of ["style", "strength", "energy"].entries()) {
      if (index) {
        find(tree, node => node.type === "select" && node.props.id === "dirty-rank-leaderboard-cohort").props.onChange({
          target: { value: boxes[index].id },
        });
        tree = renderLeaderboard();
        await flush();
        tree = renderLeaderboard();
        const selector = find(tree, component("RankStatisticSelector"));
        const link = selector.type(selector.props).props.options.find(option => option.value === category).to;
        assert(link.includes("?box="), "the link keeps the selected box");
        context.window.PluginApi.libraries.ReactRouterDOM.useHistory().push(link);
        tree = renderLeaderboard();
      }
      const selector = find(tree, component("RankStatisticSelector"));
      assert.strictEqual(selector.props.value, category);
      assert.strictEqual(selector.props.categories.length, 1, "leaderboards only show the box's categories");
      const podium = find(tree, component("LeaderboardPodium"));
      assert.strictEqual(podium.props.ranked.length, 2);
      assert(
        podium.props.ranked.every(person => boxes[index].genders.includes(person.gender)),
        "standings stay within the selected box",
      );
      assert(
        find(tree, node => node.type === "a" && visibleText(node) === "Battles").props.to.includes(
          "box=" + boxes[index].id,
        ),
      );
    }
    reset();
    renderLeaderboard();
    await flush();
    tree = renderLeaderboard();
    assert.strictEqual(
      find(tree, node => node.type === "select" && node.props.id === "dirty-rank-leaderboard-cohort").props.value,
      "BOX-3",
      "a bookmarked leaderboard retains its box",
    );
  } finally {
    reset();
    runtime.getPluginSettings = originalSettings;
    runtime.runPluginOperation = originalOperation;
    response = originalResponse;
    Object.assign(context.window.location, originalLocation);
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
    for (const [battles, leaderboards] of [
      [false, true],
      [true, false],
      [false, false],
      [true, true],
    ]) {
      configuration = { showBattlesInMenu: battles, showLeaderboardsInMenu: leaderboards };
      listeners.forEach(listener => listener({ detail: { pluginId: "dirtyRank" } }));
      await flush();
      tree = render();
      assert.strictEqual(Boolean(find(tree, node => node.type === plugin.testing.DirtyRankBattleNavLink)), battles);
      assert.strictEqual(
        Boolean(find(tree, node => node.type === plugin.testing.DirtyRankLeaderboardsNavLink)),
        leaderboards,
      );
    }
  } finally {
    state.slots.forEach(slot => {
      if (slot && slot.cleanup) slot.cleanup();
    });
    runtime.getPluginSettings = originalGetSettings;
    context.window.addEventListener = originalAddListener;
    context.window.removeEventListener = originalRemoveListener;
  }
}

async function verifyMultiscreenContext(cards, render) {
  const [rightScene, leftScene, unrelatedScene] = ["42", "7", "12"].map(id => ({ id, paths: { stream: "/" + id } }));
  const multiscreen = createMultiscreenHarness({
    mode: "nav",
    path: context.window.location.pathname,
    scenes: [rightScene, leftScene, unrelatedScene],
    settings: { rows: 1, columns: 2, sceneOrder: "random" },
  });
  const [left, right] = cards.map(({ props }) => {
    const preview = card(false);
    preview.props.onSceneChange = props.onSceneChange;
    return preview;
  });
  const previousResponse = response;
  const previousDispatch = context.document.dispatchEvent;
  context.document.dispatchEvent = event => multiscreen.document.dispatchEvent(event);
  response = (query, variables, signal) => {
    if (!query.includes("DirtyRankPreferredMedia")) return previousResponse(query, variables, signal);
    const selected = variables.sceneFilter.performers.value[0] === left.props.performer.id ? leftScene : rightScene;
    return Promise.resolve({ top: { scenes: [selected] } });
  };
  multiscreen.load();
  await multiscreen.flush();
  const link = () => multiscreen.nodes(node => node.type === "NavAction")[0];
  const settle = async () => {
    render();
    for (let round = 0; round < 3; round++) await multiscreen.tick();
  };
  try {
    assert.strictEqual(link().props.label, "DirtyMultiscreen", "closed previews leave the header unscoped");
    for (const [preview, count] of [
      [right, 1],
      [left, 2],
    ]) {
      toggle(preview.render());
      await flush();
      assert(video(preview.render()), "the Rank preview has loaded");
      await settle();
      assert.strictEqual(link().props.label, `DirtyMultiscreen (${count} scenes)`);
    }
    link().props.onClick();
    assert.deepStrictEqual(JSON.parse(multiscreen.storage.get("multiscreen.launchContext")), {
      source: "plugin-list",
      kind: "scenes",
      ids: ["7", "42"],
      keepOrder: true,
      label: "DirtyRank battle",
    });
    toggle(left.render());
    left.render();
    await settle();
    assert.strictEqual(link().props.label, "DirtyMultiscreen (1 scenes)", "closing a preview removes that scene");
    toggle(right.render());
    right.render();
    await settle();
    assert.strictEqual(link().props.label, "DirtyMultiscreen", "removing the last preview withdraws the list");

    await multiscreen.path("/plugins/multiscreen");
    await multiscreen.mode("route");
    for (let round = 0; round < 3; round++) await multiscreen.tick();
    assert.deepStrictEqual(
      multiscreen.nodes(node => node.type === "native-player").map(node => node.props.scene.id),
      ["7", "42"],
      "the header opens the battle videos in left-to-right order regardless of Multiscreen's sort",
    );
  } finally {
    left.unmount();
    right.unmount();
    response = previousResponse;
    context.document.dispatchEvent = previousDispatch;
    await multiscreen.unmount();
  }
}

async function verifyBattleScreen() {
  const originalSettings = runtime.getPluginSettings;
  const originalOperation = runtime.runPluginOperation;
  const originalResponse = response;
  const originalPath = context.window.location.pathname;
  const originalSearch = context.window.location.search;
  const originalCrypto = context.window.crypto;
  let verdictCounter = 0;
  context.window.crypto = { randomUUID: () => "verdict-test-" + ++verdictCounter };
  context.window.location.pathname = "/plugins/dirty-rank";
  timers.clear();
  const performers = Array.from({ length: 4 }, (_, index) => ({
    id: "rival-" + (index + 1),
    name: "Rival " + (index + 1),
    gender: "FEMALE",
    image_path: "/portrait.svg",
    scene_count: 1,
  }));
  const states = Object.fromEntries(
    performers.map((person, index) => [
      person.id,
      {
        revision: 101,
        pools: {
          "appearance|FEMALE": {
            rating: 1000 + index * 10,
            deviation: 250,
            matches: 1,
            wins: 1,
            losses: 0,
            draws: 0,
          },
        },
      },
    ]),
  );
  const recorded = [];
  const verdictLoads = [];
  let battleConfiguration = {};
  runtime.getPluginSettings = () => Promise.resolve(battleConfiguration);
  runtime.runPluginOperation = (_pluginId, args) => {
    if (args.mode === "loadAll") return Promise.resolve({ revision: 101, states });
    if (args.mode === "loadVerdicts") {
      verdictLoads.push(args);
      return Promise.resolve({ thresholds: [0.6, 1.8, 3.2], verdicts: [] });
    }
    if (args.mode === "record" || args.mode === "undo") {
      recorded.push(args);
      const [low, high] = [args.leftId, args.rightId].sort();
      const score = args.mode === "undo" ? null : args.leftId === low ? args.score : -args.score;
      return Promise.resolve({
        left: { id: args.leftId, state: states[args.leftId] },
        right: { id: args.rightId, state: states[args.rightId] },
        verdict: [low, high, score, 0],
        thresholds: [0.6, 1.8, 3.2],
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
    const params = {
      ...routeParams,
      ...(pathDetails && pathDetails.categoryId ? { categoryId: pathDetails.categoryId } : {}),
    };
    const page = plugin.testing.DirtyRankRoute({ match: { params } });
    const tree = page && page.type(page.props);
    state.effects.splice(0).forEach(effect => effect());
    return tree;
  }
  async function mount() {
    render();
    await flush();
    render();
    await flush();
    render();
    return render();
  }
  function remount() {
    state.slots.forEach(slot => {
      if (slot && slot.cleanup) slot.cleanup();
    });
    state.slots = [];
    state.effects = [];
    return mount();
  }
  const battleCards = tree => findAll(tree, node => node.type === plugin.testing.PerformerCard);
  const actions = tree =>
    findAll(tree, node => typeof node.type === "function" && node.type.name === "RankButton").map(visibleText);
  const scaleOf = tree => find(tree, node => node.type === plugin.testing.VerdictScale);
  const stepsOf = scale =>
    findAll(scale.type(scale.props), node => typeof node.type === "function" && node.type.name === "RankButton");
  // Shortcuts follow the key's position (code); the typed letter (key) differs by layout.
  const key = (code, typed = code) =>
    documentListeners.get("keydown")({ code, key: typed, defaultPrevented: false, preventDefault: noop });
  let tree = await mount();
  assert.deepStrictEqual(
    verdictLoads.map(load => [load.categoryId, load.cohort]),
    [["appearance", "FEMALE"]],
    "a battle page loads its pool's verdicts once",
  );
  let scale = scaleOf(tree);
  assert(scale, "standard battles ask for a verdict on the seven-step scale");
  assert.deepStrictEqual(actions(tree), ["Undo"], "every battle needs a verdict: there is no tie or skip button");
  assert.strictEqual(
    visibleText(byClass(tree, "dirty-rank-hint")),
    "A S D · G · J K L or keypad 1 2 3 · 0 · 4 5 6 choose · ↓ or U undo",
  );
  assert(!find(tree, node => node.props.id === "dirty-rank-battle-mode"), "battles have a single mode");
  assert(
    battleCards(tree).every(card => !("onChoose" in card.props)),
    "photos and cards keep their own actions and never vote",
  );
  assert.strictEqual(visibleText(byClass(tree, "dirty-rank-title")), "DirtyRank");
  assert(
    byClass(tree, "dirty-rank-leaderboards-page-title"),
    "page title remains accessible while hidden from the battle toolbar",
  );
  const identity = byClass(tree, "dirty-rank-header-identity");
  const categoryPicker = find(identity, node => node.props.id === "dirty-rank-category");
  assert(
    categoryPicker && categoryPicker.type === runtime.react.StatisticSelector,
    "left-side category picker uses the leaderboard's shared dropdown",
  );
  assert.strictEqual(categoryPicker.props.ariaLabel, "Category");
  assert(
    !categoryPicker.props.options.some(option => option.value === "__overall__"),
    "battles offer categories rather than the overall leaderboard",
  );
  assert(!byClass(tree, "dirty-rank-subtitle"), "battle heading keeps only the title");
  assert(!byClass(tree, "dirty-rank-statusbar"), "idle battles have no session statistics row");
  assert(
    !find(tree, node => typeof node.type === "function" && /^(Gauntlet)?ConfidenceIndicator$/.test(node.type.name)),
    "battle page omits the confidence panel",
  );
  assert(
    visibleText(byClass(tree, "dirty-rank-refinement-estimate")).includes("4 of 4 female performers need refinement"),
    "estimate covers the entire selected cohort",
  );
  assert(visibleText(byClass(tree, "dirty-rank-refinement-estimate")).includes("more verdicts for the whole category"));
  const currentIds = battleCards(tree).map(card => card.props.performer.id);
  const refinedStates = JSON.parse(JSON.stringify(states));
  currentIds.forEach(id => {
    refinedStates[id].pools["appearance|FEMALE"].deviation = 75;
  });
  plugin.algorithms.applyRatingIndex({ revision: 102, states: refinedStates });
  tree = render();
  assert(
    visibleText(byClass(tree, "dirty-rank-refinement-estimate")).includes("2 of 4 female performers need refinement"),
    "refined current opponents do not hide other performers needing refinement",
  );
  Object.values(refinedStates).forEach(state => {
    state.pools["appearance|FEMALE"].deviation = 75;
  });
  plugin.algorithms.applyRatingIndex({ revision: 103, states: refinedStates });
  tree = render();
  assert(!byClass(tree, "dirty-rank-refinement-estimate"), "estimate hides only once the whole cohort is refined");
  refinedStates[currentIds[0]].pools["appearance|FEMALE"].deviation = 250;
  plugin.algorithms.applyRatingIndex({ revision: 104, states: refinedStates });
  tree = render();
  assert(byClass(tree, "dirty-rank-refinement-estimate"), "one provisional performer restores the estimate");
  const estimateSettings = plugin.algorithms.settingsFromConfiguration({});
  const refinedPool = { rating: 1000, deviation: 75, matches: 1 };
  assert.strictEqual(
    plugin.algorithms.precisionTier({ ...refinedPool, deviation: 40 }, estimateSettings).id,
    "excellent",
    "Excellent also counts as refined",
  );
  assert(
    plugin.algorithms.estimatedMatchesToConfidence({ ...refinedPool, matches: 0 }, 100, refinedPool, estimateSettings) >
      0,
    "unrated performers still need a verdict even below the RD threshold",
  );
  plugin.algorithms.applyRatingIndex({ revision: 105, states });
  tree = render();
  assert(
    find(tree, node => typeof node.type === "function" && node.type.name === "Leaderboard"),
    "standard battles show the sidebar leaderboard",
  );
  await verifyMultiscreenContext(battleCards(tree), render);

  // The scale: the left performer's three numbers, equal, then the right performer's three.
  tree = render();
  scale = scaleOf(tree);
  let pair = battleCards(tree).map(card => card.props.performer);
  assert.strictEqual(scale.props.leftName, pair[0].name);
  assert.strictEqual(scale.props.rightName, pair[1].name);
  assert.strictEqual(scale.props.saved, null, "a new pair has no saved verdict");
  const steps = stepsOf(scale);
  assert.deepStrictEqual(steps.map(visibleText), ["3", "2", "1", "0", "1", "2", "3"]);
  assert.strictEqual(steps[0].props.ariaLabel, pair[0].name + " is much better than " + pair[1].name);
  assert.strictEqual(steps[3].props.ariaLabel, pair[0].name + " and " + pair[1].name + " are equal");
  assert.strictEqual(steps[5].props.ariaLabel, pair[1].name + " is better than " + pair[0].name);
  assert(
    steps.every(step => step.props.pressed === undefined),
    "nothing is highlighted before a verdict",
  );
  steps[0].props.onClick();
  tree = render();
  assert.strictEqual(scaleOf(tree).props.chosen, 3, "the chosen number flashes on the scale");
  const flashing = findAll(
    scaleOf(tree).type(scaleOf(tree).props),
    node => typeof node.type === "function" && node.type.name === "RankButton",
  );
  assert.deepStrictEqual(
    flashing.map(step => step.props.className.includes("dirty-rank-verdict-chosen")),
    [true, false, false, false, false, false, false],
  );
  await flush();
  tree = render();
  assert.strictEqual(scaleOf(tree).props.chosen, null, "the flash ends by itself");
  assert.deepStrictEqual(
    [recorded.at(-1).mode, recorded.at(-1).leftId, recorded.at(-1).rightId, recorded.at(-1).score],
    ["record", pair[0].id, pair[1].id, 3],
    "the first number saves 'left much better'",
  );
  const decision = find(tree, node => node.type === plugin.testing.DecisionIndicator);
  assert.strictEqual(
    visibleText(byClass(decision.type(decision.props), "dirty-rank-decision-text")),
    pair[0].name + " is much better than " + pair[1].name,
    "the last verdict is shown in words",
  );
  const afterClick = battleCards(tree).map(card => card.props.performer.id);
  assert.notDeepStrictEqual(
    afterClick.slice().sort(),
    pair.map(person => person.id).sort(),
    "the judged pair makes way for a new one",
  );
  const before = recorded.length;
  for (const ignored of ["ArrowLeft", "ArrowRight", "ArrowUp", "KeyF", "KeyH", "Digit1", "Digit4"]) key(ignored);
  await flush();
  assert.strictEqual(recorded.length, before, "only the numbers 1 to 7 give a verdict");
  pair = battleCards(render()).map(card => card.props.performer);
  key("Numpad5", "5");
  await flush();
  assert.deepStrictEqual(
    [recorded.at(-1).leftId, recorded.at(-1).score],
    [pair[0].id, -2],
    "keypad 5 is 'right better'",
  );
  key("ArrowDown");
  await flush();
  tree = render();
  assert.strictEqual(recorded.at(-1).mode, "undo");
  assert.strictEqual(recorded.at(-1).verdictId, recorded.at(-2).verdictId, "undo reverses the last verdict");
  assert.deepStrictEqual(
    battleCards(tree).map(card => card.props.performer.id),
    pair.map(person => person.id),
    "undo shows the pair again",
  );
  // A judged pair shows its saved verdict; choosing it again keeps it.
  const chosen = [];
  const savedScale = plugin.testing.VerdictScale({
    leftName: "Ann",
    rightName: "Bea",
    saved: { score: -1, confirmations: 0 },
    onChoose: score => chosen.push(score),
  });
  const savedSteps = findAll(savedScale, node => typeof node.type === "function" && node.type.name === "RankButton");
  assert.deepStrictEqual(
    savedSteps.map(step => step.props.pressed),
    [false, false, false, false, true, false, false],
  );
  assert(savedSteps[4].props.className.includes("dirty-rank-verdict-saved"), "the saved verdict stands out");
  assert.deepStrictEqual(
    savedSteps.map(step =>
      step.props.className
        .match(/dirty-rank-verdict-(left|equal|right) dirty-rank-verdict-strength-(\d)/)
        .slice(1)
        .join(""),
    ),
    ["left3", "left2", "left1", "equal0", "right1", "right2", "right3"],
    "each step carries its side and strength for the colour gradient",
  );
  assert.strictEqual(
    visibleText(byClass(savedScale, "dirty-rank-verdict-saved-note")),
    "Saved verdict: Bea is slightly better than Ann. Choose it again to keep it, or another number to change it.",
  );
  savedSteps[4].props.onClick();
  savedSteps[6].props.onClick();
  assert.deepStrictEqual(chosen, [-1, -3]);

  find(tree, node => node.props.id === "dirty-rank-category").props.onSelect("performance");
  assert.strictEqual(context.window.location.pathname, "/plugins/dirty-rank/category/performance");
  render();
  await flush();
  render();
  tree = render();
  assert.strictEqual(
    find(tree, node => node.props.id === "dirty-rank-category").props.value,
    "performance",
    "category selection navigates to its own page",
  );
  assert.deepStrictEqual(
    { ...verdictLoads.at(-1) },
    { mode: "loadVerdicts", categoryId: "performance", cohort: "FEMALE" },
  );
  context.window.location.pathname = "/plugins/dirty-rank/category/appearance";
  render();
  await flush();
  render();
  tree = render();
  assert.strictEqual(
    find(tree, node => node.props.id === "dirty-rank-category").props.value,
    "appearance",
    "browser history restores the URL's category",
  );
  context.window.location.pathname = "/plugins/dirty-rank/category/performance";
  tree = await remount();
  assert.strictEqual(
    find(tree, node => node.props.id === "dirty-rank-category").props.value,
    "performance",
    "direct category links override the remembered category",
  );
  assert.strictEqual(battleCards(tree).length, 2);
  const encodedCategory = "face / body";
  const encodedPath = plugin.algorithms.battleCategoryPath(encodedCategory);
  assert.strictEqual(encodedPath, "/plugins/dirty-rank/category/face%20%2F%20body");
  assert.strictEqual(plugin.algorithms.battleRouteFromPath(encodedPath).categoryId, encodedCategory);
  assert.strictEqual(
    plugin.algorithms.battleRouteFromPath("/plugins/dirty-rank/category/%ZZ"),
    null,
    "malformed category URLs fail safely",
  );
  assert.strictEqual(plugin.algorithms.battleRouteFromPath("/plugins/dirty-rank/category/appearance/unknown"), null);
  routeParams = { performerId: "rival-1" };
  context.window.location.pathname = "/plugins/dirty-rank/gauntlet/rival-1";
  tree = await remount();
  const targetConfidence = find(
    tree,
    node => typeof node.type === "function" && node.type.name === "GauntletConfidenceIndicator",
  );
  assert(targetConfidence, "Gauntlet retains its target precision bar");
  assert(scaleOf(tree), "Gauntlet asks for verdicts on the same scale");
  assert.strictEqual(
    context.window.location.pathname,
    "/plugins/dirty-rank/gauntlet/rival-1/appearance",
    "Gauntlet category is also bookmarkable",
  );
  assert(!byClass(tree, "dirty-rank-refinement-estimate"), "Gauntlet uses its own target estimate without duplication");
  assert.strictEqual(targetConfidence.props.performer.id, "rival-1");
  const confidenceTree = targetConfidence.type(targetConfidence.props);
  const confidenceBar = find(confidenceTree, node => node.props.role === "progressbar");
  assert(
    confidenceBar && confidenceBar.props["aria-valuenow"] < 100,
    "provisional target shows remaining progress toward Refined",
  );
  assert(
    find(confidenceTree, node => node.type === plugin.testing.PrecisionBadge),
    "target precision tier remains visible",
  );
  for (const hideBattleStandings of [false, true]) {
    for (const mode of ["standard", "gauntlet"]) {
      battleConfiguration = { hideBattleStandings };
      routeParams = mode === "gauntlet" ? { performerId: "rival-1" } : {};
      context.window.location.pathname =
        mode === "gauntlet"
          ? "/plugins/dirty-rank/gauntlet/rival-1/appearance"
          : "/plugins/dirty-rank/category/appearance";
      tree = await remount();
      assert.strictEqual(
        Boolean(find(tree, node => typeof node.type === "function" && node.type.name === "Leaderboard")),
        !hideBattleStandings,
        "battles respect the standings preference",
      );
      assert.strictEqual(
        Boolean(byClass(tree, "dirty-rank-standings-hidden")),
        hideBattleStandings,
        "hidden sidebar frees the battle width",
      );
    }
  }
  performers[1].gender = "MALE";
  battleConfiguration = {
    genderBoxes: [
      { id: "FEMALE", name: "Shared", genders: ["FEMALE", "MALE"] },
      { id: "MALE", name: "Men", genders: ["MALE"], enabled: false },
    ],
    categories: { FEMALE: [{ name: "Appearance" }, { name: "Performance" }] },
  };
  routeParams = { performerId: "rival-2" };
  context.window.location.pathname = "/plugins/dirty-rank/gauntlet/rival-2/appearance";
  context.window.location.search = "";
  tree = await remount();
  await flush();
  render();
  tree = render();
  assert.strictEqual(
    battleCards(tree).length,
    2,
    "Gauntlet can use a mixed category even when the target's original set is disabled",
  );
  assert.strictEqual(battleCards(tree)[0].props.performer.id, "rival-2");
  assert.strictEqual(
    battleCards(tree)[1].props.performer.gender,
    "FEMALE",
    "the target can battle a different selected gender",
  );
  assert.strictEqual(context.window.location.search, "", "Gauntlet uses the default shared box");
  assert.strictEqual(
    find(tree, node => node.props.id === "dirty-rank-category").props.options.length,
    2,
    "all categories in a box use its selected genders",
  );
  assert.strictEqual(
    find(tree, node => typeof node.type === "function" && node.type.name === "GauntletConfidenceIndicator").props
      .cohort,
    "FEMALE",
  );
  tree = await remount();
  assert.strictEqual(battleCards(tree).length, 2, "a direct mixed-category Gauntlet URL survives a fresh mount");
  battleConfiguration.genderBoxes[1].enabled = true;
  tree = await remount();
  const setSelector = find(tree, node => node.props.id === "dirty-rank-battle-cohort");
  assert.strictEqual(setSelector.props.value, "FEMALE");
  setSelector.props.onChange({ target: { value: "MALE" } });
  render();
  await flush();
  render();
  tree = render();
  assert.strictEqual(context.window.location.search, "?box=MALE", "URLs preserve a non-default box");
  assert.strictEqual(find(tree, node => node.props.id === "dirty-rank-battle-cohort").props.value, "MALE");
  context.window.location.search = "";
  render();
  await flush();
  render();
  tree = render();
  assert.strictEqual(
    find(tree, node => node.props.id === "dirty-rank-battle-cohort").props.value,
    "FEMALE",
    "browser history restores the shared category pool",
  );
  assert.strictEqual(battleCards(tree).length, 2);
  assert.strictEqual(battleCards(tree)[1].props.performer.gender, "FEMALE");
  state.slots.forEach(slot => {
    if (slot && slot.cleanup) slot.cleanup();
  });
  runtime.getPluginSettings = originalSettings;
  runtime.runPluginOperation = originalOperation;
  response = originalResponse;
  context.window.location.pathname = originalPath;
  context.window.location.search = originalSearch;
  context.window.crypto = originalCrypto;
}

async function verifyLeaderboardDisplays() {
  const {
    PrecisionBadge,
    LeaderboardPodium,
    LeaderboardGallery,
    LeaderboardGalleryCard,
    LeaderboardTable,
    LeaderboardPagination,
    DirtyRankLeaderboardsRoute,
  } = plugin.testing;
  // Ratings use the viewer's locale; format expectations the same way so the test passes on any host.
  const n = value => value.toLocaleString();
  for (const [deviation, matches, tier] of [
    [350, 0, "Provisional"],
    [75, 12, "Refined"],
    [50, 20, "Excellent"],
    [75, 1, "Refined"],
  ]) {
    const badge = PrecisionBadge({ pool: { deviation, matches }, settings });
    assert.strictEqual(visibleText(badge), tier);
    assert.strictEqual(
      badge.props.title,
      `${tier} precision · RD ${deviation.toFixed(1)} · ${matches} ${matches === 1 ? "battle" : "battles"}`,
    );
    assert.strictEqual(
      plugin.testing.leaderboardRatingText({ rating: 1400, deviation, matches }, settings),
      n(1400) + (tier === "Provisional" ? "*" : ""),
      "leaderboards only mark ratings that need more comparisons",
    );
  }
  const battle = card(false);
  battle.props.reveal = true;
  battle.props.pool = { rating: 1400, deviation: 75, matches: 12 };
  const battleTree = battle.render();
  assert(!/\bRD\b|\bbattles\b/.test(visibleText(battleTree)), "battle card details belong in the confidence tooltip");
  assert(find(battleTree, node => node.type === PrecisionBadge));
  const ranked = Array.from({ length: 49 }, (_, i) => ({
    id: "rank-" + (i + 1),
    name: "Performer " + (i + 1),
    gender: "FEMALE",
    image_path: "/portrait.svg",
    scene_count: 1,
  }));
  const tooltipSettings = plugin.algorithms.settingsFromConfiguration({
    categories: {
      FEMALE: [
        { name: "Appearance", enabled: true, weight: 2 },
        { name: "Performance", enabled: true, weight: 1 },
        { name: "Ignored", enabled: false, weight: 5 },
      ],
    },
  });
  plugin.algorithms.applyRatingIndex({
    revision: 1,
    states: {
      "rank-1": {
        pools: {
          "appearance|FEMALE": { rating: 1200, deviation: 75, matches: 2, wins: 2, losses: 0, draws: 0 },
        },
      },
    },
  });
  const overallProps = {
    ranked: [ranked[0]],
    settings: tooltipSettings,
    cohort: "FEMALE",
    leaderboardId: "__overall__",
    page: 1,
    onPageChange: noop,
  };
  plugin.algorithms.setOverallReferencePerformers(ranked);
  const tooltip = `Overall: 50.0 · Simple weighted · 1/2 categories rated\nAppearance: #1 (${n(1200)}) · score 50.00\nPerformance: Unrated · score 50.00`;
  assert.strictEqual(
    find(LeaderboardPodium(overallProps), node => node.props.className === "dirty-rank-podium-rating").props.title,
    tooltip,
  );
  active = { slots: [], effects: [], cursor: 0 };
  assert.strictEqual(
    find(
      LeaderboardGalleryCard({ ...overallProps, performer: ranked[0], rank: 1 }),
      node => node.type === "strong" && node.props.title,
    ).props.title,
    tooltip,
  );
  assert.strictEqual(
    find(
      LeaderboardTable({ ...overallProps, entries: [{ performer: ranked[0], rank: 1 }] }),
      node => node.props.className === "dirty-rank-table-rating",
    ).props.title,
    tooltip,
  );
  assert.strictEqual(
    visibleText(find(LeaderboardPodium(overallProps), node => node.props.className === "dirty-rank-podium-rating")),
    "50.0*",
  );
  assert.deepStrictEqual(
    findAll(
      LeaderboardTable({ ...overallProps, entries: [{ performer: ranked[0], rank: 1 }] }),
      node => node.type === "th",
    ).map(visibleText),
    ["Rank", "Performer", "Score"],
  );
  const overallPool = plugin.algorithms.leaderboardPoolFor(ranked[0], "__overall__", "FEMALE", tooltipSettings);
  assert.strictEqual(visibleText(PrecisionBadge({ pool: overallPool, settings: tooltipSettings })), "Provisional");
  assert(
    PrecisionBadge({ pool: overallPool, settings: tooltipSettings }).props.title.includes(
      "1/2 categories rated · mean category RD",
    ),
  );
  assert.strictEqual(
    find(
      LeaderboardPodium({ ...overallProps, leaderboardId: "appearance" }),
      node => node.props.className === "dirty-rank-podium-rating",
    ).props.title,
    undefined,
    "category leaderboards keep their ordinary score without an overall breakdown",
  );
  const rankStates = {
    "rank-1": {
      pools: {
        "appearance|FEMALE": { rating: 1200, deviation: 75, matches: 2 },
      },
    },
    "rank-2": {
      pools: {
        "appearance|FEMALE": { rating: 1600, deviation: 75, matches: 2 },
      },
    },
    "rank-3": {
      pools: {
        "appearance|FEMALE": { rating: 1200, deviation: 75, matches: 2 },
      },
    },
    "no-image": {
      pools: {
        "appearance|FEMALE": { rating: 1800, deviation: 75, matches: 2 },
      },
    },
  };
  plugin.algorithms.setOverallReferencePerformers(
    ranked.concat([{ id: "no-image", gender: "FEMALE", image_path: "" }]),
  );
  plugin.algorithms.applyRatingIndex({ revision: 2, states: rankStates });
  const rankTitle = (performer, options = {}) =>
    find(
      LeaderboardPodium({ ...overallProps, ...options, ranked: [performer] }),
      node => node.props.className === "dirty-rank-podium-rating",
    ).props.title;
  assert(
    rankTitle(ranked[0]).includes(`Appearance: #2 (${n(1200)})`),
    "tooltip rank must use the full category leaderboard, not the visible subset",
  );
  assert(
    rankTitle(ranked[2]).includes(`Appearance: #3 (${n(1200)})`),
    "equal ratings must retain the category leaderboard's displayed positions",
  );
  assert(
    rankTitle(ranked[0], { settings: { ...tooltipSettings, includePerformersWithoutImages: true } }).includes(
      `Appearance: #3 (${n(1200)})`,
    ),
    "tooltip positions must follow the leaderboard's image eligibility setting",
  );
  rankStates["rank-1"].pools["appearance|FEMALE"].rating = 1900;
  plugin.algorithms.applyRatingIndex({ revision: 3, states: rankStates });
  assert(
    rankTitle(ranked[0]).includes(`Appearance: #1 (${n(1900)})`),
    "rating updates must invalidate cached tooltip positions",
  );
  const props = { ranked, settings, cohort: "FEMALE", leaderboardId: "appearance", page: 1, onPageChange: noop };
  const articleIds = tree => findAll(tree, node => node.type === "article").map(node => node.props.key);
  for (const topCount of [3, 4, 5]) {
    const podium = LeaderboardPodium({ ...props, topCount });
    const expectedIds = ranked.slice(0, topCount).map(performer => performer.id);
    assert.deepStrictEqual(articleIds(podium).sort(), expectedIds.sort());
    assert.strictEqual(podium.props["aria-label"], { 3: "Podium", 4: "Mount Rushmore", 5: "Fingers" }[topCount]);
    assert(!find(podium, node => node.type === "header"), "featured cards must have no decorative header");
    assert(
      !/\bScore\b|\/100|\bRD\b|\bbattles\b|Refined|Excellent|Provisional/.test(visibleText(podium)),
      "featured cards keep rank and score without extra labels",
    );
    assert.strictEqual(findAll(podium, node => node.type === PrecisionBadge).length, 0);
    findAll(podium, node => node.props.className === "dirty-rank-leaderboard-rating-row").forEach(row => {
      assert(/^#\d+( \d+–\d+)?$/.test(visibleText(row.children[0]).trim()), "a rank, then its likely positions");
      assert(row.children[1].props.className === "dirty-rank-podium-rating", "rank and score must share a row");
    });
    assert.strictEqual(
      findAll(podium, node => node.props.className === "dirty-rank-podium-step").length,
      topCount === 3 ? 3 : 0,
    );
    if (topCount > 3)
      assert.deepStrictEqual(
        articleIds(podium),
        ranked.slice(0, topCount).map(performer => performer.id),
      );
    const totalCount = Math.ceil(18 / topCount) * topCount;
    const pageSize = totalCount - topCount;
    for (const Component of [LeaderboardGallery, LeaderboardTable]) {
      const collected = [];
      const totalPages = Math.ceil((ranked.length - topCount) / pageSize);
      for (let page = 1; page <= totalPages; page++) {
        const tree = Component({ ...props, topCount, page });
        assert(
          !find(tree, node => node.type === "h2" || (node.props.className || "").includes("dirty-rank-panel-heading")),
          "standings must have no decorative header",
        );
        const firstRank = topCount + (page - 1) * pageSize + 1;
        const lastRank = Math.min(firstRank + pageSize - 1, ranked.length);
        const expectedRanks = Array.from({ length: lastRank - firstRank + 1 }, (_, i) => firstRank + i);
        if (Component === LeaderboardGallery) {
          assert.strictEqual(
            find(tree, node => node.props.className === "dirty-rank-gallery-grid").props.style[
              "--dirty-rank-gallery-columns"
            ],
            topCount,
          );
          const cards = findAll(tree, node => node.type === LeaderboardGalleryCard);
          assert.deepStrictEqual(
            cards.map(node => node.props.rank),
            expectedRanks,
          );
          collected.push(...cards.map(node => node.props.performer.id));
        } else {
          assert.deepStrictEqual(findAll(tree, node => node.type === "th").map(visibleText), [
            "Rank",
            "Performer",
            "Rating",
          ]);
          const rows = find(tree, node => node.type === "tbody").children;
          assert.deepStrictEqual(
            rows.map(node => node.children[0].children[0]),
            expectedRanks.map(rank => "#" + rank),
          );
          collected.push(...rows.map(node => node.props.key));
        }
        const pagination = find(tree, node => node.type === LeaderboardPagination).props;
        assert.strictEqual(pagination.firstRank, firstRank);
        assert.strictEqual(pagination.lastRank, lastRank);
        assert.strictEqual(pagination.totalPages, totalPages);
      }
      assert.deepStrictEqual(
        collected,
        ranked.slice(topCount).map(performer => performer.id),
        "standings must not duplicate or omit anyone",
      );
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
  for (const [topCount, totalCount] of [
    [3, 12],
    [4, 20],
    [5, 30],
  ]) {
    const pageSettings = plugin.algorithms.settingsFromConfiguration({
      leaderboardTopCount: topCount,
      leaderboardPerformerCount: totalCount,
    });
    for (const Component of [LeaderboardGallery, LeaderboardTable]) {
      const countEntries = tree =>
        Component === LeaderboardGallery
          ? findAll(tree, node => node.type === LeaderboardGalleryCard).length
          : find(tree, node => node.type === "tbody").children.length;
      const pageProps = { ...props, settings: pageSettings, topCount };
      assert.strictEqual(
        countEntries(Component(pageProps)) + articleIds(LeaderboardPodium(pageProps)).length,
        totalCount,
        "configured counts include featured performers in both views",
      );
      const filtered = Component({
        ...pageProps,
        entries: ranked.map((performer, i) => ({ performer, rank: i + 1 })),
        showFeatured: false,
      });
      assert.strictEqual(
        countEntries(filtered),
        totalCount,
        "filters use the whole page budget when the featured top is hidden",
      );
    }
  }
  assert.deepStrictEqual(
    articleIds(LeaderboardPodium(props)),
    ["rank-2", "rank-1", "rank-3"],
    "default podium retains silver/gold/bronze order",
  );
  active = { slots: [], effects: [], cursor: 0 };
  const galleryCard = LeaderboardGalleryCard({ ...props, performer: ranked[0], rank: 6 });
  assert(
    !/\bRD\b|\bbattles\b|W-L-D/.test(visibleText(galleryCard)),
    "gallery cards hide rating detail and win/loss records",
  );
  assert(!find(galleryCard, node => node.type === PrecisionBadge));
  const ratingRow = find(galleryCard, node =>
    (node.props.className || "").includes("dirty-rank-leaderboard-rating-row"),
  );
  assert.strictEqual(visibleText(ratingRow.children[0]).trim(), "#6");
  assert(ratingRow.children[1].type === "strong", "gallery score belongs beside the rank");

  let configuration = {};
  runtime.getPluginSettings = () => Promise.resolve(configuration);
  const states = Object.fromEntries(
    ranked.map((performer, i) => [
      performer.id,
      {
        pools: {
          "appearance|FEMALE": { rating: 2000 - i * 10, deviation: 50, matches: 10, wins: 10, losses: 0, draws: 0 },
        },
      },
    ]),
  );
  runtime.runPluginOperation = () => Promise.resolve({ revision: 100, states });
  let matchingIds = [];
  response = query =>
    Promise.resolve({
      findPerformers: query.includes("DirtyRankFilteredPerformerIds")
        ? { count: matchingIds.length, performers: matchingIds.map(id => ({ id })) }
        : { performers: ranked },
    });
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
  async function loaded(render) {
    for (let i = 0; i < 10; i++) {
      const tree = render();
      if (find(tree, node => node.type === LeaderboardPodium)) return tree;
      await flush();
    }
    throw new Error("Leaderboard loading/scoring did not finish");
  }
  let render = route();
  let tree = await loaded(render);
  assert.strictEqual(find(tree, node => node.type === LeaderboardPodium).props.topCount, 3);
  const header = find(
    tree,
    node => node.type === "header" && node.props.className.includes("dirty-rank-leaderboards-header"),
  );
  assert.deepStrictEqual(
    header.children[1].children
      .filter(Boolean)
      .map(node =>
        node.type === "a"
          ? visibleText(node)
          : node.type === plugin.testing.RankStatisticSelector
            ? "Statistic"
            : node.props.label || "Filter",
      ),
    ["Statistic", "Filter", "Coverage", "Confidence", "Battles", "Options"],
  );
  assert.strictEqual(
    header.children[1].children.filter(Boolean).slice(-2)[0].props.to,
    "/plugins/dirty-rank",
    "battles sit immediately before options",
  );
  assert.strictEqual(
    header.children[1].children.filter(Boolean).slice(-1)[0].props.to,
    "/plugins/dirty-plugins?plugin=dirtyRank",
    "rightmost header button opens options",
  );
  assert(find(tree, node => node.type === runtime.react.Dialog && node.props.ariaLabel === "Performer filters"));
  assert(
    find(tree, node => node.type === context.window.PluginApi.components.FilteredPerformerList),
    "the filter dialog uses Stash's native performer filters",
  );
  const filterDialog = () => find(render(), node => node.type === runtime.react.Dialog);
  const openFilter = () =>
    find(render(), node => node.type === "button" && node.props["aria-haspopup"] === "dialog").props.onClick();
  const searchBox = { tagName: "INPUT" };
  context.document.querySelector = selector =>
    selector.endsWith(".filtered-list-toolbar > .search-term-input input") ? searchBox : null;
  openFilter();
  assert.strictEqual(filterDialog().props.open, true);
  assert.strictEqual(
    filterDialog().props.initialFocusRef.current,
    searchBox,
    "opening the filter starts in the native search box",
  );
  filterDialog().props.onClose();
  const done = find(filterDialog(), node => node.type === "button" && visibleText(node) === "Done").props.ref;
  done.current = { tagName: "BUTTON" };
  context.document.querySelector = () => null;
  openFilter();
  assert.strictEqual(filterDialog().props.initialFocusRef.current, done.current, "without a search box, focus Done");
  filterDialog().props.onClose();
  done.current = null;
  delete context.document.querySelector;
  const statSelector = plugin.testing.RankStatisticSelector({
    value: "__overall__",
    label: "Overall",
    categories: [{ id: "appearance", name: "Appearance" }],
  });
  assert.strictEqual(statSelector.type, runtime.react.StatisticSelector);
  const statOption = statSelector.props.options.find(option => option.value === "appearance");
  assert.strictEqual(statOption.label, "Appearance");
  assert.strictEqual(statOption.to, plugin.testing.leaderboardStatPath("appearance"));
  assert.strictEqual(plugin.testing.leaderboardIdFromPath(statOption.to), "appearance");
  context.window.location.pathname = statOption.to;
  assert.strictEqual(plugin.testing.leaderboardIdFromPath("/plugins/dirty-rank-leaderboards"), "__overall__");
  tree = render();
  assert.strictEqual(find(tree, node => node.type === plugin.testing.RankStatisticSelector).props.value, "appearance");
  render = route();
  tree = await loaded(render);
  assert.strictEqual(
    find(tree, node => node.type === plugin.testing.RankStatisticSelector).props.value,
    "appearance",
    "a bookmarked stat opens directly",
  );
  const overallOption = plugin.testing
    .RankStatisticSelector({
      value: "appearance",
      label: "Appearance",
      categories: [{ id: "appearance", name: "Appearance" }],
    })
    .props.options.find(option => option.value === "__overall__");
  assert.strictEqual(overallOption.to, "/plugins/dirty-rank-leaderboards/overall");
  context.window.location.pathname = "/plugins/dirty-rank-leaderboards";

  configuration = { leaderboardTopCount: 5, leaderboardView: "table" };
  render = route();
  tree = await loaded(render);
  assert.strictEqual(find(tree, node => node.type === LeaderboardPodium).props.topCount, 5);
  assert.strictEqual(find(tree, node => node.type === LeaderboardTable).props.entries[0].rank, 6);
  assert(
    !find(
      header,
      node => node.props.id === "dirty-rank-leaderboard-top-count" || node.props.id === "dirty-rank-leaderboard-view",
    ),
  );
  const savedConfiguration = plugin.testing.serializedSettings(
    plugin.algorithms.settingsFromConfiguration(configuration),
  );
  assert.strictEqual(savedConfiguration.leaderboardTopCount, 5);
  assert.strictEqual(savedConfiguration.leaderboardView, "table");

  function captureFilter(findFilter, performerFilter, count) {
    const state = { slots: [], effects: [], cursor: 0 };
    active = state;
    plugin.testing.DirtyRankLeaderboardFilterCapture({
      filter: {
        makeFindFilter: () => findFilter,
        makeFilter: () => performerFilter,
        count: () => count,
      },
    });
    state.effects.splice(0).forEach(effect => effect());
  }
  render = route();
  tree = await loaded(render);
  assert(
    find(tree, node => node.type === LeaderboardPodium),
    "the featured display shows without filters",
  );
  matchingIds = ["rank-4"].concat(Array.from({ length: 10 }, (_, i) => "rank-" + (40 + i)));
  captureFilter({ q: "Performer 4" }, { tags: { value: ["7"], modifier: "INCLUDES" } }, 1);
  render();
  await flush();
  tree = render();
  assert(!find(tree, node => node.type === LeaderboardPodium), "filtering hides the global podium");
  const filteredResults = find(tree, node => node.type === LeaderboardTable);
  assert.deepStrictEqual(
    Array.from(filteredResults.props.entries, entry => entry.performer.name),
    ["Performer 4"].concat(Array.from({ length: 10 }, (_, i) => "Performer " + (40 + i))),
  );
  assert.deepStrictEqual(
    Array.from(filteredResults.props.entries, entry => entry.rank),
    [4].concat(Array.from({ length: 10 }, (_, i) => 40 + i)),
  );
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
  assert(
    find(tree, node => node.type === LeaderboardPodium),
    "clearing filters restores the featured display",
  );
  assert.strictEqual(
    find(tree, node => node.type === LeaderboardTable).props.entries[0].rank,
    6,
    "clearing filters restores standings after the five featured performers",
  );

  for (const [saved, expected] of [
    ["5", 5],
    ["6", 3],
    ["4", 4],
    ["broken", 3],
    ["7", 3],
    ["4.5", 3],
  ]) {
    configuration = { leaderboardTopCount: saved };
    render = route();
    assert.strictEqual(
      find(await loaded(render), node => node.type === LeaderboardPodium).props.topCount,
      expected,
      "saved selections should be restored or safely defaulted",
    );
  }
  const pages = [];
  response = (_query, variables) => {
    pages.push(variables.filter.page);
    const start = (variables.filter.page - 1) * 500;
    const count = Math.min(500, 501 - start);
    return Promise.resolve({
      findPerformers: {
        count: 501,
        performers: Array.from({ length: count }, (_, i) => ({ id: String(start + i + 1) })),
      },
    });
  };
  const allMatchingIds = await plugin.testing.queryLeaderboardPerformerIds({ find: {}, object: {} });
  assert.strictEqual(allMatchingIds.size, 501, "native filters include every matching performer across pages");
  assert.deepStrictEqual(pages, [1, 2]);
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
