(function () {
  "use strict";

  var INSTANCE_KEY = "__dirtyPluginsSettingsHub";
  if (window[INSTANCE_KEY]) return;

  var PluginApi = window.PluginApi;
  var React = PluginApi.React;
  var createElement = React.createElement;
  var useCallback = React.useCallback;
  var useEffect = React.useEffect;
  var useMemo = React.useMemo;
  var useRef = React.useRef;
  var useState = React.useState;
  var Link = PluginApi.libraries.ReactRouterDOM.Link;
  var FontAwesomeIcon = PluginApi.libraries.ReactFontAwesome &&
    PluginApi.libraries.ReactFontAwesome.FontAwesomeIcon;
  var ROUTE_PATH = "/plugins/dirty-plugins";
  var CONFIGURATION_CHANGED_EVENT = "dirty-plugins:configuration-changed";
  var FIELD_ACTIONS_CHANGED_EVENT = "dirty-plugins:field-actions-changed";
  var SETTINGS_PANELS_CHANGED_EVENT = "dirty-plugins:settings-panels-changed";
  var UNSAVED_SETTINGS_MESSAGE = "You have unsaved Dirty Plugins settings. Leave without saving them?";

  var MANAGED_PLUGIN_IDS = ["extractScenes", "multiscreen", "dirtyTidy", "dirtyRank", "dirtyStats"];
  var MANAGED_PLUGIN_ID_SET = new Set(MANAGED_PLUGIN_IDS);
  var MAIN_PAGE_PLUGIN_IDS = ["dirtyPlugins", "extractScenes", "multiscreen", "dirtyTidy", "dirtyRank", "dirtyStats"];
  var MAIN_PAGE_PLUGIN_ID_SET = new Set(MAIN_PAGE_PLUGIN_IDS);
  var PLUGIN_SETTING_ORDER = {
    extractScenes: [
      "destinationFolder",
      "collisionPolicy",
      "createSceneFolders",
      "dryRun",
      "maxCopySpeedMBps",
    ],
    multiscreen: [
      "totalScreens",
      "rows",
      "columns",
      "randomize",
      "splitScenes",
      "startMuted",
      "randomStart",
      "loopScenes",
      "markerDuration",
      "pauseWhenHidden",
    ],
    dirtyStats: [
      "visualTheme",
    ],
  };
  var PLUGIN_DEFAULTS = {
    extractScenes: {
      destinationFolder: "",
      collisionPolicy: "rename",
      createSceneFolders: false,
      dryRun: false,
      maxCopySpeedMBps: 20,
    },
    multiscreen: {
      totalScreens: 4,
      rows: 2,
      columns: 2,
      randomize: true,
      splitScenes: false,
      startMuted: true,
      randomStart: true,
      loopScenes: true,
      markerDuration: 30,
      pauseWhenHidden: true,
    },
    dirtyStats: {
      visualTheme: "classic",
    },
  };
  var FIELD_OPTIONS = {
    extractScenes: {
      collisionPolicy: [
        { value: "rename", label: "Rename the new file" },
        { value: "skip", label: "Skip the new file" },
        { value: "overwrite", label: "Overwrite the existing file" },
      ],
    },
    dirtyStats: {
      visualTheme: [
        { value: "classic", label: "Midnight (original)" },
        { value: "candy", label: "Candy Pop" },
        { value: "tropical", label: "Tropical Punch" },
        { value: "arcade", label: "Retro Arcade" },
        { value: "paper", label: "Paper Picnic" },
      ],
    },
  };
  var FIELD_LIMITS = {
    extractScenes: {
      maxCopySpeedMBps: { min: 0 },
    },
    multiscreen: {
      totalScreens: { min: 1, max: 36, step: 1 },
      rows: { min: 1, max: 12, step: 1 },
      columns: { min: 1, max: 12, step: 1 },
      markerDuration: { min: 1, max: 600, step: 1 },
    },
  };

  var hubApi = window.DirtyPlugins || {};
  var fieldActions = hubApi.fieldActions || Object.create(null);
  var settingsPanels = hubApi.settingsPanels || Object.create(null);
  var pluginRevisionCache = Object.create(null);
  hubApi.fieldActions = fieldActions;
  hubApi.settingsPanels = settingsPanels;

  // --- Plugin debug logging ------------------------------------------------
  // Every Dirty plugin records its lifecycle and the PluginApi patches it runs
  // on ordinary Stash pages. Entries are kept in window.__dirtyPluginsDebugLog
  // and mirrored to the browser console as [DirtyPlugins][<scope>] … lines.
  // Run dirtyPluginsDumpDebugLogs() in the console to dump the full table.
  // Silence the console (the in-memory log keeps collecting) with
  // window.__dirtyPluginsDebug = false or localStorage dirtyPluginsDebug = "0".
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
      if (window.localStorage &&
          window.localStorage.getItem("dirtyPluginsDebug") === "0") return false;
    } catch (_error) {}
    return true;
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
    script: document.currentScript && document.currentScript.src,
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

  function rememberPluginRevision(pluginId, revision) {
    var value = Number(revision);
    if (Number.isFinite(value)) pluginRevisionCache[pluginId] = value;
  }

  function cachedPluginRevision(pluginId) {
    return Object.prototype.hasOwnProperty.call(pluginRevisionCache, pluginId)
      ? pluginRevisionCache[pluginId]
      : undefined;
  }
  hubApi.registerFieldAction = function (pluginId, settingName, action) {
    if (!fieldActions[pluginId]) fieldActions[pluginId] = Object.create(null);
    if (fieldActions[pluginId][settingName] === action) return;
    fieldActions[pluginId][settingName] = action;
    window.dispatchEvent(new CustomEvent(FIELD_ACTIONS_CHANGED_EVENT));
  };
  hubApi.unregisterFieldAction = function (pluginId, settingName, action) {
    if (!fieldActions[pluginId] || fieldActions[pluginId][settingName] !== action) return;
    delete fieldActions[pluginId][settingName];
    window.dispatchEvent(new CustomEvent(FIELD_ACTIONS_CHANGED_EVENT));
  };
  hubApi.notifyConfigurationChanged = function (pluginId, options) {
    window.dispatchEvent(new CustomEvent(CONFIGURATION_CHANGED_EVENT, {
      detail: {
        pluginId: pluginId,
        preserveSettingsPage: Boolean(options && options.preserveSettingsPage),
      },
    }));
  };
  hubApi.registerSettingsPanel = function (pluginId, component) {
    if (settingsPanels[pluginId] === component) return;
    settingsPanels[pluginId] = component;
    window.dispatchEvent(new CustomEvent(SETTINGS_PANELS_CHANGED_EVENT));
  };
  hubApi.unregisterSettingsPanel = function (pluginId, component) {
    if (settingsPanels[pluginId] !== component) return;
    delete settingsPanels[pluginId];
    window.dispatchEvent(new CustomEvent(SETTINGS_PANELS_CHANGED_EVENT));
  };
  window.DirtyPlugins = hubApi;

  function graphql(query, variables, options) {
    return fetch("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      signal: options && options.signal,
      body: JSON.stringify({ query: query, variables: variables || {} }),
    })
      .then(function (response) {
        if (!response.ok) throw new Error("Stash returned HTTP " + response.status);
        return response.json();
      })
      .then(function (result) {
        if (result.errors && result.errors.length) {
          throw new Error(result.errors.map(function (error) {
            return error.message;
          }).join("; "));
        }
        if (!result.data) throw new Error("GraphQL response did not include data.");
        return result.data;
      });
  }

  function parseMaybeJson(value) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return value;
    }
  }

  function asObject(value) {
    var parsed = parseMaybeJson(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  }

  function pluginResult(value) {
    var result = parseMaybeJson(value);
    if (result && typeof result === "object" && result.error) throw new Error(String(result.error));
    if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, "output")) {
      return parseMaybeJson(result.output);
    }
    return result;
  }

  function runPluginOperation(pluginId, args) {
    return graphql(
      "mutation DirtyPluginsOperation($pluginId:ID!,$args:Map!){" +
        "runPluginOperation(plugin_id:$pluginId,args:$args)}",
      { pluginId: pluginId, args: args }
    ).then(function (data) { return pluginResult(data.runPluginOperation); });
  }

  function runSharedOperation(args) {
    return runPluginOperation("dirtyPlugins", args);
  }

  function getPluginSettings(pluginId) {
    return runSharedOperation({ mode: "getSettings", pluginId: pluginId }).then(function (result) {
      rememberPluginRevision(pluginId, result && result.revision);
      return asObject(result && result.settings);
    });
  }

  function configurePlugin(pluginId, input, expectedRevision) {
    var args = { mode: "setSettings", pluginId: pluginId, settings: asObject(input) };
    // Guard the read-modify-write cycle so a stale tab cannot overwrite a
    // newer value written by another session. Callers that merged a specific
    // read pass its revision; otherwise the latest read is used.
    var revisionToken = expectedRevision === undefined
      ? cachedPluginRevision(pluginId)
      : expectedRevision;
    if (revisionToken !== undefined && revisionToken !== null) {
      args.expectedRevision = revisionToken;
    }
    return runSharedOperation(args).then(function (result) {
      rememberPluginRevision(pluginId, result && result.revision);
      return result;
    });
  }

  function clampInteger(value, fallback, min, max) {
    var next = Number(value);
    if (!Number.isFinite(next)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(next)));
  }

  function coerceBoolean(value, fallback) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      var normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
    return fallback;
  }

  var toastContainer = null;

  function ensureToastContainer() {
    if (toastContainer && toastContainer.isConnected) return toastContainer;
    toastContainer = document.createElement("div");
    toastContainer.className = "dirty-ui-toast-container";
    toastContainer.setAttribute("aria-live", "polite");
    toastContainer.setAttribute("aria-atomic", "false");
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  function notify(message, options) {
    var settings = typeof options === "string" ? { tone: options } : (options || {});
    var tone = settings.tone || "success";
    var container = ensureToastContainer();
    var toast = document.createElement("div");
    toast.className = "dirty-ui-toast dirty-ui-tone-" + tone;
    toast.setAttribute("role", tone === "error" ? "alert" : "status");
    toast.textContent = message;
    container.appendChild(toast);
    window.setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      if (container.childElementCount === 0 && container.parentNode) {
        container.parentNode.removeChild(container);
        if (toastContainer === container) toastContainer = null;
      }
    }, settings.duration || (tone === "error" ? 8000 : 5000));
    return toast;
  }

  function Glyph(props) {
    if (FontAwesomeIcon && props.icon) {
      return createElement(FontAwesomeIcon, { icon: props.icon });
    }
    return createElement("span", { "aria-hidden": "true" }, props.fallback);
  }

  function IconButton(props) {
    var className = "dirty-ui-icon-button" +
      (props.className ? " " + props.className : "");
    return createElement(
      "button",
      {
        type: "button",
        className: className,
        "aria-label": props.ariaLabel,
        title: props.ariaLabel,
        disabled: Boolean(props.disabled),
        onClick: props.onClick,
      },
      createElement(Glyph, { icon: props.icon, fallback: props.fallback })
    );
  }

  function StateView(props) {
    var className = "dirty-ui-state" +
      (props.className ? " " + props.className : "");
    return createElement(
      "div",
      { className: className, role: props.role, "aria-live": props.ariaLive },
      createElement(
        "div",
        { className: "dirty-ui-state-panel" },
        createElement("div", { className: "dirty-ui-state-title" }, props.title),
        props.detail && createElement(
          "div",
          { className: "dirty-ui-state-detail" },
          props.detail
        ),
        props.actions && createElement(
          "div",
          { className: "dirty-ui-state-actions" },
          props.actions
        )
      )
    );
  }

  function SettingsCard(props) {
    var plugin = props.plugin || {};
    var className = "card dirty-ui-panel dirty-plugins-card" +
      (props.className ? " " + props.className : "");
    var bodyClassName = "card-body" +
      (props.bodyClassName ? " " + props.bodyClassName : "");
    return createElement(
      "section",
      { className: className },
      createElement(
        "div",
        { className: "card-header dirty-plugins-card-header" },
        createElement(
          "div",
          null,
          createElement("h2", null, plugin.name),
          plugin.description && createElement("p", null, plugin.description)
        ),
        createElement(
          "div",
          { className: "dirty-plugins-plugin-meta" },
          plugin.version && createElement("span", null, "v" + plugin.version),
          plugin.enabled === false && createElement(
            "span",
            { className: "badge badge-secondary" },
            "Disabled"
          )
        )
      ),
      createElement("div", { className: bodyClassName }, props.children),
      props.footer
    );
  }

  function SettingsSection(props) {
    var className = "dirty-ui-settings-section" +
      (props.className ? " " + props.className : "");
    return createElement(
      "section",
      { className: className },
      createElement(
        "div",
        { className: "dirty-ui-settings-section-heading" },
        createElement("h3", null, props.title),
        props.description && createElement("p", null, props.description)
      ),
      props.children
    );
  }

  function SettingsToggle(props) {
    return createElement(
      "label",
      { className: "dirty-ui-settings-toggle" },
      createElement("input", {
        checked: Boolean(props.checked),
        disabled: Boolean(props.disabled),
        onChange: function (event) { props.onChange(event.target.checked); },
        type: "checkbox",
      }),
      createElement("span", null, props.label)
    );
  }

  function loggedGraphql(query, variables, options) {
    var operationName = debugGraphqlOperationName(query);
    var started = debugNow();
    debugLogThrottled("graphql", "request " + operationName, {
      path: (window.location && window.location.pathname) || "",
      variables: debugDescribe(variables),
    }, 250);
    return graphql(query, variables, options).then(function (data) {
      debugLogThrottled("graphql", "response " + operationName, {
        elapsedMs: Math.round(debugNow() - started),
      }, 250);
      return data;
    }, function (error) {
      debugLog("graphql", "FAILED " + operationName, {
        elapsedMs: Math.round(debugNow() - started),
        error: String((error && error.message) || error),
      });
      throw error;
    });
  }

  hubApi.graphql = loggedGraphql;
  hubApi.runPluginOperation = runPluginOperation;
  hubApi.getPluginSettings = getPluginSettings;
  hubApi.configurePlugin = configurePlugin;
  hubApi.runSharedOperation = runSharedOperation;
  hubApi.values = {
    asObject: asObject,
    clampInteger: clampInteger,
    coerceBoolean: coerceBoolean,
    parseMaybeJson: parseMaybeJson,
  };
  hubApi.ui = { notify: notify };
  hubApi.react = {
    Glyph: Glyph,
    IconButton: IconButton,
    SettingsCard: SettingsCard,
    SettingsSection: SettingsSection,
    SettingsToggle: SettingsToggle,
    StateView: StateView,
  };

  function loadSettingsSnapshot() {
    return Promise.all([graphql(
      "query DirtyPluginsSettings{" +
        "plugins{id name description version enabled " +
          "settings{name display_name description type}}" +
      "}"
    ), runSharedOperation({ mode: "getAllSettings" })]).then(function (values) {
      var data = values[0];
      var settingsPayload = asObject(values[1]);
      var configuration = asObject(settingsPayload.settings);
      var revisions = asObject(settingsPayload.pluginRevisions);
      Object.keys(revisions).forEach(function (pluginId) {
        rememberPluginRevision(pluginId, revisions[pluginId]);
      });
      var plugins = Array.isArray(data.plugins) ? data.plugins : [];
      return {
        configuration: configuration,
        pluginRevisions: revisions,
        plugins: plugins
          .filter(function (plugin) {
            return MANAGED_PLUGIN_ID_SET.has(plugin.id);
          })
          .sort(function (left, right) {
            return MANAGED_PLUGIN_IDS.indexOf(left.id) - MANAGED_PLUGIN_IDS.indexOf(right.id);
          })
          .map(function (plugin) {
            var order = PLUGIN_SETTING_ORDER[plugin.id] || [];
            var orderIndex = new Map(order.map(function (name, index) {
              return [name, index];
            }));
            return Object.assign({}, plugin, {
              settings: (plugin.settings || []).slice().sort(function (left, right) {
                var leftIndex = orderIndex.has(left.name)
                  ? orderIndex.get(left.name)
                  : Number.MAX_SAFE_INTEGER;
                var rightIndex = orderIndex.has(right.name)
                  ? orderIndex.get(right.name)
                  : Number.MAX_SAFE_INTEGER;
                return leftIndex - rightIndex;
              }),
            });
          }),
      };
    });
  }

  function initialFieldValue(pluginId, setting, rawSettings) {
    if (Object.prototype.hasOwnProperty.call(rawSettings, setting.name)) {
      return rawSettings[setting.name];
    }
    var defaults = PLUGIN_DEFAULTS[pluginId] || {};
    if (Object.prototype.hasOwnProperty.call(defaults, setting.name)) {
      return defaults[setting.name];
    }
    if (setting.type === "BOOLEAN") return false;
    return "";
  }

  function createDrafts(snapshot) {
    var drafts = {};
    snapshot.plugins.forEach(function (plugin) {
      var rawSettings = asObject(snapshot.configuration[plugin.id]);
      drafts[plugin.id] = {};
      (plugin.settings || []).forEach(function (setting) {
        drafts[plugin.id][setting.name] = initialFieldValue(
          plugin.id,
          setting,
          rawSettings
        );
      });
    });
    return drafts;
  }

  function serializeFieldValue(setting, value) {
    if (setting.type === "BOOLEAN") return Boolean(value);
    if (setting.type === "NUMBER") {
      var numberValue = Number(value);
      if (!Number.isFinite(numberValue)) {
        throw new Error((setting.display_name || setting.name) + " must be a number.");
      }
      return numberValue;
    }
    return String(value == null ? "" : value);
  }

  function standardDraftsAreDirty(snapshot, drafts, savedDrafts) {
    if (!snapshot) return false;
    return snapshot.plugins.some(function (plugin) {
      return (plugin.settings || []).some(function (setting) {
        try {
          return serializeFieldValue(
            setting,
            drafts[plugin.id] && drafts[plugin.id][setting.name]
          ) !== serializeFieldValue(
            setting,
            savedDrafts[plugin.id] && savedDrafts[plugin.id][setting.name]
          );
        } catch (_error) {
          return true;
        }
      });
    });
  }

  function getFieldAction(pluginId, settingName) {
    return fieldActions[pluginId] && fieldActions[pluginId][settingName];
  }

  function settingsRoute(pluginId) {
    if (!MANAGED_PLUGIN_ID_SET.has(pluginId)) return ROUTE_PATH;
    return ROUTE_PATH + "?plugin=" + encodeURIComponent(pluginId);
  }

  function requestedPluginId() {
    try {
      return new URLSearchParams(window.location.search).get("plugin");
    } catch (_error) {
      return null;
    }
  }

  function SettingsLink(props) {
    useEffect(function () {
      var frame = window.requestAnimationFrame(orderMainPluginSettingsGroups);
      return function () { window.cancelAnimationFrame(frame); };
    }, []);
    return createElement(
      Link,
      {
        className: "btn btn-primary dirty-ui-button dirty-plugins-settings-link",
        "data-dirty-plugin-id": props.pluginId,
        to: settingsRoute(props.pluginId),
      },
      "Open Dirty Plugins settings"
    );
  }

  function orderMainPluginSettingsGroups() {
    var groups = MAIN_PAGE_PLUGIN_IDS.map(function (pluginId) {
      var link = document.querySelector(
        '[data-dirty-plugin-id="' + pluginId + '"]'
      );
      return link && link.closest(".setting-group");
    }).filter(Boolean);
    if (groups.length < 2) return;

    var parent = groups[0].parentElement;
    groups = groups.filter(function (group) { return group.parentElement === parent; });
    if (groups.length < 2) return;

    var groupSet = new Set(groups);
    var firstGroup = Array.prototype.find.call(parent.children, function (child) {
      return groupSet.has(child);
    });
    if (!firstGroup) return;

    var marker = document.createComment("dirty-plugins-order");
    parent.insertBefore(marker, firstGroup);
    groups.forEach(function (group) { parent.insertBefore(group, marker); });
    parent.removeChild(marker);
  }

  function SettingInput(props) {
    var pluginId = props.pluginId;
    var setting = props.setting;
    var value = props.value;
    var onChange = props.onChange;
    var actionRevision = props.actionRevision;
    var inputId = "dirty-plugin-" + pluginId + "-" + setting.name;
    var options = FIELD_OPTIONS[pluginId] && FIELD_OPTIONS[pluginId][setting.name];
    var limits = FIELD_LIMITS[pluginId] && FIELD_LIMITS[pluginId][setting.name];
    var action = useMemo(function () {
      return getFieldAction(pluginId, setting.name);
    }, [actionRevision, pluginId, setting.name]);
    var control;

    if (setting.type === "BOOLEAN") {
      control = createElement("input", {
        id: inputId,
        type: "checkbox",
        checked: Boolean(value),
        onChange: function (event) { onChange(event.target.checked); },
      });
    } else if (options) {
      control = createElement(
        "select",
        {
          id: inputId,
          className: "form-control",
          value: String(value == null ? "" : value),
          onChange: function (event) { onChange(event.target.value); },
        },
        options.map(function (option) {
          return createElement("option", { key: option.value, value: option.value }, option.label);
        })
      );
    } else {
      control = createElement("input", {
        id: inputId,
        className: "form-control",
        type: setting.type === "NUMBER" ? "number" : "text",
        min: limits && limits.min,
        max: limits && limits.max,
        step: limits && limits.step,
        value: value == null ? "" : value,
        onChange: function (event) { onChange(event.target.value); },
      });
    }

    return createElement(
      "div",
      { className: "dirty-plugins-setting", id: "plugin-" + pluginId + "-" + setting.name },
      createElement(
        "div",
        { className: "dirty-plugins-setting-heading" },
        createElement("label", { htmlFor: inputId }, setting.display_name || setting.name),
        setting.description && createElement("div", { className: "dirty-plugins-setting-description" }, setting.description)
      ),
      createElement(
        "div",
        { className: "dirty-plugins-setting-control" },
        control,
        action && createElement(
          "button",
          {
            type: "button",
            className: "btn btn-secondary dirty-ui-button",
            onClick: function (event) { action.onClick(event); },
          },
          action.label
        )
      )
    );
  }

  function PluginCard(props) {
    var plugin = props.plugin;
    var draft = props.draft || {};
    var status = props.status;
    var actionRevision = props.actionRevision;
    var onFieldChange = props.onFieldChange;
    var footer = (plugin.settings || []).length > 0 && createElement(
      "div",
      { className: "card-footer dirty-plugins-card-footer" },
      createElement(
        "div",
        {
          className: "dirty-plugins-save-status" +
            (status && status.error ? " dirty-ui-text-error" : ""),
          role: status ? "status" : undefined,
        },
        status && status.message
      )
    );

    return createElement(
      SettingsCard,
      { plugin: plugin, footer: footer },
      (plugin.settings || []).length === 0
        ? createElement("p", { className: "dirty-plugins-empty" }, "This plugin has no settings.")
        : (plugin.settings || []).map(function (setting) {
            return createElement(SettingInput, {
              key: setting.name,
              actionRevision: actionRevision,
              pluginId: plugin.id,
              setting: setting,
              value: draft[setting.name],
              onChange: function (value) {
                onFieldChange(plugin.id, setting.name, value);
              },
            });
          })
    );
  }

  function DirtyPluginsRoute() {
    var snapshotState = useState(null);
    var snapshot = snapshotState[0];
    var setSnapshot = snapshotState[1];
    var draftsState = useState({});
    var drafts = draftsState[0];
    var setDrafts = draftsState[1];
    var savedDraftsState = useState({});
    var savedDrafts = savedDraftsState[0];
    var setSavedDrafts = savedDraftsState[1];
    var customDirtyState = useState({});
    var customDirty = customDirtyState[0];
    var setCustomDirty = customDirtyState[1];
    var loadingState = useState(true);
    var loading = loadingState[0];
    var setLoading = loadingState[1];
    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];
    var statusesState = useState({});
    var statuses = statusesState[0];
    var setStatuses = statusesState[1];
    var actionRevisionState = useState(0);
    var actionRevision = actionRevisionState[0];
    var setActionRevision = actionRevisionState[1];
    var settingsPanelRevisionState = useState(0);
    var setSettingsPanelRevision = settingsPanelRevisionState[1];
    var autoSaveTimersRef = useRef({});
    var saveChainsRef = useRef({});
    var saveRevisionsRef = useRef({});
    var activePluginState = useState(requestedPluginId);
    var activePluginId = activePluginState[0];
    var setActivePluginId = activePluginState[1];
    var standardDirty = useMemo(function () {
      return standardDraftsAreDirty(snapshot, drafts, savedDrafts);
    }, [snapshot, drafts, savedDrafts]);
    var hasUnsavedChanges = standardDirty || Object.keys(customDirty).some(function (pluginId) {
      return Boolean(customDirty[pluginId]);
    });
    var reportCustomDirty = useCallback(function (pluginId, dirty) {
      setCustomDirty(function (current) {
        if (Boolean(current[pluginId]) === Boolean(dirty)) return current;
        var next = Object.assign({}, current);
        if (dirty) next[pluginId] = true;
        else delete next[pluginId];
        return next;
      });
    }, []);

    var reload = useCallback(function () {
      setLoading(true);
      setError(null);
      return loadSettingsSnapshot()
        .then(function (nextSnapshot) {
          var nextDrafts = createDrafts(nextSnapshot);
          setSnapshot(nextSnapshot);
          setDrafts(nextDrafts);
          setSavedDrafts(nextDrafts);
          setCustomDirty({});
          setActivePluginId(function (currentPluginId) {
            var currentIsInstalled = nextSnapshot.plugins.some(function (plugin) {
              return plugin.id === currentPluginId;
            });
            return currentIsInstalled
              ? currentPluginId
              : (nextSnapshot.plugins[0] && nextSnapshot.plugins[0].id);
          });
        })
        .catch(function (loadError) {
          setError(loadError.message || String(loadError));
        })
        .then(function () { setLoading(false); });
    }, []);

    useEffect(function () {
      reload();
    }, [reload]);

    useEffect(function () {
      function onConfigurationChanged(event) {
        if (event.detail && event.detail.preserveSettingsPage) return;
        reload();
      }
      function onFieldActionsChanged() {
        setActionRevision(function (revision) { return revision + 1; });
      }
      function onSettingsPanelsChanged() {
        setSettingsPanelRevision(function (revision) { return revision + 1; });
      }
      window.addEventListener(CONFIGURATION_CHANGED_EVENT, onConfigurationChanged);
      window.addEventListener(FIELD_ACTIONS_CHANGED_EVENT, onFieldActionsChanged);
      window.addEventListener(SETTINGS_PANELS_CHANGED_EVENT, onSettingsPanelsChanged);
      return function () {
        window.removeEventListener(CONFIGURATION_CHANGED_EVENT, onConfigurationChanged);
        window.removeEventListener(FIELD_ACTIONS_CHANGED_EVENT, onFieldActionsChanged);
        window.removeEventListener(SETTINGS_PANELS_CHANGED_EVENT, onSettingsPanelsChanged);
      };
    }, [reload]);

    useEffect(function () {
      if (!hasUnsavedChanges) return undefined;

      function beforeUnload(event) {
        event.preventDefault();
        event.returnValue = "";
      }

      function confirmLinkNavigation(event) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
            event.shiftKey || event.altKey) return;
        var anchor = event.target && event.target.closest && event.target.closest("a[href]");
        if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
        var destination;
        try {
          destination = new URL(anchor.href, window.location.href);
        } catch (_error) {
          return;
        }
        if (destination.href === window.location.href) return;
        if (window.confirm(UNSAVED_SETTINGS_MESSAGE)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }

      window.addEventListener("beforeunload", beforeUnload);
      document.addEventListener("click", confirmLinkNavigation, true);
      return function () {
        window.removeEventListener("beforeunload", beforeUnload);
        document.removeEventListener("click", confirmLinkNavigation, true);
      };
    }, [hasUnsavedChanges]);

    useEffect(function () {
      return function () {
        Object.keys(autoSaveTimersRef.current).forEach(function (pluginId) {
          window.clearTimeout(autoSaveTimersRef.current[pluginId]);
        });
      };
    }, []);

    function updateField(pluginId, settingName, value) {
      var plugin = snapshot && snapshot.plugins.find(function (item) { return item.id === pluginId; });
      var nextPluginDraft = Object.assign({}, drafts[pluginId] || {});
      nextPluginDraft[settingName] = value;
      setDrafts(function (current) {
        var next = Object.assign({}, current);
        next[pluginId] = nextPluginDraft;
        return next;
      });
      setStatuses(function (current) {
        var next = Object.assign({}, current);
        delete next[pluginId];
        return next;
      });
      if (!plugin) return;
      var revision = (saveRevisionsRef.current[pluginId] || 0) + 1;
      saveRevisionsRef.current[pluginId] = revision;
      window.clearTimeout(autoSaveTimersRef.current[pluginId]);
      autoSaveTimersRef.current[pluginId] = window.setTimeout(function () {
        savePlugin(plugin, nextPluginDraft, revision);
      }, 350);
    }

    function savePlugin(plugin, pluginDraft, revision) {
      var rawSettings = asObject(snapshot.configuration[plugin.id]);
      var input = Object.assign({}, rawSettings);
      try {
        (plugin.settings || []).forEach(function (setting) {
          input[setting.name] = serializeFieldValue(
            setting,
            pluginDraft && pluginDraft[setting.name]
          );
        });
      } catch (validationError) {
        setStatuses(function (current) {
          var next = Object.assign({}, current);
          next[plugin.id] = { error: true, message: validationError.message };
          return next;
        });
        return;
      }
      setStatuses(function (current) {
        var next = Object.assign({}, current);
        next[plugin.id] = { error: false, message: "Saving automatically…" };
        return next;
      });

      var previousSave = saveChainsRef.current[plugin.id] || Promise.resolve();
      var currentSave = previousSave.catch(function () {}).then(function () {
        // Use the revision of the snapshot this input was merged from so a
        // concurrent writer is never silently overwritten.
        var expectedRevision = snapshot.pluginRevisions
          ? snapshot.pluginRevisions[plugin.id]
          : undefined;
        return configurePlugin(plugin.id, input, expectedRevision);
      });
      saveChainsRef.current[plugin.id] = currentSave;
      currentSave
        .then(function () {
          snapshot.configuration[plugin.id] = input;
          if (snapshot.pluginRevisions) {
            snapshot.pluginRevisions[plugin.id] = cachedPluginRevision(plugin.id);
          }
          if (saveRevisionsRef.current[plugin.id] !== revision) return;
          setSavedDrafts(function (current) {
            var next = Object.assign({}, current);
            next[plugin.id] = Object.assign({}, pluginDraft || {});
            return next;
          });
          setStatuses(function (current) {
            var next = Object.assign({}, current);
            next[plugin.id] = { error: false, message: "Saved automatically." };
            return next;
          });
          hubApi.notifyConfigurationChanged(plugin.id, { preserveSettingsPage: true });
        })
        .catch(function (saveError) {
          if (saveRevisionsRef.current[plugin.id] !== revision) return;
          setStatuses(function (current) {
            var next = Object.assign({}, current);
            next[plugin.id] = {
              error: true,
              message: saveError.message || String(saveError),
            };
            return next;
          });
        });
    }

    function selectPlugin(pluginId) {
      if (pluginId !== activePluginId && customDirty[activePluginId]) {
        if (!window.confirm(UNSAVED_SETTINGS_MESSAGE)) return false;
        reportCustomDirty(activePluginId, false);
      }
      setActivePluginId(pluginId);
      try {
        var nextUrl = new URL(window.location.href);
        nextUrl.searchParams.set("plugin", pluginId);
        window.history.replaceState(
          window.history.state,
          "",
          nextUrl.pathname + nextUrl.search + nextUrl.hash
        );
      } catch (_error) {
        // The selected tab still works if the browser URL cannot be updated.
      }
      return true;
    }

    function onTabKeyDown(event, pluginIndex) {
      if (!snapshot || !snapshot.plugins.length) return;
      var nextIndex = pluginIndex;
      if (event.key === "ArrowRight") {
        nextIndex = (pluginIndex + 1) % snapshot.plugins.length;
      } else if (event.key === "ArrowLeft") {
        nextIndex = (pluginIndex - 1 + snapshot.plugins.length) % snapshot.plugins.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = snapshot.plugins.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      var nextPlugin = snapshot.plugins[nextIndex];
      if (!selectPlugin(nextPlugin.id)) return;
      var nextTab = document.getElementById("dirty-plugins-tab-" + nextPlugin.id);
      if (nextTab) nextTab.focus();
    }

    var activePlugin = snapshot && snapshot.plugins.find(function (plugin) {
      return plugin.id === activePluginId;
    });
    var activeSettingsPanel = activePlugin && settingsPanels[activePlugin.id];

    return createElement(
      "main",
      {
        className: "dirty-plugins-page" + (
          new URLSearchParams(window.location.search).get("docsCapture") === "1"
            ? " dirty-plugins-docs-capture"
            : ""
        ),
      },
      createElement(
        "header",
        { className: "dirty-plugins-page-header" },
        createElement("h1", null, "Dirty Plugins"),
        createElement("p", null, "Settings are shown only for Dirty plugins installed in this Stash instance."),
        hasUnsavedChanges && createElement(
          "div",
          { className: "dirty-plugins-unsaved", role: "status" },
          "Unsaved changes"
        )
      ),
      loading && createElement(StateView, {
        className: "dirty-plugins-state",
        title: "Loading settings…",
      }),
      !loading && error && createElement(StateView, {
        className: "dirty-plugins-state",
        detail: error,
        title: "Could not load Dirty Plugins settings",
        actions: createElement(
          "button",
          {
            type: "button",
            className: "btn btn-secondary dirty-ui-button",
            onClick: reload,
          },
          "Retry"
        ),
      }),
      !loading && !error && snapshot && snapshot.plugins.length === 0 && createElement(StateView, {
        className: "dirty-plugins-state",
        title: "No configurable Dirty plugins are installed.",
      }),
      !loading && !error && snapshot && snapshot.plugins.length > 0 && createElement(
        React.Fragment,
        null,
        createElement(
          "div",
          {
            "aria-label": "Dirty plugin settings",
            className: "nav nav-tabs dirty-plugins-tabs",
            role: "tablist",
          },
          snapshot.plugins.map(function (plugin, pluginIndex) {
            var selected = plugin.id === activePluginId;
            return createElement(
              "button",
              {
                "aria-controls": "dirty-plugins-panel-" + plugin.id,
                "aria-selected": selected,
                className: "nav-link dirty-plugins-tab" + (selected ? " active" : ""),
                id: "dirty-plugins-tab-" + plugin.id,
                key: plugin.id,
                onClick: function () { selectPlugin(plugin.id); },
                onKeyDown: function (event) { onTabKeyDown(event, pluginIndex); },
                role: "tab",
                tabIndex: selected ? 0 : -1,
                type: "button",
              },
              plugin.name
            );
          })
        ),
        activePlugin && createElement(
          "div",
          {
            "aria-labelledby": "dirty-plugins-tab-" + activePlugin.id,
            className: "dirty-plugins-tab-panel",
            id: "dirty-plugins-panel-" + activePlugin.id,
            role: "tabpanel",
          },
          activeSettingsPanel
            ? createElement(activeSettingsPanel, {
                configuration: asObject(snapshot.configuration[activePlugin.id]),
                onDirtyChange: reportCustomDirty,
                onConfigurationChanged: reload,
                plugin: activePlugin,
              })
            : createElement(PluginCard, {
                actionRevision: actionRevision,
                draft: drafts[activePlugin.id],
                plugin: activePlugin,
                status: statuses[activePlugin.id],
                onFieldChange: updateField,
              })
        )
      )
    );
  }

  window.__dirtyCurrentPluginId = "dirtyPlugins";
  PluginApi.patch.instead("PluginSettings", function () {
    var args = Array.prototype.slice.call(arguments);
    var next = args.pop();
    var props = args[0];
    var pluginId = props && (props.pluginID || props.pluginId || props.id);
    if (!MAIN_PAGE_PLUGIN_ID_SET.has(pluginId)) return next.apply(null, args);
    return createElement(SettingsLink, { pluginId: pluginId });
  });
  PluginApi.register.route(ROUTE_PATH, DirtyPluginsRoute);
  window[INSTANCE_KEY] = { route: ROUTE_PATH };
  debugLog("dirtyPlugins", "hub script finished registering", {
    route: ROUTE_PATH,
    elapsedMs: debugElapsed(),
  });
  window.__dirtyCurrentPluginId = null;
})();
