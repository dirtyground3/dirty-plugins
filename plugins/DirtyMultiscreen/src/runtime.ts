import type { Host, Hub } from "./types";
export function readRuntime(): { api: Host; hub: Hub } | null {
  const globals = window as unknown as { PluginApi?: Host; DirtyPlugins?: Hub }, api = globals.PluginApi, hub = globals.DirtyPlugins;
  if (!api?.React || !hub?.react || !hub.values || !hub.settingsMetadata?.multiscreen || !api.libraries?.ReactRouterDOM) return null;
  if ([api.React.createElement, api.React.useEffect, api.React.useState, api.React.useRef, api.React.useCallback, api.React.useMemo,
  api.register?.route, api.patch?.before, api.libraries.ReactRouterDOM.useLocation,
  hub.graphql, hub.getPluginSettings, hub.values.clampInteger, hub.values.coerceBoolean, hub.react.usePageTitle].some(value => typeof value !== "function")) return null;
  if ([api.libraries.ReactRouterDOM.NavLink, hub.react.IconButton, hub.react.StateView, hub.react.NavAction].some(value => !value || (typeof value !== "function" && typeof value !== "object"))) return null;
  return { api, hub };
}
