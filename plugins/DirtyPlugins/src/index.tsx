import * as controls from "./components/Controls";
import { Dialog } from "./components/Dialog";
import * as navigation from "./components/Navigation";
import { DirtyPluginsRoute } from "./components/Route";
import * as settings from "./components/Settings";
import { SettingsLink } from "./components/SettingsLink";
import { SettingsField } from "./components/SettingsField";
import { CONFIGURATION_CHANGED_EVENT, DEFAULT_VISUAL_THEME, FIELD_ACTIONS_CHANGED_EVENT, MAIN_PAGE_PLUGIN_ID_SET, ROUTE_PATH, SETTINGS_PANELS_CHANGED_EVENT, VISUAL_THEME_KEYS } from "./constants";
import { createDebug } from "./debug";
import * as dialogs from "./dialogs";
import { completedJob, createJobHook, createReplayTracker } from "./jobs";
import { metadata } from "./metadata";
import { createNative } from "./native";
import { bindHost, bindServices, fieldActions, html, hubApi, PluginApi, React, readHost, settingsPanels } from "./runtime";
import { createSaveController } from "./save";
import { fieldDefinition } from "./settings";
import { useSettingsDraft } from "./settingsDraft";
import { createTheme } from "./theme";
import { usePageTitle } from "./title";
import { createTransport } from "./transport";
import type { HubApi } from "./types";
import * as values from "./values";

const INSTANCE_KEY = "__dirtyPluginsSettingsHub";
const owner = window as unknown as { [INSTANCE_KEY]?: { route: string; status: "registering" | "registered" | "failed"; }; __dirtyCurrentPluginId?: string | null; };
const api = readHost();
if (api && !owner[INSTANCE_KEY]) {
  // Stash cannot remove these patches/routes. Keep the guard even if registration
  // fails partway through, so reloading an asset cannot duplicate owned effects.
  const instance: NonNullable<typeof owner[typeof INSTANCE_KEY]> = owner[INSTANCE_KEY] = { route: ROUTE_PATH, status: "registering" };
  let releaseDebug: (() => void) | undefined;
  try {
    bindHost(api);
    hubApi.settingsMetadata = metadata;
    const debug = createDebug({ PluginApi, hubApi });
    releaseDebug = debug.dispose;
    const transport = createTransport({
      pluginRevisionCache: Object.create(null), hubApi, fieldActions, settingsPanels,
      FIELD_ACTIONS_CHANGED_EVENT, CONFIGURATION_CHANGED_EVENT, SETTINGS_PANELS_CHANGED_EVENT,
      ...debug, pluginResult: values.pluginResult, asObject: values.asObject,
      applyVisualTheme: value => theme.applyVisualTheme(value),
    });
    hubApi.graphql = transport.loggedGraphql;
    hubApi.runPluginOperation = transport.runPluginOperation;
    hubApi.getPluginSettings = transport.getPluginSettings;
    hubApi.configurePlugin = transport.configurePlugin;
    hubApi.createSaveController = createSaveController;
    hubApi.fieldDefinition = fieldDefinition;
    hubApi.completedJob = completedJob;
    hubApi.createReplayTracker = createReplayTracker;
    hubApi.createJobHook = createJobHook;
    hubApi.runSharedOperation = transport.runSharedOperation;
    hubApi.isInternalScan = (jobId, startTime) => transport.runSharedOperation({ mode: "isInternalScan", jobId: String(jobId), startTime }).then(result => Boolean(result.internal));
    hubApi.values = { asObject: values.asObject, parseMaybeJson: values.parseMaybeJson,
      clampInteger: values.clampInteger, coerceBoolean: values.coerceBoolean };
    hubApi.ui = dialogs;
    const theme = createTheme({ hubApi, DEFAULT_VISUAL_THEME, VISUAL_THEME_KEYS, getPluginSettings: transport.getPluginSettings, asObject: values.asObject });
    bindServices(transport, theme);
    hubApi.react = { html, ...controls, ...settings, ...navigation, Dialog, SettingsField, usePageTitle, useSettingsDraft } as HubApi["react"];
    const native = createNative({ hubApi, PluginApi, Dialog, StateView: controls.StateView, Button: controls.Button });
    owner.__dirtyCurrentPluginId = "dirtyPlugins";
    PluginApi.patch.instead("SceneList", native.sceneListPatch);
    PluginApi.patch.instead("PluginSettings", (...args) => {
      const next = args.pop(), props = args[0];
      const pluginId = props && (props.pluginID || props.pluginId || props.id);
      if (!MAIN_PAGE_PLUGIN_ID_SET.has(pluginId)) return next.apply(null, args);
      return <SettingsLink pluginId={pluginId} />;
    });
    PluginApi.register.route(ROUTE_PATH, DirtyPluginsRoute);
    instance.status = "registered";
    debug.debugLog("dirtyPlugins", "hub script finished registering", { route: ROUTE_PATH, elapsedMs: debug.debugElapsed() });
  } catch (error) {
    releaseDebug?.();
    instance.status = "failed";
    console.error("DirtyPlugins registration failed", error);
  } finally {
    owner.__dirtyCurrentPluginId = null;
  }
}
