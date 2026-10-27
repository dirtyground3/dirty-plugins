import { isMarkerLaunchContext } from "./domain/context";
import { getSceneStreamUrl, orderSelected } from "./domain/items";
import { DirtyPlugins, PluginApi, queries, React } from "./runtime";
import type { LaunchContext, Marker, NativePlayer, QueryResult, QueryVariables, Scene, Settings } from "./types";
function useItems<T>(settings: Settings, context: LaunchContext | null, enabled: boolean, marker: boolean, empty: T) {
  const [loading, setLoading] = React.useState(false),
    [error, setError] = React.useState<Error | null>(null),
    [result, setResult] = React.useState(empty);
  const pager = React.useRef<{ variables: QueryVariables; revision: number } | null>(null);
  const pending = React.useRef(new Map<number, { controller: AbortController; promise: Promise<T> }>());
  const [page, setPage] = React.useState(1);
  const request = React.useRef(0),
    key = JSON.stringify({ settings, context, enabled });
  function rows(data: QueryResult, ids?: string[]): T {
    return (
      marker
        ? {
            count: data.findSceneMarkers.count,
            scene_markers: orderSelected(
              data.findSceneMarkers.scene_markers.filter(item => !!getSceneStreamUrl(item.scene)),
              ids,
            ),
          }
        : {
            count: data.findScenes.count,
            scenes: orderSelected(
              data.findScenes.scenes.filter(item => !!getSceneStreamUrl(item)),
              ids,
            ),
          }
    ) as T;
  }
  const loadPage = React.useCallback(
    (page: number): Promise<T> => {
      const current = pager.current;
      if (!current || current.revision !== request.current)
        return Promise.reject(new Error("Playback queue was replaced."));
      const existing = pending.current.get(page);
      if (existing) return existing.promise;
      const controller = new AbortController();
      const entry = { controller, promise: null as unknown as Promise<T> };
      entry.promise = DirtyPlugins.graphql<QueryResult>(
        marker ? queries.findSceneMarkersQuery : queries.findScenesQuery,
        { ...current.variables, filter: { ...current.variables.filter, page } },
        { signal: controller.signal },
      )
        .then(data => {
          if (current.revision !== request.current) throw new Error("Playback queue was replaced.");
          return rows(data, current.variables.ids);
        })
        .finally(() => {
          if (pending.current.get(page) === entry) pending.current.delete(page);
        });
      pending.current.set(page, entry);
      return entry.promise;
    },
    [key],
  );
  const search = React.useCallback(
    async (text: string, page: number, signal: AbortSignal): Promise<T> => {
      const current = pager.current;
      if (!current || current.revision !== request.current) throw new Error("Playback queue was replaced.");
      const data = await queries.searchSession(current.variables, marker, text, page, signal);
      if (current.revision !== request.current) throw new Error("Playback queue was replaced.");
      return rows(data);
    },
    [key],
  );
  const refresh = React.useCallback(async () => {
    if (!enabled || (marker && !isMarkerLaunchContext(context))) return;
    for (const entry of pending.current.values()) entry.controller.abort();
    pending.current.clear();
    pager.current = null;
    const revision = ++request.current,
      current = () => request.current === revision;
    setLoading(true);
    setError(null);
    try {
      const variables =
        marker && isMarkerLaunchContext(context)
          ? queries.getMarkerQueryVariables(settings, context)
          : await queries.getSceneQueryVariables(settings, context);
      if (!current()) return;
      if (!variables) {
        setResult(empty);
        return;
      }
      pager.current = { variables, revision };
      let loadedPage = 1;
      let next = await loadPage(loadedPage);
      // Skip wholly unplayable pages while retaining only one bounded response.
      while (current() && context && !variables.ids) {
        const value = next as { count: number; scenes?: Scene[]; scene_markers?: Marker[] };
        if (
          (value.scenes || value.scene_markers || []).length ||
          loadedPage * Number(variables.filter.per_page) >= value.count
        )
          break;
        next = await loadPage(++loadedPage);
      }
      if (current()) {
        setResult(next);
        setPage(loadedPage);
      }
    } catch (cause) {
      if (current()) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setResult(empty);
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [key]);
  React.useEffect(() => {
    void refresh();
    return () => {
      request.current++;
      pager.current = null;
      for (const entry of pending.current.values()) entry.controller.abort();
      pending.current.clear();
    };
  }, [refresh]);
  return { loading, error, result, refresh, page, loadPage, search };
}
export function useSceneQuery(settings: Settings, context: LaunchContext | null, enabled: boolean) {
  return useItems(settings, context, enabled, false, { count: 0, scenes: [] as Scene[] });
}
export function useMarkerQuery(settings: Settings, context: LaunchContext | null, enabled: boolean) {
  return useItems(settings, context, enabled, true, { count: 0, scene_markers: [] as Marker[] });
}
export function useNativePlayerComponent() {
  const [loading, setLoading] = React.useState(false),
    [error, setError] = React.useState<Error | null>(null),
    [revision, setRevision] = React.useState(0);
  const [component, setComponent] = React.useState<NativePlayer | null>(
    () => (PluginApi.components.ScenePlayer as NativePlayer | undefined) ?? null,
  );
  React.useEffect(() => {
    let cancelled = false;
    if (!DirtyPlugins.native?.loadComponent || !PluginApi.utils?.StashService?.useFindScene) {
      setError(new Error("This Stash version does not expose the native ScenePlayer plugin API."));
      return;
    }
    if (component) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void DirtyPlugins.native
      .loadComponent("ScenePlayer")
      .then(loaded => {
        if (!cancelled) setComponent(() => loaded as NativePlayer);
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [component, revision]);
  return {
    loading,
    error,
    component,
    refresh() {
      setError(null);
      setRevision(value => value + 1);
    },
  };
}
