import { React } from "../runtime";
import type { GridProps, Item } from "../types";
import { NativePlayerTile } from "./NativePlayerTile";

interface PaneProps extends Pick<GridProps, "nativePlayer" | "playback" | "useFindScene" | "continuation"> {
  playlist: Item[];
  screenIndex: number;
  onSceneChange(index: number, id: string | null): void;
}
export function NativePlayerPane({ playlist, screenIndex, continuation, onSceneChange, ...player }: PaneProps) {
  const [state, setState] = React.useState(() => ({
    items: playlist,
    cursor: 0,
    page: continuation?.initialPage || 1,
    busy: false,
    error: "",
  }));
  const current = React.useRef(state),
    request = React.useRef(0),
    retry = React.useRef<1 | -1>(1);
  current.current = state;
  React.useEffect(() => {
    request.current++;
    const next = { items: playlist, cursor: 0, page: continuation?.initialPage || 1, busy: false, error: "" };
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
        publish({ ...previous, cursor: direction === 1 ? 0 : previous.items.length - 1, busy: false, error: "" });
      return;
    }
    publish({ ...previous, busy: true, error: "" });
    try {
      let page = previous.page;
      for (let attempts = 0; attempts < continuation.pageCount; attempts++) {
        page = ((page - 1 + direction + continuation.pageCount) % continuation.pageCount) + 1;
        const items = (await continuation.loadPage(page))[screenIndex] || [];
        if (revision !== request.current) return;
        if (items.length) {
          publish({ items, page, cursor: direction === 1 ? 0 : items.length - 1, busy: false, error: "" });
          return;
        }
      }
      publish({ ...previous, busy: false, error: "" });
    } catch (error) {
      publish({ ...previous, busy: false, error: error instanceof Error ? error.message : String(error) });
    }
  };
  React.useEffect(() => {
    if (!playlist.length) void navigate(1);
  }, [playlist, continuation]);
  return (
    <div className="ms-cell">
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
          Loading next page…
        </div>
      )}
      {state.error && (
        <div className="ms-queue-status" role="alert">
          {state.error}{" "}
          <button
            className="btn btn-secondary dirty-ui-button"
            onClick={() => {
              void navigate(retry.current);
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
