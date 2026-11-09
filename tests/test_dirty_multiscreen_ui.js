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
  assert.equal(h.patchNames.length, 9);
  assert.equal(h.window.__dirtyMultiscreenSettings, undefined);
  assert.equal(h.window.__dirtyMultiscreenPlaylists, undefined);
  h.load();
  assert.equal(h.routes.length, 1, "a reloaded bundle never registers twice");
  assert.equal(h.patchNames.length, 9);
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
    ["TagList", "/tags", "tag-selection"],
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
    ["TagPage", "/tags/7/scenes", "tag"],
  ]) {
    await h.path(path);
    h.patches.get(name)({ [key]: { id: path.split("/")[2] } });
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
    settings: { rows: 1, columns: 1, sceneOrder: "list", randomStart: true, loopScenes: true },
  });
  const player = h.nodes(node => node.type === "native-player")[0];
  assert.equal(player.props.initialTimestamp, 0, "native startup must not seek before a playable source exists");
  const pair = [...h.media.values()][0];
  assert.equal(pair.video.currentTime, 2);
  assert.equal(pair.player.handlers.get("timeupdate").size, 1);
  pair.video.currentTime = 4;
  pair.player.emit("timeupdate");
  assert.equal(pair.video.currentTime, 2, "marker loops at explicit end");
  pair.video.currentTime = 3;
  pair.player.emit("timeupdate");
  pair.video.currentTime = 4;
  pair.player.emit("timeupdate");
  assert.equal(pair.video.currentTime, 2);
  pair.video.currentTime = 6;
  player.props.onComplete();
  assert.equal(pair.video.currentTime, 2, "native completion loops to marker start");
  // A finished video is paused, and native setTimestamp only seeks a paused player.
  pair.video.currentTime = 6;
  pair.video.paused = true;
  let playedFrom = null;
  const play = pair.player.play;
  pair.player.play = function () {
    playedFrom = pair.video.currentTime;
    return play.call(this);
  };
  player.props.onComplete();
  assert.equal(pair.video.paused, false, "a looping pane plays again after its scene ends");
  assert.equal(playedFrom, 2, "the pane seeks before playing, so no stale frame shows");
  await h.unmount();
  assert.equal(pair.player.handlers.get("timeupdate").size, 0);
  assert.equal(pair.player.disposed, true);
  assert.ok(h.observers.every(observer => !observer.connected));
  const advance = await start({
    scenes,
    markers: [marker, { ...marker, id: "n", title: "Fallback", seconds: 5, end_seconds: null }],
    launch: { source: "marker-selection", selectedIds: ["m", "n"] },
    settings: {
      rows: 1,
      columns: 1,
      sceneOrder: "list",
      randomStart: true,
      loopScenes: false,
      markerDuration: 2,
    },
  });
  let active = [...advance.media.values()].find(value => value.video.isConnected);
  active.video.currentTime = 4;
  active.player.emit("timeupdate");
  active.player.emit("timeupdate");
  await advance.flush();
  assert.equal(
    [...advance.media.values()].find(value => value.video.isConnected).video.currentTime,
    5,
    "one advance at the marker boundary",
  );
  active = [...advance.media.values()].find(value => value.video.isConnected);
  active.video.currentTime = 7;
  active.player.emit("timeupdate");
  await advance.flush();
  assert.equal(
    [...advance.media.values()].find(value => value.video.isConnected).video.currentTime,
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
      settings: { rows: 1, columns: 2, splitScenes: true, sceneOrder: "list", randomStart: false },
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
async function stablePaneSubscriptions() {
  const scenes = ["a", "b"].map(id => ({ id, title: id, paths: { stream: "/" + id }, files: [{ duration: 10 }] }));
  const markers = scenes.map((scene, index) => ({
    id: "marker-" + index,
    scene,
    title: "Marker " + index,
    seconds: 1,
    end_seconds: 4,
  }));
  const h = await start({
    scenes,
    markers,
    launch: { source: "marker-selection", selectedIds: markers.map(marker => marker.id) },
    settings: {
      rows: 1,
      columns: 2,
      sceneOrder: "list",
      splitScenes: false,
      avoidDuplicates: false,
      loopScenes: false,
    },
  });
  const panes = h.nodes(node => node.type === "native-player");
  const media = [...h.media.values()].filter(pair => pair.video.isConnected);
  const other = media[1];
  const observed = h.observers.filter(observer => observer.connected && observer.target === other.tile);
  const timeListener = [...other.player.handlers.get("timeupdate")][0];
  const volumeListener = [...other.player.handlers.get("volumechange")][0];
  const next = panes[1].props.onNext;
  const complete = panes[1].props.onComplete;
  const count = h.observers.length;
  panes[0].props.onNext();
  await h.flush();
  assert.ok(
    observed.every(observer => observer.connected),
    "advancing another pane retains its observers",
  );
  assert.equal([...other.player.handlers.get("timeupdate")][0], timeListener);
  assert.equal([...other.player.handlers.get("volumechange")][0], volumeListener);
  const fresh = h.nodes(node => node.type === "native-player");
  assert.equal(fresh[1].props.onNext, next);
  assert.equal(fresh[1].props.onComplete, complete);
  assert.equal(h.observers.length, count + 2, "only the replaced marker's two observers mount");
  other.video.currentTime = 4;
  other.player.emit("timeupdate");
  await h.flush();
  assert.equal(
    h.nodes(node => node.type === "native-player")[1].props.scene.id,
    "b",
    "retained listener uses current navigation",
  );
  await h.unmount();
  assert.ok(h.observers.every(observer => !observer.connected));
}
async function gridsAndAsync() {
  // An empty screen count fills every cell; a smaller number leaves the rest empty.
  for (const [screens, players] of [
    [undefined, 4],
    [3, 3],
  ]) {
    const grid = await start({ settings: { rows: 2, columns: 2, screens, sceneOrder: "list" } });
    assert.equal(grid.nodes(node => node.type === "native-player").length, players, String(screens));
    await grid.unmount();
  }
  const h = await start({
    settings: {
      rows: 1,
      columns: 2,
      screens: 99,
      splitScenes: true,
      sceneOrder: "list",
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
    settings: { rows: 1, columns: 1, sceneOrder: "list", randomStart: true },
  });
  require("node:vm").runInContext("Math.random=()=>.25", random.context);
  random.load();
  await random.flush();
  assert.equal(random.nodes(node => node.type === "native-player")[0].props.initialTimestamp, 0);
  assert.equal([...random.media.values()].find(value => value.video.isConnected).video.currentTime, 2.5);
  await random.unmount();
}
async function playableStartupAndTranscodeClock() {
  const scene = {
    id: "a",
    title: "Alpha",
    paths: { stream: "/a", vtt: "/a_thumbs.vtt" },
    files: [{ duration: 10 }],
    resume_time: 9,
  };
  const h = createMultiscreenHarness({
    readyState: 0,
    scenes: [scene],
    settings: { rows: 1, columns: 1, randomStart: true },
  });
  require("node:vm").runInContext("Math.random=()=>.5", h.context);
  h.load();
  await h.flush();
  const native = h.nodes(node => node.type === "native-player")[0];
  const pair = [...h.media.values()].find(value => value.video.isConnected);
  assert.equal(native.props.initialTimestamp, 0, "no timestamp is queued against the unready source");
  assert.equal(native.props.scene.resume_time, 0, "the native resume preference cannot race the requested start");
  assert.equal(scene.resume_time, 9, "shared scene data stays unchanged");
  assert.equal(native.props.scene.paths.vtt, null, "multiscreen disables native seek thumbnail previews");
  assert.equal(native.props.scene.paths.stream, "/a", "seeking and playback retain the scene stream");
  assert.equal(scene.paths.vtt, "/a_thumbs.vtt", "the regular scene player retains its seek preview source");
  assert.equal(pair.video.currentTime, 0);
  pair.player.emit("canplay");
  assert.equal(pair.video.currentTime, 0, "an unready fallback cannot consume the starting seek");
  pair.player.readyState = () => 4;
  pair.video.duration = 4;
  pair.player.emit("canplay");
  pair.player.readyState = () => 0;
  await h.flush();
  assert.equal(
    pair.video.currentTime,
    0,
    "a source reload inside canplay postpones the seek until its replacement is ready",
  );
  pair.player.readyState = () => 4;
  pair.player.emit("canplay");
  pair.video.currentTime = 0;
  await h.flush();
  assert.equal(pair.video.currentTime, 3.99, "the requested start is bounded by the playable source's duration");
  pair.video.currentTime = 1;
  pair.player.emit("canplay");
  assert.equal(pair.video.currentTime, 1, "rebuffering and quality changes do not repeat the starting seek");
  const old = pair.player;
  h.replacePlayer(pair);
  old.readyCallbacks.forEach(callback => callback());
  assert.equal(pair.video.currentTime, 0, "late ready callbacks from a replaced player cannot seek its replacement");
  pair.player.readyState = () => 4;
  pair.player.emit("canplay");
  await h.flush();
  assert.equal(pair.video.currentTime, 5, "a replacement native player receives its own playable start");
  await h.unmount();
  assert.equal(pair.player.handlers.get("canplay").size, 0);
  assert.equal(pair.player.handlers.get("timeupdate").size, 0);
  pair.player.emit("canplay");

  const leaving = await start({
    readyState: 0,
    settings: { rows: 1, columns: 1, randomStart: true },
  });
  const pending = [...leaving.media.values()].find(value => value.video.isConnected);
  pending.player.readyState = () => 4;
  pending.player.emit("canplay");
  await leaving.unmount();
  assert.equal(pending.video.currentTime, 0, "unmount cancels an initial seek queued by canplay");

  const marker = { id: "m", title: "Range", seconds: 2, end_seconds: 4, primary_tag: { name: "Test" }, scene };
  const m = await start({
    readyState: 0,
    scenes: [scene],
    markers: [marker],
    launch: { source: "marker-selection", selectedIds: ["m"] },
    settings: { rows: 1, columns: 1, randomStart: false, loopScenes: true },
  });
  const transcoded = [...m.media.values()].find(value => value.video.isConnected);
  let offset = 0;
  transcoded.player.currentTime = value => {
    if (value === undefined) return offset + transcoded.video.currentTime;
    offset = value;
    transcoded.video.currentTime = 0;
  };
  transcoded.player.readyState = () => 4;
  transcoded.player.emit("canplay");
  await m.flush();
  assert.equal(offset, 2);
  assert.equal(
    transcoded.video.currentTime,
    0,
    "transcoded media starts at zero while its scene clock includes the offset",
  );
  transcoded.video.currentTime = 1;
  transcoded.player.emit("timeupdate");
  assert.equal(transcoded.player.currentTime(), 3);
  transcoded.video.currentTime = 2;
  transcoded.player.emit("timeupdate");
  assert.equal(transcoded.player.currentTime(), 2, "marker looping uses full-scene time at the segment boundary");
  await m.unmount();
}

async function independentNativePlayerIdentities() {
  const scenes = [12, 16, 24, 20].map((duration, index) => ({
    id: String(index),
    title: `Duration ${duration}`,
    paths: { stream: `/${index}` },
    files: [{ duration }],
  }));
  const h = await start({
    scenes,
    settings: { rows: 2, columns: 2, splitScenes: true, sceneOrder: "list", randomStart: false },
  });
  const pairs = [...h.media.values()].filter(pair => pair.video.isConnected);
  const ids = pairs.map(pair => pair.player.id());
  assert.equal(new Set(ids).size, 4, "native players cannot share Stash's hardcoded ID");
  for (const { player } of pairs) {
    const registry = player.constructor.players;
    assert.equal(registry[player.id()], player);
    assert.equal(player.el().id, player.id());
    assert.equal(player.tech_.el().playerId, player.id());
    assert.equal(player.tech_.el().id, player.tech_.id_);
    assert.equal(player.tech_.options_.techId, player.tech_.id_);
    const streamingPlayer = registry[player.tech_.options_.playerId];
    assert.equal(streamingPlayer, player, "a streaming tech resolves its own player");
    assert.equal(streamingPlayer.duration(), player.duration(), "duration reads cannot use another pane's clock");
  }
  assert.deepEqual(
    pairs.map(pair => pair.player.duration()).sort((a, b) => a - b),
    [12, 16, 20, 24],
  );
  const registry = pairs[0].player.constructor.players;
  await h.unmount();
  assert.equal(Object.values(registry).filter(Boolean).length, 0, "native disposal removes all pane registrations");
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
async function sceneSearch() {
  const scenes = ["a", "b", "c"].map(id => ({ id, title: "Title " + id, paths: { stream: "/" + id } }));
  const requests = [];
  const h = await start({
    scenes,
    launch: {
      source: "filter",
      filter: { q: "session term" },
      sceneFilter: { rating100: { value: 40, modifier: "GREATER_THAN" } },
    },
    graphql: (query, variables, options) => {
      if (query.includes("MultiscreenScenes"))
        return {
          findScenes: { count: 25, scenes: variables.filter.page === 1 ? scenes.slice(0, 2) : scenes.slice(2) },
        };
      if (query.includes("MultiscreenSceneSearch")) {
        const pending = deferred();
        requests.push({ ...pending, variables, signal: options.signal });
        return pending.promise;
      }
      return {};
    },
  });
  const players = () => h.nodes(node => node.type === "native-player");
  const ids = () => players().map(player => player.props.scene.id);
  const input = () => h.nodes(node => node.type === "input" && node.props.type === "search")[0];
  const search = async text => {
    input().props.onChange({ target: { value: text } });
    await h.flush();
    await h.tick(300);
  };
  const resultButtons = () =>
    h.nodes(node => node.type === "Button" && node.props.className === "ms-scene-search-result");
  const other = [...h.media.values()].filter(pair => pair.video.isConnected)[1];
  const listener = [...other.player.handlers.get("volumechange")][0];
  h.button("Search scenes for screen 1").props.onClick();
  await h.flush();
  assert.equal(requests.length, 0, "opening search does not fetch the library");
  assert.equal(h.nodes(node => node.type === "Dialog")[0].props.ariaLabel, "Search scenes for screen 1");
  await search("  first  ");
  assert.deepEqual(JSON.parse(JSON.stringify(requests[0].variables)), {
    filter: { q: "session term", page: 1, per_page: 20, sort: "title", direction: "ASC" },
    scene_filter: {
      title: { value: "(?i)first", modifier: "MATCHES_REGEX" },
      AND: { rating100: { value: 40, modifier: "GREATER_THAN" } },
    },
  });
  assert.deepEqual(ids(), ["a", "a"], "searching leaves playback running");
  await search("second");
  assert(requests[0].signal.aborted, "changing search aborts the previous request");
  requests[1].resolve({ findScenes: { count: 21, scenes: [scenes[2], { id: "missing", title: "Unavailable" }] } });
  await h.flush();
  assert.equal(resultButtons().length, 1, "unplayable scenes are excluded from the available session videos");
  requests[0].resolve({ findScenes: { count: 1, scenes: [scenes[1]] } });
  await h.flush();
  assert.equal(resultButtons().length, 1, "late responses cannot replace the latest results");
  h.nodes(node => node.type === "Pagination")[0].props.onPageChange(2);
  await h.flush();
  assert.equal(resultButtons().length, 0, "old page cannot be selected while loading");
  await h.tick(300);
  assert.equal(requests[2].variables.filter.page, 2);
  requests[2].reject(Error("offline"));
  await h.flush();
  assert.match(h.text(), /Could not search scenes/);
  h.nodes(node => node.type === "Button" && !node.props.className)[0].props.onClick();
  await h.flush();
  await h.tick(300);
  requests[3].resolve({ findScenes: { count: 21, scenes: [scenes[2]] } });
  await h.flush();
  resultButtons()[0].props.onClick();
  await h.flush();
  assert.equal(h.nodes(node => node.type === "Dialog").length, 0);
  assert.deepEqual(ids(), ["c", "a"], "a later session result replaces only its target screen");
  assert.equal(other.player.disposed, false);
  assert.equal([...other.player.handlers.get("volumechange")][0], listener, "other screen keeps its subscriptions");
  assert.match(
    h.nodes(node => node.type === "IconButton" && node.props.ariaLabel?.startsWith("Increase O"))[0].props.ariaLabel,
    /2 visible scenes/,
  );
  players()[0].props.onNext();
  await h.flush();
  assert.deepEqual(ids(), ["a", "a"], "next wraps from the selected scene's final page");
  h.button("Search scenes for screen 2").props.onClick();
  await h.flush();
  await search("nothing");
  requests[4].resolve({ findScenes: { count: 0, scenes: [] } });
  await h.flush();
  assert.match(h.text(), /No scenes match/);
  await search("c");
  requests[5].resolve({ findScenes: { count: 1, scenes: [scenes[2]] } });
  await h.flush();
  resultButtons()[0].props.onClick();
  await h.flush();
  assert.deepEqual(ids(), ["a", "c"], "each screen has its own target");
  players()[1].props.onPrevious();
  await h.flush();
  assert.deepEqual(ids(), ["a", "b"], "previous reaches the selected scene's preceding page");
  h.button("Search scenes for screen 1").props.onClick();
  await h.flush();
  input().props.onChange({ target: { value: "cancel debounce" } });
  await h.flush();
  h.nodes(node => node.type === "Dialog")[0].props.onClose();
  await h.flush();
  assert.equal(
    [...h.timers.values()].filter(timer => timer.delay !== 5000).length,
    0,
    "closing cancels the debounce timer",
  );
  h.button("Search scenes for screen 1").props.onClick();
  await h.flush();
  await search("cancel request");
  await h.unmount();
  assert(requests[6].signal.aborted, "leaving playback aborts scene search");
  requests[6].resolve({ findScenes: { count: 1, scenes: [scenes[2]] } });
  await h.flush();
  assert.equal(h.nodes(node => node.type === "Dialog").length, 0);
  assert.equal(h.timers.size, 0);
}

async function fixedSessionSearch() {
  const scenes = Array.from({ length: 46 }, (_, index) => ({
    id: String(index),
    title: index === 0 ? "Outside the session" : `Available ${index}`,
    paths: { stream: `/${index}` },
  }));
  const h = await start({
    scenes,
    launch: { source: "selection", selectedIds: scenes.slice(1).map(scene => scene.id) },
    settings: { rows: 1, columns: 2, splitScenes: true, sceneOrder: "list" },
  });
  const results = () => h.nodes(node => node.type === "Button" && node.props.className === "ms-scene-search-result");
  const search = async value => {
    h.nodes(node => node.type === "input")[0].props.onChange({ target: { value } });
    await h.flush();
    await h.tick(300);
  };
  h.button("Search scenes for screen 1").props.onClick();
  await h.flush();
  await search("Outside");
  assert.equal(results().length, 0, "videos outside an explicit session selection are excluded");
  await search("AVAILABLE");
  assert.equal(results().length, 20);
  assert.equal(h.nodes(node => node.type === "Pagination")[0].props.totalPages, 3);
  h.nodes(node => node.type === "Pagination")[0].props.onPageChange(3);
  await h.flush();
  await h.tick(300);
  assert.equal(results().length, 5, "search includes selected videos beyond the first playback page");
  results()[4].props.onClick();
  await h.flush();
  assert.deepEqual(
    h.nodes(node => node.type === "native-player").map(node => node.props.scene.id),
    ["45", "2"],
  );
  assert.equal(h.calls.length, 1, "fixed selection searches do not query or expand the library");
  const players = () => h.nodes(node => node.type === "native-player");
  players()[0].props.onPrevious();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "43", "previous follows the searched scene's split queue");
  players()[0].props.onNext();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "45");
  players()[0].props.onNext();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "1", "the searched final page wraps correctly");
  players()[1].props.onPrevious();
  await h.flush();
  assert.equal(players()[1].props.scene.id, "44", "the other screen retains its independent position");
  h.button("Search scenes for screen 2").props.onClick();
  await h.flush();
  await search("Available 33");
  results()[0].props.onClick();
  await h.flush();
  assert.equal(players()[1].props.scene.id, "33", "a scene from another split lane is inserted in order");
  players()[1].props.onPrevious();
  await h.flush();
  assert.equal(players()[1].props.scene.id, "32");
  players()[1].props.onNext();
  await h.flush();
  assert.equal(players()[1].props.scene.id, "33", "returning across a page boundary retains the inserted scene");
  players()[1].props.onNext();
  await h.flush();
  assert.equal(players()[1].props.scene.id, "34");
  await h.unmount();

  const library = await start({
    scenes,
    graphql: (query, variables) =>
      /MultiscreenSceneSearch/.test(query)
        ? { findScenes: { count: 1, scenes: scenes.slice(45, 46) } }
        : { findScenes: { count: scenes.length, scenes: scenes.slice(1, 3) } },
  });
  library.button("Search scenes for screen 1").props.onClick();
  await library.flush();
  library.nodes(node => node.type === "input")[0].props.onChange({ target: { value: "Available 45" } });
  await library.flush();
  await library.tick(300);
  await library.flush();
  assert.doesNotMatch(library.text(), /No scenes match/, "an unscoped launch searches the whole library");
  const libraryQuery = library.calls.at(-1);
  assert.match(libraryQuery.query, /MultiscreenSceneSearch/);
  assert.deepEqual(JSON.parse(JSON.stringify(libraryQuery.variables.scene_filter)), {
    title: { value: "(?i)Available 45", modifier: "MATCHES_REGEX" },
  });
  await library.unmount();
}

async function searchDuringMarkersAndPaging() {
  const scenes = ["a", "b"].map(id => ({ id, title: id, paths: { stream: "/" + id } }));
  const marker = {
    id: "m",
    title: "Range",
    seconds: 2,
    end_seconds: 4,
    primary_tag: { name: "Test" },
    scene: scenes[0],
  };
  const h = await start({
    scenes,
    markers: [marker, { ...marker, id: "n", title: "Second range", seconds: 5, end_seconds: 7 }],
    launch: { source: "marker-selection", selectedIds: ["m", "n"] },
    settings: { rows: 1, columns: 3, splitScenes: true, sceneOrder: "list", randomStart: false },
  });
  const choose = async (label, index) => {
    h.button(label).props.onClick();
    await h.flush();
    h.nodes(node => node.type === "input")[0].props.onChange({ target: { value: "a" } });
    await h.flush();
    await h.tick(300);
    const results = h.nodes(node => node.type === "Button" && node.props.className === "ms-scene-search-result");
    assert.equal(results.length, 2, "only markers from the session are available");
    results[index].props.onClick();
    await h.flush();
  };
  assert.equal(h.nodes(node => node.type === "native-player").length, 2);
  await choose("Search scenes for screen 3", 0);
  assert.equal(
    h.nodes(node => node.type === "native-player").length,
    3,
    "an empty split pane can choose a session marker",
  );
  await choose("Search scenes for screen 1", 1);
  let player = h.nodes(node => node.type === "native-player")[0];
  assert.equal(player.props.scene.id, "a");
  assert.equal(
    [...h.media.values()].find(value => value.video.isConnected).video.currentTime,
    5,
    "choosing a session marker preserves its own range",
  );
  player.props.onPrevious();
  await h.flush();
  player = h.nodes(node => node.type === "native-player")[0];
  assert.equal(player.props.scene.id, "a");
  assert.equal(
    [...h.media.values()].find(value => value.video.isConnected).video.currentTime,
    2,
    "returning to the marker restores its range",
  );
  await h.unmount();

  const pending = deferred();
  const paged = await start({
    scenes,
    launch: { source: "filter", filter: {}, sceneFilter: {} },
    graphql: (query, variables) => {
      if (query.includes("MultiscreenSceneSearch")) return { findScenes: { count: 1, scenes: [scenes[1]] } };
      if (variables.filter.page > 1) return pending.promise;
      return { findScenes: { count: 25, scenes: [scenes[0]] } };
    },
  });
  paged.nodes(node => node.type === "native-player")[0].props.onNext();
  await paged.flush();
  assert.match(paged.text(), /Loading next page/);
  paged.button("Search scenes for screen 1").props.onClick();
  await paged.flush();
  paged.nodes(node => node.type === "input")[0].props.onChange({ target: { value: "b" } });
  await paged.flush();
  await paged.tick(300);
  paged.nodes(node => node.type === "Button" && node.props.className === "ms-scene-search-result")[0].props.onClick();
  await paged.flush();
  assert.match(paged.text(), /Finding scene in session/);
  assert.equal(paged.nodes(node => node.type === "native-player")[0].props.scene.id, "a");
  pending.resolve({ findScenes: { count: 25, scenes: [scenes[1]] } });
  await paged.flush();
  assert.equal(
    paged.nodes(node => node.type === "native-player")[0].props.scene.id,
    "b",
    "a pending queue page cannot overwrite a chosen scene",
  );
  assert.doesNotMatch(paged.text(), /Loading next page/);
  await paged.unmount();
}

async function searchedQueueNavigation() {
  const scenes = Array.from({ length: 40 }, (_, index) => ({
    id: String(index),
    title: `Video (${index})`,
    paths: { stream: `/${index}` },
  }));
  let fail = true,
    hold;
  const h = await start({
    scenes,
    launch: { source: "filter", filter: { sort: "title" }, sceneFilter: {} },
    graphql: async (query, variables) => {
      if (query.includes("MultiscreenSceneSearch")) {
        const term = variables.scene_filter.title.value.slice(4).replace(/\\/g, "");
        const matches = scenes.filter(scene => scene.title.includes(term));
        return { findScenes: { count: matches.length, scenes: matches } };
      }
      const { page, per_page: size } = variables.filter;
      if (page > 1) {
        if (hold) await hold.promise;
        if (fail) throw Error("Cannot locate scene");
      }
      return { findScenes: { count: scenes.length, scenes: scenes.slice((page - 1) * size, page * size) } };
    },
  });
  const players = () => h.nodes(node => node.type === "native-player");
  const choose = async id => {
    h.button("Search scenes for screen 1").props.onClick();
    await h.flush();
    h.nodes(node => node.type === "input")[0].props.onChange({ target: { value: `Video (${id})` } });
    await h.flush();
    await h.tick(300);
    h.nodes(node => node.type === "Button" && node.props.className === "ms-scene-search-result")[0].props.onClick();
    await h.flush();
  };
  await choose(24);
  assert.match(h.text(), /Cannot locate scene/);
  assert.equal(players()[0].props.scene.id, "0", "a failed lookup preserves the playing scene and position");
  fail = false;
  h.nodes(node => node.type === "button" && node.props.className?.includes("dirty-ui-button"))[0].props.onClick();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "24", "retry locates the original search result");
  players()[0].props.onPrevious();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "23");
  players()[0].props.onNext();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "24");
  await choose(4);
  hold = deferred();
  await choose(31);
  assert.match(h.text(), /Finding scene in session/);
  await choose(7);
  hold.resolve();
  hold = null;
  await h.flush();
  assert.equal(players()[0].props.scene.id, "7", "an older location lookup cannot replace a newer choice");
  players()[0].props.onPrevious();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "6");
  assert.equal(players()[1].props.scene.id, "0", "locating and navigation leave other panes alone");
  await h.unmount();

  const random = await start({
    scenes: scenes.slice(0, 20),
    launch: { source: "selection", selectedIds: scenes.slice(0, 20).map(scene => scene.id) },
    // Otherwise the next scene is skipped whenever the shuffle already put it on another screen.
    settings: { sceneOrder: "random", splitScenes: false, avoidDuplicates: false },
  });
  const queues = [...random.owners.values()]
    .flatMap(owner => owner.slots)
    .map(slot => slot?.state)
    .filter(state => state?.items);
  const order = queues[0].items.map(item => item.scene.id);
  random.button("Search scenes for screen 1").props.onClick();
  await random.flush();
  random.nodes(node => node.type === "input")[0].props.onChange({ target: { value: `Video (${order[5]})` } });
  await random.flush();
  await random.tick(300);
  random.nodes(node => node.type === "Button" && node.props.className === "ms-scene-search-result")[0].props.onClick();
  await random.flush();
  const first = () => random.nodes(node => node.type === "native-player")[0];
  assert.equal(first().props.scene.id, order[5]);
  first().props.onNext();
  await random.flush();
  assert.equal(first().props.scene.id, order[6], "next preserves the session's original random order");
  first().props.onPrevious();
  await random.flush();
  first().props.onPrevious();
  await random.flush();
  assert.equal(first().props.scene.id, order[4], "previous starts from the searched random position");
  await random.unmount();
}

async function performerNavigation() {
  const names = { p1: "Alex", p2: "Blair", p3: "Casey" };
  const scenes = [
    ["a", ["p1", "p2"]],
    ["b", ["p2", "p1"]],
    ["none", []],
    ["c", ["p1"]],
    ["d", ["p3"]],
    ["e", ["p1"]],
    ["outside", ["p1"]],
  ].map(([id, performers]) => ({
    id,
    title: id,
    performers: performers.map(id => ({
      id,
      name: names[id],
      image_path: id === "p3" ? null : `/performer/${id}/image`,
    })),
    paths: { stream: "/" + id },
  }));
  const h = await start({
    scenes,
    launch: { source: "selection", selectedIds: scenes.slice(0, -1).map(scene => scene.id) },
  });
  const players = () => h.nodes(node => node.type === "native-player");
  const button = name =>
    h.nodes(node => node.type === "Button" && node.props.ariaLabel === `Next scene featuring ${name} for screen 1`)[0];
  const step = async name => {
    button(name).props.onClick();
    await h.flush();
    return players()[0].props.scene.id;
  };
  const images = () => h.nodes(node => node.type === "img" && node.props.className === "ms-performer-image");
  assert.equal(images().length, 4, "both performers have portraits in each screen");
  assert.equal(images()[0].props.src, "/performer/p1/image");
  assert.equal(images()[1].props.src, "/performer/p2/image");
  assert.match(button("Blair").props.title, /Blair.*this session.*Wraps at the end.*other screens keep playing/);
  assert.equal(h.nodes(node => /Previous scene with|same first performer/.test(node.props?.ariaLabel || "")).length, 0);
  images()[0].props.onError();
  await h.flush();
  assert.equal(images().length, 3, "a failed portrait falls back without breaking navigation");
  assert(h.nodes(node => node.props?.className === "ms-performer-placeholder").length);
  assert.equal(await step("Alex"), "b", "the chosen performer can appear anywhere in the next scene's cast");
  assert.equal(await step("Alex"), "c");
  assert.equal(players()[1].props.scene.id, "a", "performer navigation leaves other screens alone");
  assert.equal(await step("Alex"), "e");
  assert.equal(await step("Alex"), "a", "next wraps without including scenes outside the session");
  assert.equal(await step("Blair"), "b", "a secondary performer has its own navigation button");
  assert.equal(await step("Blair"), "a", "navigation keeps the chosen performer when cast order changes");
  players()[0].props.onNext();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "b", "native Next still follows the ordinary queue");
  players()[0].props.onNext();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "none");
  assert.equal(button("Alex"), undefined, "a scene without performers has no performer navigation buttons");
  players()[0].props.onNext();
  await h.flush();
  assert.equal(button("Blair"), undefined, "the cast buttons update when the scene changes");
  players()[0].props.onNext();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "d");
  assert.equal(await step("Casey"), "d");
  assert.match(h.text(), /No other scenes featuring Casey/);
  await h.tick(1000);
  assert.doesNotMatch(h.text(), /No other scenes featuring/, "the message clears itself after a second");
  assert.equal(await step("Casey"), "d");
  assert.match(h.text(), /No other scenes featuring Casey/, "another click shows it again");
  players()[0].props.onNext();
  await h.flush();
  assert.doesNotMatch(h.text(), /No other scenes featuring/);
  assert.equal(h.calls.length, 1, "fixed session navigation never queries or expands the library");
  await h.unmount();

  const capture = await start({ scenes, capture: true });
  assert.equal(
    capture.nodes(node => node.type === "img" && node.props.className === "ms-performer-image").length,
    0,
    "documentation capture never loads performer photos",
  );
  assert(capture.nodes(node => node.props?.className === "ms-performer-placeholder").length);
  await capture.unmount();

  const duplicate = await start({
    scenes: [scenes[0], scenes[3]],
    settings: { rows: 1, columns: 2, sceneOrder: "list", avoidDuplicates: true },
  });
  duplicate
    .nodes(node => node.type === "Button" && node.props.ariaLabel === "Next scene featuring Alex for screen 1")[0]
    .props.onClick();
  await duplicate.flush();
  assert.deepEqual(
    duplicate.nodes(node => node.type === "native-player").map(node => node.props.scene.id),
    ["c", "c"],
    "explicit performer choices can play a matching scene that is already on another screen",
  );
  await duplicate.unmount();

  const markers = [
    ["m1", scenes[0], 2],
    ["m2", scenes[0], 5],
    ["m3", scenes[3], 8],
  ].map(([id, scene, seconds]) => ({
    id,
    scene,
    title: id,
    seconds,
    end_seconds: seconds + 1,
    primary_tag: { name: "Test" },
  }));
  const marker = await start({
    scenes,
    markers,
    launch: { source: "marker-selection", selectedIds: markers.map(marker => marker.id) },
    settings: { rows: 1, columns: 1, sceneOrder: "list", randomStart: false },
  });
  const clock = () => [...marker.media.values()].find(pair => pair.video.isConnected).video.currentTime;
  const nextMarker = () =>
    marker
      .nodes(node => node.type === "Button" && node.props.ariaLabel === "Next scene featuring Alex for screen 1")[0]
      .props.onClick();
  nextMarker();
  await marker.flush();
  assert.equal(marker.nodes(node => node.type === "native-player")[0].props.scene.id, "c");
  assert.equal(clock(), 8, "skipping other markers from the same scene preserves the destination range");
  nextMarker();
  await marker.flush();
  assert.equal(clock(), 2, "wrapping retains the matching scene's marker range");
  await marker.unmount();
}

async function performerNavigationSetting() {
  const scenes = [{ id: "a", title: "A", paths: { stream: "/a" }, performers: [{ id: "p1", name: "Alex" }] }];
  const portraits = h =>
    h.nodes(node => node.type === "Button" && /^Next scene featuring/.test(node.props.ariaLabel ?? "")).length;
  const settings = { rows: 1, columns: 1 };
  const shown = await start({ scenes, settings });
  assert.equal(portraits(shown), 1, "portraits show by default");
  await shown.unmount();
  const hidden = await start({ scenes, settings: { ...settings, showPerformerNavigation: false } });
  assert.equal(portraits(hidden), 0, "the setting removes the portraits");
  assert(hidden.button("Search scenes for screen 1"), "the rest of the header stays");
  await hidden.unmount();
}

async function pagedPerformerNavigation() {
  const scenes = Array.from({ length: 75 }, (_, index) => ({
    id: String(index),
    title: `Scene ${index}`,
    paths: { stream: "/" + index },
    performers: [{ id: [0, 3, 50, 74].includes(index) ? "p1" : index === 2 ? "unique" : "p2" }],
  }));
  let fail = false,
    hold;
  const signals = [];
  const h = await start({
    scenes,
    launch: { source: "filter", filter: { sort: "title", q: "session" }, sceneFilter: { organized: true } },
    graphql: async (query, variables, options) => {
      if (query.includes("MultiscreenPerformerScenes")) {
        if (hold) {
          signals.push(options.signal);
          await hold.promise;
        }
        if (fail) throw Error("Performer queue unavailable");
        const [performer] = variables.scene_filter.performers.value;
        const matches = scenes.filter(scene => scene.performers.some(({ id }) => id === performer));
        return { findScenes: { count: matches.length, scenes: matches } };
      }
      const { page, per_page: size } = variables.filter;
      return { findScenes: { count: scenes.length, scenes: scenes.slice((page - 1) * size, page * size) } };
    },
  });
  const players = () => h.nodes(node => node.type === "native-player");
  const button = (id = "p1") =>
    h.nodes(
      node => node.type === "Button" && node.props.ariaLabel === `Next scene featuring Performer ${id} for screen 1`,
    )[0];
  const step = async (id = "p1") => {
    button(id).props.onClick();
    await h.flush();
    return players()[0].props.scene.id;
  };
  const loaded = h.calls.length;
  assert.equal(await step(), "3");
  assert.equal(h.calls.length, loaded + 1, "one query finds the next scene");
  assert.equal(h.calls.at(-1).variables.filter.per_page, -1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.at(-1).variables.scene_filter.performers)), {
    value: ["p1"],
    modifier: "INCLUDES",
  });
  fail = true;
  assert.equal(await step(), "3", "a failed lookup keeps the playing scene and queue position");
  assert.match(h.text(), /Performer queue unavailable/);
  fail = false;
  h.nodes(node => node.type === "button" && node.props.className?.includes("dirty-ui-button"))[0].props.onClick();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "50", "retry retains the chosen performer navigation request");
  assert.equal(await step(), "74");
  assert.equal(await step(), "0", "performer navigation wraps across the whole session");
  assert(
    h.calls.slice(loaded).every(call => call.query.includes("MultiscreenPerformerScenes")),
    "performer navigation never loads a queue page",
  );
  assert.equal(await step(), "3");
  assert.equal(players()[1].props.scene.id, "0");
  hold = deferred();
  await step();
  assert.equal(players()[0].props.scene.id, "3", "the scene stays visible while finding another match");
  assert(button().props.disabled);
  assert.match(h.text(), /Finding next scene featuring this performer/);
  const pendingCalls = h.calls.length;
  button().props.onClick();
  await h.flush();
  assert.equal(h.calls.length, pendingCalls, "a pending performer navigation cannot be started twice");
  players()[0].props.onPrevious();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "2");
  hold.resolve();
  hold = null;
  await h.flush();
  assert.equal(players()[0].props.scene.id, "2", "a late performer lookup cannot overwrite newer navigation");
  assert.equal(await step("unique"), "2");
  assert.match(h.text(), /No other scenes featuring Performer unique/);
  for (const call of h.calls) {
    assert(call.variables.filter.per_page <= 240);
    assert.equal(call.variables.filter.q, "session", "every query preserves the session's text search");
    assert.equal(call.variables.filter.sort, "title", "every query preserves the session's sort");
    const scope = call.variables.scene_filter.AND ?? call.variables.scene_filter;
    assert.equal(scope.organized, true, "every query preserves all session filters");
  }
  players()[0].props.onNext();
  await h.flush();
  hold = deferred();
  await step();
  await h.unmount();
  assert(signals.at(-1).aborted, "leaving playback aborts a pending performer lookup");
  hold.resolve();
  await h.flush();
  assert.equal(players().length, 0);
}

async function performerNavigationAcrossPagesAndReopen() {
  const SESSION = "multiscreen.session";
  const scenes = Array.from({ length: 75 }, (_, index) => ({
    id: String(index),
    title: `Scene ${index}`,
    paths: { stream: "/" + index },
    performers: [{ id: [0, 50].includes(index) ? "p1" : "p2" }],
  }));
  const options = {
    scenes,
    settings: {
      rows: 1,
      columns: 1,
      sceneOrder: "list",
      randomStart: false,
      loopScenes: false,
    },
    graphql: async (query, variables) => {
      if (query.includes("MultiscreenPerformerScenes")) {
        const [performer] = variables.scene_filter.performers.value;
        const matches = scenes.filter(scene => scene.performers.some(({ id }) => id === performer));
        return { findScenes: { count: matches.length, scenes: matches } };
      }
      const { page, per_page: size } = variables.filter;
      return { findScenes: { count: scenes.length, scenes: scenes.slice((page - 1) * size, page * size) } };
    },
  };
  const playing = h => h.nodes(node => node.type === "native-player")[0].props.scene.id;
  const first = await start({ ...options, launch: { source: "filter", filter: { sort: "title" }, sceneFilter: {} } });
  first
    .nodes(
      node => node.type === "Button" && node.props.ariaLabel === "Next scene featuring Performer p1 for screen 1",
    )[0]
    .props.onClick();
  await first.flush();
  assert.equal(playing(first), "50");
  await first.tick(5000);
  assert.equal(JSON.parse(first.localStorage.get(SESSION)).panes[0].page, 1, "the queue stays on its page");
  await first.unmount();

  const reopened = await start({ ...options, localStorage: new Map(first.localStorage) });
  assert.equal(playing(reopened), "50", "reopening returns to a scene chosen from outside the saved page");
  const calls = reopened.calls.length;
  reopened.nodes(node => node.type === "native-player")[0].props.onNext();
  await reopened.flush();
  assert.equal(playing(reopened), "0", "Next continues the saved page's queue");
  assert.equal(reopened.calls.length, calls);
  await reopened.unmount();

  const moved = JSON.parse(first.localStorage.get(SESSION));
  const onPage = await start({
    ...options,
    localStorage: new Map([
      [SESSION, JSON.stringify({ ...moved, panes: [{ ...moved.panes[0], page: 7, itemId: "74", item: undefined }] })],
    ]),
  });
  assert.equal(playing(onPage), "74", "a scene on its saved page needs no stored copy");
  await onPage.unmount();
}

async function searchFocusAfterClosing() {
  const h = await start({ scenes: [{ id: "a", title: "A", paths: { stream: "/a" } }] });
  const blurred = [];
  const openAndClose = async focusRing => {
    const opener = h.button("Search scenes for screen 1");
    opener.props.buttonRef.current = { matches: () => focusRing, blur: () => blurred.push(focusRing) };
    opener.props.onClick();
    await h.flush();
    h.nodes(node => node.type === "Dialog")[0].props.onClose();
    await h.flush();
  };
  await openAndClose(true);
  assert.deepEqual(blurred, [], "keyboard users keep their place on the opener");
  await openAndClose(false);
  assert.deepEqual(blurred, [false], "a mouse user's returned focus cannot keep the header showing");
  await h.unmount();
}

async function unscopedLibraryPaging() {
  const scenes = Array.from({ length: 30 }, (_, index) => ({
    id: String(index),
    title: "Scene " + index,
    paths: { stream: "/" + index },
  }));
  const requests = [];
  const h = await start({
    scenes,
    settings: { rows: 1, columns: 1, sceneOrder: "newest" },
    graphql: async (_query, variables) => {
      requests.push(variables.filter);
      const { page, per_page: size } = variables.filter;
      return { findScenes: { count: scenes.length, scenes: scenes.slice((page - 1) * size, page * size) } };
    },
  });
  const player = () => h.nodes(node => node.type === "native-player")[0];
  const size = requests[0].per_page;
  assert.equal(requests[0].sort, "created_at");
  const seen = new Set([player().props.scene.id]);
  for (let i = 1; i < scenes.length; i++) {
    player().props.onNext();
    await h.flush();
    seen.add(player().props.scene.id);
  }
  assert(requests.length > 1 && requests.every(filter => filter.sort === "created_at"));
  assert.equal(seen.size, scenes.length, "a launch without a list context continues through the whole library");
  assert(size < scenes.length);
  await h.unmount();
}

async function avoidsDuplicateScenes() {
  const scenes = ["a", "b", "c", "d"].map(id => ({ id, title: id, paths: { stream: "/" + id } }));
  const h = await start({
    scenes,
    settings: { rows: 1, columns: 2, sceneOrder: "list", randomStart: false },
  });
  const playing = () => h.nodes(node => node.type === "native-player").map(node => node.props.scene.id);
  const pane = index => h.nodes(node => node.type === "native-player")[index].props;
  assert.deepEqual(playing(), ["a", "b"], "screens start on different scenes");
  pane(0).onNext();
  await h.flush();
  assert.deepEqual(playing(), ["c", "b"], "going forward skips the scene the other screen is playing");
  pane(0).onPrevious();
  await h.flush();
  assert.deepEqual(playing(), ["b", "b"], "going back never skips, so a scene can play on both screens");
  pane(1).onNext();
  await h.flush();
  assert.deepEqual(playing(), ["b", "a"]);
  for (const expected of ["c", "d", "b"]) {
    pane(0).onNext();
    await h.flush();
    assert.equal(playing()[0], expected, "wrapping around also skips the other screen's scene");
  }
  await h.unmount();
  const tiny = await start({
    scenes: scenes.slice(0, 1),
    settings: { rows: 1, columns: 2, sceneOrder: "list" },
  });
  assert.deepEqual(
    tiny.nodes(node => node.type === "native-player").map(node => node.props.scene.id),
    ["a", "a"],
    "a pool smaller than the grid still fills every screen",
  );
  await tiny.unmount();
  // With every other scene on a screen, Next still moves on and repeats one.
  const crowded = await start({
    scenes: scenes.slice(0, 3),
    settings: { rows: 2, columns: 2, sceneOrder: "list", randomStart: false },
  });
  const crowdedPlayers = () => crowded.nodes(node => node.type === "native-player");
  const crowdedPlaying = () => crowdedPlayers().map(node => node.props.scene.id);
  assert.deepEqual(crowdedPlaying(), ["a", "b", "c", "a"]);
  crowdedPlayers()[0].props.onNext();
  await crowded.flush();
  assert.deepEqual(crowdedPlaying(), ["b", "b", "c", "a"], "Next repeats a scene when none is free");
  crowdedPlayers()[2].props.onNext();
  await crowded.flush();
  assert.equal(crowdedPlaying()[2], "a", "even when the screen's own scene is the only free one");
  await crowded.unmount();
}

async function reshuffleMenu() {
  const scenes = ["a", "b", "c", "d"].map(id => ({ id, title: id, paths: { stream: "/" + id } }));
  const h = await start({
    scenes,
    settings: { rows: 1, columns: 2, sceneOrder: "random", startMuted: true },
  });
  const menu = () => h.nodes(node => node.type === "ActionMenu")[0].props;
  const choose = key =>
    menu()
      .items.find(item => item.key === key)
      .onSelect();
  const sceneQueries = () => h.calls.filter(call => call.query.includes("MultiscreenScenes"));
  assert.equal(menu().ariaLabel, "Reshuffle scenes");
  assert.deepEqual(
    [
      ...menu()
        .items.filter(item => item.key)
        .map(item => item.key),
    ],
    ["random", "fresh", "unwatched", "favorites", "newest", "mix", "list"],
  );
  const checked = () =>
    menu()
      .items.filter(item => item.key && JSON.stringify(item.label).includes("(current)"))
      .map(item => item.key)
      .join();
  assert.equal(checked(), "random", "the current order is checked");
  const before = sceneQueries().length;
  choose("random");
  await h.flush();
  assert.equal(sceneQueries().length, before + 1, "the current order reloads a fresh sample");
  assert.notEqual(sceneQueries().at(-1).variables.filter.sort, sceneQueries().at(-2).variables.filter.sort);
  assert.equal(h.saved.length, 0, "reshuffling with the same order saves nothing");
  choose("newest");
  await h.flush();
  assert.equal(sceneQueries().at(-1).variables.filter.sort, "created_at", "another order reloads with its sort");
  assert.deepEqual(JSON.parse(JSON.stringify(h.saved.at(-1))), {
    id: "multiscreen",
    settings: { rows: 1, columns: 2, sceneOrder: "newest", startMuted: true },
  });
  assert.equal(checked(), "newest");
  await h.unmount();

  const unsaved = await start({ scenes, saveFails: true, settings: { sceneOrder: "random" } });
  unsaved
    .nodes(node => node.type === "ActionMenu")[0]
    .props.items.find(item => item.key === "list")
    .onSelect();
  await unsaved.flush();
  assert.equal(unsaved.notices.length, 1, "a failed save is reported");
  assert.equal(unsaved.notices[0].tone, "error");
  assert.equal(
    unsaved.calls.filter(call => call.query.includes("MultiscreenScenes")).at(-1).variables.filter.sort,
    "title",
    "the session still uses the chosen order",
  );
  await unsaved.unmount();
}

async function pagedPlayback() {
  const scenes = Array.from({ length: 1001 }, (_, index) => ({
    id: String(index),
    title: "Scene " + index,
    paths: { stream: "/" + index },
  }));
  const pageRequests = [];
  let hold,
    fail = false;
  const h = await start({
    scenes,
    launch: { source: "filter", filter: { sort: "title" }, sceneFilter: {} },
    graphql: async (_query, variables) => {
      pageRequests.push(variables.filter);
      if (hold) await hold.promise;
      if (fail) throw new Error("Queue unavailable");
      const { page, per_page: size } = variables.filter;
      return { findScenes: { count: scenes.length, scenes: scenes.slice((page - 1) * size, page * size) } };
    },
  });
  const players = () => h.nodes(node => node.type === "native-player");
  assert.equal(pageRequests.length, 1);
  assert(pageRequests[0].per_page <= 240);
  const size = pageRequests[0].per_page;
  for (let i = 0; i < size - 1; i++) {
    players().forEach(player => player.props.onNext());
    await h.flush();
  }
  hold = deferred();
  players().forEach(player => player.props.onNext());
  await h.flush();
  assert.equal(pageRequests.length, 2, "panes share an in-flight page request");
  assert(
    players().every(player => player.props.scene.id === String(size - 1)),
    "current videos remain while the next page loads",
  );
  hold.resolve();
  hold = null;
  await h.flush();
  assert(players().every(player => player.props.scene.id === String(size)));
  players()[0].props.onPrevious();
  await h.flush();
  assert.equal(players()[0].props.scene.id, String(size - 1));
  assert.equal(players()[1].props.scene.id, String(size), "a pane advances independently");
  fail = true;
  players()[0].props.onNext();
  await h.flush();
  assert.match(h.text(), /Queue unavailable/);
  assert.equal(players()[0].props.scene.id, String(size - 1));
  fail = false;
  h.nodes(node => node.type === "button" && /Retry/.test(h.text()))
    .at(-1)
    .props.onClick();
  await h.flush();
  assert.equal(players()[0].props.scene.id, String(size));
  // Advance one pane through every selected scene; retained queues stay bounded.
  const seen = new Set(Array.from({ length: size + 1 }, (_, i) => String(i)));
  for (let i = size + 1; i < scenes.length; i++) {
    players()[0].props.onNext();
    await h.flush();
    seen.add(players()[0].props.scene.id);
    const queueStates = [...h.owners.values()]
      .flatMap(owner => owner.slots)
      .map(slot => slot?.state)
      .filter(state => state?.items);
    assert.equal(queueStates.length, 2, "each pane owns one current queue");
    assert(queueStates.every(slot => slot.items.length <= size));
  }
  assert.equal(seen.size, scenes.length, "continuation reaches the complete contextual library");
  players()[0].props.onNext();
  await h.flush();
  assert.equal(players()[0].props.scene.id, "0", "the final page wraps to the start");
  await h.unmount();

  const selection = await start({
    scenes,
    settings: { rows: 1, columns: 2, sceneOrder: "random", avoidDuplicates: false },
    launch: { source: "selection", selectedIds: scenes.map(scene => scene.id) },
  });
  assert.equal(
    selection.calls.filter(call => call.query.includes("MultiscreenScenes")).length,
    1,
    "explicit selections remain one complete source",
  );
  const selectedSeen = new Set();
  for (let i = 0; i < scenes.length; i++) {
    const player = selection.nodes(node => node.type === "native-player")[0];
    selectedSeen.add(player.props.scene.id);
    player.props.onNext();
    await selection.flush();
  }
  assert.equal(selectedSeen.size, scenes.length, "bounded independent permutations retain every off-page selection");
  await selection.unmount();

  const empty = await start({
    scenes,
    launch: { source: "filter", filter: {}, sceneFilter: {} },
    graphql: async (_query, variables) => ({
      findScenes: { count: 60, scenes: variables.filter.page === 1 ? [{ id: "unplayable" }] : scenes.slice(24, 48) },
    }),
  });
  assert.equal(empty.calls.length, 2, "an unplayable initial page does not hide later playable scenes");
  assert.equal(empty.nodes(node => node.type === "native-player")[0].props.scene.id, "24");
  await empty.unmount();

  const pending = deferred(),
    signals = [];
  const late = await start({
    scenes,
    launch: { source: "filter", filter: {}, sceneFilter: {} },
    graphql: async (_query, variables, options) => {
      if (variables.filter.page > 1) {
        signals.push(options.signal);
        await pending.promise;
      }
      return {
        findScenes: { count: 1001, scenes: scenes.slice((variables.filter.page - 1) * 24, variables.filter.page * 24) },
      };
    },
  });
  for (let i = 0; i < 24; i++) {
    late.nodes(node => node.type === "native-player")[0].props.onNext();
    await late.flush();
  }
  await late.unmount();
  assert(signals[0].aborted, "leaving playback aborts pending continuation");
  pending.resolve();
  await late.flush();
  assert.equal(late.nodes(node => node.type === "native-player").length, 0);
}
async function navigationSetting() {
  const stored = { showInMenu: false };
  const h = await start({ mode: "nav", loadSettings: () => ({ ...stored }) });
  const button = () => h.nodes(node => node.type === "NavAction")[0];
  const changed = async pluginId => {
    h.window.emit("dirty-plugins:configuration-changed", { detail: { pluginId } });
    await h.flush();
  };
  assert.equal(h.tree.children[0].type, "original-nav", "native items stay first");
  assert.equal(button(), undefined, "the stored setting hides the button");
  h.patches.get("SceneList")({
    filter: { makeFindFilter: () => ({ sort: "title" }), makeFilter: () => ({}) },
    selectedIds: new Set(),
  });
  await h.tick();
  assert.equal(h.calls.length, 0, "a hidden button counts no scenes");
  stored.showInMenu = true;
  await changed("dirtyStats");
  assert.equal(button(), undefined, "other plugins' changes do not apply Multiscreen settings");
  await changed("multiscreen");
  assert.equal(button().props.to, "/plugins/multiscreen", "turning it on shows the button");
  stored.showInMenu = false;
  await changed("multiscreen");
  assert.equal(button(), undefined, "turning it off hides the button again");
  await h.unmount();
  assert.equal(h.window.handlers.get("dirty-plugins:configuration-changed")?.size || 0, 0);
}
async function sessionRestore() {
  const SESSION = "multiscreen.session";
  const scenes = Array.from({ length: 60 }, (_, index) => ({
    id: String(index),
    title: "Scene " + index,
    paths: { stream: "/" + index },
    files: [{ duration: 100 }],
  }));
  const settings = {
    rows: 1,
    columns: 2,
    sceneOrder: "random",
    splitScenes: true,
    startMuted: true,
    randomStart: false,
    loopScenes: false,
  };
  const launch = { source: "filter", filter: { sort: "title" }, sceneFilter: { organized: true } };
  const graphql = async (query, variables) => {
    const { page, per_page: size } = variables.filter;
    return { findScenes: { count: scenes.length, scenes: scenes.slice((page - 1) * size, page * size) } };
  };
  const options = { scenes, settings, graphql };
  const saved = h => JSON.parse(h.localStorage.get(SESSION));
  const players = h => h.nodes(node => node.type === "native-player");
  const playing = h => players(h).map(node => node.props.scene.id);
  const sort = h => h.calls.find(call => call.query.includes("MultiscreenScenes")).variables.filter.sort;
  const pane = (h, index) =>
    [...h.media].find(([address, media]) => address.includes("ms-native-" + index) && media.video.isConnected)[1];
  const reopen = (from, extra) => start({ ...options, localStorage: new Map(from.localStorage), ...extra });

  // Nothing is written while a launch starts; its first save ends the launch.
  const first = await start({ ...options, launch });
  assert.equal(first.localStorage.has(SESSION), false);
  assert.equal(first.storage.has("multiscreen.launchContext"), true);
  await first.tick(5000);
  assert.deepEqual(saved(first).context, launch);
  assert.equal(saved(first).sort, sort(first));
  assert.match(sort(first), /^random_\d+$/);
  assert.deepEqual(
    saved(first).panes.map(entry => entry.itemId),
    playing(first),
  );
  assert.equal(first.storage.has("multiscreen.launchContext"), false, "a reload resumes instead of launching again");

  // Later changes wait for the interval, but never outlive the page.
  const openedOn = playing(first)[0];
  players(first)[0].props.onNext();
  await first.flush();
  assert.notEqual(playing(first)[0], openedOn);
  await first.tick(5000);
  assert.equal(saved(first).panes[0].itemId, playing(first)[0]);
  pane(first, 0).video.currentTime = 7;
  pane(first, 0).player.emit("timeupdate");
  pane(first, 1).player.volume(0.25);
  pane(first, 1).player.muted(false);
  assert.equal(saved(first).panes[0].time, undefined, "playback does not write on every timeupdate");
  assert.equal(first.timers.size, 1, "one save is pending however many panes changed");
  first.window.emit("pagehide");
  assert.equal(first.timers.size, 0);
  assert.equal(saved(first).panes[0].time, 7);
  assert.deepEqual(saved(first).panes[1].audio, { muted: false, volume: 0.25 });

  // A reopened tab deals the same queue and returns each pane to its scene, time and audio.
  const second = await reopen(first);
  const secondQuery = second.calls.find(call => call.query.includes("MultiscreenScenes")).variables;
  assert.equal(secondQuery.filter.sort, sort(first), "Stash is asked for the original random order");
  assert.equal(secondQuery.scene_filter.organized, true, "the scope comes back without a launch context");
  assert.deepEqual(playing(second), playing(first));
  assert.deepEqual(
    new Set(second.nativeCalls.map(call => call.scene.id)),
    new Set(playing(second)),
    "the queue's first scene never starts on the way back",
  );
  assert.equal(pane(second, 0).video.currentTime, 7);
  assert.equal(pane(second, 1).player.volume(), 0.25);
  assert.equal(pane(second, 1).player.muted(), false, "the pane's own audio beats the start-muted setting");
  assert.equal(pane(second, 0).player.muted(), true, "a pane nobody unmuted follows the setting");
  second.window.emit("pagehide");
  assert.equal(saved(second).seed, saved(first).seed);
  assert.equal(saved(second).now, saved(first).now);

  // The saved time belongs to one visit of that scene.
  const restored = playing(second)[0];
  players(second)[0].props.onNext();
  await second.flush();
  assert.notEqual(playing(second)[0], restored);
  players(second)[0].props.onPrevious();
  await second.flush();
  assert.equal(playing(second)[0], restored);
  assert.equal(pane(second, 0).video.currentTime, 0, "coming back later is an ordinary start");
  assert.equal(pane(second, 1).player.volume(), 0.25, "the pane keeps its audio across scenes");

  // Leaving the route saves too, so the header button can return to it.
  pane(second, 0).video.currentTime = 9;
  pane(second, 0).player.emit("timeupdate");
  await second.unmount();
  assert.equal(saved(second).panes[0].time, 9);

  // Moving to another scene forgets the time until the new one reports.
  const third = await reopen(second);
  assert.equal(pane(third, 0).video.currentTime, 9);
  players(third)[0].props.onNext();
  await third.flush();
  await third.tick(5000);
  assert.equal(saved(third).panes[0].time, undefined);
  await third.unmount();

  // The header button replaces the saved session; its scope wins over the saved one.
  const otherScope = { source: "filter", filter: { sort: "date" }, sceneFilter: { favorite: true } };
  const launched = await reopen(first, { launch: otherScope });
  assert.notEqual(sort(launched), sort(first));
  await launched.unmount();
  assert.deepEqual(saved(launched).context, otherScope);

  // Another queue setting keeps the scope and deals a new queue.
  for (const change of [
    { sceneOrder: "fresh" },
    { splitScenes: false },
    { spreadScenes: false },
    { avoidDuplicates: false },
    { columns: 1 },
  ]) {
    const changed = await reopen(first, { settings: { ...settings, ...change } });
    await changed.unmount();
    assert.notEqual(saved(changed).seed, saved(first).seed, JSON.stringify(change));
    assert.notEqual(sort(changed), sort(first), JSON.stringify(change));
    assert.deepEqual(saved(changed).context, launch);
  }
  // Another layout with the same screens is still the same queue.
  const samePanes = await reopen(first, { settings: { ...settings, rows: 2, columns: 2, screens: 2 } });
  assert.equal(sort(samePanes), sort(first));
  assert.deepEqual(playing(samePanes), playing(first));
  await samePanes.unmount();

  // Shuffle starts over and becomes what a reopened tab returns to.
  const shuffling = await reopen(first);
  shuffling
    .nodes(node => node.type === "ActionMenu")[0]
    .props.items.find(item => item.key === "random")
    .onSelect();
  await shuffling.flush();
  shuffling.window.emit("pagehide");
  const shuffledQuery = shuffling.calls.filter(call => call.query.includes("MultiscreenScenes")).at(-1);
  assert.equal(saved(shuffling).sort, shuffledQuery.variables.filter.sort);
  assert.notEqual(saved(shuffling).sort, sort(first));
  assert.notEqual(saved(shuffling).seed, saved(first).seed);
  assert.deepEqual(
    saved(shuffling).panes.map(entry => entry.itemId),
    playing(shuffling),
  );
  assert.equal(pane(shuffling, 0).video.currentTime, 0, "a shuffled pane starts its new scene normally");
  await shuffling.unmount();

  // A saved page is loaded before anything plays, and its scene may sit in another lane.
  const record = saved(first);
  const atPage = (page, itemId, extra) => ({
    localStorage: new Map([[SESSION, JSON.stringify({ ...record, panes: [{ page, itemId, ...extra }, null] })]]),
  });
  const hold = deferred();
  const later = await start({
    ...options,
    ...atPage(2, "30", { time: 4 }),
    graphql: async (query, variables) => {
      if (variables.filter.page === 2) await hold.promise;
      return graphql(query, variables);
    },
  });
  assert.equal(players(later).length, 1, "only the pane without a saved page has started");
  assert.match(later.text(), /Restoring session/);
  hold.resolve();
  await later.flush();
  assert.equal(playing(later)[0], "30");
  assert.doesNotMatch(later.text(), /Restoring session/);
  assert.equal(pane(later, 0).video.currentTime, 4);
  await later.unmount();
  assert.equal(saved(later).panes[0].page, 2);

  // A scene the library no longer has leaves the pane at the top of its saved page.
  const missing = await start({ ...options, ...atPage(2, "deleted", { time: 4 }) });
  assert(
    scenes
      .slice(16, 32)
      .map(scene => scene.id)
      .includes(playing(missing)[0]),
  );
  assert.equal(pane(missing, 0).video.currentTime, 0, "the saved time belonged to the missing scene");
  await missing.unmount();

  // A page beyond a smaller library is clamped to the last one.
  const beyond = await start({ ...options, ...atPage(99, "50") });
  assert.equal(playing(beyond)[0], "50");
  await beyond.unmount();
  assert.equal(saved(beyond).panes[0].page, 4);

  // A page that cannot load falls back to the session's first page without an error.
  const broken = await start({
    ...options,
    ...atPage(2, "30"),
    graphql: async (query, variables) => {
      if (variables.filter.page === 2) throw new Error("offline");
      return graphql(query, variables);
    },
  });
  assert.equal(players(broken).length, 2);
  assert.doesNotMatch(broken.text(), /offline/);
  await broken.unmount();

  // Search can take over from a restore still in flight.
  const waiting = deferred();
  const searching = await start({
    ...options,
    ...atPage(2, "30"),
    graphql: async (query, variables) => {
      if (query.includes("MultiscreenSceneSearch")) return { findScenes: { count: 1, scenes: [scenes[1]] } };
      if (variables.filter.page === 2) await waiting.promise;
      return graphql(query, variables);
    },
  });
  searching.button("Search scenes for screen 1").props.onClick();
  await searching.flush();
  searching
    .nodes(node => node.type === "input" && node.props.type === "search")[0]
    .props.onChange({ target: { value: "Scene 1" } });
  await searching.flush();
  await searching.tick(300);
  searching
    .nodes(node => node.type === "Button" && node.props.className === "ms-scene-search-result")[0]
    .props.onClick();
  waiting.resolve();
  await searching.flush();
  assert.equal(playing(searching)[0], "1", "the late restore does not replace the search choice");
  await searching.unmount();

  // Selections and unscoped launches come back too.
  const listSettings = { ...settings, sceneOrder: "list", splitScenes: false };
  const byIds = async (_query, variables) => {
    const rows = scenes.filter(scene => !variables.ids || variables.ids.includes(scene.id));
    return { findScenes: { count: rows.length, scenes: rows } };
  };
  const selection = { scenes, settings: listSettings, graphql: byIds };
  const selected = await start({ ...selection, launch: { source: "selection", selectedIds: ["5", "6", "7", "8"] } });
  players(selected)[1].props.onNext();
  await selected.flush();
  await selected.unmount();
  assert.equal(saved(selected).sort, undefined);
  const reselected = await start({ ...selection, localStorage: selected.localStorage });
  assert.deepEqual(
    [...reselected.calls.find(call => call.query.includes("MultiscreenScenes")).variables.ids],
    ["5", "6", "7", "8"],
  );
  assert.deepEqual(playing(reselected), ["5", "7"]);
  await reselected.unmount();

  const library = await start(options);
  const libraryPlaying = playing(library);
  await library.unmount();
  assert.equal(saved(library).context, null);
  const reopenedLibrary = await reopen(library);
  assert.deepEqual(playing(reopenedLibrary), libraryPlaying);
  assert.equal(sort(reopenedLibrary), sort(library));
  await reopenedLibrary.unmount();

  // Markers resume inside their range, not at its start.
  const marker = {
    id: "m",
    title: "Range",
    seconds: 2,
    end_seconds: 40,
    primary_tag: { name: "Test" },
    scene: scenes[0],
  };
  const markerOptions = {
    scenes,
    markers: [marker],
    settings: { ...listSettings, columns: 1 },
  };
  const markers = await start({ ...markerOptions, launch: { source: "marker-selection", selectedIds: ["m"] } });
  assert.equal(pane(markers, 0).video.currentTime, 2);
  pane(markers, 0).video.currentTime = 11;
  pane(markers, 0).player.emit("timeupdate");
  await markers.unmount();
  assert.equal(saved(markers).panes[0].itemId, "marker-m");
  const reopenedMarkers = await start({ ...markerOptions, localStorage: markers.localStorage });
  assert.equal(pane(reopenedMarkers, 0).video.currentTime, 11);
  await reopenedMarkers.unmount();

  // Anything unusable is the same as no saved session.
  for (const value of [
    "{not json",
    "null",
    "[]",
    JSON.stringify({ ...record, context: { source: "nope" } }),
    JSON.stringify({ ...record, seed: "1" }),
    JSON.stringify({ ...record, panes: [{ page: 0, itemId: "1" }] }),
    JSON.stringify({ ...record, panes: [{ page: 1, itemId: "1", time: -1 }] }),
    JSON.stringify({ ...record, panes: [{ page: 1, itemId: "1", audio: { muted: "no", volume: 1 } }] }),
  ]) {
    const unusable = await start({ ...options, localStorage: new Map([[SESSION, value]]) });
    assert.equal(players(unusable).length, 2, value);
    await unusable.unmount();
    assert.equal(saved(unusable).context, null, value);
  }

  // Storage that refuses reads or writes never stops playback.
  const refusing = createMultiscreenHarness({ ...options, launch });
  refusing.window.localStorage = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  refusing.load();
  await refusing.flush();
  assert.equal(players(refusing).length, 2);
  await refusing.unmount();
  assert.equal(refusing.storage.has("multiscreen.launchContext"), true, "a reload can still launch the same scope");
}
async function pluginLists() {
  const scenes = Array.from({ length: 300 }, (_, index) => ({
    id: String(index + 1),
    title: "Scene " + (index + 1),
    paths: { stream: "/" + index },
    performers: (index + 1) % 100 === 0 ? [{ id: "p", name: "Alex" }] : [],
  }));
  const settings = { rows: 1, columns: 2, sceneOrder: "random", avoidDuplicates: true, randomStart: false };
  const announcement = {
    version: 1,
    source: "cherrypick",
    path: "/plugins/cherrypick",
    kind: "scenes",
    keepOrder: true,
    label: "For you",
  };
  const ids = scenes.map(scene => scene.id).reverse();
  const announce = (h, detail) => h.document.dispatchEvent({ type: "stash-scenes:context", detail });
  const settle = async h => {
    for (let round = 0; round < 3; round++) await h.tick();
  };
  const link = h => h.nodes(node => node.type === "NavAction")[0];

  // The badge counts exactly what a click launches, without a query.
  const nav = await start({ mode: "nav", path: "/plugins/cherrypick", scenes, settings });
  announce(nav, { ...announcement, ids });
  await settle(nav);
  assert.equal(link(nav).props.label, "DirtyMultiscreen (300 scenes)");
  assert.equal(nav.calls.length, 0, "an announced list is counted without a query");
  link(nav).props.onClick();
  assert.deepEqual(JSON.parse(nav.storage.get("multiscreen.launchContext")), {
    source: "plugin-list",
    kind: "scenes",
    ids,
    keepOrder: true,
    label: "For you",
  });
  announce(nav, { ...announcement, ids: null });
  await settle(nav);
  assert.equal(link(nav).props.label, "DirtyMultiscreen", "after a withdrawal the button behaves as before");
  link(nav).props.onClick();
  assert.equal(nav.storage.has("multiscreen.launchContext"), false);
  await nav.unmount();

  // A list announced before the settings load waits for them, and a changed setting applies to it.
  let stored = { otherPluginLists: "off" };
  const gate = deferred();
  const early = await start({
    mode: "nav",
    path: "/plugins/cherrypick",
    scenes,
    loadSettings: () => gate.promise.then(() => stored),
  });
  announce(early, { ...announcement, ids: ["1", "2"] });
  await settle(early);
  assert.equal(early.nodes(node => node.type === "NavAction").length, 0, "the button waits for the settings");
  gate.resolve();
  await settle(early);
  assert.equal(link(early).props.label, "DirtyMultiscreen", "Off shows no other plugin's list");
  stored = { otherPluginLists: "known" };
  early.window.emit("dirty-plugins:configuration-changed", { detail: { pluginId: "multiscreen" } });
  await settle(early);
  assert.equal(link(early).props.label, "DirtyMultiscreen (2 scenes)");
  await early.unmount();

  // A launch loads one page of IDs at a time, in the list's order whatever the Scene order says.
  const launchIds = ["9999", ...ids];
  const graphql = async (query, variables) => {
    if (query.includes("MultiscreenSceneIds")) {
      const [performer] = variables.scene_filter.performers.value;
      const rows = scenes.filter(scene => scene.performers.some(({ id }) => id === performer));
      return { findScenes: { scenes: rows.map(({ id }) => ({ id })) } };
    }
    if (variables.ids.includes("9999")) throw new Error("scene with id 9999 not found");
    const rows = variables.ids.map(id => scenes.find(scene => scene.id === id));
    return { findScenes: { count: rows.length, scenes: rows } };
  };
  const launch = { source: "plugin-list", kind: "scenes", ids: launchIds, keepOrder: true, label: "For you" };
  const playing = h => h.nodes(node => node.type === "native-player").map(node => node.props.scene.id);
  const route = await start({ scenes, settings, graphql, launch });
  assert.deepEqual(playing(route), ["300", "299"], "the list order wins and a deleted item is skipped");
  const size = route.calls[0].variables.ids.length;
  assert.equal(size, 24, "IDs load one page at a time");
  assert.deepEqual([...route.calls[1].variables.ids], launchIds.slice(1, size));
  const checked = h =>
    h
      .nodes(node => node.type === "ActionMenu")[0]
      .props.items.filter(item => item.key && JSON.stringify(item.label).includes("(current)"))
      .map(item => item.key)
      .join();
  assert.equal(checked(route), "list");
  await route.tick(5000);
  const launched = new Map(route.localStorage);
  const session = JSON.parse(launched.get("multiscreen.session"));
  assert.deepEqual(session.context, launch);
  assert.equal(JSON.parse(session.queue)[0], "list", "the saved session records the order it plays");
  assert.equal(route.storage.has("multiscreen.launchContext"), false);

  // A later announcement leaves the running session alone.
  const calls = route.calls.length;
  announce(route, { ...announcement, ids: ["1"] });
  await route.flush();
  assert.equal(route.calls.length, calls);
  assert.deepEqual(playing(route), ["300", "299"]);

  // Performer buttons and Next reach items beyond the first page.
  route
    .nodes(node => node.type === "Button" && node.props.ariaLabel === "Next scene featuring Alex for screen 1")[0]
    .props.onClick();
  await route.flush();
  assert.deepEqual(playing(route), ["200", "299"], "the performer's next scene in list order");
  assert.deepEqual([...route.calls.at(-1).variables.ids], ["200"], "only the next match loads");
  for (let press = 0; press < size; press++) {
    route.nodes(node => node.type === "native-player")[1].props.onNext();
    await route.flush();
  }
  assert(launchIds.slice(size, 2 * size).includes(playing(route)[1]), "Next continues into the next page of IDs");

  // Another order ends the list's own order and becomes the Scene order setting.
  route
    .nodes(node => node.type === "ActionMenu")[0]
    .props.items.find(item => item.key === "random")
    .onSelect();
  await route.flush();
  assert.equal(route.saved.at(-1).settings.sceneOrder, "random");
  assert.equal(checked(route), "random");
  await route.tick(5000);
  assert.equal(JSON.parse(route.localStorage.get("multiscreen.session")).context.keepOrder, false);
  await route.unmount();

  // A reload resumes in the list's order.
  const resumed = await start({ scenes, settings, graphql, localStorage: new Map(launched) });
  assert.deepEqual(playing(resumed), ["300", "299"]);
  assert.equal(checked(resumed), "list");
  await resumed.unmount();

  // An empty list is shown once, and the saved session stays for the next launch.
  const kept = new Map(launched);
  for (const [kind, label, title] of [
    ["scenes", "For you", "No scenes in For you"],
    ["markers", "", "No markers"],
  ]) {
    const empty = await start({
      scenes,
      settings,
      graphql,
      localStorage: kept,
      launch: { source: "plugin-list", kind, ids: [], keepOrder: false, label },
    });
    assert.equal(empty.nodes(node => node.type === "StateView")[0].props.title, title);
    assert.equal(empty.calls.length, 0);
    assert.equal(empty.storage.has("multiscreen.launchContext"), false, "an empty launch is used once");
    await empty.unmount();
  }
  assert.equal(kept.get("multiscreen.session"), launched.get("multiscreen.session"));
  const later = await start({ scenes, settings, graphql, localStorage: kept });
  assert.deepEqual(playing(later), ["300", "299"], "a later launch resumes the previous session");
  await later.unmount();
}
(async () => {
  await registration();
  await contextsAndCounts();
  await pluginLists();
  await navigationSetting();
  await playbackAndCleanup();
  await markersAndLoops();
  await stablePaneSubscriptions();
  await counters();
  await gridsAndAsync();
  await playableStartupAndTranscodeClock();
  await independentNativePlayerIdentities();
  await staleCounts();
  await sceneSearch();
  await fixedSessionSearch();
  await searchDuringMarkersAndPaging();
  await searchedQueueNavigation();
  await performerNavigation();
  await performerNavigationSetting();
  await pagedPerformerNavigation();
  await searchFocusAfterClosing();
  await performerNavigationAcrossPagesAndReopen();
  await pagedPlayback();
  await avoidsDuplicateScenes();
  await reshuffleMenu();
  await unscopedLibraryPaging();
  await sessionRestore();
  console.log("DirtyMultiscreen compiled registration, navigation, players, grid, counters and cleanup passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
