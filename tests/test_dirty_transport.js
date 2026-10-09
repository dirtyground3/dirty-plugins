"use strict";
const { testModulePath } = require("./plugin_paths");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { events } = require("./ui_harness");
const window = events(), requests = [], hub = {};
const noop = () => {};
let response = {ok: true, json: async () => ({data: {ok: true}})};
const moduleExports = { exports: {} };
const context = vm.createContext({window, module: moduleExports, exports: moduleExports.exports, CustomEvent: class {
  constructor(type, options) { this.type = type; this.detail = options?.detail; }
}, fetch: async (url, options) => {
  requests.push({url, ...options});
  if (options.signal) return new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(Object.assign(new Error("Cancelled"), {name: "AbortError"})));
  });
  return response;
}});
vm.runInContext(fs.readFileSync(testModulePath("DirtyPlugins", "transport.cjs"), "utf8"), context);
const transport = moduleExports.exports.createTransport({
  hubApi: hub, pluginRevisionCache: {}, fieldActions: {}, settingsPanels: {},
  FIELD_ACTIONS_CHANGED_EVENT: "fields", CONFIGURATION_CHANGED_EVENT: "configuration", SETTINGS_PANELS_CHANGED_EVENT: "panels",
  asObject: value => value || {}, pluginResult: value => typeof value === "string" ? JSON.parse(value) : value,
  applyVisualTheme: noop, debugGraphqlOperationName: () => "test", debugNow: () => 0,
  debugLogThrottled: noop, debugDescribe: String, debugLog: noop,
});

(async () => {
  const controller = new AbortController();
  const aborted = transport.graphql("query { ok }", {}, {signal: controller.signal});
  controller.abort();
  await assert.rejects(aborted, {name: "AbortError"}, "the shared transport forwards cancellation");
  assert.equal((await transport.graphql("query { ok }", {title: "é"})).ok, true);
  const request = requests.at(-1);
  assert.equal(request.url, "/graphql");
  assert.equal(request.credentials, "same-origin");
  assert.deepEqual(JSON.parse(request.body).variables, {title: "é"});
  response = {ok: false, status: 503};
  await assert.rejects(transport.graphql("query { ok }"), /HTTP 503/);
  response = {ok: true, json: async () => ({errors: [{message: "first"}, {message: "second"}]})};
  await assert.rejects(transport.graphql("query { ok }"), /first; second/);
  response = {ok: true, json: async () => ({})};
  await assert.rejects(transport.graphql("query { ok }"), /did not include data/);

  const backend = result => ({ok: true, json: async () => ({data: {runPluginOperation: JSON.stringify(result)}})});
  response = backend({revision: 3, settings: {enabled: true}});
  assert.equal((await transport.getPluginSettings("example")).enabled, true);
  response = backend({revision: 4, settings: {enabled: false}});
  await transport.configurePlugin("example", {enabled: false});
  assert.equal(JSON.parse(requests.at(-1).body).variables.args.expectedRevision, 3, "saving uses the revision read from storage");
  await transport.configurePlugin("example", {enabled: true}, 2);
  assert.equal(JSON.parse(requests.at(-1).body).variables.args.expectedRevision, 2, "an explicitly merged revision wins over the cache");
  await transport.configurePlugin("example", {enabled: true});
  assert.equal(JSON.parse(requests.at(-1).body).variables.args.expectedRevision, 4, "successful writes advance the cache");

  let configuration;
  window.addEventListener("configuration", event => { configuration = event.detail; });
  hub.notifyConfigurationChanged("example", {preserveSettingsPage: true});
  assert.equal(configuration.pluginId, "example");
  assert.equal(configuration.preserveSettingsPage, true);
  console.log("GraphQL cancellation, response errors, settings revisions and events passed");
})().catch(error => { console.error(error); process.exitCode = 1; });
