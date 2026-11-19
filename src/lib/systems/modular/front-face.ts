import { ExtrudeGeometry, Path, Shape, Vector2 } from "three";
import { bendProfile, faceAxes, outlineRing, resolveFront, type ResolvedCorner, type ResolvedFront } from "@/lib/systems/modular/geometry";
import type { Chamfers, CornerRadii, Curve, Hole, Outline, ShapedFace } from "@/lib/systems/modular/schema";

const SQUARE: ResolvedCorner = { radius: 0, cutX: 0, cutY: 0 };

function holeFace(hole: Hole): ResolvedFront {
  return resolveFront(hole.width, hole.height, hole.corners, undefined) ?? { topLeft: SQUARE, topRight: SQUARE, bottomLeft: SQUARE, bottomRight: SQUARE };
}

/**
 * The front face of a box, extruded through its depth and centered on the origin, in meters.
 * Openings are cut through it: one at the bottom edge is a notch in the outline, any other is a hole.
 * A free outline replaces the rounded and cut corners, and every opening in it is a hole.
 * Returns nothing for a plain box, so the caller can use a box geometry.
 */
export function frontFaceGeometry(widthMm: number, heightMm: number, depthMm: number, corners: CornerRadii | undefined, chamfers: Chamfers | undefined, holes?: Hole[], outline?: Outline) {
  const shaped = outline ? undefined : resolveFront(widthMm, heightMm, corners, chamfers);
  if (!outline && !shaped && !holes?.length) return null;
  const face = shaped ?? { topLeft: SQUARE, topRight: SQUARE, bottomLeft: SQUARE, bottomRight: SQUARE };
  const w = widthMm / 1000;
  const h = heightMm / 1000;
  const d = depthMm / 1000;
  const x0 = -w / 2;
  const x1 = w / 2;
  const y0 = -h / 2;
  const y1 = h / 2;
  const across = (corner: ResolvedCorner) => (corner.cutX > 0 ? corner.cutX : corner.radius) / 1000;
  const down = (corner: ResolvedCorner) => (corner.cutY > 0 ? corner.cutY : corner.radius) / 1000;
  const open = outline ? [] : (holes ?? []).filter((hole) => hole.y < 1).sort((a, b) => a.x - b.x);
  const closed = outline ? (holes ?? []) : (holes ?? []).filter((hole) => hole.y >= 1);

  const shape = outline ? new Shape(outlineRing(outline).map(([x, y]) => new Vector2(x0 + x / 1000, y0 + y / 1000))) : new Shape();
  if (!outline) {
    shape.moveTo(x0 + across(face.bottomLeft), y0);
    for (const hole of open) {
      const inner = holeFace(hole);
      const hx0 = x0 + hole.x / 1000;
      const hx1 = hx0 + hole.width / 1000;
      const hy1 = y0 + hole.height / 1000;
      const tl = inner.topLeft.radius / 1000;
      const tr = inner.topRight.radius / 1000;
      shape.lineTo(hx0, y0);
      shape.lineTo(hx0, hy1 - tl);
      if (tl > 0) shape.absarc(hx0 + tl, hy1 - tl, tl, Math.PI, Math.PI / 2, true);
      shape.lineTo(hx1 - tr, hy1);
      if (tr > 0) shape.absarc(hx1 - tr, hy1 - tr, tr, Math.PI / 2, 0, true);
      shape.lineTo(hx1, y0);
    }
    shape.lineTo(x1 - across(face.bottomRight), y0);
    if (face.bottomRight.cutX > 0) shape.lineTo(x1, y0 + face.bottomRight.cutY / 1000);
    else if (face.bottomRight.radius > 0) shape.absarc(x1 - across(face.bottomRight), y0 + down(face.bottomRight), face.bottomRight.radius / 1000, -Math.PI / 2, 0, false);
    shape.lineTo(x1, y1 - down(face.topRight));
    if (face.topRight.cutX > 0) shape.lineTo(x1 - face.topRight.cutX / 1000, y1);
    else if (face.topRight.radius > 0) shape.absarc(x1 - across(face.topRight), y1 - down(face.topRight), face.topRight.radius / 1000, 0, Math.PI / 2, false);
    shape.lineTo(x0 + across(face.topLeft), y1);
    if (face.topLeft.cutX > 0) shape.lineTo(x0, y1 - face.topLeft.cutY / 1000);
    else if (face.topLeft.radius > 0) shape.absarc(x0 + across(face.topLeft), y1 - down(face.topLeft), face.topLeft.radius / 1000, Math.PI / 2, Math.PI, false);
    shape.lineTo(x0, y0 + down(face.bottomLeft));
    if (face.bottomLeft.cutX > 0) shape.lineTo(x0 + face.bottomLeft.cutX / 1000, y0);
    else if (face.bottomLeft.radius > 0) shape.absarc(x0 + across(face.bottomLeft), y0 + down(face.bottomLeft), face.bottomLeft.radius / 1000, Math.PI, Math.PI * 1.5, false);
  }

  for (const hole of closed) {
    const inner = holeFace(hole);
    const hx0 = x0 + hole.x / 1000;
    const hx1 = hx0 + hole.width / 1000;
    const hy0 = y0 + hole.y / 1000;
    const hy1 = hy0 + hole.height / 1000;
    const r = (corner: ResolvedCorner) => corner.radius / 1000;
    const path = new Path();
    path.moveTo(hx0 + r(inner.bottomLeft), hy0);
    path.lineTo(hx1 - r(inner.bottomRight), hy0);
    if (r(inner.bottomRight) > 0) path.absarc(hx1 - r(inner.bottomRight), hy0 + r(inner.bottomRight), r(inner.bottomRight), -Math.PI / 2, 0, false);
    path.lineTo(hx1, hy1 - r(inner.topRight));
    if (r(inner.topRight) > 0) path.absarc(hx1 - r(inner.topRight), hy1 - r(inner.topRight), r(inner.topRight), 0, Math.PI / 2, false);
    path.lineTo(hx0 + r(inner.topLeft), hy1);
    if (r(inner.topLeft) > 0) path.absarc(hx0 + r(inner.topLeft), hy1 - r(inner.topLeft), r(inner.topLeft), Math.PI / 2, Math.PI, false);
    path.lineTo(hx0, hy0 + r(inner.bottomLeft));
    if (r(inner.bottomLeft) > 0) path.absarc(hx0 + r(inner.bottomLeft), hy0 + r(inner.bottomLeft), r(inner.bottomLeft), Math.PI, Math.PI * 1.5, false);
    shape.holes.push(path);
  }

  const geometry = new ExtrudeGeometry(shape, { depth: d, bevelEnabled: false, curveSegments: holes?.length ? 24 : 10 });
  geometry.translate(0, 0, -d / 2);
  return geometry;
}

type BoxLike = { width: number; height: number; depth: number; corners?: CornerRadii; chamfers?: Chamfers; holes?: Hole[]; outline?: Outline; face?: ShapedFace; curve?: Curve };

/**
 * A bent board in its box, centered on the origin, in meters. Its ends are cut square to the curve.
 * The outline is drawn in the view the curve is seen in, then extruded along the straight length:
 * through the depth when seen from the front, or up the height when seen from above.
 */
function curvedGeometry(part: BoxLike, curve: Curve) {
  const bend = bendProfile(part, curve);
  const shape = new Shape(bend.points.map(([u, v]) => new Vector2((u - bend.width / 2) / 1000, (v - bend.tall / 2) / 1000)));
  const geometry = new ExtrudeGeometry(shape, { depth: bend.length / 1000, bevelEnabled: false });
  geometry.translate(0, 0, -bend.length / 2000);
  if (!bend.front) geometry.rotateX(-Math.PI / 2);
  return geometry;
}

/**
 * The shape of a box piece: bent, shaped on one face, or nothing for a plain box so the caller can use a box geometry.
 * A top face is drawn as seen from above and laid flat. A side face is drawn as seen from the right and turned.
 */
export function boxGeometry(part: BoxLike) {
  if (part.curve) return curvedGeometry(part, part.curve);
  const face = faceAxes(part);
  const geometry = frontFaceGeometry(face.width, face.height, face.thickness, part.corners, part.chamfers, part.holes, part.outline);
  if (!geometry) return null;
  if (face.face === "top") geometry.rotateX(-Math.PI / 2);
  if (face.face === "side") geometry.rotateY(Math.PI / 2);
  return geometry;
}
