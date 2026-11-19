import { checkAssembly } from "./assemble";
import { faceShape, partBounds, rectanglesOverlapArea, unionBounds, type Bounds } from "./geometry";
import type { DesignDocument, ScenePart } from "./schema";

/**
 * Plain-English measurements of an assembled stand, for the production check.
 * Positions are only meaningful once the pieces have been put together.
 */
export function measureStand(document: DesignDocument): string[] {
  if (document.assembled !== true) return [];
  const parts = document.parts.filter((part) => !part.hidden);
  if (parts.length === 0) return [];

  const lines: string[] = [];
  const built = parts.filter(isBuilt);
  const span = unionBounds(built);
  if (span) {
    const wide = Math.round(span.maxX - span.minX);
    const high = Math.round(span.maxY - span.minY);
    const deep = Math.round(span.maxZ - span.minZ);
    lines.push(`The built pieces span ${wide} wide × ${high} high × ${deep} deep.`);
  }

  const faults = checkAssembly(parts);
  for (const fault of [...faults.overlaps, ...faults.floating]) lines.push(`Drawing fault: ${fault}`);

  lines.push(...protrusions(parts));
  lines.push(...clearHeights(parts));
  return lines;
}

function isBuilt(part: ScenePart) {
  return part.kind === undefined || part.kind === "built";
}

/** Level and square to the axes, so a side-face outline still faces the front. */
function upright(part: ScenePart) {
  const square = (degrees: number | undefined) => {
    const turned = (((degrees ?? 0) % 360) + 360) % 360;
    return turned < 1e-6 || 360 - turned < 1e-6;
  };
  return square(part.rotation) && square(part.tilt);
}

/**
 * A side panel cut to a shape. On that face x runs from the front edge toward the back and y is up,
 * so the world z of a face point on an unrotated panel is part.z + part.depth - faceX.
 */
function shapedSide(part: ScenePart) {
  return part.shape === "box" && !part.curve && part.face === "side" && upright(part) && Boolean(part.outline || part.chamfers || part.corners);
}

/** Face-x where the cut outline crosses a height, so the front edge of a slope is not the box corner. */
function crossSectionXs(ring: readonly (readonly [number, number])[], y: number) {
  const xs: number[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const [x1, y1] = ring[index];
    const [x2, y2] = ring[(index + 1) % ring.length];
    const low = Math.min(y1, y2);
    const high = Math.max(y1, y2);
    if (y < low - 1e-6 || y > high + 1e-6) continue;
    if (Math.abs(y2 - y1) < 1e-9) {
      xs.push(x1, x2);
      continue;
    }
    const t = (y - y1) / (y2 - y1);
    if (t < -1e-6 || t > 1 + 1e-6) continue;
    xs.push(x1 + (x2 - x1) * t);
  }
  return xs.filter((x) => Number.isFinite(x));
}

/** The stand's front at one height: the cut edge of a shaped side, otherwise the box's front. */
function frontAt(part: ScenePart, y: number, bounds: Bounds) {
  if (!shapedSide(part)) return bounds.maxZ;
  const shape = faceShape(part);
  if (!shape) return bounds.maxZ;
  const xs = crossSectionXs(shape.outer, y - part.y);
  if (xs.length === 0) return bounds.maxZ;
  return part.z + part.depth - Math.min(...xs);
}

function sampleHeights(bounds: Bounds) {
  const span = bounds.maxY - bounds.minY;
  if (span < 3) return [bounds.minY + span / 2];
  return [bounds.minY + 1, bounds.minY + span / 2, bounds.maxY - 1];
}

function bodyOf(part: ScenePart, parts: ScenePart[]) {
  const built = parts.filter(isBuilt);
  const rest = built.filter((item) => item.id !== part.id);
  if (part.group && built.some((item) => item.group === part.group)) return rest.filter((item) => item.group === part.group);
  return rest;
}

type Side = "front" | "back" | "left" | "right";

type Reach = { part: ScenePart; side: Side; mm: number; piece: number; stand: number };

/**
 * A built board that only stands proud of the pieces inside it by its own thickness: the side panel beside
 * the back, the plinth on the front. It is the skin of the stand, not a piece reaching past it. A board that
 * crosses the face, or that sticks out by more than its thickness, is still reported.
 */
function isSkin(part: ScenePart, sample: Reach, bounds: Bounds) {
  if (!isBuilt(part) || !(sample.mm > 2)) return false;
  const thin = Math.min(part.width, part.height, part.shape === "cylinder" ? part.width : part.depth);
  if (sample.mm > thin + 2) return false;
  const face = sample.stand;
  if (sample.side === "left") return bounds.maxX <= face + 2 && bounds.maxX >= face - 2;
  if (sample.side === "right") return bounds.minX >= face - 2 && bounds.minX <= face + 2;
  if (sample.side === "back") return bounds.maxZ <= face + 2 && bounds.maxZ >= face - 2;
  return bounds.minZ >= face - 2 && bounds.minZ <= face + 2;
}

const SIDE_WORD: Record<Side, string> = { front: "front", back: "back", left: "left side", right: "right side" };

function protrusions(parts: ScenePart[]) {
  const hits: Reach[] = [];
  for (const part of parts) {
    const bounds = partBounds(part);
    const body = bodyOf(part, parts);
    const best = new Map<Side, Reach>();
    for (const y of sampleHeights(bounds)) {
      const there = body.filter((item) => {
        const box = partBounds(item);
        return y >= box.minY && y <= box.maxY;
      });
      if (there.length === 0) continue;
      let front = -Infinity;
      let back = Infinity;
      let left = Infinity;
      let right = -Infinity;
      for (const item of there) {
        const box = partBounds(item);
        front = Math.max(front, frontAt(item, y, box));
        back = Math.min(back, box.minZ);
        left = Math.min(left, box.minX);
        right = Math.max(right, box.maxX);
      }
      // A shaped side is measured to its cut front. Its bounding box still fills the uncut rectangle, which would
      // read as the panel sticking out past its own slope.
      const pieceFront = frontAt(part, y, bounds);
      const samples: Reach[] = [
        { part, side: "front", mm: pieceFront - front, piece: pieceFront, stand: front },
        { part, side: "back", mm: back - bounds.minZ, piece: bounds.minZ, stand: back },
        { part, side: "left", mm: left - bounds.minX, piece: bounds.minX, stand: left },
        { part, side: "right", mm: bounds.maxX - right, piece: bounds.maxX, stand: right },
      ];
      for (const sample of samples) {
        if (isSkin(part, sample, bounds)) continue;
        const current = best.get(sample.side);
        if (!current || sample.mm > current.mm) best.set(sample.side, sample);
      }
    }
    for (const sample of best.values()) if (sample.mm > 2) hits.push(sample);
  }

  hits.sort((a, b) => b.mm - a.mm || a.part.name.localeCompare(b.part.name) || a.part.id.localeCompare(b.part.id) || a.side.localeCompare(b.side));
  if (hits.length === 0) return ["No piece reaches past the built pieces at its height."];

  const shown = hits.slice(0, 40);
  const lines = shown.map((hit) => {
    const word = SIDE_WORD[hit.side];
    const pieceAt = Math.round(hit.piece);
    const standAt = Math.round(hit.stand);
    const amount = hit.side === "front" || hit.side === "right" ? pieceAt - standAt : standAt - pieceAt;
    return `${hit.part.name} (${hit.part.id}) reaches ${amount} mm past the ${word} of the stand at its height: its ${word} is at ${pieceAt}, the stand's ${word} there is at ${standAt}.`;
  });
  const dropped = hits.slice(40);
  if (dropped.length > 0) {
    const shownIds = new Set(shown.map((hit) => hit.part.id));
    const more = new Set(dropped.map((hit) => hit.part.id).filter((id) => !shownIds.has(id))).size;
    lines.push(`…and ${more || dropped.length} more pieces reach past the stand.`);
  }
  return lines;
}

function isFlat(part: ScenePart) {
  if (!isBuilt(part) || part.shape !== "box") return false;
  const { width, height, depth } = part;
  if (!(height <= width && height <= depth && height <= 50)) return false;
  return width >= 150 && depth >= 150;
}

function clearHeights(parts: ScenePart[]) {
  const groups = new Map<string, { part: ScenePart; bounds: Bounds }[]>();
  for (const part of parts) {
    if (!isFlat(part)) continue;
    const key = part.group ?? "";
    const list = groups.get(key) ?? [];
    list.push({ part, bounds: partBounds(part) });
    groups.set(key, list);
  }
  const lines: string[] = [];
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => a.bounds.minY - b.bounds.minY || a.bounds.minX - b.bounds.minX || a.part.id.localeCompare(b.part.id));
    for (let lowerIndex = 0; lowerIndex < sorted.length && lines.length < 30; lowerIndex += 1) {
      const lower = sorted[lowerIndex];
      for (let upperIndex = lowerIndex + 1; upperIndex < sorted.length; upperIndex += 1) {
        const upper = sorted[upperIndex];
        if (rectanglesOverlapArea(lower.bounds, upper.bounds) <= 0) continue;
        const gap = Math.round(upper.bounds.minY - lower.bounds.maxY);
        lines.push(`Clear height between ${lower.part.name} (${lower.part.id}) and ${upper.part.name} (${upper.part.id}): ${gap} mm.`);
        break;
      }
    }
  }
  return lines;
}
