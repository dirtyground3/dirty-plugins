import { getSceneItem, getMarkerItem } from "../domain/items";
import { createMultiscreenPlaylists } from "../domain/playlists";
import { isMarkerLaunchContext } from "../domain/context";
import type { ComponentDependencies } from "../types";
export function createRoute(deps: ComponentDependencies) {
  const { api: PluginApi, hub: DirtyPlugins, contexts, settingsDomain, React, useOwnedEffect: useEffect } = deps;
  const { useState, useRef, useCallback, useMemo } = React;
  const { PluginIconButton, StateView, ICONS } = deps.controls;
  const { getPlaybackSettings, normalizeSettings } = settingsDomain;
  const closeRoute = () => { if (window.history.length > 1) window.history.back(); else window.location.assign("/scenes"); };
  const PLUGIN_ID = "multiscreen", readLaunchContext = contexts.readLaunchContext;
  const NativeMultiscreenGrid = deps.Grid!, VisibleOCounterButton = deps.Counter!;
  const { useSceneQuery, useMarkerQuery, useNativePlayerComponent } = deps.hooks!;
  function MultiscreenRoute() {
    const active = deps.useActive();
    DirtyPlugins.react.usePageTitle("DirtyMultiscreen");
    const [visibleNativeSceneIds, setVisibleNativeSceneIds] = useState<string[]>([]);
    const launchContext = useMemo(() => readLaunchContext(), []);
    const markerMode = isMarkerLaunchContext(launchContext);
    const [settingsQuery, setSettingsQuery] = useState<{ loading: boolean; error: Error | null; data: Record<string, unknown> }>({ loading: true, error: null, data: {} });
    const request = useRef(0);
    useEffect(() => () => { request.current++; }, []);
    const reloadSettings = useCallback(() => {
      if (!deps.life.active) return Promise.resolve();
      const revision = ++request.current;
      setSettingsQuery((current) => ({ ...current, loading: true, error: null }));
      return DirtyPlugins.getPluginSettings(PLUGIN_ID).then((data) => {
        if (deps.life.active && request.current === revision) setSettingsQuery({ loading: false, error: null, data });
      }).catch((error) => {
        if (deps.life.active && request.current === revision) setSettingsQuery({ loading: false, error: error instanceof Error ? error : new Error(String(error)), data: {} });
      });
    }, []);
    useEffect(() => { void reloadSettings(); }, [reloadSettings]);
    const rawSettings = settingsQuery.data;
    const settings = useMemo(() => normalizeSettings(rawSettings), [rawSettings]);
    const playbackSettings = useMemo(() => getPlaybackSettings(settings), [settings]);
    const nativePlayerQuery = useNativePlayerComponent();
    const scenesQuery = useSceneQuery(
      settings,
      launchContext,
      !settingsQuery.loading && !markerMode
    );
    const markersQuery = useMarkerQuery(
      settings,
      launchContext,
      !settingsQuery.loading && markerMode
    );
    const sceneItems = useMemo(
      () => scenesQuery.result.scenes.map(getSceneItem).filter((item) => item !== null),
      [scenesQuery.result.scenes]
    );
    const markerItems = useMemo(
      () => markersQuery.result.scene_markers.map((marker) => getMarkerItem(marker, settings.markerDuration)).filter((item) => item !== null),
      [markersQuery.result.scene_markers, settings.markerDuration]
    );
    const items = markerMode ? markerItems : sceneItems;
    const playlists = useMemo(
      () => createMultiscreenPlaylists(
        items,
        settings.totalScreens,
        settings.randomize,
        settings.splitScenes
      ),
      [items, settings.randomize, settings.splitScenes, settings.totalScreens]
    );
    const activeQuery = markerMode ? markersQuery : scenesQuery;
    const loading = settingsQuery.loading || activeQuery.loading || nativePlayerQuery.loading;
    const error = settingsQuery.error ?? activeQuery.error ?? nativePlayerQuery.error;
    const itemType = markerMode ? "markers" : "scenes";
    const docsCapture = DirtyPlugins.captureEnabled ? DirtyPlugins.captureEnabled(window.location.search) : new URLSearchParams(window.location.search).get("docsCapture") === "1";
    const retryAll = () => {
      void reloadSettings();
      void activeQuery.refresh();
      nativePlayerQuery.refresh();
    };
    if (!active) return null;
    return (<div className={`ms-route${docsCapture ? " ms-docs-capture" : ""}`}>
      {loading && (<StateView title={`Loading ${itemType}`} />)}
      {!loading && error && (<StateView
        title="Could not load DirtyMultiscreen"
        detail={error.message}
        onRetry={retryAll}
      />)}
      {!loading && !error && items.length === 0 && (<StateView
        title={`No playable ${itemType} found`}
        detail={markerMode ? "Add markers to scenes with streamable video files, then reload this plugin page." : "Add scenes with streamable video files, then reload this plugin page."}
        onRetry={activeQuery.refresh}
      />)}
      {!loading && !error && items.length > 0 && nativePlayerQuery.component && (<NativeMultiscreenGrid
        rows={settings.rows}
        columns={settings.columns}
        totalScreens={settings.totalScreens}
        playlists={playlists}
        playback={playbackSettings}
        nativePlayer={nativePlayerQuery.component}
        onVisibleSceneIdsChange={setVisibleNativeSceneIds}
        useFindScene={PluginApi.utils!.StashService!.useFindScene}
      />)}
      <div className="ms-floating">
        <VisibleOCounterButton sceneIds={visibleNativeSceneIds} />
        <PluginIconButton
          ariaLabel="Close DirtyMultiscreen"
          fallback="x"
          icon={ICONS.close}
          onClick={closeRoute}
        />
      </div>
    </div>);
  }
  return MultiscreenRoute;
}
