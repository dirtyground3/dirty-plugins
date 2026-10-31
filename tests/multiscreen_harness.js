"use strict";
const vm = require("node:vm"),
  { sourceFor } = require("./load_plugin_scripts");
const { createRenderer, findAll, text, events } = require("./ui_harness"),
  { installRegistration } = require("./shared_runtime");
function createMultiscreenHarness(options = {}) {
  let mounted = true,
    mode = options.mode || "route",
    path = options.path || "/scenes",
    nextTimer = 0;
  const routes = [],
    patches = new Map(),
    patchNames = [],
    calls = [],
    errors = [],
    timers = new Map(),
    observers = [],
    media = new Map(),
    nativeCalls = [];
  const renderer = createRenderer({
    keyedAddress: true,
    host(node, address) {
      // Native tiles get a fake player and video per keyed tile; the grid gets its container.
      if (node.props.ref && node.props.className?.includes("ms-native-tile")) {
        if (!media.has(address) || !media.get(address).video.isConnected) media.set(address, newMedia());
        node.props.ref.current = media.get(address).tile;
      }
      if (node.props.ref && node.props.className?.includes("ms-native-grid")) node.props.ref.current = grid;
    },
  });
  const React = {
    ...renderer.hooks,
    Fragment: "fragment",
    createElement: (type, props, ...children) => ({ type, props: { ...props, children }, children }),
  };
  class Video {
    constructor() {
      events(this);
      this.currentTime = 0;
      this.duration = 10;
      this.paused = false;
      this.ended = false;
      this.isConnected = true;
      this.playCount = 0;
      this.pauseCount = 0;
    }
    pause() {
      this.paused = true;
      this.pauseCount++;
    }
    play() {
      this.paused = false;
      this.playCount++;
      return Promise.resolve();
    }
  }
  function FakePlayer() {}
  FakePlayer.players = {};
  function newMedia() {
    const video = new Video(),
      element = { id: "VideoJsPlayer", playerId: "VideoJsPlayer" },
      persist = { enabled: true, ready() {} },
      player = events({
        constructor: FakePlayer,
        id_: "VideoJsPlayer",
        options_: { id: "VideoJsPlayer" },
        id() {
          return this.id_;
        },
        el: () => element,
        tech_: {
          id_: "VideoJsPlayer_html5_api",
          options_: { playerId: "VideoJsPlayer", techId: "VideoJsPlayer_html5_api" },
          el: () => video,
        },
        disposed: false,
        v: 1,
        m: false,
        currentTime(value) {
          if (value === undefined) return video.currentTime;
          video.currentTime = value;
        },
        duration: () => video.duration,
        readyState: () => options.readyState ?? 4,
        isDisposed() {
          return this.disposed;
        },
        persistVolume: () => persist,
        ready(fn) {
          this.readyCallback = fn;
          (this.readyCallbacks ||= []).push(fn);
          fn();
        },
        volume(v) {
          if (v === undefined) return this.v;
          this.v = v;
          this.emit("volumechange");
        },
        muted(v) {
          if (v === undefined) return this.m;
          this.m = v;
          this.emit("volumechange");
        },
      });
    FakePlayer.players[player.id()] = player;
    const tile = {
      querySelector: selector => (selector === "video" ? video : selector === "video-js" ? { player } : null),
    };
    return { video, player, persist, tile };
  }
  const scenes = options.scenes || [
    { id: "a", title: "Alpha", paths: { stream: "/a" }, files: [{ duration: 10 }] },
    { id: "b", title: "Beta", paths: { stream: "/b" }, files: [{ duration: 20 }] },
  ];
  function NativePlayer(props) {
    nativeCalls.push(props);
    const address = renderer.owner.address;
    const current = media.get(address); // native shares its tile by prefix below
    const pair = current || [...media].find(([key]) => address.startsWith(key + "/"))?.[1];
    if (pair) pair.video.duration = props.scene.files?.[0]?.duration || 10;
    props.sendSetTimestamp(seconds => {
      if (pair) pair.player.currentTime(seconds);
    });
    React.useEffect(
      () => () => {
        if (pair) {
          pair.player.disposed = true;
          FakePlayer.players[pair.player.id()] = null;
          pair.video.isConnected = false;
        }
      },
      [],
    );
    return React.createElement("native-player", props);
  }
  const controls = Object.fromEntries(
    ["IconButton", "StateView", "NavAction", "Dialog", "Field", "Button", "Pagination"].map(name => [
      name,
      props => React.createElement(name, props, props.children),
    ]),
  );
  const hub = {
    react: { ...controls, usePageTitle() {} },
    captureEnabled: () => !!options.capture,
    debugLog() {},
    native: { loadComponent: async () => NativePlayer },
    getPluginSettings: async () =>
      options.loadSettings
        ? options.loadSettings()
        : options.settings || {
            rows: 1,
            columns: 2,
            totalScreens: 2,
            sceneOrder: "list",
            randomStart: false,
            loopScenes: false,
          },
    graphql: async (query, variables, requestOptions) => {
      calls.push({ query, variables });
      if (options.graphql) return options.graphql(query, variables, requestOptions);
      if (query.includes("MultiscreenMarkers"))
        return {
          findSceneMarkers: {
            count: options.markers?.length || 0,
            scene_markers: (options.markers || []).filter(
              marker => !variables.ids || variables.ids.includes(marker.id),
            ),
          },
        };
      if (query.includes("MultiscreenScenes")) {
        const selected = scenes.filter(scene => !variables.ids || variables.ids.includes(scene.id));
        return { findScenes: { count: selected.length, scenes: selected } };
      }
      if (query.includes("MultiscreenSceneSearch")) return { findScenes: { count: scenes.length, scenes } };
      if (query.includes("MultiscreenSceneCount")) return { findScenes: { count: scenes.length } };
      if (query.includes("MultiscreenMarkerCount"))
        return { findSceneMarkers: { count: options.markers?.length || 0 } };
      if (query.includes("MultiscreenPerformers")) return { findPerformers: { performers: [{ id: "p1" }] } };
      if (query.includes("MultiscreenStudios")) return { findStudios: { studios: [{ id: "s1" }] } };
      return {};
    },
  };
  const storage = new Map(options.launch ? [["multiscreen.launchContext", JSON.stringify(options.launch)]] : []);
  const document = events({ hidden: false }),
    grid = events({
      querySelectorAll: () => [...media.values()].map(pair => pair.video).filter(video => video.isConnected),
      contains: video => [...media.values()].some(pair => pair.video === video && video.isConnected),
    });
  const window = events({
    DirtyPlugins: hub,
    location: {
      get pathname() {
        return path;
      },
      search: options.capture ? "?docsCapture=1" : "",
      assign: value => {
        path = value;
      },
    },
    history: { length: 1, back() {} },
    setTimeout(fn, delay) {
      const id = ++nextTimer;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    PluginApi: {
      React,
      components: { ScenePlayer: NativePlayer },
      utils: {
        StashService: {
          useFindScene: id => ({ loading: false, data: { findScene: scenes.find(scene => scene.id === id) } }),
        },
      },
      libraries: {
        ReactRouterDOM: {
          NavLink: props => React.createElement("NavLink", props, props.children),
          useLocation: () => ({ pathname: path }),
        },
        FontAwesomeSolid: {},
      },
      register: {
        route(...args) {
          routes.push(args);
          options.register?.();
        },
      },
      patch: {
        before(name, fn) {
          patchNames.push(name);
          patches.set(name, fn);
          options.patch?.(name);
        },
      },
    },
  });
  installRegistration(window, { error: (...args) => errors.push(args) });
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.connected = false;
      observers.push(this);
    }
    observe(target) {
      this.target = target;
      this.connected = true;
    }
    disconnect() {
      this.connected = false;
    }
  }
  const context = vm.createContext({
    window,
    document,
    HTMLVideoElement: Video,
    MutationObserver: Observer,
    console: { error: (...args) => errors.push(args) },
    URLSearchParams,
    AbortController,
    Set,
  });
  const load = () => vm.runInContext(sourceFor("DirtyMultiscreen"), context);
  function render() {
    const native = React.createElement("original-nav", {});
    return renderer.render(
      mounted
        ? mode === "route" && routes[0]
          ? React.createElement(routes[0][1], {})
          : patches.get("MainNavBar.UtilityItems")?.({ children: native })[0].children
        : null,
    );
  }
  const flush = () => renderer.flush(render, 40);
  return {
    owners: renderer.owners,
    window,
    document,
    grid,
    context,
    React,
    hub,
    routes,
    patches,
    patchNames,
    calls,
    errors,
    timers,
    observers,
    media,
    nativeCalls,
    storage,
    load,
    flush,
    get tree() {
      return renderer.tree;
    },
    nodes: predicate => findAll(renderer.tree, predicate),
    button: label => findAll(renderer.tree, node => node.type === "IconButton" && node.props.ariaLabel === label)[0],
    async tick(delay) {
      for (const [id, timer] of [...timers])
        if (delay === undefined || timer.delay === delay) {
          timers.delete(id);
          timer.fn();
        }
      await flush();
    },
    async path(value) {
      path = value;
      renderer.invalidate();
      await flush();
    },
    async mode(value) {
      mode = value;
      renderer.invalidate();
      await flush();
    },
    async rerender() {
      renderer.invalidate();
      await flush();
    },
    async unmount() {
      mounted = false;
      renderer.invalidate();
      await flush();
    },
    text: () => text(renderer.tree),
    replacePlayer(pair) {
      const next = newMedia();
      pair.player = next.player;
      pair.persist = next.persist;
      pair.tile.querySelector = next.tile.querySelector;
      pair.video = next.video;
      for (const observer of observers) if (observer.connected) observer.callback();
      return pair;
    },
  };
}
module.exports = { createMultiscreenHarness };
