import { debugDescribe, debugGraphqlOperationName, debugLog, debugLogThrottled, debugNow } from "./debug";
import { applyVisualTheme } from "./theme";
import { asObject, pluginResult } from "./shared/values";

type GraphqlOptions = { signal?: AbortSignal };
const pluginRevisionCache: Record<string, number> = Object.create(null);

export function rememberPluginRevision(pluginId: string, revision: unknown) {
  const value = Number(revision);
  if (Number.isFinite(value)) pluginRevisionCache[pluginId] = Math.max(pluginRevisionCache[pluginId] || 0, value);
}

export function graphql<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>,
  options?: GraphqlOptions,
): Promise<T> {
  return fetch("/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    signal: options && options.signal,
    body: JSON.stringify({ query, variables: variables || {} }),
  })
    .then(response => {
      if (!response.ok) throw new Error("Stash returned HTTP " + response.status);
      return response.json();
    })
    .then(result => {
      if (result.errors && result.errors.length) {
        throw new Error(result.errors.map((error: { message: string }) => error.message).join("; "));
      }
      if (!result.data) throw new Error("GraphQL response did not include data.");
      return result.data as T;
    });
}

/** The public client: graphql with throttled request/response debug entries. */
export function loggedGraphql<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>,
  options?: GraphqlOptions,
): Promise<T> {
  const operationName = debugGraphqlOperationName(query),
    started = debugNow();
  const elapsedMs = () => Math.round(debugNow() - started);
  debugLogThrottled(
    "graphql",
    "request " + operationName,
    {
      path: (window.location && window.location.pathname) || "",
      variables: debugDescribe(variables),
    },
    250,
  );
  return graphql<T>(query, variables, options).then(
    data => {
      debugLogThrottled("graphql", "response " + operationName, { elapsedMs: elapsedMs() }, 250);
      return data;
    },
    error => {
      debugLog("graphql", "FAILED " + operationName, {
        elapsedMs: elapsedMs(),
        error: String((error && error.message) || error),
      });
      throw error;
    },
  );
}

export function runPluginOperation<T = Record<string, unknown>>(
  pluginId: string,
  args: Record<string, unknown>,
): Promise<T> {
  return graphql<{ runPluginOperation: unknown }>(
    "mutation DirtyPluginsOperation($pluginId:ID!,$args:Map!){" + "runPluginOperation(plugin_id:$pluginId,args:$args)}",
    { pluginId, args },
  ).then(data => pluginResult(data.runPluginOperation) as T);
}

export function runSharedOperation<T = Record<string, unknown>>(args: Record<string, unknown>): Promise<T> {
  return runPluginOperation<T>("dirtyPlugins", args);
}

export function getPluginSettings(pluginId: string) {
  return runSharedOperation({ mode: "getSettings", pluginId }).then(result => {
    rememberPluginRevision(pluginId, result && result.revision);
    return asObject(result && result.settings);
  });
}

export function configurePlugin(pluginId: string, input: Record<string, unknown>, expectedRevision?: number) {
  const args: Record<string, unknown> = { mode: "setSettings", pluginId, settings: asObject(input) };
  // Guard the read-modify-write cycle so a stale tab cannot overwrite a
  // newer value written by another session. Callers that merged a specific
  // read pass its revision; otherwise the latest read is used.
  const revisionToken = expectedRevision === undefined ? pluginRevisionCache[pluginId] : expectedRevision;
  if (revisionToken !== undefined && revisionToken !== null) args.expectedRevision = revisionToken;
  return runSharedOperation<{ revision: number; settings?: Record<string, unknown> }>(args).then(result => {
    rememberPluginRevision(pluginId, result && result.revision);
    if (pluginId === "dirtyPlugins") applyVisualTheme(input && input.visualTheme);
    return result;
  });
}
