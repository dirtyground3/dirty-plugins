import type * as R from "react";
import { catalogPageCount, findCatalogPerformerItems, searchCatalog } from "../catalog";
import { React } from "../runtime";
import { panCrop, zoomCrop } from "../domain/layout";
import type { Crop, Rectangle } from "../domain/layout";
import { locatePlaylistItem, nextFreeIndex, nextItemAfter } from "../domain/playlists";
import type {
  AbLoop,
  AudioState,
  CatalogChoice,
  CatalogQueue,
  GridProps,
  Item,
  PaneView,
  PictureControls,
  SavedPane,
  SessionSearch,
  SwapControls,
} from "../types";
import { NativePlayerTile } from "./NativePlayerTile";
import { ScreenControls, useScreenDrag } from "./ScreenControls";
import { ScreenMenu } from "./ScreenMenu";
import type { MenuPoint } from "./ScreenMenu";
import { PaneHeader } from "./SceneSearch";

interface PaneProps
  extends Pick<
    GridProps,
    | "nativePlayer"
    | "playback"
    | "loopReset"
    | "useFindScene"
    | "continuation"
    | "editing"
    | "onFinishEditing"
    | "onToggleTvMode"
    | "moveWithoutEditing"
    | "rightClickOptions"
    | "fitVideos"
    | "searchSession"
    | "findPerformerItems"
    | "showPerformerNavigation"
  > {
  playlist: Item[];
  /** The pane's own index: its queue, saved state and player follow it. */
  screenIndex: number;
  /** Where the pane sits in the grid, which is the screen number people see. */
  position: number;
  columnSpan?: number;
  /** Where the screen sits in the window when the videos are fitted or the rows are custom. */
  rectangle?: Rectangle;
  /** Closes the screen in edit mode; absent for the last open screen. */
  onClose?(): void;
  swap: SwapControls;
  swapSource: number | null;
  onAudioChange(index: number, audio: AudioState): void;
  onPositionChange(index: number, seconds: number): void;
  onAbLoopChange(index: number, abLoop: AbLoop | undefined): void;
  onSceneChange(index: number, item: Item | null, page: number, rotation: number, catalog?: CatalogQueue): void;
  onViewChange(index: number, view: PaneView): void;
  /** Items the other panes are playing; absent when duplicates are allowed. */
  playingElsewhere?(screen: number): Set<string>;
  /** Where this pane was in a resumed session. */
  saved?: SavedPane | null;
}
type QueueStep = { direction: 1 | -1 } | { performerId: string } | { pane: SavedPane };
/** Presses that belong to the player's controls or the pane's own buttons never move the screen. */
const PANE_CONTROLS =
  "button, a, input, select, textarea, [role='slider'], .vjs-control-bar, .vjs-menu, .vjs-modal-dialog, .ms-pane-header, .ms-queue-status, .ms-screen-menu";
/** Links and text fields keep the browser's own menu, for opening a scene or pasting a search. */
const BROWSER_MENU = "a, input, select, textarea";
const NOTICE_MS = 1000;
/** A wheel notch of 100 px magnifies a cropped picture by about 16%. */
const ZOOM_PER_PIXEL = 0.0015;
export function NativePlayerPane({
  playlist,
  screenIndex,
  continuation,
  editing,
  fitVideos,
  findPerformerItems,
  moveWithoutEditing,
  rightClickOptions,
  onAbLoopChange,
  onAudioChange,
  onClose,
  onFinishEditing,
  onToggleTvMode,
  onPositionChange,
  onSceneChange,
  onViewChange,
  playback: defaultPlayback,
  loopReset,
  playingElsewhere,
  position,
  columnSpan,
  rectangle,
  saved,
  searchSession,
  showPerformerNavigation,
  swap,
  swapSource,
  ...player
}: PaneProps) {
  // A restoring pane shows no scene until its page is back, so the queue's first scene never starts.
  const restoring = React.useRef(saved && (saved.catalog || continuation) ? saved : null);
  // The saved time applies until the pane leaves the restored item.
  const resumeAt = React.useRef(restoring.current);
  const [state, setState] = React.useState(() => ({
    items: restoring.current ? [] : playlist,
    cursor: 0,
    page: saved?.catalog ? saved.page : continuation?.initialPage || 1,
    catalog: saved?.catalog,
    busy: !!restoring.current,
    error: "",
  }));
  const current = React.useRef(state),
    request = React.useRef(0),
    inserted = React.useRef<{ page: number; item: Item } | null>(null),
    retry = React.useRef<QueueStep>({ direction: 1 }),
    lookup = React.useRef<AbortController | null>(null);
  const [notice, setNotice] = React.useState("");
  const [view, setView] = React.useState<PaneView>(() => saved?.view ?? {});
  const changeView = (next: PaneView) => {
    setView(next);
    onViewChange(screenIndex, next);
  };
  // The screen's own loop choice overrides the Loop scenes setting, until the menu's Loop scenes sets every screen.
  const seenLoopReset = React.useRef(loopReset);
  React.useEffect(() => {
    if (seenLoopReset.current === loopReset) return;
    seenLoopReset.current = loopReset;
    setView(current => (current.loop === undefined ? current : { ...current, loop: undefined }));
  }, [loopReset]);
  const loop = view.loop ?? defaultPlayback.loop;
  const tvMode = defaultPlayback.tvMode && !state.busy && !state.error;
  const playback = React.useMemo(() => ({ ...defaultPlayback, loop, tvMode }), [defaultPlayback, loop, tvMode]);
  // Changes to the grid's shared deal only reset screens that use it.
  const sharedPlaylist = state.catalog ? undefined : playlist;
  const sharedContinuation = state.catalog ? undefined : continuation;
  const catalogCondition = state.catalog?.condition;
  const searchScreen = React.useMemo<SessionSearch>(
    () =>
      catalogCondition
        ? (condition, page, signal) => searchCatalog(condition, page, signal, catalogCondition)
        : searchSession,
    [catalogCondition, searchSession],
  );
  current.current = state;
  React.useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(""), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  React.useEffect(() => {
    request.current++;
    inserted.current = null;
    setNotice("");
    if (!restoring.current && sharedPlaylist) {
      const next = {
        items: sharedPlaylist,
        cursor: 0,
        page: sharedContinuation?.initialPage || 1,
        catalog: undefined,
        busy: false,
        error: "",
      };
      current.current = next;
      setState(next);
    }
    return () => {
      request.current++;
      lookup.current?.abort();
    };
  }, [sharedPlaylist, sharedContinuation]);
  const item = state.items[state.cursor];
  const rotation = item && view.rotation?.itemId === item.id ? view.rotation.turns : 0;
  React.useEffect(() => {
    if (item && item.id !== resumeAt.current?.itemId) resumeAt.current = null;
    onSceneChange(screenIndex, item || null, state.page, rotation, state.catalog);
  }, [onSceneChange, screenIndex, item, state.page, rotation, state.catalog]);
  const navigate = async (direction: 1 | -1) => {
    const previous = current.current;
    if (previous.busy && "direction" in retry.current && direction === retry.current.direction) return;
    const revision = ++request.current;
    lookup.current?.abort();
    retry.current = { direction };
    setNotice("");
    const publish = (next: typeof state) => {
      if (revision !== request.current) return;
      current.current = next;
      setState(next);
    };
    // Going forward skips items another pane is playing; going back never skips.
    const playing = direction === 1 ? playingElsewhere?.(screenIndex) : undefined;
    const firstFree = (items: Item[], from: number) =>
      playing ? nextFreeIndex(items, from, playing) : from >= 0 && from < items.length ? from : -1;
    const startOf = (items: Item[]) => (direction === 1 ? Math.max(0, firstFree(items, 0)) : items.length - 1);
    const cursor = firstFree(previous.items, previous.cursor + direction);
    if (cursor >= 0 && cursor < previous.items.length) {
      publish({ ...previous, cursor, busy: false, error: "" });
      return;
    }
    const catalog = previous.catalog;
    const pageCount = catalog?.pageCount ?? continuation?.pageCount ?? 1;
    if (pageCount <= 1) {
      const count = previous.items.length;
      if (!count) return;
      // When every other item is on another screen, Next still moves on and repeats one.
      const free = direction === 1 ? firstFree(previous.items, 0) : -1;
      const next = free >= 0 && free !== previous.cursor ? free : (previous.cursor + direction + count) % count;
      publish({ ...previous, cursor: next, busy: false, error: "" });
      return;
    }
    publish({ ...previous, busy: true, error: "" });
    try {
      const controller = catalog ? (lookup.current = new AbortController()) : undefined;
      let page = previous.page;
      for (let attempts = 0; attempts < pageCount; attempts++) {
        page = ((page - 1 + direction + pageCount) % pageCount) + 1;
        let items: Item[];
        if (catalog && controller) items = (await searchCatalog(catalog.condition, page, controller.signal)).items;
        else {
          const playlists = (await continuation?.loadPage(page)) ?? [];
          const anchor = inserted.current;
          items =
            (anchor?.page === page ? locatePlaylistItem(playlists, screenIndex, anchor.item)?.items : null) ||
            playlists[screenIndex] ||
            [];
        }
        if (revision !== request.current) return;
        if (items.length) {
          publish({ ...previous, items, page, cursor: startOf(items), busy: false, error: "" });
          return;
        }
      }
      publish({ ...previous, busy: false, error: "" });
    } catch (error) {
      publish({ ...previous, busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  /** One query finds the performer's next scene in this screen's scope. Like search, it may be playing elsewhere. */
  const nextFeaturing = async (performerId: string) => {
    const previous = current.current;
    const revision = ++request.current;
    retry.current = { performerId };
    setNotice("");
    const publish = (next: typeof state) => {
      if (revision !== request.current) return;
      current.current = next;
      setState(next);
    };
    lookup.current?.abort();
    const controller = (lookup.current = new AbortController());
    publish({ ...previous, busy: true, error: "" });
    try {
      const playing = previous.items[previous.cursor];
      const matches = previous.catalog
        ? await findCatalogPerformerItems(previous.catalog.condition, performerId, controller.signal)
        : await findPerformerItems(performerId, playing, controller.signal);
      if (revision !== request.current) return;
      const next = nextItemAfter(matches, playing);
      if (!next) {
        publish({ ...previous, busy: false, error: "" });
        const performer = playing?.scene.performers?.find(performer => performer.id === performerId);
        const name = performer?.name?.trim() || `Performer ${performerId}`;
        setNotice(`No other matching scenes featuring ${name}.`);
        return;
      }
      const cursor = previous.items.findIndex(item => item.id === next.id);
      if (cursor >= 0) {
        publish({ ...previous, cursor, busy: false, error: "" });
        return;
      }
      // Next and Previous keep following this page around the chosen scene.
      const at = previous.cursor + 1;
      publish({
        ...previous,
        items: [...previous.items.slice(0, at), { ...next, outsidePage: true }, ...previous.items.slice(at)],
        cursor: at,
        busy: false,
        error: "",
      });
    } catch (error) {
      publish({ ...previous, busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const restore = async (pane: SavedPane) => {
    const revision = ++request.current;
    const finish = (next: typeof state) => {
      restoring.current = null;
      current.current = next;
      setState(next);
      if (!next.items.length && !next.error) void navigate(1);
    };
    if (pane.catalog) {
      const { condition } = pane.catalog;
      lookup.current?.abort();
      const controller = (lookup.current = new AbortController());
      retry.current = { pane };
      restoring.current = pane;
      setState(value => ({ ...value, busy: true, error: "" }));
      try {
        let result = await searchCatalog(condition, pane.page, controller.signal);
        const pageCount = catalogPageCount(result.count);
        const page = Math.min(pane.page, pageCount);
        if (page !== pane.page) result = await searchCatalog(condition, page, controller.signal);
        if (revision !== request.current) return;
        const found = result.items.findIndex(item => item.id === pane.itemId);
        const items = found < 0 && pane.item ? [pane.item, ...result.items] : result.items;
        finish({ items, cursor: Math.max(0, found), page, catalog: { condition, pageCount }, busy: false, error: "" });
      } catch (error) {
        if (revision !== request.current) return;
        finish({
          items: pane.item ? [pane.item] : [],
          cursor: 0,
          page: pane.page,
          catalog: pane.catalog,
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    const pages = continuation;
    if (!pages) return;
    const start = { items: playlist, cursor: 0, page: pages.initialPage, catalog: undefined, busy: false, error: "" };
    try {
      // A smaller library may no longer reach the saved page.
      const page = Math.min(pane.page, pages.pageCount);
      const playlists = await pages.loadPage(page);
      if (revision !== request.current) return;
      const found = playlists.flat().find(candidate => candidate.id === pane.itemId);
      const position = found && locatePlaylistItem(playlists, screenIndex, found);
      if (found && position) {
        inserted.current = { page, item: found };
        finish({ ...start, ...position, page });
      } else if (pane.item) finish({ ...start, items: [pane.item, ...(playlists[screenIndex] ?? [])], page });
      else if (playlists[screenIndex]?.length) finish({ ...start, items: playlists[screenIndex], page });
      else finish(start);
    } catch {
      if (revision === request.current) finish(start);
    }
  };
  /**
   * A search result plays at once. A new catalog starts on its result page; an ordinary result joins the current queue.
   */
  const select = (selected: Item, choice?: CatalogChoice) => {
    restoring.current = null;
    // A newer choice wins over any page, performer or restore lookup still in flight.
    request.current++;
    lookup.current?.abort();
    setNotice("");
    if (choice) {
      const next = {
        items: choice.result.items,
        cursor: choice.result.items.indexOf(selected),
        page: choice.page,
        catalog: { condition: choice.condition, pageCount: catalogPageCount(choice.result.count) },
        busy: false,
        error: "",
      };
      current.current = next;
      setState(next);
      return;
    }
    const previous = current.current;
    const found = previous.items.findIndex(item => item.id === selected.id);
    const at = Math.min(previous.cursor + 1, previous.items.length);
    const next =
      found >= 0
        ? { ...previous, cursor: found, busy: false, error: "" }
        : {
            ...previous,
            items: [...previous.items.slice(0, at), { ...selected, outsidePage: true }, ...previous.items.slice(at)],
            cursor: at,
            busy: false,
            error: "",
          };
    current.current = next;
    setState(next);
  };
  React.useEffect(() => {
    if (restoring.current) void restore(restoring.current);
    else if (sharedPlaylist && !sharedPlaylist.length) void navigate(1);
  }, [sharedPlaylist, sharedContinuation]);
  // A flip mirrors one video: it leaves with that item and returns with it.
  const flip = item && view.flip?.itemId === item.id ? view.flip : undefined;
  const cellClass =
    "ms-cell" +
    (view.fill ? " ms-fill" : "") +
    (flip?.x ? " ms-flip-x" : "") +
    (flip?.y ? " ms-flip-y" : "") +
    (rotation ? ` ms-rotate-${rotation * 90}` : "") +
    (swapSource === screenIndex ? " ms-swap-source" : "");
  const drag = useScreenDrag(screenIndex, swap);
  const options = useRightClickOptions(screenIndex, rightClickOptions && !!item, editing);
  // Outside edit mode the picture itself drags its screen.
  const dragsScreen = moveWithoutEditing && !editing;
  const pan = useCropPan({
    view,
    item,
    cropped: fitVideos || !!view.fill,
    flip: { x: !!flip?.x, y: !!flip?.y },
    rotation,
    onDraft: setView,
    onCommit: changeView,
  });
  const picture: PictureControls | null = item
    ? {
        fill: !!view.fill,
        fitVideos,
        flipX: !!flip?.x,
        flipY: !!flip?.y,
        loop,
        rotation,
        onRotate: () =>
          changeView({
            ...view,
            rotation: rotation === 3 ? undefined : { itemId: item.id, turns: (rotation + 1) as 1 | 2 | 3 },
          }),
        onFill: fill => changeView({ ...view, fill }),
        onFlip: (x, y) => changeView({ ...view, flip: x || y ? { itemId: item.id, x, y } : undefined }),
        onLoop: value => changeView({ ...view, loop: value }),
        onClose,
      }
    : null;
  const box: R.CSSProperties = rectangle ?? {
    order: position,
    ...(columnSpan ? { gridColumn: `span ${columnSpan}` } : {}),
  };
  return (
    <div
      ref={pan.cell}
      className={cellClass + (pan.active ? " ms-panning" : "")}
      style={pan.style ? { ...box, ...pan.style } : box}
      data-ms-screen={screenIndex}
      onPointerDown={event => {
        if (pan.press(event) || !dragsScreen) return;
        if (!(event.target as Element).closest(PANE_CONTROLS)) drag.press(event);
      }}
      onPointerMove={event => pan.move(event) || (dragsScreen && drag.move(event))}
      onPointerUp={event => pan.release(event) || (dragsScreen && drag.release(event))}
      onPointerCancel={event => pan.cancel(event) || (dragsScreen && drag.cancel(event))}
      onLostPointerCapture={event => pan.cancel(event) || (dragsScreen && drag.cancel(event))}
      onClickCapture={dragsScreen ? drag.click : undefined}
      onMouseDown={pan.mouseDown}
      onContextMenu={options.contextMenu}
    >
      <PaneHeader
        editing={editing}
        item={item}
        screenIndex={position}
        searchSession={searchScreen}
        onSelect={select}
        busy={state.busy}
        showPerformerNavigation={showPerformerNavigation}
        onNavigatePerformer={performerId => {
          const active = current.current;
          if (
            !active.busy &&
            active.items[active.cursor]?.scene.performers?.some(performer => performer.id === performerId)
          )
            void nextFeaturing(performerId);
        }}
      />
      {item && (
        <NativePlayerTile
          {...player}
          playback={playback}
          audio={saved?.audio}
          item={item}
          nextItem={() => {
            // The time limit and a native end event can arrive together for the same video.
            if (current.current.items[current.current.cursor] === item) void navigate(1);
          }}
          onAudioChange={audio => onAudioChange(screenIndex, audio)}
          onPositionChange={seconds => onPositionChange(screenIndex, seconds)}
          onAbLoopChange={abLoop => onAbLoopChange(screenIndex, abLoop)}
          previousItem={() => {
            void navigate(-1);
          }}
          resumeAbLoop={resumeAt.current?.itemId === item.id ? resumeAt.current.abLoop : undefined}
          resumeTime={resumeAt.current?.itemId === item.id ? resumeAt.current.time : undefined}
        />
      )}
      {editing && picture && (
        <ScreenControls
          {...picture}
          paneIndex={screenIndex}
          position={position}
          swap={swap}
          swapSource={swapSource}
          onFinishEditing={onFinishEditing}
        />
      )}
      {options.at && picture && (
        // A new right-click remounts the menu at the new point, like the browser's own.
        <ScreenMenu
          key={`${options.at.x},${options.at.y}`}
          {...picture}
          at={options.at}
          position={position}
          tvMode={defaultPlayback.tvMode}
          onToggleTvMode={onToggleTvMode}
          onDone={options.hide}
        />
      )}
      {state.busy && (
        <div className="ms-queue-status" role="status">
          {restoring.current
            ? "Restoring session…"
            : "performerId" in retry.current
              ? "Finding next scene featuring this performer…"
              : "Loading next page…"}
        </div>
      )}
      {notice && (
        <div className="ms-queue-status" role="status">
          {notice}
        </div>
      )}
      {state.error && (
        <div className="ms-queue-status" role="alert">
          {state.error}{" "}
          <button
            className="btn btn-secondary dirty-ui-button"
            onClick={() => {
              const step = retry.current;
              if ("pane" in step) void restore(step.pane);
              else if ("performerId" in step) void nextFeaturing(step.performerId);
              else void navigate(step.direction);
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * With the setting on, a right-click opens the screen's picture options as a menu at the pointer outside edit mode:
 * a press anywhere else or Escape closes it. In edit mode the controls are already shown, so a right-click only
 * keeps the browser's menu away.
 */
function useRightClickOptions(screenIndex: number, enabled: boolean, editing: boolean) {
  const [at, setAt] = React.useState<MenuPoint | null>(null);
  const cancelClick = React.useRef<() => void>();
  React.useEffect(() => () => cancelClick.current?.(), []);
  React.useEffect(() => setAt(null), [enabled, editing]);
  const shown = !!at;
  React.useEffect(() => {
    if (!shown) return undefined;
    const cell = `[data-ms-screen="${screenIndex}"]`;
    const press = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // Another right-click on this screen moves the menu there instead of closing it.
      if (target?.closest?.(event.button === 2 ? cell : `${cell} .ms-screen-menu`)) return;
      setAt(null);
      // The click that hides them never reaches the picture beneath, so it cannot pause a video.
      if (
        event.button === 0 &&
        event.isPrimary &&
        target?.closest?.("[data-ms-screen]") &&
        !target.closest(PANE_CONTROLS)
      ) {
        cancelClick.current?.();
        cancelClick.current = swallowDismissalClick(event.pointerId);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAt(null);
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("keydown", key);
    };
  }, [shown, screenIndex]);
  return {
    at: enabled && !editing ? at : null,
    hide: () => setAt(null),
    contextMenu(event: R.MouseEvent<HTMLDivElement>) {
      const target = event.target as Element;
      // React also bubbles events from the pane's search dialog, which is rendered in a portal.
      if (!enabled || !event.currentTarget.contains(target) || target.closest?.(BROWSER_MENU)) return;
      event.preventDefault();
      // A right-click on the open menu leaves it where it is.
      if (editing || target.closest?.(".ms-screen-menu")) return;
      const screen = event.currentTarget.getBoundingClientRect();
      setAt({ x: event.clientX - screen.left, y: event.clientY - screen.top });
    },
  };
}

/** Swallow the click from this pointer's release, preserving keyboard activation and other pointers. */
function swallowDismissalClick(pointerId: number) {
  let timer = 0;
  const stop = (event: MouseEvent) => {
    if (event.detail === 0 || ("pointerId" in event && event.pointerId !== pointerId)) return;
    cleanup();
    event.preventDefault();
    event.stopPropagation();
  };
  const release = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    document.removeEventListener("pointerup", release, true);
    document.addEventListener("click", stop, true);
    // A drag may produce no click. Let the guard expire after the release.
    timer = window.setTimeout(cleanup, 0);
  };
  const cancel = (event: PointerEvent) => {
    if (event.pointerId === pointerId) cleanup();
  };
  const cleanup = () => {
    window.clearTimeout(timer);
    document.removeEventListener("pointerup", release, true);
    document.removeEventListener("pointercancel", cancel, true);
    document.removeEventListener("click", stop, true);
    window.removeEventListener("blur", cleanup);
  };
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", cancel, true);
  window.addEventListener("blur", cleanup);
  return cleanup;
}

/**
 * A middle-button drag moves a cropped picture inside its screen and the wheel zooms it around the pointer; a middle
 * click without a drag shows its whole centre again. Each pointer handler returns whether it handled the event, so
 * the screen's own drag gets the rest.
 */
function useCropPan({
  view,
  item,
  cropped,
  flip,
  rotation,
  onDraft,
  onCommit,
}: {
  view: PaneView;
  item: Item | undefined;
  /** Fill or Fit videos covers the screen, so part of the picture may be hidden. */
  cropped: boolean;
  flip: { x: boolean; y: boolean };
  rotation: number;
  onDraft(view: PaneView): void;
  onCommit(view: PaneView): void;
}) {
  const crop = item && view.crop?.itemId === item.id ? view.crop : undefined;
  const press = React.useRef<{
    id: number;
    x: number;
    y: number;
    from: Crop;
    before: PaneView;
    moved: boolean;
  } | null>(null);
  const [active, setActive] = React.useState(false);
  // Wheel events can arrive faster than renders, so each one zooms from the last one's view.
  const latest = React.useRef(view);
  latest.current = view;
  const cell = React.useRef<HTMLDivElement>(null);
  const wheel = React.useRef<(event: WheelEvent) => void>();
  wheel.current = event => {
    const screen = cell.current;
    const video = screen?.querySelector("video");
    if (!screen || !video || !cropped || !item || press.current || event.ctrlKey || !event.deltaY) return;
    if ((event.target as Element | null)?.closest?.(PANE_CONTROLS)) return;
    event.preventDefault();
    const before = latest.current;
    const from = before.crop?.itemId === item.id ? before.crop : { x: 50, y: 50 };
    // Wheels that count lines or pages zoom one notch per event.
    const distance = event.deltaMode === 0 ? event.deltaY : Math.sign(event.deltaY) * 100;
    const bounds = screen.getBoundingClientRect();
    const next = zoomCrop(
      from,
      Math.exp(-distance * ZOOM_PER_PIXEL),
      event.clientX - (bounds.left + bounds.width / 2),
      event.clientY - (bounds.top + bounds.height / 2),
      { width: video.videoWidth, height: video.videoHeight },
      { width: video.clientWidth, height: video.clientHeight },
      flip,
      rotation,
    );
    if (next === from) return;
    latest.current = { ...before, crop: { itemId: item.id, ...next } };
    onCommit(latest.current);
  };
  React.useEffect(() => {
    const screen = cell.current;
    if (!screen) return undefined;
    // React listens to the wheel passively, so only a listener of the screen's own can keep the page still.
    const listener = (event: WheelEvent) => wheel.current?.(event);
    screen.addEventListener("wheel", listener, { passive: false });
    return () => screen.removeEventListener("wheel", listener);
  }, []);
  const zoom = cropped && crop?.zoom ? crop.zoom : 1;
  const target = (event: R.PointerEvent<HTMLDivElement>) => {
    const start = press.current;
    const video = event.currentTarget.querySelector("video");
    if (!start || !item || !video) return undefined;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 4) return undefined;
    start.moved = true;
    const picture = { width: video.videoWidth, height: video.videoHeight };
    const box = { width: video.clientWidth, height: video.clientHeight };
    return { itemId: item.id, ...panCrop(start.from, dx, dy, picture, box, flip, rotation) };
  };
  const end = () => {
    press.current = null;
    setActive(false);
  };
  return {
    cell,
    active,
    /** The crop for the CSS; a zoom magnifies the picture around that point, so it applies only while cropped. */
    style: crop
      ? ({
          "--ms-crop": `${crop.x}% ${crop.y}%`,
          ...(zoom > 1
            ? {
                "--ms-zoom": String(zoom),
                "--ms-zoom-x": `${(crop.x - 50) * (1 - zoom)}%`,
                "--ms-zoom-y": `${(crop.y - 50) * (1 - zoom)}%`,
              }
            : {}),
        } as R.CSSProperties)
      : undefined,
    press(event: R.PointerEvent<HTMLDivElement>) {
      if (event.button !== 1 || event.isPrimary === false || press.current || !cropped || !item) return false;
      if ((event.target as Element).closest(PANE_CONTROLS)) return false;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      press.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        from: crop ?? { x: 50, y: 50 },
        before: view,
        moved: false,
      };
      setActive(true);
      return true;
    },
    move(event: R.PointerEvent<HTMLDivElement>) {
      if (press.current?.id !== event.pointerId) return false;
      const next = target(event);
      if (next) onDraft({ ...view, crop: next });
      return true;
    },
    release(event: R.PointerEvent<HTMLDivElement>) {
      const start = press.current;
      if (start?.id !== event.pointerId) return false;
      const next = target(event);
      end();
      if (!start.moved) {
        if (crop) onCommit({ ...start.before, crop: undefined });
      } else if (next && (next.x !== start.from.x || next.y !== start.from.y)) {
        onCommit({ ...start.before, crop: next });
      } else onDraft(start.before);
      return true;
    },
    cancel(event: R.PointerEvent<HTMLDivElement>) {
      const start = press.current;
      if (start?.id !== event.pointerId) return false;
      end();
      onDraft(start.before);
      return true;
    },
    /** Keeps the browser from starting its middle-button autoscroll over a cropped picture. */
    mouseDown(event: R.MouseEvent<HTMLDivElement>) {
      if (event.button === 1 && cropped && item && !(event.target as Element).closest(PANE_CONTROLS))
        event.preventDefault();
    },
  };
}
