import { debugLog, setDebugPlugin } from "./debug";

const registered = new Set<string>();

/**
 * Run a plugin's registration once per page. Stash cannot remove routes or patches,
 * so a reloaded plugin bundle is ignored, and a failed registration is logged once.
 */
export function registerPlugin(pluginId: string, setup: () => void) {
  if (registered.has(pluginId)) return;
  registered.add(pluginId);
  setDebugPlugin(pluginId);
  try {
    debugLog(pluginId, "script started");
    setup();
    debugLog(pluginId, "script finished registering");
  } catch (error) {
    console.error("[" + pluginId + "] registration failed", error);
  } finally {
    setDebugPlugin(null);
  }
}
