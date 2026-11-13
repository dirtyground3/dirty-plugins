import { GRID_LIMITS } from "../domain/settings";
import { DirtyPlugins, React } from "../runtime";
import type { GridSize } from "../types";

export type { GridSize };
const sizeLabel = ({ columns, rows }: GridSize) => `${columns} × ${rows}`;

/** Squares for every grid size: click one, or press and drag to it, to choose that many columns and rows. */
export function GridPicker({
  columns,
  custom,
  rows,
  fitVideos,
  onPick,
  onToggleFit,
}: GridSize & {
  /** Resizing or docking has replaced the preset grid. */
  custom: boolean;
  fitVideos: boolean;
  onPick(size: GridSize): void;
  onToggleFit(): void;
}) {
  const [preview, setPreview] = React.useState<GridSize | null>(null);
  // The square a press started on. Releasing on another one chooses it, since no click follows a drag.
  const pressed = React.useRef<number | null>(null);
  const shown = preview ?? (custom ? null : { columns, rows });
  return (
    <div className="ms-grid-picker" role="group" aria-label="Grid size" onPointerLeave={() => setPreview(null)}>
      <div className="ms-grid-squares" style={{ gridTemplateColumns: `repeat(${GRID_LIMITS.columns}, 1fr)` }}>
        {Array.from({ length: GRID_LIMITS.rows * GRID_LIMITS.columns }, (_, index) => {
          const size = {
            columns: (index % GRID_LIMITS.columns) + 1,
            rows: Math.floor(index / GRID_LIMITS.columns) + 1,
          };
          const screens = size.columns * size.rows;
          const label = `${sizeLabel(size)}: ${screens} ${screens === 1 ? "screen" : "screens"}`;
          return (
            <button
              key={index}
              type="button"
              className={
                "ms-grid-square" +
                (shown && size.columns <= shown.columns && size.rows <= shown.rows ? " ms-grid-square-on" : "")
              }
              aria-label={label}
              aria-pressed={!custom && size.columns === columns && size.rows === rows}
              title={label}
              onPointerDown={event => {
                pressed.current = index;
                // A touch keeps its pointer on the first square unless the capture is released.
                if (event.currentTarget.hasPointerCapture?.(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerEnter={() => setPreview(size)}
              onPointerUp={() => {
                if (pressed.current !== null && pressed.current !== index) onPick(size);
                pressed.current = null;
              }}
              onFocus={() => setPreview(size)}
              onBlur={() => setPreview(null)}
              onClick={() => onPick(size)}
            />
          );
        })}
      </div>
      <div className="ms-grid-size" aria-live="polite">
        {shown ? sizeLabel(shown) : "Custom"}
      </div>
      <button
        type="button"
        className="ms-fit-toggle"
        aria-pressed={fitVideos}
        title={custom ? "Fill each pane without stretching the picture" : "Pack screens by video shape"}
        onClick={onToggleFit}
      >
        Fit videos
      </button>
    </div>
  );
}

/** Another grid deals a new queue, so every screen restarts: ask first. */
export function GridChangeDialog({
  size,
  onCancel,
  onConfirm,
}: {
  size: GridSize;
  onCancel(): void;
  onConfirm(): void;
}) {
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const screens = size.columns * size.rows;
  return (
    <DirtyPlugins.react.Dialog
      className="dirty-ui-dialog ms-grid-confirm"
      ariaLabel="Change the grid"
      initialFocusRef={confirmRef}
      onClose={onCancel}
    >
      <h2>Change the grid to {sizeLabel(size)}?</h2>
      <p>
        {screens === 1 ? "The screen restarts" : `All ${screens} screens restart`} with a new queue. Scenes, positions
        and picture choices on the current screens are not kept.
      </p>
      <div className="dirty-ui-control-row">
        <DirtyPlugins.react.Button onClick={onCancel}>Cancel</DirtyPlugins.react.Button>
        <DirtyPlugins.react.Button tone="primary" buttonRef={confirmRef} onClick={onConfirm}>
          Change grid
        </DirtyPlugins.react.Button>
      </div>
    </DirtyPlugins.react.Dialog>
  );
}
