import { isMultiscreenLaunchContext } from "./domain/context";
import type { Dependencies, ListContext, LaunchContext } from "./types";
export function createContexts({ life }: Dependencies) {
  const timers = new Set<number>(); life.effects.add(() => { timers.forEach(id => window.clearTimeout(id)); timers.clear(); contextChangeListeners.clear(); contextSignatures.clear(); });
  const SCENES_ROUTE_PATH = "/scenes", MARKERS_ROUTE_PATH = "/scenes/markers", PERFORMERS_ROUTE_PATH = "/performers", STUDIOS_ROUTE_PATH = "/studios", LAUNCH_CONTEXT_STORAGE_KEY = "multiscreen.launchContext";
  let latestSceneListContext: ListContext | null = null, latestMarkerListContext: ListContext | null = null, latestPerformerListContext: ListContext | null = null, latestStudioListContext: ListContext | null = null;
  let latestPerformerDetailId: string | null = null, latestStudioDetailId: string | null = null;
  const contextChangeListeners = /* @__PURE__ */ new Set<() => void>();
  const contextSignatures = /* @__PURE__ */ new Map<string, string>();
  const subscribeToContextChanges = (listener: () => void) => {
    contextChangeListeners.add(listener);
    return () => {
      contextChangeListeners.delete(listener);
    };
  };
  const notifyContextChange = (key: string, signature: string) => {
    if (contextSignatures.get(key) === signature) return;
    contextSignatures.set(key, signature);
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (life.active) contextChangeListeners.forEach(listener => listener());
    }, 0);
    timers.add(id);
  };
  const getUnpaginatedFindFilter = (filter: ListContext["filter"]) => {
    const { page: _page, per_page: _perPage, ...unpaginatedFilter } = filter.makeFindFilter();
    return unpaginatedFilter;
  };
  const getListContextSignature = (context: ListContext) => {
    return JSON.stringify({
      filter: getUnpaginatedFindFilter(context.filter),
      objectFilter: context.filter.makeFilter(),
      selectedIds: Array.from(context.selectedIds)
    });
  };
  const updateListContext = (key: string, context: ListContext, update: (value: ListContext) => void) => {
    update(context);
    notifyContextChange(key, getListContextSignature(context));
  };
  const updateDetailContext = (key: string, id: string, update: (value: string) => void) => {
    update(id);
    notifyContextChange(key, id);
  };
  const getCurrentSceneLaunchContext: () => LaunchContext | null = () => {
    if (!latestSceneListContext) return null;
    const selectedIds = Array.from(latestSceneListContext.selectedIds);
    if (selectedIds.length > 0) {
      return {
        source: "selection",
        selectedIds
      };
    }
    return {
      source: "filter",
      filter: getUnpaginatedFindFilter(latestSceneListContext.filter),
      sceneFilter: latestSceneListContext.filter.makeFilter()
    };
  };
  const getCurrentMarkerLaunchContext: () => LaunchContext | null = () => {
    if (!latestMarkerListContext) return null;
    const selectedIds = Array.from(latestMarkerListContext.selectedIds);
    if (selectedIds.length > 0) {
      return {
        source: "marker-selection",
        selectedIds
      };
    }
    return {
      source: "marker-filter",
      filter: getUnpaginatedFindFilter(latestMarkerListContext.filter),
      markerFilter: latestMarkerListContext.filter.makeFilter()
    };
  };
  const getCurrentPerformerLaunchContext: () => LaunchContext | null = () => {
    if (!latestPerformerListContext) return null;
    const selectedIds = Array.from(latestPerformerListContext.selectedIds);
    if (selectedIds.length > 0) {
      return {
        source: "performer-selection",
        selectedIds
      };
    }
    return {
      source: "performer-filter",
      filter: getUnpaginatedFindFilter(latestPerformerListContext.filter),
      performerFilter: latestPerformerListContext.filter.makeFilter()
    };
  };
  const getCurrentStudioLaunchContext: () => LaunchContext | null = () => {
    if (!latestStudioListContext) return null;
    const selectedIds = Array.from(latestStudioListContext.selectedIds);
    if (selectedIds.length > 0) {
      return {
        source: "studio-selection",
        selectedIds
      };
    }
    return {
      source: "studio-filter",
      filter: getUnpaginatedFindFilter(latestStudioListContext.filter),
      studioFilter: latestStudioListContext.filter.makeFilter()
    };
  };
  const getLaunchContextForPath = (pathname: string): LaunchContext | null => {
    if (pathname === MARKERS_ROUTE_PATH) {
      return getCurrentMarkerLaunchContext();
    }
    if (pathname === SCENES_ROUTE_PATH) {
      return getCurrentSceneLaunchContext();
    }
    if (pathname === PERFORMERS_ROUTE_PATH) {
      return getCurrentPerformerLaunchContext();
    }
    const performerPathId = pathname.match(/^\/performers\/([^/]+)/)?.[1];
    if (performerPathId && performerPathId !== "new" && performerPathId === latestPerformerDetailId) {
      return {
        source: "performer-detail",
        performerId: performerPathId
      };
    }
    if (pathname === STUDIOS_ROUTE_PATH) {
      return getCurrentStudioLaunchContext();
    }
    const studioPathId = pathname.match(/^\/studios\/([^/]+)/)?.[1];
    if (studioPathId && studioPathId !== "new" && studioPathId === latestStudioDetailId) {
      return {
        source: "studio-detail",
        studioId: studioPathId
      };
    }
    return null;
  };
  const storeLaunchContext = (context: LaunchContext | null) => {
    try {
      if (context) {
        window.sessionStorage.setItem(LAUNCH_CONTEXT_STORAGE_KEY, JSON.stringify(context));
      } else {
        window.sessionStorage.removeItem(LAUNCH_CONTEXT_STORAGE_KEY);
      }
    } catch {
    }
  };
  const readLaunchContext = () => {
    try {
      const storedContext = window.sessionStorage.getItem(LAUNCH_CONTEXT_STORAGE_KEY);
      if (!storedContext) return null;
      const parsedContext = JSON.parse(storedContext);
      return isMultiscreenLaunchContext(parsedContext) ? parsedContext : null;
    } catch {
      return null;
    }
  };
  return { getLaunchContextForPath, storeLaunchContext, readLaunchContext, subscribeToContextChanges, captureList(key: string, context: ListContext) { updateListContext(key, context, value => { if (key === "scene-list") latestSceneListContext = value; if (key === "marker-list") latestMarkerListContext = value; if (key === "performer-list") latestPerformerListContext = value; if (key === "studio-list") latestStudioListContext = value; }); }, captureDetail(key: string, id: string) { updateDetailContext(key, id, value => { if (key === "performer-detail") latestPerformerDetailId = value; else latestStudioDetailId = value; }); } };
}
