(function () {
  "use strict";

  var INSTANCE_KEY = "__dirtyPluginsSettingsHub";
  if (window[INSTANCE_KEY]) return;
  var valuesModule = window.__dirtyPluginsValues;
  if (!valuesModule) return;
  var parseMaybeJson = valuesModule.parseMaybeJson, asObject = valuesModule.asObject;
  var pluginResult = valuesModule.pluginResult, clampInteger = valuesModule.clampInteger;
  var coerceBoolean = valuesModule.coerceBoolean;

  var PluginApi = window.PluginApi;
  var React = PluginApi.React;
  var createElement = React.createElement;
  var html = htm.bind(createElement);
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
  var DEFAULT_VISUAL_THEME = "classic";

  var MANAGED_PLUGIN_IDS = ["dirtyPlugins", "extractScenes", "multiscreen", "dirtyTidy", "dirtyRank", "dirtyStats", "dirtyCompactor", "dirtyCaptions"];
  var MANAGED_PLUGIN_ID_SET = new Set(MANAGED_PLUGIN_IDS);
  var MAIN_PAGE_PLUGIN_IDS = ["dirtyPlugins", "extractScenes", "multiscreen", "dirtyTidy", "dirtyRank", "dirtyStats", "dirtyCompactor", "dirtyCaptions"];
  var MAIN_PAGE_PLUGIN_ID_SET = new Set(MAIN_PAGE_PLUGIN_IDS);
  var PLUGIN_SETTING_ORDER = {
    dirtyPlugins: ["visualTheme"],
    dirtyCaptions: ["enabled", "showByDefault", "preferredLanguage", "indexEnabled", "refreshAfterScan"],
    extractScenes: [
      "destinationFolder",
      "collisionPolicy",
      "createSceneFolders",
      "dryRun",
      "maxCopySpeedMBps",
    ],
    multiscreen: window.__dirtyPluginsMetadata.multiscreen.order,
  };
  var PLUGIN_DEFAULTS = {
    dirtyCaptions: {
      enabled: true,
      showByDefault: true,
      preferredLanguage: "",
      indexEnabled: true,
      refreshAfterScan: false,
    },
    dirtyPlugins: {
      visualTheme: DEFAULT_VISUAL_THEME,
    },
    extractScenes: {
      destinationFolder: "",
      collisionPolicy: "rename",
      createSceneFolders: false,
      dryRun: false,
      maxCopySpeedMBps: 20,
    },
    multiscreen: window.__dirtyPluginsMetadata.multiscreen.defaults,
  };
  var FIELD_OPTIONS = {
    extractScenes: {
      collisionPolicy: [
        { value: "rename", label: "Rename the new file" },
        { value: "skip", label: "Skip the new file" },
        { value: "overwrite", label: "Overwrite the existing file" },
      ],
    },
    dirtyPlugins: {
      visualTheme: [
        { value: "classic", label: "Midnight (original)" },
        { value: "candy", label: "Candy Pop" },
        { value: "tropical", label: "Tropical Punch" },
        { value: "arcade", label: "Retro Arcade" },
        { value: "paper", label: "Paper Picnic" },
        { value: "destijl", label: "De Stijl" },
        { value: "destijl-dark", label: "De Stijl Dark" },
      ],
    },
  };
  var FIELD_LIMITS = {
    extractScenes: {
      maxCopySpeedMBps: { min: 0 },
    },
    multiscreen: window.__dirtyPluginsMetadata.multiscreen.limits,
  };

  var hubApi = window.DirtyPlugins || {};
  hubApi.settingsMetadata = window.__dirtyPluginsMetadata;
  var fieldActions = hubApi.fieldActions || Object.create(null);
  var settingsPanels = hubApi.settingsPanels || Object.create(null);
  var pluginRevisionCache = Object.create(null);
  hubApi.fieldActions = fieldActions;
  hubApi.settingsPanels = settingsPanels;

  var debugModule = window.__dirtyPluginsDebug.createDebug({
    PluginApi: PluginApi,
    hubApi: hubApi
  });
  var debugGraphqlOperationName = debugModule.debugGraphqlOperationName;
  var debugNow = debugModule.debugNow;
  var debugLogThrottled = debugModule.debugLogThrottled;
  var debugDescribe = debugModule.debugDescribe;
  var debugLog = debugModule.debugLog;
  var debugElapsed = debugModule.debugElapsed;

  var transportModule = window.__dirtyPluginsTransport.createTransport({
    pluginRevisionCache: pluginRevisionCache,
    hubApi: hubApi,
    fieldActions: fieldActions,
    FIELD_ACTIONS_CHANGED_EVENT: FIELD_ACTIONS_CHANGED_EVENT,
    CONFIGURATION_CHANGED_EVENT: CONFIGURATION_CHANGED_EVENT,
    settingsPanels: settingsPanels,
    SETTINGS_PANELS_CHANGED_EVENT: SETTINGS_PANELS_CHANGED_EVENT,
    pluginResult: pluginResult,
    asObject: asObject,
    applyVisualTheme: function (value) { return applyVisualTheme(value); },
    debugGraphqlOperationName: debugGraphqlOperationName,
    debugNow: debugNow,
    debugLogThrottled: debugLogThrottled,
    debugDescribe: debugDescribe,
    debugLog: debugLog
  });
  var rememberPluginRevision = transportModule.rememberPluginRevision;
  var loggedGraphql = transportModule.loggedGraphql;
  var runPluginOperation = transportModule.runPluginOperation;
  var getPluginSettings = transportModule.getPluginSettings;
  var configurePlugin = transportModule.configurePlugin;
  var runSharedOperation = transportModule.runSharedOperation;
  var graphql = transportModule.graphql;
  var settingsAddons = transportModule.settingsAddons;

  var reactModule = window.__dirtyPluginsReact.createReact({
    useEffect: useEffect,
    useRef: useRef,
    html: html,
    PluginApi: PluginApi,
    FontAwesomeIcon: FontAwesomeIcon,
    React: React,
    Link: Link,
    hubApi: hubApi
  });
  var notify = reactModule.notify;
  var trapDialogTab = reactModule.trapDialogTab;
  var lockBodyScroll = reactModule.lockBodyScroll;
  var manageDialog = reactModule.manageDialog;
  var ActionMenu = reactModule.ActionMenu;
  var Badge = reactModule.Badge;
  var Button = reactModule.Button;
  var Dialog = reactModule.Dialog;
  var Field = reactModule.Field;
  var Glyph = reactModule.Glyph;
  var IconButton = reactModule.IconButton;
  var Metric = reactModule.Metric;
  var NavAction = reactModule.NavAction;
  var Pagination = reactModule.Pagination;
  var SaveStatus = reactModule.SaveStatus;
  var SettingsCard = reactModule.SettingsCard;
  var SettingsSection = reactModule.SettingsSection;
  var SettingsToggle = reactModule.SettingsToggle;
  var StateView = reactModule.StateView;
  var StatisticSelector = reactModule.StatisticSelector;
  var usePageTitle = reactModule.usePageTitle;

  hubApi.graphql = loggedGraphql;
  hubApi.runPluginOperation = runPluginOperation;
  hubApi.getPluginSettings = getPluginSettings;
  hubApi.configurePlugin = configurePlugin;
  hubApi.createSaveController = window.__dirtyPluginsSave.createSaveController;
  hubApi.completedJob = window.__dirtyPluginsJobs.completedJob;
  hubApi.createReplayTracker = window.__dirtyPluginsJobs.createReplayTracker;
  hubApi.runSharedOperation = runSharedOperation;
  hubApi.isInternalScan = function (jobId, startTime) {
    return runSharedOperation({ mode: "isInternalScan", jobId: String(jobId), startTime: startTime })
      .then(function (result) { return Boolean(result.internal); });
  };
  hubApi.values = {
    asObject: asObject,
    clampInteger: clampInteger,
    coerceBoolean: coerceBoolean,
    parseMaybeJson: parseMaybeJson,
  };
  hubApi.ui = { notify: notify, trapDialogTab: trapDialogTab, lockBodyScroll: lockBodyScroll, manageDialog: manageDialog };
  var themeModule = window.__dirtyPluginsTheme.createTheme({
    hubApi: hubApi,
    DEFAULT_VISUAL_THEME: DEFAULT_VISUAL_THEME,
    getPluginSettings: getPluginSettings,
    asObject: asObject
  });
  var applyVisualTheme = themeModule.applyVisualTheme;
  var normalizedVisualTheme = themeModule.normalizedVisualTheme;

  hubApi.react = {
    html: html,
    ActionMenu: ActionMenu,
    Badge: Badge,
    Button: Button,
    Dialog: Dialog,
    Field: Field,
    Glyph: Glyph,
    IconButton: IconButton,
    Metric: Metric,
    NavAction: NavAction,
    Pagination: Pagination,
    SaveStatus: SaveStatus,
    SettingsCard: SettingsCard,
    SettingsSection: SettingsSection,
    SettingsToggle: SettingsToggle,
    StateView: StateView,
    StatisticSelector: StatisticSelector,
    usePageTitle: usePageTitle,
  };
  var nativeModule = window.__dirtyPluginsNative.createNative({
    hubApi: hubApi,
    PluginApi: PluginApi,
    Dialog: Dialog,
    StateView: StateView,
    Button: Button,
    html: html,
    useEffect: useEffect,
    useState: useState,
    useRef: useRef
  });

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
      var suiteSettings = asObject(configuration.dirtyPlugins);
      if (!Object.prototype.hasOwnProperty.call(suiteSettings, "visualTheme")) {
        configuration.dirtyPlugins = Object.assign({}, suiteSettings, {
          visualTheme: normalizedVisualTheme(asObject(configuration.dirtyStats).visualTheme),
        });
      }
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
    return html`<${Link}
      className="btn btn-primary dirty-ui-button dirty-plugins-settings-link"
      data-dirty-plugin-id=${props.pluginId}
      to=${settingsRoute(props.pluginId)}
    >Open Dirty Plugins settings<//>`;
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
    var maskedPath = pluginId === "extractScenes" && setting.name === "destinationFolder" && hubApi.captureEnabled(window.location && window.location.search);
    var options = FIELD_OPTIONS[pluginId] && FIELD_OPTIONS[pluginId][setting.name];
    var limits = FIELD_LIMITS[pluginId] && FIELD_LIMITS[pluginId][setting.name];
    var action = useMemo(function () {
      return getFieldAction(pluginId, setting.name);
    }, [actionRevision, pluginId, setting.name]);
    var control;

    if (setting.type === "BOOLEAN") {
      control = html`<input
        id=${inputId}
        type="checkbox"
        checked=${Boolean(value)}
        onChange=${function (event) { onChange(event.target.checked); }}
      />`;
    } else if (options) {
      control = html`<select
        id=${inputId}
        className="form-control dirty-ui-select"
        value=${String(value == null ? "" : value)}
        onChange=${function (event) { onChange(event.target.value); }}
      >
        ${options.map(function (option) {
          return html`<option key=${option.value} value=${option.value}>${option.label}</option>`;
        })}
      </select>`;
    } else {
      control = html`<input
        id=${inputId}
        className="form-control"
        disabled=${maskedPath}
        type=${setting.type === "NUMBER" ? "number" : "text"}
        min=${limits && limits.min}
        max=${limits && limits.max}
        step=${limits && limits.step}
        value=${maskedPath ? "Path hidden for documentation" : value == null ? "" : value}
        onChange=${function (event) { onChange(event.target.value); }}
      />`;
    }

    var actionButton = action && html`<button
      type="button"
      className="btn btn-secondary dirty-ui-button"
      onClick=${function (event) { action.onClick(event); }}
    >${action.label}</button>`;
    return html`<${Field}
      id=${inputId}
      containerId=${"plugin-" + pluginId + "-" + setting.name}
      className="dirty-plugins-setting"
      label=${setting.display_name || setting.name}
      help=${setting.description}
      action=${actionButton}
    >${control}<//>`;
  }

  function DatabaseBackupControl() {
    var busyState = useState(false);
    var busy = busyState[0];
    var setBusy = busyState[1];
    var resultState = useState(null);
    var result = resultState[0];
    var setResult = resultState[1];
    function createBackup() {
      if (busy) return;
      setBusy(true);
      setResult(null);
      runSharedOperation({ mode: "backupDatabase" }).then(function (response) {
        setResult({ error: false, message: response && response.path || "Backup created." });
      }).catch(function (error) {
        setResult({ error: true, message: error.message || String(error) });
      }).then(function () { setBusy(false); });
    }
    var capture = hubApi.captureEnabled(window.location && window.location.search);
    return html`
      <section className="dirty-plugins-backup dirty-ui-settings-section" aria-labelledby="dirty-plugins-backup-title">
        <h3 id="dirty-plugins-backup-title">Database backup</h3>
        <p>Create a copy of the shared Dirty Plugins database in the installed DirtyPlugins folder.</p>
        <${Button} busy=${busy} disabled=${busy} onClick=${createBackup}>${busy ? "Creating backup…" : "Create backup"}<//>
        ${result && html`<p
          className=${result.error ? "dirty-ui-text-error" : "dirty-plugins-backup-result"}
          role=${result.error ? "alert" : "status"}
        >${result.error ? result.message : "Backup saved: " + (capture ? "Path hidden for documentation" : result.message)}</p>`}
      </section>`;
  }

  function PluginCard(props) {
    var plugin = props.plugin;
    var draft = props.draft || {};
    var status = props.status;
    var actionRevision = props.actionRevision;
    var onFieldChange = props.onFieldChange;
    var footer = (plugin.settings || []).length > 0 && html`
      <div className="card-footer dirty-plugins-card-footer">
        <div
          className=${"dirty-plugins-save-status" + (status && status.error ? " dirty-ui-text-error" : "")}
          role=${status ? "status" : undefined}
        >${status && status.message}</div>
      </div>`;

    return html`
      <${SettingsCard} plugin=${plugin} footer=${footer}>
        ${(plugin.settings || []).length === 0
          ? html`<p className="dirty-plugins-empty">This plugin has no settings.</p>`
          : (plugin.settings || []).map(function (setting) {
              return html`<${SettingInput}
                key=${setting.name}
                actionRevision=${actionRevision}
                pluginId=${plugin.id}
                setting=${setting}
                value=${draft[setting.name]}
                onChange=${function (value) {
                  onFieldChange(plugin.id, setting.name, value);
                }}
              />`;
            })}
        ${plugin.id === "dirtyPlugins" && html`<${DatabaseBackupControl} />`}
        ${settingsAddons[plugin.id] && html`<${settingsAddons[plugin.id]} plugin=${plugin} configuration=${draft} />`}
      <//>`;
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
    var saveControllersRef = useRef({});
    var snapshotRef = useRef(snapshot);
    snapshotRef.current = snapshot;
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
        Object.keys(saveControllersRef.current).forEach(function (id) { saveControllersRef.current[id].dispose(); });
      };
    }, []);

    function pluginInput(plugin, draft, snapshotValue) {
      var input = Object.assign({}, asObject(snapshotValue.configuration[plugin.id]));
      (plugin.settings || []).forEach(function (setting) { input[setting.name] = serializeFieldValue(setting, draft[setting.name]); });
      return input;
    }

    function saveController(plugin) {
      if (!saveControllersRef.current[plugin.id]) saveControllersRef.current[plugin.id] = hubApi.createSaveController({
        delay: 350,
        validate: function (draft) {
          try { pluginInput(plugin, draft, snapshotRef.current); return ""; }
          catch (error) { return error.message; }
        },
        save: function (draft) {
          var current = snapshotRef.current;
          var input = pluginInput(plugin, draft, current);
          var expected = current.pluginRevisions && current.pluginRevisions[plugin.id];
          return configurePlugin(plugin.id, input, expected).then(function (result) { return { input: input, revision: result.revision }; });
        },
        onSaved: function (draft, result, current) {
          var nextSnapshot = Object.assign({}, snapshotRef.current, {
            configuration: Object.assign({}, snapshotRef.current.configuration),
            pluginRevisions: Object.assign({}, snapshotRef.current.pluginRevisions),
          });
          nextSnapshot.configuration[plugin.id] = result.input;
          nextSnapshot.pluginRevisions[plugin.id] = result.revision;
          snapshotRef.current = nextSnapshot;
          setSnapshot(nextSnapshot);
          setSavedDrafts(function (saved) { var next = Object.assign({}, saved); next[plugin.id] = Object.assign({}, draft); return next; });
          if (current) hubApi.notifyConfigurationChanged(plugin.id, { preserveSettingsPage: true });
        },
        onStatus: function (status) {
          var message = status.state === "pending" ? "Waiting to save automatically…"
            : status.state === "saving" ? "Saving automatically…"
            : status.state === "saved" ? "Saved automatically." : status.message;
          setStatuses(function (current) { var next = Object.assign({}, current); next[plugin.id] = { error: status.state === "error" || status.state === "invalid", message: message }; return next; });
        },
      });
      return saveControllersRef.current[plugin.id];
    }

    function updateField(pluginId, settingName, value) {
      var plugin = snapshot && snapshot.plugins.find(function (item) { return item.id === pluginId; });
      var nextPluginDraft = Object.assign({}, drafts[pluginId] || {});
      nextPluginDraft[settingName] = value;
      setDrafts(function (current) { var next = Object.assign({}, current); next[pluginId] = nextPluginDraft; return next; });
      if (plugin) saveController(plugin).schedule(nextPluginDraft);
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
    usePageTitle(activePlugin && activePlugin.id !== "dirtyPlugins"
      ? activePlugin.name : "Dirty Plugins", "Settings");

    var ready = !loading && !error && snapshot;
    var retryButton = html`<button type="button" className="btn btn-secondary dirty-ui-button" onClick=${reload}>Retry</button>`;
    return html`
      <main className=${"dirty-plugins-page" + (hubApi.captureEnabled(window.location.search) ? " dirty-plugins-docs-capture" : "")}>
        <header className="dirty-plugins-page-header">
          <h1>Dirty Plugins</h1>
          <p>Settings are shown only for Dirty plugins installed in this Stash instance.</p>
          <div className="dirty-plugins-unsaved" role="status">${hasUnsavedChanges ? "Unsaved changes" : ""}</div>
        </header>
        ${loading && html`<${StateView} className="dirty-plugins-state" title="Loading settings…" />`}
        ${!loading && error && html`<${StateView}
          className="dirty-plugins-state"
          detail=${error}
          title="Could not load Dirty Plugins settings"
          actions=${retryButton}
        />`}
        ${ready && snapshot.plugins.length === 0 && html`<${StateView}
          className="dirty-plugins-state"
          title="No configurable Dirty plugins are installed."
        />`}
        ${ready && snapshot.plugins.length > 0 && html`<${React.Fragment}>
          <div aria-label="Dirty plugin settings" className="nav nav-tabs dirty-plugins-tabs" role="tablist">
            ${snapshot.plugins.map(function (plugin, pluginIndex) {
              var selected = plugin.id === activePluginId;
              return html`<button
                aria-controls=${"dirty-plugins-panel-" + plugin.id}
                aria-selected=${selected}
                className=${"nav-link dirty-plugins-tab" + (selected ? " active" : "")}
                id=${"dirty-plugins-tab-" + plugin.id}
                key=${plugin.id}
                onClick=${function () { selectPlugin(plugin.id); }}
                onKeyDown=${function (event) { onTabKeyDown(event, pluginIndex); }}
                role="tab"
                tabIndex=${selected ? 0 : -1}
                type="button"
              >${plugin.id === "dirtyPlugins" ? "General" : plugin.name}</button>`;
            })}
          </div>
          ${activePlugin && html`<div
            aria-labelledby=${"dirty-plugins-tab-" + activePlugin.id}
            className="dirty-plugins-tab-panel"
            id=${"dirty-plugins-panel-" + activePlugin.id}
            role="tabpanel"
          >
            ${activeSettingsPanel
              ? html`<${activeSettingsPanel}
                  configuration=${asObject(snapshot.configuration[activePlugin.id])}
                  onDirtyChange=${reportCustomDirty}
                  onConfigurationChanged=${reload}
                  plugin=${activePlugin}
                />`
              : html`<${PluginCard}
                  actionRevision=${actionRevision}
                  draft=${drafts[activePlugin.id]}
                  plugin=${activePlugin}
                  status=${statuses[activePlugin.id]}
                  onFieldChange=${updateField}
                />`}
          </div>`}
        <//>`}
      </main>`;
  }

  window.__dirtyCurrentPluginId = "dirtyPlugins";
  PluginApi.patch.instead("PluginSettings", function () {
    var args = Array.prototype.slice.call(arguments);
    var next = args.pop();
    var props = args[0];
    var pluginId = props && (props.pluginID || props.pluginId || props.id);
    if (!MAIN_PAGE_PLUGIN_ID_SET.has(pluginId)) return next.apply(null, args);
    return html`<${SettingsLink} pluginId=${pluginId} />`;
  });
  PluginApi.register.route(ROUTE_PATH, DirtyPluginsRoute);
  window[INSTANCE_KEY] = { route: ROUTE_PATH };
  debugLog("dirtyPlugins", "hub script finished registering", {
    route: ROUTE_PATH,
    elapsedMs: debugElapsed(),
  });
  window.__dirtyCurrentPluginId = null;
})();
