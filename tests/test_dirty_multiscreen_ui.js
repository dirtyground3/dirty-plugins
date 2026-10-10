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
    settings: { rows: 1, columns: 2, totalScreens: 2, randomize: false, splitScenes: false, loopScenes: false },
  });
  const panes = h.nodes(node => node.type === "native-player");
  const media = [...h.media.values()].filter(pair => pair.video.isConnected);
  const other = media[1];
  const observed = h.observers.filter(observer => observer.connected && observer.target === other.tile);
  const timeListener = [...other.video.handlers.get("timeupdate")][0];
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
  assert.equal([...other.video.handlers.get("timeupdate")][0], timeListener);
  assert.equal([...other.player.handlers.get("volumechange")][0], volumeListener);
  const fresh = h.nodes(node => node.type === "native-player");
  assert.equal(fresh[1].props.onNext, next);
  assert.equal(fresh[1].props.onComplete, complete);
  assert.equal(h.observers.length, count + 2, "only the replaced marker's two observers mount");
  other.video.currentTime = 4;
  other.video.emit("timeupdate");
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
    settings: { rows: 1, columns: 2, totalScreens: 2, randomize: true },
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
(async () => {
  await registration();
  await contextsAndCounts();
  await playbackAndCleanup();
  await markersAndLoops();
  await stablePaneSubscriptions();
  await counters();
  await gridsAndAsync();
  await staleCounts();
  await pagedPlayback();
  console.log("DirtyMultiscreen compiled registration, navigation, players, grid, counters and cleanup passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
