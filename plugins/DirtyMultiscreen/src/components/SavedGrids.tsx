import type * as R from "react";
import { DirtyPlugins, React } from "../runtime";
import { deleteGrid, keepGrid, listGrids, loadGrid, renameGrid, saveGrid } from "../savedGrids";
import type { SavedGrid, SavedGridSummary } from "../types";
import { icon, PluginIconButton } from "./Controls";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sameName = (first: string, second: string) =>
  first.trim().toLocaleLowerCase() === second.trim().toLocaleLowerCase();
const played = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
/** The search appears once there are more saved grids than this. */
const SEARCH_AFTER = 5;
/** Every word of the search appears somewhere in the label, in any order and case. */
const matches = (label: string, words: readonly string[]) => {
  const text = label.toLocaleLowerCase();
  return words.every(word => text.includes(word));
};

/** Save the current screens, or open, rename and delete saved grids. The main menu opens it. */
export function SavedGridsDialog({
  capture,
  keepRecent,
  onClose,
  onOpen,
  openerRef,
  snapshot,
}: {
  capture: boolean;
  /** How many recent grids the settings keep; listing trims them to it. */
  keepRecent: number;
  onClose(): void;
  /** Replaces the current screens with a saved grid. */
  onOpen(grid: SavedGrid, summary: SavedGridSummary): Promise<void>;
  /** Takes focus back when the dialog closes. */
  openerRef?: R.RefObject<HTMLElement>;
  /** The current screens, or null while no grid is playing. */
  snapshot(): SavedGrid | null;
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const [grids, setGrids] = React.useState<SavedGridSummary[] | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [name, setName] = React.useState("");
  const [query, setQuery] = React.useState("");
  // Renaming a recent grid keeps it as a named one.
  const [renaming, setRenaming] = React.useState<{ id: number; name: string; keep: boolean } | null>(null);
  const mounted = React.useRef(true);
  React.useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  /** One request at a time; the list is read again after each change. */
  const act = async (work: () => Promise<unknown>, reload = true) => {
    setBusy(true);
    setError("");
    try {
      await work();
      const next = reload ? await listGrids(keepRecent) : null;
      if (mounted.current && next) setGrids(next);
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  React.useEffect(() => {
    void act(async () => undefined);
  }, []);
  const recent = (grids ?? []).filter(grid => grid.recent);
  const saved = (grids ?? []).filter(grid => !grid.recent);
  // A search that hides with its field would go on hiding grids, so it applies only while shown.
  const searching = saved.length > SEARCH_AFTER;
  const words = searching ? query.toLocaleLowerCase().split(/\s+/).filter(Boolean) : [];
  const shownSaved = saved.filter(grid => matches(grid.name, words));
  // The named grids get a heading of their own only below autosaves.
  const savedHeading = recent.length > 0 && saved.length > 0 && <h3 className="ms-saved-heading">Saved</h3>;
  const canSave = !!snapshot();
  const existing = saved.find(grid => sameName(grid.name, name));
  const save = (event: R.FormEvent) => {
    event.preventDefault();
    const grid = snapshot();
    if (!grid || !name.trim() || busy) return;
    if (existing && !window.confirm(`Replace "${existing.name}" with the current screens?`)) return;
    void act(async () => {
      await saveGrid(existing?.name ?? name, grid, existing?.id);
      if (mounted.current) setName("");
    });
  };
  /** A saved grid takes the current screens and keeps its name. */
  const overwrite = (grid: SavedGridSummary) => {
    const current = snapshot();
    if (!current || busy || !window.confirm(`Replace "${grid.name}" with the current screens?`)) return;
    void act(() => saveGrid(grid.name, current, grid.id));
  };
  const rename = (event: R.FormEvent) => {
    event.preventDefault();
    if (!renaming || !renaming.name.trim() || busy) return;
    const replaced = renaming.keep && saved.find(grid => sameName(grid.name, renaming.name));
    if (replaced && !window.confirm(`Replace "${replaced.name}" with this autosave?`)) return;
    void act(async () => {
      await (renaming.keep ? keepGrid : renameGrid)(renaming.id, renaming.name);
      if (mounted.current) setRenaming(null);
    });
  };
  /** Autosaves are numbered newest first; named grids show their name. */
  const row = (grid: SavedGridSummary, label: string) =>
    renaming?.id === grid.id ? (
      <li key={grid.id}>
        <form className="ms-saved-form" onSubmit={rename}>
          <input
            type="text"
            className="form-control"
            aria-label={renaming.keep ? `Name to keep ${label} under` : `New name for ${label}`}
            value={renaming.name}
            maxLength={80}
            placeholder="Name for this grid"
            onChange={event => setRenaming({ ...renaming, name: event.target.value })}
          />
          <DirtyPlugins.react.Button tone="primary" type="submit" disabled={busy || !renaming.name.trim()}>
            {renaming.keep ? "Keep" : "Rename"}
          </DirtyPlugins.react.Button>
          <DirtyPlugins.react.Button onClick={() => setRenaming(null)}>Cancel</DirtyPlugins.react.Button>
        </form>
      </li>
    ) : (
      <li key={grid.id}>
        <DirtyPlugins.react.Button
          className="ms-saved-open"
          ariaLabel={`Open ${label}`}
          title={(grid.recent ? "Played " : "Saved ") + played(grid.updatedAt)}
          disabled={busy}
          onClick={() => void act(async () => onOpen(await loadGrid(grid.id), grid), false)}
        >
          <span className="ms-saved-name">{label}</span>
          <small>
            {grid.columns} × {grid.rows} ·{" "}
            {grid.recent ? played(grid.updatedAt) : new Date(grid.updatedAt * 1000).toLocaleDateString()}
          </small>
        </DirtyPlugins.react.Button>
        {grid.recent ? (
          <PluginIconButton
            ariaLabel={`Keep ${label} as a saved grid`}
            fallback="★"
            icon={icon("saved")}
            disabled={busy}
            onClick={() => setRenaming({ id: grid.id, name: "", keep: true })}
          />
        ) : (
          <PluginIconButton
            ariaLabel={`Rename ${grid.name}`}
            fallback="✎"
            icon={icon("rename")}
            disabled={busy}
            onClick={() => setRenaming({ id: grid.id, name: grid.name, keep: false })}
          />
        )}
        {canSave && !grid.recent && (
          <PluginIconButton
            ariaLabel={`Overwrite ${grid.name} with the current screens`}
            fallback="⭳"
            icon={icon("overwrite")}
            disabled={busy}
            onClick={() => overwrite(grid)}
          />
        )}
        <PluginIconButton
          ariaLabel={`Delete ${label}`}
          fallback="🗑"
          icon={icon("remove")}
          disabled={busy}
          onClick={() => {
            const question = grid.recent ? `Delete ${label}?` : `Delete the saved grid "${label}"?`;
            if (window.confirm(question)) void act(() => deleteGrid(grid.id));
          }}
        />
      </li>
    );
  return (
    <DirtyPlugins.react.Dialog
      className={"dirty-ui-dialog ms-saved-grids" + (capture ? " ms-docs-capture" : "")}
      backdropClassName="dirty-ui-backdrop ms-saved-grids-backdrop"
      ariaLabel="Saved grids"
      initialFocusRef={closeRef}
      openerRef={openerRef}
      onClose={onClose}
    >
      <div className="ms-scene-search-heading">
        <h2>Saved grids</h2>
        <PluginIconButton
          ariaLabel="Close saved grids"
          fallback="x"
          icon={icon("close")}
          buttonRef={closeRef}
          onClick={onClose}
        />
      </div>
      {canSave && (
        <form className="ms-saved-form" onSubmit={save}>
          <input
            type="text"
            className="form-control"
            aria-label="Save the current screens as"
            title="Keeps the grid and every screen's place, scene, position, sound and picture."
            value={name}
            maxLength={80}
            placeholder="Name for this grid"
            onChange={event => setName(event.target.value)}
          />
          <DirtyPlugins.react.Button tone="primary" type="submit" disabled={busy || !name.trim()}>
            {existing ? "Replace" : "Save"}
          </DirtyPlugins.react.Button>
        </form>
      )}
      <div className="ms-saved-results" aria-busy={busy}>
        {error && <p role="alert">{error}</p>}
        {!grids && !error && <p role="status">Loading saved grids…</p>}
        {!grids && error && (
          <DirtyPlugins.react.Button onClick={() => void act(async () => undefined)}>Retry</DirtyPlugins.react.Button>
        )}
        {grids?.length === 0 && <p role="status">No saved grids yet.</p>}
        {recent.length > 0 && (
          <>
            <h3 className="ms-saved-heading">Autosaves</h3>
            <ul className="ms-saved-list">{recent.map((grid, index) => row(grid, `Autosave ${index + 1}`))}</ul>
          </>
        )}
        {savedHeading}
        {searching && (
          // A search form of its own: themes such as Refract turn the list around a bare search field into a toolbar.
          <form className="ms-saved-search" role="search" onSubmit={event => event.preventDefault()}>
            <input
              type="search"
              className="form-control"
              aria-label="Search saved grids"
              placeholder="Search saved grids"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </form>
        )}
        {searching && !shownSaved.length && <p role="status">No saved grids match this search.</p>}
        {/* Only this list scrolls, so everything above it, the search included, stays in view. */}
        <ul className="ms-saved-list ms-saved-named">{shownSaved.map(grid => row(grid, grid.name))}</ul>
      </div>
    </DirtyPlugins.react.Dialog>
  );
}
