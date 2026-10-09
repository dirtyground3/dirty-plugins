import type { Host, Hub } from "./types";
export const PLUGIN_ID = "dirtyCaptions";
export function readRuntime(): { api: Host; hub: Hub } | null {
  const host = window as unknown as { PluginApi?: Host; DirtyPlugins?: Hub };
  const api = host.PluginApi, hub = host.DirtyPlugins;
  if (!api?.React || !api.patch || !hub?.react || !hub.values) return null;
  if ([api.React.createElement, api.React.cloneElement, api.React.isValidElement, api.React.useRef,
    api.React.useState, api.React.useEffect, api.patch.after, hub.values.coerceBoolean,
    hub.runPluginOperation, hub.getPluginSettings, hub.createJobHook, hub.registerSettingsAddon,
    hub.captureEnabled, hub.react.Button, hub.react.SettingsSection].some(value => typeof value !== "function")) return null;
  return { api, hub };
}
