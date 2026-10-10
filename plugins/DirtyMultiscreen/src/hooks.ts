import { isMarkerLaunchContext } from "./domain/context";
import { getSceneStreamUrl, orderSelected } from "./domain/items";
import { DirtyPlugins, PluginApi, queries, React } from "./runtime";
import type { LaunchContext, Marker, NativePlayer, QueryResult, Scene, Settings } from "./types";
function useItems<T>(settings: Settings, context: LaunchContext | null, enabled: boolean, marker: boolean, empty: T) {
  const [loading, setLoading] = React.useState(false),
    [error, setError] = React.useState<Error | null>(null),
    [result, setResult] = React.useState(empty);
  const request = React.useRef(0),
    key = JSON.stringify({ settings, context, enabled });
  const refresh = React.useCallback(async () => {
    if (!enabled || (marker && !isMarkerLaunchContext(context))) return;
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
      const data = await DirtyPlugins.graphql<QueryResult>(
        marker ? queries.findSceneMarkersQuery : queries.findScenesQuery,
        variables,
      );
      if (!current()) return;
      const next = marker
        ? {
            count: data.findSceneMarkers.count,
            scene_markers: orderSelected(
              data.findSceneMarkers.scene_markers.filter(item => !!getSceneStreamUrl(item.scene)),
              variables.ids,
            ),
          }
        : {
            count: data.findScenes.count,
            scenes: orderSelected(
              data.findScenes.scenes.filter(item => !!getSceneStreamUrl(item)),
              variables.ids,
            ),
          };
      setResult(next as T);
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
    };
  }, [refresh]);
  return { loading, error, result, refresh };
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
