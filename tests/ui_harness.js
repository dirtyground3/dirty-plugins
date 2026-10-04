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
  target.dispatchEvent = event => { target.emit(event.type, event); return !event.defaultPrevented; };
  target.handlers = handlers;
  return target;
}

module.exports = { element, find, findAll, text, events };
