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

/**
 * Justified rows, then justified columns, in place order. Panes never move in the DOM. Edges fall on whole device
 * pixels for `pixelRatio`: an edge between two device pixels leaves a black seam between neighbouring videos.
 */
export function fitLayout(aspects: readonly number[], width: number, height: number, pixelRatio = 1): Rectangle[] {
  if (!aspects.length) return [];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    return aspects.map(() => ({ left: 0, top: 0, width: 0, height: 0 }));
  const ratios = aspects.map(value => (Number.isFinite(value) && value > 0 ? value : DEFAULT_ASPECT));
  let best: { rectangles: Rectangle[]; width: number; height: number; coverage: number } | undefined;
  for (const transposed of [false, true]) {
    const values = transposed ? ratios.map(value => 1 / value) : ratios;
    for (const ends of partitions(values)) {
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
      // Rows win ties, including tiny floating-point differences in equivalent layouts.
      if (!best || coverage > best.coverage + 1e-12)
        best = { rectangles, width: blockWidth, height: blockHeight, coverage };
    }
  }
  const block = best!;
  const scale = Math.min(width / block.width, height / block.height);
  const stretch = block.coverage >= FIT_COVERAGE_THRESHOLD;
  const scaleX = stretch ? width / block.width : scale;
  const scaleY = stretch ? height / block.height : scale;
  const offsetX = (width - block.width * scaleX) / 2;
  const offsetY = (height - block.height * scaleY) / 2;
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  // Whole device pixels, counted from the window's corner, so neighbours share each edge exactly.
  const snap = (value: number) => Math.round(value * ratio);
  return block.rectangles.map(rectangle => {
    const left = snap(offsetX + rectangle.left * scaleX);
    const top = snap(offsetY + rectangle.top * scaleY);
    const right = snap(offsetX + (rectangle.left + rectangle.width) * scaleX);
    const bottom = snap(offsetY + (rectangle.top + rectangle.height) * scaleY);
    return { left: left / ratio, top: top / ratio, width: (right - left) / ratio, height: (bottom - top) / ratio };
  });
}
