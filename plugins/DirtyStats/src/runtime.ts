import type { ChartInstance, WorldData } from "./types";

export { React, PluginApi as api, hub, ui } from "../../DirtyPlugins/src/shared/host";
export const PLUGIN_ID = "dirtyStats";

/** ECharts and the world map, set once loadCharts() resolves. */
export let charts: ChartEngine | null = null;
export let world: WorldData | null = null;
let chartsLoading: Promise<void> | null = null;
/** Install the chart module: the loaded chart file, or a test's fake engine. */
export function installCharts(module: { charts: ChartEngine; world: WorldData }) {
  charts = module.charts;
  world = module.world;
}
/** Load the separately compiled chart file once; a failed load is retried by the next call. */
export function loadCharts() {
  if (!chartsLoading)
    chartsLoading = import("./echarts").then(installCharts, error => {
      chartsLoading = null;
      throw error;
    });
  return chartsLoading;
}

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
