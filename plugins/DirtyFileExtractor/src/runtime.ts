import type * as R from "react";
import type { Host, Hub } from "./types";
export const PLUGIN_ID = "extractScenes";
export interface Runtime { api: Host; hubApi: Hub; }
/** Validate externally owned APIs before claiming any registration or effects. */
export function readRuntime(): Runtime | null {
  const host = window as unknown as { PluginApi?: Host; DirtyPlugins?: Hub };
  const api = host.PluginApi, hubApi = host.DirtyPlugins;
  if (!api?.React || !hubApi?.ui) return null;
  if ([api.React.createElement, api.React.useState, api.React.useRef, api.React.useEffect,
    api.patch?.after, hubApi.graphql, hubApi.getPluginSettings, hubApi.configurePlugin,
    hubApi.ui.notify, hubApi.ui.manageDialog].some(value => typeof value !== "function")) return null;
  return { api, hubApi };
}
export let React: typeof R;
export let PluginApi: Host;
export function bindRuntime(runtime: Runtime): void { React = runtime.api.React; PluginApi = runtime.api; }
