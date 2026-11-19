import { BufferGeometry, CurvePath, LatheGeometry, LineCurve3, Shape, ShapeGeometry, TubeGeometry, Vector2, Vector3 } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { closable, faceAxes, pathPoints } from "./geometry";
import { roundFraction, roundSection } from "./round";
import type { Outline, Round, ShapedFace } from "./schema";

type Point = [number, number];

/** A turn sharper than this between two edges of the section is a crease, not part of a smooth curve. */
const CREASE = (25 * Math.PI) / 180;

/** The section split at its creases, each run turned on its own so a flat cap shades flat and a dome stays smooth. */
function smoothRuns(section: Point[]): Point[][] {
  const n = section.length;
  const direction = (from: Point, to: Point) => Math.atan2(to[1] - from[1], to[0] - from[0]);
  const creases: number[] = [];
  for (let index = 0; index < n; index += 1) {
    const before = section[(index - 1 + n) % n];
    const at = section[index];
    const after = section[(index + 1) % n];
    let turn = Math.abs(direction(at, after) - direction(before, at));
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > CREASE) creases.push(index);
  }
  if (creases.length === 0) return [[...section, section[0]]];
  return creases.map((start, index) => {
    const end = creases[(index + 1) % creases.length];
    const run: Point[] = [];
    for (let step = start; ; step = (step + 1) % n) {
      run.push(section[step]);
      if (step === end && run.length > 1) break;
    }
    return run;
  });
}

function signedArea(points: Point[]) {
  return points.reduce((sum, [x0, y0], index) => {
    const [x1, y1] = points[(index + 1) % points.length];
    return sum + x0 * y1 - x1 * y0;
  }, 0);
}

/**
 * A cone, hollow, part-circle, or turned cylinder, centered on the origin, in meters. A part circle is built
 * facing the front, its flat cut faces toward the back. Nothing for a plain solid cylinder.
 */
export function roundGeometry(part: { width: number; height: number; round?: Round }): BufferGeometry | null {
  if (!part.round) return null;
  let section = roundSection(part);
  if (signedArea(section) < 0) section = [...section].reverse();
  const fraction = roundFraction(part);
  const phiLength = 2 * Math.PI * fraction;
  const phiStart = -phiLength / 2;
  const segments = Math.max(12, Math.round(96 * fraction));
  const lift = part.height / 2;
  const toVector = ([r, y]: Point) => new Vector2(Math.max(0, r) / 1000, (y - lift) / 1000);
  const pieces: BufferGeometry[] = [];
  for (const run of smoothRuns(section)) {
    if (run.every(([r]) => r < 0.01)) continue;
    pieces.push(new LatheGeometry(run.map(toVector), segments, phiStart, phiLength));
  }
  if (fraction < 1) {
    // Each cut face is drawn mirrored for the far end, so both face away from the built part.
    const start = new ShapeGeometry(new Shape(section.map(toVector)));
    start.rotateY(phiStart - Math.PI / 2);
    const end = new ShapeGeometry(new Shape(section.map((point) => toVector(point).setX(-Math.max(0, point[0]) / 1000))));
    end.rotateY(phiStart + phiLength + Math.PI / 2);
    pieces.push(start, end);
  }
  const indexed = pieces.map((piece) => (piece.index ? piece.toNonIndexed() : piece));
  const merged = mergeGeometries(indexed, false);
  for (const piece of [...pieces, ...indexed]) piece.dispose();
  return merged;
}

/**
 * A tube along its path on its face, centered on the origin, in meters: neon, a pipe, a rail, or a ring.
 * Its diameter is the face's thickness. Laid on the top or side face like a shaped box.
 */
export function tubeGeometry(part: { width: number; height: number; depth: number; face?: ShapedFace; path?: Outline; closed?: boolean }): BufferGeometry | null {
  if (!part.path || part.path.length < 2) return null;
  const face = faceAxes(part);
  const closed = Boolean(part.closed) && closable(part.path);
  const points = pathPoints(part.path, closed, 0.5).map(([x, y]) => new Vector3((x - face.width / 2) / 1000, (y - face.height / 2) / 1000, 0));
  if (points.length < 2) return null;
  const curve = new CurvePath<Vector3>();
  for (let index = 0; index + 1 < points.length; index += 1) curve.add(new LineCurve3(points[index], points[index + 1]));
  if (closed) curve.add(new LineCurve3(points[points.length - 1], points[0]));
  const radius = Math.max(0.5, face.thickness / 2) / 1000;
  const segments = Math.min(3000, Math.max(64, Math.ceil(curve.getLength() / (radius * 0.6)), points.length * 2));
  const geometry = new TubeGeometry(curve, segments, radius, 16, closed);
  if (face.face === "top") geometry.rotateX(-Math.PI / 2);
  if (face.face === "side") geometry.rotateY(Math.PI / 2);
  return geometry;
}
