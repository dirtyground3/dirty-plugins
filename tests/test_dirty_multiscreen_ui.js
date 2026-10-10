"use strict";
const assert = require("node:assert/strict"),
  { createMultiscreenHarness } = require("./multiscreen_harness");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
async function start(options) {
  const h = createMultiscreenHarness(options);
  h.load();
  await h.flush();
  return h;
}
async function registration() {
  const h = await start();
  assert.equal(h.routes.length, 1);
  assert.equal(h.patchNames.length, 7);
  assert.equal(h.window.__dirtyMultiscreenSettings, undefined);
  assert.equal(h.window.__dirtyMultiscreenPlaylists, undefined);
  h.load();
  assert.equal(h.routes.length, 1, "a reloaded bundle never registers twice");
  assert.equal(h.patchNames.length, 7);
  // A failed registration is logged once and never retried.
  const partial = await start({
    patch: name => {
      if (name === "PerformerList") throw Error("host installed then threw");
    },
  });
  const patchCount = partial.patchNames.length;
  partial.load();
  assert.equal(partial.patchNames.length, patchCount);
  assert.equal(partial.routes.length, 1);
  assert.equal(partial.errors.length, 1);
  assert.match(String(partial.errors[0][0]), /\[multiscreen\] registration failed/);
}
async function contextsAndCounts() {
  const h = await start({ mode: "nav" });
  const filter = {
    makeFindFilter: () => ({ sort: "title", page: 5, per_page: 24 }),
    makeFilter: () => ({ favorite: true }),
  };
  for (const [name, path, source] of [
    ["SceneList", "/scenes", "selection"],
    ["SceneMarkerList", "/scenes/markers", "marker-selection"],
    ["PerformerList", "/performers", "performer-selection"],
    ["StudioList", "/studios", "studio-selection"],
  ]) {
    await h.path(path);
    h.patches.get(name)({ filter, selectedIds: new Set(["off-page", "2"]) });
    await h.tick();
    await h.tick();
    const nav = h.nodes(node => node.type === "NavAction")[0];
    nav.props.onClick();
    assert.deepEqual(JSON.parse(h.storage.get("multiscreen.launchContext")), {
      source,
      selectedIds: ["off-page", "2"],
    });
  }
  for (const [name, path, key] of [
    ["PerformerPage", "/performers/5", "performer"],
    ["StudioPage", "/studios/6", "studio"],
  ]) {
    await h.path(path);
    h.patches.get(name)({ [key]: { id: path.split("/").pop() } });
    await h.tick();
    h.nodes(node => node.type === "NavAction")[0].props.onClick();
    assert.equal(JSON.parse(h.storage.get("multiscreen.launchContext")).source, key + "-detail");
  }
  await h.path("/scenes");
  h.patches.get("SceneList")({ filter, selectedIds: new Set() });
  await h.tick(0);
  assert.ok(h.timers.size);
  await h.tick(300);
  assert.match(h.nodes(node => node.type === "NavAction")[0].props.label, /2 scenes/);
  const countCalls = h.calls.filter(call => call.query.includes("MultiscreenSceneCount")).length;
  h.patches.get("SceneList")({ filter, selectedIds: new Set() });
  await h.tick();
  assert.equal(h.calls.filter(call => call.query.includes("MultiscreenSceneCount")).length, countCalls);
  h.nodes(node => node.type === "NavAction")[0].props.onClick();
  assert.deepEqual(JSON.parse(h.storage.get("multiscreen.launchContext")), {
    source: "filter",
    filter: { sort: "title" },
    sceneFilter: { favorite: true },
  });
  await h.unmount();
  assert.equal(h.timers.size, 0);
  await h.unmount();
}
async function playbackAndCleanup() {
  const h = await start({ capture: true });
  assert.match(h.nodes(node => node.props.className?.startsWith("ms-route"))[0].props.className, /ms-docs-capture/);
  const active = () =>
    [...h.media]
      .filter(([, pair]) => pair.video.isConnected)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, pair]) => pair);
  assert.equal(h.nodes(node => node.props.className === "ms-cell").length, 2);
  assert.equal(h.nodes(node => node.type === "native-player").length, 2);
  for (const pair of active()) {
    assert.equal(pair.player.muted(), true);
    assert.equal(pair.persist.enabled, false);
  }
  const pair = active()[0];
  pair.player.volume(0.35);
  pair.player.muted(false);
  await h.flush();
  const players = h.nodes(node => node.type === "native-player");
  assert.equal(players[0].props.initialTimestamp, 0);
  assert.equal(players[0].props.autoplay, true);
  assert.equal(players[0].props.permitLoop, false);
  players[0].props.onNext();
  await h.flush();
  assert.deepEqual(
    h.nodes(node => node.type === "native-player").map(node => node.props.scene.id),
    ["b", "a"],
  );
  assert.equal(pair.player.disposed, true);
  const next = active()[0];
  assert.equal(next.player.muted(), false, "pane audio survives advancing items");
  assert.equal(next.player.volume(), 0.35);
  h.nodes(node => node.type === "native-player")[0].props.onPrevious();
  await h.flush();
  assert.equal(h.nodes(node => node.type === "native-player")[0].props.scene.id, "a");
  const current = active();
  current[1].video.paused = true;
  h.document.hidden = true;
  h.document.emit("visibilitychange");
  assert.equal(current[0].video.paused, true);
  h.document.hidden = false;
  h.document.emit("visibilitychange");
  assert.equal(current[0].video.playCount, 1);
  assert.equal(current[1].video.playCount, 0, "user-paused videos stay paused");
  h.document.hidden = true;
  current[1].video.paused = false;
  h.grid.emit("play", { target: current[1].video });
  assert.equal(current[1].video.paused, true, "new autoplay while hidden is paused");
  h.document.hidden = false;
  h.document.emit("visibilitychange");
  assert.equal(current[1].video.playCount, 1);
  const old = current[0].player,
    ready = old.readyCallback;
  h.replacePlayer(current[0]);
  assert.equal(old.handlers.get("volumechange").size, 0);
  ready();
  assert.equal(current[0].player.muted(), false);
  const mounted = current[0].player,
    lookup = current[0].tile.querySelector;
  current[0].tile.querySelector = selector => (selector === "video-js" ? null : lookup(selector));
  h.observers.filter(observer => observer.connected).forEach(observer => observer.callback());
  assert.equal(mounted.handlers.get("volumechange").size, 0, "removed players lose their listeners before replacement");
  current[0].tile.querySelector = lookup;
  h.observers.filter(observer => observer.connected).forEach(observer => observer.callback());
  assert.equal(mounted.handlers.get("volumechange").size, 1);
  await h.unmount();
  assert.equal(h.nodes(node => node.type === "native-player").length, 0);
  assert.ok(h.observers.every(observer => !observer.connected));
  assert.equal(h.document.handlers.get("visibilitychange").size, 0);
  assert.equal(h.grid.handlers.get("play").size, 0);
  for (const item of h.media.values()) assert.equal(item.player.handlers.get("volumechange")?.size || 0, 0);
  assert.equal(h.timers.size, 0);
}
async function markersAndLoops() {
  const scenes = [{ id: "a", title: "Alpha", paths: { stream: "/a" }, files: [{ duration: 10 }] }],
    marker = { id: "m", title: "Range", seconds: 2, end_seconds: 4, primary_tag: { name: "Test" }, scene: scenes[0] };
  const h = await start({
    scenes,
    markers: [marker],
    launch: { source: "marker-selection", selectedIds: ["m"] },
    settings: { rows: 1, columns: 1, totalScreens: 1, randomize: false, randomStart: true, loopScenes: true },
  });
  const player = h.nodes(node => node.type === "native-player")[0];
  assert.equal(player.props.initialTimestamp, 2);
  const pair = [...h.media.values()][0];
  assert.equal(pair.video.handlers.get("timeupdate").size, 1);
  pair.video.currentTime = 4;
  pair.video.emit("timeupdate");
  assert.equal(pair.video.currentTime, 2, "marker loops at explicit end");
  pair.video.currentTime = 3;
  pair.video.emit("timeupdate");
  pair.video.currentTime = 4;
  pair.video.emit("timeupdate");
  assert.equal(pair.video.currentTime, 2);
  pair.video.currentTime = 6;
  player.props.onComplete();
  assert.equal(pair.video.currentTime, 2, "native completion loops to marker start");
  await h.unmount();
  assert.equal(pair.video.handlers.get("timeupdate").size, 0);
  assert.equal(pair.player.disposed, true);
  assert.ok(h.observers.every(observer => !observer.connected));
  const advance = await start({
    scenes,
    markers: [marker, { ...marker, id: "n", title: "Fallback", seconds: 5, end_seconds: null }],
    launch: { source: "marker-selection", selectedIds: ["m", "n"] },
    settings: {
      rows: 1,
      columns: 1,
      totalScreens: 1,
      randomize: false,
      randomStart: true,
      loopScenes: false,
      markerDuration: 2,
    },
  });
  let active = [...advance.media.values()].find(value => value.video.isConnected);
  active.video.currentTime = 4;
  active.video.emit("timeupdate");
  active.video.emit("timeupdate");
  await advance.flush();
  assert.equal(
    advance.nodes(node => node.type === "native-player")[0].props.initialTimestamp,
    5,
    "one advance at the marker boundary",
  );
  active = [...advance.media.values()].find(value => value.video.isConnected);
  active.video.currentTime = 7;
  active.video.emit("timeupdate");
  await advance.flush();
  assert.equal(
    advance.nodes(node => node.type === "native-player")[0].props.initialTimestamp,
    2,
    "fallback duration advances and wraps",
  );
  await advance.unmount();
}
async function counters() {
  const pending = [],
    h = await start({
      graphql: (query, variables) => {
        if (query.includes("MultiscreenScenes"))
          return {
            findScenes: {
              count: 2,
              scenes: [
                { id: "a", paths: { stream: "/a" } },
                { id: "b", paths: { stream: "/b" } },
              ],
            },
          };
        const request = deferred();
        pending.push({ ...request, id: variables.id });
        return request.promise;
      },
    });
  const counter = () =>
    h.nodes(node => node.type === "IconButton" && node.props.ariaLabel?.startsWith("Increase O"))[0];
  counter().props.onClick();
  counter().props.onClick();
  await h.flush();
  assert.deepEqual(
    pending.map(request => request.id),
    ["a"],
  );
  let wrapper = h.nodes(node => node.props.className?.includes("ms-o-counter-dismissing"))[0];
  wrapper.props.onAnimationEnd({ target: wrapper, currentTarget: wrapper });
  await h.flush();
  assert.equal(counter(), undefined);
  pending[0].resolve();
  await h.flush();
  assert.match(h.text(), /O counters increased/);
  h.nodes(node => node.type === "native-player")[0].props.onNext();
  await h.flush();
  assert.equal(counter(), undefined, "success remains dismissed across playback");
  await h.unmount();
  const retryPending = [],
    retry = await start({
      graphql: (query, variables) => {
        if (query.includes("MultiscreenScenes"))
          return { findScenes: { count: 1, scenes: [{ id: "a", paths: { stream: "/a" } }] } };
        const request = deferred();
        retryPending.push({ ...request, id: variables.id });
        return request.promise;
      },
    });
  retry.nodes(node => node.type === "IconButton" && node.props.ariaLabel?.startsWith("Increase O"))[0].props.onClick();
  await retry.flush();
  retryPending[0].reject(Error("offline"));
  await retry.flush();
  retry.nodes(node => node.type === "IconButton" && node.props.ariaLabel?.includes("retry failed"))[0].props.onClick();
  await retry.flush();
  assert.deepEqual(
    retryPending.map(request => request.id),
    ["a", "a"],
  );
  await retry.unmount();
  retryPending[1].resolve();
  await retry.flush();
  const partialPending = [],
    partial = await start({
      settings: { rows: 1, columns: 2, totalScreens: 2, splitScenes: true, randomize: false, randomStart: false },
      graphql: (query, variables) => {
        if (query.includes("MultiscreenScenes"))
          return {
            findScenes: {
              count: 3,
              scenes: [
                { id: "a", paths: { stream: "/a" } },
                { id: "b", paths: { stream: "/b" } },
                { id: "c", paths: { stream: "/c" } },
              ],
            },
          };
        const request = deferred();
        partialPending.push({ ...request, id: variables.id });
        return request.promise;
      },
      scenes: [
        { id: "a", paths: { stream: "/a" } },
        { id: "b", paths: { stream: "/b" } },
        { id: "c", paths: { stream: "/c" } },
      ],
    });
  partial
    .nodes(node => node.type === "IconButton" && node.props.ariaLabel?.startsWith("Increase O"))[0]
    .props.onClick();
  await partial.flush();
  assert.deepEqual(
    partialPending.map(request => request.id),
    ["a", "b"],
  );
  partialPending[0].resolve();
  partialPending[1].reject(Error("offline"));
  await partial.flush();
  partial.nodes(node => node.type === "native-player")[0].props.onNext();
  await partial.flush();
  partial
    .nodes(node => node.type === "IconButton" && node.props.ariaLabel?.includes("retry failed"))[0]
    .props.onClick();
  await partial.flush();
  assert.deepEqual(
    partialPending.map(request => request.id),
    ["a", "b", "b"],
    "retry only failed original IDs after playback advances",
  );
  partialPending[2].resolve();
  await partial.flush();
  await partial.unmount();
}
async function gridsAndAsync() {
  const h = await start({
    settings: {
      rows: 1,
      columns: 2,
      totalScreens: 99,
      splitScenes: true,
      randomize: false,
      pauseWhenHidden: false,
      randomStart: false,
    },
  });
  assert.equal(h.nodes(node => node.type === "native-player").length, 2);
  assert.deepEqual(
    h.nodes(node => node.type === "native-player").map(node => node.props.scene.id),
    ["a", "b"],
  );
  assert.equal(h.document.handlers.get("visibilitychange"), undefined);
  await h.unmount();
  const settings = deferred(),
    late = await start({ loadSettings: () => settings.promise });
  await late.unmount();
  settings.resolve({});
  await late.flush();
  assert.equal(late.nativeCalls.length, 0);
  const media = deferred(),
    pending = await start({ graphql: () => media.promise });
  await pending.unmount();
  media.resolve({ findScenes: { count: 1, scenes: [{ id: "late", paths: { stream: "/late" } }] } });
  await pending.flush();
  assert.equal(pending.nativeCalls.length, 0);
  const native = deferred(),
    loader = createMultiscreenHarness();
  delete loader.window.PluginApi.components.ScenePlayer;
  loader.hub.native.loadComponent = () => native.promise;
  loader.load();
  await loader.flush();
  await loader.unmount();
  native.resolve(() => null);
  await loader.flush();
  assert.equal(loader.nativeCalls.length, 0);
  const random = createMultiscreenHarness({
    settings: { rows: 1, columns: 1, totalScreens: 1, randomize: false, randomStart: true },
  });
  require("node:vm").runInContext("Math.random=()=>.25", random.context);
  random.load();
  await random.flush();
  assert.equal(random.nodes(node => node.type === "native-player")[0].props.initialTimestamp, 2.5);
  await random.unmount();
}
async function staleCounts() {
  const request = deferred(),
    h = await start({ mode: "nav", graphql: () => request.promise }),
    filter = { makeFindFilter: () => ({ sort: "title" }), makeFilter: () => ({}) };
  h.patches.get("SceneList")({ filter, selectedIds: new Set() });
  await h.tick(0);
  await h.tick(300);
  h.patches.get("SceneList")({ filter, selectedIds: new Set(["one"]) });
  await h.tick(0);
  await h.tick(0);
  request.resolve({ findScenes: { count: 99 } });
  await h.flush();
  assert.match(h.nodes(node => node.type === "NavAction")[0].props.label, /1 scenes/);
  await h.unmount();
  assert.equal(h.timers.size, 0);
}
(async () => {
  await registration();
  await contextsAndCounts();
  await playbackAndCleanup();
  await markersAndLoops();
  await counters();
  await gridsAndAsync();
  await staleCounts();
  console.log("DirtyMultiscreen compiled registration, navigation, players, grid, counters and cleanup passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
