"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const noop = () => {};
const THEMES = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "schemas", "dirtyPlugins.settings.json"), "utf8"),
).settings.visualTheme.options.map(option => option.value);
const NAMES = ["hub", "stats", "multiscreen", "battles", "leaderboards"];

// One mounted component at a time: enough to see NavIcon follow the theme and let go of it.
let stateValue,
  stateSetter,
  cleanups = [];
const React = {
  Fragment: "fragment",
  createElement(type, props, ...children) {
    const flat = children.flat();
    if (typeof type === "function") return type({ ...(props || {}), children: flat.length === 1 ? flat[0] : flat });
    return { type, props: props || {}, children: flat };
  },
  useState(value) {
    stateValue = value;
    stateSetter = next => {
      stateValue = next;
    };
    return [value, stateSetter];
  },
  useEffect(effect) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  },
  useRef: noop,
  useMemo: noop,
  useCallback: noop,
};
const saved = { dirtyPlugins: {} };
let revision = 0;
const fetch = (_url, options) => {
  const args = JSON.parse(options.body).variables.args;
  let output;
  if (args.mode === "getSettings") output = { settings: saved[args.pluginId] || {}, revision };
  else if (args.mode === "setSettings") {
    saved[args.pluginId] = args.settings;
    output = { revision: ++revision };
  } else throw new Error(`Unexpected operation: ${args.mode}`);
  return Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data: { runPluginOperation: JSON.stringify(output) } }),
  });
};
const window = {
  PluginApi: {
    React,
    libraries: { ReactRouterDOM: { Link: "a" } },
    patch: { instead: noop, after: noop },
    register: { route: noop },
    components: {},
    utils: {},
  },
  addEventListener: noop,
  location: { pathname: "/plugins/dirty-plugins" },
};
const document = {
  currentScript: null,
  addEventListener: noop,
  documentElement: { classList: { add: noop, remove: noop } },
};
vm.runInNewContext(require("./load_plugin_scripts").sourceFor("DirtyPlugins"), {
  window,
  document,
  fetch,
  console: { info: noop, warn: noop, error: noop },
  URLSearchParams,
});

function walk(node, visit) {
  if (!node || typeof node !== "object") return;
  visit(node);
  (node.children || []).forEach(child => walk(child, visit));
}

(async () => {
  const hub = window.DirtyPlugins;
  await hub.theme.ready;
  const art = {};
  for (const theme of THEMES) {
    await hub.configurePlugin("dirtyPlugins", { visualTheme: theme });
    assert.equal(hub.theme.currentKey, theme);
    art[theme] = {};
    for (const name of NAMES) {
      const icon = hub.react.NavIcon({ name });
      assert.equal(icon.type, "i", `${theme} ${name} stays visible in themes that hide navbar spans`);
      assert.equal(icon.props["aria-hidden"], "true", `${theme} ${name} leaves its name to the link`);
      assert.equal(icon.children.length, 1, `${theme} ${name} draws one image`);
      const image = icon.children[0];
      assert.equal(image.type, "svg", `${theme} has a ${name} icon`);
      assert.match(image.props.viewBox, /^\d[\d. ]+$/, `${theme} ${name} has a viewBox`);
      const drawn = [];
      walk(image, node => {
        if (node !== image) drawn.push(node);
        // An unset attribute is fine; a broken coordinate shows up inside a drawn value.
        for (const value of Object.values(node.props || {}).filter(value => value !== undefined)) {
          assert(!/NaN|undefined/.test(String(value)), `${theme} ${name} draws only real numbers`);
        }
      });
      assert(drawn.length > 0, `${theme} ${name} draws something`);
      art[theme][name] = JSON.stringify(image);
    }
  }

  for (const name of NAMES) {
    assert.equal(new Set(THEMES.map(theme => art[theme][name])).size, THEMES.length, `every theme has its own ${name}`);
  }
  for (const name of NAMES) {
    assert(art.arcade[name].includes("crispEdges"), `Retro Arcade ${name} keeps hard pixel edges`);
    assert(art.arcade[name].includes("0 0 16 16"), `Retro Arcade ${name} is a 16x16 sprite`);
    assert(!art.classic[name].includes("crispEdges"), `Midnight ${name} stays smooth`);
    for (const color of art.stockstash[name].match(/#[0-9a-f]{6}/g)) {
      assert.equal(color, "#f5f8fa", `StockStash ${name} uses one colour`);
    }
  }

  await hub.configurePlugin("dirtyPlugins", { visualTheme: "classic" });
  hub.react.NavIcon({ name: "hub" });
  assert.equal(stateValue, "classic");
  await hub.configurePlugin("dirtyPlugins", { visualTheme: "candy" });
  assert.equal(stateValue, "candy", "a mounted icon follows a theme change");
  cleanups.forEach(cleanup => cleanup());
  await hub.configurePlugin("dirtyPlugins", { visualTheme: "arcade" });
  assert.equal(stateValue, "candy", "an unmounted icon stops listening");
  console.log("Dirty Plugins navigation icons passed");
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
