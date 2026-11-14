import { defaults as DEFAULT_SETTINGS, limits as LIMITS, options as OPTIONS } from "@generated/multiscreen.settings";
import { clampInteger, coerceBoolean } from "../../../DirtyPlugins/src/shared/values";
import type {
  GridSize,
  ListSettings,
  OtherPluginLists,
  Settings,
  PlaybackSettings,
  SavedGridSettings,
  SceneOrder,
} from "../types";

const MAX_SCENE_PAGE_SIZE = 240;
export const NON_RANDOM_SCENE_SORT = "title";
const SCENE_ORDERS = new Set<string>(OPTIONS.sceneOrder.map(option => option.value));
const LIST_PERMISSIONS = new Set<string>(OPTIONS.otherPluginLists.map(option => option.value));
export { DEFAULT_SETTINGS };
/** The largest grid the edit-mode picker offers. */
export const GRID_LIMITS = { rows: LIMITS.rows.max, columns: LIMITS.columns.max };

/** Which other plugins' lists the header button uses, and how many items it takes from one. */
export function normalizeListSettings(rawSettings: Record<string, unknown>): ListSettings {
  const allow = rawSettings.otherPluginLists;
  return {
    allow: (typeof allow === "string" && LIST_PERMISSIONS.has(allow)
      ? allow
      : DEFAULT_SETTINGS.otherPluginLists) as OtherPluginLists,
    limit: clampInteger(
      rawSettings.listSizeLimit,
      DEFAULT_SETTINGS.listSizeLimit,
      LIMITS.listSizeLimit.min,
      LIMITS.listSizeLimit.max,
    ),
  };
}

/** How many recent grids Saved grids keeps; 0 saves none. */
export const normalizeRecentGrids = (rawSettings: Record<string, unknown>) =>
  clampInteger(rawSettings.recentGrids, DEFAULT_SETTINGS.recentGrids, LIMITS.recentGrids.min, LIMITS.recentGrids.max);

/** Layout is independent of query settings: toggling it must never reload the playing queues. */
export const normalizeFitVideos = (rawSettings: Record<string, unknown>) =>
  coerceBoolean(rawSettings.fitVideos, DEFAULT_SETTINGS.fitVideos);
/** Whether dragged dividers stick at eighths, chosen in the grid picker. */
export const normalizeSnapDividers = (rawSettings: Record<string, unknown>) =>
  coerceBoolean(rawSettings.snapDividers, DEFAULT_SETTINGS.snapDividers);

export function normalizeSettings(rawSettings: Record<string, unknown>): Settings {
  const rows = clampInteger(rawSettings.rows, DEFAULT_SETTINGS.rows, LIMITS.rows.min, LIMITS.rows.max);
  const columns = clampInteger(rawSettings.columns, DEFAULT_SETTINGS.columns, LIMITS.columns.min, LIMITS.columns.max);
  return {
    // Every cell of the grid plays.
    totalScreens: rows * columns,
    rows,
    columns,
    sceneOrder: (typeof rawSettings.sceneOrder === "string" && SCENE_ORDERS.has(rawSettings.sceneOrder)
      ? rawSettings.sceneOrder
      : DEFAULT_SETTINGS.sceneOrder) as SceneOrder,
    spreadScenes: coerceBoolean(rawSettings.spreadScenes, DEFAULT_SETTINGS.spreadScenes),
    avoidDuplicates: coerceBoolean(rawSettings.avoidDuplicates, DEFAULT_SETTINGS.avoidDuplicates),
    splitScenes: coerceBoolean(rawSettings.splitScenes, DEFAULT_SETTINGS.splitScenes),
    startMuted: coerceBoolean(rawSettings.startMuted, DEFAULT_SETTINGS.startMuted),
    randomStart: coerceBoolean(rawSettings.randomStart, DEFAULT_SETTINGS.randomStart),
    loopScenes: coerceBoolean(rawSettings.loopScenes, DEFAULT_SETTINGS.loopScenes),
    markerDuration: clampInteger(
      rawSettings.markerDuration,
      DEFAULT_SETTINGS.markerDuration,
      LIMITS.markerDuration.min,
      LIMITS.markerDuration.max,
    ),
    pauseWhenHidden: coerceBoolean(rawSettings.pauseWhenHidden, DEFAULT_SETTINGS.pauseWhenHidden),
    showPerformerNavigation: coerceBoolean(
      rawSettings.showPerformerNavigation,
      DEFAULT_SETTINGS.showPerformerNavigation,
    ),
    moveWithoutEditing: coerceBoolean(rawSettings.moveWithoutEditing, DEFAULT_SETTINGS.moveWithoutEditing),
  };
}
/** The settings the queue was dealt under: a grid grown by + keeps the queue of the grid it grew from. */
export const dealtSettings = (settings: Settings, deal: GridSize | null | undefined): Settings =>
  deal ? { ...settings, rows: deal.rows, columns: deal.columns, totalScreens: deal.rows * deal.columns } : settings;
/** The grid one screen larger: a column while it is no wider than tall, else a row; null at the largest grid. */
export function growGrid({ columns, rows }: GridSize): GridSize | null {
  const wider = columns < GRID_LIMITS.columns,
    taller = rows < GRID_LIMITS.rows;
  if (wider && (columns <= rows || !taller)) return { columns: columns + 1, rows };
  return taller ? { columns, rows: rows + 1 } : null;
}
/** The settings a saved grid keeps: the grid itself and what deals its queue. */
export function savedGridSettings(settings: Settings, fitVideos: boolean): SavedGridSettings {
  return {
    fitVideos,
    rows: settings.rows,
    columns: settings.columns,
    sceneOrder: settings.sceneOrder,
    spreadScenes: settings.spreadScenes,
    avoidDuplicates: settings.avoidDuplicates,
    splitScenes: settings.splitScenes,
  };
}
export function getPlaybackSettings(settings: Settings): PlaybackSettings {
  return {
    startMuted: settings.startMuted,
    randomStart: settings.randomStart,
    loop: settings.loopScenes,
    pauseWhenHidden: settings.pauseWhenHidden,
  };
}
export function getSceneLimit(settings: Pick<Settings, "splitScenes" | "totalScreens">) {
  const multiplier = settings.splitScenes ? 8 : 12;
  return Math.min(MAX_SCENE_PAGE_SIZE, Math.max(settings.totalScreens, settings.totalScreens * multiplier));
}
