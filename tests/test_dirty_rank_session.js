"use strict";
const { requireSource, runSource } = require("./plugin_paths");
const navigation = requireSource("DirtyRank", "src/domain/navigation.ts");
const { verdictFor } = requireSource("DirtyRank", "src/domain/verdicts.ts");

const assert = require("node:assert/strict");
const vm = require("node:vm");
const { events, createHooks } = require("./ui_harness");
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function createSession(options = {}) {
  // Timers run only when a test advances them; idle preparation (delay 0) never runs here.
  const timers = new Map();
  let nextTimer = 0;
  const window = events({
    setTimeout: (callback, delay) => {
      timers.set(++nextTimer, { callback, delay });
      return nextTimer;
    },
    clearTimeout: id => timers.delete(id),
  });
  const document = events({ activeElement: null });
  const owner = { slots: [], effects: [], cursor: 0 },
    calls = [],
    paths = [],
    publications = [],
    selections = [];
  let nextId = 0;
  const hooks = createHooks(() => owner);
  const useState = hooks.useState,
    setters = new Map();
  let updatingState = false;
  hooks.useState = initial => {
    const [state, set] = useState(initial);
    if (!setters.has(set)) {
      setters.set(set, value => {
        set(
          typeof value === "function"
            ? current => {
                updatingState = true;
                try {
                  value(current);
                  return value(current);
                } finally {
                  updatingState = false;
                }
              }
            : value,
        );
      });
    }
    return [state, setters.get(set)];
  };
  const ratingStates = new Map();
  const people = [
    { id: "left", name: "Left" },
    { id: "right", name: "Right" },
  ];
  const category = { id: "appearance", name: "Appearance" };
  const settings = { defaultCohort: "FEMALE", confidenceTopN: 10 };
  const location = { pathname: "/battle/appearance", search: "" },
    history = {
      replace() {},
      push(value) {
        paths.push(value);
      },
    };
  const context = vm.createContext({
    window,
    document,
    URLSearchParams,
    ...(options.navigator ? { navigator: options.navigator } : {}),
  });
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
    battleId: () => "verdict-" + ++nextId,
    categoriesForPerformer: () => [category],
    categoryConfidence: () => ({}),
    cohortLabel: value => value,
    documentationCapture: () => false,
    loadNativePerformerCard: async () => null,
    loadRatingIndex: async () => null,
    // Side keeping has its own algorithm tests; this fake pair never changes sides.
    keepSides: (_previous, next) => next,
    pairToken: (left, right) => left.id + ":" + right.id,
    poolFor: person => ratingStates.get(person.id) || { rating: 1000 },
    preferredCategoryId: () => category.id,
    queryPerformers: async () => people,
    ratingDelta: (after, before) => String(after - before),
    rememberCategory() {},
    selectPair: (performers, _category, _cohort, _settings, verdicts) => {
      selections.push(verdictFor(verdicts, "left", "right"));
      return { pair: people, eligible: 2, ranks: { left: 1, right: 2 }, saved: verdictFor(verdicts, "left", "right") };
    },
    settingsFromConfiguration: value => value,
    updatePerformerStates: updates => {
      assert.equal(updatingState, false, "rating publication must happen outside replayable React state updaters");
      updates.forEach(update => ratingStates.set(update.id, update.state));
      publications.push(Array.from(updates, update => ({ id: update.id, rating: ratingStates.get(update.id).rating })));
      return true;
    },
    getRatingIndexRevision: () => 0,
    runOperation: args =>
      args.mode === "loadVerdicts"
        ? Promise.resolve({ thresholds: [0.6, 1.8, 3.2], verdicts: options.verdicts || [] })
        : new Promise((resolve, reject) => {
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
  async function ready() {
    render();
    await flush();
    render();
    await flush();
    render();
    return render();
  }
  return {
    window,
    document,
    calls,
    paths,
    publications,
    selections,
    poolFor: fakes.poolFor,
    owner,
    render,
    ready,
    /** Let the chosen number's flash finish. */
    advance() {
      for (const [id, timer] of Array.from(timers)) {
        if (!timer.delay) continue;
        timers.delete(id);
        timer.callback();
      }
      return render();
    },
    unmount() {
      owner.slots.forEach(slot => {
        if (slot?.cleanup) slot.cleanup();
      });
    },
  };
}

const result = (rating, verdict) => ({
  left: { id: "left", state: { rating } },
  right: { id: "right", state: { rating } },
  verdict,
  thresholds: [0.6, 1.8, 3.2],
});

(async () => {
  const host = createSession();
  let session = await host.ready();
  assert(session.pairInfo.pair, "loading the pool's verdicts selects an initial pair");
  assert.equal(host.selections[0], null, "matchmaking receives the pool's verdicts");
  let prevented = false;
  host.document.emit("keydown", {
    code: "KeyG",
    key: "g",
    defaultPrevented: false,
    preventDefault() {
      prevented = true;
    },
  });
  session = host.render();
  assert(prevented, "number keys choose a verdict");
  assert.equal(session.undoHistory.length, 1);
  assert.deepEqual(host.selections.at(-1), { score: 0, confirmations: 0 }, "the next pair appears at once");
  assert.equal(session.chosen, 0, "the chosen number flashes on the scale");
  session = host.advance();
  assert.equal(session.chosen, null, "the flash ends by itself");
  for (const ignored of ["ArrowLeft", "ArrowRight", "ArrowUp", "KeyF", "KeyH", "Digit4"]) {
    host.document.emit("keydown", { code: ignored, key: ignored, defaultPrevented: false, preventDefault() {} });
  }
  session = host.render();
  assert.equal(session.undoHistory.length, 1, "only the numbers 1 to 7 give a verdict");
  assert.deepEqual(session.pairInfo.saved, { score: 0, confirmations: 0 }, "a judged pair shows its saved verdict");
  session.submit(-2);
  session.submit(-2);
  session = host.render();
  assert.equal(session.undoHistory.length, 2, "the same rendered pair cannot submit twice");
  assert.deepEqual(
    host.selections.at(-1),
    { score: -2, confirmations: 0 },
    "a different verdict replaces the saved one",
  );
  assert.equal(session.decision.score, -2);
  assert.equal(session.decision.right.tone, "winner");
  await flush();
  assert.equal(host.calls.length, 1, "only the first queued verdict starts");
  assert.equal(host.calls[0].args.score, 0);
  assert.equal(host.calls[0].args.mode, "record");
  host.document.emit("keydown", { code: "ArrowDown", key: "ArrowDown", defaultPrevented: false, preventDefault() {} });
  session = host.render();
  assert.equal(session.undoHistory.length, 1, "undo is optimistic while record is in flight");
  assert.deepEqual(session.pairInfo.saved, { score: 0, confirmations: 0 }, "undo shows the pair as it was");
  assert.equal(session.pendingVotes, 3);
  session.selectCategory("other");
  assert.equal(host.paths.length, 0, "controller navigation waits for pending verdicts and undos");
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
  // A refit also moves performers outside the verdict.
  host.calls[0].resolve({
    ...result(1001, ["left", "right", 0, 0]),
    changed: [{ id: "other", state: { rating: 990 } }],
  });
  await flush();
  assert.equal(host.calls.length, 2, "the next verdict waits for the first save");
  assert.equal(host.calls[1].args.mode, "record");
  host.calls[1].resolve(result(1002, ["left", "right", -2, 0]));
  await flush();
  assert.equal(host.calls.length, 3);
  assert.equal(host.calls[2].args.mode, "undo");
  assert.equal(host.calls[2].args.verdictId, host.calls[1].args.verdictId, "undo follows its own record in the queue");
  session = host.render();
  assert.equal(
    host.poolFor(session.performers[0]).rating,
    1001,
    "an undone record response cannot publish stale ratings",
  );
  assert.equal(host.publications.length, 1, "an accepted verdict publishes every moved performer only once");
  assert.deepEqual(host.publications[0], [
    { id: "left", rating: 1001 },
    { id: "right", rating: 1001 },
    { id: "other", rating: 990 },
  ]);
  host.calls[2].resolve(result(1001, ["left", "right", 0, 0]));
  await flush();
  session = host.render();
  assert.equal(host.publications.length, 2, "undo publishes its complete pair only once with replayed React updaters");
  assert.equal(host.publications[1].length, 2);
  assert.equal(session.pendingVotes, 0);
  assert.equal(host.window.handlers.get("beforeunload").size, 0, "saving removes the exit guard");
  host.unmount();
  assert.equal(host.document.handlers.get("keydown").size, 0, "unmount removes shortcuts");
  assert.equal(host.window.handlers.get("configuration").size, 0);

  // U undoes like ↓, by the letter it types, with or without Shift.
  const lettered = createSession();
  let letteredSession = await lettered.ready();
  const press = (code, key) =>
    lettered.document.emit("keydown", { code, key, defaultPrevented: false, preventDefault() {} });
  for (const letter of ["u", "U"]) {
    press("KeyG", "g");
    letteredSession = lettered.render();
    assert.equal(letteredSession.undoHistory.length, 1);
    press("KeyU", letter);
    letteredSession = lettered.render();
    assert.equal(letteredSession.undoHistory.length, 0, letter + " undoes the last verdict");
  }
  // A scale key gives its verdict even on a layout where it types u.
  press("KeyG", "u");
  letteredSession = lettered.render();
  assert.equal(letteredSession.undoHistory.length, 1, "a scale key never undoes as well");
  lettered.unmount();

  assert.deepEqual(Array.from(session.keyLabels), ["A", "S", "D", "G", "J", "K", "L"], "QWERTY letters by default");
  // An AZERTY keyboard types Q on the key where QWERTY has A.
  const azerty = new Map([
    ["KeyA", "q"],
    ["KeyS", "s"],
    ["KeyD", "d"],
    ["KeyG", "g"],
    ["KeyJ", "j"],
    ["KeyK", "k"],
    ["KeyL", "l"],
  ]);
  const french = createSession({ navigator: { keyboard: { getLayoutMap: async () => azerty } } });
  session = await french.ready();
  assert.deepEqual(
    Array.from(session.keyLabels),
    ["Q", "S", "D", "G", "J", "K", "L"],
    "the hint uses the keyboard's own letters",
  );
  french.unmount();
  const confirming = createSession({ verdicts: [["left", "right", 1, 0]] });
  session = await confirming.ready();
  assert.deepEqual(session.pairInfo.saved, { score: 1, confirmations: 0 }, "a loaded verdict is shown");
  session.submit(1);
  session = confirming.render();
  assert.deepEqual(confirming.selections.at(-1), { score: 1, confirmations: 1 }, "choosing it again confirms it");
  await flush();
  confirming.calls[0].resolve(result(1000, ["left", "right", 1, 1]));
  await flush();
  assert.equal(confirming.render().feedback.text, "Verdict confirmed");
  confirming.unmount();

  const failed = createSession();
  session = await failed.ready();
  session.submit(3);
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
  loads[1]({ defaultCohort: "FEMALE", confidenceTopN: 11 });
  await flush();
  late.render();
  assert.equal(late.render().settings.confidenceTopN, 11);
  loads[0]({ defaultCohort: "FEMALE", confidenceTopN: 99 });
  await flush();
  assert.equal(late.render().settings.confidenceTopN, 11, "older settings load cannot replace a newer refresh");
  late.window.emit("configuration", { detail: { pluginId: "dirtyRank" } });
  late.unmount();
  const before = JSON.stringify(late.owner.slots);
  loads[2]({ defaultCohort: "FEMALE", confidenceTopN: 55 });
  await flush();
  assert.equal(JSON.stringify(late.owner.slots), before, "unmounted session ignores late settings and media loads");
  console.log(
    "Rank queued verdicts, confirmations, optimistic undo, failure recovery, exit protection and cleanup passed",
  );
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
