import type * as R from "react";
import type { Host } from "../../DirtyPlugins/src/types";
import type { Runtime } from "./runtime";
import type { PreviewMedia } from "./types";
export interface Router {
  NavLink: import("../../DirtyPlugins/src/types").NativeComponent;
  Prompt: import("../../DirtyPlugins/src/types").NativeComponent;
  useHistory(): { push(path: string): void; replace(path: string): void };
  useLocation(): { pathname: string; search: string };
}
export interface RankHost extends Omit<Host, "libraries" | "patch" | "utils"> {
  libraries: Host["libraries"] & { ReactRouterDOM: Router; Intl: { useIntl(): { messages?: Record<string, string> } } };
  patch: Required<Host["patch"]>;
  utils?: NonNullable<Host["utils"]> & { StashService?: { useFindScene(id: string): { loading?: boolean; error?: unknown; data?: { findScene?: PreviewMedia } } } };
}
export interface UIRuntime extends Runtime { React: typeof R; PluginApi: RankHost; useEffect?: typeof R.useEffect; }
export interface NativePlayer {
  isDisposed(): boolean; pause(): void; muted(value: boolean): void;
  currentTime(): number; currentTime(value: number): void;
  ready(callback: () => void): void; on(event: string, callback: () => void): void; off(event: string, callback: () => void): void;
  persistVolume?(): { enabled: boolean; ready(): void };
}
export function readRuntime(): UIRuntime | null {
  const globals = window as unknown as { PluginApi?: RankHost; DirtyPlugins?: Runtime["DirtyPlugins"] };
  const api = globals.PluginApi, hub = globals.DirtyPlugins;
  if (!api?.React || !api.libraries?.ReactRouterDOM || !api.libraries.Intl || !hub?.react || !hub.values) return null;
  if ([api.React.createElement, api.React.useEffect, api.React.useState, api.React.useRef, api.React.useCallback, api.React.useMemo,
  api.register?.route, api.patch?.before, api.patch?.after, api.patch?.instead, hub.graphql, hub.getPluginSettings,
  hub.runPluginOperation, hub.react.useSettingsDraft, hub.values.asObject, hub.values.parseMaybeJson, hub.values.coerceBoolean]
    .some(value => typeof value !== "function")) return null;
  return { React: api.React, PluginApi: api, DirtyPlugins: hub };
}
