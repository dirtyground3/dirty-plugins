"use strict";
const assert = require("node:assert/strict");
const { testModulePath } = require("./plugin_paths");
const { events } = require("./ui_harness");
const domain = require(testModulePath("DirtyCaptions", "captions.cjs"));
const { createTracksService } = require(testModulePath("DirtyCaptions", "tracks.cjs"));
const values = require(testModulePath("DirtyPlugins", "values.cjs"));
const timers = new Map(); let timerId = 0, calls = 0, resolveRequest;
const hub = { values, runPluginOperation: (id, args) => {
  assert.equal(id, "dirtyCaptions"); assert.equal(args.mode, "captions"); calls++;
  return new Promise(resolve => { resolveRequest = resolve; });
} };
const api = {...domain, ...createTracksService(hub, {language: () => "en-US",
  setTimeout: fn => {const id = ++timerId; timers.set(id, fn); return id;}, clearTimeout: id => timers.delete(id)})};
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

  let failed = 0;
  const erroneous = player();
  const stop = api.attachTracks(erroneous, result, api.settings({}), () => failed++);
  erroneous.registrations[0].el.emit("error"); assert.equal(failed, 1);
  erroneous.emit("loadstart"); assert.equal(timers.size, 1); stop(); assert.equal(timers.size, 0);
  erroneous.registrations[0].el.emit("error"); assert.equal(failed, 1, "cleanup removes error listeners");
  const invalid = createTracksService({...hub, runPluginOperation: async () => ({tracks: null, warnings: []})});
  await assert.rejects(invalid.requestCaptions(scene), /invalid response/);
  await assert.rejects(invalid.requestCaptions(scene), /invalid response/, "failed extraction remains retryable");
  console.log("DirtyCaptions imported language/settings and native track service parity/cleanup passed");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
