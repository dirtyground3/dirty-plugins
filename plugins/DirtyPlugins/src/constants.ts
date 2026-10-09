import * as captions from "@generated/dirtyCaptions.settings";
import * as hubSettings from "@generated/dirtyPlugins.settings";
import * as extractor from "@generated/extractScenes.settings";
import * as multiscreen from "@generated/multiscreen.settings";
export const ROUTE_PATH = "/plugins/dirty-plugins";
export const CONFIGURATION_CHANGED_EVENT = "dirty-plugins:configuration-changed";
export const FIELD_ACTIONS_CHANGED_EVENT = "dirty-plugins:field-actions-changed";
export const SETTINGS_PANELS_CHANGED_EVENT = "dirty-plugins:settings-panels-changed";
export const UNSAVED_SETTINGS_MESSAGE = "You have unsaved Dirty Plugins settings. Leave without saving them?";
export const DEFAULT_VISUAL_THEME = hubSettings.defaults.visualTheme;
export const VISUAL_THEME_KEYS = hubSettings.options.visualTheme.map(function(option) { return option.value; });

export const MANAGED_PLUGIN_IDS = ["dirtyPlugins", "extractScenes", "multiscreen", "dirtyTidy", "dirtyRank", "dirtyStats", "dirtyCompactor", "dirtyCaptions"];
export const MANAGED_PLUGIN_ID_SET = new Set(MANAGED_PLUGIN_IDS);
export const MAIN_PAGE_PLUGIN_IDS = ["dirtyPlugins", "extractScenes", "multiscreen", "dirtyTidy", "dirtyRank", "dirtyStats", "dirtyCompactor", "dirtyCaptions"];
export const MAIN_PAGE_PLUGIN_ID_SET = new Set(MAIN_PAGE_PLUGIN_IDS);

/** Plugins whose ordinary controls the hub renders; their tables come from schemas/<id>.settings.json. */
interface StandardSettings {
  order: string[];
  defaults: Record<string, unknown>;
  options: Record<string, { value: string; label: string; }[]>;
  limits: Record<string, { min?: number; max?: number; step?: number; }>;
}
const STANDARD_SETTINGS: Record<string, StandardSettings> = { dirtyPlugins: hubSettings, dirtyCaptions: captions, extractScenes: extractor, multiscreen };
function standardTable<T>(pick: (settings: StandardSettings) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(STANDARD_SETTINGS).map(function(entry) { return [entry[0], pick(entry[1])]; }));
}
export const PLUGIN_SETTING_ORDER = standardTable(function(settings) { return settings.order; });
export const PLUGIN_DEFAULTS = standardTable(function(settings) { return settings.defaults; });
export const FIELD_OPTIONS = standardTable(function(settings) { return settings.options; });
export const FIELD_LIMITS = standardTable(function(settings) { return settings.limits; });
