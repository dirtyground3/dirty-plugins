import { isMultiscreenLaunchContext } from "./domain/context";
import type { LaunchContext, Lifetime, ListContext } from "./types";
const LAUNCH_CONTEXT_STORAGE_KEY = "multiscreen.launchContext";
/** Each native list route, its captured context, and the launch sources it produces. */
const LISTS = new Map([
  ["/scenes/markers", { key: "marker-list", selection: "marker-selection", filter: "marker-filter", filterKey: "markerFilter" }],
  ["/scenes", { key: "scene-list", selection: "selection", filter: "filter", filterKey: "sceneFilter" }],
  ["/performers", { key: "performer-list", selection: "performer-selection", filter: "performer-filter", filterKey: "performerFilter" }],
  ["/studios", { key: "studio-list", selection: "studio-selection", filter: "studio-filter", filterKey: "studioFilter" }],
]);
const DETAILS = [
  { pattern: /^\/performers\/([^/]+)/, key: "performer-detail", context: (performerId: string): LaunchContext => ({ source: "performer-detail", performerId }) },
  { pattern: /^\/studios\/([^/]+)/, key: "studio-detail", context: (studioId: string): LaunchContext => ({ source: "studio-detail", studioId }) },
];

function unpaginated(filter: ListContext["filter"]) {
  const { page: _page, per_page: _perPage, ...unpaginatedFilter } = filter.makeFindFilter();
  return unpaginatedFilter;
}

export function createContexts({ life }: { life: Lifetime }) {
  const timers = new Set<number>(), listeners = new Set<() => void>(), signatures = new Map<string, string>();
  const lists = new Map<string, ListContext>(), details = new Map<string, string>();
  life.effects.add(() => { timers.forEach(id => window.clearTimeout(id)); timers.clear(); listeners.clear(); signatures.clear(); });
  function notifyContextChange(key: string, signature: string) {
    if (signatures.get(key) === signature) return;
    signatures.set(key, signature);
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (life.active) listeners.forEach(listener => listener());
    }, 0);
    timers.add(id);
  }
  function getLaunchContextForPath(pathname: string): LaunchContext | null {
    const list = LISTS.get(pathname);
    if (list) {
      const context = lists.get(list.key);
      if (!context) return null;
      const selectedIds = Array.from(context.selectedIds);
      if (selectedIds.length > 0) return { source: list.selection, selectedIds } as LaunchContext;
      return { source: list.filter, filter: unpaginated(context.filter), [list.filterKey]: context.filter.makeFilter() } as LaunchContext;
    }
    for (const detail of DETAILS) {
      const id = pathname.match(detail.pattern)?.[1];
      if (id && id !== "new" && id === details.get(detail.key)) return detail.context(id);
    }
    return null;
  }
  function storeLaunchContext(context: LaunchContext | null) {
    try {
      if (context) window.sessionStorage.setItem(LAUNCH_CONTEXT_STORAGE_KEY, JSON.stringify(context));
      else window.sessionStorage.removeItem(LAUNCH_CONTEXT_STORAGE_KEY);
    } catch {
    }
  }
  function readLaunchContext() {
    try {
      const storedContext = window.sessionStorage.getItem(LAUNCH_CONTEXT_STORAGE_KEY);
      if (!storedContext) return null;
      const parsedContext = JSON.parse(storedContext);
      return isMultiscreenLaunchContext(parsedContext) ? parsedContext : null;
    } catch {
      return null;
    }
  }
  return {
    getLaunchContextForPath, storeLaunchContext, readLaunchContext,
    subscribeToContextChanges(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    captureList(key: string, context: ListContext) {
      lists.set(key, context);
      notifyContextChange(key, JSON.stringify({ filter: unpaginated(context.filter), objectFilter: context.filter.makeFilter(), selectedIds: Array.from(context.selectedIds) }));
    },
    captureDetail(key: string, id: string) {
      details.set(key, id);
      notifyContextChange(key, id);
    },
  };
}
