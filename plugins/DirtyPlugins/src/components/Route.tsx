import { CONFIGURATION_CHANGED_EVENT, FIELD_ACTIONS_CHANGED_EVENT, SETTINGS_PANELS_CHANGED_EVENT, UNSAVED_SETTINGS_MESSAGE } from "../constants";
import { React, hubApi, settingsPanels, transport } from "../runtime";
import type { SaveController } from "../save";
import { createDrafts, loadSettingsSnapshot, requestedPluginId, serializeFieldValue, standardDraftsAreDirty } from "../settings";
import { usePageTitle } from "../title";
import type { Drafts, FieldValue, Plugin, Snapshot, Statuses } from "../types";
import { asObject } from "../values";
import { StateView } from "./Controls";
import { PluginCard } from "./PluginCard";
export function DirtyPluginsRoute() {
  var snapshotState = React.useState<Snapshot | null>(null);
  var snapshot = snapshotState[0];
  var setSnapshot = snapshotState[1];
  var draftsState = React.useState<Drafts>({});
  var drafts = draftsState[0];
  var setDrafts = draftsState[1];
  var savedDraftsState = React.useState<Drafts>({});
  var savedDrafts = savedDraftsState[0];
  var setSavedDrafts = savedDraftsState[1];
  var customDirtyState = React.useState<Record<string, boolean>>({});
  var customDirty = customDirtyState[0];
  var setCustomDirty = customDirtyState[1];
  var loadingState = React.useState(true);
  var loading = loadingState[0];
  var setLoading = loadingState[1];
  var errorState = React.useState<string | null>(null);
  var error = errorState[0];
  var setError = errorState[1];
  var statusesState = React.useState<Statuses>({});
  var statuses = statusesState[0];
  var setStatuses = statusesState[1];
  var actionRevisionState = React.useState(0);
  var actionRevision = actionRevisionState[0];
  var setActionRevision = actionRevisionState[1];
  var settingsPanelRevisionState = React.useState(0);
  var setSettingsPanelRevision = settingsPanelRevisionState[1];
  var saveControllersRef = React.useRef<Record<string, SaveController<Record<string, FieldValue>, { input: Record<string, unknown>; revision: number; }>>>({});
  var snapshotRef = React.useRef(snapshot);
  snapshotRef.current = snapshot;
  var activePluginState = React.useState(requestedPluginId);
  var activePluginId = activePluginState[0];
  var setActivePluginId = activePluginState[1];
  var standardDirty = React.useMemo(function() {
    return standardDraftsAreDirty(snapshot, drafts, savedDrafts);
  }, [snapshot, drafts, savedDrafts]);
  var hasUnsavedChanges = standardDirty || Object.keys(customDirty).some(function(pluginId) {
    return Boolean(customDirty[pluginId]);
  });
  var reportCustomDirty = React.useCallback(function(pluginId: string, dirty: boolean) {
    setCustomDirty(function(current) {
      if (Boolean(current[pluginId]) === Boolean(dirty)) return current;
      var next = Object.assign({}, current);
      if (dirty) next[pluginId] = true;
      else delete next[pluginId];
      return next;
    });
  }, []);

  var reload = React.useCallback(function() {
    setLoading(true);
    setError(null);
    return loadSettingsSnapshot()
      .then(function(nextSnapshot) {
        var nextDrafts = createDrafts(nextSnapshot);
        setSnapshot(nextSnapshot);
        setDrafts(nextDrafts);
        setSavedDrafts(nextDrafts);
        setCustomDirty({});
        setActivePluginId(function(currentPluginId) {
          var currentIsInstalled = nextSnapshot.plugins.some(function(plugin) {
            return plugin.id === currentPluginId;
          });
          return currentIsInstalled
            ? currentPluginId
            : (nextSnapshot.plugins[0] && nextSnapshot.plugins[0].id);
        });
      })
      .catch(function(loadError) {
        setError(loadError.message || String(loadError));
      })
      .then(function() { setLoading(false); });
  }, []);

  React.useEffect(function() {
    reload();
  }, [reload]);

  React.useEffect(function() {
    function onConfigurationChanged(event: Event) {
      if ((event as CustomEvent<{ preserveSettingsPage?: boolean; }>).detail?.preserveSettingsPage) return;
      reload();
    }
    function onFieldActionsChanged() {
      setActionRevision(function(revision) { return revision + 1; });
    }
    function onSettingsPanelsChanged() {
      setSettingsPanelRevision(function(revision) { return revision + 1; });
    }
    window.addEventListener(CONFIGURATION_CHANGED_EVENT, onConfigurationChanged);
    window.addEventListener(FIELD_ACTIONS_CHANGED_EVENT, onFieldActionsChanged);
    window.addEventListener(SETTINGS_PANELS_CHANGED_EVENT, onSettingsPanelsChanged);
    return function() {
      window.removeEventListener(CONFIGURATION_CHANGED_EVENT, onConfigurationChanged);
      window.removeEventListener(FIELD_ACTIONS_CHANGED_EVENT, onFieldActionsChanged);
      window.removeEventListener(SETTINGS_PANELS_CHANGED_EVENT, onSettingsPanelsChanged);
    };
  }, [reload]);

  React.useEffect(function() {
    if (!hasUnsavedChanges) return undefined;

    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    function confirmLinkNavigation(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey) return;
      var anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
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
    return function() {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", confirmLinkNavigation, true);
    };
  }, [hasUnsavedChanges]);

  React.useEffect(function() {
    return function() {
      Object.keys(saveControllersRef.current).forEach(function(id) { saveControllersRef.current[id].dispose(); });
    };
  }, []);

  function pluginInput(plugin: Plugin, draft: Record<string, FieldValue>, snapshotValue: Snapshot) {
    var input = Object.assign({}, asObject(snapshotValue.configuration[plugin.id]));
    (plugin.settings || []).forEach(function(setting) { input[setting.name] = serializeFieldValue(setting, draft[setting.name]); });
    return input;
  }

  function saveController(plugin: Plugin) {
    if (!saveControllersRef.current[plugin.id]) saveControllersRef.current[plugin.id] = hubApi.createSaveController({
      delay: 350,
      validate: function(draft) {
        try { pluginInput(plugin, draft, snapshotRef.current!); return ""; }
        catch (error) { return (error as Error).message; }
      },
      save: function(draft) {
        var current = snapshotRef.current!;
        var input = pluginInput(plugin, draft, current);
        var expected = current.pluginRevisions && current.pluginRevisions[plugin.id];
        return transport.configurePlugin(plugin.id, input, expected).then(function(result) { return { input: input, revision: result.revision }; });
      },
      onSaved: function(draft, result, current) {
        var nextSnapshot = Object.assign({}, snapshotRef.current!, {
          configuration: Object.assign({}, snapshotRef.current!.configuration),
          pluginRevisions: Object.assign({}, snapshotRef.current!.pluginRevisions),
        });
        nextSnapshot.configuration[plugin.id] = result.input;
        nextSnapshot.pluginRevisions[plugin.id] = result.revision;
        snapshotRef.current = nextSnapshot;
        setSnapshot(nextSnapshot);
        setSavedDrafts(function(saved) { var next = Object.assign({}, saved); next[plugin.id] = Object.assign({}, draft); return next; });
        if (current) hubApi.notifyConfigurationChanged(plugin.id, { preserveSettingsPage: true });
      },
      onStatus: function(status) {
        var message = status.state === "pending" ? "Waiting to save automatically…"
          : status.state === "saving" ? "Saving automatically…"
            : status.state === "saved" ? "Saved automatically." : status.message;
        setStatuses(function(current) { var next = Object.assign({}, current); next[plugin.id] = { error: status.state === "error" || status.state === "invalid", message: message }; return next; });
      },
    });
    return saveControllersRef.current[plugin.id];
  }

  function updateField(pluginId: string, settingName: string, value: FieldValue) {
    var plugin = snapshot && snapshot.plugins.find(function(item) { return item.id === pluginId; });
    var nextPluginDraft = Object.assign({}, drafts[pluginId] || {});
    nextPluginDraft[settingName] = value;
    setDrafts(function(current) { var next = Object.assign({}, current); next[pluginId] = nextPluginDraft; return next; });
    if (plugin) saveController(plugin).schedule(nextPluginDraft);
  }

  function selectPlugin(pluginId: string) {
    if (pluginId !== activePluginId && activePluginId && customDirty[activePluginId]) {
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

  function onTabKeyDown(event: import("react").KeyboardEvent<HTMLButtonElement>, pluginIndex: number) {
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

  var activePlugin = snapshot && snapshot.plugins.find(function(plugin) {
    return plugin.id === activePluginId;
  });
  var activeSettingsPanel = activePlugin && settingsPanels[activePlugin.id];
  usePageTitle(activePlugin && activePlugin.id !== "dirtyPlugins"
    ? activePlugin.name : "Dirty Plugins", "Settings");

  var ready = !loading && !error && snapshot;
  var retryButton = (<button
    type="button"
    className="btn btn-secondary dirty-ui-button"
    onClick={reload}>
    {"Retry"}
  </button>);
  return (<main
    className={"dirty-plugins-page" + (hubApi.captureEnabled(window.location.search) ? " dirty-plugins-docs-capture" : "")}>
    <header
      className="dirty-plugins-page-header">
      <h1>
        {"Dirty Plugins"}
      </h1>
      <p>
        {"Settings are shown only for Dirty plugins installed in this Stash instance."}
      </p>
      <div
        className="dirty-plugins-unsaved"
        role="status">
        {hasUnsavedChanges ? "Unsaved changes" : ""}
      </div>
    </header>
    {loading && (<StateView
      className="dirty-plugins-state"
      title="Loading settings…">

    </StateView>)}
    {!loading && error && (<StateView
      className="dirty-plugins-state"
      detail={error}
      title="Could not load Dirty Plugins settings"
      actions={retryButton}>

    </StateView>)}
    {ready && snapshot!.plugins.length === 0 && (<StateView
      className="dirty-plugins-state"
      title="No configurable Dirty plugins are installed.">

    </StateView>)}
    {ready && snapshot!.plugins.length > 0 && (<React.Fragment>
      <div
        aria-label="Dirty plugin settings"
        className="nav nav-tabs dirty-plugins-tabs"
        role="tablist">
        {snapshot!.plugins.map(function(plugin, pluginIndex) {
          var selected = plugin.id === activePluginId;
          return (<button
            aria-controls={"dirty-plugins-panel-" + plugin.id}
            aria-selected={selected}
            className={"nav-link dirty-plugins-tab" + (selected ? " active" : "")}
            id={"dirty-plugins-tab-" + plugin.id}
            key={plugin.id}
            onClick={function() { selectPlugin(plugin.id); }}
            onKeyDown={function(event) { onTabKeyDown(event, pluginIndex); }}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button">
            {plugin.id === "dirtyPlugins" ? "General" : plugin.name}
          </button>);
        })}
      </div>
      {activePlugin && (<div
        aria-labelledby={"dirty-plugins-tab-" + activePlugin.id}
        className="dirty-plugins-tab-panel"
        id={"dirty-plugins-panel-" + activePlugin.id}
        role="tabpanel">
        {activeSettingsPanel
          ? (React.createElement(activeSettingsPanel, { "configuration": asObject(snapshot!.configuration[activePlugin.id]), "onDirtyChange": reportCustomDirty, "onConfigurationChanged": reload, "plugin": activePlugin }))
          : (<PluginCard
            actionRevision={actionRevision}
            draft={drafts[activePlugin.id]}
            plugin={activePlugin}
            status={statuses[activePlugin.id]}
            onFieldChange={updateField}>

          </PluginCard>)}
      </div>)}
    </React.Fragment>)}
  </main>);
}
