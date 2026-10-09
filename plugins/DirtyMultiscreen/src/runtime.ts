import { createContexts } from "./contexts";
import { createCounts } from "./counts";
import { createSettingsDomain } from "./domain/settings";
import { createQueries } from "./queries";
import type { Host, Hub, Lifetime } from "./types";

export let PluginApi: Host;
export let DirtyPlugins: Hub;
export let React: Host["React"];
/** Effects owned by this instance; destroy() releases them even before unmount. */
export const life: Lifetime = { active: true, effects: new Set() };
export let settingsDomain: ReturnType<typeof createSettingsDomain>;
export let contexts: ReturnType<typeof createContexts>;
export let queries: ReturnType<typeof createQueries>;
export let counts: ReturnType<typeof createCounts>;

export function readRuntime(): { api: Host; hub: Hub } | null {
  const globals = window as unknown as { PluginApi?: Host; DirtyPlugins?: Hub }, api = globals.PluginApi, hub = globals.DirtyPlugins;
  if (!api?.React || !hub?.react || !hub.values || !hub.settingsMetadata?.multiscreen || !api.libraries?.ReactRouterDOM) return null;
  if ([api.React.createElement, api.React.useEffect, api.React.useState, api.React.useRef, api.React.useCallback, api.React.useMemo,
  api.register?.route, api.patch?.before, api.libraries.ReactRouterDOM.useLocation,
  hub.graphql, hub.getPluginSettings, hub.values.clampInteger, hub.values.coerceBoolean, hub.react.usePageTitle].some(value => typeof value !== "function")) return null;
  if ([api.libraries.ReactRouterDOM.NavLink, hub.react.IconButton, hub.react.StateView, hub.react.NavAction].some(value => !value || (typeof value !== "function" && typeof value !== "object"))) return null;
  return { api, hub };
}

export function bindRuntime(runtime: { api: Host; hub: Hub }) {
  PluginApi = runtime.api;
  DirtyPlugins = runtime.hub;
  React = runtime.api.React;
  settingsDomain = createSettingsDomain(DirtyPlugins);
  contexts = createContexts({ life });
  queries = createQueries(DirtyPlugins, settingsDomain);
  counts = createCounts();
  life.effects.add(() => counts.clear());
}
