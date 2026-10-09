import type { HubThemeDependencies, ThemeApi } from "./types";
export function createTheme(dependencies: HubThemeDependencies) {
  var hubApi = dependencies.hubApi;
  var DEFAULT_VISUAL_THEME = dependencies.DEFAULT_VISUAL_THEME;
  var getPluginSettings = dependencies.getPluginSettings;
  hubApi.theme = {} as ThemeApi;
  hubApi.theme.defaultKey = DEFAULT_VISUAL_THEME;
  var visualThemeKeys = dependencies.VISUAL_THEME_KEYS;
  var visualThemeListeners: ((key: string) => void)[] = [];
  var visualThemeKey = DEFAULT_VISUAL_THEME;
  function normalizedVisualTheme(value: unknown) {
    return visualThemeKeys.indexOf(value as string) >= 0 ? value as string : DEFAULT_VISUAL_THEME;
  }
  function applyVisualTheme(value: unknown) {
    var key = normalizedVisualTheme(value);
    if (document.documentElement && document.documentElement.classList) {
      visualThemeKeys.forEach(function(candidate) {
        document.documentElement.classList.remove("dirty-ui-theme-" + candidate);
      });
      document.documentElement.classList.add("dirty-ui-theme-" + key);
    }
    if (visualThemeKey === key) return key;
    visualThemeKey = key;
    hubApi.theme.currentKey = key;
    visualThemeListeners.slice().forEach(function(listener) { listener(key); });
    return key;
  }
  hubApi.theme.currentKey = visualThemeKey;
  hubApi.theme.normalizeKey = normalizedVisualTheme;
  hubApi.theme.subscribe = function(listener) {
    visualThemeListeners.push(listener);
    return function() {
      var index = visualThemeListeners.indexOf(listener);
      if (index >= 0) visualThemeListeners.splice(index, 1);
    };
  };
  function load() {
    return getPluginSettings("dirtyPlugins").then(function(settings) {
      return applyVisualTheme(settings.visualTheme);
    }).catch(function(error) {
      console.warn("DirtyPlugins could not load the suite theme", error);
      return applyVisualTheme(DEFAULT_VISUAL_THEME);
    });
  }
  if (typeof fetch === "function" && document.documentElement) {
    hubApi.theme.ready = load();
  } else {
    hubApi.theme.ready = Promise.resolve(visualThemeKey);
  }
  hubApi.theme.readRole = function(root, propertyName) {
    if (!root || !propertyName || typeof window.getComputedStyle !== "function") return "";
    return window.getComputedStyle(root).getPropertyValue(propertyName).trim();
  };
  return {
    applyVisualTheme: applyVisualTheme
  };
}
