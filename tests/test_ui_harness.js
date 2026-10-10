"use strict";

// The shared element and event helpers that the UI suites build on.
const assert = require("node:assert/strict");
const test = require("node:test");
const { element, find, findAll, text, events, createRenderer } = require("./ui_harness");

const tree = element("section", null, [element("button", { id: "pick" }, "Pick"), false], "text");
assert.equal(find(tree, node => node.props.id === "pick").type, "button");
assert.equal(findAll(tree, node => node.type === "button").length, 1);
assert.equal(text(tree), "Picktext");
const target = events(),
  seen = [];
const first = value => seen.push("first:" + value);
const second = value => seen.push("second:" + value);
target.on("update", first);
target.on("update", first);
target.on("update", second);
target.emit("update", 1);
target.off("update", first);
target.emit("update", 2);
assert.deepEqual(seen, ["first:1", "second:1", "second:2"]);
let dispatched;
target.addEventListener("change", event => {
  dispatched = event;
});
const event = { type: "change", defaultPrevented: true };
assert.equal(target.dispatchEvent(event), false);
assert.equal(dispatched, event);
// The shared renderer keeps React's guarantees that the UI suites rely on.
const renderer = createRenderer();
let computed = 0,
  cleaned = 0,
  setter;
function Child() {
  renderer.hooks.useEffect(() => () => cleaned++, []);
  return "child";
}
function Parent(props) {
  const [value, set] = renderer.hooks.useState(1);
  if (setter) assert.equal(set, setter, "state setters are stable");
  setter = set;
  const doubled = renderer.hooks.useMemo(() => {
    computed++;
    return value * 2;
  }, [value]);
  return element("div", null, String(doubled), props.child ? element(Child, {}) : null);
}
renderer.render(element(Parent, { child: true }));
renderer.render(element(Parent, { child: true }));
assert.equal(computed, 1, "useMemo keeps its value until a dependency changes");
setter(2);
assert.equal(renderer.changed, true, "a state update requests a render");
assert.equal(text(renderer.render(element(Parent, { child: false }))), "4");
assert.equal(computed, 2);
assert.equal(cleaned, 1, "components that leave the tree run their effect cleanups");
console.log("Element trees, event dispatch and the shared renderer passed");

test("same-name component replacements clean up and remount their subtree", () => {
  const replacement = createRenderer();
  const effects = [];
  let update;
  function Descendant() {
    replacement.hooks.useEffect(() => {
      effects.push("child mounted");
      return () => effects.push("child cleaned");
    }, []);
    return "child";
  }
  const component = initial =>
    function SameName() {
      const [value, set] = replacement.hooks.useState(initial);
      update = set;
      replacement.hooks.useEffect(() => {
        effects.push("mounted " + initial);
        return () => effects.push("cleaned " + initial);
      }, []);
      return element("div", {}, value, element(Descendant, {}));
    };
  const First = component(1);
  const Second = component(2);
  replacement.render(element(First, {}));
  update(9);
  assert.equal(text(replacement.render(element(First, {}))), "9child");
  assert.equal(text(replacement.render(element(Second, {}))), "2child");
  assert.deepEqual(effects, ["mounted 1", "child mounted", "cleaned 1", "child cleaned", "mounted 2", "child mounted"]);
  replacement.unmount();
  assert.deepEqual(effects.slice(-2), ["cleaned 2", "child cleaned"]);
});

test("state updates use Object.is to decide whether to rerender", () => {
  const state = createRenderer();
  let set;
  function Value() {
    const [value, update] = state.hooks.useState(NaN);
    set = update;
    return String(value);
  }
  const render = () => state.render(element(Value, {}));
  render();
  set(NaN);
  assert.equal(state.changed, false, "NaN is unchanged");
  set(value => value);
  assert.equal(state.changed, false, "unchanged functional updates do not request a render");
  set(0);
  assert.equal(state.changed, true);
  render();
  set(-0);
  assert.equal(state.changed, true, "signed zero values differ");
  render();
  set(-0);
  assert.equal(state.changed, false);
});

test("memo and effect dependencies compare with Object.is", () => {
  const dependencies = createRenderer();
  let memos = 0,
    effects = 0,
    cleanups = 0;
  function Value(props) {
    dependencies.hooks.useMemo(() => memos++, props.deps);
    dependencies.hooks.useEffect(() => {
      effects++;
      return () => cleanups++;
    }, props.deps);
    return null;
  }
  const render = deps => dependencies.render(element(Value, { deps }));
  render([NaN]);
  render([NaN]);
  assert.deepEqual([memos, effects, cleanups], [1, 1, 0]);
  render([0]);
  render([-0]);
  assert.deepEqual([memos, effects, cleanups], [3, 3, 2], "signed zero changes dependencies");
  render([]);
  assert.deepEqual([memos, effects, cleanups], [4, 4, 3], "changed dependency lengths are detected");
  render(undefined);
  render([]);
  assert.deepEqual([memos, effects, cleanups], [6, 6, 5], "missing dependencies run on every render");
});

test("flush rejects render loops and resolves settled state", async () => {
  const settled = createRenderer();
  function Settled() {
    const [value, set] = settled.hooks.useState(0);
    settled.hooks.useEffect(() => set(1), []);
    return value;
  }
  assert.equal(await settled.flush(() => settled.render(element(Settled, {})), 4), 1);
  const runaway = createRenderer();
  function Runaway() {
    const [value, set] = runaway.hooks.useState(0);
    runaway.hooks.useEffect(() => set(value + 1));
    return value;
  }
  await assert.rejects(
    runaway.flush(() => runaway.render(element(Runaway, {})), 4),
    /UI renderer did not settle after 4 flush rounds/,
  );
});
