import { DEFAULT_VISUAL_THEME, VISUAL_THEME_KEYS } from "./constants";
import type { ThemeApi } from "./types";

const listeners: ((key: string) => void)[] = [];

function normalizeKey(value: unknown) {
  return VISUAL_THEME_KEYS.indexOf(value as string) >= 0 ? (value as string) : DEFAULT_VISUAL_THEME;
}

export const theme: ThemeApi = {
  defaultKey: DEFAULT_VISUAL_THEME,
  currentKey: DEFAULT_VISUAL_THEME,
  normalizeKey,
  subscribe(listener) {
    listeners.push(listener);
    return () => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  },
  ready: Promise.resolve(DEFAULT_VISUAL_THEME),
  readRole(root, propertyName) {
    if (!root || !propertyName || typeof window.getComputedStyle !== "function") return "";
    return window.getComputedStyle(root).getPropertyValue(propertyName).trim();
  },
};

export function applyVisualTheme(value: unknown) {
  const key = normalizeKey(value);
  if (document.documentElement && document.documentElement.classList) {
    VISUAL_THEME_KEYS.forEach(candidate => document.documentElement.classList.remove("dirty-ui-theme-" + candidate));
    document.documentElement.classList.add("dirty-ui-theme-" + key);
  }
  if (theme.currentKey === key) return key;
  theme.currentKey = key;
  listeners.slice().forEach(listener => listener(key));
  return key;
}

/** Apply the stored suite theme; a failed read falls back to the default. */
export function loadVisualTheme(settings: () => Promise<Record<string, unknown>>) {
  if (typeof fetch !== "function" || !document.documentElement) return Promise.resolve(theme.currentKey);
  return settings()
    .then(stored => applyVisualTheme(stored.visualTheme))
    .catch(error => {
      console.warn("DirtyPlugins could not load the suite theme", error);
      return applyVisualTheme(DEFAULT_VISUAL_THEME);
    });
}
