import type * as R from "react";
import type { Edge } from "../domain/custom";
import { React } from "../runtime";
import type { ResizeControls } from "../types";

/** Edit mode: a strip on each edge of a screen that faces another one. Dragging it resizes the screen. */
export function ResizeHandles({
  edges,
  paneIndex,
  position,
  resize,
}: {
  edges: Edge[];
  /** The screen's own index, which follows it when it moves. */
  paneIndex: number;
  /** Where the screen sits in the grid, for its labels. */
  position: number;
  resize: ResizeControls;
}) {
  const press = React.useRef<{ x: number; y: number } | null>(null);
  const move = (event: R.PointerEvent<HTMLSpanElement>) => {
    const start = press.current;
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    resize.move(event.clientX - start.x, event.clientY - start.y);
  };
  return (
    <>
      {edges.map(edge => (
        <span
          key={edge}
          className={`ms-resize-handle ms-resize-${edge}`}
          title={`Drag to resize screen ${position + 1}`}
          aria-hidden="true"
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.setPointerCapture(event.pointerId);
            press.current = { x: event.clientX, y: event.clientY };
            resize.start(paneIndex, edge);
          }}
          onPointerMove={move}
          onPointerUp={() => {
            press.current = null;
            resize.end();
          }}
          // A capture lost before the release ends the drag where it is.
          onLostPointerCapture={() => {
            if (!press.current) return;
            press.current = null;
            resize.end();
          }}
          onPointerCancel={() => {
            press.current = null;
            resize.cancel();
          }}
        />
      ))}
    </>
  );
}
