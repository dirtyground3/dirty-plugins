interface StatsPageCollection<T> { count: number; rows: T[]; }
interface StatsDefinition {
  label: string; route: string; entity?: string; group?: string; size?: string;
  options?: Record<string, string | number | boolean>;
  choices?: Record<string, string | Array<string | number | boolean>>;
}
interface StatsPageOptions<T> {
  query: string;
  variables(page: number): Record<string, unknown>;
  collection(response: any): StatsPageCollection<T>;
  failureLabel: string;
  singlePage?: boolean;
}
interface StatsPageRequest<T> extends StatsPageOptions<T> {
  graphql(query: string, variables: Record<string, unknown>, options: {signal: AbortSignal}): Promise<any>;
  signal: AbortSignal;
}
interface StatsPageEffect<T> extends StatsPageOptions<T> {
  setLoading(value: boolean): void;
  setError(value: string): void;
  publish(rows: T[]): void;
  enabled?: boolean;
  onStart?(): void;
  onDisabled?(): void;
  onError?(): void;
}
interface StatsDataDependencies {
  React: Pick<NativeReactHooks, "useEffect" | "useState">;
  graphql: StatsPageRequest<unknown>["graphql"];
}
interface StatsEntityLoad extends Omit<StatsPageOptions<any>, "collection" | "failureLabel"> {
  entity: "performers" | "scenes";
  failureLabel?: string;
  onStart?(): void;
  onLoaded?(rows: any[]): void;
}
// ECharts is a bundled native boundary. Domain builders remain Stats-local.
interface StatsChartDescriptor {
  node: HTMLElement;
  chartRef?: {current: any};
  beforeInit?(): void;
  configure(chart: any): void;
  resize?(chart: any): void;
  beforeDispose?(chart: any): void;
  onError(error: Error): void;
}
interface StatsChartDependencies {
  init(node: HTMLElement, options: {renderer: string}): any;
  events: Pick<Window, "addEventListener" | "removeEventListener">;
  Observer?: typeof ResizeObserver;
}

interface StatsScatterPoint {id: string; name: string; rating: number; scenes: number; highlight: boolean;}
interface StatsCountRatingPoint {id: string; title: string; rating: number; count: number;}
interface StatsRepeatRow {id: string; title: string; rank: number; views: number; cumulativeViews: number; sceneShare: number; viewShare: number;}
interface StatsQualityPoint {id: string; title: string; bytes: number; duration: number; efficiency: number; rating: number;}
interface StatsStudioPoint {id: string; name: string; image: string; scenes: number; rated: number; unrated: number; rating: number | null; bytes: number;}
interface StatsConstellationNode {id: string; name: string; value: number; gender: string; genderLabel: string; genderColor: string; collaborators: number;}
interface StatsConstellationLink {source: string; target: string; sourceName: string; targetName: string; value: number;}
interface StatsConstellationLayout {
  symbolMin: number; symbolRange: number; labelLimit: number; repulsion: number[];
  edgeLength: number[]; gravity: number; zoom: number; edgeOpacity: number;
}
interface StatsTagDatum {name: string; value: number; playsPerScene: number; plays: number; rating: number | null; rated: number; unrated: number;}
// ECharts owns series styling and formatter parameters; inputs above are domain data.
type StatsSeriesDatum = Record<string, unknown>;
interface StatsChartOptionDependencies {
  themeColor(name: string): string;
  formatBytes(bytes: number): string;
  constellationLayout(count: number): StatsConstellationLayout;
  scatterSeriesData(stats: {points: StatsScatterPoint[]}, selected: string | null): StatsSeriesDatum[];
  scatterGuideLines(minRating: number, maxScenes: number): Array<{axis: "x" | "y"; value: number; active: boolean}>;
  countRatingLabel(metric: string): string;
  countRatingSeriesData(stats: {points: StatsCountRatingPoint[]}, selected: string | null): StatsSeriesDatum[];
  repeatOffenderSeriesData(stats: {rows: StatsRepeatRow[]}, selected: string | null): StatsSeriesDatum[];
  qualityEfficiencySeriesData(stats: {points: StatsQualityPoint[]}): StatsSeriesDatum[];
  studioSeriesData(points: StatsStudioPoint[], maxBytes: number, selected: string | null): StatsSeriesDatum[];
}
