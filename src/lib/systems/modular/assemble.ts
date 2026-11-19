import { z } from "zod";
import { bendProfile, faceAxes, holeBounds, normalizeDegrees, partBounds, partTilt, swapOutlineAxes, turnCurve, turnOffset, type Bounds } from "./geometry";
import { applyDesignPatch } from "./patch";
import { CORNER_NAMES, SHAPED_FACES, type DesignDocument, type ScenePart } from "./schema";

/**
 * Assembly puts priced pieces where they belong. It may move a piece and turn it, but never resize it:
 * a box keeps the same three sizes in any order, so a shelf can lie flat and its board cost stays the same.
 */

export const placementSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  depth: z.number().positive(),
  /** Degrees about the vertical axis. Leave it out to keep the piece square to the axes. */
  rotation: z.number().optional(),
  /** Degrees about the piece's front-to-back axis, counterclockwise seen from the front: a sloping roof board. Leave it out to keep it level. */
  tilt: z.number().optional(),
  /** A bent quarter corner: the corner its outside faces, as seen along its curve. The same board fits any corner. */
  corner: z.enum(CORNER_NAMES).optional(),
});
export type Placement = z.infer<typeof placementSchema>;

const SIZE_TOLERANCE_MM = 1;
/** Pieces closer than this touch. Overlaps smaller than this are joints, not clashes. */
const CONTACT_MM = 2;
const MAX_REPORTED = 12;

function sortedSizes(width: number, height: number, depth: number) {
  return [width, height, depth].sort((a, b) => a - b);
}

function sameSizes(part: ScenePart, placement: Placement) {
  if (part.shape !== "box") {
    const depth = part.shape === "cylinder" ? part.width : part.depth;
    return (
      Math.abs(part.width - placement.width) <= SIZE_TOLERANCE_MM &&
      Math.abs(part.height - placement.height) <= SIZE_TOLERANCE_MM &&
      Math.abs(depth - (part.shape === "cylinder" ? placement.width : placement.depth)) <= SIZE_TOLERANCE_MM
    );
  }
  const before = sortedSizes(part.width, part.height, part.depth);
  const after = sortedSizes(placement.width, placement.height, placement.depth);
  return before.every((size, index) => Math.abs(size - after[index]) <= SIZE_TOLERANCE_MM);
}

function sizeText(width: number, height: number, depth: number) {
  return `${Math.round(width)} × ${Math.round(height)} × ${Math.round(depth)}`;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

const near = (a: number, b: number) => Math.abs(a - b) <= SIZE_TOLERANCE_MM;

function flipCorners<T>(corners: { topLeft?: T; topRight?: T; bottomLeft?: T; bottomRight?: T } | undefined, flip: (value: T) => T = (value) => value) {
  if (!corners) return undefined;
  const pick = (value: T | undefined) => (value === undefined ? undefined : flip(value));
  const flipped = { topLeft: pick(corners.bottomRight), topRight: pick(corners.topRight), bottomLeft: pick(corners.bottomLeft), bottomRight: pick(corners.topLeft) };
  return Object.fromEntries(Object.entries(flipped).filter(([, value]) => value !== undefined)) as typeof corners;
}

/**
 * A turned box carries its outline to the face that now has the same two sizes. Tipped onto its back, a panel's
 * bottom edge stays toward the viewer. When the two sizes trade places, the outline is mirrored across its diagonal.
 */
function turnOutline(part: ScenePart, next: ScenePart) {
  if (!part.corners && !part.chamfers && !part.holes && !part.outline) return;
  const was = faceAxes(part);
  const faces = [...new Set([part.face ?? "front", ...SHAPED_FACES])];
  const fits = (swap: boolean) =>
    faces.find((face) => {
      const axes = faceAxes({ ...next, face });
      return near(axes.thickness, was.thickness) && near(axes.width, swap ? was.height : was.width) && near(axes.height, swap ? was.width : was.height);
    });
  const same = fits(false);
  const swapped = same ? undefined : fits(true);
  const face = same ?? swapped;
  if (face === "front") delete next.face;
  else if (face) next.face = face;
  if (!face) {
    delete next.corners;
    delete next.chamfers;
    delete next.holes;
    delete next.outline;
    delete next.face;
    return;
  }
  if (!swapped) return;
  if (part.outline) next.outline = swapOutlineAxes(part.outline);
  if (part.corners) next.corners = flipCorners(part.corners);
  if (part.chamfers) next.chamfers = flipCorners(part.chamfers, (cut) => ({ x: cut.y, y: cut.x }));
  if (part.holes) next.holes = part.holes.map((hole) => ({ x: hole.y, y: hole.x, width: hole.height, height: hole.width, ...(hole.corners ? { corners: flipCorners(hole.corners) } : {}) }));
}

/** The curve of a bent board placed with these sizes, or null when the board cannot be turned that way. */
function placedCurve(part: ScenePart, placement: Placement) {
  if (!part.curve) return undefined;
  const turned = turnCurve(part.curve, part, placement);
  if (!turned) return null;
  return turned.corner && placement.corner ? { ...turned, corner: placement.corner } : turned;
}

function place(part: ScenePart, placement: Placement): ScenePart {
  const width = part.shape === "box" ? placement.width : part.width;
  const height = part.shape === "box" ? placement.height : part.height;
  const depth = part.shape === "box" ? placement.depth : part.depth;
  const next: ScenePart = { ...part, x: round(Math.max(0, placement.x)), y: round(Math.max(0, placement.y)), z: round(Math.max(0, placement.z)), width, height, depth };
  const rotation = placement.rotation === undefined ? 0 : normalizeDegrees(placement.rotation);
  if (rotation === 0) delete next.rotation;
  else next.rotation = rotation;
  const tilt = placement.tilt === undefined || part.shape === "cylinder" ? 0 : normalizeDegrees(placement.tilt);
  if (tilt === 0) delete next.tilt;
  else next.tilt = tilt;
  const curve = placedCurve(part, placement);
  if (curve) next.curve = curve;
  else if (width !== part.width || height !== part.height || depth !== part.depth) turnOutline(part, next);
  return next;
}

export type ArrangeResult = {
  document: DesignDocument;
  placed: string[];
  rejected: { id: string; reason: string }[];
};

/** Put pieces at absolute positions. A piece whose sizes would change is left where it was and reported. */
export function arrangeParts(document: DesignDocument, placements: Placement[]): ArrangeResult {
  const byId = new Map(placements.map((placement) => [placement.id, placement]));
  const known = new Set(document.parts.map((part) => part.id));
  const rejected: ArrangeResult["rejected"] = placements.filter((placement) => !known.has(placement.id)).map((placement) => ({ id: placement.id, reason: "no piece has this id" }));
  const placed: string[] = [];

  const parts = document.parts.map((part) => {
    const placement = byId.get(part.id);
    if (!placement) return part;
    if (part.locked) {
      rejected.push({ id: part.id, reason: "the piece is locked" });
      return part;
    }
    if (!sameSizes(part, placement)) {
      const depth = part.shape === "cylinder" ? part.width : part.depth;
      rejected.push({
        id: part.id,
        reason: `the sizes changed from ${sizeText(part.width, part.height, depth)} to ${sizeText(placement.width, placement.height, placement.depth)}. Use the same three sizes in any order.`,
      });
      return part;
    }
    if (placedCurve(part, placement) === null) {
      const bend = bendProfile(part, part.curve!);
      const [w, b, l] = [bend.width, bend.tall, bend.length].map(Math.round);
      rejected.push({
        id: part.id,
        reason: `a bent board keeps its width ${w} across the curve. Send it as ${w} × ${l} × ${b} to see the curve from above, or ${w} × ${b} × ${l} to see it from the front${part.curve!.corner ? `, or ${b} × ${w} × ${l} for a corner turned the other way` : ""}. Set corner to pick which corner a quarter faces.`,
      });
      return part;
    }
    placed.push(part.id);
    return place(part, placement);
  });

  if (placed.length === 0) return { document, placed, rejected };
  return { document: { ...applyDesignPatch(document, { parts }), assembled: true }, placed, rejected };
}

function overlap(a: Bounds, b: Bounds) {
  return {
    x: Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX),
    y: Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY),
    z: Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ),
  };
}

function intersection(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minY: Math.max(a.minY, b.minY),
    maxY: Math.min(a.maxY, b.maxY),
    minZ: Math.max(a.minZ, b.minZ),
    maxZ: Math.min(a.maxZ, b.maxZ),
  };
}

/** Whether `region` lies within `outer` grown by `slack` on every side. A negative slack shrinks it. */
function inside(region: Bounds, outer: Bounds, slack: number) {
  return (
    region.minX >= outer.minX - slack &&
    region.maxX <= outer.maxX + slack &&
    region.minY >= outer.minY - slack &&
    region.maxY <= outer.maxY + slack &&
    region.minZ >= outer.minZ - slack &&
    region.maxZ <= outer.maxZ + slack
  );
}

type Solid = { center: [number, number, number]; axes: [number, number, number][]; half: [number, number, number] };

/** A piece as a turned box: its center, its own three directions, and half its sizes. */
function solidOf(part: ScenePart): Solid {
  const rotation = part.shape === "cylinder" ? 0 : (part.rotation ?? 0);
  const tilt = partTilt(part);
  const depth = part.shape === "cylinder" ? part.width : part.depth;
  const axis = (x: number, y: number, z: number) => {
    const turned = turnOffset(x, y, z, rotation, tilt);
    return [turned.x, turned.y, turned.z] as [number, number, number];
  };
  return {
    center: [part.x + part.width / 2, part.y + part.height / 2, part.z + depth / 2],
    axes: [axis(1, 0, 0), axis(0, 1, 0), axis(0, 0, 1)],
    half: [part.width / 2, part.height / 2, depth / 2],
  };
}

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** How deep two turned boxes go into each other, in mm. Negative is the gap between them. */
function solidOverlap(a: Solid, b: Solid) {
  const between = [b.center[0] - a.center[0], b.center[1] - a.center[1], b.center[2] - a.center[2]];
  const tests = [...a.axes, ...b.axes, ...a.axes.flatMap((one) => b.axes.map((two) => cross(one, two)))];
  let least = Infinity;
  for (const raw of tests) {
    const length = Math.hypot(raw[0], raw[1], raw[2]);
    if (length < 1e-6) continue;
    const axis = raw.map((value) => value / length);
    const reach = (solid: Solid) => solid.axes.reduce((sum, own, index) => sum + solid.half[index] * Math.abs(dot(own, axis)), 0);
    least = Math.min(least, reach(a) + reach(b) - Math.abs(dot(between, axis)));
  }
  return least;
}

/** Whether a piece sits at an angle the straight bounds cannot follow. */
function angled(part: ScenePart) {
  return part.shape !== "cylinder" && (partTilt(part) % 90 !== 0 || (part.rotation ?? 0) % 90 !== 0);
}

function label(part: ScenePart) {
  return `${part.name} (${part.id})`;
}

export type AssemblyCheck = {
  /** Pairs of pieces that pass through each other. */
  overlaps: string[];
  /** Pieces above the floor that touch no other piece. */
  floating: string[];
};

/** What is physically wrong with the stand as it stands now. Hidden pieces are ignored. */
export function checkAssembly(parts: ScenePart[]): AssemblyCheck {
  const solid = parts.filter((part) => !part.hidden).map((part) => ({ part, bounds: partBounds(part), holes: holeBounds(part) }));
  const touching = new Set<string>();
  const overlaps: string[] = [];

  for (let i = 0; i < solid.length; i += 1) {
    for (let j = i + 1; j < solid.length; j += 1) {
      const a = solid[i];
      const b = solid[j];
      const shared = overlap(a.bounds, b.bounds);
      if (shared.x < -CONTACT_MM || shared.y < -CONTACT_MM || shared.z < -CONTACT_MM) continue;
      if (angled(a.part) || angled(b.part)) {
        const depth = solidOverlap(solidOf(a.part), solidOf(b.part));
        if (depth >= -CONTACT_MM) {
          touching.add(a.part.id);
          touching.add(b.part.id);
        }
        if (depth > CONTACT_MM) overlaps.push(`${label(a.part)} and ${label(b.part)} pass through each other by ${Math.round(depth)} mm`);
        continue;
      }
      // A piece inside a ring or an arch sits in empty space. It touches only if it reaches the opening's edge.
      const region = intersection(a.bounds, b.bounds);
      const hole = [...a.holes, ...b.holes].find((opening) => inside(region, opening, CONTACT_MM));
      if (hole) {
        if (!inside(region, hole, -CONTACT_MM)) {
          touching.add(a.part.id);
          touching.add(b.part.id);
        }
        continue;
      }
      if (shared.x >= -CONTACT_MM && shared.y >= -CONTACT_MM && shared.z >= -CONTACT_MM) {
        touching.add(a.part.id);
        touching.add(b.part.id);
      }
      if (shared.x > CONTACT_MM && shared.y > CONTACT_MM && shared.z > CONTACT_MM) {
        overlaps.push(`${label(a.part)} and ${label(b.part)} pass through each other by ${Math.round(Math.min(shared.x, shared.y, shared.z))} mm`);
      }
    }
  }

  const floating = solid
    .filter(({ part, bounds }) => bounds.minY > CONTACT_MM && !touching.has(part.id))
    .map(({ part, bounds }) => `${label(part)} is ${Math.round(bounds.minY)} mm above the floor and touches nothing`);

  return { overlaps: overlaps.slice(0, MAX_REPORTED), floating: floating.slice(0, MAX_REPORTED) };
}
