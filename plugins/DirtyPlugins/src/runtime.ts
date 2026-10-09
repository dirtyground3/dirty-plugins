import type * as R from "react";
import type { createTransport } from "./transport";
import type { FieldActions, Host, HubApi, Panels } from "./types";

export let React: typeof R;
export let PluginApi: Host;
export let hubApi: HubApi;
export let fieldActions: FieldActions;
export let settingsPanels: Panels;
export let transport: ReturnType<typeof createTransport>;

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
  hubApi = {} as HubApi;
  fieldActions = Object.create(null);
  settingsPanels = Object.create(null);
}
export function bindServices(nextTransport: typeof transport) {
  transport = nextTransport;
}
