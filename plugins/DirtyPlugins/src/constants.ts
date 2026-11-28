import * as hubSettings from "@generated/dirtyPlugins.settings";
export const ROUTE_PATH = "/plugins/dirty-plugins";
export const CONFIGURATION_CHANGED_EVENT = "dirty-plugins:configuration-changed";
export const FIELD_ACTIONS_CHANGED_EVENT = "dirty-plugins:field-actions-changed";
export const SETTINGS_PANELS_CHANGED_EVENT = "dirty-plugins:settings-panels-changed";
export const UNSAVED_SETTINGS_MESSAGE = "You have unsaved Dirty Plugins settings. Leave without saving them?";
export const DEFAULT_VISUAL_THEME = hubSettings.defaults.visualTheme;
export const VISUAL_THEME_KEYS = hubSettings.options.visualTheme.map(option => option.value);

/** Suite plugins in tab order (schemas/dirtyPlugins.settings.json); Stash's plugin page links and groups the same set. */
export const MANAGED_PLUGIN_IDS: string[] = hubSettings.constants.managedPluginIds;
export const MANAGED_PLUGIN_ID_SET = new Set(MANAGED_PLUGIN_IDS);
