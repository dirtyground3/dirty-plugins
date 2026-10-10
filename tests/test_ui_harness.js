"use strict";

// The shared element and event helpers that the UI suites build on.
const assert = require("node:assert/strict");
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
