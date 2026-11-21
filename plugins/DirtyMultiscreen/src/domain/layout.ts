export const DEFAULT_ASPECT = 16 / 9;
export interface Rectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}
export function videoAspect(width?: number | null, height?: number | null): number {
  return width && height && width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height)
    ? width / height
    : DEFAULT_ASPECT;
}

/** Linear partition: minimize the largest sum of contiguous aspects for each possible row count. */
function partitions(aspects: number[]): number[][] {
  const n = aspects.length;
  const sums = [0];
  for (const aspect of aspects) sums.push(sums[sums.length - 1] + aspect);
  const cost = Array.from({ length: n + 1 }, () => Array<number>(n + 1).fill(Infinity));
  const cuts = Array.from({ length: n + 1 }, () => Array<number>(n + 1).fill(0));
  cost[0][0] = 0;
  for (let rows = 1; rows <= n; rows++) {
    for (let end = rows; end <= n; end++) {
      for (let start = rows - 1; start < end; start++) {
        const candidate = Math.max(cost[rows - 1][start], sums[end] - sums[start]);
        if (candidate < cost[rows][end]) {
          cost[rows][end] = candidate;
          cuts[rows][end] = start;
        }
      }
    }
  }
  return Array.from({ length: n }, (_, index) => {
    const ends = [n];
    for (let rows = index + 1, end = n; rows > 1; rows--) {
      end = cuts[rows][end];
      ends.unshift(end);
    }
    return ends;
  });
}

interface Block {
  rectangles: Rectangle[];
  width: number;
  height: number;
  coverage: number;
}
const ratiosOf = (aspects: readonly number[]) =>
  aspects.map(value => (Number.isFinite(value) && value > 0 ? value : DEFAULT_ASPECT));
const usable = (width: number, height: number) =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;

/** Justified rows that end at `ends`, in a block one unit wide (one unit tall when transposed into columns). */
function justify(
  values: readonly number[],
  ends: readonly number[],
  transposed: boolean,
  width: number,
  height: number,
) {
  const rectangles: Rectangle[] = [];
  let start = 0;
  let top = 0;
  for (const end of ends) {
    const sum = values.slice(start, end).reduce((total, value) => total + value, 0);
    const rowHeight = 1 / sum;
    let cumulative = 0;
    for (let index = start; index < end; index++) {
      const left = cumulative / sum;
      cumulative += values[index];
      const right = cumulative / sum;
      rectangles.push(
        transposed
          ? { left: top, top: left, width: rowHeight, height: right - left }
          : { left, top, width: right - left, height: rowHeight },
      );
    }
    top += rowHeight;
    start = end;
  }
  const blockWidth = transposed ? top : 1;
  const blockHeight = transposed ? 1 : top;
  const scale = Math.min(width / blockWidth, height / blockHeight);
  const coverage = (blockWidth * scale * blockHeight * scale) / (width * height);
  return { rectangles, width: blockWidth, height: blockHeight, coverage };
}

export interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** Whole device pixels, counted from the window's corner, so neighbours that share an edge share it exactly. */
export function snapEdges(edges: readonly Edges[], pixelRatio = 1): Rectangle[] {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const snap = (value: number) => Math.round(value * ratio);
  return edges.map(edge => {
    const left = snap(edge.left);
    const top = snap(edge.top);
    return {
      left: left / ratio,
      top: top / ratio,
      width: (snap(edge.right) - left) / ratio,
      height: (snap(edge.bottom) - top) / ratio,
    };
  });
}

/** The block stretches over the whole window; each screen then crops its picture to cover it, never leaving margins. */
export function placeFitPlan({ block }: ReturnType<typeof fitPlan>, width: number, height: number, pixelRatio = 1) {
  if (!usable(width, height)) return block.rectangles.map(() => ({ left: 0, top: 0, width: 0, height: 0 }));
  const scaleX = width / block.width;
  const scaleY = height / block.height;
  return snapEdges(
    block.rectangles.map(rectangle => ({
      left: rectangle.left * scaleX,
      top: rectangle.top * scaleY,
      right: (rectangle.left + rectangle.width) * scaleX,
      bottom: (rectangle.top + rectangle.height) * scaleY,
    })),
    pixelRatio,
  );
}

/** The rows (or, transposed, columns) that fit these videos best: where each one ends, in place order. */
export function fitPlan(aspects: readonly number[], width: number, height: number) {
  const ratios = ratiosOf(aspects);
  let best: { ends: number[]; transposed: boolean; block: Block } | undefined;
  for (const transposed of [false, true]) {
    const values = transposed ? ratios.map(value => 1 / value) : ratios;
    for (const ends of partitions(values)) {
      const block = justify(values, ends, transposed, width, height);
      // Rows win ties, including tiny floating-point differences in equivalent layouts.
      if (!best || block.coverage > best.block.coverage + 1e-12) best = { ends, transposed, block };
    }
  }
  return best!;
}

/**
 * Justified rows, then justified columns, in place order. Panes never move in the DOM. Edges fall on whole device
 * pixels for `pixelRatio`: an edge between two device pixels leaves a black seam between neighbouring videos.
 */
export function fitLayout(aspects: readonly number[], width: number, height: number, pixelRatio = 1): Rectangle[] {
  if (!aspects.length) return [];
  return placeFitPlan(fitPlan(aspects, width, height), width, height, pixelRatio);
}

/** How far the wheel magnifies a covered picture beyond covering its screen. */
export const MAX_ZOOM = 8;
/**
 * The part of a covered picture on show: x and y are object-position percentages of the magnified picture's hidden
 * width and height, and zoom (absent is 1) magnifies it around that point.
 */
export interface Crop {
  x: number;
  y: number;
  zoom?: number;
}
type Size = { width: number; height: number };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const shown = (picture: Size, box: Size) => picture.width > 0 && picture.height > 0 && box.width > 0 && box.height > 0;
/** The screen shows the turned picture flipped, so undo the flip first, then each clockwise turn. */
function onPicture(dx: number, dy: number, flip: { x: boolean; y: boolean }, turns: number) {
  let x = flip.x ? -dx : dx;
  let y = flip.y ? -dy : dy;
  for (let turn = 0; turn < turns % 4; turn++) [x, y] = [y, -x];
  return { x, y };
}
const coverScale = (picture: Size, box: Size) => Math.max(box.width / picture.width, box.height / picture.height);

/**
 * Moves a covered picture's crop so the picture follows a pointer moved by (dx, dy) screen pixels. `box` is the
 * video element's own size, before its flips and quarter turns.
 */
export function panCrop<T extends Crop>(
  crop: T,
  dx: number,
  dy: number,
  picture: Size,
  box: Size,
  flip: { x: boolean; y: boolean },
  turns: number,
): T {
  if (!shown(picture, box)) return crop;
  const by = onPicture(dx, dy, flip, turns);
  const scale = coverScale(picture, box) * (crop.zoom ?? 1);
  const move = (value: number, distance: number, spare: number) =>
    spare >= 1 ? clamp(value - (distance / spare) * 100, 0, 100) : value;
  return {
    ...crop,
    x: move(crop.x, by.x, picture.width * scale - box.width),
    y: move(crop.y, by.y, picture.height * scale - box.height),
  };
}

/**
 * Magnifies a covered picture by `factor`, between covering its screen and MAX_ZOOM, keeping the part under the
 * pointer at (dx, dy) screen pixels from the screen's centre in place. A zoom back to 1 drops it.
 */
export function zoomCrop(
  crop: Crop,
  factor: number,
  dx: number,
  dy: number,
  picture: Size,
  box: Size,
  flip: { x: boolean; y: boolean },
  turns: number,
): Crop {
  const from = crop.zoom ?? 1;
  const zoom = clamp(from * factor, 1, MAX_ZOOM);
  if (!shown(picture, box) || !Number.isFinite(zoom) || zoom === from) return crop;
  const at = onPicture(dx, dy, flip, turns);
  const scale = coverScale(picture, box);
  const keep = (value: number, offset: number, length: number, room: number) => {
    const before = length * scale * from - room;
    const after = length * scale * zoom - room;
    // A side that the screen still shows whole has nothing hidden to choose from.
    if (after < 1) return 50;
    const pointer = room / 2 + offset;
    const under = (pointer + (value / 100) * before) / (length * scale * from);
    return clamp(((under * length * scale * zoom - pointer) / after) * 100, 0, 100);
  };
  const x = keep(crop.x, at.x, picture.width, box.width);
  const y = keep(crop.y, at.y, picture.height, box.height);
  return zoom === 1 ? { x, y } : { x, y, zoom };
}
