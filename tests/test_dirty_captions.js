"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { sourceFor } = require("./load_plugin_scripts");
const htm = require("../plugins/DirtyPlugins/vendor/htm.umd.js");

function events(object = {}) {
  const handlers = new Map();
  object.addEventListener = object.on = (event, fn) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event).add(fn);
  };
  object.removeEventListener = object.off = (event, fn) => handlers.get(event)?.delete(fn);
  object.emit = (event) => { for (const fn of handlers.get(event) || []) fn(); };
  object.handlers = handlers;
  return object;
}
const patches = [], timers = new Map();
let timerId = 0, calls = 0, resolveRequest;
let effects = [], currentRoot, configs = {}, statuses = [];
const element = (type, props, ...children) => ({ type, props: { ...props, children } });
const React = {
  createElement: element, isValidElement: node => !!node?.type,
  cloneElement: (node, props, ...children) => element(node.type, { ...node.props, ...props }, ...children),
  useRef: () => ({ current: { parentElement: currentRoot } }),
  useState: initial => [initial, next => statuses.push(next)],
  useEffect: fn => effects.push(fn)
};
const window = events({
  navigator: { language: "en-US" }, location: { search: "" },
  setTimeout: fn => { const id = ++timerId; timers.set(id, fn); return id; },
  clearTimeout: id => timers.delete(id), setInterval: () => ++timerId, clearInterval() {},
  PluginApi: { React, patch: { after: (...args) => patches.push(args) } },
  DirtyPlugins: {
    values: { coerceBoolean: (value, fallback) => value === undefined ? fallback : value === true || value === "true" },
    getPluginSettings: () => Promise.resolve(configs),
    runPluginOperation: (id, args) => {
      assert.equal(id, "dirtyCaptions"); assert.equal(args.mode, "captions"); calls++;
      return new Promise(resolve => { resolveRequest = resolve; });
    },
    react: { html: htm.bind(element), Button: "button" }, captureEnabled: search => search.includes("docsCapture=1")
  }
});
class Observer { observe() {} disconnect() {} }
const context = vm.createContext({ window, Blob, Intl, MutationObserver: Observer, console });
const source = sourceFor("DirtyCaptions");
vm.runInContext(source, context);
vm.runInContext(source, context);
assert.equal(patches.length, 1, "asset reload must not stack patches");
const api = window.__dirtyCaptionsTracks;
const scene = { id: "1479", files: [{ id: "1493", size: 100 }] };
const track = (index, language, isDefault = false) => ({ index, language, default: isDefault, forced: false,
  title: "", codec: "mov_text", vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nCaption\n" });
const result = { sceneId: "1479", fileId: "1493", tracks: [track(2, "fra", true), track(3, "eng")], warnings: [] };

function player(external = []) {
  const list = events(external.slice()), remote = external.slice(), removed = [], registrations = [];
  const selector = {
    addTextTrack(options, manual) {
      assert.equal(manual, true, "retain tracks across source changes until controller cleanup");
      const el = events({ track: { mode: "disabled", kind: options.kind, language: options.srclang } });
      registrations.push({ options, el }); list.push(el.track); remote.push(el.track); return el;
    },
    removeTextTrack(el) {
      removed.push(el);
      for (const collection of [list, remote]) {
        const index = collection.indexOf(el.track); if (index >= 0) collection.splice(index, 1);
      }
    }
  };
  return events({ isDisposed: () => false, textTracks: () => list, remoteTextTracks: () => remote,
    sourceSelector: () => selector, ready: fn => fn(), registrations, remote, list, removed });
}
function flushTimers() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); }
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

async function run() {
  assert.equal(api.language("eng"), "en");
  assert.equal(api.language("fra_CA"), "fr-ca");
  assert.equal(api.preferredTrack(result.tracks, "en-GB").index, 3);
  assert.equal(api.preferredTrack(result.tracks, "de").index, 2);
  const one = api.requestCaptions(scene), two = api.requestCaptions(scene);
  assert.equal(one, two, "concurrent players share extraction");
  assert.equal(calls, 1); resolveRequest(result); await one; await settle();
  const third = api.requestCaptions(scene); assert.equal(calls, 2, "results are not persisted");
  resolveRequest(result); await third;

  const native = player();
  const release = api.attachTracks(native, result, api.settings({}), message => assert.fail(message));
  assert.equal(native.registrations.length, 2);
  assert.equal(native.registrations[1].options.srclang, "en");
  assert.match(native.registrations[1].options.label, /embedded/);
  assert.match(native.registrations[1].options.src, /^data:text\/vtt;charset=utf-8,/);
  assert.equal(decodeURIComponent(native.registrations[1].options.src.split(",")[1]), result.tracks[1].vtt);
  assert.equal(native.list[1].mode, "showing");
  assert.equal(native.list[0].mode, "disabled");
  native.list[1].mode = "disabled"; native.list.emit("change");
  native.remote.splice(0); native.emit("loadedmetadata"); flushTimers();
  assert.equal(native.registrations.length, 4, "restore tracks after tech replacement");
  assert(native.list.every(item => item.mode === "disabled"), "preserve the user's CC Off selection");
  release(); release(); assert.equal(native.list.length, 0);
  assert.equal(native.handlers.get("loadstart").size, 0);

  const external = { mode: "showing", kind: "captions" };
  const withExternal = player([external]);
  const cleanup = api.attachTracks(withExternal, result, api.settings({}), () => {});
  assert(withExternal.registrations.every(item => item.el.track.mode === "disabled"));
  cleanup(); assert.deepEqual([...withExternal.list], [external], "leave external captions intact");
  const manual = player();
  api.attachTracks(manual, result, api.settings({ showByDefault: false }), () => {})();
  assert(manual.registrations.every(item => item.el.track.mode === "disabled"));

  const original = element("div", { className: "VideoPlayer" }, element("div", { className: "video-wrapper" }));
  window.location.search = "?docsCapture=1";
  const patched = patches[0][1]({ scene }, {}, original);
  assert.match(patched.props.className, /dirty-captions-capture/);
  assert.equal(patched.props.children[0], original.props.children);
  assert.equal(patches[0][1]({ scene: { files: [] } }, original), original);

  const activePlayer = player();
  currentRoot = { querySelector: () => ({ player: activePlayer }) };
  const Controller = window.__dirtyCaptionsPlugin.CaptionsController;
  effects = []; Controller({ scene, capture: false });
  const cleanups = effects.map(fn => fn()); await settle();
  const before = activePlayer.registrations.length;
  cleanups.forEach(fn => fn?.()); resolveRequest(result); await settle();
  assert.equal(activePlayer.registrations.length, before, "late extraction must not affect an unmounted scene");
  const previousCalls = calls; configs = { enabled: false };
  effects = []; Controller({ scene, capture: false });
  const disabledCleanup = effects.map(fn => fn()); await settle();
  assert.equal(calls, previousCalls, "disabled captions must not read media");
  disabledCleanup.forEach(fn => fn?.());
  console.log("DirtyCaptions native tracks, preferences, source changes, cleanup, and registration passed");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
