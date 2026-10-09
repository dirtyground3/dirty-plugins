import type * as R from "react";
import type { HubApi } from "../../DirtyPlugins/src/types";
import type { SavedFilter } from "./runtime";
export type NativeReactHooks = Pick<typeof R, "useEffect" | "useState" | "useRef" | "useMemo" | "useCallback">;
export interface StatsPageCollection<T> { count: number; rows: T[]; }
export interface StatsDefinition {
  label: string; route: string; entity?: string; group?: string; size?: string;
  options?: Record<string, string | number | boolean>;
  choices?: Record<string, string | Array<string | number | boolean>>;
}
export interface StatsPageOptions<T> {
  query: string;
  variables(page: number): Record<string, unknown>;
  collection(response: EntityResponse<T>): StatsPageCollection<T>;
  failureLabel: string;
  singlePage?: boolean;
}
export interface StatsPageRequest<T> extends StatsPageOptions<T> {
  graphql(query: string, variables: Record<string, unknown>, options: { signal: AbortSignal }): Promise<EntityResponse<T>>;
  signal: AbortSignal;
}
export interface StatsPageEffect<T> extends StatsPageOptions<T> {
  setLoading(value: boolean): void;
  setError(value: string): void;
  publish(rows: T[]): void;
  enabled?: boolean;
  onStart?(): void;
  onDisabled?(): void;
  onError?(): void;
}
export interface StatsDataDependencies {
  React: Pick<NativeReactHooks, "useEffect" | "useState">;
  graphql: HubApi["graphql"];
  own?(cleanup: () => void): () => void;
}
export interface StatsEntityLoad<T> extends Omit<StatsPageOptions<T>, "collection" | "failureLabel"> {
  entity: "performers" | "scenes";
  failureLabel?: string;
  onStart?(): void;
  onLoaded?(rows: T[]): void;
}
// ECharts is a bundled native boundary. Domain builders remain Stats-local.
export interface StatsChartDescriptor {
  node: HTMLElement;
  chartRef?: { current: ChartInstance | null };
  beforeInit?(): void;
  configure(chart: ChartInstance): void;
  resize?(chart: ChartInstance): void;
  beforeDispose?(chart: ChartInstance): void;
  onError(error: Error): void;
}
export interface StatsChartDependencies {
  init(node: HTMLElement, options: { renderer: string }): ChartInstance;
  events: Pick<Window, "addEventListener" | "removeEventListener">;
  Observer?: typeof ResizeObserver;
  own?(cleanup: () => void): () => void;
}

export interface StatsScatterPoint { id: string; name: string; rating: number; scenes: number; highlight: boolean; }
export interface StatsCountRatingPoint { id: string; title: string; rating: number; count: number; }
export interface StatsRepeatRow { id: string; title: string; rank: number; views: number; cumulativeViews: number; sceneShare: number; viewShare: number; }
export interface StatsQualityPoint { id: string; title: string; bytes: number; duration: number; efficiency: number; rating: number; }
export interface StatsStudioPoint { id: string; name: string; image: string; scenes: number; rated: number; unrated: number; rating: number | null; bytes: number; }
export interface StatsConstellationNode { id: string; name: string; value: number; gender: string; genderLabel: string; genderColor: string; collaborators: number; }
export interface StatsConstellationLink { source: string; target: string; sourceName: string; targetName: string; value: number; }
export interface StatsConstellationLayout {
  symbolMin: number; symbolRange: number; labelLimit: number; repulsion: number[];
  edgeLength: number[]; gravity: number; zoom: number; edgeOpacity: number;
}
export interface StatsTagDatum { name: string; value: number; playsPerScene: number; plays: number; rating: number | null; rated: number; unrated: number; }
// ECharts owns series styling and formatter parameters; inputs above are domain data.
export type StatsSeriesDatum = Record<string, unknown>;
export interface StatsChartOptionDependencies {
  themeColor(name: string): string;
  formatBytes(bytes: number): string;
  constellationLayout(count: number): StatsConstellationLayout;
  scatterSeriesData(stats: { points: StatsScatterPoint[] }, selected: string | null): StatsSeriesDatum[];
  scatterGuideLines(minRating: number, maxScenes: number): Array<{ axis: "x" | "y"; value: number; active: boolean }>;
  countRatingLabel(metric: string): string;
  countRatingSeriesData(stats: { points: StatsCountRatingPoint[] }, selected: string | null): StatsSeriesDatum[];
  repeatOffenderSeriesData(stats: { rows: StatsRepeatRow[] }, selected: string | null): StatsSeriesDatum[];
  qualityEfficiencySeriesData(stats: { points: StatsQualityPoint[] }): StatsSeriesDatum[];
  studioSeriesData(points: StatsStudioPoint[], maxBytes: number, selected: string | null): StatsSeriesDatum[];
}

export interface EntityResponse<T> { findScenes?: { count: number; scenes: T[] }; findPerformers?: { count: number; performers: T[] }; }
export interface StatsFile { id?: string; size?: string | number | null; mod_time?: string | null; duration?: number | null; }
export interface StatsPerformer { id: string; name?: string; birthdate?: string | null; death_date?: string | null; image_path?: string | null; gender?: string; country?: string; rating100?: number | string | null; scene_count?: number | string | null; }
export interface StatsScene { id: string; title?: string; date?: string | null; created_at?: string | null; files?: StatsFile[]; performers?: StatsPerformer[]; rating100?: number | string | null; play_count?: number | null; o_counter?: number | null; studio?: { id: string; name?: string; image_path?: string }; tags?: Array<{ id: string; name: string }>; }
export interface BirthdayEntry { id: string; name: string; birthdate: string; deathDate: string; deceased: boolean; month: number; day: number; turns: number; daysUntil: number; image: string; }
// ECharts supplies open option/event payloads. Entity/domain models stay typed.
export type ChartOption = Record<string, any>;
export interface ChartEvent { data: any; value: any; name: string; percent?: number; seriesName?: string; componentType?: string; dataType?: string; event?: { offsetX: number; offsetY: number }; }

export interface GrowthZoomOption { dataZoom?: Array<{ startValue?: number | string | null; endValue?: number | string | null; start?: number; end?: number }>; series?: Array<{ data?: Array<number[] | { value?: number[] } | null> }>; }
export interface ChartInstance { getModel(): { getComponent(name: string): { coordinateSystem?: { getRect(): { x: number; y: number; width: number; height: number } } } | null }; dispatchAction(action: ChartOption): void; isDisposed(): boolean; resize(): void; dispose(): void; setOption(option: ChartOption, replace?: boolean): void; getOption(): ChartOption; getDataURL(options: ChartOption): string; on(event: string, callback: (event: ChartEvent) => void): void; off(event: string, callback?: (event: ChartEvent) => void): void; convertToPixel(finder: ChartOption, value: number[]): number[]; convertFromPixel(finder: ChartOption, value: number[]): number[]; getWidth(): number; getHeight(): number; containPixel(finder: ChartOption, value: number[]): boolean; getZr(): { on(event: string, callback: (event: { offsetX: number; offsetY: number; target?: unknown }) => void): void; off(event: string, callback?: (event: { offsetX: number; offsetY: number }) => void): void; }; }
export interface WorldFeature { type: string; properties: { name: string; iso2: string; iso3: string; aliases?: string[] }; geometry: Record<string, unknown>; }
export interface WorldData { type: string; features: WorldFeature[]; }
export interface StatsTheme {
  key: string; label: string; background: string; panel: string; panelAlt: string; primary: string; secondary: string; accent: string;
  highlight: string; text: string; muted: string; grid: string; border: string; selection: string; soft: string; softer: string;
  tagLow: number[]; tagHigh: number[]; palette: string[];
}
export type SettingValue = string | number | boolean;
export interface StatsSettings extends Record<string, SettingValue> {
  visualTheme: string; showMapNumbers: boolean; sceneRatingRounding: number; performerRatingRounding: number;
  growthDateBasis: string; growthGrouping: string; growthShowForecast: boolean; growthShowCapacity: boolean;
  constellationMaxPerformers: number; constellationMinShared: number; scatterMinRating: number; scatterMaxScenes: number;
  countRatingMetric: string; studioMinScenes: number; tagDnaColorMetric: string; tagDnaMaxTags: number;
}
export interface Capacity { total: number; free: number; errors: string[]; }
export interface TagRow { id: string; name: string; scenes: number; rated: number; unrated: number; rating: number | null; plays: number; playsPerScene: number; }
export interface ConstellationSelection { ids: string[]; label: string; type: string; key: string; }
export interface DashboardWidgetModel { id: string; statistic: string; title: string; size: string; options: WidgetOptions; filter: SavedFilter; }
export interface DashboardResource { key: string; group: string; filter: SavedFilter; limit: number; }
export interface ResourceState { loading: boolean; error: string; rows: Array<StatsScene & StatsPerformer>; capacity: Capacity | null; }

export interface BirthdaySelection { month: number; day: number; today?: boolean; }

// The registry normalizer fills each statistic's applicable option keys. Views
// consume only the keys belonging to that statistic. Unknown keys never survive.
export interface WidgetOptions extends Record<string, SettingValue> { showHeader: boolean; showNumbers: boolean; dateBasis: string; grouping: string; showCapacity: boolean; showForecast: boolean; showPerformerCount: boolean; showModeAge: boolean; showMedianAge: boolean; showAverageAge: boolean; rounding: number; minRating: number; maxScenes: number; cardCount: number; metric: string; minScenes: number; maxTags: number; maxPerformers: number; minShared: number; upcomingCount: number; }
