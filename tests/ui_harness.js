"use strict";

// Plain element trees only; each suite owns component execution and hook state.
function element(type, props, ...children) {
  return { type, props: props || {}, children };
}

function find(tree, predicate) {
  if (Array.isArray(tree)) return tree.map(child => find(child, predicate)).find(Boolean);
  if (!tree || typeof tree !== "object") return undefined;
  return predicate(tree) ? tree : find(tree.children, predicate);
}

function findAll(tree, predicate) {
  if (Array.isArray(tree)) return tree.flatMap(child => findAll(child, predicate));
  if (!tree || typeof tree !== "object") return [];
  return (predicate(tree) ? [tree] : []).concat(findAll(tree.children, predicate));
}

function text(tree, separator = "") {
  if (tree == null || typeof tree === "boolean") return "";
  if (Array.isArray(tree)) return tree.map(child => text(child, separator)).join(separator);
  return typeof tree === "object" ? text(tree.children, separator) : String(tree);
}

function events(target = {}) {
  const handlers = new Map();
  target.addEventListener = target.on = (name, listener) => {
    if (!handlers.has(name)) handlers.set(name, new Set());
    handlers.get(name).add(listener);
  };
  target.removeEventListener = target.off = (name, listener) => handlers.get(name)?.delete(listener);
  target.emit = (name, ...args) => {
    for (const listener of Array.from(handlers.get(name) || [])) listener(...args);
  };
  target.dispatchEvent = event => {
    target.emit(event.type, event);
    return !event.defaultPrevented;
  };
  target.handlers = handlers;
  return target;
}

// Owners expose slots/cursor/effects; suites decide when to render and flush.
// Like React, state setters are stable and useMemo/useCallback keep their value
// until a dependency changes. onChange runs after every state update.
function createHooks(getOwner, onChange = () => {}) {
  const changedDeps = (old, deps) => !old || !deps || deps.some((dep, i) => dep !== old.deps[i]);
  const hooks = {
    useState(initial) {
      const owner = getOwner(),
        index = owner.cursor++;
      if (!(index in owner.slots)) {
        const slot = { state: typeof initial === "function" ? initial() : initial };
        slot.set = value => {
          slot.state = typeof value === "function" ? value(slot.state) : value;
          onChange();
        };
        owner.slots[index] = slot;
      }
      return [owner.slots[index].state, owner.slots[index].set];
    },
    useRef(initial) {
      const owner = getOwner(),
        index = owner.cursor++;
      if (!(index in owner.slots)) owner.slots[index] = { current: initial };
      return owner.slots[index];
    },
    useMemo(factory, deps) {
      const owner = getOwner(),
        index = owner.cursor++;
      if (changedDeps(owner.slots[index], deps)) owner.slots[index] = { deps, value: factory() };
      return owner.slots[index].value;
    },
    useCallback(callback, deps) {
      return hooks.useMemo(() => callback, deps);
    },
    useEffect(effect, deps) {
      const owner = getOwner(),
        index = owner.cursor++,
        old = owner.slots[index];
      if (changedDeps(old, deps)) {
        owner.slots[index] = { deps };
        owner.effects.push(() => {
          if (old?.cleanup) old.cleanup();
          owner.slots[index].cleanup = effect();
        });
      }
    },
  };
  return hooks;
}

/**
 * Renders plain element trees the way React would for these suites: hook state is keyed by
 * tree position (and element key when keyedAddress is set), effects run after each render,
 * and components that leave the tree run their cleanups. host(node, address) may adjust a
 * host element (for example assign a ref) and return extra children to render.
 */
function createRenderer({ host, keyedAddress = false } = {}) {
  const owners = new Map();
  let owner,
    changed = true,
    tree;
  const hooks = createHooks(
    () => owner,
    () => {
      changed = true;
    },
  );
  const release = item => item.slots.forEach(slot => slot?.cleanup?.());
  function render(root) {
    changed = false;
    const seen = new Set();
    function visit(node, address) {
      if (Array.isArray(node))
        return node.map((child, index) => visit(child, address + "/" + (child?.props?.key ?? index)));
      if (!node || typeof node !== "object" || !node.type) return node;
      if (keyedAddress && node.props?.key != null) address += "[" + node.props.key + "]";
      if (typeof node.type === "function") {
        const key = address + ":" + node.type.name;
        seen.add(key);
        if (!owners.has(key)) owners.set(key, { slots: [], cursor: 0, effects: [], address: key });
        owner = owners.get(key);
        owner.cursor = 0;
        return visit(node.type(node.props), key);
      }
      const extra = (host && host(node, address)) || [];
      return { ...node, children: visit([...(node.children || []), ...extra], address + "/children") };
    }
    tree = visit(root, "root");
    for (const [key, item] of owners)
      if (!seen.has(key)) {
        release(item);
        owners.delete(key);
      }
    for (const item of owners.values()) for (const effect of item.effects.splice(0)) effect();
    return tree;
  }
  return {
    hooks,
    owners,
    render,
    /** The component whose hooks are running; its address identifies it within the tree. */
    get owner() {
      return owner;
    },
    get tree() {
      return tree;
    },
    get changed() {
      return changed;
    },
    invalidate() {
      changed = true;
    },
    /** Rerender whenever state changed, letting promise callbacks settle in between. */
    async flush(renderRoot, rounds = 30) {
      for (let i = 0; i < rounds; i++) {
        if (changed) renderRoot();
        await Promise.resolve();
      }
      return tree;
    },
    unmount() {
      owners.forEach(release);
      owners.clear();
    },
  };
}

module.exports = { element, find, findAll, text, events, createHooks, createRenderer };
