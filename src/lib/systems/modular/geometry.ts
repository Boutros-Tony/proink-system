import type { Chamfers, CornerRadii, Curve, EdgeId, Envelope, Hole, Outline, OutlinePoint, PartShape, ShapedFace } from "./schema";

export const POST_SIZE = 40;

export function edgeLength(edge: EdgeId, envelope: Pick<Envelope, "width" | "depth">) {
  return edge === "back" || edge === "front" ? envelope.width : envelope.depth;
}

export function pointAlong(edge: EdgeId, distance: number, envelope: Pick<Envelope, "width" | "depth">) {
  if (edge === "back") return { x: distance, z: 0 };
  if (edge === "front") return { x: distance, z: envelope.depth };
  if (edge === "left") return { x: 0, z: distance };
  return { x: envelope.width, z: distance };
}

export function inward(edge: EdgeId): { x: number; z: number } {
  if (edge === "back") return { x: 0, z: 1 };
  if (edge === "front") return { x: 0, z: -1 };
  if (edge === "left") return { x: 1, z: 0 };
  return { x: -1, z: 0 };
}

/**
 * Keep corner radii inside the front face. Two radii on one edge share that edge.
 * All-zero radii are dropped so a square box stays a plain box.
 */
export function clampCorners(width: number, height: number, corners: CornerRadii | undefined): CornerRadii | undefined {
  if (!corners || width <= 0 || height <= 0) return undefined;
  const clean = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
  let topLeft = clean(corners.topLeft);
  let topRight = clean(corners.topRight);
  let bottomLeft = clean(corners.bottomLeft);
  let bottomRight = clean(corners.bottomRight);
  const fit = (a: number, b: number, max: number) => {
    const sum = a + b;
    if (sum <= max || sum === 0) return [a, b] as const;
    const scale = max / sum;
    return [a * scale, b * scale] as const;
  };
  for (let pass = 0; pass < 2; pass += 1) {
    [topLeft, topRight] = fit(topLeft, topRight, width);
    [bottomLeft, bottomRight] = fit(bottomLeft, bottomRight, width);
    [topLeft, bottomLeft] = fit(topLeft, bottomLeft, height);
    [topRight, bottomRight] = fit(topRight, bottomRight, height);
  }
  const rounded = {
    ...(topLeft ? { topLeft } : {}),
    ...(topRight ? { topRight } : {}),
    ...(bottomLeft ? { bottomLeft } : {}),
    ...(bottomRight ? { bottomRight } : {}),
  };
  return Object.keys(rounded).length > 0 ? rounded : undefined;
}

export type ResolvedCorner = { radius: number; cutX: number; cutY: number };
export type ResolvedFront = {
  topLeft: ResolvedCorner;
  topRight: ResolvedCorner;
  bottomLeft: ResolvedCorner;
  bottomRight: ResolvedCorner;
};

/**
 * The front face of a box, with each corner either square, rounded, or cut straight.
 * A straight cut wins over a radius on the same corner. Cuts and radii are shrunk so
 * two of them never overlap on one edge.
 */
export function resolveFront(width: number, height: number, corners: CornerRadii | undefined, chamfers: Chamfers | undefined): ResolvedFront | undefined {
  if (!(width > 0) || !(height > 0)) return undefined;
  const size = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
  const corner = (radius: number | undefined, cut: { x?: number; y?: number } | undefined): ResolvedCorner => {
    const cutX = size(cut?.x);
    const cutY = size(cut?.y);
    if (cutX > 0 && cutY > 0) return { radius: 0, cutX, cutY };
    return { radius: size(radius), cutX: 0, cutY: 0 };
  };
  const face: ResolvedFront = {
    topLeft: corner(corners?.topLeft, chamfers?.topLeft),
    topRight: corner(corners?.topRight, chamfers?.topRight),
    bottomLeft: corner(corners?.bottomLeft, chamfers?.bottomLeft),
    bottomRight: corner(corners?.bottomRight, chamfers?.bottomRight),
  };
  const alongX = (item: ResolvedCorner) => (item.cutX > 0 ? item.cutX : item.radius);
  const alongY = (item: ResolvedCorner) => (item.cutY > 0 ? item.cutY : item.radius);
  const fit = (a: number, b: number, max: number) => {
    const sum = a + b;
    if (sum <= max || sum === 0) return [1, 1] as const;
    const scale = max / sum;
    return [a > 0 ? scale : 1, b > 0 ? scale : 1] as const;
  };
  const scaleX = (item: ResolvedCorner, factor: number): ResolvedCorner =>
    item.cutX > 0 ? { ...item, cutX: item.cutX * factor } : { ...item, radius: item.radius * factor };
  const scaleY = (item: ResolvedCorner, factor: number): ResolvedCorner =>
    item.cutY > 0 ? { ...item, cutY: item.cutY * factor } : { ...item, radius: item.radius * factor };

  for (let pass = 0; pass < 2; pass += 1) {
    const top = fit(alongX(face.topLeft), alongX(face.topRight), width);
    face.topLeft = scaleX(face.topLeft, top[0]);
    face.topRight = scaleX(face.topRight, top[1]);
    const bottom = fit(alongX(face.bottomLeft), alongX(face.bottomRight), width);
    face.bottomLeft = scaleX(face.bottomLeft, bottom[0]);
    face.bottomRight = scaleX(face.bottomRight, bottom[1]);
    const left = fit(alongY(face.topLeft), alongY(face.bottomLeft), height);
    face.topLeft = scaleY(face.topLeft, left[0]);
    face.bottomLeft = scaleY(face.bottomLeft, left[1]);
    const right = fit(alongY(face.topRight), alongY(face.bottomRight), height);
    face.topRight = scaleY(face.topRight, right[0]);
    face.bottomRight = scaleY(face.bottomRight, right[1]);
  }

  const shaped = Object.values(face).some((item) => item.radius > 0 || (item.cutX > 0 && item.cutY > 0));
  return shaped ? face : undefined;
}

/** Keep straight cuts inside the front face, and remember a half-entered cut so the first number is not lost. */
export function clampChamfers(width: number, height: number, chamfers: Chamfers | undefined): Chamfers | undefined {
  if (!chamfers || !(width > 0) || !(height > 0)) return undefined;
  const size = (value: number | undefined) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0);
  const keys = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;
  const face = resolveFront(width, height, undefined, chamfers);
  const kept: Chamfers = {};
  for (const key of keys) {
    const cut = face?.[key];
    if (cut && cut.cutX > 0 && cut.cutY > 0) {
      kept[key] = { x: cut.cutX, y: cut.cutY };
      continue;
    }
    const x = Math.min(size(chamfers[key]?.x), width);
    const y = Math.min(size(chamfers[key]?.y), height);
    if (x > 0 || y > 0) kept[key] = { x, y };
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

type Point = [number, number];

function signedArea(points: Point[]) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum / 2;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point) {
  const side = (p: Point, q: Point, r: Point) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = side(c, d, a);
  const d2 = side(c, d, b);
  const d3 = side(a, b, c);
  const d4 = side(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function ringCrosses(points: Point[]) {
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** Past this the arc wraps nearly all the way round (bulge 4 is about 300°). */
const MAX_BULGE = 4;

/** The bulge of the edge leaving this point: 0 straight, 1 a half circle, positive outward on a counterclockwise outline. */
export function bulgeOf(point: OutlinePoint) {
  const bulge = point[2] ?? 0;
  return Number.isFinite(bulge) ? Math.max(-MAX_BULGE, Math.min(MAX_BULGE, bulge)) : 0;
}

function withBulge(point: Point, bulge: number): OutlinePoint {
  return Math.abs(bulge) >= 0.001 ? [point[0], point[1], Math.round(bulge * 1000) / 1000] : [point[0], point[1]];
}

/**
 * The circle an arc edge runs on, from a to b: its center, radius, start angle, and signed sweep, counterclockwise
 * for a positive bulge. Nothing for a straight edge.
 */
export function edgeArc(a: Point, b: Point, bulge: number) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const chord = Math.hypot(dx, dy);
  if (Math.abs(bulge) < 0.001 || chord < 1e-6) return null;
  const sweep = 4 * Math.atan(bulge);
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const offset = (chord * (1 - bulge * bulge)) / (4 * bulge);
  const cx = (a[0] + b[0]) / 2 - (dy / chord) * offset;
  const cy = (a[1] + b[1]) / 2 + (dx / chord) * offset;
  return { cx, cy, radius, start: Math.atan2(a[1] - cy, a[0] - cx), sweep, length: radius * Math.abs(sweep) };
}

/** The points along an arc edge after its start, within `tolerance` mm of the true curve, ending before b. */
function arcPoints(arc: NonNullable<ReturnType<typeof edgeArc>>, tolerance: number): Point[] {
  const step = Math.min(Math.PI / 12, 2 * Math.acos(Math.max(-1, 1 - tolerance / arc.radius)) || Math.PI / 12);
  const steps = Math.min(256, Math.max(4, Math.ceil(Math.abs(arc.sweep) / step)));
  const points: Point[] = [];
  for (let index = 1; index < steps; index += 1) {
    const angle = arc.start + (arc.sweep * index) / steps;
    points.push([arc.cx + arc.radius * Math.cos(angle), arc.cy + arc.radius * Math.sin(angle)]);
  }
  return points;
}

/**
 * The outline as straight cuts, every arc edge followed within `tolerance` mm. Area, nesting, and the inside test
 * use this. The 3D view and the cutting sheets use it too, at the default 0.25 mm, which is finer than a cut.
 */
export function outlineRing(outline: Outline, tolerance = 0.25): Point[] {
  return pathPoints(outline, true, tolerance);
}

/** A run of points with arc edges as straight cuts, closed back to the first point or not. An open run ignores the last bulge. */
export function pathPoints(path: Outline, closed: boolean, tolerance = 0.25): Point[] {
  const points: Point[] = [];
  path.forEach((point, index) => {
    const a: Point = [point[0], point[1]];
    pushPoint(points, a);
    if (!closed && index === path.length - 1) return;
    const next = path[(index + 1) % path.length];
    const arc = edgeArc(a, [next[0], next[1]], bulgeOf(point));
    if (arc) for (const along of arcPoints(arc, tolerance)) pushPoint(points, along);
  });
  if (closed) closeRing(points);
  return points;
}

/** The length along a run of points, arcs included, in mm. */
export function pathLength(path: Outline, closed: boolean) {
  let length = 0;
  path.forEach((point, index) => {
    if (!closed && index === path.length - 1) return;
    const next = path[(index + 1) % path.length];
    const arc = edgeArc([point[0], point[1]], [next[0], next[1]], bulgeOf(point));
    length += arc ? arc.length : Math.hypot(next[0] - point[0], next[1] - point[1]);
  });
  return length;
}

/** Whether a path can close into a loop: three points, or two with an arc between them, such as a hoop. */
export function closable(path: Outline) {
  return path.length > 2 || (path.length === 2 && path.some((point) => bulgeOf(point) !== 0));
}

/** A path kept on its face: points clamped to it, repeats dropped, arcs flattened to stay on it. Nothing under two points. */
export function clampPath(width: number, height: number, path: Outline | undefined, closed: boolean): Outline | undefined {
  if (!path?.length) return undefined;
  const at = (value: number, max: number) => Math.round(Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), max) * 10) / 10;
  const points: Outline = [];
  for (const raw of path) {
    const point = withBulge([at(raw[0], width), at(raw[1], height)], bulgeOf(raw));
    const last = points[points.length - 1];
    if (last && Math.abs(last[0] - point[0]) < 0.5 && Math.abs(last[1] - point[1]) < 0.5) continue;
    points.push(point);
  }
  if (closed && points.length > 2 && Math.abs(points[0][0] - points[points.length - 1][0]) < 0.5 && Math.abs(points[0][1] - points[points.length - 1][1]) < 0.5) points.pop();
  if (points.length < 2) return undefined;
  return points.map((point, index) => {
    const bulge = bulgeOf(point);
    if (bulge === 0 || (!closed && index === points.length - 1)) return withBulge([point[0], point[1]], closed || index < points.length - 1 ? bulge : 0);
    const next = points[(index + 1) % points.length];
    return withBulge([point[0], point[1]], fitBulge([point[0], point[1]], [next[0], next[1]], bulge, width, height));
  });
}

/** Whether two edges of the outline cross, arcs included, which would leave no single piece to cut. */
export function outlineCrosses(outline: Outline) {
  return ringCrosses(outlineRing(outline, 2));
}

/** The outline run the other way round. Each arc moves to the point it now leaves from and turns the other way. */
export function reverseOutline(outline: Outline): Outline {
  const n = outline.length;
  return outline.map((_, k) => withBulge([outline[n - 1 - k][0], outline[n - 1 - k][1]], -bulgeOf(outline[(2 * n - 2 - k) % n])));
}

/** The outline mirrored across its diagonal, x and y trading places, put back counterclockwise. */
export function swapOutlineAxes(outline: Outline): Outline {
  return reverseOutline(outline.map((point) => withBulge([point[1], point[0]], -bulgeOf(point))));
}

/** Whether the arc stays on the face: its ends, and each point where it is furthest left, right, up, or down. */
function arcInside(a: Point, b: Point, bulge: number, width: number, height: number) {
  const arc = edgeArc(a, b, bulge);
  if (!arc) return true;
  const on = ([x, y]: Point) => x >= -0.05 && x <= width + 0.05 && y >= -0.05 && y <= height + 0.05;
  if (!on(a) || !on(b)) return false;
  const low = Math.min(arc.start, arc.start + arc.sweep);
  const high = Math.max(arc.start, arc.start + arc.sweep);
  for (let quarter = Math.ceil(low / (Math.PI / 2)); quarter * (Math.PI / 2) <= high; quarter += 1) {
    const angle = quarter * (Math.PI / 2);
    if (!on([arc.cx + arc.radius * Math.cos(angle), arc.cy + arc.radius * Math.sin(angle)])) return false;
  }
  return true;
}

/** The largest bulge, up to the one asked, whose arc stays on the face. */
function fitBulge(a: Point, b: Point, bulge: number, width: number, height: number) {
  if (arcInside(a, b, bulge, width, height)) return bulge;
  let low = 0;
  let high = Math.abs(bulge);
  for (let step = 0; step < 14; step += 1) {
    const mid = (low + high) / 2;
    if (arcInside(a, b, Math.sign(bulge) * mid, width, height)) low = mid;
    else high = mid;
  }
  return Math.sign(bulge) * low;
}

/**
 * Keep a free outline on its face: points inside the face, an arc flattened just enough to stay on it, repeats and
 * points on a straight run dropped, counterclockwise. Nothing is kept for fewer than three points, no area,
 * crossing edges, or the plain rectangle.
 */
export function clampOutline(width: number, height: number, outline: Outline | undefined): Outline | undefined {
  if (!outline?.length || !(width > 0) || !(height > 0)) return undefined;
  const at = (value: number, max: number) => Math.round(Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), max) * 10) / 10;
  const same = (a: OutlinePoint, b: OutlinePoint) => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;
  let points: Outline = [];
  for (const raw of outline) {
    const point = withBulge([at(raw[0], width), at(raw[1], height)], bulgeOf(raw));
    const last = points[points.length - 1];
    if (last && same(last, point)) {
      if (bulgeOf(point) !== 0) points[points.length - 1] = withBulge([last[0], last[1]], bulgeOf(point));
      continue;
    }
    points.push(point);
  }
  while (points.length > 1 && same(points[0], points[points.length - 1])) points.pop();
  for (let changed = true; changed && points.length > 3; ) {
    changed = false;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[(index - 1 + points.length) % points.length];
      const b = points[index];
      const c = points[(index + 1) % points.length];
      if (bulgeOf(a) !== 0 || bulgeOf(b) !== 0) continue;
      const turn = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.abs(turn) <= 0.5 * Math.hypot(c[0] - a[0], c[1] - a[1])) {
        points = points.filter((_, kept) => kept !== index);
        changed = true;
        break;
      }
    }
  }
  points = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const bulge = bulgeOf(point);
    return bulge === 0 ? point : withBulge([point[0], point[1]], fitBulge([point[0], point[1]], [next[0], next[1]], bulge, width, height));
  });
  if (points.length < 2) return undefined;
  const ring = outlineRing(points, 2);
  if (ring.length < 3 || Math.abs(signedArea(ring)) < 1 || ringCrosses(ring)) return undefined;
  if (signedArea(ring) < 0) points = reverseOutline(points);
  const box = points.length === 4 && points.every((point) => bulgeOf(point) === 0 && (point[0] === 0 || point[0] === width) && (point[1] === 0 || point[1] === height));
  return box ? undefined : points;
}

/** The outline stretched to a new face size, so a resized piece keeps its shape. An arc keeps its bulge, so it stays round. */
export function scaleOutline(outline: Outline, from: { width: number; height: number }, to: { width: number; height: number }): Outline {
  const sx = from.width > 0 ? to.width / from.width : 1;
  const sy = from.height > 0 ? to.height / from.height : 1;
  return outline.map((point) => withBulge([Math.round(point[0] * sx * 10) / 10, Math.round(point[1] * sy * 10) / 10], bulgeOf(point)));
}

/** Perimeter, split into straight and curved edge, area, and edge count of a free outline, in mm. */
export function outlineMeasure(outline: Outline) {
  let straight = 0;
  let curved = 0;
  let curvedEdges = 0;
  // The area between each arc and its chord, signed like the arc, on top of the polygon through the points.
  let segments = 0;
  outline.forEach((point, index) => {
    const next = outline[(index + 1) % outline.length];
    const arc = edgeArc([point[0], point[1]], [next[0], next[1]], bulgeOf(point));
    if (arc) {
      curved += arc.length;
      curvedEdges += 1;
      segments += Math.sign(arc.sweep) * ((arc.radius * arc.radius) / 2) * (Math.abs(arc.sweep) - Math.sin(Math.abs(arc.sweep)));
    } else straight += Math.hypot(next[0] - point[0], next[1] - point[1]);
  });
  const area = Math.abs(signedArea(outline.map((point) => [point[0], point[1]] as Point)) + segments);
  return { perimeter: straight + curved, straight, curved, area, edges: outline.length, curvedEdges };
}

/** Whether a point is inside the outline, arcs included. */
export function insideOutline(outline: Outline, [x, y]: Point) {
  const ring = outlineRing(outline, 1);
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Board left around a closed opening, so the piece does not fall apart. */
export const HOLE_RIM_MM = 5;

/**
 * Keep openings inside the front face with a rim of board around them. An opening that starts
 * within 1 mm of the bottom is open at the bottom, and it stays clear of the face's bottom corners.
 * An opening that overlaps an earlier one is dropped, since the two would be one cut.
 * On a free outline every opening is closed and must sit inside the shape; a notch belongs in the outline itself.
 */
export function clampHoles(width: number, height: number, holes: Hole[] | undefined, corners?: CornerRadii, chamfers?: Chamfers, outline?: Outline): Hole[] | undefined {
  if (!holes?.length || !(width > 0) || !(height > 0)) return undefined;
  const face = outline ? undefined : resolveFront(width, height, corners, chamfers);
  const across = (corner: ResolvedCorner | undefined) => (corner ? (corner.cutX > 0 ? corner.cutX : corner.radius) : 0);
  const kept: Hole[] = [];
  for (const raw of holes) {
    const hole = outline && raw.y < 1 ? { ...raw, y: HOLE_RIM_MM } : raw;
    const open = hole.y < 1;
    const left = open ? across(face?.bottomLeft) + HOLE_RIM_MM : HOLE_RIM_MM;
    const right = width - (open ? across(face?.bottomRight) + HOLE_RIM_MM : HOLE_RIM_MM);
    const x = Math.max(left, hole.x);
    const y = open ? 0 : Math.max(HOLE_RIM_MM, hole.y);
    const w = Math.min(hole.width, right - x);
    const h = Math.min(hole.height, height - HOLE_RIM_MM - y);
    if (!(w >= 1) || !(h >= 1)) continue;
    const corners4: Point[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    if (outline && !corners4.every((point) => insideOutline(outline, point))) continue;
    if (kept.some((other) => x < other.x + other.width && other.x < x + w && y < other.y + other.height && other.y < y + h)) continue;
    const rounded = clampCorners(w, h, hole.corners);
    if (open && rounded) {
      delete rounded.bottomLeft;
      delete rounded.bottomRight;
    }
    kept.push({ x, y, width: w, height: h, ...(rounded && Object.keys(rounded).length > 0 ? { corners: rounded } : {}) });
  }
  return kept.length > 0 ? kept : undefined;
}

/** The shaped face of a box: its two sizes as drawn, and the thickness through it. */
export function faceAxes(part: { width: number; height: number; depth: number; face?: ShapedFace }) {
  if (part.face === "top") return { face: "top" as const, width: part.width, height: part.depth, thickness: part.height };
  if (part.face === "side") return { face: "side" as const, width: part.depth, height: part.height, thickness: part.width };
  return { face: "front" as const, width: part.width, height: part.height, thickness: part.depth };
}

const ARC_STEPS = 8;

function pushPoint(points: Point[], point: Point) {
  const last = points[points.length - 1];
  if (last && Math.abs(last[0] - point[0]) < 1e-6 && Math.abs(last[1] - point[1]) < 1e-6) return;
  points.push(point);
}

/** A quarter-circle as 8 straight cuts. The start point is already on the outline. */
function pushArc(points: Point[], cx: number, cy: number, radius: number, start: number, end: number, clockwise: boolean) {
  const twoPi = Math.PI * 2;
  let delta = end - start;
  const same = Math.abs(delta) < 1e-12;
  while (delta < 0) delta += twoPi;
  while (delta > twoPi) delta -= twoPi;
  if (delta < 1e-12) delta = same ? 0 : twoPi;
  if (clockwise && !same) delta = delta === twoPi ? -twoPi : delta - twoPi;
  for (let step = 1; step <= ARC_STEPS; step += 1) {
    const angle = start + (step / ARC_STEPS) * delta;
    pushPoint(points, [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
}

function closeRing(points: Point[]) {
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) points.pop();
}

function holeRing(hole: Hole): Point[] {
  const square: ResolvedCorner = { radius: 0, cutX: 0, cutY: 0 };
  const face = resolveFront(hole.width, hole.height, hole.corners, undefined) ?? { topLeft: square, topRight: square, bottomLeft: square, bottomRight: square };
  const x0 = hole.x;
  const y0 = hole.y;
  const x1 = x0 + hole.width;
  const y1 = y0 + hole.height;
  const radius = (corner: ResolvedCorner) => corner.radius;
  const points: Point[] = [];
  pushPoint(points, [x0 + radius(face.bottomLeft), y0]);
  pushPoint(points, [x1 - radius(face.bottomRight), y0]);
  if (radius(face.bottomRight) > 0) pushArc(points, x1 - radius(face.bottomRight), y0 + radius(face.bottomRight), radius(face.bottomRight), -Math.PI / 2, 0, false);
  pushPoint(points, [x1, y1 - radius(face.topRight)]);
  if (radius(face.topRight) > 0) pushArc(points, x1 - radius(face.topRight), y1 - radius(face.topRight), radius(face.topRight), 0, Math.PI / 2, false);
  pushPoint(points, [x0 + radius(face.topLeft), y1]);
  if (radius(face.topLeft) > 0) pushArc(points, x0 + radius(face.topLeft), y1 - radius(face.topLeft), radius(face.topLeft), Math.PI / 2, Math.PI, false);
  pushPoint(points, [x0, y0 + radius(face.bottomLeft)]);
  if (radius(face.bottomLeft) > 0) pushArc(points, x0 + radius(face.bottomLeft), y0 + radius(face.bottomLeft), radius(face.bottomLeft), Math.PI, Math.PI * 1.5, false);
  closeRing(points);
  return points;
}

/** The face outline, bottom edge first, going counterclockwise. An opening on the bottom edge is a notch. */
function traceOuter(width: number, height: number, shaped: ResolvedFront | undefined, holes: Hole[]): Point[] {
  const square: ResolvedCorner = { radius: 0, cutX: 0, cutY: 0 };
  const face = shaped ?? { topLeft: square, topRight: square, bottomLeft: square, bottomRight: square };
  const across = (corner: ResolvedCorner) => (corner.cutX > 0 ? corner.cutX : corner.radius);
  const down = (corner: ResolvedCorner) => (corner.cutY > 0 ? corner.cutY : corner.radius);
  const points: Point[] = [];
  pushPoint(points, [across(face.bottomLeft), 0]);
  for (const hole of holes.filter((hole) => hole.y < 1).sort((a, b) => a.x - b.x)) {
    const inner = resolveFront(hole.width, hole.height, hole.corners, undefined);
    const hx0 = hole.x;
    const hx1 = hx0 + hole.width;
    const hy1 = hole.height;
    const tl = inner?.topLeft.radius ?? 0;
    const tr = inner?.topRight.radius ?? 0;
    pushPoint(points, [hx0, 0]);
    pushPoint(points, [hx0, hy1 - tl]);
    if (tl > 0) pushArc(points, hx0 + tl, hy1 - tl, tl, Math.PI, Math.PI / 2, true);
    pushPoint(points, [hx1 - tr, hy1]);
    if (tr > 0) pushArc(points, hx1 - tr, hy1 - tr, tr, Math.PI / 2, 0, true);
    pushPoint(points, [hx1, 0]);
  }
  pushPoint(points, [width - across(face.bottomRight), 0]);
  if (face.bottomRight.cutX > 0) pushPoint(points, [width, face.bottomRight.cutY]);
  else if (face.bottomRight.radius > 0) pushArc(points, width - across(face.bottomRight), down(face.bottomRight), face.bottomRight.radius, -Math.PI / 2, 0, false);
  pushPoint(points, [width, height - down(face.topRight)]);
  if (face.topRight.cutX > 0) pushPoint(points, [width - face.topRight.cutX, height]);
  else if (face.topRight.radius > 0) pushArc(points, width - across(face.topRight), height - down(face.topRight), face.topRight.radius, 0, Math.PI / 2, false);
  pushPoint(points, [across(face.topLeft), height]);
  if (face.topLeft.cutX > 0) pushPoint(points, [0, height - face.topLeft.cutY]);
  else if (face.topLeft.radius > 0) pushArc(points, across(face.topLeft), height - down(face.topLeft), face.topLeft.radius, Math.PI / 2, Math.PI, false);
  pushPoint(points, [0, down(face.bottomLeft)]);
  if (face.bottomLeft.cutX > 0) pushPoint(points, [face.bottomLeft.cutX, 0]);
  else if (face.bottomLeft.radius > 0) pushArc(points, across(face.bottomLeft), down(face.bottomLeft), face.bottomLeft.radius, Math.PI, Math.PI * 1.5, false);
  closeRing(points);
  return points;
}

/**
 * The shaped face as the workshop cuts it, in mm from the bottom-left with y up.
 * Nothing for a plain rectangle, a piece that is not a box, or a bent piece (that blank stays a rectangle).
 */
export function faceShape(part: {
  shape: string;
  width: number;
  height: number;
  depth: number;
  face?: ShapedFace;
  corners?: CornerRadii;
  chamfers?: Chamfers;
  holes?: Hole[];
  outline?: Outline;
  curve?: Curve;
}): { outer: Point[]; holes: Point[][] } | null {
  if (part.shape !== "box" || part.curve) return null;
  const axes = faceAxes(part);
  const holes = part.holes ?? [];
  if (part.outline) return { outer: outlineRing(part.outline), holes: holes.map(holeRing) };
  const shaped = resolveFront(axes.width, axes.height, part.corners, part.chamfers);
  if (!shaped && holes.length === 0) return null;
  return { outer: traceOuter(axes.width, axes.height, shaped, holes), holes: holes.filter((hole) => hole.y >= 1).map(holeRing) };
}

/**
 * A rectangle on the shaped face, as a box in the piece's own frame: x, y, z from its minimum corner before
 * rotation, through the whole thickness. Face `y` runs from the viewer's side toward the back on top and side faces.
 */
function faceBox(part: { width: number; height: number; depth: number; face?: ShapedFace }, rect: { x: number; y: number; width: number; height: number }) {
  if (part.face === "top") return { x: rect.x, y: 0, z: part.depth - rect.y - rect.height, width: rect.width, height: part.height, depth: rect.height };
  if (part.face === "side") return { x: 0, y: rect.y, z: part.depth - rect.x - rect.width, width: part.width, height: rect.height, depth: rect.width };
  return { x: rect.x, y: rect.y, z: 0, width: rect.width, height: rect.height, depth: part.depth };
}

/** World bounds of each opening of a box, through its whole thickness. */
export function holeBounds(part: PartLike & { holes?: Hole[]; face?: ShapedFace }): Bounds[] {
  if (part.shape !== "box" || !part.holes?.length) return [];
  const center = partCenter(part);
  return part.holes.map((hole) => {
    const local = faceBox(part, hole);
    const offset = rotateOffset(local.x + local.width / 2 - part.width / 2, local.z + local.depth / 2 - part.depth / 2, part.rotation ?? 0);
    const bounds = partBounds({ shape: "box", x: 0, y: 0, z: 0, width: local.width, height: local.height, depth: local.depth, rotation: part.rotation });
    const halfX = (bounds.maxX - bounds.minX) / 2;
    const halfZ = (bounds.maxZ - bounds.minZ) / 2;
    return {
      minX: center.x + offset.x - halfX,
      maxX: center.x + offset.x + halfX,
      minY: part.y + local.y,
      maxY: part.y + local.y + local.height,
      minZ: center.z + offset.z - halfZ,
      maxZ: center.z + offset.z + halfZ,
    };
  });
}

/**
 * The circular arc of a bent panel that fills its box: the outer face touches the box's front at the middle
 * and its two ends sit on the box's width. A bow deeper than half the width is a half circle.
 */
export function curveShape(width: number, depth: number, thickness: number) {
  const t = Math.min(thickness, depth);
  const depthAt = (radius: number) => {
    const cos = Math.sqrt(Math.max(0, 1 - (width / (2 * radius)) ** 2));
    return radius * (1 - cos) + t * cos;
  };
  let low = width / 2;
  let high = width * 1e4;
  if (depth >= depthAt(low)) high = low;
  else if (depth <= t + 1e-6) low = high;
  else {
    for (let step = 0; step < 80; step += 1) {
      const mid = (low + high) / 2;
      if (depthAt(mid) > depth) low = mid;
      else high = mid;
    }
  }
  const outer = (low + high) / 2;
  const half = Math.asin(Math.min(1, width / (2 * outer)));
  return {
    /** Radius of the outside face, in mm. */
    outer,
    inner: outer - t,
    /** Angle the panel turns through, in degrees. */
    sweep: (2 * half * 180) / Math.PI,
    /** Length of the flat board before bending, along the middle of its thickness. */
    blank: 2 * half * (outer - t / 2),
    thickness: t,
  };
}

type Sized = { width: number; height: number; depth: number };

/**
 * A bent board as its outline in the view the curve is seen in, plus the straight length it runs along.
 * `u` runs across the view's width and `v` up the view (toward the back, seen from above), both from the
 * box's corner, in mm. The outline goes along the outside face, then back along the inside face.
 */
export function bendProfile(part: Sized, curve: Curve) {
  const front = curve.axis === "depth";
  const width = part.width;
  const tall = front ? part.height : part.depth;
  const length = front ? part.depth : part.height;
  const steps = (sweep: number) => 2 * Math.max(4, Math.ceil(sweep / 8));
  if (curve.corner) {
    const radius = Math.min(width, tall);
    const t = Math.min(curve.thickness, radius);
    const right = curve.corner.endsWith("Right");
    const top = curve.corner.startsWith("top");
    const cu = right ? width - radius : radius;
    const cv = top ? tall - radius : radius;
    const start = (top ? (right ? 0 : 90) : right ? 270 : 180) * (Math.PI / 180);
    const count = steps(90);
    const arc = (r: number) => Array.from({ length: count + 1 }, (_, step) => start + (Math.PI / 2) * (step / count)).map((angle): [number, number] => [cu + r * Math.cos(angle), cv + r * Math.sin(angle)]);
    return { front, width, tall, length, thickness: t, sweep: 90, blank: (Math.PI / 2) * (radius - t / 2), points: [...arc(radius), ...arc(radius - t).reverse()] };
  }
  const bow = curveShape(width, tall, curve.thickness);
  // A bow toward the viewer seen from above, or down seen from the front, bulges toward v = 0.
  const low = front ? curve.toward === "down" : curve.toward !== "back";
  const half = (bow.sweep * Math.PI) / 360;
  const center = low ? bow.outer : tall - bow.outer;
  const count = steps(bow.sweep);
  const arc = (r: number) =>
    Array.from({ length: count + 1 }, (_, step) => -half + 2 * half * (step / count)).map((angle): [number, number] => [width / 2 + r * Math.sin(angle), center + (low ? -1 : 1) * r * Math.cos(angle)]);
  return { front, width, tall, length, thickness: bow.thickness, sweep: bow.sweep, blank: bow.blank, points: [...arc(bow.outer), ...arc(bow.inner).reverse()] };
}

/** A piece as the flat board it is cut from. A bent panel is its unbent blank. */
export function flatPiece<T extends { shape: string; width: number; height: number; depth: number; curve?: Curve }>(part: T): T {
  if (part.shape !== "box" || !part.curve) return part;
  const bend = bendProfile(part, part.curve);
  return { ...part, width: Math.round(bend.blank), height: bend.length, depth: bend.thickness };
}

const BOW_FLIP: Record<string, Curve["toward"]> = { front: "down", back: "up", up: "back", down: "front" };

/**
 * The curve of a bent board after it is turned to new sizes, or null when no turn gives those sizes.
 * Its width stays across the bend. Tipped onto its back, the curve seen from the front is then seen from above.
 */
export function turnCurve(curve: Curve, before: Sized, after: Sized): Curve | null {
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  const was = bendProfile(before, curve);
  for (const axis of ["height", "depth"] as const) {
    const front = axis === "depth";
    const tall = front ? after.height : after.depth;
    const length = front ? after.depth : after.height;
    if (!near(length, was.length)) continue;
    const same = near(after.width, was.width) && near(tall, was.tall);
    const swapped = Boolean(curve.corner) && near(after.width, was.tall) && near(tall, was.width);
    if (!same && !swapped) continue;
    const next: Curve = { ...curve, axis };
    if (axis === "height") delete next.axis;
    if (front !== was.front && curve.corner) delete next.toward;
    else if (front !== was.front) next.toward = BOW_FLIP[curve.toward ?? (was.front ? "up" : "front")];
    if (swapped && curve.corner) next.corner = ({ topLeft: "bottomRight", bottomRight: "topLeft", topRight: "topRight", bottomLeft: "bottomLeft" } as const)[curve.corner];
    return next;
  }
  return null;
}

export type BayRange = { start: number; end: number; length: number };

export function bayRanges(spans: number[], module: number): BayRange[] {
  let cursor = 0;
  return spans.map((span) => {
    const length = span * module;
    const range = { start: cursor, end: cursor + length, length };
    cursor += length;
    return range;
  });
}

export type PartLike = {
  shape: PartShape;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  rotation?: number;
  tilt?: number;
};

export type Bounds = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

/** Plan footprint size. A cylinder is always a circle of diameter `width`. */
export function partFootprint(part: Pick<PartLike, "shape" | "width" | "depth">) {
  return part.shape === "cylinder" ? { width: part.width, depth: part.width } : { width: part.width, depth: part.depth };
}

export function partCenter(part: PartLike) {
  const footprint = partFootprint(part);
  return { x: part.x + footprint.width / 2, y: part.y + part.height / 2, z: part.z + footprint.depth / 2 };
}

/** Rotate a plan offset the way three.js rotates about +Y. */
export function rotateOffset(dx: number, dz: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: dx * cos + dz * sin, z: -dx * sin + dz * cos };
}

export function normalizeDegrees(degrees: number) {
  let value = degrees % 360;
  if (value > 180) value -= 360;
  if (value <= -180) value += 360;
  return Math.round(value * 1000) / 1000;
}

/** A piece's tilt in degrees. Cylinders never tilt. */
export function partTilt(part: Pick<PartLike, "shape" | "tilt">) {
  return part.shape === "cylinder" ? 0 : normalizeDegrees(part.tilt ?? 0);
}

/** Turn an offset from a piece's center the way three.js does with rotation [0, rotation, tilt] in order YXZ. */
export function turnOffset(dx: number, dy: number, dz: number, rotation: number, tilt: number) {
  const radians = (tilt * Math.PI) / 180;
  const tx = dx * Math.cos(radians) - dy * Math.sin(radians);
  const ty = dx * Math.sin(radians) + dy * Math.cos(radians);
  const plan = rotateOffset(tx, dz, rotation);
  return { x: plan.x, y: ty, z: plan.z };
}

/** Axis-aligned bounds of a piece after its tilt and rotation. */
export function partBounds(part: PartLike): Bounds {
  const footprint = partFootprint(part);
  const center = partCenter(part);
  const rotation = part.shape === "cylinder" ? 0 : (part.rotation ?? 0);
  const tilt = partTilt(part);
  let halfX = footprint.width / 2;
  let halfY = part.height / 2;
  let halfZ = footprint.depth / 2;
  if (rotation % 180 !== 0 || tilt % 180 !== 0) {
    const corners = [
      [1, 1, 1],
      [1, -1, 1],
      [1, 1, -1],
      [1, -1, -1],
    ].map(([sx, sy, sz]) => turnOffset(sx * halfX, sy * halfY, sz * halfZ, rotation, tilt));
    halfX = Math.max(...corners.map((corner) => Math.abs(corner.x)));
    halfY = Math.max(...corners.map((corner) => Math.abs(corner.y)));
    halfZ = Math.max(...corners.map((corner) => Math.abs(corner.z)));
  }
  return {
    minX: center.x - halfX,
    maxX: center.x + halfX,
    minY: center.y - halfY,
    maxY: center.y + halfY,
    minZ: center.z - halfZ,
    maxZ: center.z + halfZ,
  };
}

export function unionBounds(parts: PartLike[]): Bounds | null {
  if (parts.length === 0) return null;
  return parts.map(partBounds).reduce((all, next) => ({
    minX: Math.min(all.minX, next.minX),
    maxX: Math.max(all.maxX, next.maxX),
    minY: Math.min(all.minY, next.minY),
    maxY: Math.max(all.maxY, next.maxY),
    minZ: Math.min(all.minZ, next.minZ),
    maxZ: Math.max(all.maxZ, next.maxZ),
  }));
}

export type SnapOptions = {
  /** Grid size in mm. 0 turns grid snapping off. */
  grid: number;
  /** Snap faces to other pieces and to the floor-plan edges within this distance. 0 turns it off. */
  magnet: number;
  /** Extra faces to snap to, per axis, such as the stand envelope. */
  extra?: { x?: number[]; y?: number[]; z?: number[] };
};

type Axis = "x" | "y" | "z";

function faceValues(bounds: Bounds, axis: Axis) {
  if (axis === "x") return [bounds.minX, bounds.maxX];
  if (axis === "y") return [bounds.minY, bounds.maxY];
  return [bounds.minZ, bounds.maxZ];
}

/**
 * Adjust a drag delta so the moving bounds land on the grid, and so their faces
 * stick to the faces of other pieces when they come close. Face snapping wins over the grid.
 */
export function snapMove(
  moving: Bounds,
  delta: { x: number; y: number; z: number },
  others: Bounds[],
  options: SnapOptions,
) {
  const next = { ...delta };
  for (const axis of ["x", "y", "z"] as const) {
    const [low, high] = faceValues(moving, axis);
    const lowNow = low + delta[axis];
    const highNow = high + delta[axis];
    let best: number | null = null;
    let bestDistance = options.magnet;
    if (options.magnet > 0) {
      const targets = [...others.flatMap((other) => faceValues(other, axis)), ...(options.extra?.[axis] ?? [])];
      for (const target of targets) {
        for (const face of [lowNow, highNow]) {
          const distance = Math.abs(target - face);
          if (distance <= bestDistance) {
            bestDistance = distance;
            best = delta[axis] + (target - face);
          }
        }
      }
    }
    if (best !== null) next[axis] = best;
    else if (options.grid > 0) next[axis] = Math.round(lowNow / options.grid) * options.grid - low;
  }
  return next;
}

export function packFirstFitDecreasing(lengths: number[], stockLengthMm: number) {
  const parts = [...lengths].filter((length) => length > 0).sort((a, b) => b - a);
  const remaining: number[] = [];
  for (const part of parts) {
    if (part > stockLengthMm) return { bars: 0, overflow: part };
    const index = remaining.findIndex((space) => space >= part);
    if (index === -1) remaining.push(stockLengthMm - part);
    else remaining[index] -= part;
  }
  return { bars: remaining.length, overflow: 0 };
}

export function stockBarCount(lengths: number[], stockLengthMm: number, wasteFactor: number) {
  const packed = packFirstFitDecreasing(lengths, stockLengthMm);
  if (packed.overflow > 0) return packed;
  const bars = Math.ceil(packed.bars * (1 + wasteFactor) - 1e-9);
  return { bars, overflow: 0 };
}

export function rectanglesOverlapArea(
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
) {
  const width = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const depth = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  if (width <= 0 || depth <= 0) return 0;
  return width * depth;
}
