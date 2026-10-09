import { isMarkerLaunchContext } from "./domain/context";
import { getSceneStreamUrl, orderSelected } from "./domain/items";
import type { ComponentDependencies, Settings, LaunchContext, Scene, Marker, QueryResult, NativePlayer } from "./types";
export function createHooks(deps: ComponentDependencies) {
  const { React, queries, hub, api, life, useOwnedEffect: useEffect } = deps;
  const { useState, useCallback, useRef } = React;
  function useItems<T>(settings: Settings, context: LaunchContext | null, enabled: boolean, marker: boolean, empty: T) {
    const [loading, setLoading] = useState(false), [error, setError] = useState<Error | null>(null), [result, setResult] = useState(empty);
    const request = useRef(0), key = JSON.stringify({ settings, context, enabled });
    const refresh = useCallback(async () => {
      if (!enabled || !life.active || (marker && !isMarkerLaunchContext(context))) return;
      const revision = ++request.current, current = () => life.active && request.current === revision;
      setLoading(true); setError(null);
      try {
        const variables = marker && isMarkerLaunchContext(context) ? queries.getMarkerQueryVariables(settings, context) : await queries.getSceneQueryVariables(settings, context);
        if (!current()) return;
        if (!variables) { setResult(empty); return; }
        const data = await hub.graphql<QueryResult>(marker ? queries.findSceneMarkersQuery : queries.findScenesQuery, variables);
        if (!current()) return;
        const next = marker ? { count: data.findSceneMarkers.count, scene_markers: orderSelected(data.findSceneMarkers.scene_markers.filter(item => !!getSceneStreamUrl(item.scene)), variables.ids) } :
          { count: data.findScenes.count, scenes: orderSelected(data.findScenes.scenes.filter(item => !!getSceneStreamUrl(item)), variables.ids) };
        setResult(next as T);
      } catch (cause) { if (current()) { setError(cause instanceof Error ? cause : new Error(String(cause))); setResult(empty); } }
      finally { if (current()) setLoading(false); }
    }, [key]);
    useEffect(() => { void refresh(); return () => { request.current++; }; }, [refresh]);
    return { loading, error, result, refresh };
  }
  function useSceneQuery(settings: Settings, context: LaunchContext | null, enabled: boolean) { return useItems(settings, context, enabled, false, { count: 0, scenes: [] as Scene[] }); }
  function useMarkerQuery(settings: Settings, context: LaunchContext | null, enabled: boolean) { return useItems(settings, context, enabled, true, { count: 0, scene_markers: [] as Marker[] }); }
  function useNativePlayerComponent() {
    const [loading, setLoading] = useState(false), [error, setError] = useState<Error | null>(null), [revision, setRevision] = useState(0);
    const [component, setComponent] = useState<NativePlayer | null>(() => api.components?.ScenePlayer ?? null);
    useEffect(() => {
      let cancelled = false;
      if (!hub.native?.loadComponent || !api.utils?.StashService?.useFindScene) { setError(new Error("This Stash version does not expose the native ScenePlayer plugin API.")); return; }
      if (component) { setLoading(false); return; }
      setLoading(true); setError(null);
      void hub.native.loadComponent("ScenePlayer").then(loaded => { if (!cancelled) setComponent(() => loaded as NativePlayer); })
        .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause : new Error(String(cause))); })
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    }, [component, revision]);
    return { loading, error, component, refresh() { setError(null); setRevision(value => value + 1); } };
  }
  return { useSceneQuery, useMarkerQuery, useNativePlayerComponent };
}
