import type { ReactNode } from "react";
import { captureEnabled, captureUrl } from "./capture";
import * as controls from "./components/Controls";
import { Dialog } from "./components/Dialog";
import * as navigation from "./components/Navigation";
import { DirtyPluginsRoute } from "./components/Route";
import { SceneFilterEditor, sceneListPatch } from "./components/SceneFilter";
import * as settings from "./components/Settings";
import { SettingsLink, SettingsNavLink } from "./components/SettingsLink";
import { MANAGED_PLUGIN_ID_SET, ROUTE_PATH } from "./constants";
import { debugElapsed, debugLog, installDebug, setDebugPlugin } from "./debug";
import { manageDialog, notify } from "./dialogs";
import { createJobHook } from "./jobs";
import { ensureComponents, loadComponent } from "./native";
import { bindHost, hubApi, PluginApi, React, readHost } from "./runtime";
import { createSaveController } from "./save";
import {
  notifyConfigurationChanged,
  registerFieldAction,
  registerSettingsAddon,
  registerSettingsPanel,
} from "./settings";
import { useSettingsDraft } from "./settingsDraft";
import { loadVisualTheme, theme } from "./theme";
import { usePageTitle } from "./title";
import { configurePlugin, getPluginSettings, loggedGraphql, runPluginOperation } from "./transport";
import { registerPlugin } from "./register";

// window.DirtyPlugins is published first and doubles as the one-time guard: Stash cannot
// remove patches or routes, so a reloaded hub bundle must not register them again.
const api = readHost();
if (api && !window.DirtyPlugins) {
  window.DirtyPlugins = hubApi;
  setDebugPlugin("dirtyPlugins");
  let releaseDebug: (() => void) | undefined;
  try {
    bindHost(api);
    releaseDebug = installDebug(api);
    Object.assign(hubApi, {
      registerPlugin,
      debugLog,
      registerFieldAction,
      notifyConfigurationChanged,
      registerSettingsPanel,
      registerSettingsAddon,
      graphql: loggedGraphql,
      runPluginOperation,
      getPluginSettings,
      configurePlugin,
      createSaveController,
      createJobHook,
      ui: { notify, manageDialog },
      theme,
      react: { ...controls, ...settings, ...navigation, Dialog, usePageTitle, useSettingsDraft, SceneFilterEditor },
      native: { loadComponent, ensureComponents },
      captureEnabled,
      captureUrl,
    });
    theme.ready = loadVisualTheme(() => getPluginSettings("dirtyPlugins"));
    PluginApi.patch.instead("SceneList", sceneListPatch);
    PluginApi.patch.instead("PluginSettings", (...args) => {
      const next = args.pop(),
        props = args[0];
      const pluginId = props && (props.pluginID || props.pluginId || props.id);
      if (!MANAGED_PLUGIN_ID_SET.has(pluginId)) return next.apply(null, args);
      return <SettingsLink pluginId={pluginId} />;
    });
    // After-patches run once every plugin's before-patch has added its button, so this one is last.
    PluginApi.patch.after("MainNavBar.UtilityItems", (...args) => (
      <React.Fragment>
        {args.pop() as ReactNode}
        <SettingsNavLink />
      </React.Fragment>
    ));
    PluginApi.register.route(ROUTE_PATH, DirtyPluginsRoute);
    debugLog("dirtyPlugins", "hub script finished registering", { route: ROUTE_PATH, elapsedMs: debugElapsed() });
  } catch (error) {
    releaseDebug?.();
    console.error("[dirtyPlugins] registration failed", error);
  } finally {
    setDebugPlugin(null);
  }
}
