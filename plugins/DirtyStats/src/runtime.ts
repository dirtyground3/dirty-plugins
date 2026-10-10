import world from "../vendor/world.js";
import { charts } from "./echarts";
import type { ChartInstance, WorldData } from "./types";

export { React, PluginApi as api, hub, ui } from "../../DirtyPlugins/src/shared/host";
export { charts, world };
export const PLUGIN_ID = "dirtyStats";

export interface StatsFilter {
  makeFindFilter(): Record<string, unknown>;
  makeFilter(): Record<string, unknown>;
  makeQueryParameters?(): string;
  count(): number;
}
export interface ChartEngine {
  init(node: HTMLElement | null, theme: unknown, options?: Record<string, unknown>): ChartInstance;
  registerMap(name: string, world: WorldData): void;
}
export interface FilterBridge {
  activeEntity: string | null;
  listener: ((entity: string, filter: SavedFilter) => void) | null;
}
export interface SavedFilter {
  find: Record<string, unknown>;
  object: Record<string, unknown>;
  count: number;
  query?: string;
}
/** A dashboard filter dialog receives the filter that Stash's native list builds here. */
export const filterBridge: FilterBridge = { activeEntity: null, listener: null };
