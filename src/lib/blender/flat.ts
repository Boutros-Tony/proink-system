import type { Hole, OutlinePoint, ScenePart } from "@/lib/systems/modular/schema";

type Vec = [number, number, number];
type Point = [number, number];

/** A flat slab read back as a studio board: its box, its turn about the vertical, the face it is drawn on, its outline and openings. */
export type FlatBoard = Pick<ScenePart, "x" | "y" | "z" | "width" | "height" | "depth"> & Partial<Pick<ScenePart, "rotation" | "face" | "outline" | "holes">>;

/** Thicker than this is a block, not a board. */
const MAX_THICKNESS = 80;
/** How far a corner may sit off the board's two faces, in mm. */
const PLANE_TOLERANCE = 0.6;
const MAX_POINTS = 48;
const MAX_HOLES = 8;

const tenth = (value: number) => Math.round(value * 10) / 10;
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec) => Math.hypot(a[0], a[1], a[2]);

function ringArea(points: Point[]) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

function perimeter(points: Point[]) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    sum += Math.hypot(x1 - x0, y1 - y0);
  }
  return sum;
}

function offLine(point: Point, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const span = Math.hypot(dx, dy);
  if (span < 1e-9) return Math.hypot(point[0] - a[0], point[1] - a[1]);
  return Math.abs(dx * (a[1] - point[1]) - dy * (a[0] - point[0])) / span;
}

/** Drop repeated points and points on a straight run. */
function tidyRing(points: Point[], tolerance = 0.05) {
  let ring = points.filter((point, index) => {
    const next = points[(index + 1) % points.length];
    return Math.hypot(next[0] - point[0], next[1] - point[1]) > 0.01;
  });
  let changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    for (let index = 0; index < ring.length && ring.length > 3; index += 1) {
      const previous = ring[(index - 1 + ring.length) % ring.length];
      const next = ring[(index + 1) % ring.length];
      if (offLine(ring[index], previous, next) <= tolerance) {
        ring = ring.filter((_point, other) => other !== index);
        changed = true;
      }
    }
  }
  return ring;
}

function simplifyOpen(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points;
  let far = 0;
  let at = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = offLine(points[index], points[0], points[points.length - 1]);
    if (distance > far) {
      far = distance;
      at = index;
    }
  }
  if (far <= tolerance) return [points[0], points[points.length - 1]];
  return [...simplifyOpen(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplifyOpen(points.slice(at), tolerance)];
}

/** A closed ring with at most `limit` points, following the shape as closely as that allows, or null past 3 mm. */
function fewerPoints(ring: Point[], limit: number) {
  if (ring.length <= limit) return ring;
  let farthest = 0;
  ring.forEach((point, index) => {
    if (Math.hypot(point[0] - ring[0][0], point[1] - ring[0][1]) > Math.hypot(ring[farthest][0] - ring[0][0], ring[farthest][1] - ring[0][1])) farthest = index;
  });
  for (let tolerance = 0.25; tolerance <= 3; tolerance *= 1.5) {
    const first = simplifyOpen(ring.slice(0, farthest + 1), tolerance);
    const second = simplifyOpen([...ring.slice(farthest), ring[0]], tolerance);
    const result = [...first.slice(0, -1), ...second.slice(0, -1)];
    if (result.length <= limit) return result;
  }
  return null;
}

function circleThrough(a: Point, b: Point, c: Point) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const sa = a[0] ** 2 + a[1] ** 2;
  const sb = b[0] ** 2 + b[1] ** 2;
  const sc = c[0] ** 2 + c[1] ** 2;
  const cx = (sa * (b[1] - c[1]) + sb * (c[1] - a[1]) + sc * (a[1] - b[1])) / d;
  const cy = (sa * (c[0] - b[0]) + sb * (a[0] - c[0]) + sc * (b[0] - a[0])) / d;
  return { cx, cy, radius: Math.hypot(a[0] - cx, a[1] - cy) };
}

/**
 * A ring of points as an outline whose curved runs are true arc edges: three or more short edges on one circle,
 * turning one way, become one edge with its bulge. An arc is at most a half circle.
 */
function fitArcs(ring: Point[]): OutlinePoint[] {
  const n = ring.length;
  const at = (index: number) => ring[((index % n) + n) % n];
  const bend = (index: number) => {
    const [p, q, r] = [at(index - 1), at(index), at(index + 1)];
    const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
    const b = Math.atan2(r[1] - q[1], r[0] - q[0]);
    return Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));
  };
  // Start on the sharpest corner so no arc is split where the ring begins.
  let start = 0;
  for (let index = 1; index < n; index += 1) if (bend(index) > bend(start)) start = index;
  const points = ring.map((_point, index) => at(start + index));
  const point = (index: number) => points[index % n];
  const out: OutlinePoint[] = [];
  let index = 0;
  while (index < n) {
    let end = -1;
    let bulge = 0;
    let side = 0;
    const first = Math.hypot(point(index + 1)[0] - point(index)[0], point(index + 1)[1] - point(index)[1]);
    for (let last = index + 2; last <= n; last += 1) {
      // An arc is drawn with even, short steps and no corner in it: a long straight edge or a sharp joint ends it.
      const span = Math.hypot(point(last)[0] - point(last - 1)[0], point(last)[1] - point(last - 1)[1]);
      if (span > first * 3 || span < first / 3) break;
      if (bend(start + last - 1) > Math.PI / 6) break;
      const step = Math.sign((point(last - 1)[0] - point(last - 2)[0]) * (point(last)[1] - point(last - 1)[1]) - (point(last - 1)[1] - point(last - 2)[1]) * (point(last)[0] - point(last - 1)[0]));
      if (step === 0 || (side !== 0 && step !== side)) break;
      side = step;
      const circle = circleThrough(point(index), point(Math.floor((index + last) / 2)), point(last));
      if (!circle || circle.radius > 100_000) break;
      let sweep = 0;
      let fits = true;
      for (let inner = index; inner < last; inner += 1) {
        const [p, q] = [point(inner), point(inner + 1)];
        if (Math.abs(Math.hypot(q[0] - circle.cx, q[1] - circle.cy) - circle.radius) > 0.35) fits = false;
        const u = [p[0] - circle.cx, p[1] - circle.cy];
        const v = [q[0] - circle.cx, q[1] - circle.cy];
        sweep += Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
      }
      if (!fits || Math.abs(sweep) > Math.PI + 0.01) break;
      if (last - index >= 3) {
        end = last;
        bulge = Math.tan(sweep / 4);
      }
    }
    const [u, v] = point(index);
    if (end > 0) {
      out.push([tenth(u), tenth(v), Math.round(bulge * 10_000) / 10_000]);
      index = end;
    } else {
      out.push([tenth(u), tenth(v)]);
      index += 1;
    }
  }
  return out;
}

/** The face's edges used by one triangle only, walked into closed rings. */
function boundaryRings(triangles: Point[][]) {
  const key = ([u, v]: Point) => `${Math.round(u * 100)},${Math.round(v * 100)}`;
  const points = new Map<string, Point>();
  const count = new Map<string, number>();
  const directed: [string, string][] = [];
  for (const triangle of triangles) {
    for (let index = 0; index < 3; index += 1) {
      const a = key(triangle[index]);
      const b = key(triangle[(index + 1) % 3]);
      if (a === b) continue;
      points.set(a, triangle[index]);
      points.set(b, triangle[(index + 1) % 3]);
      const undirected = a < b ? `${a}|${b}` : `${b}|${a}`;
      count.set(undirected, (count.get(undirected) ?? 0) + 1);
      directed.push([a, b]);
    }
  }
  const next = new Map<string, string[]>();
  for (const [a, b] of directed) {
    if (count.get(a < b ? `${a}|${b}` : `${b}|${a}`) !== 1) continue;
    next.set(a, [...(next.get(a) ?? []), b]);
  }
  const rings: Point[][] = [];
  for (const start of [...next.keys()]) {
    while ((next.get(start)?.length ?? 0) > 0) {
      const ring: Point[] = [];
      let at = start;
      for (let guard = 0; guard < 100_000; guard += 1) {
        const ways = next.get(at);
        if (!ways || ways.length === 0) break;
        const to = ways.shift()!;
        ring.push(points.get(at)!);
        at = to;
        if (at === start) break;
      }
      if (at === start && ring.length >= 3) rings.push(ring);
    }
  }
  return rings;
}

/** A plain rectangular or round opening as the studio cuts it, or null for any other shape. */
function openingOf(ring: Point[]): Hole | null {
  const tidy = tidyRing(ring, 0.2);
  const us = tidy.map(([u]) => u);
  const vs = tidy.map(([, v]) => v);
  const [minU, maxU, minV, maxV] = [Math.min(...us), Math.max(...us), Math.min(...vs), Math.max(...vs)];
  const square = tidy.length === 4 && tidy.every(([u, v]) => (Math.abs(u - minU) < 0.5 || Math.abs(u - maxU) < 0.5) && (Math.abs(v - minV) < 0.5 || Math.abs(v - maxV) < 0.5));
  if (square) return { x: tenth(Math.max(0, minU)), y: tenth(Math.max(0, minV)), width: tenth(maxU - minU), height: tenth(maxV - minV) };
  if (ring.length >= 8) {
    const cu = ring.reduce((sum, [u]) => sum + u, 0) / ring.length;
    const cv = ring.reduce((sum, [, v]) => sum + v, 0) / ring.length;
    const radii = ring.map(([u, v]) => Math.hypot(u - cu, v - cv));
    const radius = radii.reduce((sum, value) => sum + value, 0) / radii.length;
    if (radius > 0.5 && Math.max(...radii) - Math.min(...radii) <= Math.max(0.5, radius * 0.03)) {
      const r = tenth(radius);
      return { x: tenth(Math.max(0, cu - radius)), y: tenth(Math.max(0, cv - radius)), width: tenth(r * 2), height: tenth(r * 2), corners: { topLeft: r, topRight: r, bottomLeft: r, bottomRight: r } };
    }
  }
  return null;
}

function hull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const turn = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Degrees about the vertical that line a lying board's smallest rectangle up with its width, between -45 and 45. */
function lyingTurn(points: Point[]) {
  const ring = hull(points);
  let best = { area: Infinity, degrees: 0 };
  for (let index = 0; index < ring.length; index += 1) {
    const [x0, z0] = ring[index];
    const [x1, z1] = ring[(index + 1) % ring.length];
    const angle = Math.atan2(z1 - z0, x1 - x0);
    const [c, s] = [Math.cos(angle), Math.sin(angle)];
    const us = ring.map(([x, z]) => x * c + z * s);
    const vs = ring.map(([x, z]) => -x * s + z * c);
    const area = (Math.max(...us) - Math.min(...us)) * (Math.max(...vs) - Math.min(...vs));
    if (area < best.area - 1e-6) best = { area, degrees: (-angle * 180) / Math.PI };
  }
  let degrees = best.degrees;
  while (degrees > 45) degrees -= 90;
  while (degrees <= -45) degrees += 90;
  return Math.abs(degrees) < 0.05 ? 0 : tenth(degrees);
}

/**
 * A mesh from Blender read as a board the studio can cut: two flat faces a board's thickness apart, standing
 * upright or lying flat, every corner on one face or the other. Its outline comes from the front face's edges,
 * and its openings when each is a rectangle or a circle. Anything else stays a custom piece: null.
 * `points` are in studio millimeters and axes, where the piece stands.
 */
export function flatBoard(points: Vec[], indices: ArrayLike<number> | null): FlatBoard | null {
  if (points.length < 6) return null;
  const order = indices && indices.length >= 3 ? Array.from(indices) : points.map((_point, index) => index);
  const triangles: { corners: Vec[]; normal: Vec; area: number }[] = [];
  let total = 0;
  for (let index = 0; index + 2 < order.length; index += 3) {
    const corners = [points[order[index]], points[order[index + 1]], points[order[index + 2]]];
    if (corners.some((corner) => !corner)) return null;
    const normal = cross(sub(corners[1], corners[0]), sub(corners[2], corners[0]));
    const size = length(normal);
    if (size < 1e-6) continue;
    triangles.push({ corners, normal: normal.map((value) => value / size) as Vec, area: size / 2 });
    total += size / 2;
  }
  if (triangles.length < 4 || total <= 0) return null;

  const largest = triangles.reduce((best, triangle) => (triangle.area > best.area ? triangle : best));
  const sum: Vec = [0, 0, 0];
  for (const triangle of triangles) {
    const along = dot(triangle.normal, largest.normal);
    if (Math.abs(along) < 0.9995) continue;
    for (let axis = 0; axis < 3; axis += 1) sum[axis] += Math.sign(along) * triangle.normal[axis] * triangle.area;
  }
  let normal = sum.map((value) => value / length(sum)) as Vec;
  const lying = Math.abs(normal[1]) > 0.9998;
  if (!lying && Math.abs(normal[1]) > 0.0175) return null;

  let degrees: number;
  if (lying) {
    normal = [0, 1, 0];
    degrees = lyingTurn(points.map(([x, , z]) => [x, z] as Point));
  } else {
    normal = [normal[0], 0, normal[2]].map((value) => value / Math.hypot(normal[0], normal[2])) as Vec;
    degrees = (Math.atan2(normal[0], normal[2]) * 180) / Math.PI;
    if (degrees > 90) degrees -= 180;
    if (degrees <= -90) degrees += 180;
    degrees = Math.abs(degrees) < 0.05 ? 0 : tenth(degrees);
    const radians = (degrees * Math.PI) / 180;
    normal = [Math.sin(radians), 0, Math.cos(radians)];
  }

  // Every corner on one of the two faces: a board with square edges, not a bevel or a wedge.
  const levels = points.map((point) => dot(point, normal));
  const low = Math.min(...levels);
  const high = Math.max(...levels);
  const thickness = high - low;
  if (thickness < 1 || thickness > MAX_THICKNESS) return null;
  if (levels.some((level) => Math.min(level - low, high - level) > PLANE_TOLERANCE)) return null;

  const radians = (degrees * Math.PI) / 180;
  const [c, s] = [Math.cos(radians), Math.sin(radians)];
  const local = ([x, y, z]: Vec): Vec => [x * c - z * s, y, x * s + z * c];
  const locals = points.map(local);
  const min = [0, 1, 2].map((axis) => Math.min(...locals.map((point) => point[axis])));
  const max = [0, 1, 2].map((axis) => Math.max(...locals.map((point) => point[axis])));
  const face = (point: Vec): Point => {
    const [a, b, cc] = local(point);
    return lying ? [a - min[0], max[2] - cc] : [a - min[0], b - min[1]];
  };
  const faceRings = (sign: 1 | -1) =>
    boundaryRings(triangles.filter((triangle) => dot(triangle.normal, normal) * sign > 0.9995).map((triangle) => triangle.corners.map(face)));
  const front = faceRings(1);
  const back = faceRings(-1);
  if (front.length === 0 || back.length !== front.length) return null;
  const frontArea = front.reduce((sum, ring) => sum + ringArea(ring), 0);
  const backArea = back.reduce((sum, ring) => sum + ringArea(ring), 0);
  const frontEdge = front.reduce((sum, ring) => sum + perimeter(ring), 0);
  const backEdge = back.reduce((sum, ring) => sum + perimeter(ring), 0);
  if (Math.abs(Math.abs(frontArea) - Math.abs(backArea)) > Math.abs(frontArea) * 0.01) return null;
  if (Math.abs(frontEdge - backEdge) > frontEdge * 0.01) return null;

  const width = max[0] - min[0];
  const tall = lying ? max[2] - min[2] : max[1] - min[1];
  const rings = front.map((ring) => tidyRing(ring)).filter((ring) => ring.length >= 3);
  rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
  let outer = rings[0];
  if (!outer) return null;
  if (ringArea(outer) < 0) outer = [...outer].reverse();
  const openings = rings.slice(1);
  if (openings.length > MAX_HOLES) return null;
  const holes: Hole[] = [];
  for (const ring of openings) {
    const hole = openingOf(ring);
    if (!hole) return null;
    holes.push(hole);
  }
  const plain = outer.length === 4 && outer.every(([u, v]) => (Math.abs(u) < 0.5 || Math.abs(u - width) < 0.5) && (Math.abs(v) < 0.5 || Math.abs(v - tall) < 0.5));
  let outline: OutlinePoint[] | null = null;
  if (!plain) {
    const arcs = fitArcs(outer);
    outline = arcs.length <= MAX_POINTS ? arcs : (fewerPoints(outer, MAX_POINTS)?.map(([u, v]) => [tenth(u), tenth(v)] as OutlinePoint) ?? null);
    if (!outline) return null;
  }

  const mid = [0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2);
  // Back from the board's own frame to where it stands: the inverse of `local`.
  const center: Vec = [mid[0] * c + mid[2] * s, mid[1], -mid[0] * s + mid[2] * c];
  const size = { width: tenth(width), height: tenth(max[1] - min[1]), depth: tenth(max[2] - min[2]) };
  return {
    x: tenth(center[0] - size.width / 2),
    y: tenth(center[1] - size.height / 2),
    z: tenth(center[2] - size.depth / 2),
    ...size,
    ...(degrees ? { rotation: degrees } : {}),
    ...(lying ? { face: "top" as const } : {}),
    ...(outline ? { outline } : {}),
    ...(holes.length > 0 ? { holes } : {}),
  };
}
