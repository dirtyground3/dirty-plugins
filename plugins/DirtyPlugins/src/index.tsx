import { captureEnabled, captureUrl } from "./capture";
import * as controls from "./components/Controls";
import { Dialog } from "./components/Dialog";
import * as navigation from "./components/Navigation";
import { DirtyPluginsRoute } from "./components/Route";
import { SceneFilterEditor, sceneListPatch } from "./components/SceneFilter";
import * as settings from "./components/Settings";
import { SettingsLink } from "./components/SettingsLink";
import { MANAGED_PLUGIN_ID_SET, ROUTE_PATH } from "./constants";
import { debugElapsed, debugLog, dumpDebugLogs, installDebug } from "./debug";
import { manageDialog, notify } from "./dialogs";
import { createJobHook } from "./jobs";
import { metadata } from "./metadata";
import { ensureComponents, loadComponent } from "./native";
import { bindHost, hubApi, PluginApi, React, readHost } from "./runtime";
import { createSaveController } from "./save";
import { notifyConfigurationChanged, registerFieldAction, registerSettingsAddon, registerSettingsPanel, unregisterFieldAction, unregisterSettingsAddon, unregisterSettingsPanel } from "./settings";
import { useSettingsDraft } from "./settingsDraft";
import { loadVisualTheme, theme } from "./theme";
import { usePageTitle } from "./title";
import { configurePlugin, getPluginSettings, loggedGraphql, runPluginOperation } from "./transport";
import type { HubApi } from "./types";
import { asObject, clampInteger, coerceBoolean, parseMaybeJson } from "./values";

const INSTANCE_KEY = "__dirtyPluginsSettingsHub";
const owner = window as unknown as { [INSTANCE_KEY]?: { route: string; status: "registering" | "registered" | "failed"; }; __dirtyCurrentPluginId?: string | null; DirtyPlugins?: HubApi; };
const api = readHost();
if (api && !owner[INSTANCE_KEY]) {
  // Stash cannot remove these patches/routes. Keep the guard even if registration
  // fails partway through, so reloading an asset cannot duplicate owned effects.
  const instance: NonNullable<typeof owner[typeof INSTANCE_KEY]> = owner[INSTANCE_KEY] = { route: ROUTE_PATH, status: "registering" };
  let releaseDebug: (() => void) | undefined;
  try {
    bindHost(api);
    hubApi.settingsMetadata = metadata;
    releaseDebug = installDebug(api);
    hubApi.debugLog = debugLog;
    hubApi.debugElapsed = debugElapsed;
    hubApi.dumpDebugLogs = dumpDebugLogs;
    hubApi.registerFieldAction = registerFieldAction;
    hubApi.unregisterFieldAction = unregisterFieldAction;
    hubApi.notifyConfigurationChanged = notifyConfigurationChanged;
    hubApi.registerSettingsPanel = registerSettingsPanel;
    hubApi.unregisterSettingsPanel = unregisterSettingsPanel;
    hubApi.registerSettingsAddon = registerSettingsAddon;
    hubApi.unregisterSettingsAddon = unregisterSettingsAddon;
    owner.DirtyPlugins = hubApi;
    hubApi.graphql = loggedGraphql;
    hubApi.runPluginOperation = runPluginOperation;
    hubApi.getPluginSettings = getPluginSettings;
    hubApi.configurePlugin = configurePlugin;
    hubApi.createSaveController = createSaveController;
    hubApi.createJobHook = createJobHook;
    hubApi.values = { asObject, parseMaybeJson, clampInteger, coerceBoolean };
    hubApi.ui = { notify, manageDialog };
    hubApi.theme = theme;
    theme.ready = loadVisualTheme(() => getPluginSettings("dirtyPlugins"));
    hubApi.react = { ...controls, ...settings, ...navigation, Dialog, usePageTitle, useSettingsDraft, SceneFilterEditor };
    hubApi.native = { loadComponent, ensureComponents };
    hubApi.captureEnabled = captureEnabled;
    hubApi.captureUrl = captureUrl;
    owner.__dirtyCurrentPluginId = "dirtyPlugins";
    PluginApi.patch.instead("SceneList", sceneListPatch);
    PluginApi.patch.instead("PluginSettings", (...args) => {
      const next = args.pop(), props = args[0];
      const pluginId = props && (props.pluginID || props.pluginId || props.id);
      if (!MANAGED_PLUGIN_ID_SET.has(pluginId)) return next.apply(null, args);
      return <SettingsLink pluginId={pluginId} />;
    });
    PluginApi.register.route(ROUTE_PATH, DirtyPluginsRoute);
    instance.status = "registered";
    debugLog("dirtyPlugins", "hub script finished registering", { route: ROUTE_PATH, elapsedMs: debugElapsed() });
  } catch (error) {
    releaseDebug?.();
    instance.status = "failed";
    console.error("DirtyPlugins registration failed", error);
  } finally {
    owner.__dirtyCurrentPluginId = null;
  }
}
