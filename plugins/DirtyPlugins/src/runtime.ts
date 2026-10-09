import type * as R from "react";
import htm from "../vendor/htm.umd.js";
import type { createTheme } from "./theme";
import type { createTransport } from "./transport";
import type { FieldActions, Host, HtmlRenderer, HubApi, Panels } from "./types";

export let React: typeof R;
export let PluginApi: Host;
export let hubApi: HubApi;
export let html: HtmlRenderer;
export let fieldActions: FieldActions;
export let settingsPanels: Panels;
export let transport: ReturnType<typeof createTransport>;
export let theme: ReturnType<typeof createTheme>;

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
  html = htm.bind(React.createElement);
  // The public object may already contain plugin registrations; keep its identity.
  hubApi = (window.DirtyPlugins || {}) as unknown as HubApi;
  fieldActions = hubApi.fieldActions || Object.create(null);
  settingsPanels = hubApi.settingsPanels || Object.create(null);
  hubApi.fieldActions = fieldActions;
  hubApi.settingsPanels = settingsPanels;
}
export function bindServices(nextTransport: typeof transport, nextTheme: typeof theme) {
  transport = nextTransport;
  theme = nextTheme;
}
