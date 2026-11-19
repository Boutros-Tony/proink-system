/**
 * Shaped pieces nested in pairs, the way a cutter lays two sloped sides head to tail so their slopes share
 * the waste. The pair is then packed on the sheet as one rectangle. Points are mm, y up, from a blank's
 * bottom-left corner. A piece is only ever turned, never mirrored, so a one-sided board keeps its face up.
 */

export type Point = [number, number];
export type CutShape = { outer: Point[]; holes: Point[][] };
export type Nestable = { w: number; h: number; shape: CutShape };

/** Where the second piece sits in the pair's box, from its bottom-left, and whether it is turned half a turn. */
export type PairLayout = { w: number; h: number; first: { x: number; y: number; flipped: boolean }; second: { x: number; y: number; flipped: boolean } };

function turnHalf(points: Point[], w: number, h: number): Point[] {
  return points.map(([x, y]) => [w - x, h - y]);
}

function moved(points: Point[], dx: number, dy: number): Point[] {
  return points.map(([x, y]) => [x + dx, y + dy]);
}

function swapped(points: Point[]): Point[] {
  return points.map(([x, y]) => [y, x]);
}

/** The highest and lowest point of the outline on a vertical line, or null where the line misses it. */
function span(points: Point[], x: number): [number, number] | null {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    if (x < Math.min(x0, x1) - 1e-6 || x > Math.max(x0, x1) + 1e-6) continue;
    if (Math.abs(x1 - x0) < 1e-9) {
      low = Math.min(low, y0, y1);
      high = Math.max(high, y0, y1);
      continue;
    }
    const y = y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
    low = Math.min(low, y);
    high = Math.max(high, y);
  }
  return Number.isFinite(low) ? [low, high] : null;
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  const toSegment = (p: Point, s: Point, e: Point) => {
    const dx = e[0] - s[0];
    const dy = e[1] - s[1];
    const length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((p[0] - s[0]) * dx + (p[1] - s[1]) * dy) / length)) : 0;
    return Math.hypot(p[0] - s[0] - t * dx, p[1] - s[1] - t * dy);
  };
  return Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b));
}

function clearance(a: Point[], b: Point[]) {
  let least = Number.POSITIVE_INFINITY;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) least = Math.min(least, segmentDistance(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]));
  }
  return least;
}

/** How far up the second outline must sit, shifted across by dx, to clear the first by the gap. */
function lift(first: Point[], second: Point[], dx: number, gap: number) {
  const shifted = moved(second, dx, 0);
  const xs = [...first, ...shifted].map(([x]) => x);
  const lo = Math.max(Math.min(...first.map(([x]) => x)), Math.min(...shifted.map(([x]) => x)));
  const hi = Math.min(Math.max(...first.map(([x]) => x)), Math.max(...shifted.map(([x]) => x)));
  if (hi - lo < 1) return null;
  let dy = Number.NEGATIVE_INFINITY;
  for (const x of xs) {
    if (x < lo - 1e-6 || x > hi + 1e-6) continue;
    const below = span(first, x);
    const above = span(shifted, x);
    if (below && above) dy = Math.max(dy, below[1] - above[0]);
  }
  if (!Number.isFinite(dy)) return null;
  dy += gap;
  // A sloping edge is closer than the vertical gap, so lift until the edges are a full gap apart.
  for (let step = 0; step < 60 && clearance(first, moved(shifted, 0, dy)) < gap - 1e-6; step += 1) dy += Math.max(gap / 2, 0.5);
  return dy;
}

/**
 * The second piece stacked above the first, at both ends, with either piece turned. Turning the lower one
 * matters: two sides with a flat top and a sloped bottom only nest with the turned one underneath.
 */
function stacked(a: Nestable, b: Nestable, gap: number): PairLayout | null {
  let best: PairLayout | null = null;
  for (const [firstFlipped, flipped] of [[false, true], [true, false], [false, false], [true, true]]) {
    const lower = firstFlipped ? turnHalf(a.shape.outer, a.w, a.h) : a.shape.outer;
    const upper = flipped ? turnHalf(b.shape.outer, b.w, b.h) : b.shape.outer;
    for (const dx of [...new Set([0, a.w - b.w])]) {
      const dy = lift(lower, upper, dx, gap);
      if (dy === null) continue;
      const left = Math.min(0, dx);
      const bottom = Math.min(0, dy);
      const w = Math.max(a.w, dx + b.w) - left;
      const h = Math.max(a.h, dy + b.h) - bottom;
      if (!best || w * h < best.w * best.h - 0.5) best = { w, h, first: { x: -left, y: -bottom, flipped: firstFlipped }, second: { x: dx - left, y: dy - bottom, flipped } };
    }
  }
  return best;
}

/**
 * The tightest way to lay two shaped pieces together, stacked or side by side, or null when it saves
 * less than the minimum share of the two rectangles. Layouts that `fits` rejects, such as one wider than every
 * sheet, are skipped so a slightly looser one that does fit can win.
 */
/** Drop points that lie within `tolerance` of the line through their neighbours (Ramer–Douglas–Peucker on a closed ring). */
function simplified(points: Point[], tolerance: number): Point[] {
  if (points.length <= 8) return points;
  const away = (p: Point, a: Point, b: Point) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    return length < 1e-9 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / length;
  };
  const keep = new Set<number>();
  const split = (from: number, to: number) => {
    let far = -1;
    let most = tolerance;
    for (let index = from + 1; index < to; index += 1) {
      const distance = away(points[index], points[from], points[to % points.length]);
      if (distance > most) {
        most = distance;
        far = index;
      }
    }
    if (far < 0) return;
    keep.add(far);
    split(from, far);
    split(far, to);
  };
  const half = Math.floor(points.length / 2);
  keep.add(0);
  keep.add(half);
  split(0, half);
  split(half, points.length);
  return [...keep].sort((x, y) => x - y).map((index) => points[index]);
}

/** Pieces with a drawn curve have hundreds of points. Nesting tests a ring within 1 mm of it and keeps that 1 mm in the gap. */
const NEST_TOLERANCE_MM = 1;

export function nestPair(a: Nestable, b: Nestable, gap: number, minSaving = 0.05, fits: (w: number, h: number) => boolean = () => true): PairLayout | null {
  const coarse = (piece: Nestable): Nestable => ({ ...piece, shape: { outer: simplified(piece.shape.outer, NEST_TOLERANCE_MM), holes: [] } });
  const rough = a.shape.outer.length > 8 || b.shape.outer.length > 8;
  return nestCoarse(rough ? coarse(a) : a, rough ? coarse(b) : b, rough ? gap + NEST_TOLERANCE_MM : gap, minSaving, fits);
}

function nestCoarse(a: Nestable, b: Nestable, gap: number, minSaving: number, fits: (w: number, h: number) => boolean): PairLayout | null {
  const across = (first: Nestable, second: Nestable) => {
    const layout = stacked(
      { w: first.h, h: first.w, shape: { outer: swapped(first.shape.outer), holes: [] } },
      { w: second.h, h: second.w, shape: { outer: swapped(second.shape.outer), holes: [] } },
      gap,
    );
    return layout ? { w: layout.h, h: layout.w, first: { x: layout.first.y, y: layout.first.x, flipped: layout.first.flipped }, second: { x: layout.second.y, y: layout.second.x, flipped: layout.second.flipped } } : null;
  };
  // Either piece may go underneath. Laid the other way round, the roles swap back so `first` is still a.
  const swapRoles = (layout: PairLayout | null): PairLayout | null => (layout ? { w: layout.w, h: layout.h, first: layout.second, second: layout.first } : null);
  const candidates = [stacked(a, b, gap), swapRoles(stacked(b, a, gap)), across(a, b), swapRoles(across(b, a))];
  const best = candidates.filter((layout): layout is PairLayout => layout !== null && fits(layout.w, layout.h)).sort((x, y) => x.w * x.h - y.w * y.h)[0];
  if (!best) return null;
  const apart = a.w * a.h + b.w * b.h;
  return best.w * best.h <= apart * (1 - minSaving) ? best : null;
}
