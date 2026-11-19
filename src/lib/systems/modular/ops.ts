import {
  clampChamfers,
  clampCorners,
  clampHoles,
  clampOutline,
  clampPath,
  closable,
  faceAxes,
  normalizeDegrees,
  partBounds,
  partCenter,
  partFootprint,
  rotateOffset,
  scaleOutline,
  turnCurve,
  unionBounds,
  type PartLike,
} from "./geometry";
import { applyDesignPatch } from "./patch";
import { clampRound } from "./round";
import type { DesignDocument, PartChanges, PartDraft, ScenePart } from "./schema";

/**
 * Every edit to a stand goes through these pure functions: the toolbar, the
 * viewport handles, the keyboard, and the AI tools. They never mutate their input.
 */

export type Transform =
  | { kind: "move"; x: number; y: number; z: number }
  | { kind: "rotate"; degrees: number }
  | { kind: "scale"; x: number; y: number; z: number };

type Editable = PartLike & { id: string; locked?: boolean };

const MIN_SIZE = 5;

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function hasBooth(document: DesignDocument) {
  return document.walls.some((wall) => wall.bays.length > 0);
}

export function partIds(document: DesignDocument) {
  return new Set(document.parts.map((part) => part.id));
}

/** Pieces that exist and are not locked. Locked pieces ignore moves, resizes, and deletes. */
export function editableIds(document: DesignDocument, ids: string[]) {
  const wanted = new Set(ids);
  return document.parts.filter((part) => wanted.has(part.id) && !part.locked).map((part) => part.id);
}

/** Add every member of a group when one member is picked. */
export function expandToGroups(document: DesignDocument, ids: string[]) {
  const wanted = new Set(ids);
  const groups = new Set(
    document.parts.flatMap((part) => (wanted.has(part.id) && part.group ? [part.group] : [])),
  );
  return document.parts.filter((part) => wanted.has(part.id) || (part.group && groups.has(part.group))).map((part) => part.id);
}

function slug(text: string) {
  const value = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return value || "part";
}

export function uniqueId(taken: Set<string>, base: string) {
  const root = slug(base);
  if (!taken.has(root)) return root;
  let index = 2;
  while (taken.has(`${root}-${index}`)) index += 1;
  return `${root}-${index}`;
}

/** Shift a set of pieces so none of them sits below the floor or behind the back-left corner. */
function keepInside<T extends PartLike>(parts: T[]): T[] {
  const bounds = unionBounds(parts);
  if (!bounds) return parts;
  const dx = bounds.minX < 0 ? -bounds.minX : 0;
  const dy = bounds.minY < 0 ? -bounds.minY : 0;
  const dz = bounds.minZ < 0 ? -bounds.minZ : 0;
  if (dx === 0 && dy === 0 && dz === 0) return parts;
  return parts.map((part) => ({ ...part, x: round(part.x + dx), y: round(part.y + dy), z: round(part.z + dz) }));
}

/**
 * Apply a drag or a typed change to the given pieces. Used for the live preview
 * while a handle is dragged and for the final edit, so both always agree.
 */
export function transformParts<T extends Editable>(parts: T[], ids: string[], transform: Transform): T[] {
  const wanted = new Set(ids);
  const targets = parts.filter((part) => wanted.has(part.id) && !part.locked);
  if (targets.length === 0) return parts;
  const bounds = unionBounds(targets);
  const pivotX = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
  const pivotZ = bounds ? (bounds.minZ + bounds.maxZ) / 2 : 0;

  const moved = parts.map((part) => {
    if (!wanted.has(part.id) || part.locked) return part;
    if (transform.kind === "move") {
      return { ...part, x: round(part.x + transform.x), y: round(part.y + transform.y), z: round(part.z + transform.z) };
    }
    if (transform.kind === "rotate") {
      const center = partCenter(part);
      const offset = rotateOffset(center.x - pivotX, center.z - pivotZ, transform.degrees);
      const footprint = partFootprint(part);
      const rotation = part.shape === "cylinder" ? part.rotation : normalizeDegrees((part.rotation ?? 0) + transform.degrees);
      return {
        ...part,
        x: round(pivotX + offset.x - footprint.width / 2),
        z: round(pivotZ + offset.z - footprint.depth / 2),
        rotation,
      };
    }
    const footprint = partFootprint(part);
    const center = partCenter(part);
    const width = Math.max(MIN_SIZE, round(footprint.width * transform.x));
    const height = Math.max(MIN_SIZE, round(part.height * transform.y));
    const depth = part.shape === "cylinder" ? width : Math.max(MIN_SIZE, round(footprint.depth * transform.z));
    return {
      ...part,
      x: round(center.x - width / 2),
      z: round(center.z - depth / 2),
      width,
      height,
      depth,
    };
  });

  const inside = keepInside(moved.filter((part) => wanted.has(part.id) && !part.locked));
  const byId = new Map(inside.map((part) => [part.id, part]));
  return moved.map((part) => byId.get(part.id) ?? part);
}

function commit(document: DesignDocument, parts: ScenePart[]) {
  return applyDesignPatch(document, { parts });
}

export function moveParts(document: DesignDocument, ids: string[], delta: { x?: number; y?: number; z?: number }) {
  return commit(document, transformParts(document.parts, ids, { kind: "move", x: delta.x ?? 0, y: delta.y ?? 0, z: delta.z ?? 0 }));
}

export function rotateParts(document: DesignDocument, ids: string[], degrees: number) {
  return commit(document, transformParts(document.parts, ids, { kind: "rotate", degrees }));
}

export function scaleParts(document: DesignDocument, ids: string[], factor: { x: number; y: number; z: number }) {
  return commit(document, transformParts(document.parts, ids, { kind: "scale", ...factor }));
}

export function applyTransform(document: DesignDocument, ids: string[], transform: Transform) {
  return commit(document, transformParts(document.parts, ids, transform));
}

/** Where a new piece of the given footprint should appear so it is easy to see and does not overlap. */
export function placementFor(document: DesignDocument, width: number, depth: number) {
  if (hasBooth(document)) {
    return {
      x: Math.max(0, round((document.envelope.width - width) / 2)),
      z: Math.max(0, round((document.envelope.depth - depth) / 2)),
    };
  }
  const bounds = unionBounds(document.parts);
  if (!bounds) return { x: 0, z: 0 };
  return { x: Math.ceil(bounds.maxX + 300), z: 0 };
}

export function defaultPart(document: DesignDocument, shape: "box" | "cylinder" | "letters"): PartDraft {
  const letters = shape === "letters";
  const size = shape === "cylinder" ? { width: 500, height: 800, depth: 500 } : letters ? { width: 1200, height: 280, depth: 10 } : { width: 600, height: 600, depth: 600 };
  const place = placementFor(document, size.width, size.depth);
  return {
    name: shape === "cylinder" ? "Cylinder" : letters ? "Letters" : "Box",
    shape,
    x: place.x,
    y: 0,
    z: place.z,
    ...size,
    material: letters ? "wood" : "mdf",
    color: letters ? "#6b3a2a" : "#f4f1ea",
    ...(letters ? { label: "ABC" } : {}),
  };
}

function finishDraft(draft: PartDraft, taken: Set<string>): ScenePart {
  const id = uniqueId(taken, draft.id ?? draft.name);
  taken.add(id);
  const depth = draft.shape === "cylinder" ? draft.width : draft.depth;
  return applyCorners({
    ...draft,
    id,
    depth,
    x: Math.max(0, draft.x),
    y: Math.max(0, draft.y),
    z: Math.max(0, draft.z),
    ...(draft.rotation !== undefined ? { rotation: normalizeDegrees(draft.rotation) } : {}),
  });
}

/** Keep a tilt between -180 and 180, and drop it on a cylinder or when it is level. */
function levelTilt(part: ScenePart) {
  const tilt = part.shape === "cylinder" || part.tilt === undefined ? 0 : normalizeDegrees(part.tilt);
  if (tilt === 0) delete part.tilt;
  else part.tilt = tilt;
}

function applyCorners(part: ScenePart): ScenePart {
  levelTilt(part);
  if (part.face === "front") delete part.face;
  const turned = part.shape === "cylinder" ? clampRound(part.width, part.height, part.round) : undefined;
  if (turned) part.round = turned;
  else delete part.round;
  if (part.shape === "tube") {
    const face = faceAxes(part);
    const path = clampPath(face.width, face.height, part.path, part.closed ?? false) ?? [
      [0, face.height / 2],
      [face.width, face.height / 2],
    ];
    part.path = path;
    if (!part.closed || !closable(path)) delete part.closed;
  } else {
    delete part.path;
    delete part.closed;
  }
  if (part.shape !== "box" || part.curve) {
    delete part.corners;
    delete part.chamfers;
    delete part.holes;
    delete part.outline;
    if (part.shape !== "tube") delete part.face;
    if (part.shape !== "box") delete part.curve;
    else if (part.curve) {
      const tall = part.curve.axis === "depth" ? part.height : part.depth;
      const room = part.curve.corner ? Math.min(part.width, tall) : tall;
      part.curve = { ...part.curve, thickness: Math.min(part.curve.thickness, room) };
    }
    return part;
  }
  const face = faceAxes(part);
  const outline = clampOutline(face.width, face.height, part.outline);
  if (outline) {
    part.outline = outline;
    delete part.corners;
    delete part.chamfers;
    const holes = clampHoles(face.width, face.height, part.holes, undefined, undefined, outline);
    if (holes) part.holes = holes;
    else delete part.holes;
    return part;
  }
  delete part.outline;
  const chamfers = clampChamfers(face.width, face.height, part.chamfers);
  if (chamfers) part.chamfers = chamfers;
  else delete part.chamfers;
  const corners = clampCorners(face.width, face.height, part.corners);
  if (corners && chamfers) {
    for (const key of ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const) {
      const cut = chamfers[key];
      if (cut && (cut.x ?? 0) > 0 && (cut.y ?? 0) > 0) delete corners[key];
    }
  }
  if (corners && Object.keys(corners).length > 0) part.corners = corners;
  else delete part.corners;
  const holes = clampHoles(face.width, face.height, part.holes, part.corners, part.chamfers);
  if (holes) part.holes = holes;
  else delete part.holes;
  return part;
}

export function addParts(document: DesignDocument, drafts: PartDraft[], group?: { id: string; name: string }) {
  const taken = partIds(document);
  const added = drafts.map((draft) => finishDraft(group ? { ...draft, group: group.id } : draft, taken));
  const next = applyDesignPatch(document, {
    parts: [...document.parts, ...added],
    ...(group ? { groups: { ...document.groups, [group.id]: group.name } } : {}),
  });
  return { document: next, ids: added.map((part) => part.id) };
}

export function updateParts(document: DesignDocument, ids: string[], changes: PartChanges) {
  const targets = new Set(editableIds(document, ids));
  const parts = document.parts.map((part) => {
    if (!targets.has(part.id)) return part;
    const { materialId, curve, outline, round: roundChange, ...rest } = changes;
    const merged: ScenePart = { ...part, ...rest };
    if (roundChange) merged.round = roundChange;
    else if (roundChange === null) delete merged.round;
    else if (part.round?.profile && (merged.width !== part.width || merged.height !== part.height)) {
      const sx = merged.width / part.width;
      const sy = merged.height / part.height;
      merged.round = { ...part.round, profile: part.round.profile.map((point) => (point.length === 3 ? [point[0] * sx, point[1] * sy, point[2]] : [point[0] * sx, point[1] * sy])) };
    }
    if (part.path && !changes.path && (merged.width !== part.width || merged.height !== part.height || merged.depth !== part.depth)) {
      const was = faceAxes(part);
      const now = faceAxes(merged);
      if (now.face === was.face) merged.path = scaleOutline(part.path, was, now);
    }
    if (outline) merged.outline = outline;
    else if (outline === null) delete merged.outline;
    else if (part.outline) {
      const was = faceAxes(part);
      const now = faceAxes(merged);
      if (now.face === was.face && (now.width !== was.width || now.height !== was.height)) merged.outline = scaleOutline(part.outline, was, now);
    }
    if (materialId) merged.materialId = materialId;
    else if (materialId === null || changes.material !== undefined) delete merged.materialId;
    if (curve) merged.curve = curve;
    else if (curve === null) delete merged.curve;
    else if (part.curve && (merged.width !== part.width || merged.height !== part.height || merged.depth !== part.depth)) {
      // The same three sizes in another order turn a bent board. Its curve turns with it instead of being redrawn.
      const turned = turnCurve(part.curve, part, merged);
      if (turned) merged.curve = turned;
    }
    const shape = merged.shape;
    if (shape === "cylinder") merged.depth = merged.width;
    merged.x = Math.max(0, round(merged.x));
    merged.y = Math.max(0, round(merged.y));
    merged.z = Math.max(0, round(merged.z));
    if (changes.rotation !== undefined) merged.rotation = normalizeDegrees(changes.rotation);
    if (merged.images && merged.images.length === 0) delete merged.images;
    return applyCorners(merged);
  });
  return commit(document, parts);
}

export function setPartFlags(document: DesignDocument, ids: string[], flags: { locked?: boolean; hidden?: boolean }) {
  const wanted = new Set(ids);
  const parts = document.parts.map((part) => {
    if (!wanted.has(part.id)) return part;
    const next: ScenePart = { ...part };
    if (flags.locked !== undefined) {
      if (flags.locked) next.locked = true;
      else delete next.locked;
    }
    if (flags.hidden !== undefined) {
      if (flags.hidden) next.hidden = true;
      else delete next.hidden;
    }
    return next;
  });
  return commit(document, parts);
}

export function renamePart(document: DesignDocument, id: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return document;
  return commit(
    document,
    document.parts.map((part) => (part.id === id ? { ...part, name: trimmed } : part)),
  );
}

export function removeParts(document: DesignDocument, ids: string[]) {
  const targets = new Set(editableIds(document, ids));
  if (targets.size === 0) return document;
  return commit(
    document,
    document.parts.filter((part) => !targets.has(part.id)),
  );
}

export function duplicateParts(
  document: DesignDocument,
  ids: string[],
  offset: { x: number; y: number; z: number } = { x: 100, y: 0, z: 100 },
) {
  const wanted = new Set(ids);
  const sources = document.parts.filter((part) => wanted.has(part.id));
  if (sources.length === 0) return { document, ids: [] as string[] };
  const taken = partIds(document);
  const groupIds = new Set(document.parts.map((part) => part.group).filter((value): value is string => Boolean(value)));
  const groupMap = new Map<string, string>();
  const groups = { ...document.groups };
  const copies = sources.map((source) => {
    const id = uniqueId(taken, source.id);
    taken.add(id);
    const copy: ScenePart = { ...source, id, x: source.x + offset.x, y: source.y + offset.y, z: source.z + offset.z };
    delete copy.locked;
    if (source.group) {
      let group = groupMap.get(source.group);
      if (!group) {
        group = uniqueId(groupIds, `${source.group}-copy`);
        groupIds.add(group);
        groupMap.set(source.group, group);
        groups[group] = `${document.groups?.[source.group] ?? "Group"} copy`;
      }
      copy.group = group;
    }
    return copy;
  });
  const placed = keepInside(copies);
  const next = applyDesignPatch(document, {
    parts: [...document.parts, ...placed],
    ...(groupMap.size > 0 ? { groups } : {}),
  });
  return { document: next, ids: placed.map((part) => part.id) };
}

export function groupParts(document: DesignDocument, ids: string[], name = "Group") {
  const wanted = new Set(ids);
  const members = document.parts.filter((part) => wanted.has(part.id));
  if (members.length < 2) return { document, group: null as string | null };
  const taken = new Set(document.parts.map((part) => part.group).filter((value): value is string => Boolean(value)));
  const group = uniqueId(taken, name);
  const next = applyDesignPatch(document, {
    parts: document.parts.map((part) => (wanted.has(part.id) ? { ...part, group } : part)),
    groups: { ...document.groups, [group]: name },
  });
  return { document: next, group };
}

export function ungroupParts(document: DesignDocument, ids: string[]) {
  const wanted = new Set(ids);
  const groups = new Set(
    document.parts.flatMap((part) => (wanted.has(part.id) && part.group ? [part.group] : [])),
  );
  if (groups.size === 0) return document;
  return commit(
    document,
    document.parts.map((part) => {
      if (!part.group || !groups.has(part.group)) return part;
      const next: ScenePart = { ...part };
      delete next.group;
      return next;
    }),
  );
}

export function renameGroup(document: DesignDocument, group: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return document;
  return applyDesignPatch(document, { groups: { ...document.groups, [group]: trimmed } });
}

export type AlignEdge = "min" | "center" | "max";
type AxisName = "x" | "y" | "z";

function axisRange(part: PartLike, axis: AxisName): [number, number] {
  const bounds = partBounds(part);
  if (axis === "x") return [bounds.minX, bounds.maxX];
  if (axis === "y") return [bounds.minY, bounds.maxY];
  return [bounds.minZ, bounds.maxZ];
}

export function alignParts(document: DesignDocument, ids: string[], axis: AxisName, edge: AlignEdge) {
  const targets = document.parts.filter((part) => editableIds(document, ids).includes(part.id));
  if (targets.length < 2) return document;
  const ranges = targets.map((part) => axisRange(part, axis));
  const low = Math.min(...ranges.map((range) => range[0]));
  const high = Math.max(...ranges.map((range) => range[1]));
  const goal = edge === "min" ? low : edge === "max" ? high : (low + high) / 2;
  const shifts = new Map(
    targets.map((part, index) => {
      const [from, to] = ranges[index];
      const value = edge === "min" ? from : edge === "max" ? to : (from + to) / 2;
      return [part.id, goal - value] as const;
    }),
  );
  return commit(
    document,
    document.parts.map((part) => {
      const shift = shifts.get(part.id);
      return shift === undefined ? part : { ...part, [axis]: round(part[axis] + shift) };
    }),
  );
}

/** Space three or more pieces so the gaps between their faces are equal. */
export function distributeParts(document: DesignDocument, ids: string[], axis: AxisName) {
  const allowed = new Set(editableIds(document, ids));
  const targets = document.parts
    .filter((part) => allowed.has(part.id))
    .map((part) => ({ part, range: axisRange(part, axis) }))
    .sort((a, b) => a.range[0] + a.range[1] - (b.range[0] + b.range[1]));
  if (targets.length < 3) return document;
  const first = targets[0].range[0];
  const last = targets[targets.length - 1].range[1];
  const sizes = targets.reduce((sum, item) => sum + (item.range[1] - item.range[0]), 0);
  const gap = (last - first - sizes) / (targets.length - 1);
  let cursor = first;
  const shifts = new Map<string, number>();
  for (const item of targets) {
    shifts.set(item.part.id, cursor - item.range[0]);
    cursor += item.range[1] - item.range[0] + gap;
  }
  return commit(
    document,
    document.parts.map((part) => {
      const shift = shifts.get(part.id);
      return shift === undefined ? part : { ...part, [axis]: round(part[axis] + shift) };
    }),
  );
}

/** Put every selected piece on the floor. */
export function dropToFloor(document: DesignDocument, ids: string[]) {
  const targets = new Set(editableIds(document, ids));
  return commit(
    document,
    document.parts.map((part) => (targets.has(part.id) ? { ...part, y: 0 } : part)),
  );
}
