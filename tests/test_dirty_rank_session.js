"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { events } = require("./ui_harness");
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function createSession() {
  const window = events({setTimeout: () => 1, clearTimeout() {}});
  const document = events({activeElement: null});
  const slots = [], effects = [], calls = [], paths = [];
  let cursor = 0, nextId = 0;
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], value => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = {current: initial};
      return slots[index];
    },
    useCallback(callback, keys) {
      const index = cursor++, old = slots[index];
      if (!old || keys.some((key, i) => key !== old.keys[i])) slots[index] = {keys, callback};
      return slots[index].callback;
    },
    useMemo(factory, keys) { return hooks.useCallback(factory, keys)(); },
    useEffect(effect, keys) {
      const index = cursor++, old = slots[index];
      if (!old || !keys || keys.some((key, i) => key !== old.keys[i])) {
        slots[index] = {keys};
        effects.push(() => { if (old?.cleanup) old.cleanup(); slots[index].cleanup = effect(); });
      }
    },
  };
  const people = [{id: "left", name: "Left"}, {id: "right", name: "Right"}];
  const category = {id: "appearance", name: "Appearance"};
  const settings = {defaultCohort: "FEMALE", avoidRepeatWindow: 10};
  const location = {pathname: "/battle/appearance", search: ""}, history = {replace() {}, push(value) { paths.push(value); }};
  const context = vm.createContext({window, document, URLSearchParams});
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../plugins/DirtyRank/dirtyRankBattleSession.js"), "utf8"), context);
  const useSession = window.__dirtyRankBattleSession.createBattleSession({
    ...hooks, CONFIGURATION_CHANGED_EVENT: "configuration", PLUGIN_ID: "dirtyRank", UNDO_HISTORY_LIMIT: 25,
    DirtyPlugins: {react: {usePageTitle() {}}, getPluginSettings: async () => settings},
    Router: {useHistory: () => history, useLocation: () => location},
    battleCategoryPath: id => "/battle/" + id, battleCohortFor: () => "FEMALE", battleId: () => "battle-" + ++nextId,
    categoriesForPerformer: () => [category], categoryConfidence: () => ({}), cohortLabel: value => value,
    documentationCapture: () => false, loadNativePerformerCard: async () => null, loadRatingIndex: async () => null,
    pairToken: (left, right) => left.id + ":" + right.id, poolFor: person => person.pool || {rating: 1000},
    preferredCategoryId: () => category.id, queryPerformers: async () => people,
    ratingDelta: (after, before) => String(after - before), rememberCategory() {},
    selectPair: () => ({pair: people, eligible: 2, ranks: {left: 1, right: 2}}),
    settingsFromConfiguration: value => value, updatePerformerState: (person, state) => ({...person, pool: state}),
    getRatingIndexRevision: () => 0,
    runOperation: args => new Promise((resolve, reject) => { calls.push({args, resolve, reject}); }),
  });
  function render() {
    cursor = 0;
    const session = useSession({routeDetails: {categoryId: category.id}});
    effects.splice(0).forEach(effect => effect());
    return session;
  }
  return {window, document, calls, paths, render, unmount() { slots.forEach(slot => { if (slot?.cleanup) slot.cleanup(); }); }};
}

const result = rating => ({left: {id: "left", state: {rating}}, right: {id: "right", state: {rating}}});

(async () => {
  const host = createSession();
  host.render(); await flush(); host.render();
  let session = host.render();
  assert(session.pairInfo.pair, "loading selects an initial pair");
  let prevented = false;
  host.document.emit("keydown", {key: "ArrowUp", defaultPrevented: false, preventDefault() { prevented = true; }});
  session = host.render();
  assert(prevented, "tie shortcut handles the key event");
  assert.equal(session.undoHistory.length, 1);
  session.submit("right"); session.submit("right");
  session = host.render();
  assert.equal(session.undoHistory.length, 2, "the same rendered pair cannot submit twice");
  await flush();
  assert.equal(host.calls.length, 1, "only the first queued vote starts");
  assert.equal(host.calls[0].args.outcome, "draw");
  host.document.emit("keydown", {key: "ArrowDown", defaultPrevented: false, preventDefault() {}});
  session = host.render();
  assert.equal(session.undoHistory.length, 1, "undo is optimistic while record is in flight");
  assert.equal(session.pendingVotes, 3);
  session.selectCategory("other"); session.toggleBattleMode();
  assert.equal(host.paths.length, 0, "controller navigation waits for pending votes and undos");
  let preventedExit = false;
  const exit = {type: "beforeunload", preventDefault() { preventedExit = true; }};
  host.window.dispatchEvent(exit);
  assert(preventedExit, "leaving is protected while operations remain unsaved");
  assert.equal(exit.returnValue, "");
  host.calls[0].resolve(result(1001)); await flush();
  assert.equal(host.calls.length, 2, "the next vote waits for the first save");
  assert.equal(host.calls[1].args.mode, "record");
  host.calls[1].resolve(result(1002)); await flush();
  assert.equal(host.calls.length, 3);
  assert.equal(host.calls[2].args.mode, "undo");
  assert.equal(host.calls[2].args.battleId, host.calls[1].args.battleId, "undo follows its own record in the queue");
  session = host.render();
  assert.equal(session.performers[0].pool.rating, 1001, "an undone record response cannot publish stale ratings");
  host.calls[2].resolve(result(1001)); await flush();
  session = host.render();
  assert.equal(session.pendingVotes, 0);
  assert.equal(host.window.handlers.get("beforeunload").size, 0, "saving removes the exit guard");
  host.unmount();
  assert.equal(host.document.handlers.get("keydown").size, 0, "unmount removes shortcuts");
  assert.equal(host.window.handlers.get("configuration").size, 0);

  const failed = createSession();
  failed.render(); await flush(); failed.render(); session = failed.render();
  session.submit("left"); session = failed.render(); session.undo();
  await flush(); failed.calls[0].reject(new Error("storage failed")); await flush();
  session = failed.render();
  assert.equal(failed.calls.length, 1, "a failed record must not send an undo to storage");
  assert.equal(session.pendingVotes, 0);
  assert.equal(session.undoHistory.length, 0);
  assert.match(session.error, /storage failed/);
  failed.unmount();
  console.log("Rank queued votes, optimistic undo, failure recovery, exit protection and cleanup passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
