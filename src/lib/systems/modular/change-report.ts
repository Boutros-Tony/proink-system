import { bendProfile, bulgeOf, clampHoles, faceAxes, HOLE_RIM_MM, normalizeDegrees, outlineCrosses } from "./geometry";
import { roundNote, tubeLength } from "./round";
import type { Chamfers, CornerRadii, DesignDocument, Hole, Outline, PartChanges, ScenePart } from "./schema";

const CORNER_KEYS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;
type CornerKey = (typeof CORNER_KEYS)[number];

const SHORT: Record<CornerKey, string> = { topLeft: "tl", topRight: "tr", bottomLeft: "bl", bottomRight: "br" };
/** Where each corner of a top or side face really is, so a cut is not put at the back by mistake. */
const FACE_LEGEND = {
  side: "seen from the right: tl top front, tr top back, bl bottom front, br bottom back; x from the front",
  top: "seen from above: tl back left, tr back right, bl front left, br front right; y from the front",
} as const;

/** Smaller than this, and a stored number still counts as what was asked. */
const NOTICE_MM = 0.5;

function whole(value: number) {
  return Math.round(value);
}

function askedNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function apart(asked: number, got: number) {
  return Math.abs(asked - got) > NOTICE_MM;
}

function cornerNote(corners: CornerRadii | undefined) {
  if (!corners || !CORNER_KEYS.some((key) => (corners[key] ?? 0) > 0)) return "";
  return `corners ${CORNER_KEYS.map((key) => `${SHORT[key]} ${whole(corners[key] ?? 0)}`).join(" ")}`;
}

function chamferNote(chamfers: Chamfers | undefined) {
  if (!chamfers) return "";
  const cuts = CORNER_KEYS.flatMap((key) => {
    const cut = chamfers[key];
    if (!cut || ((cut.x ?? 0) <= 0 && (cut.y ?? 0) <= 0)) return [];
    return [`${SHORT[key]} ${whole(cut.x ?? 0)}×${whole(cut.y ?? 0)}`];
  });
  return cuts.length > 0 ? `chamfers ${cuts.join(" ")}` : "";
}

function radiusNote(corners: CornerRadii | undefined) {
  if (!corners) return "";
  const values = CORNER_KEYS.map((key) => whole(corners[key] ?? 0));
  if (values.every((value) => value <= 0)) return "";
  if (values.every((value) => value === values[0])) return ` (r ${values[0]})`;
  const mixed = CORNER_KEYS.flatMap((key, index) => (values[index] > 0 ? [`${SHORT[key]} ${values[index]}`] : []));
  return ` (r ${mixed.join(" ")})`;
}

function openingNote(holes: Hole[] | undefined) {
  if (!holes?.length) return "";
  const listed = holes.map((hole) => `${whole(hole.width)}×${whole(hole.height)} at x ${whole(hole.x)} y ${whole(hole.y)}${radiusNote(hole.corners)}`);
  return `${holes.length} ${holes.length === 1 ? "opening" : "openings"}: ${listed.join("; ")}`;
}

/** One line the model can check against the piece that was actually stored. */
export function describePart(part: ScenePart): string {
  const bits = [`${part.id} "${part.name}" ${part.shape} ${whole(part.width)} × ${whole(part.height)} × ${whole(part.depth)} mm`];
  if (part.material) bits.push(part.material);
  bits.push(`at ${whole(part.x)}, ${whole(part.y)}, ${whole(part.z)}`);
  if (typeof part.rotation === "number" && part.rotation !== 0) bits.push(`rotation ${whole(part.rotation)}`);
  if (typeof part.tilt === "number" && part.tilt !== 0) bits.push(`tilt ${whole(part.tilt)}`);
  if (part.label) bits.push(`label "${part.label}"`);
  if (part.face && part.face !== "front" && (part.corners || part.chamfers || part.holes || part.outline)) bits.push(`shaped on the ${part.face} face (${FACE_LEGEND[part.face]})`);
  const outline = part.outline ? `outline ${part.outline.map((point) => `${whole(point[0])},${whole(point[1])}${bulgeOf(point) ? ` arc ${bulgeOf(point)}` : ""}`).join(" ")}` : "";
  const turned = part.round ? roundNote(part) : "";
  const path = part.path
    ? `path on the ${part.face ?? "front"} face ${part.path.map((point) => `${whole(point[0])},${whole(point[1])}${bulgeOf(point) ? ` arc ${bulgeOf(point)}` : ""}`).join(" ")}${part.closed ? " closed" : ""}, ${whole(tubeLength(part))} mm long`
    : "";
  for (const extra of [outline, turned, path, cornerNote(part.corners), chamferNote(part.chamfers), openingNote(part.holes)]) {
    if (extra) bits.push(extra);
  }
  if (part.curve) {
    const bend = bendProfile(part, part.curve);
    const shape = part.curve.corner ? `quarter corner, outside at ${part.curve.corner}` : `bow toward the ${part.curve.toward ?? (bend.front ? "up" : "front")}`;
    bits.push(`bent ${whole(bend.thickness)} mm board seen from ${bend.front ? "the front" : "above"}, ${shape}, turns ${whole(bend.sweep)}°, flat blank ${whole(bend.blank)} × ${whole(bend.length)} mm`);
  }
  if (part.hidden) bits.push("hidden");
  if (part.locked) bits.push("locked");
  return bits.join(", ");
}

function who(part: ScenePart) {
  return `${part.id} "${part.name}"`;
}

function skipped(part: ScenePart) {
  return part.locked ? "the piece is locked" : "the piece was left as it was";
}

function note(part: ScenePart, detail: string, reason?: string) {
  return reason ? `${who(part)}: ${detail} (${reason}).` : `${who(part)}: ${detail}.`;
}

function sizeReason(part: ScenePart, key: "width" | "height" | "depth" | "x" | "y" | "z" | "rotation" | "tilt", asked: number, got: number, applied: boolean) {
  if (!applied) return skipped(part);
  if (key === "depth" && part.shape === "cylinder") return "a cylinder's depth matches its width";
  if (key === "tilt" && part.shape === "cylinder") return "a cylinder does not tilt";
  if ((key === "x" || key === "y" || key === "z") && asked < 0 && got >= -NOTICE_MM) return "position stays at 0 or above";
  if ((key === "rotation" || key === "tilt") && Math.abs(normalizeDegrees(asked) - got) <= NOTICE_MM) return `${key} stays between -180 and 180`;
  return undefined;
}

function cornerReason(part: ScenePart, key: CornerKey, applied: boolean) {
  if (!applied) return skipped(part);
  if (part.shape !== "box") return "only a box has rounded corners";
  if (part.curve) return "a bent panel has no corners";
  const cut = part.chamfers?.[key];
  if (cut && (cut.x ?? 0) > 0 && (cut.y ?? 0) > 0) return "a straight cut wins over a radius on the same corner";
  return "limited by the piece size";
}

function outlineReason(part: ScenePart, asked: Outline) {
  if (part.shape !== "box") return "only a box has an outline";
  if (part.curve) return "a bent panel has no outline";
  const face = faceAxes(part);
  if (outlineCrosses(asked)) return "its edges cross, arcs included, so it is not one piece";
  if (asked.some(([x, y]) => x > face.width + NOTICE_MM || y > face.height + NOTICE_MM)) return `points must fit the ${face.face} face, ${whole(face.width)} × ${whole(face.height)} mm`;
  return "it has no area, or it is the plain rectangle";
}

function chamferReason(part: ScenePart, applied: boolean) {
  if (!applied) return skipped(part);
  if (part.shape !== "box") return "only a box has straight corner cuts";
  if (part.curve) return "a bent panel has no corner cuts";
  return "limited by the piece size";
}

function droppedOpenings(part: ScenePart, holes: Hole[]) {
  const dropped = new Set<number>();
  if (part.shape !== "box" || part.curve) {
    holes.forEach((_, index) => dropped.add(index));
    return dropped;
  }
  const face = faceAxes(part);
  let kept = 0;
  for (let index = 0; index < holes.length; index += 1) {
    const next = clampHoles(face.width, face.height, holes.slice(0, index + 1), part.corners, part.chamfers, part.outline)?.length ?? 0;
    if (next === kept) dropped.add(index);
    kept = next;
  }
  return dropped;
}

function holeDropReason(part: ScenePart, hole: Hole) {
  if (part.shape !== "box") return "openings only go through a box";
  if (part.curve) return "a bent panel has no openings";
  const face = faceAxes(part);
  const alone = clampHoles(face.width, face.height, [hole], part.corners, part.chamfers, part.outline);
  if (!alone?.length) return "it did not fit on the piece";
  return "it overlapped an earlier opening";
}

function openingCornerReason(part: ScenePart, hole: Hole, key: CornerKey, got: number, applied: boolean) {
  if (!applied) return skipped(part);
  if (hole.y < 1 && (key === "bottomLeft" || key === "bottomRight") && got <= NOTICE_MM) return "an opening at the bottom stays square along the bottom";
  return "limited by the opening size";
}

function compareOpening(part: ScenePart, number: number, hole: Hole, got: Hole, applied: boolean) {
  const lines: string[] = [];
  const reason = applied ? `an opening keeps a ${HOLE_RIM_MM} mm rim` : skipped(part);
  const fields = [
    ["x", `x ${whole(hole.x)}`],
    ["y", `y ${whole(hole.y)}`],
    ["width", `${whole(hole.width)} wide`],
    ["height", `${whole(hole.height)} high`],
  ] as const;
  for (const [key, phrase] of fields) {
    const asked = askedNumber(hole[key]);
    const stored = askedNumber(got[key]);
    if (asked === undefined || stored === undefined || !apart(asked, stored)) continue;
    lines.push(note(part, `opening ${number} asked ${phrase}, set to ${whole(stored)}`, reason));
  }
  for (const key of CORNER_KEYS) {
    const asked = askedNumber(hole.corners?.[key]);
    if (asked === undefined) continue;
    const stored = got.corners?.[key] ?? 0;
    if (!apart(asked, stored)) continue;
    lines.push(note(part, `opening ${number} corner ${key} asked ${whole(asked)}, set to ${whole(stored)}`, openingCornerReason(part, hole, key, stored, applied)));
  }
  return lines;
}

function openingNotes(part: ScenePart, holes: Hole[], applied: boolean) {
  const lines: string[] = [];
  const dropped = applied ? droppedOpenings(part, holes) : new Set<number>();
  let storedIndex = 0;
  holes.forEach((hole, index) => {
    const number = index + 1;
    if (!applied) {
      const got = part.holes?.[index];
      if (!got) lines.push(note(part, `opening ${number} was not cut`, skipped(part)));
      else lines.push(...compareOpening(part, number, hole, got, false));
      return;
    }
    if (dropped.has(index)) {
      lines.push(note(part, `opening ${number} was not cut`, holeDropReason(part, hole)));
      return;
    }
    const got = part.holes?.[storedIndex];
    storedIndex += 1;
    if (!got) lines.push(note(part, `opening ${number} was not cut`, holeDropReason(part, hole)));
    else lines.push(...compareOpening(part, number, hole, got, true));
  });
  return lines;
}

function adjustments(part: ScenePart, requested: PartChanges, applied: boolean) {
  const lines: string[] = [];
  if (typeof requested.name === "string" && requested.name !== part.name) {
    lines.push(note(part, `name asked "${requested.name}", set to "${part.name}"`, applied ? undefined : skipped(part)));
  }
  const sized = [
    ["width", "wide"],
    ["height", "high"],
    ["depth", "deep"],
  ] as const;
  for (const [key, word] of sized) {
    const asked = askedNumber(requested[key]);
    const stored = askedNumber(part[key]);
    if (asked === undefined || stored === undefined || !apart(asked, stored)) continue;
    lines.push(note(part, `asked ${whole(asked)} ${word}, set to ${whole(stored)}`, sizeReason(part, key, asked, stored, applied)));
  }
  for (const key of ["x", "y", "z", "rotation", "tilt"] as const) {
    const asked = askedNumber(requested[key]);
    if (asked === undefined) continue;
    const stored = key === "rotation" || key === "tilt" ? (part[key] ?? 0) : part[key];
    if (!apart(asked, stored)) continue;
    const phrase = `${key} ${whole(asked)}`;
    lines.push(note(part, `asked ${phrase}, set to ${whole(stored)}`, sizeReason(part, key, asked, stored, applied)));
  }
  for (const key of CORNER_KEYS) {
    const asked = askedNumber(requested.corners?.[key]);
    if (asked === undefined) continue;
    const stored = part.corners?.[key] ?? 0;
    if (!apart(asked, stored)) continue;
    lines.push(note(part, `corner ${key} asked ${whole(asked)}, set to ${whole(stored)}`, cornerReason(part, key, applied)));
  }
  for (const key of CORNER_KEYS) {
    const cut = requested.chamfers?.[key];
    if (!cut) continue;
    for (const axis of ["x", "y"] as const) {
      const asked = askedNumber(cut[axis]);
      if (asked === undefined) continue;
      const stored = part.chamfers?.[key]?.[axis] ?? 0;
      if (!apart(asked, stored)) continue;
      lines.push(note(part, `chamfer ${key} ${axis} asked ${whole(asked)}, set to ${whole(stored)}`, chamferReason(part, applied)));
    }
  }
  if (requested.holes) lines.push(...openingNotes(part, requested.holes, applied));
  if (requested.outline) {
    if (!part.outline) lines.push(note(part, `outline of ${requested.outline.length} points was not kept`, part.locked ? skipped(part) : outlineReason(part, requested.outline)));
    else if (applied && part.outline.length !== requested.outline.length) lines.push(note(part, `outline asked ${requested.outline.length} points, kept ${part.outline.length}`, "points on a straight run, repeated, or outside the face were dropped"));
    const arcs = (outline: Outline) => outline.reduce((sum, point) => sum + Math.abs(bulgeOf(point)), 0);
    if (part.outline && applied && arcs(part.outline) < arcs(requested.outline) - 0.01) {
      lines.push(note(part, "an arc on the outline was flattened", "a full arc would run off the face, so make the face bigger or the arc shallower"));
    }
  }
  if (requested.round && applied) {
    if (part.shape !== "cylinder") lines.push(note(part, "round was not kept", "only a cylinder is turned"));
    else if (!part.round) lines.push(note(part, "round was not kept", "it is the plain cylinder, or the profile has no width"));
    else {
      if (requested.round.wall && !part.round.wall) lines.push(note(part, `wall ${whole(requested.round.wall)} was not kept`, `a wall must be thinner than the radius, ${whole(part.width / 2)} mm`));
      if (requested.round.profile && !part.round.profile) lines.push(note(part, "the profile was not kept", "it needs two points and some width"));
    }
  }
  if (requested.path && applied) {
    if (part.shape !== "tube") lines.push(note(part, "path was not kept", "only a tube follows a path"));
    else if (part.path && requested.path.some(([x, y]) => x < -NOTICE_MM || y < -NOTICE_MM || x > faceAxes(part).width + NOTICE_MM || y > faceAxes(part).height + NOTICE_MM)) {
      lines.push(note(part, "path points were moved onto the face", `the path stays inside ${whole(faceAxes(part).width)} × ${whole(faceAxes(part).height)} mm`));
    }
  }
  return lines;
}

/**
 * Ids the edit actually rewrote, ids it left alone, and numbers the shop limits changed.
 * An id that is not in the document is ignored.
 */
export function changeReport(before: DesignDocument, after: DesignDocument, ids: string[], requested?: PartChanges) {
  const beforeById = new Map(before.parts.map((part) => [part.id, part]));
  const afterById = new Map(after.parts.map((part) => [part.id, part]));
  const changed: string[] = [];
  const unchanged: string[] = [];
  const adjusted: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const next = afterById.get(id);
    if (!next) continue;
    const same = JSON.stringify(beforeById.get(id)) === JSON.stringify(next);
    if (same) unchanged.push(id);
    else changed.push(describePart(next));
    if (requested) adjusted.push(...adjustments(next, requested, !same));
  }
  return { changed, adjusted, unchanged };
}
