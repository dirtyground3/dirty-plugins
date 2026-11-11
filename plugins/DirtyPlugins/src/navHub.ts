import { defaults } from "@generated/dirtyPlugins.settings";
import { CONFIGURATION_CHANGED_EVENT } from "./constants";
import { React } from "./runtime";
import { coerceBoolean } from "./shared/values";
import { getPluginSettings } from "./transport";

interface NavHubEntry {
  id: string;
  label: string;
  selector: string;
}

export interface NavHubApi {
  register(entry: NavHubEntry): () => void;
}

const READY_EVENT = "navhub:ready";
const ENTRIES: NavHubEntry[] = [
  { id: "dirtyStats", label: "DirtyStats dashboard", selector: ".navbar-buttons .dirty-stats-nav-button" },
  {
    id: "dirtyRank-battles",
    label: "DirtyRank battles",
    selector: ".navbar-buttons .dirty-rank-nav-link:not(.dirty-rank-leaderboards-nav-link)",
  },
  {
    id: "dirtyRank-leaderboards",
    label: "DirtyRank leaderboards",
    selector: ".navbar-buttons .dirty-rank-leaderboards-nav-link",
  },
  { id: "dirtyMultiscreen", label: "DirtyMultiscreen", selector: ".navbar-buttons .ms-nav-button" },
  { id: "dirtyPlugins", label: "Dirty Plugins settings", selector: ".navbar-buttons .dirty-plugins-nav" },
];

function getNavHub() {
  const api = window.NavHub;
  return typeof api?.register === "function" ? api : undefined;
}

export function useNavHubAvailable() {
  const [available, setAvailable] = React.useState(() => Boolean(getNavHub()));
  React.useEffect(() => {
    const detect = () => setAvailable(Boolean(getNavHub()));
    window.addEventListener(READY_EVENT, detect);
    detect();
    return () => window.removeEventListener(READY_EVENT, detect);
  }, []);
  return available;
}

export function installNavHubIntegration() {
  function start() {
    const navHub = getNavHub();
    if (!navHub) return;
    window.removeEventListener(READY_EVENT, start);

    let generation = 0;
    const unregister: (() => void)[] = [];
    const refresh = (event?: Event) => {
      const pluginId = (event as CustomEvent<{ pluginId?: string }> | undefined)?.detail?.pluginId;
      if (pluginId && pluginId !== "dirtyPlugins") return;
      const request = ++generation;
      getPluginSettings("dirtyPlugins")
        .then(stored => {
          if (request !== generation) return;
          if (!coerceBoolean(stored.useNavHub, defaults.useNavHub)) {
            unregister.splice(0).forEach(remove => remove());
          } else if (unregister.length === 0) {
            try {
              for (const entry of ENTRIES) unregister.push(navHub.register(entry));
            } catch (error) {
              unregister.splice(0).forEach(remove => remove());
              throw error;
            }
          }
        })
        .catch(error => console.error("DirtyPlugins could not refresh the Nav Hub integration", error));
    };
    window.addEventListener(CONFIGURATION_CHANGED_EVENT, refresh);
    refresh();
  }
  window.addEventListener(READY_EVENT, start);
  start();
}
