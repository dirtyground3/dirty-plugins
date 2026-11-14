import { snapEdges } from "./layout";
import type { Edges, Rectangle } from "./layout";

/**
 * A custom layout: screens in rows and columns that can hold further rows and columns. A row places its parts side by
 * side and a column stacks them; each part's size is its share of its parent. Closed screens keep their place in the
 * tree, so they return to it, but take no room.
 */
export type Axis = "row" | "column";
export interface CustomLeaf {
  size: number;
  pane: number;
}
export interface CustomSplit {
  size: number;
  axis: Axis;
  children: CustomNode[];
}
export type CustomNode = CustomLeaf | CustomSplit;
export type CustomLayout = CustomNode;
export type Edge = "top" | "right" | "bottom" | "left";
export interface Divider {
  /** Child indexes in the tree with closed screens removed. */
  path: number[];
  at: number;
  axis: Axis;
  x: number;
  y: number;
  length: number;
  /** Size of the split along its axis, for converting a pointer delta to a share of the split. */
  extent: number;
  /** Where the line sits, as a share of its split. */
  share: number;
}

const isSplit = (node: CustomNode): node is CustomSplit => "children" in node;
const isSize = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
export function isCustomLayout(value: unknown, depth = 0): value is CustomLayout {
  if (!value || typeof value !== "object" || depth > 64) return false;
  const node = value as Record<string, unknown>;
  if (!isSize(node.size)) return false;
  if ("children" in node)
    return (
      (node.axis === "row" || node.axis === "column") &&
      Array.isArray(node.children) &&
      node.children.length > 0 &&
      node.children.every(child => isCustomLayout(child, depth + 1))
    );
  return Number.isInteger(node.pane) && (node.pane as number) >= 0;
}

const total = (nodes: readonly CustomNode[]) => nodes.reduce((sum, node) => sum + node.size, 0);
const exact = (value: number) => Math.round(value * 1e6) / 1e6;
const copy = (node: CustomNode): CustomNode =>
  isSplit(node)
    ? { size: node.size, axis: node.axis, children: node.children.map(copy) }
    : { size: node.size, pane: node.pane };

/** Every screen in the tree, in reading order. */
export const leaves = (node: CustomNode): number[] => (isSplit(node) ? node.children.flatMap(leaves) : [node.pane]);

/**
 * The same layout in its simplest form: a split inside one of the same axis joins it, a split with one part becomes
 * that part, empty splits go, and the smallest part of each split has size 1.
 */
function tidy(node: CustomNode): CustomNode | null {
  if (!isSplit(node)) return node;
  const children: CustomNode[] = [];
  for (const child of node.children) {
    const kept = tidy(child);
    if (!kept) continue;
    if (isSplit(kept) && kept.axis === node.axis) {
      const sum = total(kept.children);
      for (const part of kept.children) children.push({ ...part, size: (part.size * kept.size) / sum });
    } else children.push(kept);
  }
  if (!children.length) return null;
  if (children.length === 1) return { ...children[0], size: node.size };
  const least = Math.min(...children.map(child => child.size));
  return {
    size: node.size,
    axis: node.axis,
    children: children.map(child => ({ ...child, size: exact(child.size / least) })),
  };
}

/** The tree without these screens, or null when none is left. */
function without(node: CustomNode, panes: readonly number[]): CustomNode | null {
  const strip = (part: CustomNode): CustomNode | null => {
    if (!isSplit(part)) return panes.includes(part.pane) ? null : part;
    const children = part.children.map(strip).filter((child): child is CustomNode => !!child);
    return children.length ? { ...part, children } : null;
  };
  const stripped = strip(node);
  return stripped && tidy(stripped);
}

interface Step {
  node: CustomSplit;
  index: number;
}
/** The splits from the root down to a screen, with the part each one leads into. */
function pathTo(node: CustomNode, pane: number, steps: Step[] = []): Step[] | null {
  if (!isSplit(node)) return node.pane === pane ? steps : null;
  for (let index = 0; index < node.children.length; index++) {
    const found = pathTo(node.children[index], pane, [...steps, { node, index }]);
    if (found) return found;
  }
  return null;
}

/** Puts a screen back beside another one, in a row or column as it was before. */
function insertBeside(root: CustomNode, previous: number | null, leaf: CustomLeaf, axis: Axis): CustomNode {
  const first = leaves(root)[0];
  const anchor = previous ?? first;
  const holder: CustomSplit = { size: 1, axis: "column", children: [root] };
  const path = pathTo(holder, anchor)!;
  const { node: parent, index } = path[path.length - 1];
  const at = previous === null ? index : index + 1;
  if (parent.axis === axis && parent !== holder) parent.children.splice(at, 0, leaf);
  else {
    const target = parent.children[index];
    parent.children[index] = {
      size: target.size,
      axis,
      children: previous === null ? [leaf, { ...target, size: 1 }] : [{ ...target, size: 1 }, leaf],
    };
  }
  return tidy(holder)!;
}

/** Closed screens of `before` return beside the screen before them, in the row or column they shared. */
function restoreClosed(after: CustomNode, before: CustomNode, closed: readonly number[]): CustomNode {
  const order = leaves(before);
  let result = after;
  for (const pane of order) {
    const path = closed.includes(pane) ? pathTo(before, pane) : null;
    if (!path?.length) continue;
    const { node: parent, index } = path[path.length - 1];
    const placed = leaves(result);
    const previous =
      order
        .slice(0, order.indexOf(pane))
        .reverse()
        .find(candidate => placed.includes(candidate)) ?? null;
    result = insertBeside(result, previous, { size: parent.children[index].size, pane }, parent.axis);
  }
  return result;
}

/**
 * Lanes of open screens as a layout: rows stacked in a column, or columns side by side in a row. Each closed screen
 * goes beside the open screen before it in place order, so it reopens where it was.
 */
export function layoutFromLanes(
  lanes: readonly (readonly number[])[],
  placeOrder: readonly number[],
  axis: Axis = "column",
): CustomLayout {
  const inner: Axis = axis === "column" ? "row" : "column";
  const kept = lanes.filter(lane => lane.length);
  const lanesOrAll = kept.length ? kept : [placeOrder.slice(0, 1)];
  return placeClosedLanes(
    {
      size: 1,
      axis,
      children: lanesOrAll.map(lane => ({ size: 1, axis: inner, children: lane.map(pane => ({ size: 1, pane })) })),
    },
    placeOrder,
  );
}

/** Sized lanes keep every interior boundary of the automatic fit, extending the outside panes into the margins. */
export function layoutFromFitted(
  panes: readonly number[],
  placeOrder: readonly number[],
  ends: readonly number[],
  transposed: boolean,
  boxes: readonly Rectangle[],
  width: number,
  height: number,
): CustomLayout {
  const starts = ends.map((_, index) => (index ? ends[index - 1] : 0));
  const across = transposed ? "left" : "top";
  const along = transposed ? "top" : "left";
  const span = (from: number, to: number) => Math.max(1e-6, to - from);
  return placeClosedLanes(
    {
      size: 1,
      axis: transposed ? "row" : "column",
      children: starts.map((first, lane) => {
        const end = ends[lane];
        return {
          size: span(
            lane ? boxes[first][across] : 0,
            end < panes.length ? boxes[end][across] : transposed ? width : height,
          ),
          axis: transposed ? "column" : "row",
          children: panes.slice(first, end).map((pane, offset) => {
            const index = first + offset;
            return {
              pane,
              size: span(
                offset ? boxes[index][along] : 0,
                index + 1 < end ? boxes[index + 1][along] : transposed ? height : width,
              ),
            };
          }),
        };
      }),
    },
    placeOrder,
  );
}

function placeClosedLanes(tree: CustomSplit, placeOrder: readonly number[]): CustomLayout {
  let root = tidy(tree)!;
  const open = leaves(root);
  const closed = placeOrder.filter(pane => !open.includes(pane));
  const inner = tree.axis === "column" ? "row" : "column";
  for (const pane of closed) {
    const placed = leaves(root);
    const previous =
      placeOrder
        .slice(0, placeOrder.indexOf(pane))
        .reverse()
        .find(candidate => placed.includes(candidate)) ?? null;
    root = insertBeside(root, previous, { size: 1, pane }, inner);
  }
  return root;
}

/** Every pane below `count` once: unknown and repeated panes go, missing ones join the last row. */
export function normalizeLayout(layout: CustomLayout, count: number): CustomLayout {
  const seen = new Set<number>();
  const keep = (node: CustomNode): CustomNode | null => {
    if (!isSplit(node)) {
      if (node.pane >= count || seen.has(node.pane)) return null;
      seen.add(node.pane);
      return node;
    }
    const children = node.children.map(keep).filter((child): child is CustomNode => !!child);
    return children.length ? { ...node, children } : null;
  };
  const kept = keep(layout);
  const missing = Array.from({ length: count }, (_, pane) => pane).filter(pane => !seen.has(pane));
  let root = kept && tidy({ ...kept, size: 1 });
  if (!missing.length || !count) return root ?? { size: 1, axis: "row", children: [] };
  const added = missing.map(pane => ({ size: 1, pane }));
  if (!root) return tidy({ size: 1, axis: "row", children: added })!;
  if (isSplit(root) && root.axis === "column") {
    const last = root.children[root.children.length - 1];
    root.children[root.children.length - 1] =
      isSplit(last) && last.axis === "row"
        ? { ...last, children: [...last.children, ...added] }
        : { size: last.size, axis: "row", children: [{ ...last, size: 1 }, ...added] };
    return tidy(root)!;
  }
  root = { size: 1, axis: "row", children: [root, ...added] };
  return tidy(root)!;
}

/** The open screens in reading order. */
export const readingOrder = (layout: CustomLayout, closed: readonly number[]) =>
  leaves(layout).filter(pane => !closed.includes(pane));

/** Visits the boxes of a sized layout and the line after each part that has a neighbour. */
function shareBoxes(
  node: CustomNode,
  box: Edges,
  place: (pane: number, box: Edges) => void,
  boundary?: (path: number[], at: number, axis: Axis, line: Edges, extent: number, share: number) => void,
  path: number[] = [],
) {
  if (!isSplit(node)) {
    place(node.pane, box);
    return;
  }
  const sum = total(node.children);
  const row = node.axis === "row";
  const start = row ? box.left : box.top;
  const end = row ? box.right : box.bottom;
  const extent = end - start;
  let used = 0;
  node.children.forEach((child, index) => {
    const from = start + (used / sum) * extent;
    used += child.size;
    const last = index === node.children.length - 1;
    const to = last ? end : start + (used / sum) * extent;
    if (!last)
      boundary?.(
        path,
        index,
        node.axis,
        row ? { ...box, left: to, right: to } : { ...box, top: to, bottom: to },
        extent,
        used / sum,
      );
    shareBoxes(child, row ? { ...box, left: from, right: to } : { ...box, top: from, bottom: to }, place, boundary, [
      ...path,
      index,
    ]);
  });
}

/** Where each open screen sits, by pane index. Parts share their split by size. */
export function customRectangles(
  layout: CustomLayout,
  closed: readonly number[],
  width: number,
  height: number,
  pixelRatio = 1,
): Array<Rectangle | undefined> {
  const tree = without(layout, closed);
  const placed: Array<Rectangle | undefined> = [];
  if (!tree) return placed;
  const panes: number[] = [];
  const edges: Edges[] = [];
  const place = (pane: number, box: Edges) => {
    panes.push(pane);
    edges.push(box);
  };
  if (!(width > 0 && height > 0)) {
    leaves(tree).forEach(pane => {
      placed[pane] = { left: 0, top: 0, width: 0, height: 0 };
    });
    return Array.from(placed);
  }
  shareBoxes(tree, { left: 0, top: 0, right: width, bottom: height }, place);
  snapEdges(edges, pixelRatio).forEach((rectangle, index) => {
    placed[panes[index]] = rectangle;
  });
  return Array.from(placed);
}

/** One handle per boundary, snapped to the same device pixels as the screens. */
export function customDividers(
  layout: CustomLayout,
  closed: readonly number[],
  width: number,
  height: number,
  pixelRatio = 1,
): Divider[] {
  if (!(width > 0 && height > 0)) return [];
  const tree = without(layout, closed);
  if (!tree) return [];
  const dividers: Divider[] = [];
  const lines: Edges[] = [];
  shareBoxes(
    tree,
    { left: 0, top: 0, right: width, bottom: height },
    () => {},
    (path, at, axis, line, extent, share) => {
      dividers.push({ path, at, axis, extent, share, x: 0, y: 0, length: 0 });
      lines.push(line);
    },
  );
  return snapEdges(lines, pixelRatio).map(({ left, top, width, height }, index) => ({
    ...dividers[index],
    x: left,
    y: top,
    length: dividers[index].axis === "row" ? height : width,
  }));
}

/**
 * The eighth of its split that a line aimed at `aim` (a share of the split) sticks to, if any. A line reaches an
 * eighth within a short distance, but leaves the eighth it holds only after a much longer pull.
 */
export function dividerSnap(aim: number, extent: number, held: number | null = null): number | null {
  if (held !== null && Math.abs(held - aim) * extent <= Math.min(36, extent / 20)) return held;
  const eighth = Math.round(aim * 8) / 8;
  return Math.abs(eighth - aim) * extent <= Math.min(12, extent / 32) ? eighth : null;
}

/**
 * Trades size between two neighbours. The signed delta is a fraction of their split's full extent; `held` is the
 * eighth the line already sticks to during this drag.
 */
export function moveDivider(
  layout: CustomLayout,
  closed: readonly number[],
  path: readonly number[],
  at: number,
  fraction: number,
  extent = Infinity,
  snap = true,
  held: number | null = null,
): CustomLayout {
  if (!Number.isFinite(fraction) || !fraction || !(extent > 0)) return layout;
  const open = without(layout, closed);
  if (!open) return layout;
  const tree = copy(open);
  let split = tree;
  for (const index of path) {
    if (!isSplit(split) || !split.children[index]) return layout;
    split = split.children[index];
  }
  if (!isSplit(split)) return layout;
  const before = split.children[at];
  const after = split.children[at + 1];
  if (!before || !after) return layout;
  const sum = total(split.children);
  const minimum = Math.min((before.size + after.size) / 2, sum * Math.max(0.1, 80 / extent));
  // A part already below the minimum may grow, but cannot get any smaller.
  const lower = Math.min(0, minimum - before.size);
  const upper = Math.max(0, after.size - minimum);
  let delta = fraction * sum;
  if (snap && Number.isFinite(extent)) {
    const start = total(split.children.slice(0, at + 1)) / sum;
    const eighth = dividerSnap(start + fraction, extent, held);
    const snapped = eighth === null ? NaN : (eighth - start) * sum;
    if (snapped >= lower && snapped <= upper) delta = snapped;
  }
  delta = Math.max(lower, Math.min(upper, delta));
  if (Math.abs(delta) < 1e-9) return layout;
  before.size += delta;
  after.size -= delta;
  return restoreClosed(tidy(tree)!, layout, closed);
}

/** Moves an open screen beside another one or to an outer edge of the grid. */
export function dockScreen(
  layout: CustomLayout,
  pane: number,
  target: number | "grid",
  side: Edge,
  closed: readonly number[] = [],
): CustomLayout {
  if (target === pane || closed.includes(pane) || (target !== "grid" && closed.includes(target))) return layout;
  const open = without(layout, closed);
  if (!open) return layout;
  const origin = pathTo(open, pane);
  if (!origin?.length) return layout;
  const axis: Axis = side === "left" || side === "right" ? "row" : "column";
  const leading = side === "left" || side === "top";
  const { node, index } = origin[origin.length - 1];
  if (target === "grid") {
    if (origin.length === 1 && node.axis === axis && index === (leading ? 0 : node.children.length - 1)) return layout;
  } else if (node.axis === axis) {
    const beside = node.children[index + (leading ? 1 : -1)];
    if (beside && !isSplit(beside) && beside.pane === target) return layout;
  }

  // Remove only the moving screen. Closed screens stay anchored in their old branches.
  const root = copy(without(layout, [pane])!);
  const leaf = { size: 1, pane };
  if (target === "grid") {
    const openRoot = without(root, closed)!;
    if (isSplit(openRoot) && openRoot.axis === axis) {
      // Hidden lanes can leave the visible root nested inside the saved root.
      const hasOpen = (part: CustomNode) => leaves(part).some(index => !closed.includes(index));
      let split = root;
      while (isSplit(split)) {
        const visible = split.children.filter(hasOpen);
        if (visible.length > 1) {
          leaf.size = total(visible) / openRoot.children.length;
          split.children.splice(leading ? 0 : split.children.length, 0, leaf);
          return tidy(root)!;
        }
        split = visible[0];
      }
    }
    const rest = { ...root, size: 2 };
    return tidy({ size: root.size, axis, children: leading ? [leaf, rest] : [rest, leaf] })!;
  }

  const path = pathTo(root, target);
  if (!path) return layout;
  const ordered = (part: CustomNode) => (leading ? [leaf, part] : [part, leaf]);
  if (!path.length) return { size: root.size, axis, children: ordered({ ...root, size: 1 }) };
  const { node: parent, index: at } = path[path.length - 1];
  const part = parent.children[at];
  if (parent.axis === axis) {
    leaf.size = part.size / 2;
    parent.children.splice(at, 1, ...ordered({ ...part, size: leaf.size }));
  } else {
    parent.children[at] = { size: part.size, axis, children: ordered({ ...part, size: 1 }) };
  }
  return tidy(root)!;
}

/** The open screens' rows and columns, without their sizes. */
function arrangement(node: CustomNode): string {
  return isSplit(node) ? `${node.axis}(${node.children.map(arrangement).join(",")})` : String(node.pane);
}
/** Whether two layouts place the open screens the same way, whatever their sizes. */
export function sameArrangement(first: CustomLayout, second: CustomLayout, closed: readonly number[] = []) {
  const a = without(first, closed),
    b = without(second, closed);
  return !!a && !!b && arrangement(a) === arrangement(b);
}

/** Two screens trade places. */
export function swapCells(layout: CustomLayout, first: number, second: number): CustomLayout {
  if (!isSplit(layout))
    return { ...layout, pane: layout.pane === first ? second : layout.pane === second ? first : layout.pane };
  return { ...layout, children: layout.children.map(child => swapCells(child, first, second)) };
}
