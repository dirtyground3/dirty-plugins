import { isMarkerLaunchContext } from "./domain/context";
import { getSceneStreamUrl, orderSelected } from "./domain/items";
import { DirtyPlugins, PluginApi, queries, React } from "./runtime";
import type {
  LaunchContext,
  Marker,
  NativePlayer,
  QueryResult,
  QueryVariables,
  SavedSession,
  Scene,
  Settings,
} from "./types";
const SESSION_SAVE_MS = 5000;
type ResumeRef = { current: SavedSession | null };
function useItems<T>(
  settings: Settings,
  context: LaunchContext | null,
  enabled: boolean,
  marker: boolean,
  empty: T,
  resume: ResumeRef,
) {
  const [loading, setLoading] = React.useState(false),
    [error, setError] = React.useState<Error | null>(null),
    [result, setResult] = React.useState(empty),
    [sort, setSort] = React.useState<string | undefined>();
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
  const findPerformerItems = React.useCallback(
    async (performerId: string, signal: AbortSignal): Promise<T> => {
      const current = pager.current;
      if (!current || current.revision !== request.current) throw new Error("Playback queue was replaced.");
      const data = await queries.findPerformerItems(current.variables, marker, performerId, signal);
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
      const dealt =
        marker && isMarkerLaunchContext(context)
          ? queries.getMarkerQueryVariables(settings, context)
          : await queries.getSceneQueryVariables(settings, context);
      if (!current()) return;
      if (!dealt) {
        setResult(empty);
        return;
      }
      // A resumed session asks Stash for the sort it was first dealt, including its random seed.
      const savedSort = resume.current?.sort;
      const variables =
        savedSort && dealt.filter.sort ? { ...dealt, filter: { ...dealt.filter, sort: savedSort } } : dealt;
      pager.current = { variables, revision };
      let loadedPage = 1;
      let next = await loadPage(loadedPage);
      // Skip wholly unplayable pages while retaining only one bounded response.
      while (current() && !variables.ids) {
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
        setSort(typeof variables.filter.sort === "string" ? variables.filter.sort : undefined);
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
  return { loading, error, result, refresh, page, sort, loadPage, search, findPerformerItems };
}
export function useSceneQuery(settings: Settings, context: LaunchContext | null, enabled: boolean, resume: ResumeRef) {
  return useItems(settings, context, enabled, false, { count: 0, scenes: [] as Scene[] }, resume);
}
export function useMarkerQuery(settings: Settings, context: LaunchContext | null, enabled: boolean, resume: ResumeRef) {
  return useItems(settings, context, enabled, true, { count: 0, scene_markers: [] as Marker[] }, resume);
}
/** Saves at most once per interval, and before the page goes away, when a timer would never fire. */
export function useSessionSaver(save: () => void) {
  const latest = React.useRef(save);
  latest.current = save;
  const timer = React.useRef<number | null>(null);
  const flush = React.useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    latest.current();
  }, []);
  React.useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);
  return React.useCallback(() => {
    if (timer.current === null) timer.current = window.setTimeout(flush, SESSION_SAVE_MS);
  }, [flush]);
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
