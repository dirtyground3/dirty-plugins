import { defaults as DEFAULT_SETTINGS, limits as LIMITS, options as OPTIONS } from "@generated/multiscreen.settings";
import { clampInteger, coerceBoolean } from "../../../DirtyPlugins/src/shared/values";
import type { ListSettings, OtherPluginLists, Settings, PlaybackSettings, SceneOrder } from "../types";

const MAX_SCENE_PAGE_SIZE = 240;
export const NON_RANDOM_SCENE_SORT = "title";
const SCENE_ORDERS = new Set<string>(OPTIONS.sceneOrder.map(option => option.value));
const LIST_PERMISSIONS = new Set<string>(OPTIONS.otherPluginLists.map(option => option.value));
export { DEFAULT_SETTINGS };

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

export function normalizeSettings(rawSettings: Record<string, unknown>): Settings {
  const rows = clampInteger(rawSettings.rows, DEFAULT_SETTINGS.rows, LIMITS.rows.min, LIMITS.rows.max);
  const columns = clampInteger(rawSettings.columns, DEFAULT_SETTINGS.columns, LIMITS.columns.min, LIMITS.columns.max);
  // An empty setting fills the grid. A number can leave cells empty but never
  // adds tiles beyond the grid, which would play off-screen.
  const cells = Math.min(rows * columns, LIMITS.screens.max);
  const screens = String(rawSettings.screens ?? "").trim()
    ? clampInteger(rawSettings.screens, cells, LIMITS.screens.min, LIMITS.screens.max)
    : cells;
  return {
    totalScreens: Math.min(screens, cells),
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
