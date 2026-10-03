"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const htm = require("../plugins/DirtyPlugins/vendor/htm.umd.js");
const element = (type, props, ...children) => ({ type, props: { ...props, children } });
const effects = [], timers = new Map(), listeners = new Map(), calls = [];
let id = 0;
const React = { createElement: element, cloneElement: (node, props, ...children) => ({ type: node.type,
  props: { ...node.props, ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } }),
  isValidElement: node => !!node?.type, useEffect: fn => effects.push(fn), useRef: value => ({ current: value }) };
const window = { setInterval: fn => { timers.set(++id, fn); return id; }, clearInterval: key => timers.delete(key),
  addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
const context = vm.createContext({ window, console });
const source = fs.readFileSync(path.join(__dirname, "../plugins/DirtyCaptions/dirtyCaptionsIndex.js"), "utf8");
vm.runInContext(source, context);
const api = window.__dirtyCaptionsIndex;
vm.runInContext(source, context);
assert.equal(window.__dirtyCaptionsIndex, api);
// Minimal native-model contracts from Stash v0.31.1: the filter editor uses
// native enum controls, and the factory shares criterionOptions per mode.
// Native CustomFieldsCriterion overwrites the input array, so combining it
// with separate caption criteria must be independent of criterion order.
class NativeCriterion {
  constructor(option, value) { this.criterionOption = option; this.value = value; }
  clone() { return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { value: structuredClone(this.value) }); }
  getId() { return this.criterionOption.type; }
  toQueryParams() { return { type: this.criterionOption.type, value: this.value }; }
  setFromSavedCriterion(value) { this.value = structuredClone(value); }
  fromDecodedParams(value) { this.value = structuredClone(value.value); }
  applyToCriterionInput(input) { input[this.criterionOption.type] = this.value; }
  applyToSavedCriterion(input) { this.applyToCriterionInput(input); }
}
class NativeBooleanCriterion extends NativeCriterion {
  isValid() { return this.value === "true" || this.value === "false"; }
  getLabel(intl) { return intl.messages[this.criterionOption.messageID] + " is " + this.value; }
}
class NativeResolutionCriterion extends NativeCriterion {
  constructor(option) { super(option, ""); this.modifier = "EQUALS"; }
  isValid() { return this.value.length > 0; }
  getLabel(intl) { return intl.messages[this.criterionOption.messageID] + " is " + this.value; }
}
class NativeCustomFieldsCriterion extends NativeCriterion {
  isValid() { return this.value.length > 0; }
}
class NativeOption {
  constructor(type, makeCriterion) { this.type = type; this.messageID = type; this.makeCriterionFn = makeCriterion; }
  makeCriterion() { return this.makeCriterionFn(this); }
}
const options = { criterionOptions: [
  new NativeOption("organized", option => new NativeBooleanCriterion(option, "")),
  new NativeOption("resolution", option => new NativeResolutionCriterion(option)),
  new NativeOption("custom_fields", option => new NativeCustomFieldsCriterion(option, [])),
  new NativeOption("performers", option => new NativeCriterion(option, []))
] };
for (const type of ["dirty_captions_any", "dirty_captions_text", "dirty_captions_verified"]) {
  options.criterionOptions.push(new NativeOption(type, option => new NativeBooleanCriterion(option, "")));
}
class NativeFilter {
  constructor(mode = "SCENES") {
    Object.assign(this, { mode, options, criteria: [], currentPage: 5, sortBy: "rating", searchTerm: "test", randomSeed: -1 });
  }
  clone() { return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { criteria: this.criteria.map(c => c.clone()) }); }
  makeCriterion(type) { return this.options.criterionOptions.find(option => option.type === type).makeCriterion(); }
  makeFilter() { const input = {}; this.criteria.forEach(c => c.applyToCriterionInput(input)); return input; }
  makeSavedFilter() { const input = {}; this.criteria.forEach(c => c.applyToSavedCriterion(input)); return input; }
  getSortBy() {
    if (this.sortBy !== "random") return this.sortBy;
    if (this.randomSeed === -1) this.randomSeed = 123;
    return "random_" + this.randomSeed;
  }
  getEncodedParams() { return { sortby: this.getSortBy(), c: this.criteria.map(c => c.toQueryParams()) }; }
  configureFromSavedFilter(saved) { this.criteria = Object.entries(saved).map(([type, value]) => {
    const c = this.makeCriterion(type); c.setFromSavedCriterion(value); return c;
  }); }
  configureFromDecodedParams(params) { this.criteria = params.c.map(value => {
    const c = this.makeCriterion(value.type); c.fromDecodedParams(value); return c;
  }); }
}
function criterion(type, value, filter = new NativeFilter()) {
  const c = filter.makeCriterion(type); c.value = value; return c;
}
const personal = { field: "personal", modifier: "EQUALS", value: ["keep"] };
const oldCaption = { field: "Contains embedded captions", modifier: "EQUALS", value: ["No"] };
const original = new NativeFilter();
original.criteria = [criterion("performers", ["158"]), criterion("custom_fields", [personal, oldCaption])];
const intl = { messages: {} };
assert.equal(api.installNativeFilters(original, intl), true);
api.installNativeFilters(original, intl);
assert.equal(options.criterionOptions.length, 5, "Only one caption option replaces the old separate options");
const captionOption = options.criterionOptions.find(o => o.type === "dirty_captions");
assert.equal(JSON.stringify(captionOption.options), JSON.stringify(["Any captions", "Text captions", "Bitmap / other", "None", "Verified", "Unverified"]));
assert.equal(JSON.stringify(captionOption.modifierOptions), '["EQUALS"]', "Caption categories have no ordering or range operators");
const changed = api.normalizeFilter(original);
assert.notEqual(changed, original);
assert.equal(original.criteria.length, 2, "Normalizing URL criteria does not mutate the active filter");
assert.equal(changed.currentPage, 5);
assert.equal(changed.sortBy, "rating");
assert.equal(changed.searchTerm, "test");
assert.equal(changed.criteria[0].criterionOption.type, "performers");
const caption = changed.criteria.find(c => c.criterionOption.type === "dirty_captions");
assert.ok(caption instanceof NativeResolutionCriterion, "The native filter dialog renders the same enum controls as Resolution");
assert.equal(caption.value, "None");
assert.equal(caption.getLabel(intl), "Embedded captions is None");
assert.equal(caption.clone().getLabel(intl), "Embedded captions is None");
assert.equal(api.normalizeFilter(changed), changed, "Already normalized filters do not loop setFilter");
caption.value = "Any captions";
for (const reverse of [false, true]) {
  const filter = changed.clone();
  if (reverse) filter.criteria.reverse();
  const fields = filter.makeFilter().custom_fields;
  assert.equal(fields.length, 2);
  assert.equal(fields.find(f => f.field === "personal").value[0], "keep");
  assert.equal(fields.find(f => f.field === oldCaption.field).value[0], "Yes");
  assert.equal(Object.hasOwn(filter.makeFilter(), "dirty_captions"), false, "Plugin-only types never reach GraphQL");
  assert.equal(filter.makeSavedFilter().custom_fields.length, 2);
  const encoded = filter.getEncodedParams().c;
  assert.equal(encoded.length, 2);
  assert.equal(encoded.filter(c => c.type === "custom_fields").length, 1, "URLs group all custom fields into one native criterion");
}
changed.criteria.push(criterion("custom_fields", [
  { field: "Contains embedded text captions", modifier: "EQUALS", value: ["No"] },
  { field: "Caption index status", modifier: "NOT_EQUALS", value: ["Ready"] }
]));
const fields = changed.makeFilter().custom_fields;
assert.equal(fields.find(f => f.field === "Contains embedded text captions").value[0], "No");
assert.equal(fields.find(f => f.field === "Caption index status").modifier, "NOT_EQUALS");
assert.equal(fields.find(f => f.field === "Caption index status").value[0], "Ready");
const saved = changed.makeSavedFilter(), reloaded = new NativeFilter();
reloaded.configureFromSavedFilter(saved);
const restored = api.normalizeFilter(reloaded);
assert.equal(restored, reloaded, "Saved filters are adapted before native controls render");
assert.equal(restored.criteria.filter(c => c.getId() === "dirty_captions").length, 1, "Legacy combinations preserve one caption picker and additional exact custom predicates");
assert.equal(restored.criteria.find(c => c.getId() === "dirty_captions").value, "Bitmap / other");
function querySignature(query) {
  return JSON.stringify({ ...query, custom_fields: [...query.custom_fields].sort((a, b) => a.field.localeCompare(b.field)) });
}
assert.equal(querySignature(restored.makeFilter()), querySignature(changed.makeFilter()), "Saved filters retain the same native query");
const urlReloaded = new NativeFilter();
urlReloaded.configureFromDecodedParams(changed.getEncodedParams());
assert.ok(urlReloaded.criteria.find(c => c.getId() === "dirty_captions") instanceof NativeResolutionCriterion,
  "URL reconstruction restores the native caption criterion, rather than a custom-field chip");
assert.equal(querySignature(urlReloaded.makeFilter()), querySignature(changed.makeFilter()));
changed.sortBy = "random";
assert.equal(changed.getEncodedParams().sortby, "random_123");
assert.equal(changed.randomSeed, 123, "Bookmark serialization preserves the active random seed");
changed.criteria = changed.criteria.filter(c => c.getId() !== "dirty_captions");
assert.equal(changed.makeFilter().custom_fields.some(f => f.field === oldCaption.field), false, "Native remove buttons remove only that caption criterion");
const complex = new NativeFilter();
complex.criteria = [criterion("custom_fields", [{ ...oldCaption, modifier: "NOT_EQUALS" }])];
assert.equal(api.normalizeFilter(complex), complex, "Complex custom field constraints are left editable as custom fields");
const duplicates = new NativeFilter();
duplicates.criteria = [criterion("custom_fields", [oldCaption, oldCaption])];
assert.equal(api.normalizeFilter(duplicates), duplicates, "Duplicate or conflicting legacy constraints retain their exact query");
const categories = [
  ["Any captions", [{ field: oldCaption.field, modifier: "EQUALS", value: ["Yes"] }]],
  ["Text captions", [{ field: "Contains embedded text captions", modifier: "EQUALS", value: ["Yes"] }]],
  ["Bitmap / other", [{ field: oldCaption.field, modifier: "EQUALS", value: ["Yes"] },
    { field: "Contains embedded text captions", modifier: "EQUALS", value: ["No"] }]],
  ["None", [oldCaption]],
  ["Verified", [{ field: "Caption index status", modifier: "EQUALS", value: ["Ready"] }]],
  ["Unverified", [{ field: "Caption index status", modifier: "NOT_EQUALS", value: ["Ready"] }]]
];
for (const [value, expected] of categories) {
  for (const reverse of [false, true]) {
    const filter = new NativeFilter();
    filter.criteria = [criterion("dirty_captions", value), criterion("custom_fields", [personal])];
    if (reverse) filter.criteria.reverse();
    assert.equal(querySignature(filter.makeFilter()), querySignature({ custom_fields: [...expected, personal] }), value);
    for (const save of [false, true]) {
      const reloaded = new NativeFilter();
      if (save) reloaded.configureFromSavedFilter(filter.makeSavedFilter());
      else reloaded.configureFromDecodedParams(filter.getEncodedParams());
      assert.equal(reloaded.criteria.find(c => c.getId() === "dirty_captions").value, value, "Normal URLs and bookmarks restore " + value);
      assert.equal(querySignature(reloaded.makeFilter()), querySignature(filter.makeFilter()));
    }
    const removed = filter.clone();
    removed.criteria = removed.criteria.filter(c => c.getId() !== "dirty_captions");
    assert.equal(querySignature(removed.makeFilter()), querySignature({ custom_fields: [personal] }));
  }
}
const blank = criterion("dirty_captions", "");
assert.equal(blank.isValid(), false);
blank.value = "unexpected";
assert.equal(blank.isValid(), false);
blank.value = "Text captions"; blank.modifier = "GREATER_THAN";
assert.equal(blank.isValid(), false);
const performerFilter = new NativeFilter("PERFORMERS");
assert.equal(api.installNativeFilters(performerFilter, intl), false);
performerFilter.criteria = [criterion("custom_fields", [personal])];
assert.equal(performerFilter.makeFilter().custom_fields[0], personal);
const ui = api.createIndexUi({ api: { React, libraries: { Intl: { useIntl: () => intl } } },
  hub: { react: { html: htm.bind(element), SettingsSection: "section", Button: "button" },
    runPluginOperation: (_pluginId, args) => { calls.push(args); return Promise.resolve({ status: "Finished" }); } } });
const nativeOps = element("native-operations", {});
const nativeToolbar = element("native-toolbar", { filter: original, setFilter() { throw new Error("Equivalent URLs do not update native filter state"); },
  showEditFilter() {}, listSelect: { selectedIds: new Set() }, operationComponent: nativeOps });
const tags = element("native-filter-tags", { criteria: original.criteria });
const nested = element("provider", {}, element("main", {}, nativeToolbar, tags));
const decorated = ui.decorateList(nested, intl);
assert.equal(decorated.props.children[0].props.children[0], nativeToolbar, "Native toolbar elements remain unchanged");
assert.equal(nativeToolbar.props.operationComponent, nativeOps, "No toolbar selector or additional operation is inserted");
assert.ok(original.criteria.some(c => c.getId() === "dirty_captions"));
assert.equal(decorated.props.children[0].props.children[1].props.criteria, original.criteria,
  "Already constructed native FilterTags receive the adapted criteria");
assert.equal(ui.decorateList(element("performer-list", { filter: performerFilter, setFilter() {} })).type, "performer-list");
ui.Monitor();
const cleanup = effects[0]();
assert.equal(calls[0].mode, "indexBootstrap");
assert.equal(timers.size, 0, "Opening the UI does not schedule recurring library checks");
cleanup();
assert.equal(timers.size, 0);
assert.equal(listeners.size, 0);

function browser() {
  let event, cursor, pendingEffects, fail = false;
  const slots = [], calls = [], cleanups = [];
  const hooks = { ...React,
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const old = slots[index];
      if (!old || deps.some((value, i) => value !== old[i])) {
        slots[index] = deps;
        pendingEffects.push(effect);
      }
    }
  };
  const monitor = api.createIndexUi({
    api: { React: hooks, GQL: { useJobsSubscribeSubscription: () => ({ data: { jobsSubscribe: event } }) } },
    hub: { react: {}, runPluginOperation: async (_plugin, args) => {
      calls.push(args);
      if (fail && args.mode === "indexAfterScan") throw new Error("queue unavailable");
      return {};
    } }
  }).Monitor;
  return {
    calls,
    setFailure: value => { fail = value; },
    async render(next) {
      event = next; cursor = 0; pendingEffects = [];
      monitor();
      pendingEffects.forEach(effect => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); });
      await new Promise(resolve => setImmediate(resolve));
    },
    cleanup: () => cleanups.forEach(cleanup => cleanup())
  };
}
function completed(startTime, overrides = {}) {
  // Stash's subscription supplies startTime, without addTime or endTime.
  return { type: "REMOVE", job: { id: "1", description: "Scanning...", status: "FINISHED", startTime, ...overrides } };
}
async function main() {
  const tab = browser();
  const first = completed("2026-10-02T08:00:00Z");
  await tab.render(undefined);
  assert.deepEqual(tab.calls.map(args => args.mode), ["indexBootstrap"]);
  assert.equal(timers.size, 0);
  await tab.render(first);
  assert.equal(tab.calls.length, 2);
  assert.equal(tab.calls[1].mode, "indexAfterScan");
  assert.equal(tab.calls[1].jobId, "1");
  assert.equal(tab.calls[1].startTime, first.job.startTime);
  await tab.render(undefined);
  await tab.render(first);
  assert.equal(tab.calls.length, 2, "Replayed completions are ignored in the same tab");
  await tab.render(completed("2026-10-03T08:00:00Z"));
  assert.equal(tab.calls.length, 3, "Reused Stash job IDs with a new start time are processed");
  for (const status of ["READY", "RUNNING", "CANCELLED", "FAILED", "STOPPING"]) {
    await tab.render(completed("later", { status }));
  }
  await tab.render({ ...completed("later"), type: "UPDATE" });
  await tab.render(completed("later", { description: "Generating..." }));
  await tab.render(completed("later", { description: "DirtyCaptions: refresh caption index" }));
  await tab.render(completed(undefined));
  assert.equal(tab.calls.length, 3, "Only successful Scan removals with an identity trigger refresh");
  listeners.get("dirty-plugins:configuration-changed")();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(tab.calls[3].mode, "indexBootstrap", "Configuration changes can bootstrap the index without a timer");
  const failed = completed("2026-10-04T08:00:00Z");
  tab.setFailure(true);
  await tab.render(failed);
  tab.setFailure(false);
  await tab.render(undefined);
  await tab.render(failed);
  assert.equal(tab.calls.length, 6, "Failed queue attempts release the in-flight Scan identity");
  tab.cleanup();
  assert.equal(listeners.size, 0);
  assert.equal(timers.size, 0);
  console.log("DirtyCaptions native filter and Scan completion regression tests passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
