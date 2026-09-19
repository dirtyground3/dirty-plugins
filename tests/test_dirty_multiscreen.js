"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const noop = () => {};
const routes = [];
const patches = [];
const storedValues = new Map();

// Mirrors the shared hub implementations so normalization is tested against
// the same coercion rules the browser receives.
function clampInteger(value, fallback, min, max) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(next)));
}

function coerceBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
}

const window = {
  PluginApi: {
    React: { createElement: noop },
    GQL: {},
    libraries: {
      Bootstrap: { Button: noop },
      ReactRouterDOM: { NavLink: noop, useLocation: () => ({ pathname: "/scenes" }) },
      FontAwesomeSolid: {},
    },
    register: { route: (...args) => routes.push(args) },
    patch: {
      before: (...args) => patches.push(args),
      after: noop,
      instead: noop,
    },
  },
  DirtyPlugins: {
    graphql: (query) => {
      if (query.includes("MultiscreenPerformers")) {
        return Promise.resolve({ findPerformers: { performers: [{ id: "p1" }] } });
      }
      if (query.includes("MultiscreenStudios")) {
        return Promise.resolve({ findStudios: { studios: [{ id: "s1" }] } });
      }
      return Promise.resolve({});
    },
    values: { clampInteger, coerceBoolean },
    react: { IconButton: noop, StateView: noop },
  },
  sessionStorage: {
    getItem: (key) => (storedValues.has(key) ? storedValues.get(key) : null),
    setItem: (key, value) => storedValues.set(key, String(value)),
    removeItem: (key) => storedValues.delete(key),
  },
  location: { pathname: "/scenes" },
  setTimeout: (callback) => {
    callback();
    return 0;
  },
};

const context = vm.createContext({ window, console });
const source = fs.readFileSync(
  path.join(__dirname, "..", "plugins", "DirtyMultiscreen", "multiscreen.js"),
  "utf8"
);
vm.runInContext(source, context);

const plugin = window.__dirtyMultiscreenPlugin;
const a = plugin.algorithms;
const plain = (value) => JSON.parse(JSON.stringify(value));
const inside = (expression) => vm.runInContext(expression, context);

async function main() {
  assert.equal(plugin.route, "/plugins/multiscreen");
  assert.equal(routes.length, 1, "the bundle must register one route");
  assert.equal(patches.length, 7, "the bundle must register seven patches");

  // Stash can reload assets without reloading the page.
  vm.runInContext(source, context);
  assert.equal(routes.length, 1, "reloading the bundle must not register a second route");
  assert.equal(patches.length, 7, "reloading the bundle must not stack duplicate patches");

  const defaults = a.normalizeSettings({});
  assert.deepEqual(plain(defaults), {
    totalScreens: 4,
    rows: 2,
    columns: 2,
    randomize: true,
    splitScenes: false,
    startMuted: true,
    randomStart: true,
    loopScenes: true,
    markerDuration: 30,
    pauseWhenHidden: true,
  });
  assert.equal(a.normalizeSettings({ totalScreens: 6, rows: 2, columns: 2 }).totalScreens, 4, "tiles must not exceed rows x columns");
  assert.equal(a.normalizeSettings({ totalScreens: 99, rows: 3, columns: 3 }).totalScreens, 9);
  assert.equal(a.normalizeSettings({ totalScreens: 0, rows: 0, columns: 40 }).totalScreens, 1);
  assert.equal(a.normalizeSettings({ rows: 40 }).rows, 12);
  assert.equal(a.normalizeSettings({ markerDuration: 10000 }).markerDuration, 600);
  assert.equal(a.normalizeSettings({ randomize: "false" }).randomize, false);
  assert.equal(a.normalizeSettings({ pauseWhenHidden: "invalid" }).pauseWhenHidden, true);

  const items = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];
  const reused = a.createMultiscreenPlaylists(items, 3, false, false);
  assert.equal(reused.length, 3);
  reused.forEach((playlist) => {
    assert.deepEqual(plain(playlist.map((item) => item.id)), ["a", "b", "c", "d", "e"]);
  });
  assert.notEqual(reused[0], reused[1], "each screen must receive its own list copy");
  assert.deepEqual(items.map((item) => item.id), ["a", "b", "c", "d", "e"], "the source list must stay untouched");

  const split = a.createMultiscreenPlaylists(items, 2, false, true);
  assert.deepEqual(plain(split.map((playlist) => playlist.map((item) => item.id))), [["a", "c", "e"], ["b", "d"]]);
  assert.equal(a.createMultiscreenPlaylists([], 3, true, true).length, 3);
  assert.deepEqual(plain(a.splitMultiscreenItemsByIndex([1, 2, 3, 4, 5], 3).map((group) => group.length)), [2, 2, 1]);
  assert.deepEqual(plain(a.splitMultiscreenItemsByIndex([1, 2], 0)), []);

  inside("globalThis.__multiscreenOriginalRandom = Math.random; Math.random = () => 0;");
  assert.deepEqual(plain(a.shuffleMultiscreenItems(["a", "b", "c"])), ["b", "c", "a"]);
  const shuffledSplit = a.createMultiscreenPlaylists(items, 2, true, true);
  inside("Math.random = globalThis.__multiscreenOriginalRandom;");
  assert.deepEqual(
    plain(shuffledSplit.map((playlist) => playlist.map((item) => item.id))),
    [["b", "d", "a"], ["c", "e"]],
    "randomized splits must use the shuffled order"
  );

  const settings = a.normalizeSettings({ totalScreens: 4 });
  assert.equal(a.getSceneLimit(settings), 48);
  assert.equal(a.getSceneLimit(Object.assign({}, settings, { splitScenes: true })), 32);
  assert.equal(a.getSceneLimit(Object.assign({}, settings, { totalScreens: 30 })), 240);
  assert.equal(a.getSceneSort({ randomize: true }), "random");
  assert.equal(a.getSceneSort({ randomize: false }), "title");
  assert.deepEqual(plain(a.getPlaybackSettings(settings)), {
    startMuted: true,
    randomStart: true,
    loop: true,
    pauseWhenHidden: true,
  });

  assert.equal(a.isMultiscreenLaunchContext(null), false);
  assert.equal(a.isMultiscreenLaunchContext({}), false);
  assert.equal(a.isMultiscreenLaunchContext({ source: "selection", selectedIds: ["1"] }), true);
  assert.equal(a.isMultiscreenLaunchContext({ source: "selection", selectedIds: [] }), false);
  assert.equal(a.isMultiscreenLaunchContext({ source: "selection", selectedIds: [1] }), false);
  assert.equal(a.isMultiscreenLaunchContext({ source: "filter", filter: {}, sceneFilter: {} }), true);
  assert.equal(a.isMultiscreenLaunchContext({ source: "filter", filter: {} }), false);
  assert.equal(a.isMultiscreenLaunchContext({ source: "performer-detail", performerId: "5" }), true);
  assert.equal(a.isMultiscreenLaunchContext({ source: "performer-detail" }), false);
  assert.equal(a.isMultiscreenLaunchContext({ source: "marker-filter", filter: {}, markerFilter: {} }), true);
  assert.equal(a.isMultiscreenLaunchContext({ source: "marker-filter", filter: {} }), false);

  const streamScene = { id: "1", title: "  ", paths: { stream: "/stream/1" } };
  const fallbackScene = { id: "2", title: "Fallback", sceneStreams: [{ url: "" }, { url: "/stream/2" }] };
  const noStreamScene = { id: "3", title: "Nope", sceneStreams: [] };
  assert.equal(a.getSceneStreamUrl(streamScene), "/stream/1");
  assert.equal(
    a.getSceneStreamUrl({ paths: { stream: "/direct" }, sceneStreams: [{ url: "/fallback" }] }),
    "/direct",
    "the direct stream path must win over scene streams"
  );
  assert.equal(a.getSceneStreamUrl(fallbackScene), "/stream/2");
  assert.equal(a.getSceneStreamUrl(noStreamScene), "");
  assert.deepEqual(plain(a.getSceneItem(streamScene)), { id: "1", title: "Scene 1", scene: streamScene });
  assert.equal(a.getSceneItem(noStreamScene), null);

  const marker = {
    id: "10",
    title: "",
    seconds: 10,
    end_seconds: null,
    primary_tag: { name: "Tag" },
    scene: streamScene,
  };
  assert.deepEqual(plain(a.getMarkerItem(marker, 30)), {
    id: "marker-10",
    title: "Tag",
    playbackRange: { start: 10, end: 40 },
    scene: streamScene,
  });
  assert.deepEqual(plain(a.getMarkerItem(Object.assign({}, marker, { end_seconds: 5 }), 30).playbackRange), { start: 10, end: 40 });
  assert.deepEqual(plain(a.getMarkerItem(Object.assign({}, marker, { end_seconds: 25 }), 30).playbackRange), { start: 10, end: 25 });
  assert.equal(a.getMarkerItem(Object.assign({}, marker, { title: " Named " }), 30).title, "Named");
  assert.equal(a.getMarkerItem(Object.assign({}, marker, { scene: noStreamScene }), 30), null);

  const nonRandom = a.normalizeSettings({ randomize: false });
  assert.deepEqual(plain(a.getMarkerQueryVariables(defaults, { source: "marker-selection", selectedIds: ["1", "2"] })), {
    ids: ["1", "2"],
    filter: { page: 1, per_page: -1 },
  });
  const markerVariables = a.getMarkerQueryVariables(nonRandom, {
    source: "marker-filter",
    filter: { sort: "created_at" },
    markerFilter: { tag: "x" },
  });
  assert.deepEqual(plain(markerVariables), {
    filter: { sort: "created_at", page: 1, per_page: -1 },
    scene_marker_filter: { tag: "x" },
  });
  assert.equal(
    a.getMarkerQueryVariables(defaults, { source: "marker-filter", filter: {}, markerFilter: {} }).filter.sort,
    "random"
  );

  const selectionVariables = await a.getSceneQueryVariables(defaults, { source: "selection", selectedIds: ["3"] });
  assert.deepEqual(plain(selectionVariables), { ids: ["3"], filter: { page: 1, per_page: -1 } });

  const filterVariables = await a.getSceneQueryVariables(nonRandom, {
    source: "filter",
    filter: { sort: "created_at", page: 4, per_page: 20 },
    sceneFilter: { favorite: true },
  });
  assert.deepEqual(plain(filterVariables), {
    filter: { sort: "created_at", page: 1, per_page: -1 },
    scene_filter: { favorite: true },
  });
  assert.equal(
    (await a.getSceneQueryVariables(defaults, { source: "filter", filter: {}, sceneFilter: {} })).filter.sort,
    "random"
  );

  const defaultVariables = await a.getSceneQueryVariables(defaults, null);
  assert.deepEqual(plain(defaultVariables), {
    filter: { page: 1, per_page: a.getSceneLimit(defaults), sort: "random" },
  });

  const performerVariables = await a.getSceneQueryVariables(nonRandom, { source: "performer-detail", performerId: "7" });
  assert.equal(performerVariables.filter.sort, "title");
  assert.equal(performerVariables.filter.per_page, -1);
  assert.deepEqual(plain(performerVariables.scene_filter), {
    performers: { value: ["7"], modifier: "INCLUDES" },
  });
  const studioVariables = await a.getSceneQueryVariables(nonRandom, { source: "studio-detail", studioId: "9" });
  assert.deepEqual(plain(studioVariables.scene_filter), {
    studios: { value: ["9"], modifier: "INCLUDES", depth: 0 },
  });
  const performerFilterVariables = await a.getSceneQueryVariables(nonRandom, {
    source: "performer-filter",
    filter: { sort: "title" },
    performerFilter: {},
  });
  assert.deepEqual(plain(performerFilterVariables.scene_filter.performers.value), ["p1"]);

  const launchContext = { source: "selection", selectedIds: ["1", "2"] };
  a.storeLaunchContext(launchContext);
  assert.deepEqual(plain(a.readLaunchContext()), launchContext);
  a.storeLaunchContext(null);
  assert.equal(a.readLaunchContext(), null);
  storedValues.set("multiscreen.launchContext", "{not json");
  assert.equal(a.readLaunchContext(), null, "corrupt launch context JSON must be ignored");
  storedValues.set("multiscreen.launchContext", JSON.stringify({ source: "selection", selectedIds: [] }));
  assert.equal(a.readLaunchContext(), null, "invalid launch contexts must be ignored");

  const sceneListPatch = patches.find((patch) => patch[0] === "SceneList")[1];
  const markerListPatch = patches.find((patch) => patch[0] === "SceneMarkerList")[1];
  window.location.pathname = "/scenes";
  sceneListPatch({
    filter: {
      makeFindFilter: () => ({ page: 2, per_page: 24, sort: "title" }),
      makeFilter: () => ({ favorite: true }),
    },
    selectedIds: inside("new Set()"),
  });
  assert.deepEqual(plain(a.getLaunchContextForPath("/scenes")), {
    source: "filter",
    filter: { sort: "title" },
    sceneFilter: { favorite: true },
  });

  sceneListPatch({
    filter: {
      makeFindFilter: () => ({ page: 1, per_page: 24, sort: "title" }),
      makeFilter: () => ({}),
    },
    selectedIds: inside('new Set(["5"])'),
  });
  assert.deepEqual(plain(a.getLaunchContextForPath("/scenes")), {
    source: "selection",
    selectedIds: ["5"],
  });

  window.location.pathname = "/scenes/markers";
  markerListPatch({
    filter: {
      makeFindFilter: () => ({ page: 1, per_page: 24, sort: "title" }),
      makeFilter: () => ({}),
    },
    selectedIds: inside("new Set()"),
  });
  const markerLaunchContext = a.getLaunchContextForPath("/scenes/markers");
  assert.deepEqual(plain(markerLaunchContext), {
    source: "marker-filter",
    filter: { sort: "title" },
    markerFilter: {},
  });
  assert.equal(a.isMarkerLaunchContext(markerLaunchContext), true);
  assert.equal(a.isMarkerLaunchContext({ source: "marker-selection", selectedIds: ["1"] }), true);
  assert.equal(a.isMarkerLaunchContext({ source: "selection", selectedIds: ["1"] }), false);
  assert.equal(a.getLaunchContextForPath("/performers/123"), null, "an unvisited detail page must not launch a context");

  console.log("DirtyMultiscreen settings, playlist, launch-context and registration tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
