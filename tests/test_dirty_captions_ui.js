"use strict";
const assert = require("node:assert/strict"),
  { createCaptionsHarness } = require("./captions_harness"),
  { events, text } = require("./ui_harness");
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
function player() {
  const list = events([]),
    remote = [],
    removed = [],
    registrations = [];
  const selector = {
    addTextTrack(options) {
      const el = events({ track: { kind: options.kind, mode: "disabled" } });
      registrations.push({ options, el });
      list.push(el.track);
      remote.push(el.track);
      return el;
    },
    removeTextTrack(el) {
      removed.push(el);
      for (const collection of [list, remote]) {
        const index = collection.indexOf(el.track);
        if (index >= 0) collection.splice(index, 1);
      }
    },
  };
  return events({
    isDisposed: () => false,
    textTracks: () => list,
    remoteTextTracks: () => remote,
    sourceSelector: () => selector,
    ready: fn => fn(),
    list,
    registrations,
    removed,
  });
}
const result = {
  sceneId: "1",
  fileId: "10",
  tracks: [
    {
      index: 1,
      language: "eng",
      codec: "mov_text",
      title: "Synthetic",
      default: true,
      forced: false,
      vtt: "WEBVTT\n\n00:00.000 --> 00:01.000\nCaption\n",
    },
  ],
  warnings: [],
};
async function main() {
  const native = player(),
    h = createCaptionsHarness({
      player: native,
      capture: true,
      operation: async args => (args.mode === "captions" ? result : { status: "Finished" }),
    });
  h.load();
  h.load();
  await h.flush();
  assert.deepEqual(h.patchNames, ["App", "FilteredSceneList", "ScenePlayer"]);
  assert(h.addon);
  assert(!h.window.__dirtyCaptionsTracks && !h.window.__dirtyCaptionsIndex, "private feature globals are removed");
  assert.equal(native.registrations.length, 1);
  assert.match(native.registrations[0].options.src, /^data:text\/vtt/);
  assert.equal(native.list[0].mode, "showing");
  assert(h.nodes(node => node.props?.className?.includes("dirty-captions-capture")).length);
  assert.equal(h.calls.filter(args => args.mode === "indexBootstrap").length, 1);
  assert(h.timers.size === 2, "only player discovery and displayed index status are polled");
  await h.click("Refresh caption index");
  assert.equal(h.calls.at(-1).mode, "indexRefresh");
  await h.click("Reprobe all files");
  assert.equal(h.calls.at(-1).force, true);
  await h.unmount();
  assert.equal(native.list.length, 0);
  assert.equal(h.timers.size, 0);
  assert(h.observers.every(observer => !observer.connected));
  assert.equal(h.window.handlers.get("dirty-plugins:configuration-changed").size, 0);
  h.load();
  assert.equal(h.patchNames.length, 3, "a reloaded bundle never registers twice");

  const { NativeFilter, criterion } = require("./captions_native_filter").createNativeModels();
  const filter = new NativeFilter(),
    personal = { field: "personal", modifier: "EQUALS", value: ["keep"] };
  filter.criteria = [
    criterion("custom_fields", [personal, { field: "Contains embedded captions", modifier: "EQUALS", value: ["No"] }]),
  ];
  const listHost = createCaptionsHarness();
  listHost.load();
  const toolbar = listHost.React.createElement("native-toolbar", {
    filter,
    setFilter() {
      throw Error("must not replace equivalent URL");
    },
  });
  const tags = listHost.React.createElement("native-tags", { criteria: filter.criteria });
  const list = listHost.React.createElement("native-list", {}, toolbar, tags);
  const decorated = listHost.patches.get("FilteredSceneList")(list);
  assert.notEqual(decorated, list);
  assert.equal(decorated.props.children[0], toolbar);
  assert.equal(decorated.props.children[1].props.criteria, filter.criteria);
  assert.equal(filter.criteria.find(c => c.criterionOption.type === "dirty_captions").value, "None");
  const fields = filter.makeFilter().custom_fields;
  assert.equal(JSON.stringify(fields.find(field => field.field === "personal")), JSON.stringify(personal));
  assert.equal(fields.find(field => field.field === "Contains embedded captions").value[0], "No");
  assert(filter.getEncodedParams().c.every(c => c.type !== "dirty_captions"));

  const late = deferred(),
    pendingPlayer = player(),
    lateHarness = createCaptionsHarness({
      player: pendingPlayer,
      operation: args => (args.mode === "captions" ? late.promise : Promise.resolve({ status: "Finished" })),
    });
  lateHarness.load();
  await lateHarness.flush();
  await lateHarness.unmount();
  late.resolve(result);
  await lateHarness.flush();
  assert.equal(pendingPlayer.registrations.length, 0, "late VTT cannot attach to an unmounted player");
  assert.equal(lateHarness.timers.size, 0);
  const oldLoad = deferred(),
    disabled = createCaptionsHarness({ player: player(), load: () => oldLoad.promise });
  disabled.load();
  await disabled.flush();
  await disabled.unmount();
  oldLoad.resolve({ enabled: true });
  await disabled.flush();
  assert(!disabled.calls.some(args => args.mode === "captions"));
  assert.equal(disabled.observers.length, 0);
  const off = createCaptionsHarness({ player: player(), settings: { enabled: false } });
  off.load();
  await off.flush();
  assert(!off.calls.some(args => args.mode === "captions"));
  await off.unmount();
  let attempts = 0;
  const retryPlayer = player(),
    retry = createCaptionsHarness({
      player: retryPlayer,
      operation: async args => {
        if (args.mode !== "captions") return { status: "Finished" };
        if (++attempts === 1) throw Error("synthetic conversion failure");
        return result;
      },
    });
  retry.load();
  await retry.flush();
  assert(text(retry.tree).includes("synthetic conversion failure"));
  await retry.click("Retry captions");
  assert.equal(attempts, 2);
  assert.equal(retryPlayer.registrations.length, 1);
  await retry.unmount();

  // A dropped connection is never reported: both requests are repeated with a doubled wait.
  const dropped = () => TypeError("NetworkError when attempting to fetch resource.");
  const quiet = h => !text(h.tree).includes("NetworkError") && !h.button("Retry captions");
  let settingsDrops = 1,
    captionDrops = 2;
  const flakyPlayer = player(),
    flaky = createCaptionsHarness({
      player: flakyPlayer,
      load: async () => {
        if (settingsDrops-- > 0) throw dropped();
        return {};
      },
      operation: async args => {
        if (args.mode !== "captions") return { status: "Finished" };
        if (captionDrops-- > 0) throw dropped();
        return result;
      },
    });
  flaky.load();
  await flaky.flush();
  for (const delay of [1000, 1000, 2000]) {
    assert(quiet(flaky));
    assert.equal(flakyPlayer.registrations.length, 0);
    await flaky.elapse(delay);
  }
  assert(quiet(flaky));
  assert.equal(flakyPlayer.registrations.length, 1);
  await flaky.unmount();
  assert.equal(flaky.timers.size, 0);

  const unreachable = async args => {
    if (args.mode === "captions") throw dropped();
    return { status: "Finished" };
  };
  const offline = createCaptionsHarness({ player: player(), operation: unreachable });
  offline.load();
  await offline.flush();
  for (const delay of [1000, 2000, 4000, 8000, 16000]) {
    assert(text(offline.tree).includes("Loading embedded captions"));
    await offline.elapse(delay);
  }
  assert(quiet(offline) && !text(offline.tree).includes("Loading"), "giving up stays silent");
  assert.equal(offline.calls.filter(args => args.mode === "captions").length, 6);
  await offline.elapse();
  await offline.unmount();
  const leaving = createCaptionsHarness({ player: player(), operation: unreachable });
  leaving.load();
  await leaving.flush();
  await leaving.unmount();
  assert.equal(leaving.timers.size, 0, "a pending retry is cancelled with its scene");

  const firstStatus = deferred(),
    action = deferred();
  let statusCalls = 0;
  const locked = createCaptionsHarness({
    operation: args =>
      args.mode === "indexStatus" && !statusCalls++
        ? firstStatus.promise
        : args.mode === "indexRefresh"
          ? action.promise
          : Promise.resolve({ status: "Finished" }),
  });
  locked.load();
  await locked.flush();
  const refresh = locked.button("Refresh caption index");
  refresh.props.onClick();
  refresh.props.onClick();
  await locked.flush();
  assert.equal(
    locked.calls.filter(args => args.mode === "indexRefresh").length,
    1,
    "busy lock works before a React rerender",
  );
  action.resolve({ status: "Running", checked: 4 });
  await locked.flush();
  firstStatus.resolve({ status: "Finished", checked: 0 });
  await locked.flush();
  assert(text(locked.tree).includes("Running · 4"), "a late status poll cannot replace a newer action result");
  assert(locked.button("Stop refresh"));
  await locked.click("Stop refresh");
  await locked.unmount();
  assert.equal(locked.timers.size, 0);

  const failed = createCaptionsHarness({
    patch: name => {
      if (name === "FilteredSceneList") throw Error("partial patch failure");
    },
  });
  failed.load();
  failed.load();
  assert.equal(failed.patchNames.length, 2, "a failed registration is not retried");
  assert.equal(failed.errors.length, 1);
  assert.match(String(failed.errors[0][0]), /\[dirtyCaptions\] registration failed/);
  console.log("DirtyCaptions compiled TSX, native player, index actions, races, masks, guards and cleanup passed");
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
