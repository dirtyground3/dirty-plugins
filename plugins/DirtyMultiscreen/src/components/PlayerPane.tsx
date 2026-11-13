import type * as R from "react";
import { React } from "../runtime";
import type { Rectangle } from "../domain/layout";
import { locatePlaylistItem, nextFreeIndex, nextItemAfter } from "../domain/playlists";
import type { AudioState, GridProps, Item, PaneView, SavedPane, SwapControls } from "../types";
import { NativePlayerTile } from "./NativePlayerTile";
import { ScreenControls, useScreenDrag } from "./ScreenControls";
import { PaneHeader } from "./SceneSearch";

interface PaneProps
  extends Pick<
    GridProps,
    | "nativePlayer"
    | "playback"
    | "useFindScene"
    | "continuation"
    | "editing"
    | "onFinishEditing"
    | "moveWithoutEditing"
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
  onSceneChange(index: number, item: Item | null, page: number, rotation: number): void;
  onViewChange(index: number, view: PaneView): void;
  /** Items the other panes are playing; absent when duplicates are allowed. */
  playingElsewhere?(screen: number): Set<string>;
  /** Where this pane was in a resumed session. */
  saved?: SavedPane | null;
}
type QueueStep = { direction: 1 | -1 } | { performerId: string };
/** Presses that belong to the player's controls or the pane's own buttons never move the screen. */
const PANE_CONTROLS =
  "button, a, input, select, textarea, [role='slider'], .vjs-control-bar, .vjs-menu, .vjs-modal-dialog, .ms-pane-header, .ms-queue-status";
const NOTICE_MS = 1000;
export function NativePlayerPane({
  playlist,
  screenIndex,
  continuation,
  editing,
  fitVideos,
  findPerformerItems,
  moveWithoutEditing,
  onAudioChange,
  onClose,
  onFinishEditing,
  onPositionChange,
  onSceneChange,
  onViewChange,
  playback: defaultPlayback,
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
  const restoring = React.useRef(saved && continuation ? saved : null);
  // The saved time applies until the pane leaves the restored item.
  const resumeAt = React.useRef(restoring.current);
  const [state, setState] = React.useState(() => ({
    items: restoring.current ? [] : playlist,
    cursor: 0,
    page: continuation?.initialPage || 1,
    busy: !!restoring.current,
    error: "",
  }));
  const current = React.useRef(state),
    request = React.useRef(0),
    inserted = React.useRef<{ page: number; item: Item } | null>(null),
    retry = React.useRef<QueueStep | Item>({ direction: 1 }),
    performerLookup = React.useRef<AbortController | null>(null);
  const [notice, setNotice] = React.useState("");
  const [view, setView] = React.useState<PaneView>(() => saved?.view ?? {});
  const changeView = (next: PaneView) => {
    setView(next);
    onViewChange(screenIndex, next);
  };
  // The screen's own loop choice overrides the Loop scenes setting.
  const loop = view.loop ?? defaultPlayback.loop;
  const playback = React.useMemo(
    () => (loop === defaultPlayback.loop ? defaultPlayback : { ...defaultPlayback, loop }),
    [defaultPlayback, loop],
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
    if (!restoring.current) {
      const next = {
        items: playlist,
        cursor: 0,
        page: continuation?.initialPage || 1,
        busy: false,
        error: "",
      };
      current.current = next;
      setState(next);
    }
    return () => {
      request.current++;
      performerLookup.current?.abort();
    };
  }, [playlist, continuation]);
  const item = state.items[state.cursor];
  const rotation = item && view.rotation?.itemId === item.id ? view.rotation.turns : 0;
  React.useEffect(() => {
    if (item && item.id !== resumeAt.current?.itemId) resumeAt.current = null;
    onSceneChange(screenIndex, item || null, state.page, rotation);
  }, [onSceneChange, screenIndex, item, state.page, rotation]);
  const navigate = async (direction: 1 | -1) => {
    const previous = current.current;
    if (previous.busy && "direction" in retry.current && direction === retry.current.direction) return;
    const revision = ++request.current;
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
    if (!continuation || continuation.pageCount <= 1) {
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
      let page = previous.page;
      for (let attempts = 0; attempts < continuation.pageCount; attempts++) {
        page = ((page - 1 + direction + continuation.pageCount) % continuation.pageCount) + 1;
        const playlists = await continuation.loadPage(page);
        if (revision !== request.current) return;
        const anchor = inserted.current;
        const items =
          (anchor?.page === page ? locatePlaylistItem(playlists, screenIndex, anchor.item)?.items : null) ||
          playlists[screenIndex] ||
          [];
        if (items.length) {
          publish({ items, page, cursor: startOf(items), busy: false, error: "" });
          return;
        }
      }
      publish({ ...previous, busy: false, error: "" });
    } catch (error) {
      publish({ ...previous, busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  /** One query finds the performer's next scene, so no page is scanned. Like search, it may be playing elsewhere. */
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
    performerLookup.current?.abort();
    const lookup = (performerLookup.current = new AbortController());
    publish({ ...previous, busy: true, error: "" });
    try {
      const playing = previous.items[previous.cursor];
      const matches = await findPerformerItems(performerId, playing, lookup.signal);
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
  const restore = async (pane: SavedPane, pages: NonNullable<typeof continuation>) => {
    const revision = ++request.current;
    const finish = (next: typeof state) => {
      restoring.current = null;
      current.current = next;
      setState(next);
      if (!next.items.length) void navigate(1);
    };
    const start = { items: playlist, cursor: 0, page: pages.initialPage, busy: false, error: "" };
    try {
      // A smaller library may no longer reach the saved page.
      const page = Math.min(pane.page, pages.pageCount);
      const playlists = await pages.loadPage(page);
      if (revision !== request.current) return;
      const found = playlists.flat().find(candidate => candidate.id === pane.itemId);
      const position = found && locatePlaylistItem(playlists, screenIndex, found);
      if (found && position) {
        inserted.current = { page, item: found };
        finish({ ...position, page, busy: false, error: "" });
      } else if (pane.item)
        finish({ items: [pane.item, ...(playlists[screenIndex] ?? [])], cursor: 0, page, busy: false, error: "" });
      else if (playlists[screenIndex]?.length)
        finish({ items: playlists[screenIndex], cursor: 0, page, busy: false, error: "" });
      else finish(start);
    } catch {
      if (revision === request.current) finish(start);
    }
  };
  const select = async (selected: Item) => {
    restoring.current = null;
    const previous = current.current;
    const revision = ++request.current;
    retry.current = selected;
    setNotice("");
    const publish = (next: typeof state) => {
      if (revision !== request.current) return;
      current.current = next;
      setState(next);
    };
    const cursor = previous.items.findIndex(item => item.id === selected.id);
    if (cursor >= 0) {
      publish({ ...previous, cursor, busy: false, error: "" });
      return;
    }
    publish({ ...previous, busy: true, error: "" });
    try {
      if (continuation) {
        for (let offset = 0; offset < continuation.pageCount; offset++) {
          const page = ((previous.page - 1 + offset) % continuation.pageCount) + 1;
          const playlists = await continuation.loadPage(page);
          if (revision !== request.current) return;
          const position = locatePlaylistItem(playlists, screenIndex, selected);
          if (!position) continue;
          inserted.current = { page, item: selected };
          publish({ ...position, page, busy: false, error: "" });
          return;
        }
      }
      throw new Error("This scene is no longer available in the session.");
    } catch (error) {
      publish({ ...previous, busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  React.useEffect(() => {
    if (restoring.current && continuation) void restore(restoring.current, continuation);
    else if (!playlist.length) void navigate(1);
  }, [playlist, continuation]);
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
  // Outside edit mode the picture itself drags its screen.
  const pictureDrag =
    moveWithoutEditing && !editing
      ? {
          onPointerDown(event: R.PointerEvent<HTMLDivElement>) {
            if (!(event.target as Element).closest(PANE_CONTROLS)) drag.press(event);
          },
          onPointerMove: drag.move,
          onPointerUp: drag.release,
          onPointerCancel: drag.cancel,
          onLostPointerCapture: drag.cancel,
          onClickCapture: drag.click,
        }
      : {};
  return (
    <div
      className={cellClass}
      style={rectangle ?? { order: position, ...(columnSpan ? { gridColumn: `span ${columnSpan}` } : {}) }}
      data-ms-screen={screenIndex}
      {...pictureDrag}
    >
      <PaneHeader
        item={item}
        screenIndex={position}
        searchSession={searchSession}
        onSelect={selected => void select(selected)}
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
            void navigate(1);
          }}
          onAudioChange={audio => onAudioChange(screenIndex, audio)}
          onPositionChange={seconds => onPositionChange(screenIndex, seconds)}
          previousItem={() => {
            void navigate(-1);
          }}
          resumeTime={resumeAt.current?.itemId === item.id ? resumeAt.current.time : undefined}
        />
      )}
      {editing && item && (
        <ScreenControls
          paneIndex={screenIndex}
          position={position}
          swap={swap}
          swapSource={swapSource}
          fill={!!view.fill}
          fitVideos={fitVideos}
          flipX={!!flip?.x}
          flipY={!!flip?.y}
          loop={loop}
          rotation={rotation}
          onRotate={() =>
            changeView({
              ...view,
              rotation: rotation === 3 ? undefined : { itemId: item.id, turns: (rotation + 1) as 1 | 2 | 3 },
            })
          }
          onFill={fill => changeView({ ...view, fill })}
          onFlip={(x, y) => changeView({ ...view, flip: x || y ? { itemId: item.id, x, y } : undefined })}
          onLoop={value => changeView({ ...view, loop: value })}
          onClose={onClose}
          onFinishEditing={onFinishEditing}
        />
      )}
      {state.busy && (
        <div className="ms-queue-status" role="status">
          {restoring.current
            ? "Restoring session…"
            : "performerId" in retry.current
              ? "Finding next scene featuring this performer…"
              : "direction" in retry.current
                ? "Loading next page…"
                : "Finding scene in session…"}
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
              if ("performerId" in step) void nextFeaturing(step.performerId);
              else if ("direction" in step) void navigate(step.direction);
              else void select(step);
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
