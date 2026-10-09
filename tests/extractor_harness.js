"use strict";
const vm = require("node:vm");
const {sourceFor} = require("./load_plugin_scripts");
const {createHooks, element, events} = require("./ui_harness");

class Node {
  constructor(tag = "div") {
    events(this); this.tagName = tag; this.nodeType = 1; this.children = []; this.style = {}; this.value = ""; this.disabled = false;
    this.className = ""; this.attributes = {}; this._text = "";
    this.classList = {contains: name => this.className.split(" ").includes(name), toggle: (name, on) => {
      const set = new Set(this.className.split(" ").filter(Boolean)); on ? set.add(name) : set.delete(name); this.className = [...set].join(" ");
    }};
  }
  get textContent() {return this._text + this.children.map(child => child.textContent).join("");}
  set textContent(value) {this._text = value; for (const child of this.children) child.parentNode = null; this.children = [];}
  appendChild(child) {this.children.push(child); child.parentNode = child.parentElement = this; return child;}
  removeChild(child) {this.children.splice(this.children.indexOf(child), 1); child.parentNode = child.parentElement = null;}
  remove() {this.parentNode?.removeChild(this);}
  get isConnected() {return this.connected === true || Boolean(this.parentNode?.isConnected);}
  setAttribute(name, value) {this.attributes[name] = value;}
  getAttribute(name) {return this.attributes[name];}
  focus() {this.focused = true;}
  click() {if (!this.disabled) this.emit("click", {preventDefault() {}, currentTarget: this, target: this});}
  matches(selector) {return selector === "#" + this.id;}
  querySelector(selector) {return this.children.find(child => child.matches(selector)) || this.children.map(child => child.querySelector(selector)).find(Boolean) || null;}
  getBoundingClientRect() {return {width: 100, height: 30, left: 30, right: 130, top: 30, bottom: 60};}
}
function createExtractorHarness(options = {}) {
  const patches = [], requests = [], notifications = [], writes = [], observers = [], errors = [];
  let owner, fieldAction, dialogReleases = 0, configurationEvents = 0;
  let settings = {destinationFolder: "/exports", unknown: "preserved", ...options.settings};
  const body = new Node("body"); body.connected = true;
  const menu = new Node(), toggle = new Node("button"), toolbar = new Node(), root = new Node();
  menu.connected = true; toggle.id = "more-menu"; toggle.clicks = 0; toggle.click = () => toggle.clicks++;
  root.clientWidth = 1200; toolbar.getBoundingClientRect = () => ({width: 760});
  toolbar.querySelector = () => toolbar.classList.contains("has-selection") ? toggle : null;
  root.querySelector = selector => selector === ".filtered-list-toolbar" ? toolbar : toolbar.classList.contains("has-selection") ? toggle : null;
  const hooks = createHooks(() => owner);
  const hub = {
    getPluginSettings: async () => options.getSettings ? options.getSettings() : {...settings},
    graphql: async (query, variables) => {
      requests.push({query, variables});
      if (options.graphql) return options.graphql(query, variables);
      return query.includes("Directory") ? {directory: {path: variables.path || "/home", parent: "/", directories: ["/exports/subfolder"]}} : {runPluginTask: "job-1"};
    },
    configurePlugin: async (id, value) => {writes.push(value); if (options.save) await options.save(value); settings = value; return {revision: writes.length};},
    registerFieldAction: (id, name, action) => {fieldAction = action; options.register?.();},
    unregisterFieldAction: (id, name, action) => {if (fieldAction === action) fieldAction = null;},
    captureEnabled: () => Boolean(options.capture), notifyConfigurationChanged: () => configurationEvents++, debugLog() {},
    ui: {notify: (...args) => notifications.push(args), manageDialog: ({opener, initialFocus}) => {
      initialFocus.focus(); let released = false; return () => {if (!released) {released = true; dialogReleases++; opener?.focus();}};
    }},
  };
  const window = events({innerHeight: 900, location: {pathname: "/performers/12", search: options.capture ? "?docsCapture=1" : ""}, DirtyPlugins: hub,
    PluginApi: {React: {...hooks, Fragment: "fragment", createElement: element}, ReactDOM: {createPortal: (content, target) => ({type: "portal", content, target})},
      patch: {after: (name, handler) => {patches.push({name, handler}); if (options.failPatch === patches.length) throw Error("patch failure");}}},
  });
  const document = {body, activeElement: new Node("button"), createElement: tag => new Node(tag),
    querySelector: selector => selector.startsWith(".dropdown-menu") ? menu : null};
  const context = vm.createContext({window, document, HTMLElement: Node, console: {error: (...args) => errors.push(args)},
    MutationObserver: class {constructor(callback) {this.callback = callback; this.disconnected = false; observers.push(this);} observe() {} disconnect() {this.disconnected = true;}}});
  const source = sourceFor("DirtyFileExtractor");
  const load = () => vm.runInContext(source, context);
  const flush = async () => {for (let i = 0; i < 20; i++) await Promise.resolve();};
  function mount(index, ids) {
    const native = {type: "native-list"}, tree = patches[index].handler({selectedIds: new Set(ids)}, native), component = tree.children[0];
    const item = {slots: [], cursor: 0, effects: []};
    function render() {
      owner = item; item.cursor = 0;
      const result = component.type(component.props);
      if (result) result.children[0].props.ref.current = {parentElement: root};
      for (const effect of item.effects.splice(0)) effect();
      return result;
    }
    render();
    return {tree, native, render, unmount: () => item.slots.forEach(slot => slot?.cleanup?.())};
  }
  return {window, hub, context, body, menu, toolbar, root, toggle, patches, requests, writes, errors, notifications, observers, document,
    load, flush, mount, get fieldAction() {return fieldAction;}, get dialogReleases() {return dialogReleases;}, get configurationEvents() {return configurationEvents;},
    select(value) {toolbar.className = value ? "has-selection" : ""; observers.filter(observer => !observer.disconnected).forEach(observer => observer.callback([]));},
    open() {fieldAction.onClick({preventDefault() {}, currentTarget: document.activeElement});},
    pickerNode(className) {function search(node) {if (node.classList.contains(className)) return node; return node.children.map(search).find(Boolean);} return search(body);},
  };
}
module.exports = {createExtractorHarness};
