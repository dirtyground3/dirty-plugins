import type * as R from "react";
import { isMarkerLaunchContext } from "../domain/context";
import { getMarkerItem, getSceneItem } from "../domain/items";
import { growPlaylists, pagePlaylists } from "../domain/playlists";
import { useMarkerQuery, useNativePlayerComponent, useSceneQuery } from "../hooks";
import { closedScreens, queueKey, readSession, writeSession } from "../domain/session";
import {
  dealtSettings,
  getPlaybackSettings,
  getSceneLimit,
  GRID_LIMITS,
  growGrid,
  normalizeFitVideos,
  normalizeSnapDividers,
  normalizeRecentGrids,
  normalizeSettings,
  savedGridSettings,
} from "../domain/settings";
import { useRecentGrid } from "../savedGrids";
import { contexts, DirtyPlugins, PluginApi, React } from "../runtime";
import { icon, PluginIconButton, StateView } from "./Controls";
import { VisibleOCounterButton } from "./Counter";
import { NativeMultiscreenGrid } from "./Grid";
import { GridChangeDialog, GridPicker } from "./GridPicker";
import { SavedGridsButton } from "./SavedGrids";
import { ShuffleMenu } from "./ShuffleMenu";
import type { CustomLayout } from "../domain/custom";
import type {
  FindPerformerItems,
  GridSize,
  GridSnapshot,
  LaunchContext,
  SavedGrid,
  SavedGridSummary,
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
/** The most screens a grid holds: added screens take their lanes from a deal this wide. */
const WIDEST_DEAL = GRID_LIMITS.rows * GRID_LIMITS.columns;
/** How close the mouse must come to the main buttons to show them. */
const NEAR_PX = 100;
/**
 * True while the main buttons rest hidden. They show while the mouse is within NEAR_PX of their box and hide
 * `delay` after it leaves that area or the window, and after the player opens. Moving elsewhere never shows them;
 * a touch, which cannot hover, shows them for `delay`. Edit mode keeps them visible without an idle timer.
 */
function useIdle(area: R.RefObject<HTMLElement | null>, delay: number, keepVisible: boolean) {
  const [idle, setIdle] = React.useState(false);
  React.useEffect(() => {
    setIdle(false);
    if (keepVisible) return undefined;
    let timer = 0;
    const show = () => {
      window.clearTimeout(timer);
      timer = 0;
      setIdle(false);
    };
    const hideLater = () => {
      if (!timer) timer = window.setTimeout(() => setIdle(true), delay);
    };
    const near = (x: number, y: number) => {
      const box = area.current?.getBoundingClientRect();
      return (
        !!box &&
        x >= box.left - NEAR_PX &&
        x <= box.right + NEAR_PX &&
        y >= box.top - NEAR_PX &&
        y <= box.bottom + NEAR_PX
      );
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && near(event.clientX, event.clientY)) show();
      else hideLater();
    };
    const tap = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      show();
      hideLater();
    };
    // A pointer leaving the window goes out of the page with nowhere to go.
    const out = (event: PointerEvent) => {
      if (!event.relatedTarget) hideLater();
    };
    hideLater();
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", tap, { passive: true });
    document.addEventListener("pointerout", out);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", tap);
      document.removeEventListener("pointerout", out);
    };
  }, [area, delay, keepVisible]);
  return !keepVisible && idle;
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
  // The top-right buttons stay visible in edit mode and otherwise show while the mouse is near them.
  const floatingRef = React.useRef<HTMLDivElement | null>(null);
  const controlsIdle = useIdle(floatingRef, CONTROLS_IDLE_MS, editing);
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
  // Screens closed in edit mode stay closed through reshuffles; another grid opens them all.
  const [closed, setClosed] = React.useState<number[]>(() => launch.saved?.closed ?? []);
  // Resizing a divider or docking a screen makes a custom grid until a preset is chosen again.
  const [layout, setLayout] = React.useState<CustomLayout | null>(() => launch.saved?.layout ?? null);
  // The grid the queue was dealt for. + grows the grid without dealing again, so the playing screens go on.
  const [dealtGrid, setDealtGrid] = React.useState<GridSize | null>(() => launch.saved?.deal ?? null);
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
        const queue = dealtSettings(playSettings(data, keepsOrder(launch.context)), launch.saved?.deal);
        if (resume.current?.queue !== queueKey(queue)) {
          resume.current = null;
          setDealtGrid(null);
        }
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
  const snapDividers = normalizeSnapDividers(rawSettings);
  // Nothing is saved before the settings say how many autosaves to keep.
  const recentGrids = settingsQuery.loading ? 0 : normalizeRecentGrids(rawSettings);
  // A launch is a new autosave; a resumed session goes on updating its own.
  const recent = useRecentGrid(recentGrids, launch.saved?.recent, id => {
    const stored = replaced.current ? null : readSession();
    if (stored) writeSession({ ...stored, recent: id });
  });
  const settings = React.useMemo(() => playSettings(rawSettings, keepOrder), [rawSettings, keepOrder]);
  // Only a grid grown past its deal plays a queue dealt for fewer screens.
  const deal = dealtGrid && dealtGrid.rows * dealtGrid.columns < settings.totalScreens ? dealtGrid : null;
  const queue = React.useMemo(() => dealtSettings(settings, deal), [settings, deal]);
  const grown = settings.totalScreens > queue.totalScreens;
  const grownRef = React.useRef(grown);
  grownRef.current = grown;
  const playbackSettings = React.useMemo(() => getPlaybackSettings(settings), [settings]);
  const nativePlayerQuery = useNativePlayerComponent();
  const scenesQuery = useSceneQuery(queue, launchContext, !settingsQuery.loading && !markerMode, resume);
  const markersQuery = useMarkerQuery(queue, launchContext, !settingsQuery.loading && markerMode, resume);
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
  const pageSize = getSceneLimit(queue);
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
  const dealtPlaylists = React.useMemo(
    () => pagePlaylists(initialItems, queue.totalScreens, ordering, settings.splitScenes, seed, initialPage),
    [initialItems, queue.totalScreens, ordering, settings.splitScenes, seed, initialPage],
  );
  // Added screens take lanes of the widest deal, so growing again never changes a lane that is playing.
  const playlists = React.useMemo(
    () =>
      grown ? growPlaylists(dealtPlaylists, initialItems, WIDEST_DEAL, ordering, seed, initialPage) : dealtPlaylists,
    [grown, dealtPlaylists, initialItems, ordering, seed, initialPage],
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
              const lanes = pagePlaylists(nextItems, queue.totalScreens, ordering, settings.splitScenes, seed, page);
              return grownRef.current ? growPlaylists(lanes, nextItems, WIDEST_DEAL, ordering, seed, page) : lanes;
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
      queue.totalScreens,
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
    setClosed([]);
    setLayout(null);
    setDealtGrid(null);
    const data = { ...rawSettings, rows, columns };
    setSettingsQuery(current => ({ ...current, data }));
    DirtyPlugins.configurePlugin(PLUGIN_ID, data).catch(() =>
      DirtyPlugins.ui.notify("Could not save the grid. It applies to this session only.", "error"),
    );
  };
  /**
   * + brings back the screen closed last. With none closed it grows the grid by a row or a column and opens one
   * new screen; the queue is not dealt again, so every playing screen goes on.
   */
  const addable = closedScreens(closed, settings.totalScreens);
  const grownGrid = addable.length ? null : growGrid(settings);
  const addScreen = () => {
    if (addable.length) {
      const last = addable[addable.length - 1];
      setClosed(addable.filter(index => index !== last));
      return;
    }
    if (!grownGrid) return;
    const size = grownGrid.rows * grownGrid.columns;
    setDealtGrid(deal ?? { rows: settings.rows, columns: settings.columns });
    setClosed(Array.from({ length: size - settings.totalScreens - 1 }, (_, index) => size - 1 - index));
    const data = { ...rawSettings, ...grownGrid };
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
      session: {
        context: launchContext,
        queue: queueKey(queue),
        sort: activeQuery.sort,
        seed,
        now,
        ...current,
        ...(deal ? { deal } : {}),
      },
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
  const saveSession = (screens: GridSnapshot) => {
    if (replaced.current) return;
    const saved = writeSession({
      context: launchContext,
      queue: queueKey(queue),
      sort: activeQuery.sort,
      seed,
      now,
      ...screens,
      ...(deal ? { deal } : {}),
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
          closed={closed}
          layout={layout}
          onLayoutChange={setLayout}
          editing={editing}
          onFinishEditing={() => setEditing(false)}
          moveWithoutEditing={settings.moveWithoutEditing}
          snapDividers={snapDividers}
          fitVideos={fitVideos}
          totalScreens={settings.totalScreens}
          playlists={playlists}
          searchSession={searchSession}
          findPerformerItems={findPerformerItems}
          showPerformerNavigation={settings.showPerformerNavigation}
          continuation={continuation}
          playback={playbackSettings}
          nativePlayer={nativePlayerQuery.component}
          onCloseScreen={index => setClosed(current => [...current, index])}
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
          custom={!!layout}
          onPick={size => {
            // The same grid returns from custom rows without dealing again.
            if (size.columns !== settings.columns || size.rows !== settings.rows) setPendingGrid(size);
            else setLayout(null);
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
      {/* A column down from the corner, always visible while editing. */}
      <div className={"ms-floating" + (controlsIdle ? " ms-floating-idle" : "")} ref={floatingRef}>
        <PluginIconButton ariaLabel="Close DirtyMultiscreen" fallback="x" icon={icon("close")} onClick={closeRoute} />
        {!error && items.length > 0 && <ShuffleMenu order={settings.sceneOrder} onShuffle={reshuffle} />}
        {!settingsQuery.loading && !settingsQuery.error && (
          <SavedGridsButton capture={docsCapture} keepRecent={recentGrids} snapshot={snapshot} onOpen={openGrid} />
        )}
        {!loading && !error && items.length > 0 && (
          <PluginIconButton
            ariaLabel={editing ? "Finish editing screens" : "Edit screens"}
            fallback="▦"
            icon={icon("edit")}
            pressed={editing}
            onClick={() => setEditing(value => !value)}
          />
        )}
        {!loading && !error && items.length > 0 && (
          <PluginIconButton
            ariaLabel={addable.length || grownGrid ? "Add a screen" : "Add a screen: the grid is at its largest"}
            fallback="+"
            icon={icon("add")}
            disabled={!addable.length && !grownGrid}
            onClick={addScreen}
          />
        )}
        <VisibleOCounterButton sceneIds={visibleNativeSceneIds} />
      </div>
    </div>
  );
}
