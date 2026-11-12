import { fitBlock, snapEdges } from "./layout";
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
export const EDGES: readonly Edge[] = ["top", "right", "bottom", "left"];

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
  const open = new Set(kept.flat());
  const closed = placeOrder.filter(pane => !open.has(pane));
  const lanesOrAll = kept.length ? kept : [closed.slice(0, 1)];
  let root = tidy({
    size: 1,
    axis,
    children: lanesOrAll.map(lane => ({ size: 1, axis: inner, children: lane.map(pane => ({ size: 1, pane })) })),
  })!;
  for (const pane of closed) {
    if (leaves(root).includes(pane)) continue;
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

/** Each part's natural box when every video keeps its shape: a part's size makes it that many times larger. */
function naturalBox(node: CustomNode, aspectOf: (pane: number) => number): { width: number; height: number } {
  if (!isSplit(node)) return { width: aspectOf(node.pane), height: 1 };
  const boxes = node.children.map(child => scaledBox(child, node.axis, aspectOf));
  return node.axis === "row"
    ? { width: boxes.reduce((sum, box) => sum + box.width, 0), height: Math.max(...boxes.map(box => box.height)) }
    : { width: Math.max(...boxes.map(box => box.width)), height: boxes.reduce((sum, box) => sum + box.height, 0) };
}
/** A part's box in its split: as tall as its size in a row, as wide as its size in a column. */
function scaledBox(node: CustomNode, axis: Axis, aspectOf: (pane: number) => number) {
  const box = naturalBox(node, aspectOf);
  return axis === "row"
    ? { width: (node.size * box.width) / box.height, height: node.size }
    : { width: node.size, height: (node.size * box.height) / box.width };
}

/**
 * Where each open screen sits, by pane index. Without `aspectOf`, parts share their split by size. With it, every
 * video keeps its shape: parts are as large as their size says, and smaller parts are centred beside larger ones.
 */
export function customRectangles(
  layout: CustomLayout,
  closed: readonly number[],
  width: number,
  height: number,
  pixelRatio = 1,
  aspectOf?: (pane: number) => number,
): Array<Rectangle | undefined> {
  const tree = without(layout, closed);
  const placed: Array<Rectangle | undefined> = [];
  if (!tree) return placed;
  const panes: number[] = [];
  const edges: Edges[] = [];
  const share = (node: CustomNode, box: Edges) => {
    if (!isSplit(node)) {
      panes.push(node.pane);
      edges.push(box);
      return;
    }
    const sum = total(node.children);
    const row = node.axis === "row";
    const start = row ? box.left : box.top;
    const extent = (row ? box.right : box.bottom) - start;
    let used = 0;
    node.children.forEach((child, index) => {
      const from = start + (used / sum) * extent;
      used += child.size;
      const to = index === node.children.length - 1 ? start + extent : start + (used / sum) * extent;
      share(child, row ? { ...box, left: from, right: to } : { ...box, top: from, bottom: to });
    });
  };
  const fit = (node: CustomNode, box: Edges) => {
    if (!isSplit(node) || !aspectOf) return share(node, box);
    const row = node.axis === "row";
    const parts = node.children.map(child => scaledBox(child, node.axis, aspectOf));
    const natural = naturalBox(node, aspectOf);
    const scaleX = (box.right - box.left) / natural.width;
    const scaleY = (box.bottom - box.top) / natural.height;
    let used = 0;
    node.children.forEach((child, index) => {
      const part = parts[index];
      if (row) {
        const left = box.left + used * scaleX;
        used += part.width;
        const top = box.top + ((natural.height - part.height) / 2) * scaleY;
        fit(child, { left, right: box.left + used * scaleX, top, bottom: top + part.height * scaleY });
      } else {
        const top = box.top + used * scaleY;
        used += part.height;
        const left = box.left + ((natural.width - part.width) / 2) * scaleX;
        fit(child, { top, bottom: box.top + used * scaleY, left, right: left + part.width * scaleX });
      }
    });
  };
  if (!(width > 0 && height > 0)) {
    leaves(tree).forEach(pane => {
      placed[pane] = { left: 0, top: 0, width: 0, height: 0 };
    });
    return Array.from(placed);
  }
  if (aspectOf) {
    const natural = naturalBox(tree, aspectOf);
    const block = fitBlock(natural.width, natural.height, width, height);
    fit(tree, {
      left: block.offsetX,
      top: block.offsetY,
      right: block.offsetX + natural.width * block.scaleX,
      bottom: block.offsetY + natural.height * block.scaleY,
    });
  } else share(tree, { left: 0, top: 0, right: width, bottom: height });
  snapEdges(edges, pixelRatio).forEach((rectangle, index) => {
    placed[panes[index]] = rectangle;
  });
  return Array.from(placed);
}

type Kind = "push" | "extend" | "resize";
interface Found {
  kind: Kind;
  path: Step[];
  /** Where in the path the split that the edge crosses is. */
  depth: number;
  main: Axis;
  dir: 1 | -1;
}
/**
 * What dragging an edge does. A side edge between screens of one row pushes and pulls them ("push"). An edge that a
 * screen at the end of its row or column shares with the next lane lets it reach across that lane while the screens
 * there keep their own row or column ("extend"). Any other edge between parts resizes the part ("resize").
 */
function classify(holder: CustomSplit, pane: number, edge: Edge): Found | null {
  const path = pathTo(holder, pane);
  if (!path) return null;
  const main: Axis = edge === "left" || edge === "right" ? "row" : "column";
  const dir = edge === "right" || edge === "bottom" ? 1 : -1;
  for (let depth = path.length - 1; depth >= 0; depth--) {
    const { node, index } = path[depth];
    if (node.axis !== main || index + dir < 0 || index + dir >= node.children.length) continue;
    if (depth === path.length - 1) return { kind: main === "row" ? "push" : "resize", path, depth, main, dir };
    const inner = path[depth + 1];
    const atEnd = inner.index === 0 || inner.index === inner.node.children.length - 1;
    return { kind: depth === path.length - 2 && atEnd ? "extend" : "resize", path, depth, main, dir };
  }
  return null;
}

/** The edges of an open screen that face another screen. */
export function draggableEdges(layout: CustomLayout, closed: readonly number[], pane: number): Edge[] {
  const tree = without(layout, closed);
  if (!tree) return [];
  const holder: CustomSplit = { size: 1, axis: "column", children: [tree] };
  return EDGES.filter(edge => !!classify(holder, pane, edge));
}

/**
 * The screens a drag of this edge measures and how many units they hold: one unit of the drag is their extent along
 * the drag divided by `units`.
 */
export function dragUnit(layout: CustomLayout, closed: readonly number[], pane: number, edge: Edge) {
  const tree = without(layout, closed);
  if (!tree) return null;
  const found = classify({ size: 1, axis: "column", children: [tree] }, pane, edge);
  if (!found) return null;
  const { node, index } = found.path[found.depth];
  const part = node.children[index];
  return { panes: leaves(part), units: part.size };
}

/**
 * Grows a screen by `units` (shrinks it when negative) at one edge.
 * - A side edge between screens of a row takes room from the screens beside it: those it covers whole go to the start
 *   of the next row (a new row at the end), one it covers in part gets narrower. Shrinking brings screens up from the
 *   start of the next row.
 * - A screen at the end of its row reaches down (or up) across the next rows, which keep their screens beside it; at
 *   the end of its column it reaches across the next columns in the same way. Shrinking gives the last of them back.
 * - Any other edge makes its part larger, or the part beside it larger once it is as small as it gets.
 */
export function resizeScreen(
  layout: CustomLayout,
  closed: readonly number[],
  pane: number,
  edge: Edge,
  units: number,
): CustomLayout {
  const step = Math.round(units) || 0;
  if (!step || closed.includes(pane)) return layout;
  const tree = without(layout, closed);
  if (!tree) return layout;
  const holder: CustomSplit = { size: 1, axis: "column", children: [copy(tree)] };
  const found = classify(holder, pane, edge);
  if (!found) return layout;
  const { path, depth, main, dir } = found;
  const { node: split, index } = path[depth];
  const changed =
    found.kind === "push"
      ? step > 0
        ? push(path, step, dir)
        : pull(path, -step, dir)
      : found.kind === "extend"
        ? step > 0
          ? extend(split, index, path[depth + 1].index, main, step, dir)
          : release(split, index, path[depth + 1].index, main, -step, dir) || resize(split, index, step, dir)
        : resize(split, index, step, dir);
  if (!changed) return layout;
  return restoreClosed(tidy(holder)!, layout, closed);
}

/** A part gets larger, or when it shrinks below one unit, the part beside it gets larger. */
function resize(split: CustomSplit, index: number, step: number, dir: number) {
  const part = split.children[index];
  const beside = split.children[index + dir];
  if (step > 0) part.size += step;
  else {
    const less = Math.min(-step, Math.max(0, part.size - 1));
    part.size -= less;
    beside.size += -step - less;
  }
  return true;
}

/** The screen widens over the screens beside it in its row; those covered whole go to the start of the next row. */
function push(path: Step[], step: number, dir: number) {
  const { node: row, index } = path[path.length - 1];
  const screen = row.children[index];
  const beside = dir > 0 ? row.children.slice(index + 1) : row.children.slice(0, index).reverse();
  let left = step;
  const covered: CustomNode[] = [];
  for (const neighbour of beside) {
    if (left <= 1e-9) break;
    if (neighbour.size <= left + 1e-9) {
      left -= neighbour.size;
      covered.push(neighbour);
    } else {
      neighbour.size -= left;
      left = 0;
    }
  }
  screen.size += step - left;
  if (!covered.length) return true;
  row.children = row.children.filter(child => !covered.includes(child));
  // They keep reading order in the next row.
  const moved = dir > 0 ? covered : covered.reverse();
  const { node: column, index: at } = path[path.length - 2];
  const next = column.children[at + 1];
  if (!next)
    column.children.push(
      moved.length === 1 ? { ...moved[0], size: row.size } : { size: row.size, axis: "row", children: moved },
    );
  else if (isSplit(next) && next.axis === "row") next.children.unshift(...moved);
  else column.children[at + 1] = { size: next.size, axis: "row", children: [...moved, { ...next, size: 1 }] };
  return true;
}

/** The screen narrows and screens from the start of the next row come up into the room it leaves. */
function pull(path: Step[], step: number, dir: number) {
  const { node: row, index } = path[path.length - 1];
  const screen = row.children[index];
  let room = Math.min(step, screen.size - 1);
  if (room <= 1e-9) return false;
  screen.size -= room;
  const { node: column, index: at } = path[path.length - 2];
  const next = column.children[at + 1];
  if (!next) return true;
  const source = isSplit(next) && next.axis === "row" ? next.children : [{ ...next, size: 1 }];
  const pulled: CustomNode[] = [];
  while (room > 1e-9 && source.length) {
    const part = source.shift()!;
    const size = Math.min(part.size, room);
    room -= size;
    pulled.push({ ...part, size });
  }
  if (!isSplit(next) || next.axis !== "row" || !source.length) column.children.splice(at + 1, 1);
  row.children.splice(dir > 0 ? index + 1 : index, 0, ...pulled);
  return true;
}

/**
 * A screen at the end of its lane (a row inside a column, or a column inside a row) reaches across the next lanes;
 * they keep their screens, beside it.
 */
function extend(split: CustomSplit, index: number, at: number, main: Axis, step: number, dir: number) {
  const lane = split.children[index] as CustomSplit;
  const beside = dir > 0 ? split.children.slice(index + 1) : split.children.slice(0, index).reverse();
  let left = step;
  const covered: CustomNode[] = [];
  for (const neighbour of beside) {
    if (left <= 1e-9) break;
    covered.push(neighbour);
    left -= neighbour.size;
  }
  if (!covered.length) return false;
  const screen = lane.children[at];
  const others = lane.children.filter((_, position) => position !== at);
  const rest: CustomNode =
    others.length === 1 ? { ...others[0], size: lane.size } : { size: lane.size, axis: lane.axis, children: others };
  const inOrder = dir > 0 ? covered : covered.slice().reverse();
  const across: CustomSplit = {
    size: total(lane.children) - screen.size,
    axis: main,
    children: dir > 0 ? [rest, ...inOrder] : [...inOrder, rest],
  };
  const reached: CustomSplit = {
    size: lane.size + total(covered),
    axis: lane.axis,
    children: at === 0 ? [screen, across] : [across, screen],
  };
  const first = Math.min(index, ...covered.map(part => split.children.indexOf(part)));
  const kept = split.children.filter(part => part !== lane && !covered.includes(part));
  kept.splice(first, 0, reached);
  split.children = kept;
  return true;
}

/** A screen that reaches across lanes gives the last of them back. */
function release(split: CustomSplit, index: number, at: number, main: Axis, step: number, dir: number) {
  const lane = split.children[index] as CustomSplit;
  const across = lane.children[1 - at];
  if (lane.children.length !== 2 || !across || !isSplit(across) || across.axis !== main) return false;
  // Each lane across it had this share of its size.
  const sum = total(across.children);
  const whole = lane.size;
  const released: CustomNode[] = [];
  let left = step;
  while (left > 1e-9 && across.children.length > 1) {
    const part = (dir > 0 ? across.children.pop() : across.children.shift())!;
    const size = (part.size / sum) * whole;
    released.push({ ...part, size });
    left -= size;
  }
  lane.size = whole - total(released);
  // In reading order, after it or before it.
  split.children.splice(dir > 0 ? index + 1 : index, 0, ...(dir > 0 ? released.reverse() : released));
  return true;
}

/** Two screens trade places. */
export function swapCells(layout: CustomLayout, first: number, second: number): CustomLayout {
  if (!isSplit(layout))
    return { ...layout, pane: layout.pane === first ? second : layout.pane === second ? first : layout.pane };
  return { ...layout, children: layout.children.map(child => swapCells(child, first, second)) };
}
