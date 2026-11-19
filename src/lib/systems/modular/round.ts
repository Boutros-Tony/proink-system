import { bulgeOf, pathLength, pathPoints } from "./geometry";
import type { Outline, Round } from "./schema";

type Point = [number, number];
type RoundLike = { width: number; height: number; round?: Round };

/** Board this thin or thinner is cut as a disc, not rolled. */
const THIN_MM = 50;

/** A round piece's profile kept inside its size: radius 0 to half the width, height 0 to the height. */
export function clampProfile(width: number, height: number, profile: Outline | undefined): Outline | undefined {
  if (!profile || profile.length < 2) return undefined;
  const at = (value: number, max: number) => Math.round(Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), max) * 10) / 10;
  const points: Outline = [];
  for (const raw of profile) {
    const r = at(raw[0], width / 2);
    const y = at(raw[1], height);
    const last = points[points.length - 1];
    if (last && Math.abs(last[0] - r) < 0.5 && Math.abs(last[1] - y) < 0.5) continue;
    const bulge = bulgeOf(raw);
    points.push(Math.abs(bulge) >= 0.001 ? [r, y, Math.round(bulge * 1000) / 1000] : [r, y]);
  }
  if (points.length < 2) return undefined;
  if (points.every((point) => point[0] === 0)) return undefined;
  const last = points[points.length - 1];
  points[points.length - 1] = [last[0], last[1]];
  return points;
}

/** The round options kept within the piece: nothing left when it is a plain solid cylinder. */
export function clampRound(width: number, height: number, round: Round | undefined): Round | undefined {
  if (!round) return undefined;
  const kept: Round = {};
  const profile = clampProfile(width, height, round.profile);
  if (profile) kept.profile = profile;
  else if (round.top !== undefined && Number.isFinite(round.top) && width - Math.min(Math.max(round.top, 0), width) >= 0.5) kept.top = Math.round(Math.min(Math.max(round.top, 0), width));
  const outer = width / 2;
  if (round.wall !== undefined && round.wall > 0 && round.wall < outer - 0.5) kept.wall = Math.round(round.wall * 10) / 10;
  if (round.sweep !== undefined && round.sweep < 359.5) kept.sweep = Math.round(Math.min(Math.max(round.sweep, 10), 360));
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** The outside of a round piece seen from the side: [radius, height] in mm, bottom to top. */
export function roundSilhouette(part: RoundLike, tolerance = 0.25): Point[] {
  const profile = part.round?.profile;
  if (profile && profile.length >= 2) return pathPoints(profile, false, tolerance);
  const top = part.round?.top !== undefined ? part.round.top / 2 : part.width / 2;
  return [
    [part.width / 2, 0],
    [top, part.height],
  ];
}

/** The silhouette moved in by the wall, square to it at every point, never past the axis. */
function inside(outer: Point[], wall: number): Point[] {
  return outer.map((point, index) => {
    const before = outer[Math.max(0, index - 1)];
    const after = outer[Math.min(outer.length - 1, index + 1)];
    const dr = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dr, dy) || 1;
    // Going up the outside, the left-hand side is toward the axis.
    return [Math.max(0, point[0] - (dy / length) * wall), point[1] + (dr / length) * wall];
  });
}

/**
 * The cross-section that is turned about the axis, as a closed ring of [radius, height] points: the silhouette
 * closed along the axis, or for a hollow piece the silhouette and the wall's inside face.
 */
export function roundSection(part: RoundLike, tolerance = 0.25): Point[] {
  const outer = roundSilhouette(part, tolerance);
  const wall = part.round?.wall;
  if (wall && wall > 0) return [...outer, ...inside(outer, wall).reverse()];
  const section: Point[] = [];
  const first = outer[0];
  const last = outer[outer.length - 1];
  if (first[0] > 0.01) section.push([0, first[1]]);
  section.push(...outer);
  if (last[0] > 0.01) section.push([0, last[1]]);
  return section;
}

/** The share of a full turn that is built. */
export function roundFraction(part: RoundLike) {
  return (part.round?.sweep ?? 360) / 360;
}

/** Whether a round piece is a plain cylinder, cone, or tube made from rolled sheet and discs, or a shape that has to be turned or molded. */
export function rolledFromSheet(part: RoundLike) {
  const profile = part.round?.profile;
  if (!profile) return true;
  return profile.length <= 2 && profile.every((point) => bulgeOf(point) === 0);
}

/** The outside surface, the area of the section, and the volume of a round piece, in mm² and mm³ (Pappus). */
export function roundMeasure(part: RoundLike) {
  const section = roundSection(part, 1);
  const fraction = roundFraction(part);
  let surface = 0;
  let area = 0;
  let moment = 0;
  section.forEach(([r0, y0], index) => {
    const [r1, y1] = section[(index + 1) % section.length];
    if (r0 < 0.01 && r1 < 0.01) return;
    surface += 2 * Math.PI * ((r0 + r1) / 2) * Math.hypot(r1 - r0, y1 - y0);
    const cross = r0 * y1 - r1 * y0;
    area += cross / 2;
    moment += ((r0 + r1) * cross) / 6;
  });
  const sectionArea = Math.abs(area);
  const centroid = sectionArea > 0 ? Math.abs(moment / area) : 0;
  const cutFaces = fraction < 1 ? 2 * sectionArea : 0;
  return { surface: surface * fraction + cutFaces, sectionArea, volume: 2 * Math.PI * centroid * sectionArea * fraction, fraction };
}

/**
 * The flat blanks a rolled round piece is made from: the side unrolled, the inside face of a hollow one, the two
 * end discs or rings, and the two flat faces where a part circle is cut. Nothing for a turned or molded shape.
 */
export function roundBlanks(part: RoundLike): Array<{ w: number; h: number; detail: string }> {
  if (!rolledFromSheet(part)) return [];
  const fraction = roundFraction(part);
  const outline = roundSilhouette(part);
  const bottom = outline[0][0];
  const top = outline[outline.length - 1][0];
  const wall = part.round?.wall ?? 0;
  const across = (radius: number) => Math.ceil(fraction > 0.5 ? 2 * radius : radius * (1 + Math.sin(Math.min(Math.PI / 2, Math.PI * fraction))));
  const disc = (radius: number, detail: string) => (radius > 0.5 ? [{ w: Math.ceil(2 * radius), h: across(radius), detail }] : []);
  if (part.height <= THIN_MM && !wall && Math.abs(bottom - top) < 0.5) return disc(bottom, fraction < 1 ? "part disc" : "disc");
  const slant = Math.ceil(Math.hypot(bottom - top, part.height));
  const blanks = [{ w: Math.ceil(2 * Math.PI * Math.max(bottom, top) * fraction), h: slant, detail: Math.abs(bottom - top) < 0.5 ? "unrolled side" : "unrolled cone side" }];
  if (wall) blanks.push({ w: Math.ceil(2 * Math.PI * Math.max(bottom - wall, top - wall, 0) * fraction), h: slant, detail: "unrolled inside" });
  blanks.push(...disc(bottom, wall ? "ring" : "cap"), ...disc(top, wall ? "ring" : "cap"));
  if (fraction < 1) {
    const flat = Math.ceil(wall || Math.max(bottom, top));
    blanks.push({ w: flat, h: slant, detail: "cut face" }, { w: flat, h: slant, detail: "cut face" });
  }
  return blanks;
}

/** A short description for the AI and the quote: what the round piece is. */
export function roundNote(part: RoundLike) {
  const round = part.round;
  if (!round) return "";
  const bits: string[] = [];
  if (round.profile) bits.push(`turned to a ${round.profile.length}-point profile${rolledFromSheet(part) ? "" : ", turned or molded, not cut from flat board"}`);
  else if (round.top !== undefined) bits.push(round.top === 0 ? "a cone" : `top Ø ${Math.round(round.top)}`);
  if (round.wall) bits.push(`hollow, ${Math.round(round.wall)} mm wall`);
  if (round.sweep) bits.push(`${Math.round(round.sweep)}° of the circle`);
  return bits.join(", ");
}

/** A tube's length along its path, in mm. */
export function tubeLength(part: { path?: Outline; closed?: boolean }) {
  return part.path ? pathLength(part.path, part.closed ?? false) : 0;
}
