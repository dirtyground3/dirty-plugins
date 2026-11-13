import type * as R from "react";
import { customDividers, moveDivider } from "../domain/custom";
import type { CustomLayout, Divider } from "../domain/custom";
import type { Edges } from "../domain/layout";
import { React } from "../runtime";

/** A grid-wide overlay: each split owns its line, regardless of how many screens touch it. */
export function Dividers({
  base,
  shown,
  closed,
  size,
  bounds,
  quiet,
  onDraft,
  onCommit,
}: {
  base: CustomLayout;
  shown: CustomLayout;
  closed: readonly number[];
  size: { width: number; height: number; ratio: number };
  /** The automatic fit may leave outer margins; its resting handles stop at the pictures. */
  bounds?: Edges;
  /** Outside edit mode only the pointer shows a divider. */
  quiet?: boolean;
  onDraft(layout: CustomLayout | null): void;
  onCommit(layout: CustomLayout): void;
}) {
  const dividers = React.useMemo(
    () => customDividers(shown, closed, size.width, size.height, size.ratio),
    [shown, closed, size],
  );
  const press = React.useRef<{ id: number; origin: number; divider: Divider; base: CustomLayout } | null>(null);
  const deltaLayout = (event: R.PointerEvent<HTMLSpanElement>) => {
    const start = press.current;
    if (!start || start.base !== base) return base;
    const { axis, path, at, extent } = start.divider;
    const position = axis === "row" ? event.clientX : event.clientY;
    return moveDivider(base, closed, path, at, (position - start.origin) / extent, extent, !event.shiftKey);
  };
  const stop = (event: R.PointerEvent<HTMLSpanElement>, commit = false) => {
    if (press.current?.id !== event.pointerId) return;
    const result = commit ? deltaLayout(event) : base;
    press.current = null;
    onDraft(null);
    if (result !== base) onCommit(result);
  };
  return (
    <div className={quiet ? "ms-dividers ms-dividers-quiet" : "ms-dividers"} aria-hidden="true">
      {dividers.map(divider => {
        const { path, at, axis, x, y, length } = divider;
        const vertical = axis === "row";
        const from = vertical ? Math.max(y, bounds?.top ?? y) : Math.max(x, bounds?.left ?? x);
        const to = vertical
          ? Math.min(y + length, bounds?.bottom ?? Infinity)
          : Math.min(x + length, bounds?.right ?? Infinity);
        return (
          <span
            key={`${path.join(".")}:${at}`}
            className={`ms-divider ms-divider-${vertical ? "vertical" : "horizontal"}`}
            style={vertical ? { left: x, top: from, height: to - from } : { left: from, top: y, width: to - from }}
            title={quiet ? undefined : "Drag to resize. Hold Shift to move without snapping."}
            onPointerDown={event => {
              if (event.button !== 0 || event.isPrimary === false || press.current) return;
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.setPointerCapture(event.pointerId);
              press.current = { id: event.pointerId, origin: vertical ? event.clientX : event.clientY, divider, base };
            }}
            onPointerMove={event => {
              if (press.current?.id !== event.pointerId) return;
              const result = deltaLayout(event);
              onDraft(result === base ? null : result);
            }}
            onPointerUp={event => stop(event, true)}
            onLostPointerCapture={event => stop(event)}
            onPointerCancel={event => stop(event)}
          />
        );
      })}
    </div>
  );
}
