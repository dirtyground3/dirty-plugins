import { isMarkerLaunchContext } from "../domain/context";
import { getMarkerItem, getSceneItem } from "../domain/items";
import { pagePlaylists } from "../domain/playlists";
import { useMarkerQuery, useNativePlayerComponent, useSceneQuery } from "../hooks";
import { getPlaybackSettings, getSceneLimit, normalizeSettings } from "../domain/settings";
import { contexts, DirtyPlugins, PluginApi, React } from "../runtime";
import { icon, PluginIconButton, StateView } from "./Controls";
import { VisibleOCounterButton } from "./Counter";
import { NativeMultiscreenGrid } from "./Grid";
const PLUGIN_ID = "multiscreen";
const closeRoute = () => {
  if (window.history.length > 1) window.history.back();
  else window.location.assign("/scenes");
};
export function MultiscreenRoute() {
  DirtyPlugins.react.usePageTitle("DirtyMultiscreen");
  const [visibleNativeSceneIds, setVisibleNativeSceneIds] = React.useState<string[]>([]);
  const launchContext = React.useMemo(() => contexts.readLaunchContext(), []);
  const markerMode = isMarkerLaunchContext(launchContext);
  const [settingsQuery, setSettingsQuery] = React.useState<{
    loading: boolean;
    error: Error | null;
    data: Record<string, unknown>;
  }>({ loading: true, error: null, data: {} });
  const request = React.useRef(0);
  React.useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const reloadSettings = React.useCallback(() => {
    const revision = ++request.current;
    setSettingsQuery(current => ({ ...current, loading: true, error: null }));
    return DirtyPlugins.getPluginSettings(PLUGIN_ID)
      .then(data => {
        if (request.current === revision) setSettingsQuery({ loading: false, error: null, data });
      })
      .catch(error => {
        if (request.current === revision)
          setSettingsQuery({
            loading: false,
            error: error instanceof Error ? error : new Error(String(error)),
            data: {},
          });
      });
  }, []);
  React.useEffect(() => {
    void reloadSettings();
  }, [reloadSettings]);
  const rawSettings = settingsQuery.data;
  const settings = React.useMemo(() => normalizeSettings(rawSettings), [rawSettings]);
  const playbackSettings = React.useMemo(() => getPlaybackSettings(settings), [settings]);
  const nativePlayerQuery = useNativePlayerComponent();
  const scenesQuery = useSceneQuery(settings, launchContext, !settingsQuery.loading && !markerMode);
  const markersQuery = useMarkerQuery(settings, launchContext, !settingsQuery.loading && markerMode);
  const sceneItems = React.useMemo(
    () => scenesQuery.result.scenes.map(getSceneItem).filter(item => item !== null),
    [scenesQuery.result.scenes],
  );
  const markerItems = React.useMemo(
    () =>
      markersQuery.result.scene_markers
        .map(marker => getMarkerItem(marker, settings.markerDuration))
        .filter(item => item !== null),
    [markersQuery.result.scene_markers, settings.markerDuration],
  );
  const items = markerMode ? markerItems : sceneItems;
  const activeQuery = markerMode ? markersQuery : scenesQuery;
  const explicitSelection = launchContext?.source === "selection" || launchContext?.source === "marker-selection";
  const pageSize = getSceneLimit(settings);
  const seed = React.useMemo(() => Math.floor(Math.random() * 4294967296), [items]);
  const initialPage = explicitSelection ? 1 : activeQuery.page;
  const initialItems = React.useMemo(
    () => (explicitSelection ? items.slice(0, pageSize) : items),
    [items, explicitSelection, pageSize],
  );
  const playlists = React.useMemo(
    () =>
      pagePlaylists(initialItems, settings.totalScreens, settings.randomize, settings.splitScenes, seed, initialPage),
    [initialItems, settings.totalScreens, settings.randomize, settings.splitScenes, seed, initialPage],
  );
  const pageCount = Math.ceil((explicitSelection ? items.length : activeQuery.result.count) / pageSize);
  const continuation = React.useMemo(
    () =>
      launchContext && pageCount > 1
        ? {
            initialPage,
            pageCount,
            loadPage: async (page: number) => {
              let nextItems;
              if (explicitSelection) nextItems = items.slice((page - 1) * pageSize, page * pageSize);
              else if (page === initialPage) nextItems = items;
              else if (markerMode) {
                const data = await markersQuery.loadPage(page);
                nextItems = data.scene_markers
                  .map(marker => getMarkerItem(marker, settings.markerDuration))
                  .filter(item => item !== null);
              } else {
                const data = await scenesQuery.loadPage(page);
                nextItems = data.scenes.map(getSceneItem).filter(item => item !== null);
              }
              return pagePlaylists(
                nextItems,
                settings.totalScreens,
                settings.randomize,
                settings.splitScenes,
                seed,
                page,
              );
            },
          }
        : undefined,
    [
      launchContext,
      pageCount,
      initialPage,
      explicitSelection,
      items,
      pageSize,
      markerMode,
      markersQuery.loadPage,
      scenesQuery.loadPage,
      settings.totalScreens,
      settings.randomize,
      settings.splitScenes,
      settings.markerDuration,
      seed,
    ],
  );
  const loading = settingsQuery.loading || activeQuery.loading || nativePlayerQuery.loading;
  const error = settingsQuery.error ?? activeQuery.error ?? nativePlayerQuery.error;
  const itemType = markerMode ? "markers" : "scenes";
  const docsCapture = DirtyPlugins.captureEnabled(window.location.search);
  const retryAll = () => {
    void reloadSettings();
    void activeQuery.refresh();
    nativePlayerQuery.refresh();
  };
  return (
    <div className={`ms-route${docsCapture ? " ms-docs-capture" : ""}`}>
      {loading && <StateView title={`Loading ${itemType}`} />}
      {!loading && error && (
        <StateView title="Could not load DirtyMultiscreen" detail={error.message} onRetry={retryAll} />
      )}
      {!loading && !error && items.length === 0 && (
        <StateView
          title={`No playable ${itemType} found`}
          detail={
            markerMode
              ? "Add markers to scenes with streamable video files, then reload this plugin page."
              : "Add scenes with streamable video files, then reload this plugin page."
          }
          onRetry={activeQuery.refresh}
        />
      )}
      {!loading && !error && items.length > 0 && nativePlayerQuery.component && (
        <NativeMultiscreenGrid
          rows={settings.rows}
          columns={settings.columns}
          totalScreens={settings.totalScreens}
          playlists={playlists}
          continuation={continuation}
          playback={playbackSettings}
          nativePlayer={nativePlayerQuery.component}
          onVisibleSceneIdsChange={setVisibleNativeSceneIds}
          useFindScene={PluginApi.utils!.StashService!.useFindScene}
        />
      )}
      <div className="ms-floating">
        <VisibleOCounterButton sceneIds={visibleNativeSceneIds} />
        <PluginIconButton ariaLabel="Close DirtyMultiscreen" fallback="x" icon={icon("close")} onClick={closeRoute} />
      </div>
    </div>
  );
}
