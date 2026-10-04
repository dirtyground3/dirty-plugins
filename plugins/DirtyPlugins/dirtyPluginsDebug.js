// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyPluginsDebug";
  if (window[INSTANCE_KEY]) return;
  /** @param {HubDebugDependencies} dependencies */
  function createDebug(dependencies) {
    var PluginApi = dependencies.PluginApi;
    var hubApi = dependencies.hubApi;
    // --- Plugin debug logging ------------------------------------------------
    // Every Dirty plugin records its lifecycle and the PluginApi patches it runs
    // on ordinary Stash pages. Entries are kept in window.__dirtyPluginsDebugLog
    // and optionally mirrored to the console as [DirtyPlugins][<scope>] … lines.
    // Run dirtyPluginsDumpDebugLogs() in the console to dump the full table.
    // Console logging is off by default. Enable it with
    // window.__dirtyPluginsDebug = true or localStorage dirtyPluginsDebug = "1".
    // Note: Stash's Troubleshooting mode disables all plugin JS, so these logs
    // only appear when plugins are enabled.
    var DEBUG_LOG_KEY = "__dirtyPluginsDebugLog";
    var DEBUG_MAX_ENTRIES = 5000;
    var debugLogStore = window[DEBUG_LOG_KEY];
    if (!debugLogStore) {
      debugLogStore = [];
      window[DEBUG_LOG_KEY] = debugLogStore;
    }
    var debugThrottleState = Object.create(null);
    var debugStartTime = (window.performance && window.performance.now)
      ? window.performance.now()
      : Date.now();

    function debugNow() {
      return (window.performance && window.performance.now)
        ? window.performance.now()
        : Date.now();
    }

    function debugElapsed() {
      return Math.round(debugNow() - debugStartTime);
    }

    function debugEnabled() {
      try {
        if (window.__dirtyPluginsDebug === false) return false;
        if (window.__dirtyPluginsDebug === true) return true;
        if (window.localStorage) return window.localStorage.getItem("dirtyPluginsDebug") === "1";
      } catch (_error) {}
      return false;
    }

    function debugLog(scope, message, data) {
      var entry = {
        elapsedMs: debugElapsed(),
        scope: scope,
        message: message,
        path: (window.location && window.location.pathname) || "",
        data: data === undefined ? null : data,
      };
      try {
        debugLogStore.push(entry);
        if (debugLogStore.length > DEBUG_MAX_ENTRIES) {
          debugLogStore.splice(0, debugLogStore.length - DEBUG_MAX_ENTRIES);
        }
      } catch (_error) {}
      if (!debugEnabled()) return entry;
      var prefix = "[DirtyPlugins][" + scope + "] " + message +
        " (t+" + entry.elapsedMs + "ms)";
      try {
        if (data === undefined) console.log(prefix);
        else console.log(prefix, data);
      } catch (_error) {}
      return entry;
    }

    function debugLogThrottled(scope, message, data, intervalMs) {
      var key = scope + "|" + message;
      var now = debugNow();
      var last = debugThrottleState[key];
      if (last !== undefined && now - last < (intervalMs || 500)) return null;
      debugThrottleState[key] = now;
      return debugLog(scope, message, data);
    }

    function debugDescribe(value) {
      if (value === null) return "null";
      if (value === undefined) return "undefined";
      var type = typeof value;
      if (type === "string") {
        return value.length > 120 ? value.slice(0, 117) + "..." : value;
      }
      if (type === "number" || type === "boolean") return String(value);
      if (type === "function") return "function " + (value.name || "anonymous");
      if (Array.isArray(value)) return "Array(" + value.length + ")";
      if (value instanceof Set) return "Set(" + value.size + ")";
      if (value instanceof Map) return "Map(" + value.size + ")";
      if (typeof Element !== "undefined" && value instanceof Element) {
        return "<" + value.tagName.toLowerCase() +
          (value.id ? "#" + value.id : "") + ">";
      }
      if (type === "object") {
        var keys = Object.keys(value);
        return "Object{" + keys.slice(0, 8).join(",") +
          (keys.length > 8 ? ",..." : "") + "}";
      }
      return type;
    }

    function debugGraphqlOperationName(query) {
      if (typeof query !== "string") return "unknown";
      var match = query.match(/\b(?:query|mutation)\s+([A-Za-z0-9_]+)/);
      if (match) return match[1];
      var normalized = query.replace(/\s+/g, " ").trim();
      return normalized.slice(0, 60) || "anonymous";
    }

    function debugCurrentPluginId() {
      return window.__dirtyCurrentPluginId || "unknown";
    }

    function debugWrapPatchHandler(pluginId, kind, component, handler) {
      if (typeof handler !== "function" || handler.__dirtyDebugWrapped) return handler;
      function wrappedHandler() {
        var scope = pluginId + ":patch." + kind + ":" + component;
        var path = (window.location && window.location.pathname) || "";
        var args = Array.prototype.slice.call(arguments);
        debugLogThrottled(scope, "enter", {
          path: path,
          argumentCount: args.length,
          firstArgument: debugDescribe(args[0]),
        }, 500);
        var started = debugNow();
        var result;
        try {
          result = handler.apply(this, arguments);
        } catch (error) {
          debugLog(scope, "THREW", {
            elapsedMs: Math.round(debugNow() - started),
            error: String((error && error.message) || error),
            stack: error && error.stack,
          });
          throw error;
        }
        if (result && typeof result.then === "function") {
          debugLog(scope, "returned a promise (Stash does not await patches)", {
            elapsedMs: Math.round(debugNow() - started),
          });
          return result.then(function (value) {
            debugLogThrottled(scope, "promise resolved", {
              elapsedMs: Math.round(debugNow() - started),
            }, 500);
            return value;
          }, function (error) {
            debugLog(scope, "promise REJECTED", {
              elapsedMs: Math.round(debugNow() - started),
              error: String((error && error.message) || error),
              stack: error && error.stack,
            });
            throw error;
          });
        }
        var elapsed = Math.round(debugNow() - started);
        debugLogThrottled(scope, "exit", {
          elapsedMs: elapsed,
          result: debugDescribe(result),
        }, elapsed > 100 ? 0 : 500);
        return result;
      }
      wrappedHandler.__dirtyDebugWrapped = true;
      return wrappedHandler;
    }

    function debugInstallPluginApiInstrumentation() {
      if (!PluginApi || PluginApi.__dirtyDebugInstrumented) return;
      try {
        if (PluginApi.patch) {
          ["before", "after", "instead"].forEach(function (kind) {
            var original = PluginApi.patch[kind];
            if (typeof original !== "function") return;
            PluginApi.patch[kind] = function (component, handler) {
              var pluginId = debugCurrentPluginId();
              debugLog(pluginId, "register patch." + kind + " " + component);
              return original.call(
                PluginApi.patch,
                component,
                debugWrapPatchHandler(pluginId, kind, component, handler)
              );
            };
          });
        }
        if (PluginApi.register && typeof PluginApi.register.route === "function") {
          var originalRoute = PluginApi.register.route;
          PluginApi.register.route = function (path, component) {
            debugLog(debugCurrentPluginId(), "register route " + path);
            return originalRoute.call(PluginApi.register, path, component);
          };
        }
        PluginApi.__dirtyDebugInstrumented = true;
        debugLog("dirtyPlugins", "PluginApi debug instrumentation installed");
      } catch (error) {
        debugLog("dirtyPlugins", "could not install PluginApi instrumentation", {
          error: String((error && error.message) || error),
          stack: error && error.stack,
        });
      }
    }

    window.addEventListener("error", function (event) {
      debugLog("window", "uncaught error", {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        error: event.error && String(event.error.stack || event.error.message),
      });
    });
    window.addEventListener("unhandledrejection", function (event) {
      var reason = event.reason;
      debugLog("window", "unhandled promise rejection", {
        reason: reason && String(reason.stack || reason.message || reason),
      });
    });

    hubApi.debugLog = debugLog;
    hubApi.debugLogThrottled = debugLogThrottled;
    hubApi.debugEnabled = debugEnabled;
    hubApi.debugElapsed = debugElapsed;
    hubApi.debugDescribe = debugDescribe;
    hubApi.dumpDebugLogs = function () {
      try {
        if (console.table) console.table(window[DEBUG_LOG_KEY]);
        else console.log(window[DEBUG_LOG_KEY]);
      } catch (_error) {}
      return window[DEBUG_LOG_KEY];
    };
    window.dirtyPluginsDumpDebugLogs = hubApi.dumpDebugLogs;
    debugInstallPluginApiInstrumentation();
    debugLog("dirtyPlugins", "hub script started", {
      script: document.currentScript && /** @type {HTMLScriptElement} */ (document.currentScript).src,
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
      } catch (_error) {}
    }

    return {
      debugGraphqlOperationName: debugGraphqlOperationName,
      debugNow: debugNow,
      debugLogThrottled: debugLogThrottled,
      debugDescribe: debugDescribe,
      debugLog: debugLog,
      debugElapsed: debugElapsed
    };
  }
  window[INSTANCE_KEY] = { createDebug: createDebug };
})();
