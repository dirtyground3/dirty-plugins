import { isMarkerLaunchContext } from "../domain/context";
import { getMarkerItem, getSceneItem } from "../domain/items";
import { pagePlaylists } from "../domain/playlists";
import { useMarkerQuery, useNativePlayerComponent, useSceneQuery } from "../hooks";
import { queueKey, readSession, writeSession } from "../domain/session";
import {
  getPlaybackSettings,
  getSceneLimit,
  normalizeFitVideos,
  normalizeRecentGrids,
  normalizeSettings,
  savedGridSettings,
} from "../domain/settings";
import { useRecentGrid } from "../savedGrids";
import { contexts, DirtyPlugins, PluginApi, React } from "../runtime";
import { icon, PluginIconButton, StateView } from "./Controls";
import { VisibleOCounterButton } from "./Counter";
import { NativeMultiscreenGrid } from "./Grid";
import { GridChangeDialog, GridPicker, type GridSize } from "./GridPicker";
import { SavedGridsButton } from "./SavedGrids";
import { ShuffleMenu } from "./ShuffleMenu";
import type {
  FindPerformerItems,
  GridSnapshot,
  LaunchContext,
  SavedGrid,
  SavedGridSummary,
  SavedPane,
  SavedSession,
  SceneOrder,
  SessionSearch,
} from "../types";
const PLUGIN_ID = "multiscreen";
const closeRoute = () => {
  if (window.history.length > 1) window.history.back();
  else window.location.assign("/scenes");
};
const keepsOrder = (context: LaunchContext | null) => context?.source === "plugin-list" && context.keepOrder;
/** A list launched with keepOrder plays in its own order whatever the Scene order setting says. */
const playSettings = (data: Record<string, unknown>, keepOrder: boolean) =>
  normalizeSettings(keepOrder ? { ...data, sceneOrder: "list" } : data);
const CONTROLS_IDLE_MS = 3000;
/** True once the pointer and keyboard have rested for `delay`; any movement, tap or key wakes it. */
function useIdle(delay: number) {
  const [idle, setIdle] = React.useState(false);
  React.useEffect(() => {
    let timer = 0;
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), delay);
    };
    const events = ["pointermove", "pointerdown", "keydown"];
    wake();
    for (const event of events) window.addEventListener(event, wake, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, wake);
    };
  }, [delay]);
  return idle;
}
/** Opening a saved grid starts the player over, so it reads that grid as the session to resume. */
export function MultiscreenRoute() {
  const [generation, setGeneration] = React.useState(0);
  return <MultiscreenSession key={generation} onRestart={() => setGeneration(value => value + 1)} />;
}
function MultiscreenSession({ onRestart }: { onRestart(): void }) {
  DirtyPlugins.react.usePageTitle("DirtyMultiscreen");
  const snapshotRef = React.useRef<(() => GridSnapshot) | null>(null);
  // Set once a saved grid has replaced this session, whose own last save must not overwrite it.
  const replaced = React.useRef(false);
  const [visibleNativeSceneIds, setVisibleNativeSceneIds] = React.useState<string[]>([]);
  const [editing, setEditing] = React.useState(false);
  // The top-right buttons fade while nothing moves, like a player's controls.
  const controlsIdle = useIdle(CONTROLS_IDLE_MS);
  const [pendingGrid, setPendingGrid] = React.useState<GridSize | null>(null);
  // A launch context means the header button just chose a scope; without one the saved session continues.
  const [launch] = React.useState(() => {
    const context = contexts.readLaunchContext();
    // An empty list never mounts the grid, so it is used once and the saved session stays for the next launch.
    if (context?.source === "plugin-list" && !context.ids.length) contexts.storeLaunchContext(null);
    const saved = context ? null : readSession();
    return { context: context ?? saved?.context ?? null, saved };
  });
  // Choosing another order in the shuffle menu ends a list's own order.
  const [launchContext, setLaunchContext] = React.useState(launch.context);
  const keepOrder = keepsOrder(launchContext);
  const resume = React.useRef<SavedSession | null>(launch.saved);
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
        if (request.current !== revision) return;
        // The scope stays, but seeds and pages only name the same scenes under the same queue settings.
        if (resume.current?.queue !== queueKey(playSettings(data, keepsOrder(launch.context)))) resume.current = null;
        setSettingsQuery({ loading: false, error: null, data });
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
  const fitVideos = normalizeFitVideos(rawSettings);
  // Nothing is saved before the settings say how many autosaves to keep.
  const recentGrids = settingsQuery.loading ? 0 : normalizeRecentGrids(rawSettings);
  // A launch is a new autosave; a resumed session goes on updating its own.
  const recent = useRecentGrid(recentGrids, launch.saved?.recent, id => {
    const stored = replaced.current ? null : readSession();
    if (stored) writeSession({ ...stored, recent: id });
  });
  const settings = React.useMemo(() => playSettings(rawSettings, keepOrder), [rawSettings, keepOrder]);
  const playbackSettings = React.useMemo(() => getPlaybackSettings(settings), [settings]);
  const nativePlayerQuery = useNativePlayerComponent();
  const scenesQuery = useSceneQuery(settings, launchContext, !settingsQuery.loading && !markerMode, resume);
  const markersQuery = useMarkerQuery(settings, launchContext, !settingsQuery.loading && markerMode, resume);
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
  const searchSession = React.useCallback<SessionSearch>(
    async (condition, page, signal) => {
      if (markerMode) {
        const data = await markersQuery.search(condition, page, signal);
        return {
          count: data.count,
          items: data.scene_markers
            .map(marker => getMarkerItem(marker, settings.markerDuration))
            .filter(item => item !== null),
        };
      }
      const data = await scenesQuery.search(condition, page, signal);
      return { count: data.count, items: data.scenes.map(getSceneItem).filter(item => item !== null) };
    },
    [markerMode, markersQuery.search, scenesQuery.search, settings.markerDuration],
  );
  const findPerformerItems = React.useCallback<FindPerformerItems>(
    async (performerId, playing, signal) => {
      if (explicitSelection)
        return items.filter(item => item.scene.performers?.some(performer => performer.id === performerId));
      if (markerMode) {
        const data = await markersQuery.findPerformerItems(performerId, playing, signal);
        return data.scene_markers
          .map(marker => getMarkerItem(marker, settings.markerDuration))
          .filter(item => item !== null);
      }
      const data = await scenesQuery.findPerformerItems(performerId, playing, signal);
      return data.scenes.map(getSceneItem).filter(item => item !== null);
    },
    [
      explicitSelection,
      items,
      markerMode,
      markersQuery.findPerformerItems,
      scenesQuery.findPerformerItems,
      settings.markerDuration,
    ],
  );
  const pageSize = getSceneLimit(settings);
  const [seed, now] = React.useMemo(
    () =>
      resume.current ? [resume.current.seed, resume.current.now] : [Math.floor(Math.random() * 4294967296), Date.now()],
    [items],
  );
  // Split lanes never share a scene, so only unsplit panes avoid duplicates.
  const avoidDuplicates = settings.avoidDuplicates && !settings.splitScenes;
  const ordering = React.useMemo(
    () => ({ order: settings.sceneOrder, spread: settings.spreadScenes, now, distinct: avoidDuplicates }),
    [settings.sceneOrder, settings.spreadScenes, now, avoidDuplicates],
  );
  const initialPage = explicitSelection ? 1 : activeQuery.page;
  const initialItems = React.useMemo(
    () => (explicitSelection ? items.slice(0, pageSize) : items),
    [items, explicitSelection, pageSize],
  );
  const playlists = React.useMemo(
    () => pagePlaylists(initialItems, settings.totalScreens, ordering, settings.splitScenes, seed, initialPage),
    [initialItems, settings.totalScreens, ordering, settings.splitScenes, seed, initialPage],
  );
  // Seeded sorts keep pages disjoint, so every launch continues through its whole scope.
  const pageCount = Math.ceil((explicitSelection ? items.length : activeQuery.result.count) / pageSize);
  const continuation = React.useMemo(
    () =>
      pageCount > 0
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
              return pagePlaylists(nextItems, settings.totalScreens, ordering, settings.splitScenes, seed, page);
            },
          }
        : undefined,
    [
      pageCount,
      initialPage,
      explicitSelection,
      items,
      pageSize,
      markerMode,
      markersQuery.loadPage,
      scenesQuery.loadPage,
      settings.totalScreens,
      ordering,
      settings.splitScenes,
      settings.markerDuration,
      seed,
    ],
  );
  const loading = settingsQuery.loading || activeQuery.loading || nativePlayerQuery.loading;
  const error = settingsQuery.error ?? activeQuery.error ?? nativePlayerQuery.error;
  /** The same order loads a fresh random sample; another order also becomes the saved Scene order. */
  const reshuffle = (order: SceneOrder) => {
    resume.current = null;
    if (order === settings.sceneOrder) {
      void activeQuery.refresh();
      return;
    }
    if (launchContext?.source === "plugin-list" && launchContext.keepOrder)
      setLaunchContext({ ...launchContext, keepOrder: false });
    const data = { ...rawSettings, sceneOrder: order };
    setSettingsQuery(current => ({ ...current, data }));
    DirtyPlugins.configurePlugin(PLUGIN_ID, data).catch(() =>
      DirtyPlugins.ui.notify("Could not save the scene order. It applies to this session only.", "error"),
    );
  };
  /** Another grid becomes the saved grid and deals a new queue for every screen. */
  const changeGrid = ({ columns, rows }: GridSize) => {
    setPendingGrid(null);
    resume.current = null;
    const data = { ...rawSettings, rows, columns };
    setSettingsQuery(current => ({ ...current, data }));
    DirtyPlugins.configurePlugin(PLUGIN_ID, data).catch(() =>
      DirtyPlugins.ui.notify("Could not save the grid. It applies to this session only.", "error"),
    );
  };
  const changeFitVideos = () => {
    const data = { ...rawSettings, fitVideos: !fitVideos };
    setSettingsQuery(current => ({ ...current, data }));
    DirtyPlugins.configurePlugin(PLUGIN_ID, data).catch(() =>
      DirtyPlugins.ui.notify("Could not save the layout. It applies to this session only.", "error"),
    );
  };
  /** The current screens as a saved grid: this session, and the stored settings its queue was dealt under. */
  const snapshot = (): SavedGrid | null => {
    const current = snapshotRef.current?.();
    if (!current) return null;
    return {
      // The stored Scene order, not the order a list imposes: opening the grid must not change that setting.
      settings: savedGridSettings(normalizeSettings(rawSettings), fitVideos),
      session: { context: launchContext, queue: queueKey(settings), sort: activeQuery.sort, seed, now, ...current },
    };
  };
  /**
   * A saved grid's settings become the current ones, so its session resumes under the queue it was dealt from.
   * An autosave goes on being updated; a named grid starts an autosave of its own.
   */
  const openGrid = async (grid: SavedGrid, summary: SavedGridSummary) => {
    recent.update(snapshot());
    const opened = savedGridSettings(
      normalizeSettings({ ...rawSettings, ...grid.settings }),
      grid.settings.fitVideos === undefined ? fitVideos : normalizeFitVideos(grid.settings),
    );
    await DirtyPlugins.configurePlugin(PLUGIN_ID, { ...rawSettings, ...opened });
    replaced.current = true;
    if (!writeSession({ ...grid.session, recent: summary.recent ? summary.id : undefined })) {
      replaced.current = false;
      throw new Error("This browser could not store the grid to open it.");
    }
    contexts.storeLaunchContext(null);
    onRestart();
  };
  const saveSession = (panes: Array<SavedPane | null>, order: number[]) => {
    if (replaced.current) return;
    const saved = writeSession({
      context: launchContext,
      queue: queueKey(settings),
      sort: activeQuery.sort,
      seed,
      now,
      panes,
      order,
      recent: recent.id(),
    });
    // The launch has become this session, so a reload resumes it instead of dealing a new one.
    if (saved) contexts.storeLaunchContext(null);
    recent.update(snapshot());
  };
  const itemType = markerMode ? "markers" : "scenes";
  const emptyList =
    launchContext?.source === "plugin-list" && !launchContext.ids.length
      ? `No ${itemType}${launchContext.label ? " in " + launchContext.label : ""}`
      : "";
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
      {!loading && !error && emptyList && <StateView title={emptyList} />}
      {!loading && !error && !emptyList && items.length === 0 && (
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
          avoidDuplicates={avoidDuplicates}
          editing={editing}
          fitVideos={fitVideos}
          totalScreens={settings.totalScreens}
          playlists={playlists}
          searchSession={searchSession}
          findPerformerItems={findPerformerItems}
          showPerformerNavigation={settings.showPerformerNavigation}
          continuation={continuation}
          playback={playbackSettings}
          nativePlayer={nativePlayerQuery.component}
          onSessionChange={saveSession}
          onVisibleSceneIdsChange={setVisibleNativeSceneIds}
          savedPanes={resume.current?.panes}
          savedOrder={resume.current?.order}
          snapshotRef={snapshotRef}
          useFindScene={PluginApi.utils!.StashService!.useFindScene}
        />
      )}
      {editing && !loading && !error && items.length > 0 && (
        <GridPicker
          fitVideos={fitVideos}
          onToggleFit={changeFitVideos}
          columns={settings.columns}
          rows={settings.rows}
          onPick={size => {
            if (size.columns !== settings.columns || size.rows !== settings.rows) setPendingGrid(size);
          }}
        />
      )}
      {pendingGrid && (
        <GridChangeDialog
          size={pendingGrid}
          onCancel={() => setPendingGrid(null)}
          onConfirm={() => changeGrid(pendingGrid)}
        />
      )}
      <div className={"ms-floating" + (controlsIdle && !editing ? " ms-floating-idle" : "")}>
        <VisibleOCounterButton sceneIds={visibleNativeSceneIds} />
        {!loading && !error && items.length > 0 && (
          <PluginIconButton
            ariaLabel={editing ? "Finish editing screens" : "Edit screens"}
            fallback="▦"
            icon={icon("edit")}
            pressed={editing}
            onClick={() => setEditing(value => !value)}
          />
        )}
        {!settingsQuery.loading && !settingsQuery.error && (
          <SavedGridsButton capture={docsCapture} keepRecent={recentGrids} snapshot={snapshot} onOpen={openGrid} />
        )}
        {!error && items.length > 0 && <ShuffleMenu order={settings.sceneOrder} onShuffle={reshuffle} />}
        <PluginIconButton ariaLabel="Close DirtyMultiscreen" fallback="x" icon={icon("close")} onClick={closeRoute} />
      </div>
    </div>
  );
}
