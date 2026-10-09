import type * as R from "react";
import type { Host, HubApi } from "../../DirtyPlugins/src/types";
import type { ChartInstance, EntityResponse, StatsPerformer, StatsScene, WorldData } from "./types";
export interface StatsFilter {
  makeFindFilter(): Record<string, unknown>;
  makeFilter(): Record<string, unknown>;
  makeQueryParameters?(): string;
  count(): number;
}
export type Router = Host["libraries"]["ReactRouterDOM"] & {
  useLocation(): { pathname: string; search: string };
  useHistory(): { push(path: string): void; replace(location: { pathname: string; search: string }): void };
}
export interface StatsHost extends Omit<Host, "libraries" | "patch"> {
  libraries: Host["libraries"] & { ReactRouterDOM: Router };
  ReactDOM: { createPortal(children: R.ReactNode, node: Element): R.ReactPortal };
  patch: Required<Host["patch"]>;
  GQL: {
    useFindPerformersQuery(options: { variables: Record<string, unknown>; skip: boolean }): { data?: EntityResponse<StatsPerformer>; loading: boolean; error?: Error };
    useFindScenesQuery(options: { variables: Record<string, unknown>; skip: boolean }): { data?: EntityResponse<StatsScene>; loading: boolean; error?: Error };
  };
}
export interface ChartEngine {
  init(node: HTMLElement | null, theme: unknown, options?: Record<string, unknown>): ChartInstance;
  registerMap(name: string, world: WorldData): void;
}
export interface FilterBridge { activeEntity: string | null; listener: ((entity: string, filter: SavedFilter) => void) | null; }
export interface SavedFilter { find: Record<string, unknown>; object: Record<string, unknown>; count: number; query?: string; }
export interface Runtime { React: typeof R; api: StatsHost; hub: HubApi; charts: ChartEngine; world: WorldData; filterBridge: FilterBridge; own?(cleanup: () => void): () => void; }
export function readRuntime(charts: ChartEngine, world: WorldData): Runtime | null {
  const globals = window as unknown as { PluginApi?: StatsHost; DirtyPlugins?: HubApi };
  const api = globals.PluginApi, hub = globals.DirtyPlugins;
  if (!api?.React || !api.libraries?.ReactRouterDOM || !api.ReactDOM || !api.GQL || !hub?.react || !hub.native) return null;
  if ([api.React.createElement, api.React.useState, api.React.useEffect, api.React.useMemo, api.React.useRef,
  api.register?.route, api.patch?.instead, api.patch?.before, hub.graphql, hub.getPluginSettings, hub.configurePlugin,
  hub.createSaveController, hub.native.ensureComponents, hub.react.StatisticSelector, hub.react.StateView, charts.init, charts.registerMap]
    .some(value => typeof value !== "function")) return null;
  return { React: api.React, api, hub, charts, world, filterBridge: { activeEntity: null, listener: null } };
}
