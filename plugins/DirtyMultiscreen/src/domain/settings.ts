import type { Hub, Settings, PlaybackSettings } from "../types";
export function createSettingsDomain(DirtyPlugins: Hub) {
  const MAX_SCENE_PAGE_SIZE = 240;
  const NON_RANDOM_SCENE_SORT = "title";

  const DEFAULT_SETTINGS = DirtyPlugins.settingsMetadata.multiscreen.defaults;
  const LIMITS = DirtyPlugins.settingsMetadata.multiscreen.limits;
  const clampInteger = DirtyPlugins.values.clampInteger;
  const coerceBoolean = DirtyPlugins.values.coerceBoolean;
  function normalizeSettings(rawSettings: Record<string, unknown>): Settings {
    const rows = clampInteger(rawSettings.rows, DEFAULT_SETTINGS.rows, LIMITS.rows.min, LIMITS.rows.max);
    const columns = clampInteger(rawSettings.columns, DEFAULT_SETTINGS.columns, LIMITS.columns.min, LIMITS.columns.max);
    return {
      // The CSS grid only has rows x columns cells; extra tiles would play
      // off-screen while being clipped by the viewport.
      totalScreens: Math.min(clampInteger(rawSettings.totalScreens, DEFAULT_SETTINGS.totalScreens, LIMITS.totalScreens.min, LIMITS.totalScreens.max), rows * columns),
      rows,
      columns,
      randomize: coerceBoolean(rawSettings.randomize, DEFAULT_SETTINGS.randomize),
      splitScenes: coerceBoolean(rawSettings.splitScenes, DEFAULT_SETTINGS.splitScenes),
      startMuted: coerceBoolean(rawSettings.startMuted, DEFAULT_SETTINGS.startMuted),
      randomStart: coerceBoolean(rawSettings.randomStart, DEFAULT_SETTINGS.randomStart),
      loopScenes: coerceBoolean(rawSettings.loopScenes, DEFAULT_SETTINGS.loopScenes),
      markerDuration: clampInteger(rawSettings.markerDuration, DEFAULT_SETTINGS.markerDuration, LIMITS.markerDuration.min, LIMITS.markerDuration.max),
      pauseWhenHidden: coerceBoolean(rawSettings.pauseWhenHidden, DEFAULT_SETTINGS.pauseWhenHidden)
    };
  }
  function getPlaybackSettings(settings: Settings): PlaybackSettings {
    return {
      startMuted: settings.startMuted, randomStart: settings.randomStart,
      loop: settings.loopScenes, pauseWhenHidden: settings.pauseWhenHidden
    };
  }
  function getSceneLimit(settings: Pick<Settings, "splitScenes" | "totalScreens">) {
    const multiplier = settings.splitScenes ? 8 : 12;
    return Math.min(MAX_SCENE_PAGE_SIZE, Math.max(settings.totalScreens, settings.totalScreens * multiplier));
  }
  function getSceneSort(settings: Pick<Settings, "randomize">) {
    if (settings.randomize) return "random";
    return NON_RANDOM_SCENE_SORT;
  }
  return { defaults: DEFAULT_SETTINGS, nonRandomSort: NON_RANDOM_SCENE_SORT, normalizeSettings, getPlaybackSettings, getSceneLimit, getSceneSort };
}
