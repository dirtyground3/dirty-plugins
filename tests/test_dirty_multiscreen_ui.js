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
async function markerSeeking() {
  for (const loopScenes of [true, false]) {
    for (const transcode of [false, true]) {
      const scene = { id: "a", paths: { stream: "/a" }, files: [{ duration: 20 }] };
      const markers = [
        { id: "m", title: "First", seconds: 2, end_seconds: 4, primary_tag: { name: "Test" }, scene },
        { id: "n", title: "Next", seconds: 10, end_seconds: 12, primary_tag: { name: "Test" }, scene },
      ];
      const options = {
        scenes: [scene],
        markers,
        launch: { source: "marker-selection", selectedIds: ["m", "n"] },
        settings: { rows: 1, columns: 1, sceneOrder: "list", randomStart: false, loopScenes },
      };
      const playerOptions = { ...options, readyState: 0 };
      const h = await start(playerOptions);
      const active = () => [...h.media.values()].find(pair => pair.video.isConnected);
      const pair = active();
      if (transcode) {
        let offset = 0;
        pair.player.currentTime = value => {
          if (value === undefined) return offset + pair.video.currentTime;
          offset = value;
          pair.video.currentTime = 0;
        };
      }
      playerOptions.readyState = 4;
      pair.player.emit("canplay");
      await h.flush();
      assert.equal(pair.player.currentTime(), 2);
      const seek = async seconds => {
        pair.video.seeking = true;
        pair.player.currentTime(seconds);
        // The seek bar can publish timeupdate before the browser dispatches seeking.
        pair.player.emit("timeupdate");
        assert.equal(pair.player.currentTime(), seconds, "a seek must not be redirected before seeking fires");
        pair.player.emit("seeking");
        pair.video.seeking = false;
        // The final timeupdate can precede seeked, after the native seeking flag has cleared.
        pair.player.emit("timeupdate");
        assert.equal(pair.player.currentTime(), seconds, "a seek must not be redirected before seeked fires");
        pair.player.emit("seeked");
        pair.player.emit("timeupdate");
        await h.flush();
        assert.equal(active(), pair, "seeking never advances the marker queue");
        assert.equal(pair.player.currentTime(), seconds);
      };
      await seek(4);
      pair.video.currentTime += 1;
      pair.player.emit("timeupdate");
      await h.flush();
      assert.equal(pair.player.currentTime(), 5, "playback continues beyond a marker after seeking to its end");
      await seek(6);
      h.window.emit("pagehide");
      const reopened = await start({ ...options, launch: undefined, localStorage: new Map(h.localStorage) });
      const restored = [...reopened.media.values()].find(media => media.video.isConnected);
      assert.equal(restored.player.currentTime(), 6, "saved positions beyond the marker end resume there");
      restored.player.emit("timeupdate");
      await reopened.flush();
      assert.equal(restored.video.isConnected, true);
      assert.equal(restored.player.currentTime(), 6, "restoring beyond the end does not loop or advance immediately");
      await reopened.unmount();

      await seek(3);
      await seek(1);
      pair.video.currentTime += 3;
      pair.player.emit("timeupdate");
      await h.flush();
      assert.equal(
        active().player.currentTime(),
        loopScenes ? 2 : 10,
        "playing across the end loops or advances again",
      );
      if (loopScenes) {
        h.nodes(node => node.type === "native-player")[0].props.onNext();
        await h.flush();
      }
      assert.equal(active().player.currentTime(), 10);
      active().video.currentTime = 12;
      active().player.emit("timeupdate");
      await h.flush();
      assert.equal(active().player.currentTime(), loopScenes ? 10 : 2, "the next marker retains its own boundary");
      await h.unmount();
      assert.equal(pair.player.handlers.get("seeking").size, 0);
      assert.equal(pair.player.handlers.get("seeked").size, 0);
    }
  }
}

async function sceneHeaderActions() {
  const scenes = [
      { id: "a", title: "Alpha", paths: { stream: "/a" } },
      { id: "b", title: "Beta", paths: { stream: "/b" } },
    ],
    pending = [];
  const h = await start({
    scenes,
    settings: { rows: 1, columns: 2, sceneOrder: "list", splitScenes: true, randomStart: false },
    graphql: (query, variables) => {
      if (query.includes("MultiscreenScenes")) return { findScenes: { count: 2, scenes } };
      const request = deferred();
      pending.push({ ...request, query, id: variables.id });
      return request.promise;
    },
  });
  const links = h.nodes(node => node.type === "NavLink" && node.props.className?.includes("ms-scene-link"));
  assert.deepEqual(
    links.map(link => [link.props.to, link.props["aria-label"], link.props.target]),
    [
      ["/scenes/a", "Open scene page for Alpha", "_blank"],
      ["/scenes/b", "Open scene page for Beta", "_blank"],
    ],
    "each screen links to its scene with an icon instead of its title",
  );
  assert.doesNotMatch(h.text(), /Alpha|Beta/, "titles are no longer shown as text");
  const sceneCounter = screen =>
    h.nodes(
      node => node.type === "IconButton" && node.props.ariaLabel?.includes(`O to the scene on screen ${screen}`),
    )[0];
  sceneCounter(2).props.onClick();
  sceneCounter(2).props.onClick();
  await h.flush();
  assert.deepEqual(
    pending.map(request => [request.id, /sceneIncrementO/.test(request.query)]),
    [["b", true]],
    "one press adds one O to only that screen's scene",
  );
  assert.equal(sceneCounter(2).props.busy, true);
  pending[0].resolve({ sceneIncrementO: 7 });
  await h.flush();
  assert.match(sceneCounter(2).props.ariaLabel, /\(now 7\)/);
  assert.match(h.text(), /O counter is now 7/);
  await h.tick(1500);
  assert.doesNotMatch(h.text(), /O counter is now/, "the confirmation clears");
  sceneCounter(2).props.onClick();
  await h.flush();
  pending[1].reject(Error("offline"));
  await h.flush();
  assert.match(sceneCounter(2).props.ariaLabel, /^Could not add an O/);
  sceneCounter(2).props.onClick();
  await h.flush();
  assert.equal(pending.length, 3, "a failed O can be retried");
  const visible = h.nodes(node => node.type === "IconButton" && node.props.ariaLabel?.startsWith("Increase O"))[0];
  assert.equal(visible.props.icon, undefined, "the visible-scenes button draws its own drops");
  const floating = () => h.nodes(node => node.props.className?.startsWith("ms-floating"))[0].props.className;
  const pointer = (clientX, clientY, pointerType = "mouse") =>
    h.window.emit("pointermove", { clientX, clientY, pointerType });
  assert.equal(floating(), "ms-floating");
  await h.tick(3000);
  assert.equal(floating(), "ms-floating ms-floating-idle", "the top-right buttons hide after the player opens");
  pointer(400, 500);
  await h.tick(3000);
  assert.equal(floating(), "ms-floating ms-floating-idle", "moving elsewhere in the window does not show them");
  pointer(1480, 300);
  await h.flush();
  assert.equal(floating(), "ms-floating", "the mouse near them shows them");
  await h.tick(5000);
  assert.equal(floating(), "ms-floating", "they stay while the mouse rests near them");
  pointer(1000, 500);
  await h.tick(2900);
  assert.equal(floating(), "ms-floating");
  pointer(1560, 40);
  await h.tick(3000);
  assert.equal(floating(), "ms-floating", "coming back near them in time keeps them");
  h.document.emit("pointerout", { relatedTarget: null });
  await h.tick(3000);
  assert.equal(floating(), "ms-floating ms-floating-idle", "the mouse leaving the window hides them");
  h.window.emit("pointerdown", { pointerType: "touch" });
  await h.flush();
  assert.equal(floating(), "ms-floating", "a touch shows them for a while");
  await h.tick(3000);
  assert.equal(floating(), "ms-floating ms-floating-idle");
  h.nodes(node => node.type === "IconButton" && node.props.ariaLabel === "Edit screens")[0].props.onClick();
  await h.flush();
  assert.equal(floating(), "ms-floating", "entering edit mode reveals the toolbar even while idle");
  pointer(200, 200);
  h.document.emit("pointerout", { relatedTarget: null });
  await h.tick(3000);
  assert.equal(floating(), "ms-floating", "the toolbar stays visible throughout edit mode");
  h.nodes(node => node.type === "IconButton" && node.props.ariaLabel === "Finish editing screens")[0].props.onClick();
  await h.flush();
  await h.tick(2900);
  assert.equal(floating(), "ms-floating", "leaving edit mode starts a fresh idle delay");
  await h.tick(3000);
  assert.equal(floating(), "ms-floating ms-floating-idle", "the toolbar hides normally after editing");
  await h.unmount();
  pending[2].resolve({ sceneIncrementO: 8 });
  await h.flush();
  assert.equal(h.timers.size, 0);
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
  // Every cell plays.
  const grid = await start({ settings: { rows: 2, columns: 2, sceneOrder: "list" } });
  assert.equal(grid.nodes(node => node.type === "native-player").length, 4);
  await grid.unmount();
  const h = await start({
    settings: {
      rows: 1,
      columns: 2,
      splitScenes: true,
      sceneOrder: "list",
      pauseWhenHidden: false,
      randomStart: false,
      // Recent grids save when the tab is hidden; without them nothing listens.
      recentGrids: 0,
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
  const filter = () => h.nodes(node => node.type === "NativeSceneFilter")[0];
  const search = async text => {
    filter().props.onChange({ find: { q: text }, scene: {} });
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
  requests[1].resolve({
    findScenes: {
      count: 21,
      scenes: [scenes[2], { id: "missing", title: "Unavailable" }, { id: "u", paths: { stream: "/u" } }],
    },
  });
  await h.flush();
  assert.deepEqual(
    resultButtons().map(button =>
      button.children
        .flat(Infinity)
        .filter(Boolean)
        .map(line => require("./ui_harness").text(line)),
    ),
    [["Title c", "Scene c"], ["Scene u"]],
    "unplayable scenes are left out, and an untitled scene is not named twice",
  );
  requests[0].resolve({ findScenes: { count: 1, scenes: [scenes[1]] } });
  await h.flush();
  assert.equal(resultButtons().length, 2, "late responses cannot replace the latest results");
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
  filter().props.onChange({ find: { q: "cancel debounce" }, scene: {} });
  await h.flush();
  h.nodes(node => node.type === "Dialog")[0].props.onClose();
  await h.flush();
  assert.equal(
    [...h.timers.values()].filter(timer => timer.delay !== 5000 && timer.delay !== 3000).length,
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
    h.nodes(node => node.type === "NativeSceneFilter")[0].props.onChange({ find: { q: value }, scene: {} });
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
  assert(
    h.calls.every(call => !call.query.includes("MultiscreenSceneSearch")),
    "a fixed selection is matched by ID, never expanded into a library search",
  );
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
  library
    .nodes(node => node.type === "NativeSceneFilter")[0]
    .props.onChange({ find: { q: "Available 45" }, scene: {} });
  await library.flush();
  await library.tick(300);
  await library.flush();
  assert.doesNotMatch(library.text(), /No scenes match/, "an unscoped launch searches the whole library");
  const libraryQuery = library.calls.at(-1);
  assert.match(libraryQuery.query, /MultiscreenSceneSearch/);
  assert.equal(libraryQuery.variables.filter.q, "Available 45", "Stash's own search term applies");
  assert.equal(libraryQuery.variables.scene_filter, undefined);
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
    h.nodes(node => node.type === "NativeSceneFilter")[0].props.onChange({ find: { q: "a" }, scene: {} });
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
  paged.nodes(node => node.type === "NativeSceneFilter")[0].props.onChange({ find: { q: "b" }, scene: {} });
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
        const term = variables.filter.q;
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
    h.nodes(node => node.type === "NativeSceneFilter")[0].props.onChange({ find: { q: `Video (${id})` }, scene: {} });
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
  random
    .nodes(node => node.type === "NativeSceneFilter")[0]
    .props.onChange({ find: { q: `Video (${order[5]})` }, scene: {} });
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
  assert.match(button("Blair").props.title, /Blair.*Wraps at the end.*other screens playing/);
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
  assert.match(h.text(), /No other matching scenes featuring Casey/);
  await h.tick(1000);
  assert.doesNotMatch(h.text(), /No other matching scenes featuring/, "the message clears itself after a second");
  assert.equal(await step("Casey"), "d");
  assert.match(h.text(), /No other matching scenes featuring Casey/, "another click shows it again");
  players()[0].props.onNext();
  await h.flush();
  assert.doesNotMatch(h.text(), /No other matching scenes featuring/);
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

async function performerNavigationFromPerformer() {
  const alex = { id: "p1", name: "Alex" },
    blair = { id: "p2", name: "Blair" };
  const scenes = [
    { id: "a", performers: [alex, blair], paths: { stream: "/a" } },
    { id: "b", performers: [alex], paths: { stream: "/b" } },
    { id: "c", performers: [blair], paths: { stream: "/c" } },
    { id: "d", performers: [alex, blair], paths: { stream: "/d" } },
  ];
  const h = await start({
    scenes,
    launch: { source: "performer-detail", performerId: alex.id },
    settings: { rows: 1, columns: 2, sceneOrder: "list", randomStart: false, splitScenes: true },
    graphql: (_query, variables) => {
      const matches = (scene, filter) =>
        (!filter.performers || scene.performers.some(performer => filter.performers.value.includes(performer.id))) &&
        (!filter.AND || matches(scene, filter.AND));
      const selected = scenes.filter(scene => matches(scene, variables.scene_filter));
      return { findScenes: { count: selected.length, scenes: selected } };
    },
  });
  const players = () => h.nodes(node => node.type === "native-player");
  const playing = () => players().map(node => node.props.scene.id);
  const follow = async name => {
    h.nodes(
      node => node.type === "Button" && node.props.ariaLabel === `Next scene featuring ${name} for screen 1`,
    )[0].props.onClick();
    await h.flush();
  };
  assert.deepEqual(playing(), ["a", "b"], "the grid starts with the launch performer's scenes");
  await follow("Alex");
  assert.deepEqual(playing(), ["b", "b"]);
  players()[0].props.onPrevious();
  await h.flush();
  await follow("Blair");
  assert.deepEqual(playing(), ["c", "b"], "following a co-performer can play a scene without the launch performer");
  await follow("Blair");
  assert.deepEqual(playing(), ["d", "b"], "following a co-performer also finds another shared scene");
  await follow("Blair");
  assert.deepEqual(playing(), ["a", "b"], "the co-performer button still wraps through their scenes");
  await h.unmount();
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
  assert.match(h.text(), /No other matching scenes featuring Performer unique/);
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
  const sessionTimers = h => [...h.timers.values()].filter(timer => timer.delay === 5000).length;

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
  assert.equal(sessionTimers(first), 1, "one save is pending however many panes changed");
  first.window.emit("pagehide");
  assert.equal(
    [...first.timers.values()].filter(timer => timer.delay !== 3000).length,
    0,
    "leaving the page also saves the recent grid",
  );
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
  const samePanes = await reopen(first, { settings: { ...settings, rows: 2, columns: 1 } });
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
  searching.nodes(node => node.type === "NativeSceneFilter")[0].props.onChange({ find: { q: "Scene 1" }, scene: {} });
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
async function editMode() {
  const scenes = ["a", "b", "c", "d"].map(id => ({
    id,
    title: id,
    paths: { stream: "/" + id },
    files: [{ duration: 10 }],
  }));
  // Each screen's own fill applies outside Fit videos.
  const settings = { rows: 1, columns: 2, sceneOrder: "list", randomStart: false, loopScenes: false, fitVideos: false };
  const players = h => h.nodes(node => node.type === "native-player");
  const playing = h => players(h).map(node => node.props.scene.id);
  const cells = h => h.nodes(node => /^ms-cell\b/.test(node.props.className ?? "")).map(node => node.props.className);
  const button = (h, label) => h.nodes(node => node.type === "IconButton" && node.props.ariaLabel === label)[0];
  const press = async (h, label) => {
    button(h, label).props.onClick();
    await h.flush();
  };
  const pane = (h, index) =>
    [...h.media].find(([address, media]) => address.includes("ms-native-" + index) && media.video.isConnected)[1];
  const h = await start({ scenes, settings });
  const [first, second] = playing(h);

  // Outside edit mode the screens show no picture controls.
  assert.equal(button(h, "Edit screens").props.pressed, false);
  assert.equal(h.nodes(node => node.props.className === "ms-screen-controls").length, 0);
  pane(h, 0).video.currentTime = 5;
  await press(h, "Edit screens");
  assert.ok(
    h
      .nodes(node => node.type === "IconButton" && node.props.ariaLabel === "Finish editing screens")
      .some(node => node.props.pressed === true),
    "the global edit toggle stays pressed while the screens also offer a finish button",
  );
  assert.equal(h.nodes(node => node.props.className === "ms-screen-controls").length, 2);
  assert.deepEqual(playing(h), [first, second], "entering edit mode changes no screen");
  assert.equal(pane(h, 0).video.pauseCount, 0, "videos keep playing in edit mode");
  assert.equal(pane(h, 0).video.currentTime, 5);

  // Each control changes only its own screen and shows its state.
  await press(h, "Flip screen 1 horizontally");
  assert.deepEqual(cells(h), ["ms-cell ms-flip-x", "ms-cell"]);
  assert.equal(button(h, "Flip screen 1 horizontally").props.pressed, true);
  assert.equal(button(h, "Flip screen 2 horizontally").props.pressed, false);
  await press(h, "Flip screen 1 vertically");
  await press(h, "Fill screen 1 with the picture");
  assert.deepEqual(cells(h), ["ms-cell ms-fill ms-flip-x ms-flip-y", "ms-cell"]);

  // A screen's loop overrides the Loop scenes setting without seeking the video or reattaching its player.
  assert.equal(button(h, "Loop the scene on screen 1").props.pressed, false, "the icon starts from the setting");
  await press(h, "Loop the scene on screen 1");
  assert.equal(button(h, "Loop the scene on screen 1").props.pressed, true);
  assert.equal(pane(h, 0).video.currentTime, 5, "switching the loop does not seek");
  assert.equal(pane(h, 0).player.handlers.get("timeupdate").size, 1);
  players(h)[0].props.onComplete();
  await h.flush();
  assert.deepEqual(playing(h), [first, second], "the looping screen repeats its scene");
  assert.equal(pane(h, 0).video.currentTime, 0);
  players(h)[1].props.onComplete();
  await h.flush();
  assert.notEqual(playing(h)[1], second, "the other screen still follows the setting");

  // A flip belongs to its video; fill and loop stay with the screen.
  players(h)[0].props.onNext();
  await h.flush();
  assert.notEqual(playing(h)[0], first);
  assert.equal(cells(h)[0], "ms-cell ms-fill");
  assert.equal(button(h, "Flip screen 1 horizontally").props.pressed, false);
  assert.equal(button(h, "Loop the scene on screen 1").props.pressed, true);
  players(h)[0].props.onPrevious();
  await h.flush();
  assert.equal(playing(h)[0], first);
  assert.equal(cells(h)[0], "ms-cell ms-fill ms-flip-x ms-flip-y", "the flip returns with its video");

  // The × on any screen's controls leaves edit mode for all of them and keeps the picture.
  const finishButtons = h.nodes(
    node =>
      node.type === "IconButton" && node.props.ariaLabel === "Finish editing screens" && node.props.pressed == null,
  );
  assert.equal(finishButtons.length, 2, "every screen's controls carry the ×");
  finishButtons[1].props.onClick();
  await h.flush();
  assert.equal(button(h, "Edit screens").props.pressed, false);
  assert.equal(h.nodes(node => node.props.className === "ms-screen-controls").length, 0);
  assert.equal(cells(h)[0], "ms-cell ms-fill ms-flip-x ms-flip-y");

  // The saved session returns every screen's picture, outside edit mode.
  h.window.emit("pagehide");
  assert.deepEqual(JSON.parse(h.localStorage.get("multiscreen.session")).panes[0].view, {
    fill: true,
    loop: true,
    flip: { itemId: first, x: true, y: true },
  });
  const reopened = await start({ scenes, settings, localStorage: new Map(h.localStorage) });
  assert.equal(playing(reopened)[0], first);
  assert.equal(cells(reopened)[0], "ms-cell ms-fill ms-flip-x ms-flip-y");
  assert.equal(button(reopened, "Edit screens").props.pressed, false);
  players(reopened)[0].props.onComplete();
  await reopened.flush();
  assert.equal(playing(reopened)[0], first, "the restored screen still loops");
  await h.unmount();
  await reopened.unmount();
}
async function gridPickerAndSwap() {
  const { text } = require("./ui_harness");
  const scenes = ["a", "b", "c", "d", "e", "f", "g", "h"].map(id => ({
    id,
    title: id,
    paths: { stream: "/" + id },
    files: [{ duration: 10 }],
  }));
  // Grid places, swapped by CSS order; fitVideos() covers the packed layout.
  const settings = { rows: 1, columns: 2, sceneOrder: "list", randomStart: false, loopScenes: false, fitVideos: false };
  const players = h => h.nodes(node => node.type === "native-player");
  const playing = h => players(h).map(node => node.props.scene.id);
  const cells = h => h.nodes(node => /^ms-cell\b/.test(node.props.className ?? ""));
  const places = h => cells(h).map(node => node.props.style.order);
  const button = (h, label) => h.nodes(node => node.type === "IconButton" && node.props.ariaLabel === label)[0];
  const press = async (h, label) => {
    button(h, label).props.onClick();
    await h.flush();
  };
  const squares = h => h.nodes(node => /^ms-grid-square\b/.test(node.props.className ?? ""));
  const square = (h, columns, rows) => squares(h)[(rows - 1) * 6 + columns - 1];
  const lit = h => squares(h).filter(node => node.props.className.includes("ms-grid-square-on")).length;
  const dialog = h => h.nodes(node => node.type === "Dialog")[0];
  const choose = async (h, label) => {
    h.nodes(node => node.type === "Button" && text(node) === label)[0].props.onClick();
    await h.flush();
  };
  const pane = (h, index) =>
    [...h.media].find(([address, media]) => address.includes("ms-native-" + index) && media.video.isConnected)[1];
  const h = await start({ scenes, settings });

  // The picker belongs to edit mode and shows the current grid.
  assert.equal(squares(h).length, 0);
  await press(h, "Edit screens");
  assert.equal(squares(h).length, 36);
  assert.equal(lit(h), 2);
  assert.equal(square(h, 2, 1).props["aria-pressed"], true);
  assert.equal(square(h, 1, 1).props["aria-label"], "1 × 1: 1 screen");
  assert.equal(square(h, 3, 2).props["aria-label"], "3 × 2: 6 screens");
  square(h, 3, 2).props.onPointerEnter();
  await h.flush();
  assert.equal(lit(h), 6, "the squares under the pointer preview a grid");
  assert.equal(text(h.nodes(node => node.props.className === "ms-grid-size")[0]), "3 × 2");

  // The current grid asks nothing; another one asks first and a refusal changes nothing.
  square(h, 2, 1).props.onClick();
  await h.flush();
  assert.equal(dialog(h), undefined);
  square(h, 3, 2).props.onClick();
  await h.flush();
  assert.equal(dialog(h).props.ariaLabel, "Change the grid");
  assert.match(text(dialog(h)), /Change the grid to 3 × 2\?.*All 6 screens restart/);
  await choose(h, "Cancel");
  assert.equal(dialog(h), undefined);
  assert.equal(players(h).length, 2);
  assert.equal(h.saved.length, 0);

  // A press dragged to another square chooses it; confirming saves the grid and deals every screen again.
  square(h, 1, 1).props.onPointerDown({ pointerId: 1, currentTarget: { hasPointerCapture: () => false } });
  square(h, 2, 2).props.onPointerUp();
  await h.flush();
  assert.match(text(dialog(h)), /Change the grid to 2 × 2\?/);
  await choose(h, "Change grid");
  await h.flush();
  assert.equal(dialog(h), undefined);
  assert.equal(players(h).length, 4);
  assert.deepEqual(JSON.parse(JSON.stringify(h.saved.at(-1))), {
    id: "multiscreen",
    settings: { ...settings, rows: 2, columns: 2 },
  });
  assert.equal(square(h, 2, 2).props["aria-pressed"], true, "edit mode stays on with the new grid");
  assert.deepEqual(places(h), [0, 1, 2, 3]);

  // Two clicks swap two screens. Each keeps its player; only its place and its screen number change.
  const before = playing(h);
  const video = pane(h, 0).video;
  await press(h, "Move screen 1");
  assert.equal(button(h, "Cancel moving screen 1").props.pressed, true);
  assert.match(cells(h)[0].props.className, /ms-swap-source/);
  await press(h, "Swap with screen 3");
  assert.deepEqual(places(h), [2, 1, 0, 3]);
  assert.deepEqual(playing(h), before);
  assert.equal(pane(h, 0).video, video, "a moved screen keeps its player");
  assert.equal(video.pauseCount, 0, "and keeps playing");
  assert.equal(cells(h)[0].props.className, "ms-cell");
  await press(h, "Flip screen 3 horizontally");
  assert.equal(cells(h)[0].props.className, "ms-cell ms-flip-x", "controls are numbered by place");

  // Picking a screen up again puts it down.
  await press(h, "Move screen 2");
  await press(h, "Cancel moving screen 2");
  assert.deepEqual(places(h), [2, 1, 0, 3]);

  // Dragging a move button onto another screen swaps them; the click that ends the drag picks nothing up.
  const handle = index => h.nodes(node => node.props.className === "ms-move-handle")[index];
  // The lifted screen follows the pointer through its own style and is skipped when looking for the screen under it.
  const lifted = { style: {}, dataset: { msScreen: "3" } };
  const under = { dataset: { msScreen: "1" } };
  h.document.elementsFromPoint = () => [{ closest: () => lifted }, { closest: () => null }, { closest: () => under }];
  const move = (clientX, clientY) =>
    handle(3).props.onPointerMove({ pointerId: 7, clientX, clientY, currentTarget: { hasPointerCapture: () => true } });
  handle(3).props.onPointerDown({
    pointerId: 7,
    clientX: 100,
    clientY: 100,
    currentTarget: { setPointerCapture() {}, closest: () => lifted },
  });
  move(102, 103);
  await h.flush();
  assert.deepEqual(lifted.style, {}, "a press that barely moves lifts nothing");
  assert.equal(
    cells(h).some(node => /ms-swap/.test(node.props.className)),
    false,
  );
  move(140, 70);
  await h.flush();
  assert.equal(lifted.style.transform, "translate(40px, -30px) scale(0.6)");
  assert.equal(lifted.style.zIndex, "6");
  assert.match(cells(h)[3].props.className, /ms-swap-source/);
  assert.match(cells(h)[1].props.className, /ms-swap-target/);
  handle(3).props.onPointerUp();
  await h.flush();
  assert.deepEqual(lifted.style, { transform: "", zIndex: "" }, "a released screen goes back into the grid");
  assert.deepEqual(places(h), [2, 3, 0, 1]);
  button(h, "Move screen 2").props.onClick();
  await h.flush();
  assert.equal(
    cells(h).some(node => /ms-swap/.test(node.props.className)),
    false,
  );
  await h.tick();

  // A screen lifted and released over no other screen stays where it was, and is not picked up either.
  h.document.elementsFromPoint = () => [{ closest: () => lifted }];
  handle(3).props.onPointerDown({
    pointerId: 8,
    clientX: 0,
    clientY: 0,
    currentTarget: { setPointerCapture() {}, closest: () => lifted },
  });
  handle(3).props.onPointerMove({
    pointerId: 8,
    clientX: 30,
    clientY: 0,
    currentTarget: { hasPointerCapture: () => true },
  });
  await h.flush();
  assert.match(cells(h)[3].props.className, /ms-swap-source/);
  handle(3).props.onPointerUp();
  await h.flush();
  button(h, "Move screen 2").props.onClick();
  await h.flush();
  assert.deepEqual(places(h), [2, 3, 0, 1]);
  assert.equal(
    cells(h).some(node => /ms-swap/.test(node.props.className)),
    false,
  );
  await h.tick();

  // Leaving edit mode drops a screen that was picked up.
  await press(h, "Move screen 1");
  await press(h, "Finish editing screens");
  assert.equal(
    cells(h).some(node => /ms-swap/.test(node.props.className)),
    false,
  );
  assert.equal(squares(h).length, 0);

  // The saved session returns every screen to its place.
  h.window.emit("pagehide");
  assert.deepEqual(JSON.parse(h.localStorage.get("multiscreen.session")).order, [2, 3, 0, 1]);
  const reopened = await start({
    scenes,
    settings: { ...settings, rows: 2, columns: 2 },
    localStorage: new Map(h.localStorage),
  });
  assert.deepEqual(places(reopened), [2, 3, 0, 1]);
  assert.deepEqual(playing(reopened), playing(h));
  await h.unmount();
  await reopened.unmount();
}
async function fitVideos() {
  const { requireSource } = require("./plugin_paths");
  const { fitLayout } = requireSource("DirtyMultiscreen", "src/domain/layout.ts");
  const scenes = [16 / 9, 9 / 16, 4 / 3, 1, 2.4, 9 / 16].map((aspect, index) => ({
    id: String(index),
    title: "Shape " + index,
    paths: { stream: "/" + index },
    files: [{ duration: 100, width: aspect * 900, height: 900 }],
  }));
  const settings = { rows: 2, columns: 2, sceneOrder: "list", randomStart: false, loopScenes: false };
  // Screens fit their videos unless the setting says otherwise.
  const fresh = await start({ scenes, settings });
  assert.equal(fresh.nodes(node => node.props.className === "ms-grid ms-native-grid ms-fit").length, 1);
  await fresh.unmount();
  const h = await start({ scenes, settings: { ...settings, fitVideos: false } });
  const players = h => h.nodes(node => node.type === "native-player");
  const cells = h => h.nodes(node => /^ms-cell\b/.test(node.props.className ?? ""));
  const rectangles = h => JSON.parse(JSON.stringify(cells(h).map(node => node.props.style)));
  const fit = h => h.nodes(node => node.props.className === "ms-fit-toggle")[0];
  const press = async (h, label) => {
    h.button(label).props.onClick();
    await h.flush();
  };
  const toggle = async h => {
    fit(h).props.onClick();
    await h.flush();
  };
  const alive = () => [...h.media.values()].filter(pair => pair.video.isConnected);
  const verify = (order = [0, 1, 2, 3]) => {
    const aspects = [];
    players(h).forEach((player, index) => {
      const file = player.props.scene.files[0];
      aspects[order[index]] = file.width / file.height;
    });
    const expected = fitLayout(aspects, h.window.innerWidth, h.window.innerHeight);
    assert.deepEqual(
      rectangles(h),
      order.map(place => expected[place]),
    );
  };
  assert.equal(fit(h), undefined);
  await press(h, "Edit screens");
  assert.equal(fit(h).props["aria-pressed"], false);
  await press(h, "Fill screen 1 with the picture");
  const original = alive();
  original.forEach((pair, index) => {
    pair.video.currentTime = 20 + index;
  });
  const queries = h.calls.length;
  await toggle(h);
  assert.equal(h.saved.at(-1).settings.fitVideos, true);
  assert.equal(fit(h).props["aria-pressed"], true);
  assert.equal(h.calls.length, queries, "fit toggles perform no GraphQL query");
  assert.deepEqual(alive(), original, "all native player and video objects survive");
  assert.deepEqual(
    alive().map(pair => pair.video.currentTime),
    [20, 21, 22, 23],
    "no seeking",
  );
  assert.equal(h.button("Fill screen 1 is controlled by Fit videos").props.disabled, true);
  verify();
  const beforeNext = rectangles(h);
  players(h)[0].props.onNext();
  await h.flush();
  assert.notDeepEqual(rectangles(h), beforeNext, "another shape reflows");
  verify();
  const beforeSwap = alive();
  const beforeSwapRects = rectangles(h);
  await press(h, "Move screen 1");
  await press(h, "Swap with screen 2");
  assert.deepEqual(alive(), beforeSwap, "swapping a fitted screen preserves every player");
  assert.notDeepEqual(rectangles(h), beforeSwapRects);
  verify([1, 0, 2, 3]);
  await h.resize(733, 1101);
  verify([1, 0, 2, 3]);
  assert.deepEqual(alive(), beforeSwap, "resizing preserves players");
  h.window.emit("pagehide");
  const stored = new Map(h.localStorage);
  const reopened = await start({
    scenes,
    settings: h.saved.at(-1).settings,
    localStorage: stored,
    width: 733,
    height: 1101,
  });
  assert.deepEqual(rectangles(reopened), rectangles(h), "session restore preserves layout and places");
  assert.deepEqual(
    players(reopened).map(node => node.props.scene.id),
    players(h).map(node => node.props.scene.id),
  );
  await toggle(h);
  assert.equal(h.saved.at(-1).settings.fitVideos, false);
  assert.deepEqual(rectangles(h), [{ order: 1 }, { order: 0 }, { order: 2 }, { order: 3 }]);
  assert.equal(h.button("Fill screen 2 with the picture").props.pressed, true, "saved fill returns after fit");
  assert.equal(h.button("Fill screen 1 with the picture").props.pressed, false);
  assert.equal(h.calls.length, queries);
  assert.deepEqual(alive(), beforeSwap);
  await toggle(h);
  const metadataVideo = alive()[0].video;
  const beforeMetadata = rectangles(h);
  metadataVideo.videoWidth = 450;
  metadataVideo.videoHeight = 1600;
  h.grid.emit("loadedmetadata", { target: metadataVideo });
  await h.flush();
  assert.notDeepEqual(rectangles(h), beforeMetadata, "native dimensions override stored sizes");
  const measured = rectangles(h);
  metadataVideo.videoWidth = 0;
  h.grid.emit("resize", { target: metadataVideo });
  await h.flush();
  assert.deepEqual(rectangles(h), measured, "empty native metadata never replaces a known size");
  metadataVideo.videoWidth = 1600;
  metadataVideo.videoHeight = 900;
  h.grid.emit("resize", { target: metadataVideo });
  await h.flush();
  assert.notDeepEqual(rectangles(h), measured, "native source size changes reflow");
  assert.deepEqual(alive(), beforeSwap);
  await h.unmount();
  await reopened.unmount();
  assert.equal(h.window.handlers.get("resize").size, 0, "resize listener is cleaned up");
  assert.equal(h.grid.handlers.get("loadedmetadata").size, 0);
  assert.equal(h.grid.handlers.get("resize").size, 0);

  const failed = await start({ scenes, settings: { ...settings, fitVideos: false }, saveFails: true });
  await press(failed, "Edit screens");
  const count = failed.calls.length;
  await toggle(failed);
  assert.equal(fit(failed).props["aria-pressed"], true);
  assert.match(failed.notices.at(-1).message, /Could not save the layout/);
  assert.equal(failed.calls.length, count);
  await failed.unmount();
}
async function closeScreens() {
  const { text } = require("./ui_harness");
  const { requireSource } = require("./plugin_paths");
  const { fitLayout } = requireSource("DirtyMultiscreen", "src/domain/layout.ts");
  const scenes = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id, index) => ({
    id,
    title: id,
    paths: { stream: "/" + id },
    files: [{ duration: 100, width: index % 2 ? 900 : 1600, height: 900 }],
  }));
  const settings = { rows: 2, columns: 2, sceneOrder: "list", randomStart: false, loopScenes: false, fitVideos: false };
  const players = h => h.nodes(node => node.type === "native-player");
  const playing = h => players(h).map(node => node.props.scene.id);
  const cells = h => h.nodes(node => /^ms-cell\b/.test(node.props.className ?? ""));
  const places = h => cells(h).map(node => node.props.style.order);
  const button = (h, label) => h.nodes(node => node.type === "IconButton" && node.props.ariaLabel === label)[0];
  const press = async (h, label) => {
    button(h, label).props.onClick();
    await h.flush();
  };
  const pane = (h, index) =>
    [...h.media].find(([address, media]) => address.includes("ms-native-" + index) && media.video.isConnected)[1];
  const h = await start({ scenes, settings });
  await press(h, "Edit screens");
  const [first, second, third, fourth] = playing(h);
  const kept = [0, 2, 3].map(index => pane(h, index).video);
  pane(h, 1).video.currentTime = 7;

  // Closing a screen stops only that one; the others keep playing and close up behind it.
  await press(h, "Close screen 2");
  assert.deepEqual(playing(h), [first, third, fourth]);
  assert.deepEqual(places(h), [0, 1, 2], "the remaining screens fill the grid in place order");
  assert.deepEqual(
    [0, 2, 3].map(index => pane(h, index).video),
    kept,
    "the other screens keep their players",
  );
  assert.equal(
    kept.some(video => video.pauseCount),
    false,
  );
  assert.ok(button(h, "Move screen 3"), "screens are numbered among the open ones");
  assert.equal(button(h, "Move screen 4"), undefined);

  // With Fit videos the open screens pack the window by themselves.
  h.nodes(node => node.props.className === "ms-fit-toggle")[0].props.onClick();
  await h.flush();
  const aspects = players(h).map(node => node.props.scene.files[0].width / node.props.scene.files[0].height);
  assert.deepEqual(
    JSON.parse(JSON.stringify(cells(h).map(node => node.props.style))),
    fitLayout(aspects, h.window.innerWidth, h.window.innerHeight),
  );
  h.nodes(node => node.props.className === "ms-fit-toggle")[0].props.onClick();
  await h.flush();

  // The closed screen stays closed in the saved session, and + returns it to its scene and place.
  h.window.emit("pagehide");
  assert.deepEqual(JSON.parse(h.localStorage.get("multiscreen.session")).closed, [1]);
  const resumed = await start({ scenes, settings: h.saved.at(-1).settings, localStorage: new Map(h.localStorage) });
  assert.deepEqual(playing(resumed), [first, third, fourth]);
  await press(resumed, "Edit screens");
  await press(resumed, "Add a screen");
  assert.deepEqual(playing(resumed), [first, second, third, fourth]);
  assert.deepEqual(places(resumed), [0, 1, 2, 3]);
  resumed.window.emit("pagehide");
  assert.equal(JSON.parse(resumed.localStorage.get("multiscreen.session")).closed, undefined);
  await resumed.unmount();

  // The last open screen cannot close, + brings back the screen closed last, and another grid opens every screen.
  await press(h, "Close screen 1");
  await press(h, "Close screen 1");
  assert.deepEqual(playing(h), [fourth]);
  assert.equal(button(h, "Close screen 1 is unavailable: it is the only open screen").props.disabled, true);
  await press(h, "Add a screen");
  assert.deepEqual(playing(h), [third, fourth]);
  const squares = h.nodes(node => /^ms-grid-square\b/.test(node.props.className ?? ""));
  squares[2].props.onClick();
  await h.flush();
  h.nodes(node => node.type === "Button" && text(node) === "Change grid")[0].props.onClick();
  await h.flush();
  await h.flush();
  assert.equal(players(h).length, 3);
  h.window.emit("pagehide");
  assert.equal(JSON.parse(h.localStorage.get("multiscreen.session")).closed, undefined);
  await h.unmount();
}
async function customRows() {
  const { text } = require("./ui_harness");
  const { requireSource } = require("./plugin_paths");
  const { customRectangles } = requireSource("DirtyMultiscreen", "src/domain/custom.ts");
  // R(...) is a row, C(...) a column, a number a screen's pane; "*n" is a size other than 1.
  const shape = node => {
    const size = node.size === 1 ? "" : `*${node.size}`;
    return node.children
      ? `${node.axis === "row" ? "R" : "C"}${size}(${node.children.map(shape).join(" ")})`
      : `${node.pane}${size}`;
  };
  const scenes = ["a", "b", "c", "d", "e", "f"].map((id, index) => ({
    id,
    title: id,
    paths: { stream: "/" + id },
    files: [{ duration: 100, width: index % 2 ? 1200 : 1600, height: 900 }],
  }));
  const settings = { rows: 2, columns: 2, sceneOrder: "list", randomStart: false, loopScenes: false, fitVideos: false };
  const players = h => h.nodes(node => node.type === "native-player");
  const playing = h => players(h).map(node => node.props.scene.id);
  const cells = h => h.nodes(node => /^ms-cell\b/.test(node.props.className ?? ""));
  // Each open screen's box as [left, top, width, height], by pane.
  const boxes = h =>
    cells(h).map(node => {
      const { left, top, width, height } = node.props.style;
      return [left, top, width, height].map(Math.round);
    });
  const handles = h => h.nodes(node => /^ms-resize-handle\b/.test(node.props.className ?? ""));
  const handle = (h, screen, edge) =>
    handles(h).find(
      node => node.props.title === `Drag to resize screen ${screen}` && node.props.className.endsWith(edge),
    );
  const button = (h, label) => h.nodes(node => node.type === "IconButton" && node.props.ariaLabel === label)[0];
  const press = async (h, label) => {
    button(h, label).props.onClick();
    await h.flush();
  };
  const label = h => text(h.nodes(node => node.props.className === "ms-grid-size")[0]);
  const squares = h => h.nodes(node => /^ms-grid-square\b/.test(node.props.className ?? ""));
  const pane = (h, index) =>
    [...h.media].find(([address, media]) => address.includes("ms-native-" + index) && media.video.isConnected)[1];
  // Presses an edge, moves it by x and y, and returns the boxes on show before it is released.
  // `after` is the screen's number once the drag has moved it in reading order.
  const drag = async (h, screen, edge, x, y, after = screen) => {
    const target = handle(h, screen, edge);
    assert.ok(target, `screen ${screen} has a ${edge} edge`);
    target.props.onPointerDown({
      button: 0,
      pointerId: 3,
      clientX: 100,
      clientY: 100,
      preventDefault() {},
      stopPropagation() {},
      currentTarget: { setPointerCapture() {} },
    });
    // The first move can come before the press renders.
    target.props.onPointerMove({
      pointerId: 3,
      clientX: 100 + x,
      clientY: 100 + y,
      currentTarget: { hasPointerCapture: () => true },
    });
    await h.flush();
    const during = boxes(h);
    // The edge stays under the pointer until it is released, whatever moved around it.
    const held = handle(h, after, edge);
    assert.ok(held, `screen ${after} still holds its ${edge} edge`);
    // Handles keep one order, since moving the held one in the page would drop its pointer.
    const order = handles(h)
      .filter(node => node.props.title === held.props.title)
      .map(node => ["top", "right", "bottom", "left"].findIndex(name => node.props.className.endsWith(name)));
    assert.deepEqual(
      order,
      order.slice().sort((first, second) => first - second),
    );
    held.props.onPointerUp();
    await h.flush();
    return during;
  };
  // The window is 1600 x 900.
  const h = await start({ scenes, settings });
  assert.equal(handles(h).length, 0, "only edit mode drags edges");
  await press(h, "Edit screens");
  const [first, second, third, fourth] = playing(h);
  assert.equal(label(h), "2 × 2");
  assert.equal(handles(h).length, 8, "each screen of a 2 x 2 grid has two edges facing others");
  assert.equal(handle(h, 1, "left"), undefined);

  // Less than half a screen changes nothing.
  await drag(h, 1, "right", 300, 0);
  assert.equal(label(h), "2 × 2");
  assert.equal(cells(h)[0].props.style.left, undefined);

  // Screen 1 takes the top row and screen 2 goes down: three screens share the second row. Every screen plays on.
  const videos = [0, 1, 2, 3].map(index => pane(h, index).video);
  const during = await drag(h, 1, "right", 820, 30);
  const twoRows = [
    [0, 0, 1600, 450],
    [0, 450, 533, 450],
    [533, 450, 534, 450],
    [1067, 450, 533, 450],
  ];
  assert.deepEqual(during, twoRows, "the screens move while the edge is dragged");
  assert.deepEqual(boxes(h), twoRows);
  assert.deepEqual(playing(h), [first, second, third, fourth]);
  assert.deepEqual(
    [0, 1, 2, 3].map(index => pane(h, index).video),
    videos,
  );
  assert.equal(
    videos.some(video => video.pauseCount),
    false,
  );
  // The grid has become custom rows.
  assert.equal(label(h), "Custom");
  assert.equal(
    squares(h).some(node => node.props["aria-pressed"]),
    false,
  );
  assert.equal(handle(h, 1, "right"), undefined, "a screen alone in its row has no side edge");
  assert.ok(handle(h, 1, "bottom") && handle(h, 2, "right") && handle(h, 3, "left"));

  // Screen 2 takes its whole row, and screens 3 and 4 go down to a third row.
  await drag(h, 2, "right", 1070, 0);
  assert.deepEqual(boxes(h), [
    [0, 0, 1600, 300],
    [0, 300, 1600, 300],
    [0, 600, 800, 300],
    [800, 600, 800, 300],
  ]);
  // A bottom edge makes its row taller: one more unit of the three rows.
  await drag(h, 1, "bottom", 0, 310);
  assert.deepEqual(boxes(h), [
    [0, 0, 1600, 450],
    [0, 450, 1600, 225],
    [0, 675, 800, 225],
    [800, 675, 800, 225],
  ]);
  h.window.emit("pagehide");
  const saved = JSON.parse(h.localStorage.get("multiscreen.session"));
  assert.equal(shape(saved.layout), "C(0*2 1 R(2 3))");
  const resumed = await start({ scenes, settings, localStorage: new Map(h.localStorage) });
  assert.deepEqual(boxes(resumed), boxes(h), "a resumed session keeps its rows");
  await press(resumed, "Edit screens");
  assert.equal(label(resumed), "Custom");
  await resumed.unmount();

  // Swapping trades cells; closing a screen gives its room to the others and + puts it back in its cell.
  await press(h, "Move screen 1");
  await press(h, "Swap with screen 4");
  assert.deepEqual(boxes(h), [
    [800, 675, 800, 225],
    [0, 450, 1600, 225],
    [0, 675, 800, 225],
    [0, 0, 1600, 450],
  ]);
  await press(h, "Close screen 2");
  assert.deepEqual(playing(h), [first, third, fourth]);
  assert.deepEqual(boxes(h), [
    [800, 600, 800, 300],
    [0, 600, 800, 300],
    [0, 0, 1600, 600],
  ]);
  await press(h, "Add a screen");
  assert.deepEqual(boxes(h), [
    [800, 675, 800, 225],
    [0, 450, 1600, 225],
    [0, 675, 800, 225],
    [0, 0, 1600, 450],
  ]);

  // Fitted videos keep the layout and their shapes; the larger first row makes its video larger.
  h.nodes(node => node.props.className === "ms-fit-toggle")[0].props.onClick();
  await h.flush();
  const aspect = pane => [16 / 9, 4 / 3, 16 / 9, 4 / 3][pane];
  const layoutOf = h => {
    h.window.emit("pagehide");
    return JSON.parse(h.localStorage.get("multiscreen.session")).layout;
  };
  const fitted = h =>
    customRectangles(layoutOf(h), [], 1600, 900, 1, aspect).map(({ left, top, width, height }) =>
      [left, top, width, height].map(Math.round),
    );
  const shapes = h =>
    boxes(h).forEach(([, , width, height], index) => assert.ok(Math.abs(width / height - aspect(index)) < 0.02));
  assert.deepEqual(boxes(h), fitted(h));
  shapes(h);
  assert.equal(handle(h, 1, "bottom"), undefined, "a fitted screen with its row to itself has no edge to move");
  assert.ok(handle(h, 3, "top"), "a screen at the end of its row still reaches up");
  // A side edge still pushes screens down: screen 3 takes the bottom row and screen 4 gets a row of its own.
  await drag(h, 3, "right", boxes(h)[2][2] + 10, 0);
  assert.equal(shape(layoutOf(h)), "C(3*2 1 2 0)");
  assert.deepEqual(boxes(h), fitted(h));
  assert.equal(handles(h).length, 0, "one screen per row leaves no edge that moves");
  h.nodes(node => node.props.className === "ms-fit-toggle")[0].props.onClick();
  await h.flush();

  // The same grid's square brings the grid back without dealing again: the screens keep playing in reading order.
  const before = [0, 1, 2, 3].map(index => pane(h, index).video);
  squares(h)[7].props.onClick();
  await h.flush();
  assert.equal(h.nodes(node => node.type === "Dialog").length, 0);
  assert.equal(label(h), "2 × 2");
  assert.deepEqual(
    [0, 1, 2, 3].map(index => pane(h, index).video),
    before,
  );
  assert.deepEqual(
    cells(h).map(node => node.props.style.order),
    [3, 1, 2, 0],
  );
  h.window.emit("pagehide");
  assert.equal(JSON.parse(h.localStorage.get("multiscreen.session")).layout, undefined);

  // Screen 2 dragged down takes its column; screens 3 and 4 keep their row, beside screen 1's.
  // It reads last now, so it becomes screen 4.
  await drag(h, 2, "bottom", 0, 460, 4);
  assert.equal(label(h), "Custom");
  assert.deepEqual(boxes(h), [
    [400, 450, 400, 450],
    [800, 0, 800, 900],
    [0, 450, 400, 450],
    [0, 0, 800, 450],
  ]);
  assert.equal(handle(h, 4, "bottom"), undefined, "its bottom is now the window's edge");
  assert.deepEqual(
    [0, 1, 2, 3].map(index => pane(h, index).video),
    before,
  );

  // Another grid asks first, deals again and starts from its own grid.
  await drag(h, 1, "right", 820, 0);
  assert.equal(label(h), "Custom");
  squares(h)[8].props.onClick();
  await h.flush();
  h.nodes(node => node.type === "Button" && text(node) === "Change grid")[0].props.onClick();
  await h.flush();
  await h.flush();
  assert.equal(label(h), "3 × 2");
  assert.equal(players(h).length, 6);
  assert.equal(cells(h)[0].props.style.left, undefined);
  await h.unmount();
}
async function addScreens() {
  const { text } = require("./ui_harness");
  const { requireSource } = require("./plugin_paths");
  const { growGrid } = requireSource("DirtyMultiscreen", "src/domain/settings.ts");
  // A column while the grid is no wider than tall, else a row, up to 6 x 6.
  assert.deepEqual(growGrid({ columns: 1, rows: 1 }), { columns: 2, rows: 1 });
  assert.deepEqual(growGrid({ columns: 2, rows: 1 }), { columns: 2, rows: 2 });
  assert.deepEqual(growGrid({ columns: 2, rows: 2 }), { columns: 3, rows: 2 });
  assert.deepEqual(growGrid({ columns: 6, rows: 3 }), { columns: 6, rows: 4 });
  assert.deepEqual(growGrid({ columns: 1, rows: 6 }), { columns: 2, rows: 6 });
  assert.equal(growGrid({ columns: 6, rows: 6 }), null);
  const scenes = Array.from({ length: 12 }, (_, index) => ({
    id: String.fromCharCode(97 + index),
    title: String.fromCharCode(97 + index),
    paths: { stream: "/" + index },
    files: [{ duration: 100 }],
  }));
  const settings = {
    rows: 1,
    columns: 2,
    sceneOrder: "random",
    randomStart: false,
    loopScenes: false,
    fitVideos: false,
  };
  const players = h => h.nodes(node => node.type === "native-player");
  const playing = h => players(h).map(node => node.props.scene.id);
  const cells = h => h.nodes(node => /^ms-cell\b/.test(node.props.className ?? ""));
  const places = h => cells(h).map(node => node.props.style.order);
  const squares = h => h.nodes(node => /^ms-grid-square\b/.test(node.props.className ?? ""));
  const button = (h, label) => h.nodes(node => node.type === "IconButton" && node.props.ariaLabel === label)[0];
  const press = async (h, label) => {
    button(h, label).props.onClick();
    await h.flush();
  };
  const pane = (h, index) =>
    [...h.media].find(([address, media]) => address.includes("ms-native-" + index) && media.video.isConnected)[1];
  const session = h => {
    h.window.emit("pagehide");
    return JSON.parse(h.localStorage.get("multiscreen.session"));
  };
  const h = await start({ scenes, settings });
  assert.ok(button(h, "Add a screen"), "+ shows outside edit mode");
  await press(h, "Edit screens");
  const before = playing(h);
  const videos = [0, 1].map(index => pane(h, index).video);
  videos.forEach((video, index) => {
    video.currentTime = 30 + index;
  });
  const queries = h.calls.length;

  // A full grid grows by a row and opens one new screen; the playing screens go on and nothing is queried.
  await press(h, "Add a screen");
  assert.equal(players(h).length, 3);
  assert.deepEqual(playing(h).slice(0, 2), before);
  assert.deepEqual(
    [0, 1].map(index => pane(h, index).video),
    videos,
    "the playing screens keep their players",
  );
  assert.deepEqual(
    videos.map(video => [video.currentTime, video.pauseCount]),
    [
      [30, 0],
      [31, 0],
    ],
  );
  assert.equal(h.calls.length, queries, "growing deals no new queue");
  assert.equal(before.includes(playing(h)[2]), false, "the new screen plays another scene");
  assert.deepEqual(JSON.parse(JSON.stringify(h.saved.at(-1).settings)), { ...settings, rows: 2, columns: 2 });
  assert.equal(squares(h)[7].props["aria-pressed"], true, "the picker shows the grown grid");

  // The rest of the new row waits as a closed screen: + opens it, then grows the grid again.
  assert.deepEqual(session(h).closed, [3]);
  await press(h, "Add a screen");
  assert.equal(players(h).length, 4);
  await press(h, "Move screen 1");
  await press(h, "Swap with screen 4");
  const swapped = playing(h);
  await press(h, "Add a screen");
  assert.deepEqual(playing(h).slice(0, 4), swapped);
  assert.deepEqual(places(h), [3, 1, 2, 0, 4], "added screens take places after the others");
  assert.deepEqual(
    [0, 1].map(index => pane(h, index).video),
    videos,
  );
  assert.equal(h.calls.length, queries);
  const grown = session(h);
  assert.deepEqual(grown.deal, { rows: 1, columns: 2 }, "the session keeps the grid its queue was dealt for");
  assert.deepEqual(grown.closed, [5]);
  assert.deepEqual(JSON.parse(JSON.stringify(h.saved.at(-1).settings)), { ...settings, rows: 2, columns: 3 });

  // A reload resumes the same scenes under the same queue.
  const resumed = await start({ scenes, settings: h.saved.at(-1).settings, localStorage: new Map(h.localStorage) });
  assert.deepEqual(playing(resumed), playing(h));
  const resumedScenes = playing(resumed);
  await press(resumed, "Edit screens");
  await press(resumed, "Add a screen");
  assert.deepEqual(playing(resumed).slice(0, 5), resumedScenes);
  assert.equal(players(resumed).length, 6);
  await resumed.unmount();

  // Choosing a grid in the picker deals a new queue for it.
  squares(h)[0].props.onClick();
  await h.flush();
  h.nodes(node => node.type === "Button" && text(node) === "Change grid")[0].props.onClick();
  await h.flush();
  await h.flush();
  assert.equal(players(h).length, 1);
  assert.equal(session(h).deal, undefined);
  await h.unmount();

  // At 6 x 6 with every screen open there is nothing to add.
  const full = await start({ scenes, settings: { ...settings, rows: 6, columns: 6 } });
  await press(full, "Edit screens");
  assert.equal(button(full, "Add a screen: the grid is at its largest").props.disabled, true);
  await full.unmount();
}
async function rotation() {
  const { requireSource } = require("./plugin_paths");
  const { fitLayout } = requireSource("DirtyMultiscreen", "src/domain/layout.ts");
  const { isSession } = requireSource("DirtyMultiscreen", "src/domain/session.ts");
  const scenes = [16 / 9, 4 / 3, 9 / 16, 1].map((aspect, index) => ({
    id: String(index),
    title: "Rotation " + index,
    paths: { stream: "/" + index },
    files: [{ duration: 100, width: 900 * aspect, height: 900 }],
  }));
  const players = h => h.nodes(node => node.type === "native-player");
  const cells = h => h.nodes(node => /^ms-cell\b/.test(node.props.className ?? ""));
  const rectangles = h => JSON.parse(JSON.stringify(cells(h).map(node => node.props.style)));
  const pane = (h, index) =>
    [...h.media].find(([address, pair]) => address.includes("ms-native-" + index) && pair.video.isConnected)[1];
  const press = async (h, label) => {
    h.button(label).props.onClick();
    await h.flush();
  };
  const rotate = (h, degrees, screen = 1) => press(h, `Rotate screen ${screen} 90° clockwise (${degrees}°)`);
  for (const fitVideos of [false, true]) {
    const settings = {
      rows: 1,
      columns: 2,
      sceneOrder: "list",
      splitScenes: true,
      randomStart: false,
      loopScenes: false,
      fitVideos,
    };
    const h = await start({ scenes, settings });
    await press(h, "Edit screens");
    const originals = [pane(h, 0), pane(h, 1)];
    originals[0].video.currentTime = 37;
    const queries = h.calls.length;
    const initial = rectangles(h);
    const verify = (turns, order = [0, 1], base = 16 / 9) => {
      const aspects = [];
      aspects[order[0]] = turns % 2 ? 1 / base : base;
      aspects[order[1]] = 4 / 3;
      const expected = fitVideos
        ? fitLayout(aspects, h.window.innerWidth, h.window.innerHeight)
        : order.map(place => ({ order: place }));
      assert.deepEqual(rectangles(h), fitVideos ? order.map(place => expected[place]) : expected);
      assert.equal(cells(h)[0].props.className.includes(`ms-rotate-${turns * 90}`), turns !== 0);
    };
    for (let turns = 1; turns <= 4; turns++) {
      await rotate(h, (turns - 1) * 90);
      verify(turns % 4);
      assert.equal(h.button(`Rotate screen 1 90° clockwise (${(turns % 4) * 90}°)`).props.pressed, turns !== 4);
      assert.equal(pane(h, 0), originals[0]);
      assert.equal(pane(h, 1), originals[1]);
      assert.equal(originals[0].video.currentTime, 37, "rotation never seeks");
      assert.equal(originals[0].video.pauseCount, 0);
      assert.equal(h.calls.length, queries, "rotation never refetches");
    }
    assert.deepEqual(rectangles(h), initial, "four turns restore the original layout");
    await rotate(h, 0);
    await press(h, "Flip screen 1 horizontally");
    await press(h, "Flip screen 1 vertically");
    assert.match(cells(h)[0].props.className, /ms-flip-x ms-flip-y ms-rotate-90/);
    await press(h, "Move screen 1");
    await press(h, "Swap with screen 2");
    verify(1, [1, 0]);
    await h.resize(901, 1201);
    verify(1, [1, 0]);
    // Native metadata remains unrotated; each update is inverted exactly once.
    const video = originals[0].video;
    video.videoWidth = 1200;
    video.videoHeight = 900;
    h.grid.emit("loadedmetadata", { target: video });
    await h.flush();
    verify(1, [1, 0], 4 / 3);
    h.grid.emit("resize", { target: video });
    await h.flush();
    verify(1, [1, 0], 4 / 3);
    // The next item has no rotation; returning brings the original picture choices back.
    players(h)[0].props.onNext();
    await h.flush();
    assert.doesNotMatch(cells(h)[0].props.className, /ms-rotate|ms-flip/);
    players(h)[0].props.onPrevious();
    await h.flush();
    verify(1, [1, 0]);
    h.window.emit("pagehide");
    const saved = JSON.parse(h.localStorage.get("multiscreen.session"));
    assert.deepEqual(saved.panes[0].view.rotation, { itemId: "0", turns: 1 });
    assert.equal(isSession(saved), true);
    for (const invalid of [0, 4, -1, 1.5, "1", null]) {
      saved.panes[0].view.rotation.turns = invalid;
      assert.equal(isSession(saved), false, "invalid saved rotations are rejected");
    }
    const reopened = await start({ scenes, settings, localStorage: new Map(h.localStorage), width: 901, height: 1201 });
    assert.deepEqual(rectangles(reopened), rectangles(h));
    assert.equal(cells(reopened)[0].props.className, cells(h)[0].props.className);
    await h.unmount();
    await reopened.unmount();
  }
}
async function savedGrids() {
  const { text } = require("./ui_harness");
  const SESSION = "multiscreen.session";
  const scenes = Array.from({ length: 12 }, (_, index) => ({
    id: String(index),
    title: "Scene " + index,
    paths: { stream: "/" + index },
    files: [{ duration: 100 }],
  }));
  // Named grids only; recentGrids() covers the ones saved while playing.
  const settings = {
    rows: 1,
    columns: 2,
    sceneOrder: "list",
    randomStart: false,
    loopScenes: false,
    recentGrids: 0,
    fitVideos: false,
  };
  const grids = new Map();
  // Like the real hub, settings read after a save are the saved ones.
  const launch = async (stored, extra) => {
    const options = { scenes, grids, ...extra };
    let h = null;
    options.loadSettings = () => h?.saved.at(-1)?.settings ?? stored;
    h = await start(options);
    h.options = options;
    return h;
  };
  const players = h => h.nodes(node => node.type === "native-player");
  const playing = h => players(h).map(node => node.props.scene.id);
  const cells = h => h.nodes(node => /^ms-cell\b/.test(node.props.className ?? ""));
  const places = h => cells(h).map(node => node.props.style.order);
  const pane = (h, index) =>
    [...h.media].find(([address, media]) => address.includes("ms-native-" + index) && media.video.isConnected)[1];
  const press = async (h, label) => {
    h.button(label).props.onClick();
    await h.flush();
  };
  const dialog = h => h.nodes(node => node.type === "Dialog" && node.props.ariaLabel === "Saved grids")[0];
  const named = (h, label) => h.nodes(node => node.type === "Button" && text(node) === label)[0];
  const openButton = (h, name) => h.nodes(node => node.type === "Button" && node.props.ariaLabel === "Open " + name)[0];
  const submit = async (h, form, value, field) => {
    h.nodes(node => node.type === "input" && field(node))[0].props.onChange({ target: { value } });
    await h.flush();
    h.nodes(node => node.type === "form")[form].props.onSubmit({ preventDefault() {} });
    await h.flush();
  };
  const nameField = node => node.props.placeholder === "Name for this grid";
  const modes = h => h.operations.map(operation => operation.args.mode);
  const h = await launch(settings);

  // Give the screens something worth keeping: a moved, filled, advanced and partly played grid.
  await press(h, "Edit screens");
  await press(h, "Fill screen 2 with the picture");
  await press(h, "Move screen 1");
  await press(h, "Swap with screen 2");
  await press(h, "Finish editing screens");
  players(h)[0].props.onNext();
  await h.flush();
  pane(h, 0).video.currentTime = 42;
  pane(h, 0).player.emit("timeupdate");
  const kept = playing(h);
  assert.deepEqual(places(h), [1, 0]);

  // The dialog lists nothing at first and saves the current screens under a name.
  assert.equal(dialog(h), undefined);
  await press(h, "Saved grids");
  assert.deepEqual(modes(h), ["gridList"]);
  assert.match(text(dialog(h)), /No saved grids yet\./);
  assert.equal(named(h, "Save").props.disabled, true, "a grid needs a name");
  await submit(h, 0, "  Evening   mix ", nameField);
  assert.deepEqual(modes(h), ["gridList", "gridSave", "gridList"]);
  assert.equal(grids.size, 1);
  const row = grids.get(1);
  assert.deepEqual([row.name, row.rows, row.columns], ["Evening mix", 1, 2]);
  const stored = JSON.parse(row.data);
  assert.deepEqual(stored.settings, {
    fitVideos: false,
    rows: 1,
    columns: 2,
    sceneOrder: "list",
    spreadScenes: true,
    avoidDuplicates: true,
    splitScenes: false,
  });
  assert.deepEqual(stored.session.order, [1, 0]);
  assert.deepEqual(
    stored.session.panes.map(entry => entry.itemId),
    kept,
  );
  assert.equal(stored.session.panes[0].time, 42);
  assert.deepEqual(stored.session.panes[1].view, { fill: true });
  for (const entry of stored.session.panes) {
    assert.equal(entry.item.id, entry.itemId, "every screen keeps its item, whatever queue comes later");
    assert.equal(entry.item.outsidePage, true);
  }
  assert.match(text(dialog(h)), /Evening mix.*2 × 1 · saved/);
  assert.equal(h.nodes(nameField)[0].props.value, "", "the name clears after a save");

  // Opening it replaces changed screens, and the replaced session's last save does not overwrite it.
  await press(h, "Close saved grids");
  players(h)[0].props.onNext();
  players(h)[1].props.onNext();
  await h.flush();
  assert.notDeepEqual(playing(h), kept);
  await press(h, "Saved grids");
  openButton(h, "Evening mix").props.onClick();
  await h.flush();
  await h.flush();
  assert.equal(dialog(h), undefined, "the player starts over with the saved grid");
  assert.deepEqual(playing(h), kept);
  assert.deepEqual(places(h), [1, 0]);
  assert.equal(pane(h, 0).video.currentTime, 42);
  assert.equal(cells(h)[1].props.className, "ms-cell ms-fill");
  assert.equal(JSON.parse(h.localStorage.get(SESSION)).panes[0].time, 42);

  // Under other settings and another grid, opening it brings its own grid and queue settings back.
  const other = await launch(
    { ...settings, rows: 2, columns: 2, sceneOrder: "random", splitScenes: true, fitVideos: true },
    { localStorage: new Map() },
  );
  assert.equal(players(other).length, 4);
  await press(other, "Saved grids");
  openButton(other, "Evening mix").props.onClick();
  await other.flush();
  await other.flush();
  assert.deepEqual(playing(other), kept);
  assert.deepEqual(places(other), [1, 0]);
  const applied = other.saved.at(-1).settings;
  assert.deepEqual(
    [applied.rows, applied.columns, applied.sceneOrder, applied.splitScenes],
    [1, 2, "list", false],
    "the saved grid's settings become the current ones",
  );
  await other.unmount();

  // Saved grids keep fit mode; a grid predating fit mode leaves the current choice alone.
  const fitted = await launch({ ...settings, fitVideos: true });
  await press(fitted, "Edit screens");
  await press(fitted, "Rotate screen 1 90° clockwise (0°)");
  await press(fitted, "Saved grids");
  await submit(fitted, 0, "Fitted", nameField);
  const fitRow = grids.get(2);
  const fitData = JSON.parse(fitRow.data);
  assert.equal(fitData.settings.fitVideos, true);
  assert.equal(fitData.session.panes[0].view.rotation.turns, 1);
  await fitted.unmount();
  for (const legacy of [false, true]) {
    if (legacy) {
      delete fitData.settings.fitVideos;
      fitRow.data = JSON.stringify(fitData);
    }
    const restored = await launch({ ...settings, fitVideos: legacy }, { localStorage: new Map() });
    await press(restored, "Saved grids");
    openButton(restored, "Fitted").props.onClick();
    await restored.flush();
    assert.equal(restored.saved.at(-1).settings.fitVideos, true);
    assert.ok(cells(restored).every(node => Number.isInteger(node.props.style.width)));
    assert.match(cells(restored)[0].props.className, /ms-rotate-90/);
    await restored.unmount();
  }
  grids.delete(2);

  // The same name replaces that grid after asking; a refusal saves nothing.
  players(h)[1].props.onNext();
  await h.flush();
  await press(h, "Saved grids");
  h.nodes(nameField)[0].props.onChange({ target: { value: "evening MIX" } });
  await h.flush();
  assert.ok(named(h, "Replace"), "an existing name offers to replace it");
  h.options.confirm = false;
  await submit(h, 0, "evening MIX", nameField);
  assert.match(h.confirms.at(-1), /Replace "Evening mix" with the current screens\?/);
  assert.deepEqual(JSON.parse(grids.get(1).data).session.panes, stored.session.panes);
  h.options.confirm = true;
  await submit(h, 0, "evening MIX", nameField);
  assert.equal(grids.size, 1);
  assert.equal(grids.get(1).name, "Evening mix", "a replaced grid keeps its name");
  assert.deepEqual(
    JSON.parse(grids.get(1).data).session.panes.map(entry => entry.itemId),
    playing(h),
  );

  // Rename and delete act on one grid; deleting asks first.
  await press(h, "Rename Evening mix");
  await submit(h, 1, "Late", node => node.props["aria-label"] === "New name for Evening mix");
  assert.equal(grids.get(1).name, "Late");
  assert.ok(openButton(h, "Late"));

  // The overwrite button gives a saved grid the current screens after asking, and keeps its name.
  players(h)[0].props.onNext();
  await h.flush();
  const overwritten = () => JSON.parse(grids.get(1).data).session.panes.map(entry => entry.itemId);
  assert.notDeepEqual(overwritten(), playing(h));
  h.options.confirm = false;
  await press(h, "Overwrite Late with the current screens");
  assert.match(h.confirms.at(-1), /Replace "Late" with the current screens\?/);
  assert.notDeepEqual(overwritten(), playing(h), "a refusal saves nothing");
  h.options.confirm = true;
  await press(h, "Overwrite Late with the current screens");
  assert.deepEqual(overwritten(), playing(h));
  assert.deepEqual([grids.size, grids.get(1).name], [1, "Late"]);

  h.options.confirm = false;
  await press(h, "Delete Late");
  assert.match(h.confirms.at(-1), /Delete the saved grid "Late"\?/);
  assert.equal(grids.size, 1);
  h.options.confirm = true;
  await press(h, "Delete Late");
  assert.equal(grids.size, 0);
  assert.match(text(dialog(h)), /No saved grids yet\./);

  // A failed request is shown and can be retried.
  await press(h, "Close saved grids");
  h.options.operationFails = "The database is busy";
  await press(h, "Saved grids");
  assert.match(text(dialog(h)), /The database is busy/);
  h.options.operationFails = "";
  named(h, "Retry").props.onClick();
  await h.flush();
  assert.match(text(dialog(h)), /No saved grids yet\./);
  assert.equal(named(h, "Retry"), undefined);
  await h.unmount();

  // Without playing screens there is nothing to save, but saved grids can still be opened.
  const empty = await launch(settings, { scenes: [], localStorage: new Map() });
  await press(empty, "Saved grids");
  assert.equal(empty.nodes(node => node.type === "form").length, 0);
  grids.set(1, { id: 1, name: "Kept", rows: 1, columns: 1, data: "{}", updatedAt: 1 });
  await press(empty, "Close saved grids");
  await press(empty, "Saved grids");
  assert.ok(empty.button("Delete Kept"));
  assert.equal(empty.button("Overwrite Kept with the current screens"), undefined);
  await empty.unmount();
}
async function recentGrids() {
  const { text } = require("./ui_harness");
  const SESSION = "multiscreen.session";
  const scenes = Array.from({ length: 12 }, (_, index) => ({
    id: String(index),
    title: "Scene " + index,
    paths: { stream: "/" + index },
    files: [{ duration: 100 }],
  }));
  const settings = { rows: 1, columns: 2, sceneOrder: "list", randomStart: false, loopScenes: false, recentGrids: 2 };
  const grids = new Map();
  const launch = { source: "filter", filter: { sort: "title" }, sceneFilter: {} };
  const open = (extra = {}) => {
    const options = { scenes, grids, settings, ...extra };
    let h = null;
    // Like the real hub, settings read after a save are the saved ones.
    options.loadSettings = () => h?.saved.at(-1)?.settings ?? options.settings;
    return start(options).then(started => {
      h = started;
      h.options = options;
      return h;
    });
  };
  const players = h => h.nodes(node => node.type === "native-player");
  const playing = h => players(h).map(node => node.props.scene.id);
  const pane = (h, index) =>
    [...h.media].find(([address, media]) => address.includes("ms-native-" + index) && media.video.isConnected)[1];
  const recentSaves = h => h.operations.filter(operation => operation.args.mode === "gridRecent");
  const recentRows = () => [...grids.values()].filter(row => row.recent);
  const stored = id => JSON.parse(grids.get(id).data);
  const press = async (h, label) => {
    h.button(label).props.onClick();
    await h.flush();
  };
  const dialog = h => h.nodes(node => node.type === "Dialog" && node.props.ariaLabel === "Saved grids")[0];
  const openButton = (h, name) => h.nodes(node => node.type === "Button" && node.props.ariaLabel === "Open " + name)[0];
  // The screens' own saver runs every 5 seconds, the recent grid's every 10.
  const settle = async h => {
    await h.tick(5000);
    await h.tick(10000);
    await h.flush();
  };

  // A launch saves nothing until it has played a while, then saves one autosave.
  const h = await open({ launch });
  await h.tick(5000);
  assert.equal(recentSaves(h).length, 0, "a playing grid is not written on every change");
  await h.tick(10000);
  await h.flush();
  assert.equal(recentSaves(h).length, 1);
  assert.equal(recentRows().length, 1);
  const [first] = recentRows();
  assert.deepEqual([first.name, first.rows, first.columns], ["Autosave", 1, 2]);
  assert.deepEqual(
    stored(first.id).session.panes.map(entry => entry.itemId),
    playing(h),
  );
  assert.equal(stored(first.id).session.recent, undefined, "the row's own ID is not part of its screens");

  // Later changes update the same recent grid, and the session remembers which one it is.
  players(h)[0].props.onNext();
  await h.flush();
  pane(h, 0).video.currentTime = 33;
  pane(h, 0).player.emit("timeupdate");
  await settle(h);
  assert.equal(recentRows().length, 1);
  assert.deepEqual(
    stored(first.id).session.panes.map(entry => entry.itemId),
    playing(h),
  );
  assert.equal(stored(first.id).session.panes[0].time, 33);
  assert.equal(JSON.parse(h.localStorage.get(SESSION)).recent, first.id);

  // Hiding the tab writes a pending change at once.
  players(h)[1].props.onNext();
  await h.flush();
  await h.tick(5000);
  const before = recentSaves(h).length;
  h.document.hidden = true;
  h.document.emit("visibilitychange");
  await h.flush();
  assert.equal(recentSaves(h).length, before + 1);
  assert.equal(stored(first.id).session.panes[1].itemId, playing(h)[1]);
  h.document.hidden = false;
  h.document.emit("visibilitychange");

  // Closing the player writes what is still pending.
  players(h)[0].props.onNext();
  await h.flush();
  const closedOn = playing(h);
  await h.unmount();
  await h.flush();
  assert.deepEqual(
    stored(first.id).session.panes.map(entry => entry.itemId),
    closedOn,
  );

  // A reload goes on with the same recent grid; a new launch starts another, and only the newest two stay.
  const reloaded = await open({ localStorage: new Map(h.localStorage) });
  players(reloaded)[1].props.onNext();
  await reloaded.flush();
  await settle(reloaded);
  assert.deepEqual(
    recentRows().map(row => row.id),
    [first.id],
  );
  await reloaded.unmount();
  const second = await open({ launch, localStorage: new Map(reloaded.localStorage) });
  await settle(second);
  await second.unmount();
  const third = await open({ launch, localStorage: new Map(second.localStorage) });
  await settle(third);
  const ids = recentRows().map(row => row.id);
  assert.equal(ids.length, 2);
  assert.ok(!ids.includes(first.id), "the oldest recent grid goes");

  // The dialog numbers autosaves newest first, before the named grids; keeping one names it and stops updating it.
  const byAge = () => recentRows().sort((a, b) => b.updatedAt - a.updatedAt);
  await press(third, "Saved grids");
  assert.match(text(dialog(third)), /Autosaves.*Autosave 1.*played.*Autosave 2.*played/);
  const [newest, oldest] = byAge();
  assert.equal(third.button("Overwrite Autosave 1 with the current screens"), undefined);
  await press(third, "Keep Autosave 1 as a saved grid");
  const field = third.nodes(
    node => node.type === "input" && node.props["aria-label"] === "Name to keep Autosave 1 under",
  )[0];
  assert.equal(field.props.value, "", "an autosave is kept under a name of your own");
  field.props.onChange({ target: { value: "Favourite pair" } });
  await third.flush();
  third
    .nodes(node => node.type === "form")
    .at(-1)
    .props.onSubmit({ preventDefault() {} });
  await third.flush();
  assert.deepEqual([grids.get(newest.id).name, grids.get(newest.id).recent], ["Favourite pair", false]);
  assert.match(text(dialog(third)), /Autosave 1.*Saved.*Favourite pair/);
  assert.ok(openButton(third, "Autosave 1"), "the other autosave moves up to 1");
  assert.equal(openButton(third, "Autosave 2"), undefined);
  const kept = grids.get(newest.id).data;
  players(third)[0].props.onNext();
  await third.flush();
  await settle(third);
  assert.equal(grids.get(newest.id).data, kept, "a kept grid is never overwritten automatically");
  assert.equal(recentRows().length, 2, "the session starts a new recent grid instead");

  // A grid opened from a named one plays on as a new autosave.
  await press(third, "Close saved grids");
  await press(third, "Saved grids");
  openButton(third, "Favourite pair").props.onClick();
  await third.flush();
  await third.flush();
  await settle(third);
  const opened = byAge()[0];
  assert.ok(![newest.id, oldest.id].includes(opened.id));
  assert.equal(opened.name, "Autosave");

  // Opening an autosave goes on updating that one, and it becomes Autosave 1.
  await press(third, "Saved grids");
  const resumed = byAge()[1];
  openButton(third, "Autosave 2").props.onClick();
  await third.flush();
  await third.flush();
  const count = grids.size;
  players(third)[1].props.onNext();
  await third.flush();
  await settle(third);
  assert.equal(grids.size, count);
  assert.equal(stored(resumed.id).session.panes[1].itemId, playing(third)[1]);
  assert.equal(byAge()[0].id, resumed.id);
  await third.unmount();

  // With 0 recent grids nothing is saved, and the list drops the ones there were.
  const off = await open({ launch, settings: { ...settings, recentGrids: 0 } });
  await settle(off);
  assert.equal(recentSaves(off).length, 0);
  await press(off, "Saved grids");
  assert.equal(recentRows().length, 0);
  assert.equal(off.operations.find(operation => operation.args.mode === "gridList").args.keepRecent, 0);
  assert.doesNotMatch(text(dialog(off)), /Autosave/);
  await off.unmount();
  assert.equal(recentSaves(off).length, 0);
}
(async () => {
  await registration();
  await contextsAndCounts();
  await pluginLists();
  await navigationSetting();
  await playbackAndCleanup();
  await markersAndLoops();
  await markerSeeking();
  await stablePaneSubscriptions();
  await counters();
  await sceneHeaderActions();
  await gridsAndAsync();
  await playableStartupAndTranscodeClock();
  await independentNativePlayerIdentities();
  await staleCounts();
  await sceneSearch();
  await fixedSessionSearch();
  await searchDuringMarkersAndPaging();
  await searchedQueueNavigation();
  await performerNavigation();
  await performerNavigationFromPerformer();
  await performerNavigationSetting();
  await pagedPerformerNavigation();
  await searchFocusAfterClosing();
  await performerNavigationAcrossPagesAndReopen();
  await pagedPlayback();
  await avoidsDuplicateScenes();
  await reshuffleMenu();
  await unscopedLibraryPaging();
  await sessionRestore();
  await editMode();
  await gridPickerAndSwap();
  await fitVideos();
  await closeScreens();
  await customRows();
  await addScreens();
  await rotation();
  await savedGrids();
  await recentGrids();
  console.log("DirtyMultiscreen compiled registration, navigation, players, grid, counters and cleanup passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
