import type * as R from "react";
import type { DropPointer } from "../domain/dropGuide";
import { React } from "../runtime";
import type { SwapControls } from "../types";
import { icon, PluginIconButton } from "./Controls";

/** How far a press travels before it lifts its screen, so a click never moves one. */
const LIFT_AFTER_PX = 6;
const movedFarEnough = (start: { x: number; y: number }, event: R.PointerEvent) =>
  Math.hypot(event.clientX - start.x, event.clientY - start.y) >= LIFT_AFTER_PX;

function dropPointer(x: number, y: number, grid: HTMLElement, source: number): DropPointer {
  const bounds = grid.getBoundingClientRect();
  const pointer: DropPointer = {
    x: x - bounds.left,
    y: y - bounds.top,
    width: bounds.width,
    height: bounds.height,
    pane: null,
  };
  for (const element of document.elementsFromPoint(x, y)) {
    const cell = element.closest<HTMLElement>("[data-ms-screen]");
    if (!cell || cell.parentElement !== grid) continue;
    const index = Number(cell.dataset.msScreen);
    if (index === source) break;
    const { left, top, width, height } = cell.getBoundingClientRect();
    if (width && height)
      pointer.pane = { index, box: { left: left - bounds.left, top: top - bounds.top, width, height } };
    break;
  }
  return pointer;
}

/**
 * Lifts a screen once a press travels far enough and drops it where it is released. The edit-mode handle
 * holds the pointer from the press; a picture holds it only once it lifts, so a plain click still reaches the player.
 */
export function useScreenDrag(paneIndex: number, swap: SwapControls) {
  const lift = React.useRef<{
    id: number;
    x: number;
    y: number;
    grid: HTMLElement;
    lifted: boolean;
    held: boolean;
  } | null>(null);
  const dropped = React.useRef(false);
  return React.useMemo(() => {
    const cancel = (event: R.PointerEvent<HTMLElement>) => {
      if (lift.current?.id !== event.pointerId) return;
      lift.current = null;
      swap.cancel();
    };
    return {
      press(event: R.PointerEvent<HTMLElement>, capture?: Element) {
        // A picture's press released elsewhere before lifting reports no release here, so a new press replaces it.
        if (event.button !== 0 || event.isPrimary === false || lift.current?.held) return;
        const grid = event.currentTarget.closest<HTMLElement>(".ms-native-grid");
        if (!grid) return;
        capture?.setPointerCapture(event.pointerId);
        lift.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          grid,
          lifted: false,
          held: !!capture,
        };
        swap.dragStart(paneIndex);
      },
      move(event: R.PointerEvent<HTMLElement>) {
        const current = lift.current;
        if (current?.id !== event.pointerId) return;
        if (!current.held && event.buttons === 0) {
          lift.current = null;
          swap.cancel();
          return;
        }
        if (!current.lifted && !movedFarEnough(current, event)) return;
        if (!current.held) {
          event.currentTarget.setPointerCapture(event.pointerId);
          current.held = true;
        }
        current.lifted = true;
        swap.dragOver(dropPointer(event.clientX, event.clientY, current.grid, paneIndex));
      },
      release(event: R.PointerEvent<HTMLElement>) {
        const current = lift.current;
        if (current?.id !== event.pointerId) return;
        lift.current = null;
        const moved = current.lifted || movedFarEnough(current, event);
        dropped.current = moved;
        window.setTimeout(() => {
          dropped.current = false;
        }, 0);
        swap.dragEnd(moved ? dropPointer(event.clientX, event.clientY, current.grid, paneIndex) : null);
      },
      cancel,
      /** The click that ends a drag never reaches the player. */
      click(event: R.MouseEvent<HTMLElement>) {
        if (!dropped.current) return;
        event.preventDefault();
        event.stopPropagation();
      },
    };
  }, [paneIndex, swap]);
}

/** One screen's picture and move controls, shown in edit mode while the video keeps playing. */
export function ScreenControls({
  fill,
  fitVideos,
  flipX,
  flipY,
  loop,
  onClose,
  onFinishEditing,
  onFill,
  onFlip,
  onLoop,
  onRotate,
  rotation,
  paneIndex,
  position,
  swap,
  swapSource,
}: {
  fill: boolean;
  fitVideos: boolean;
  flipX: boolean;
  flipY: boolean;
  loop: boolean;
  /** Absent while this is the only open screen. */
  onClose?(): void;
  /** Leaves edit mode for every screen. */
  onFinishEditing(): void;
  onFill(fill: boolean): void;
  onFlip(x: boolean, y: boolean): void;
  onLoop(loop: boolean): void;
  onRotate(): void;
  rotation: number;
  /** The screen's own index, which follows it when it moves. */
  paneIndex: number;
  /** Where the screen sits in the grid, for its labels. */
  position: number;
  swap: SwapControls;
  /** The screen picked up for a swap, if any. */
  swapSource: number | null;
}) {
  const screen = `screen ${position + 1}`;
  const picked = swapSource === paneIndex;
  const drag = useScreenDrag(paneIndex, swap);
  return (
    <div className="ms-screen-controls" role="group" aria-label={`Controls for ${screen}`}>
      <span
        className="ms-move-handle"
        // Keep a plain click on its button even though the wrapper handles the drag.
        onPointerDown={event => drag.press(event, (event.target as Element).closest("button") ?? event.currentTarget)}
        onPointerMove={drag.move}
        onPointerUp={drag.release}
        onPointerCancel={drag.cancel}
        onLostPointerCapture={drag.cancel}
      >
        <PluginIconButton
          ariaLabel={
            picked ? `Cancel moving ${screen}` : swapSource !== null ? `Swap with ${screen}` : `Move ${screen}`
          }
          fallback="✥"
          icon={icon("move")}
          pressed={picked}
          onClick={() => swap.toggle(paneIndex)}
        />
      </span>
      <PluginIconButton
        ariaLabel={`Flip ${screen} horizontally`}
        fallback="⇆"
        icon={icon("flipX")}
        pressed={flipX}
        onClick={() => onFlip(!flipX, flipY)}
      />
      <PluginIconButton
        ariaLabel={`Flip ${screen} vertically`}
        fallback="⇅"
        icon={icon("flipY")}
        pressed={flipY}
        onClick={() => onFlip(flipX, !flipY)}
      />
      <PluginIconButton
        ariaLabel={`Rotate ${screen} 90° clockwise (${rotation * 90}°)`}
        fallback="⟳"
        icon={icon("rotate")}
        pressed={rotation !== 0}
        onClick={onRotate}
      />
      <PluginIconButton
        ariaLabel={`Loop the scene on ${screen}`}
        fallback="↻"
        icon={icon("loop")}
        pressed={loop}
        onClick={() => onLoop(!loop)}
      />
      <PluginIconButton
        ariaLabel={fitVideos ? `Fill ${screen} is controlled by Fit videos` : `Fill ${screen} with the picture`}
        fallback="⛶"
        icon={icon("fill")}
        pressed={fitVideos || fill}
        disabled={fitVideos}
        onClick={() => onFill(!fill)}
      />
      <PluginIconButton
        ariaLabel={onClose ? `Close ${screen}` : `Close ${screen} is unavailable: it is the only open screen`}
        fallback="−"
        icon={icon("minus")}
        tone="danger"
        disabled={!onClose}
        onClick={() => onClose?.()}
      />
      <PluginIconButton
        ariaLabel="Finish editing screens"
        className="ms-finish-editing"
        fallback="×"
        icon={icon("close")}
        onClick={onFinishEditing}
      />
    </div>
  );
}
