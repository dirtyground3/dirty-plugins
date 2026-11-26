import { options } from "@generated/multiscreen.settings";
import { DirtyPlugins, React } from "../runtime";
import type { GridSize, LoopState, PlaybackSettings, SavedGrid, SavedGridSummary, SceneOrder } from "../types";
import { icon } from "./Controls";
import { GridPicker, sizeLabel } from "./GridPicker";
import { SavedGridsDialog } from "./SavedGrids";

/**
 * The label and an icon column. A main option shows its icon there, and a check while it is on, a short note on why
 * it is unavailable, or a value such as the current grid size beside the label. A submenu's option has no icon, so
 * the column shows its state instead: a check while it is on and a dash while it is mixed.
 */
function row({
  label,
  glyph,
  fallback = "",
  checked = false,
  mixed = false,
  state = "on",
  note,
  value,
}: {
  label: string;
  glyph?: unknown;
  fallback?: string;
  checked?: boolean;
  /** On for some screens and off for others. */
  mixed?: boolean;
  /** What a screen reader hears after a checked option. */
  state?: string;
  note?: string;
  value?: string;
}) {
  const hasIcon = !!(glyph || fallback);
  const hint = hasIcon && checked ? "✓" : note;
  return (
    <span className="ms-menu-row">
      <span className="ms-menu-icon" aria-hidden="true" title={mixed ? "On for some screens" : undefined}>
        {hasIcon ? <DirtyPlugins.react.Glyph icon={glyph} fallback={fallback} /> : checked ? "✓" : mixed ? "–" : null}
      </span>
      <span className="ms-menu-label">
        {label}
        {checked && <span className="sr-only">{` (${state})`}</span>}
        {mixed && <span className="sr-only"> (mixed)</span>}
        {note && <span className="sr-only">{`: ${note}`}</span>}
      </span>
      {hint && (
        <span className="ms-menu-hint" aria-hidden="true">
          {hint}
        </span>
      )}
      {value && <span className="ms-menu-hint">{value}</span>}
    </span>
  );
}

/** The Playback settings the menu switches, in the order of the settings page. */
const PLAYBACK_OPTIONS = [
  { key: "startMuted", label: "Start muted" },
  { key: "randomStart", label: "Random start" },
  { key: "loop", label: "Loop scenes" },
  { key: "pauseWhenHidden", label: "Pause when hidden" },
] as const;
export type PlaybackOption = (typeof PLAYBACK_OPTIONS)[number]["key"];

/**
 * The burger between the O counter and Close holds the other main actions: edit mode, the Grid submenu with the grid
 * sizes and Fit videos, +, saved grids, Reshuffle, whose submenu lists the scene orders, and the Playback settings. A
 * part whose action is unavailable leaves the menu.
 */
export function MainMenu({
  editing,
  onToggleEditing,
  grid,
  canAdd,
  onAdd,
  order,
  onShuffle,
  savedGrids,
  playback,
}: {
  /** Edit mode and + need playing screens; null leaves them out. */
  editing: boolean | null;
  onToggleEditing(): void;
  /** The grid and its choices, or null while no screens play. */
  grid:
    | (GridSize & {
        /** Resizing or docking has replaced the preset grid. */
        custom: boolean;
        fitVideos: boolean;
        onToggleFit(): void;
        onPick(size: GridSize): void;
      })
    | null;
  /** False once the grid is at its largest with every screen open. */
  canAdd: boolean;
  onAdd(): void;
  /** The current scene order, or null while there is nothing to reshuffle. */
  order: SceneOrder | null;
  onShuffle(order: SceneOrder): void;
  /** The saved-grids dialog, or null until the settings load. */
  savedGrids: {
    capture: boolean;
    keepRecent: number;
    onOpen(grid: SavedGrid, summary: SavedGridSummary): Promise<void>;
    snapshot(): SavedGrid | null;
  } | null;
  /**
   * The Playback settings, or null until they load. Loop scenes is mixed while some screens loop on their own;
   * choosing it sets every screen.
   */
  playback: (Omit<PlaybackSettings, "loop"> & { loop: LoopState; onToggle(option: PlaybackOption): void }) | null;
}) {
  const [savedOpen, setSavedOpen] = React.useState(false);
  // The dialog gives focus back to the burger, since the item that opened it is gone with the menu.
  const anchor = React.useRef<HTMLDivElement | null>(null);
  const opener = React.useRef<HTMLElement | null>(null);
  const items = [
    editing !== null && {
      key: "edit",
      label: row({ label: "Edit screens", glyph: icon("edit"), fallback: "✎", checked: editing }),
      onSelect: onToggleEditing,
    },
    // The squares and Fit videos open beneath Grid, which names the current size.
    grid && {
      key: "grid",
      // A preset names its size beside Grid; resized or docked screens make it the Custom grid.
      label: row({
        label: grid.custom ? "Custom grid" : "Grid",
        glyph: icon("grid"),
        fallback: "▦",
        value: grid.custom ? undefined : sizeLabel(grid),
      }),
      items: [
        {
          key: "sizes",
          // Picking a size closes the menu, before the dialog that asks to change the grid.
          content: (close: () => void) => (
            <GridPicker
              columns={grid.columns}
              rows={grid.rows}
              custom={grid.custom}
              onPick={size => {
                close();
                grid.onPick(size);
              }}
            />
          ),
        },
        {
          key: "fit",
          label: row({ label: "Fit videos", checked: grid.fitVideos }),
          onSelect: grid.onToggleFit,
        },
      ],
    },
    editing !== null && {
      key: "add",
      disabled: !canAdd,
      label: row({
        label: "Add a screen",
        glyph: icon("add"),
        fallback: "+",
        note: canAdd ? undefined : "the grid is full",
      }),
      onSelect: onAdd,
    },
    savedGrids && {
      key: "saved",
      label: row({ label: "Saved grids", glyph: icon("saved"), fallback: "★" }),
      onSelect: () => {
        opener.current = anchor.current?.querySelector<HTMLElement>(".dirty-ui-action-menu-toggle") ?? null;
        setSavedOpen(true);
      },
    },
    // The orders open beneath Reshuffle; choosing one reshuffles every screen with it.
    order && {
      key: "reshuffle",
      label: row({ label: "Reshuffle", glyph: icon("shuffle"), fallback: "⇄" }),
      items: options.sceneOrder.map(option => ({
        key: option.value,
        label: row({ label: option.label, checked: option.value === order, state: "current" }),
        onSelect: () => onShuffle(option.value as SceneOrder),
      })),
    },
    // The settings that change how screens play, checked while on; they apply to the screens at once.
    playback && {
      key: "playback",
      label: row({ label: "Playback", glyph: icon("playback"), fallback: "▶" }),
      items: PLAYBACK_OPTIONS.map(({ key, label }) => {
        const value = playback[key];
        return {
          key,
          label: row({ label, checked: value === true, mixed: value === "mixed" }),
          onSelect: () => playback.onToggle(key),
        };
      }),
    },
  ];
  if (!items.some(Boolean)) return null;
  return (
    <div className="ms-main-menu-anchor" ref={anchor}>
      <DirtyPlugins.react.ActionMenu
        className="ms-main-menu"
        ariaLabel="Menu"
        label={<DirtyPlugins.react.Glyph icon={icon("menu")} fallback="☰" />}
        items={items}
      />
      {savedOpen && savedGrids && (
        <SavedGridsDialog {...savedGrids} openerRef={opener} onClose={() => setSavedOpen(false)} />
      )}
    </div>
  );
}
