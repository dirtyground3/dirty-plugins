import { React } from "../runtime";
import { locatePlaylistItem } from "../domain/playlists";
import type { GridProps, Item } from "../types";
import { NativePlayerTile } from "./NativePlayerTile";
import { PaneHeader } from "./SceneSearch";

interface PaneProps
  extends Pick<GridProps, "nativePlayer" | "playback" | "useFindScene" | "continuation" | "searchSession"> {
  playlist: Item[];
  screenIndex: number;
  onSceneChange(index: number, id: string | null): void;
}
export function NativePlayerPane({
  playlist,
  screenIndex,
  continuation,
  onSceneChange,
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
    retry = React.useRef<1 | -1 | Item>(1);
  current.current = state;
  React.useEffect(() => {
    request.current++;
    inserted.current = null;
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
    onSceneChange(screenIndex, item?.scene.id || null);
  }, [onSceneChange, screenIndex, item]);
  const navigate = async (direction: 1 | -1) => {
    const previous = current.current;
    if (previous.busy && direction === retry.current) return;
    const revision = ++request.current;
    retry.current = direction;
    const publish = (next: typeof state) => {
      if (revision !== request.current) return;
      current.current = next;
      setState(next);
    };
    const cursor = previous.cursor + direction;
    if (cursor >= 0 && cursor < previous.items.length) {
      publish({ ...previous, cursor, busy: false, error: "" });
      return;
    }
    if (!continuation || continuation.pageCount <= 1) {
      if (previous.items.length)
        publish({
          ...previous,
          cursor: direction === 1 ? 0 : previous.items.length - 1,
          busy: false,
          error: "",
        });
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
          publish({
            items,
            page,
            cursor: direction === 1 ? 0 : items.length - 1,
            busy: false,
            error: "",
          });
          return;
        }
      }
      publish({ ...previous, busy: false, error: "" });
    } catch (error) {
      publish({ ...previous, busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  const select = async (selected: Item) => {
    const previous = current.current;
    const revision = ++request.current;
    retry.current = selected;
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
    if (!playlist.length) void navigate(1);
  }, [playlist, continuation]);
  return (
    <div className="ms-cell">
      <PaneHeader
        item={item}
        screenIndex={screenIndex}
        searchSession={searchSession}
        onSelect={selected => void select(selected)}
      />
      {item && (
        <NativePlayerTile
          {...player}
          item={item}
          nextItem={() => {
            void navigate(1);
          }}
          previousItem={() => {
            void navigate(-1);
          }}
        />
      )}
      {state.busy && (
        <div className="ms-queue-status" role="status">
          {typeof retry.current === "number" ? "Loading next page…" : "Finding scene in session…"}
        </div>
      )}
      {state.error && (
        <div className="ms-queue-status" role="alert">
          {state.error}{" "}
          <button
            className="btn btn-secondary dirty-ui-button"
            onClick={() => {
              if (typeof retry.current === "number") void navigate(retry.current);
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
