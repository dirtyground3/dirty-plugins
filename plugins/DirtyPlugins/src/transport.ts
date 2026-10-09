import type { HubTransportDependencies } from "./types";
export function createTransport(dependencies: HubTransportDependencies) {
  var pluginRevisionCache = dependencies.pluginRevisionCache;
  var hubApi = dependencies.hubApi;
  var fieldActions = dependencies.fieldActions;
  var FIELD_ACTIONS_CHANGED_EVENT = dependencies.FIELD_ACTIONS_CHANGED_EVENT;
  var CONFIGURATION_CHANGED_EVENT = dependencies.CONFIGURATION_CHANGED_EVENT;
  var settingsPanels = dependencies.settingsPanels;
  var SETTINGS_PANELS_CHANGED_EVENT = dependencies.SETTINGS_PANELS_CHANGED_EVENT;
  var pluginResult = dependencies.pluginResult;
  var asObject = dependencies.asObject;
  var applyVisualTheme = dependencies.applyVisualTheme;
  var debugGraphqlOperationName = dependencies.debugGraphqlOperationName;
  var debugNow = dependencies.debugNow;
  var debugLogThrottled = dependencies.debugLogThrottled;
  var debugDescribe = dependencies.debugDescribe;
  var debugLog = dependencies.debugLog;
  function rememberPluginRevision(pluginId: string, revision: unknown) {
    var value = Number(revision);
    if (Number.isFinite(value)) pluginRevisionCache[pluginId] = value;
  }

  function cachedPluginRevision(pluginId: string) {
    return Object.prototype.hasOwnProperty.call(pluginRevisionCache, pluginId)
      ? pluginRevisionCache[pluginId]
      : undefined;
  }
  hubApi.registerFieldAction = function(pluginId, settingName, action) {
    if (!fieldActions[pluginId]) fieldActions[pluginId] = Object.create(null);
    if (fieldActions[pluginId][settingName] === action) return;
    fieldActions[pluginId][settingName] = action;
    window.dispatchEvent(new CustomEvent(FIELD_ACTIONS_CHANGED_EVENT));
  };
  hubApi.unregisterFieldAction = function(pluginId, settingName, action) {
    if (!fieldActions[pluginId] || fieldActions[pluginId][settingName] !== action) return;
    delete fieldActions[pluginId][settingName];
    window.dispatchEvent(new CustomEvent(FIELD_ACTIONS_CHANGED_EVENT));
  };
  hubApi.notifyConfigurationChanged = function(pluginId, options) {
    window.dispatchEvent(new CustomEvent(CONFIGURATION_CHANGED_EVENT, {
      detail: {
        pluginId: pluginId,
        preserveSettingsPage: Boolean(options && options.preserveSettingsPage),
      },
    }));
  };
  hubApi.registerSettingsPanel = function(pluginId, component) {
    if (settingsPanels[pluginId] === component) return;
    settingsPanels[pluginId] = component;
    window.dispatchEvent(new CustomEvent(SETTINGS_PANELS_CHANGED_EVENT));
  };
  var settingsAddons = Object.create(null);
  hubApi.registerSettingsAddon = function(pluginId, component) {
    if (settingsAddons[pluginId] === component) return;
    settingsAddons[pluginId] = component;
    window.dispatchEvent(new CustomEvent(SETTINGS_PANELS_CHANGED_EVENT));
  };
  hubApi.unregisterSettingsAddon = function(pluginId, component) {
    if (settingsAddons[pluginId] !== component) return;
    delete settingsAddons[pluginId];
    window.dispatchEvent(new CustomEvent(SETTINGS_PANELS_CHANGED_EVENT));
  };
  hubApi.unregisterSettingsPanel = function(pluginId, component) {
    if (settingsPanels[pluginId] !== component) return;
    delete settingsPanels[pluginId];
    window.dispatchEvent(new CustomEvent(SETTINGS_PANELS_CHANGED_EVENT));
  };
  (window as unknown as { DirtyPlugins: typeof hubApi; }).DirtyPlugins = hubApi;

  function graphql<T = Record<string, unknown>>(query: string, variables?: Record<string, unknown>, options?: { signal?: AbortSignal; }): Promise<T> {
    return fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      signal: options && options.signal,
      body: JSON.stringify({ query: query, variables: variables || {} }),
    })
      .then(function(response) {
        if (!response.ok) throw new Error("Stash returned HTTP " + response.status);
        return response.json();
      })
      .then(function(result) {
        if (result.errors && result.errors.length) {
          throw new Error(result.errors.map(function(error: { message: string; }) {
            return error.message;
          }).join("; "));
        }
        if (!result.data) throw new Error("GraphQL response did not include data.");
        return result.data as T;
      });
  }

  function runPluginOperation<T = Record<string, unknown>>(pluginId: string, args: Record<string, unknown>): Promise<T> {
    return graphql(
      "mutation DirtyPluginsOperation($pluginId:ID!,$args:Map!){" +
      "runPluginOperation(plugin_id:$pluginId,args:$args)}",
      { pluginId: pluginId, args: args }
    ).then(function(data) { return pluginResult(data.runPluginOperation) as T; });
  }

  function runSharedOperation<T = Record<string, unknown>>(args: Record<string, unknown>): Promise<T> {
    return runPluginOperation<T>("dirtyPlugins", args);
  }

  function getPluginSettings(pluginId: string) {
    return runSharedOperation({ mode: "getSettings", pluginId: pluginId }).then(function(result) {
      rememberPluginRevision(pluginId, result && result.revision);
      return asObject(result && result.settings);
    });
  }

  function configurePlugin(pluginId: string, input: Record<string, unknown>, expectedRevision?: number) {
    var args: Record<string, unknown> = { mode: "setSettings", pluginId: pluginId, settings: asObject(input) };
    // Guard the read-modify-write cycle so a stale tab cannot overwrite a
    // newer value written by another session. Callers that merged a specific
    // read pass its revision; otherwise the latest read is used.
    var revisionToken = expectedRevision === undefined
      ? cachedPluginRevision(pluginId)
      : expectedRevision;
    if (revisionToken !== undefined && revisionToken !== null) {
      args.expectedRevision = revisionToken;
    }
    return runSharedOperation<{ revision: number; settings?: Record<string, unknown>; }>(args).then(function(result) {
      rememberPluginRevision(pluginId, result && result.revision);
      if (pluginId === "dirtyPlugins") applyVisualTheme(input && input.visualTheme);
      return result;
    });
  }


  function loggedGraphql<T = Record<string, unknown>>(query: string, variables?: Record<string, unknown>, options?: { signal?: AbortSignal; }): Promise<T> {
    var operationName = debugGraphqlOperationName(query);
    var started = debugNow();
    debugLogThrottled("graphql", "request " + operationName, {
      path: (window.location && window.location.pathname) || "",
      variables: debugDescribe(variables),
    }, 250);
    return graphql<T>(query, variables, options).then(function(data) {
      debugLogThrottled("graphql", "response " + operationName, {
        elapsedMs: Math.round(debugNow() - started),
      }, 250);
      return data;
    }, function(error) {
      debugLog("graphql", "FAILED " + operationName, {
        elapsedMs: Math.round(debugNow() - started),
        error: String((error && error.message) || error),
      });
      throw error;
    });
  }

  return {
    rememberPluginRevision: rememberPluginRevision,
    loggedGraphql: loggedGraphql,
    runPluginOperation: runPluginOperation,
    getPluginSettings: getPluginSettings,
    configurePlugin: configurePlugin,
    runSharedOperation: runSharedOperation,
    graphql: graphql,
    settingsAddons: settingsAddons
  };
}
