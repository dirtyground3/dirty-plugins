import type * as R from "react";
import type { Host, Hub } from "./types";
export const PLUGIN_ID = "dirtyTidy";
export interface Runtime { api: Host; hub: Hub; }
export function readRuntime(): Runtime | null {
  // Only this boundary narrows externally owned Stash and hub objects.
  const host = window as unknown as { PluginApi?: Host; DirtyPlugins?: Hub };
  const api = host.PluginApi, hub = host.DirtyPlugins;
  if (!api?.React || !hub?.react || !hub.ui) return null;
  const ui = hub.react;
  if ([api.React.createElement, api.React.useState, api.React.useEffect, api.React.useRef, api.React.useMemo,
    hub.registerSettingsPanel, hub.createJobHook, hub.getPluginSettings, hub.configurePlugin, hub.graphql,
    hub.runPluginOperation, hub.captureEnabled, hub.ui.notify, ui.SettingsSection, ui.SettingsToggle,
    ui.Field, ui.Pagination, ui.Button, ui.ActionMenu, ui.Badge, ui.Dialog, ui.SaveStatus].some(value => typeof value !== "function")) return null;
  return { api, hub };
}
export let React: typeof R;
export let DirtyPlugins: Hub;
export let ui: Hub["react"];
export function bindRuntime(runtime: Runtime) { React = runtime.api.React; DirtyPlugins = runtime.hub; ui = runtime.hub.react; }
