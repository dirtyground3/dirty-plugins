import type * as R from "react";
import { isMarkerLaunchContext } from "./domain/context";
import { getSceneStreamUrl, orderSelected } from "./domain/items";
import { DirtyPlugins, PluginApi, queries, React } from "./runtime";
import type {
  Item,
  LaunchContext,
  Marker,
  NativePlayer,
  QueryResult,
  QueryVariables,
  SavedSession,
  Scene,
  SearchCondition,
  Settings,
} from "./types";
const SESSION_SAVE_MS = 5000;
type ResumeRef = { current: SavedSession | null };
function useItems<T>(
  settings: Settings,
  context: LaunchContext | null,
  enabled: boolean,
  marker: boolean,
  empty: T,
  resume: ResumeRef,
) {
  const [loading, setLoading] = React.useState(false),
    [error, setError] = React.useState<Error | null>(null),
    [result, setResult] = React.useState(empty),
    [sort, setSort] = React.useState<string | undefined>();
  const pager = React.useRef<{ variables: QueryVariables; revision: number } | null>(null);
  const pending = React.useRef(new Map<number, { controller: AbortController; promise: Promise<T> }>());
  const [page, setPage] = React.useState(1);
  const request = React.useRef(0);
  // An announced list can hold 100,000 IDs, so this is not serialized on every render.
  const key = React.useMemo(() => JSON.stringify({ settings, context, enabled }), [settings, context, enabled]);
  /** Playable rows in the order of `ids`; `count` replaces the response's for a page of an ID list. */
  function rows(data: QueryResult, ids?: string[], count?: number): T {
    return (
      marker
        ? {
            count: count ?? data.findSceneMarkers.count,
            scene_markers: orderSelected(
              data.findSceneMarkers.scene_markers.filter(item => !!getSceneStreamUrl(item.scene)),
              ids,
            ),
          }
        : {
            count: count ?? data.findScenes.count,
            scenes: orderSelected(
              data.findScenes.scenes.filter(item => !!getSceneStreamUrl(item)),
              ids,
            ),
          }
    ) as T;
  }
  const loadPage = React.useCallback(
    (page: number): Promise<T> => {
      const current = pager.current;
      if (!current || current.revision !== request.current)
        return Promise.reject(new Error("Playback queue was replaced."));
      const existing = pending.current.get(page);
      if (existing) return existing.promise;
      const controller = new AbortController();
      const entry = { controller, promise: null as unknown as Promise<T> };
      const { list } = current.variables,
        size = Number(current.variables.filter.per_page);
      const batch = list?.slice((page - 1) * size, page * size);
      entry.promise = (
        batch
          ? queries.findListed(marker, batch, controller.signal)
          : DirtyPlugins.graphql<QueryResult>(
              marker ? queries.findSceneMarkersQuery : queries.findScenesQuery,
              { ...current.variables, filter: { ...current.variables.filter, page } },
              { signal: controller.signal },
            )
      )
        .then(data => {
          if (current.revision !== request.current) throw new Error("Playback queue was replaced.");
          return rows(data, batch ?? current.variables.ids, list?.length);
        })
        .finally(() => {
          if (pending.current.get(page) === entry) pending.current.delete(page);
        });
      pending.current.set(page, entry);
      return entry.promise;
    },
    [key],
  );
  const search = React.useCallback(
    async (condition: SearchCondition, page: number, signal: AbortSignal): Promise<T> => {
      const current = pager.current;
      if (!current || current.revision !== request.current) throw new Error("Playback queue was replaced.");
      const data = await queries.searchSession(current.variables, marker, condition, page, signal);
      if (current.revision !== request.current) throw new Error("Playback queue was replaced.");
      return rows(data);
    },
    [key],
  );
  const findPerformerItems = React.useCallback(
    async (performerId: string, playing: Item | undefined, signal: AbortSignal): Promise<T> => {
      const current = pager.current;
      if (!current || current.revision !== request.current) throw new Error("Playback queue was replaced.");
      const data = await queries.findPerformerItems(current.variables, marker, performerId, signal, playing);
      if (current.revision !== request.current) throw new Error("Playback queue was replaced.");
      return rows(data);
    },
    [key],
  );
  const refresh = React.useCallback(async () => {
    if (!enabled || (marker && !isMarkerLaunchContext(context))) return;
    for (const entry of pending.current.values()) entry.controller.abort();
    pending.current.clear();
    pager.current = null;
    const revision = ++request.current,
      current = () => request.current === revision;
    setLoading(true);
    setError(null);
    try {
      const dealt =
        marker && isMarkerLaunchContext(context)
          ? queries.getMarkerQueryVariables(settings, context)
          : await queries.getSceneQueryVariables(settings, context);
      if (!current()) return;
      if (!dealt) {
        setResult(empty);
        return;
      }
      // A resumed session asks Stash for the sort it was first dealt, including its random seed.
      const savedSort = resume.current?.sort;
      const variables =
        savedSort && dealt.filter.sort ? { ...dealt, filter: { ...dealt.filter, sort: savedSort } } : dealt;
      pager.current = { variables, revision };
      let loadedPage = 1;
      let next = await loadPage(loadedPage);
      // Skip wholly unplayable pages while retaining only one bounded response.
      while (current() && !variables.ids) {
        const value = next as { count: number; scenes?: Scene[]; scene_markers?: Marker[] };
        if (
          (value.scenes || value.scene_markers || []).length ||
          loadedPage * Number(variables.filter.per_page) >= value.count
        )
          break;
        next = await loadPage(++loadedPage);
      }
      if (current()) {
        setResult(next);
        setPage(loadedPage);
        setSort(typeof variables.filter.sort === "string" ? variables.filter.sort : undefined);
      }
    } catch (cause) {
      if (current()) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        setResult(empty);
      }
    } finally {
      if (current()) setLoading(false);
    }
  }, [key]);
  React.useEffect(() => {
    void refresh();
    return () => {
      request.current++;
      pager.current = null;
      for (const entry of pending.current.values()) entry.controller.abort();
      pending.current.clear();
    };
  }, [refresh]);
  return { loading, error, result, refresh, page, sort, loadPage, search, findPerformerItems };
}
export function useSceneQuery(settings: Settings, context: LaunchContext | null, enabled: boolean, resume: ResumeRef) {
  return useItems(settings, context, enabled, false, { count: 0, scenes: [] as Scene[] }, resume);
}
export function useMarkerQuery(settings: Settings, context: LaunchContext | null, enabled: boolean, resume: ResumeRef) {
  return useItems(settings, context, enabled, true, { count: 0, scene_markers: [] as Marker[] }, resume);
}
/** How long buttons that show near the mouse stay after it leaves. */
export const CONTROLS_IDLE_MS = 3000;
/** How close the mouse must come to such buttons to show them. */
const NEAR_PX = 100;
/**
 * True while a group of buttons rests hidden: the main buttons, or a screen's header groups. They show while the mouse
 * is within NEAR_PX of their box and hide `delay` after it leaves that area or the window, and after the player
 * opens. Moving elsewhere never shows them; a touch, which cannot hover, shows them for `delay`. Edit mode keeps
 * them visible without an idle timer.
 */
export function useIdle(area: R.RefObject<HTMLElement | null>, delay: number, keepVisible: boolean) {
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
/** Saves at most once per interval, and before the page goes away, when a timer would never fire. */
export function useSessionSaver(save: () => void) {
  const latest = React.useRef(save);
  latest.current = save;
  const timer = React.useRef<number | null>(null);
  const flush = React.useCallback(() => {
    if (timer.current === null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    latest.current();
  }, []);
  React.useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);
  return React.useCallback(() => {
    if (timer.current === null) timer.current = window.setTimeout(flush, SESSION_SAVE_MS);
  }, [flush]);
}
export function useNativePlayerComponent() {
  const [loading, setLoading] = React.useState(false),
    [error, setError] = React.useState<Error | null>(null),
    [revision, setRevision] = React.useState(0);
  const [component, setComponent] = React.useState<NativePlayer | null>(
    () => (PluginApi.components.ScenePlayer as NativePlayer | undefined) ?? null,
  );
  React.useEffect(() => {
    let cancelled = false;
    if (!DirtyPlugins.native?.loadComponent || !PluginApi.utils?.StashService?.useFindScene) {
      setError(new Error("This Stash version does not expose the native ScenePlayer plugin API."));
      return;
    }
    if (component) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void DirtyPlugins.native
      .loadComponent("ScenePlayer")
      .then(loaded => {
        if (!cancelled) setComponent(() => loaded as NativePlayer);
      })
      .catch(cause => {
        if (!cancelled) setError(cause instanceof Error ? cause : new Error(String(cause)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [component, revision]);
  return {
    loading,
    error,
    component,
    refresh() {
      setError(null);
      setRevision(value => value + 1);
    },
  };
}
/**
 * What a click may land on without leaving edit mode: the edit tools, controls and menus, and dialogs with their
 * backdrops. A click on a picture or on empty space leaves it.
 */
const EDITING_TARGETS =
  "button, a, input, select, textarea, [role='slider'], [role='dialog'], .modal, .dirty-ui-backdrop, .dropdown-menu, " +
  ".vjs-control-bar, .vjs-menu, .vjs-modal-dialog, .ms-screen-controls, .ms-divider, .ms-floating, .ms-pane-header, " +
  ".ms-screen-menu, .ms-docking-guide";
/**
 * While editing, a click on a picture or on empty space finishes editing, so edit mode opened by mistake takes one
 * click to leave. Where the press starts decides, so a drag that ends elsewhere, such as along a divider, never counts.
 */
export function useClickAwayFinish(editing: boolean, finish: () => void) {
  const finishRef = React.useRef(finish);
  finishRef.current = finish;
  React.useEffect(() => {
    if (!editing) return undefined;
    let outside = false;
    const press = (event: PointerEvent) => {
      outside = event.button === 0 && !(event.target as Element | null)?.closest?.(EDITING_TARGETS);
    };
    const click = (event: MouseEvent) => {
      if (!outside) return;
      outside = false;
      // That click only finishes editing: the video beneath it does not also pause.
      event.stopPropagation();
      event.preventDefault();
      finishRef.current();
    };
    document.addEventListener("pointerdown", press, true);
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("pointerdown", press, true);
      document.removeEventListener("click", click, true);
    };
  }, [editing]);
}
