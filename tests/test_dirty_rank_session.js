"use strict";
const { requireSource, runSource } = require("./plugin_paths");
const navigation = requireSource("DirtyRank", "src/domain/navigation.ts");

const assert = require("node:assert/strict");
const vm = require("node:vm");
const { events, createHooks } = require("./ui_harness");
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function createSession(options = {}) {
  const window = events({ setTimeout: () => 1, clearTimeout() {} });
  const document = events({ activeElement: null });
  const owner = { slots: [], effects: [], cursor: 0 },
    calls = [],
    paths = [];
  let nextId = 0;
  const hooks = createHooks(() => owner);
  const people = [
    { id: "left", name: "Left" },
    { id: "right", name: "Right" },
  ];
  const category = { id: "appearance", name: "Appearance" };
  const settings = { defaultCohort: "FEMALE", avoidRepeatWindow: 10 };
  const location = { pathname: "/battle/appearance", search: "" },
    history = {
      replace() {},
      push(value) {
        paths.push(value);
      },
    };
  const context = vm.createContext({ window, document, URLSearchParams });
  // The session's domain and host modules are replaced by these fakes; its queue logic is real.
  const fakes = {
    CONFIGURATION_CHANGED_EVENT: "configuration",
    DirtyPlugins: {
      react: { usePageTitle() {} },
      getPluginSettings: options.getPluginSettings || (async () => settings),
    },
    Router: { useHistory: () => history, useLocation: () => location },
    battleCategoryPath: id => "/battle/" + id,
    battleCohortFor: () => "FEMALE",
    battleId: () => "battle-" + ++nextId,
    categoriesForPerformer: () => [category],
    categoryConfidence: () => ({}),
    cohortLabel: value => value,
    documentationCapture: () => false,
    loadNativePerformerCard: async () => null,
    loadRatingIndex: async () => null,
    pairToken: (left, right) => left.id + ":" + right.id,
    poolFor: person => person.pool || { rating: 1000 },
    preferredCategoryId: () => category.id,
    queryPerformers: async () => people,
    ratingDelta: (after, before) => String(after - before),
    rememberCategory() {},
    selectPair: () => ({ pair: people, eligible: 2, ranks: { left: 1, right: 2 } }),
    settingsFromConfiguration: value => value,
    updatePerformerState: (person, state) => ({ ...person, pool: state }),
    getRatingIndexRevision: () => 0,
    runOperation: args =>
      new Promise((resolve, reject) => {
        calls.push({ args, resolve, reject });
      }),
  };
  const modules = {
    "./runtime": { ...fakes, React: hooks },
    "./domain/matchmaking": fakes,
    "./domain/navigation": { ...navigation, ...fakes },
    "./domain/rank": fakes,
    "./domain/settings": fakes,
  };
  const useSession = runSource("DirtyRank", "src/battleSession.ts", context, {
    external: Object.keys(modules),
    modules,
  }).useBattleSession;
  function render() {
    owner.cursor = 0;
    const session = useSession({ routeDetails: { categoryId: category.id } });
    owner.effects.splice(0).forEach(effect => effect());
    return session;
  }
  return {
    window,
    document,
    calls,
    paths,
    owner,
    render,
    unmount() {
      owner.slots.forEach(slot => {
        if (slot?.cleanup) slot.cleanup();
      });
    },
  };
}

const result = rating => ({ left: { id: "left", state: { rating } }, right: { id: "right", state: { rating } } });

(async () => {
  const host = createSession();
  host.render();
  await flush();
  host.render();
  let session = host.render();
  assert(session.pairInfo.pair, "loading selects an initial pair");
  let prevented = false;
  host.document.emit("keydown", {
    key: "ArrowUp",
    defaultPrevented: false,
    preventDefault() {
      prevented = true;
    },
  });
  session = host.render();
  assert(prevented, "tie shortcut handles the key event");
  assert.equal(session.undoHistory.length, 1);
  session.submit("right");
  session.submit("right");
  session = host.render();
  assert.equal(session.undoHistory.length, 2, "the same rendered pair cannot submit twice");
  await flush();
  assert.equal(host.calls.length, 1, "only the first queued vote starts");
  assert.equal(host.calls[0].args.outcome, "draw");
  host.document.emit("keydown", { key: "ArrowDown", defaultPrevented: false, preventDefault() {} });
  session = host.render();
  assert.equal(session.undoHistory.length, 1, "undo is optimistic while record is in flight");
  assert.equal(session.pendingVotes, 3);
  session.selectCategory("other");
  session.toggleBattleMode();
  assert.equal(host.paths.length, 0, "controller navigation waits for pending votes and undos");
  let preventedExit = false;
  const exit = {
    type: "beforeunload",
    preventDefault() {
      preventedExit = true;
    },
  };
  host.window.dispatchEvent(exit);
  assert(preventedExit, "leaving is protected while operations remain unsaved");
  assert.equal(exit.returnValue, "");
  host.calls[0].resolve(result(1001));
  await flush();
  assert.equal(host.calls.length, 2, "the next vote waits for the first save");
  assert.equal(host.calls[1].args.mode, "record");
  host.calls[1].resolve(result(1002));
  await flush();
  assert.equal(host.calls.length, 3);
  assert.equal(host.calls[2].args.mode, "undo");
  assert.equal(host.calls[2].args.battleId, host.calls[1].args.battleId, "undo follows its own record in the queue");
  session = host.render();
  assert.equal(session.performers[0].pool.rating, 1001, "an undone record response cannot publish stale ratings");
  host.calls[2].resolve(result(1001));
  await flush();
  session = host.render();
  assert.equal(session.pendingVotes, 0);
  assert.equal(host.window.handlers.get("beforeunload").size, 0, "saving removes the exit guard");
  host.unmount();
  assert.equal(host.document.handlers.get("keydown").size, 0, "unmount removes shortcuts");
  assert.equal(host.window.handlers.get("configuration").size, 0);

  const failed = createSession();
  failed.render();
  await flush();
  failed.render();
  session = failed.render();
  session.submit("left");
  session = failed.render();
  session.undo();
  await flush();
  failed.calls[0].reject(new Error("storage failed"));
  await flush();
  session = failed.render();
  assert.equal(failed.calls.length, 1, "a failed record must not send an undo to storage");
  assert.equal(session.pendingVotes, 0);
  assert.equal(session.undoHistory.length, 0);
  assert.match(session.error, /storage failed/);
  failed.unmount();
  const loads = [];
  const late = createSession({ getPluginSettings: () => new Promise(resolve => loads.push(resolve)) });
  late.render();
  late.window.emit("configuration", { detail: { pluginId: "dirtyRank" } });
  assert.equal(loads.length, 2);
  loads[1]({ defaultCohort: "FEMALE", avoidRepeatWindow: 11 });
  await flush();
  late.render();
  assert.equal(late.render().settings.avoidRepeatWindow, 11);
  loads[0]({ defaultCohort: "FEMALE", avoidRepeatWindow: 99 });
  await flush();
  assert.equal(late.render().settings.avoidRepeatWindow, 11, "older settings load cannot replace a newer refresh");
  late.window.emit("configuration", { detail: { pluginId: "dirtyRank" } });
  late.unmount();
  const before = JSON.stringify(late.owner.slots);
  loads[2]({ defaultCohort: "FEMALE", avoidRepeatWindow: 55 });
  await flush();
  assert.equal(JSON.stringify(late.owner.slots), before, "unmounted session ignores late settings and media loads");
  console.log("Rank queued votes, optimistic undo, failure recovery, exit protection and cleanup passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
