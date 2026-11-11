import { isRecord } from "./domain/context";
import { isSession } from "./domain/session";
import { DirtyPlugins, PLUGIN_ID, React } from "./runtime";
import type { SavedGrid, SavedGridSummary } from "./types";

const run = <T>(args: Record<string, unknown>) => DirtyPlugins.runPluginOperation<T>(PLUGIN_ID, args);
/** A playing grid is saved at most this often; leaving the page or hiding the tab saves it at once. */
const RECENT_SAVE_MS = 10000;

/** The session travels as JSON text, so Stash passes it on without touching a number or a key. */
function parseGrid(text: unknown): SavedGrid | null {
  try {
    const grid: unknown = JSON.parse(String(text));
    return isRecord(grid) && isRecord(grid.settings) && isSession(grid.session) ? (grid as unknown as SavedGrid) : null;
  } catch {
    return null;
  }
}

/** Every request trims the recent grids to the number the settings keep. */
export const listGrids = (keepRecent: number) =>
  run<{ grids: SavedGridSummary[] }>({ mode: "gridList", keepRecent }).then(result => result.grids);
export async function loadGrid(id: number) {
  const grid = parseGrid((await run<{ data: unknown }>({ mode: "gridGet", id })).data);
  if (!grid) throw new Error("This saved grid cannot be read.");
  return grid;
}
/** Adds a grid, or replaces the screens of the one with this ID. */
export const saveGrid = (name: string, grid: SavedGrid, id?: number) =>
  run<SavedGridSummary>({
    mode: "gridSave",
    id,
    name,
    rows: grid.settings.rows,
    columns: grid.settings.columns,
    data: JSON.stringify(grid),
  });
export const renameGrid = (id: number, name: string) => run<SavedGridSummary>({ mode: "gridRename", id, name });
export const deleteGrid = (id: number) => run<{ deleted: boolean }>({ mode: "gridDelete", id });
/** Keeps a recent grid under a name, replacing a saved grid of the same name. */
export const keepGrid = (id: number, name: string) => run<SavedGridSummary>({ mode: "gridKeep", id, name });

/**
 * Keeps this session's recent grid up to date in the shared database. `update` takes the screens as they are
 * now; they are written at most every ten seconds, at once when the tab is hidden or the player closes, one
 * request at a time. `onSaved` hears the recent grid's ID whenever a save creates one.
 */
export function useRecentGrid(keep: number, initialId: number | undefined, onSaved: (id: number) => void) {
  const id = React.useRef(initialId);
  const pending = React.useRef<SavedGrid | null>(null);
  const timer = React.useRef<number | null>(null);
  const queue = React.useRef<Promise<void>>(Promise.resolve());
  const latest = React.useRef({ keep, onSaved });
  latest.current = { keep, onSaved };
  // The grid's own last save can arrive after the player has closed or the page has gone; it is written at once.
  const closed = React.useRef(false);
  const flush = React.useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const grid = pending.current;
    pending.current = null;
    const { keep } = latest.current;
    if (!grid || keep < 1) return;
    queue.current = queue.current
      .then(() =>
        run<{ grid: SavedGridSummary | null }>({
          mode: "gridRecent",
          id: id.current,
          keep,
          // The dialog numbers autosaves by age; the stored name is only shown once one is kept.
          name: "Autosave",
          rows: grid.settings.rows,
          columns: grid.settings.columns,
          data: JSON.stringify(grid),
        }),
      )
      .then(
        ({ grid: saved }) => {
          if (!saved || saved.id === id.current) return;
          id.current = saved.id;
          latest.current.onSaved(saved.id);
        },
        error => {
          DirtyPlugins.debugLog(PLUGIN_ID, "Could not save the recent grid", { error: String(error) });
        },
      );
  }, []);
  const enabled = keep > 0;
  React.useEffect(() => {
    if (!enabled) return;
    const hidden = () => {
      if (document.hidden) flush();
    };
    // The grid's own last save follows the page leaving, so from then on every save is written at once.
    const leave = () => {
      closed.current = true;
      flush();
    };
    const back = () => {
      closed.current = false;
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", back);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", back);
    };
  }, [enabled, flush]);
  React.useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      flush();
    };
  }, [flush]);
  const update = React.useCallback(
    (grid: SavedGrid | null) => {
      if (!grid || latest.current.keep < 1) return;
      pending.current = grid;
      if (closed.current) flush();
      else if (timer.current === null) timer.current = window.setTimeout(flush, RECENT_SAVE_MS);
    },
    [flush],
  );
  return { update, flush, id: () => id.current };
}
