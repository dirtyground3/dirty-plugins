type NativeComponent = (props: any) => any;
interface MultiscreenDefaults {
  totalScreens: number; rows: number; columns: number; markerDuration: number;
  randomize: boolean; splitScenes: boolean; startMuted: boolean; randomStart: boolean;
  loopScenes: boolean; pauseWhenHidden: boolean;
}
type HtmlRenderer = (strings: TemplateStringsArray, ...values: any[]) => any;
/** Stash owns React and component shapes; keep that compatibility boundary permissive. */
interface NativeReactHooks {
  useEffect: (...args: any[]) => any;
  useRef: (...args: any[]) => any;
  useMemo: (...args: any[]) => any;
  useCallback: (...args: any[]) => any;
  useState: (...args: any[]) => any;
}
interface TidyOperation {
  scene_id: string;
  scene_title: string;
  file_id: string;
  source_path: string;
  destination_path: string;
  status: "ready" | "warning" | "blocked" | "unchanged";
  actions: string[];
  warnings: string[];
  blocked_scenes?: {id: string; title: string}[];
}
interface TidyPreviewDependencies {
  html: HtmlRenderer;
  React: {Fragment: any};
  DirtyPlugins: Pick<Window["DirtyPlugins"], "captureEnabled">;
  variables: string[][];
}
interface TidySummary { ready?: number; moves?: number; renames?: number; warnings?: number; unchanged?: number; blocked?: number; }
type TidyVariableMenuItem = {header: string} | {key: string; label: any; onSelect(): void};
interface CompactorCondition {
  scene?: Record<string, unknown>;
  find?: {q?: string; [key: string]: unknown};
  query?: string;
  all?: boolean;
}
interface CompactorRule {
  id: string; name: string; enabled: boolean;
  mode: "manual" | "automatic";
  condition: CompactorCondition;
  action: "resize" | "reencode" | "delete";
  width: number; height: number;
  quality?: "high" | "balanced" | "small" | "visual" | "source" | "custom";
  vmaf?: number; mbps: number;
  codec: "h264" | "hevc";
  encoder: "auto" | "cpu" | "nvenc" | "qsv" | "amf";
  format: "keep" | "mp4" | "mkv";
}
interface CompactorSettings { rules: CompactorRule[]; automationPaused: boolean; schemaVersion?: number; }
interface CompactorMediaFile {
  size: number; duration: number; width: number; height: number;
  bit_rate?: number; frame_rate?: number;
}
interface CompactorAutomationDependencies extends Pick<NativeReactHooks, "useRef" | "useEffect"> {
  api: {GQL?: {useJobsSubscribeSubscription?: () => {data?: {jobsSubscribe?: StashJobEvent}}}};
  hub: Pick<Window["DirtyPlugins"], "createJobHook" | "ui">;
  operation(mode: string, args: {jobId: string; startTime: string}): Promise<unknown>;
}
