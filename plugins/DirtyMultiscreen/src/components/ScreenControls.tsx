import type * as R from "react";
import { React } from "../runtime";
import type { SwapControls } from "../types";
import { icon, PluginIconButton } from "./Controls";

/** How far a press travels before it lifts its screen, so a click never moves one. */
const LIFT_AFTER_PX = 6;
/** A lifted screen shrinks around the pointer, so the screen it would swap with shows around it. */
const LIFTED_SCALE = 0.6;
/** The other screen under a point of the window, by the index its cell carries. The lifted screen is on top, so it is skipped. */
function screenAt(x: number, y: number, lifted: Element | null) {
  for (const element of document.elementsFromPoint(x, y)) {
    const cell = element.closest<HTMLElement>("[data-ms-screen]");
    if (cell && cell !== lifted) return Number(cell.dataset.msScreen);
  }
  return null;
}

/** One screen's picture and move controls, shown in edit mode while the video keeps playing. */
export function ScreenControls({
  fill,
  fitVideos,
  flipX,
  flipY,
  loop,
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
  // The press a drag starts from and the screen it lifts. The cell follows the pointer through its own style, so
  // carrying it never renders the grid again or touches its video.
  const lift = React.useRef<{ x: number; y: number; cell: HTMLElement | null; lifted: boolean } | null>(null);
  const putDown = () => {
    const cell = lift.current?.cell;
    lift.current = null;
    if (!cell) return;
    cell.style.transform = "";
    cell.style.zIndex = "";
  };
  const pointerMove = (event: R.PointerEvent<HTMLSpanElement>) => {
    const current = lift.current;
    if (!current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const x = event.clientX - current.x,
      y = event.clientY - current.y;
    if (!current.lifted && Math.hypot(x, y) < LIFT_AFTER_PX) return;
    current.lifted = true;
    if (current.cell) {
      current.cell.style.transform = `translate(${x}px, ${y}px) scale(${LIFTED_SCALE})`;
      current.cell.style.zIndex = "6";
    }
    swap.dragOver(screenAt(event.clientX, event.clientY, current.cell));
  };
  return (
    <div className="ms-screen-controls" role="group" aria-label={`Controls for ${screen}`}>
      <span
        className="ms-move-handle"
        onPointerDown={event => {
          event.currentTarget.setPointerCapture(event.pointerId);
          lift.current = {
            x: event.clientX,
            y: event.clientY,
            cell: event.currentTarget.closest<HTMLElement>("[data-ms-screen]"),
            lifted: false,
          };
          swap.dragStart(paneIndex);
        }}
        onPointerMove={pointerMove}
        onPointerUp={() => {
          putDown();
          swap.dragEnd();
        }}
        onPointerCancel={() => {
          putDown();
          swap.cancel();
        }}
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
    </div>
  );
}
