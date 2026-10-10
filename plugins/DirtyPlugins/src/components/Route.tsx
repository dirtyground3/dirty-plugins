import type * as R from "react";
import { captureEnabled } from "../capture";
import {
  CONFIGURATION_CHANGED_EVENT,
  FIELD_ACTIONS_CHANGED_EVENT,
  SETTINGS_PANELS_CHANGED_EVENT,
  UNSAVED_SETTINGS_MESSAGE,
} from "../constants";
import { React } from "../runtime";
import { createSaveController, type SaveController } from "../save";
import {
  createDrafts,
  loadSettingsSnapshot,
  notifyConfigurationChanged,
  requestedPluginId,
  serializeFieldValue,
  settingsPanels,
  standardDraftsAreDirty,
} from "../settings";
import { usePageTitle } from "../title";
import { configurePlugin } from "../transport";
import type { Drafts, FieldValue, Plugin, Snapshot, Statuses } from "../types";
import { asObject } from "../shared/values";
import { StateView } from "./Controls";
import { PluginCard } from "./PluginCard";

type PluginSaveController = SaveController<
  Record<string, FieldValue>,
  { input: Record<string, unknown>; revision: number }
>;
const SAVE_MESSAGES: Record<string, string> = {
  pending: "Waiting to save automatically…",
  saving: "Saving automatically…",
  saved: "Saved automatically.",
};

function pluginInput(plugin: Plugin, draft: Record<string, FieldValue>, snapshot: Snapshot) {
  const input = Object.assign({}, asObject(snapshot.configuration[plugin.id]));
  (plugin.settings || []).forEach(setting => {
    input[setting.name] = serializeFieldValue(setting, draft[setting.name]);
  });
  return input;
}

function replaceUrlPlugin(pluginId: string) {
  try {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("plugin", pluginId);
    window.history.replaceState(window.history.state, "", nextUrl.pathname + nextUrl.search + nextUrl.hash);
  } catch (_error) {
    // The selected tab still works if the browser URL cannot be updated.
  }
}

/** Warn before a reload or a link click would discard unsaved settings. */
function useLeaveProtection(hasUnsavedChanges: boolean) {
  React.useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function confirmLinkNavigation(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      let destination;
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
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", confirmLinkNavigation, true);
    };
  }, [hasUnsavedChanges]);
}

export function DirtyPluginsRoute() {
  const [snapshot, setSnapshot] = React.useState<Snapshot | null>(null);
  const [drafts, setDrafts] = React.useState<Drafts>({});
  const [savedDrafts, setSavedDrafts] = React.useState<Drafts>({});
  const [customDirty, setCustomDirty] = React.useState<Record<string, boolean>>({});
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [statuses, setStatuses] = React.useState<Statuses>({});
  const [actionRevision, setActionRevision] = React.useState(0);
  const [, setSettingsPanelRevision] = React.useState(0);
  const saveControllersRef = React.useRef<Record<string, PluginSaveController>>({});
  const snapshotRef = React.useRef(snapshot);
  snapshotRef.current = snapshot;
  const [activePluginId, setActivePluginId] = React.useState(requestedPluginId);
  const standardDirty = React.useMemo(
    () => standardDraftsAreDirty(snapshot, drafts, savedDrafts),
    [snapshot, drafts, savedDrafts],
  );
  const hasUnsavedChanges = standardDirty || Object.keys(customDirty).some(pluginId => Boolean(customDirty[pluginId]));
  const reportCustomDirty = React.useCallback((pluginId: string, dirty: boolean) => {
    setCustomDirty(current => {
      if (Boolean(current[pluginId]) === Boolean(dirty)) return current;
      const next = Object.assign({}, current);
      if (dirty) next[pluginId] = true;
      else delete next[pluginId];
      return next;
    });
  }, []);

  const reload = React.useCallback(() => {
    setLoading(true);
    setError(null);
    return loadSettingsSnapshot()
      .then(nextSnapshot => {
        const nextDrafts = createDrafts(nextSnapshot);
        setSnapshot(nextSnapshot);
        setDrafts(nextDrafts);
        setSavedDrafts(nextDrafts);
        setCustomDirty({});
        setActivePluginId(currentPluginId =>
          nextSnapshot.plugins.some(plugin => plugin.id === currentPluginId)
            ? currentPluginId
            : nextSnapshot.plugins[0] && nextSnapshot.plugins[0].id,
        );
      })
      .catch(loadError => {
        setError(loadError.message || String(loadError));
      })
      .then(() => setLoading(false));
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  React.useEffect(() => {
    function onConfigurationChanged(event: Event) {
      if ((event as CustomEvent<{ preserveSettingsPage?: boolean }>).detail?.preserveSettingsPage) return;
      reload();
    }
    const onFieldActionsChanged = () => setActionRevision(revision => revision + 1);
    const onSettingsPanelsChanged = () => setSettingsPanelRevision(revision => revision + 1);
    window.addEventListener(CONFIGURATION_CHANGED_EVENT, onConfigurationChanged);
    window.addEventListener(FIELD_ACTIONS_CHANGED_EVENT, onFieldActionsChanged);
    window.addEventListener(SETTINGS_PANELS_CHANGED_EVENT, onSettingsPanelsChanged);
    return () => {
      window.removeEventListener(CONFIGURATION_CHANGED_EVENT, onConfigurationChanged);
      window.removeEventListener(FIELD_ACTIONS_CHANGED_EVENT, onFieldActionsChanged);
      window.removeEventListener(SETTINGS_PANELS_CHANGED_EVENT, onSettingsPanelsChanged);
    };
  }, [reload]);

  useLeaveProtection(hasUnsavedChanges);

  React.useEffect(() => {
    return () => {
      Object.keys(saveControllersRef.current).forEach(id => saveControllersRef.current[id].dispose());
    };
  }, []);

  function saveController(plugin: Plugin) {
    if (!saveControllersRef.current[plugin.id])
      saveControllersRef.current[plugin.id] = createSaveController({
        delay: 350,
        validate: draft => {
          try {
            pluginInput(plugin, draft, snapshotRef.current!);
            return "";
          } catch (error) {
            return (error as Error).message;
          }
        },
        save: draft => {
          const current = snapshotRef.current!;
          const input = pluginInput(plugin, draft, current);
          const expected = current.pluginRevisions && current.pluginRevisions[plugin.id];
          return configurePlugin(plugin.id, input, expected).then(result => ({ input, revision: result.revision }));
        },
        onSaved: (draft, result, current) => {
          const nextSnapshot = {
            ...snapshotRef.current!,
            configuration: { ...snapshotRef.current!.configuration, [plugin.id]: result.input },
            pluginRevisions: { ...snapshotRef.current!.pluginRevisions, [plugin.id]: result.revision },
          };
          snapshotRef.current = nextSnapshot;
          setSnapshot(nextSnapshot);
          setSavedDrafts(saved => ({ ...saved, [plugin.id]: { ...draft } }));
          if (current) notifyConfigurationChanged(plugin.id, { preserveSettingsPage: true });
        },
        onStatus: status => {
          const message = SAVE_MESSAGES[status.state] || status.message;
          setStatuses(current => ({
            ...current,
            [plugin.id]: { error: status.state === "error" || status.state === "invalid", message },
          }));
        },
      });
    return saveControllersRef.current[plugin.id];
  }

  function updateField(pluginId: string, settingName: string, value: FieldValue) {
    const plugin = snapshot && snapshot.plugins.find(item => item.id === pluginId);
    const nextPluginDraft = { ...drafts[pluginId], [settingName]: value };
    setDrafts(current => ({ ...current, [pluginId]: nextPluginDraft }));
    if (plugin) saveController(plugin).schedule(nextPluginDraft);
  }

  function selectPlugin(pluginId: string) {
    if (pluginId !== activePluginId && activePluginId && customDirty[activePluginId]) {
      if (!window.confirm(UNSAVED_SETTINGS_MESSAGE)) return false;
      reportCustomDirty(activePluginId, false);
    }
    setActivePluginId(pluginId);
    replaceUrlPlugin(pluginId);
    return true;
  }

  function onTabKeyDown(event: R.KeyboardEvent<HTMLButtonElement>, pluginIndex: number) {
    if (!snapshot || !snapshot.plugins.length) return;
    const count = snapshot.plugins.length;
    const nextIndex =
      event.key === "ArrowRight"
        ? (pluginIndex + 1) % count
        : event.key === "ArrowLeft"
          ? (pluginIndex - 1 + count) % count
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? count - 1
              : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextPlugin = snapshot.plugins[nextIndex];
    if (!selectPlugin(nextPlugin.id)) return;
    const nextTab = document.getElementById("dirty-plugins-tab-" + nextPlugin.id);
    if (nextTab) nextTab.focus();
  }

  const activePlugin = snapshot && snapshot.plugins.find(plugin => plugin.id === activePluginId);
  const activeSettingsPanel = activePlugin && settingsPanels[activePlugin.id];
  usePageTitle(activePlugin && activePlugin.id !== "dirtyPlugins" ? activePlugin.name : "Dirty Plugins", "Settings");

  const ready = !loading && !error && snapshot;
  const retryButton = (
    <button type="button" className="btn btn-secondary dirty-ui-button" onClick={reload}>
      Retry
    </button>
  );
  return (
    <main
      className={"dirty-plugins-page" + (captureEnabled(window.location.search) ? " dirty-plugins-docs-capture" : "")}
    >
      <header className="dirty-plugins-page-header">
        <h1>Dirty Plugins</h1>
        <p>Settings are shown only for Dirty plugins installed in this Stash instance.</p>
        <div className="dirty-plugins-unsaved" role="status">
          {hasUnsavedChanges ? "Unsaved changes" : ""}
        </div>
      </header>
      {loading && <StateView className="dirty-plugins-state" title="Loading settings…" />}
      {!loading && error && (
        <StateView
          className="dirty-plugins-state"
          detail={error}
          title="Could not load Dirty Plugins settings"
          actions={retryButton}
        />
      )}
      {ready && snapshot!.plugins.length === 0 && (
        <StateView className="dirty-plugins-state" title="No configurable Dirty plugins are installed." />
      )}
      {ready && snapshot!.plugins.length > 0 && (
        <React.Fragment>
          <div aria-label="Dirty plugin settings" className="nav nav-tabs dirty-plugins-tabs" role="tablist">
            {snapshot!.plugins.map((plugin, pluginIndex) => {
              const selected = plugin.id === activePluginId;
              return (
                <button
                  aria-controls={"dirty-plugins-panel-" + plugin.id}
                  aria-selected={selected}
                  className={"nav-link dirty-plugins-tab" + (selected ? " active" : "")}
                  id={"dirty-plugins-tab-" + plugin.id}
                  key={plugin.id}
                  onClick={() => selectPlugin(plugin.id)}
                  onKeyDown={event => onTabKeyDown(event, pluginIndex)}
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  {plugin.id === "dirtyPlugins" ? "General" : plugin.name}
                </button>
              );
            })}
          </div>
          {activePlugin && (
            <div
              aria-labelledby={"dirty-plugins-tab-" + activePlugin.id}
              className="dirty-plugins-tab-panel"
              id={"dirty-plugins-panel-" + activePlugin.id}
              role="tabpanel"
            >
              {activeSettingsPanel ? (
                React.createElement(activeSettingsPanel, {
                  configuration: asObject(snapshot!.configuration[activePlugin.id]),
                  onDirtyChange: reportCustomDirty,
                  onConfigurationChanged: reload,
                  plugin: activePlugin,
                })
              ) : (
                <PluginCard
                  actionRevision={actionRevision}
                  draft={drafts[activePlugin.id]}
                  plugin={activePlugin}
                  status={statuses[activePlugin.id]}
                  onFieldChange={updateField}
                />
              )}
            </div>
          )}
        </React.Fragment>
      )}
    </main>
  );
}
