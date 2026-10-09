import type * as R from "react";
import type { Host, HubApi } from "./types";

export let React: typeof R;
export let PluginApi: Host;
/** The public hub; the entry fills it in and publishes it as window.DirtyPlugins. */
export const hubApi = {} as HubApi;

/** Validate the externally owned host before claiming any registration. */
export function readHost(): Host | null {
  const api = (window as unknown as { PluginApi?: Host; }).PluginApi;
  if (!api?.React || !api.libraries?.ReactRouterDOM?.Link) return null;
  if ([api.React.createElement, api.React.useState, api.React.useEffect, api.React.useRef,
  api.React.useMemo, api.React.useCallback, api.patch?.instead, api.register?.route]
    .some(value => typeof value !== "function")) return null;
  return api;
}
export function bindHost(api: Host) {
  PluginApi = api;
  React = api.React;
}
