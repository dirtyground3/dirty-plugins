import type { DebugEntry, Host, NativePatchArguments, NativePatchHandler } from "./types";
// --- Plugin debug logging ------------------------------------------------
// Every Dirty plugin records its lifecycle and the PluginApi patches it runs
// on ordinary Stash pages. Entries are kept in window.__dirtyPluginsDebugLog
// and optionally mirrored to the console as [DirtyPlugins][<scope>] … lines.
// Run dirtyPluginsDumpDebugLogs() in the console to dump the full table.
// Console logging is off by default. Enable it with
// window.__dirtyPluginsDebug = true or localStorage dirtyPluginsDebug = "1".
// Note: Stash's Troubleshooting mode disables all plugin JS, so these logs
// only appear when plugins are enabled.
const debugWindow = window as unknown as { __dirtyPluginsDebugLog?: DebugEntry[]; dirtyPluginsDumpDebugLogs?: () => DebugEntry[]; };
const DEBUG_MAX_ENTRIES = 5000;
const throttleState: Record<string, number> = Object.create(null);
let startTime = 0;

/** The log lives on window so it survives a reloaded hub bundle. */
function logStore() {
  return debugWindow.__dirtyPluginsDebugLog || (debugWindow.__dirtyPluginsDebugLog = []);
}

export function debugNow() {
  return window.performance && window.performance.now ? window.performance.now() : Date.now();
}

export function debugElapsed() {
  return Math.round(debugNow() - startTime);
}

function debugEnabled() {
  try {
    if (window.__dirtyPluginsDebug === false) return false;
    if (window.__dirtyPluginsDebug === true) return true;
    if (window.localStorage) return window.localStorage.getItem("dirtyPluginsDebug") === "1";
  } catch (_error) { }
  return false;
}

function errorText(error: unknown) {
  return String((error && (error as Error).message) || error);
}

export function debugLog(scope: string, message: string, data?: unknown): DebugEntry {
  const entry = {
    elapsedMs: debugElapsed(), scope, message,
    path: (window.location && window.location.pathname) || "",
    data: data === undefined ? null : data,
  };
  try {
    const store = logStore();
    store.push(entry);
    if (store.length > DEBUG_MAX_ENTRIES) store.splice(0, store.length - DEBUG_MAX_ENTRIES);
  } catch (_error) { }
  if (!debugEnabled()) return entry;
  const prefix = "[DirtyPlugins][" + scope + "] " + message + " (t+" + entry.elapsedMs + "ms)";
  try {
    if (data === undefined) console.log(prefix);
    else console.log(prefix, data);
  } catch (_error) { }
  return entry;
}

export function debugLogThrottled(scope: string, message: string, data?: unknown, intervalMs?: number) {
  const key = scope + "|" + message, now = debugNow(), last = throttleState[key];
  if (last !== undefined && now - last < (intervalMs || 500)) return null;
  throttleState[key] = now;
  return debugLog(scope, message, data);
}

export function debugDescribe(value: unknown) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value.length > 120 ? value.slice(0, 117) + "..." : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "function") return "function " + (value.name || "anonymous");
  if (Array.isArray(value)) return "Array(" + value.length + ")";
  if (value instanceof Set) return "Set(" + value.size + ")";
  if (value instanceof Map) return "Map(" + value.size + ")";
  if (typeof Element !== "undefined" && value instanceof Element) {
    return "<" + value.tagName.toLowerCase() + (value.id ? "#" + value.id : "") + ">";
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    return "Object{" + keys.slice(0, 8).join(",") + (keys.length > 8 ? ",..." : "") + "}";
  }
  return typeof value;
}

export function debugGraphqlOperationName(query: unknown) {
  if (typeof query !== "string") return "unknown";
  const match = query.match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/);
  if (match) return match[1];
  return query.replace(/\s+/g, " ").trim().slice(0, 60) || "anonymous";
}

export function dumpDebugLogs() {
  try {
    if (console.table) console.table(logStore());
    else console.log(logStore());
  } catch (_error) { }
  return logStore();
}

function wrapPatchHandler(pluginId: string, kind: string, component: string, handler: NativePatchHandler) {
  if (typeof handler !== "function" || handler.__dirtyDebugWrapped) return handler;
  const scope = pluginId + ":patch." + kind + ":" + component;
  function wrappedHandler(this: unknown, ...args: NativePatchArguments) {
    debugLogThrottled(scope, "enter", {
      path: (window.location && window.location.pathname) || "",
      argumentCount: args.length,
      firstArgument: debugDescribe(args[0]),
    }, 500);
    const started = debugNow(), elapsedMs = () => Math.round(debugNow() - started);
    let result;
    try {
      result = handler.apply(this, args);
    } catch (error) {
      debugLog(scope, "THREW", { elapsedMs: elapsedMs(), error: errorText(error), stack: error && (error as Error).stack });
      throw error;
    }
    if (result && typeof result.then === "function") {
      debugLog(scope, "returned a promise (Stash does not await patches)", { elapsedMs: elapsedMs() });
      return result.then((value: unknown) => {
        debugLogThrottled(scope, "promise resolved", { elapsedMs: elapsedMs() }, 500);
        return value;
      }, (error: Error) => {
        debugLog(scope, "promise REJECTED", { elapsedMs: elapsedMs(), error: errorText(error), stack: error && error.stack });
        throw error;
      });
    }
    const elapsed = elapsedMs();
    debugLogThrottled(scope, "exit", { elapsedMs: elapsed, result: debugDescribe(result) }, elapsed > 100 ? 0 : 500);
    return result;
  }
  wrappedHandler.__dirtyDebugWrapped = true;
  return wrappedHandler;
}

function instrumentPluginApi(PluginApi: Host) {
  if (!PluginApi || PluginApi.__dirtyDebugInstrumented) return;
  const currentPluginId = () => window.__dirtyCurrentPluginId || "unknown";
  try {
    if (PluginApi.patch) {
      (["before", "after", "instead"] as const).forEach(kind => {
        const original = PluginApi.patch[kind];
        if (typeof original !== "function") return;
        PluginApi.patch[kind] = (component: string, handler: NativePatchHandler) => {
          const pluginId = currentPluginId();
          debugLog(pluginId, "register patch." + kind + " " + component);
          return original!.call(PluginApi.patch, component, wrapPatchHandler(pluginId, kind, component, handler));
        };
      });
    }
    if (PluginApi.register && typeof PluginApi.register.route === "function") {
      const originalRoute = PluginApi.register.route;
      PluginApi.register.route = (path, component) => {
        debugLog(currentPluginId(), "register route " + path);
        return originalRoute.call(PluginApi.register, path, component);
      };
    }
    PluginApi.__dirtyDebugInstrumented = true;
    debugLog("dirtyPlugins", "PluginApi debug instrumentation installed");
  } catch (error) {
    debugLog("dirtyPlugins", "could not install PluginApi instrumentation", { error: errorText(error), stack: error && (error as Error).stack });
  }
}

function onWindowError(event: ErrorEvent) {
  debugLog("window", "uncaught error", {
    message: event.message, source: event.filename, line: event.lineno, column: event.colno,
    error: event.error && String(event.error.stack || event.error.message),
  });
}
function onUnhandledRejection(event: PromiseRejectionEvent) {
  const reason = event.reason;
  debugLog("window", "unhandled promise rejection", { reason: reason && String(reason.stack || reason.message || reason) });
}

/** Install the window listeners and PluginApi instrumentation; returns their release. */
export function installDebug(PluginApi: Host) {
  startTime = debugNow();
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);
  debugWindow.dirtyPluginsDumpDebugLogs = dumpDebugLogs;
  instrumentPluginApi(PluginApi);
  debugLog("dirtyPlugins", "hub script started", {
    script: document.currentScript && (document.currentScript as HTMLScriptElement).src,
    readyState: document.readyState,
  });
  if (debugEnabled()) {
    try {
      console.info(
        "[DirtyPlugins] Debug logging is active. Lines are prefixed " +
        "[DirtyPlugins]. Run dirtyPluginsDumpDebugLogs() to dump the collected " +
        "log. Stash's Troubleshooting mode disables all plugins, so logs only " +
        "appear when plugins are enabled."
      );
    } catch (_error) { }
  }
  return () => {
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}
