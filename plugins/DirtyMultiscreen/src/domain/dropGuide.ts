import type { DropZone } from "../types";
import type { Edge } from "./custom";
import type { Rectangle } from "./layout";

export interface DropPointer {
  x: number;
  y: number;
  width: number;
  height: number;
  pane: { index: number; box: Rectangle } | null;
}

export interface DropTarget {
  zone: DropZone;
  box: Rectangle;
}

const edges: readonly Edge[] = ["top", "right", "bottom", "left"];

export function sameGuideBounds(before: DropPointer, after: DropPointer) {
  if (before.width !== after.width || before.height !== after.height || before.pane?.index !== after.pane?.index)
    return false;
  if (!before.pane || !after.pane) return true;
  const a = before.pane.box;
  const b = after.pane.box;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

export function dropTargetAt(targets: readonly DropTarget[], { x, y }: DropPointer) {
  return targets.find(
    ({ box }) => x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height,
  );
}

const crossRoom = ({ width, height }: Rectangle) => Math.min(width / 3.5, height / 3);

/** Leave space for the Grid targets even if the hovered pane touches a window edge. */
function clearOf(pane: Rectangle, marker: Rectangle) {
  const right = pane.left + pane.width;
  const bottom = pane.top + pane.height;
  const markerRight = marker.left + marker.width;
  const markerBottom = marker.top + marker.height;
  if (right <= marker.left || pane.left >= markerRight || bottom <= marker.top || pane.top >= markerBottom) return pane;
  return [
    { ...pane, width: marker.left - pane.left },
    { ...pane, left: markerRight, width: right - markerRight },
    { ...pane, height: marker.top - pane.top },
    { ...pane, top: markerBottom, height: bottom - markerBottom },
  ].reduce((best, piece) => (crossRoom(piece) > crossRoom(best) ? piece : best));
}

const overlaps = (a: Rectangle, b: Rectangle) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

/** Swap in the middle of the area and a dock arrow on each side; none when the area is too small. */
function crossIn(area: Rectangle) {
  const unit = Math.min(44, area.width / 4, area.height / 3.5);
  if (unit < 10) return null;
  const gap = Math.min(4, unit / 6);
  const centerWidth = unit * 1.5;
  const centerX = area.left + area.width / 2;
  const centerY = area.top + area.height / 2;
  const box = (dx: number, dy: number, w = unit): Rectangle => ({
    left: centerX + dx - w / 2,
    top: centerY + dy - unit / 2,
    width: w,
    height: unit,
  });
  const horizontal = (unit + centerWidth) / 2 + gap;
  const vertical = unit + gap;
  return [
    { side: "top", box: box(0, -vertical) },
    { side: "left", box: box(-horizontal, 0) },
    { side: "center", box: box(0, 0, centerWidth) },
    { side: "right", box: box(horizontal, 0) },
    { side: "bottom", box: box(0, vertical) },
  ] as const;
}

export function dropTargets(
  { width, height, pane }: DropPointer,
  available: (zone: DropZone) => boolean,
): DropTarget[] {
  const margin = Math.min(8, width / 16, height / 16);
  const depth = Math.min(38, width / 6, height / 6);
  const across = Math.min(88, width / 3, height / 3);
  const outer: Record<Edge, Rectangle> = {
    top: { left: (width - across) / 2, top: margin, width: across, height: depth },
    right: { left: width - margin - depth, top: (height - across) / 2, width: depth, height: across },
    bottom: { left: (width - across) / 2, top: height - margin - depth, width: across, height: depth },
    left: { left: margin, top: (height - across) / 2, width: depth, height: across },
  };
  const targets: DropTarget[] = edges
    .map(side => ({ zone: { target: "grid" as const, side }, box: outer[side] }))
    .filter(({ zone }) => available(zone));
  if (!pane) return targets;

  // The cross sits in the middle of the screen, where its edit controls were, unless that would cover a Grid target.
  const middle = crossIn(pane.box);
  const cross =
    middle && !middle.some(({ box }) => targets.some(marker => overlaps(box, marker.box)))
      ? middle
      : crossIn(targets.reduce((box, marker) => clearOf(box, marker.box), pane.box));
  if (!cross) return targets;
  for (const { side, box } of cross) {
    const zone = { target: pane.index, side };
    if (available(zone)) targets.push({ zone, box });
  }
  return targets;
}
