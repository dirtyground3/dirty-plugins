import { React } from "../runtime";
import { locatePlaylistItem, nextFreeIndex } from "../domain/playlists";
import type { GridProps, Item } from "../types";
import { NativePlayerTile } from "./NativePlayerTile";
import { PaneHeader } from "./SceneSearch";

interface PaneProps
  extends Pick<GridProps, "nativePlayer" | "playback" | "useFindScene" | "continuation" | "searchSession"> {
  playlist: Item[];
  screenIndex: number;
  onSceneChange(index: number, item: Item | null): void;
  /** Items the other panes are playing; absent when duplicates are allowed. */
  playingElsewhere?(screen: number): Set<string>;
}
interface QueueStep {
  direction: 1 | -1;
  performerId?: string;
}
export function NativePlayerPane({
  playlist,
  screenIndex,
  continuation,
  onSceneChange,
  playingElsewhere,
  searchSession,
  ...player
}: PaneProps) {
  const [state, setState] = React.useState(() => ({
    items: playlist,
    cursor: 0,
    page: continuation?.initialPage || 1,
    busy: false,
    error: "",
  }));
  const current = React.useRef(state),
    request = React.useRef(0),
    inserted = React.useRef<{ page: number; item: Item } | null>(null),
    retry = React.useRef<QueueStep | Item>({ direction: 1 });
  const [notice, setNotice] = React.useState("");
  current.current = state;
  React.useEffect(() => {
    request.current++;
    inserted.current = null;
    setNotice("");
    const next = {
      items: playlist,
      cursor: 0,
      page: continuation?.initialPage || 1,
      busy: false,
      error: "",
    };
    current.current = next;
    setState(next);
    return () => {
      request.current++;
    };
  }, [playlist, continuation]);
  const item = state.items[state.cursor];
  React.useEffect(() => {
    onSceneChange(screenIndex, item || null);
  }, [onSceneChange, screenIndex, item]);
  const navigate = async (step: QueueStep) => {
    const { direction, performerId } = step;
    const previous = current.current;
    if (
      previous.busy &&
      "direction" in retry.current &&
      direction === retry.current.direction &&
      performerId === retry.current.performerId
    )
      return;
    const revision = ++request.current;
    retry.current = step;
    setNotice("");
    const publish = (next: typeof state) => {
      if (revision !== request.current) return;
      current.current = next;
      setState(next);
    };
    // Explicit performer navigation, like search, may choose a scene playing elsewhere.
    const playing = !performerId && direction === 1 ? playingElsewhere?.(screenIndex) : undefined;
    const firstFree = (items: Item[], from: number) => {
      if (!performerId)
        return playing ? nextFreeIndex(items, from, playing) : from >= 0 && from < items.length ? from : -1;
      const sceneId = previous.items[previous.cursor]?.scene.id;
      for (let cursor = from; cursor >= 0 && cursor < items.length; cursor += direction) {
        const candidate = items[cursor];
        if (
          candidate.scene.id !== sceneId &&
          candidate.scene.performers?.some(performer => performer.id === performerId)
        )
          return cursor;
      }
      return -1;
    };
    const startOf = (items: Item[]) => {
      const cursor = firstFree(items, direction === 1 ? 0 : items.length - 1);
      return !performerId && direction === 1 ? Math.max(0, cursor) : cursor;
    };
    const noMatch = () => {
      publish({ ...previous, busy: false, error: "" });
      if (performerId && revision === request.current) {
        const performer = previous.items[previous.cursor]?.scene.performers?.find(
          performer => performer.id === performerId,
        );
        const name = performer?.name?.trim() || `Performer ${performerId}`;
        setNotice(`No other scenes featuring ${name} in this screen's session queue.`);
      }
    };
    const cursor = firstFree(previous.items, previous.cursor + direction);
    if (cursor >= 0 && cursor < previous.items.length) {
      publish({ ...previous, cursor, busy: false, error: "" });
      return;
    }
    if (!continuation || continuation.pageCount <= 1) {
      const cursor = startOf(previous.items);
      if (cursor >= 0 && cursor < previous.items.length)
        publish({
          ...previous,
          cursor,
          busy: false,
          error: "",
        });
      else noMatch();
      return;
    }
    publish({ ...previous, busy: true, error: "" });
    try {
      let page = previous.page;
      for (let attempts = 0; attempts < continuation.pageCount; attempts++) {
        page = ((page - 1 + direction + continuation.pageCount) % continuation.pageCount) + 1;
        const playlists = performerId && page === previous.page ? null : await continuation.loadPage(page);
        if (revision !== request.current) return;
        const anchor = inserted.current;
        const items =
          (playlists === null
            ? previous.items
            : anchor?.page === page
              ? locatePlaylistItem(playlists, screenIndex, anchor.item)?.items
              : null) ||
          playlists?.[screenIndex] ||
          [];
        const cursor = startOf(items);
        if (cursor >= 0 && cursor < items.length) {
          publish({
            items,
            page,
            cursor,
            busy: false,
            error: "",
          });
          return;
        }
      }
      noMatch();
    } catch (error) {
      publish({ ...previous, busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const select = async (selected: Item) => {
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
    if (!playlist.length) void navigate({ direction: 1 });
  }, [playlist, continuation]);
  return (
    <div className="ms-cell">
      <PaneHeader
        item={item}
        screenIndex={screenIndex}
        searchSession={searchSession}
        onSelect={selected => void select(selected)}
        busy={state.busy}
        onNavigatePerformer={performerId => {
          const active = current.current;
          if (
            !active.busy &&
            active.items[active.cursor]?.scene.performers?.some(performer => performer.id === performerId)
          )
            void navigate({ direction: 1, performerId });
        }}
      />
      {item && (
        <NativePlayerTile
          {...player}
          item={item}
          nextItem={() => {
            void navigate({ direction: 1 });
          }}
          previousItem={() => {
            void navigate({ direction: -1 });
          }}
        />
      )}
      {state.busy && (
        <div className="ms-queue-status" role="status">
          {"direction" in retry.current
            ? retry.current.performerId
              ? "Finding next scene featuring this performer…"
              : "Loading next page…"
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
              if ("direction" in retry.current) void navigate(retry.current);
              else void select(retry.current);
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
