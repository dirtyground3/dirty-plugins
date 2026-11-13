/** Fill the last small margin by cropping, but keep exact shapes for larger mismatches. */
export const FIT_COVERAGE_THRESHOLD = 0.9;
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

/** How a block of this size goes into the window: stretched when it covers enough of it, else centred at its shape. */
function fitBlock(blockWidth: number, blockHeight: number, width: number, height: number) {
  const scale = Math.min(width / blockWidth, height / blockHeight);
  const coverage = (blockWidth * scale * blockHeight * scale) / (width * height);
  const stretch = coverage >= FIT_COVERAGE_THRESHOLD;
  const scaleX = stretch ? width / blockWidth : scale;
  const scaleY = stretch ? height / blockHeight : scale;
  return { scaleX, scaleY, offsetX: (width - blockWidth * scaleX) / 2, offsetY: (height - blockHeight * scaleY) / 2 };
}

export function placeFitPlan({ block }: ReturnType<typeof fitPlan>, width: number, height: number, pixelRatio = 1) {
  if (!usable(width, height)) return block.rectangles.map(() => ({ left: 0, top: 0, width: 0, height: 0 }));
  const { scaleX, scaleY, offsetX, offsetY } = fitBlock(block.width, block.height, width, height);
  return snapEdges(
    block.rectangles.map(rectangle => ({
      left: offsetX + rectangle.left * scaleX,
      top: offsetY + rectangle.top * scaleY,
      right: offsetX + (rectangle.left + rectangle.width) * scaleX,
      bottom: offsetY + (rectangle.top + rectangle.height) * scaleY,
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
