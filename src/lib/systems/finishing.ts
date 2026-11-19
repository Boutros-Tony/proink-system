import { lineCents } from "./catalog";
import { equipmentKind } from "./equipment";
import { THIN_PIECE_MM, type PriceBook, type ShopRules } from "./materials";
import { faceAxes, flatPiece, outlineMeasure } from "./modular/geometry";
import { roundMeasure } from "./modular/round";
import type { CornerRadii, Chamfers, Hole, PartMaterial, ScenePart } from "./modular/schema";
import type { BomLine } from "./types";

/**
 * Edge finishing and paint, counted from the pieces the way a joinery workshop takes them off a drawing:
 * every cut edge of a flat panel is banded or filled, and every painted face is primed and top-coated.
 * A built box counts its outside faces and its joint edges.
 */

export type FinishingNeeds = {
  /** Banded edge, in mm, before allowance and waste. */
  bandingMm: number;
  /** Banded edges, so each one gets its trim allowance. */
  bandedEdges: number;
  bandedPieces: number;
  /** Filled and sealed edge, in mm. */
  fillerMm: number;
  filledPieces: number;
  /** Painted surface, in mm². */
  paintedMm2: number;
  paintedPieces: number;
  /** Panels kerf-bent to a curve. */
  bentPieces: number;
};

const CORNERS = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

type Outline = { straight: number; curved: number; area: number; edges: number };

/** Perimeter and area of a rectangle with its corners rounded or cut. */
function outline(width: number, height: number, corners?: CornerRadii, chamfers?: Chamfers): Outline {
  let straight = 2 * (width + height);
  let curved = 0;
  let area = width * height;
  let edges = 4;
  for (const corner of CORNERS) {
    const cut = chamfers?.[corner];
    if (cut?.x && cut.y) {
      straight += Math.hypot(cut.x, cut.y) - cut.x - cut.y;
      area -= (cut.x * cut.y) / 2;
      edges += 1;
      continue;
    }
    const radius = corners?.[corner] ?? 0;
    if (radius > 0) {
      straight -= 2 * radius;
      curved += (Math.PI * radius) / 2;
      area -= radius * radius * (1 - Math.PI / 4);
    }
  }
  return { straight: Math.max(0, straight), curved, area: Math.max(0, area), edges };
}

/** The shaped face of a flat panel with its openings taken out. An opening at the bottom has no bottom edge. */
function panelFace(part: ScenePart): Outline {
  const axes = faceAxes(part);
  const drawn = part.outline ? outlineMeasure(part.outline) : null;
  const face = drawn ? { straight: drawn.straight, curved: drawn.curved, area: drawn.area, edges: drawn.edges } : outline(axes.width, axes.height, part.corners, part.chamfers);
  for (const hole of part.holes ?? []) {
    const inner = holeOutline(hole);
    face.straight += inner.straight;
    face.curved += inner.curved;
    face.area -= inner.area;
    face.edges += inner.edges;
  }
  return { ...face, area: Math.max(0, face.area) };
}

function holeOutline(hole: Hole): Outline {
  const inner = outline(hole.width, hole.height, hole.corners);
  if (hole.y > 0) return inner;
  return { ...inner, straight: Math.max(0, inner.straight - 2 * hole.width), edges: inner.edges - 1 };
}

/** What a piece is finished as: its board's piece type, or null when it is not built from board. */
function finishOf(part: ScenePart, book: PriceBook): PartMaterial | null {
  if (equipmentKind(part) || part.kind === "equipment" || part.kind === "rental") return null;
  if (part.shape === "letters" || part.shape === "mesh" || part.shape === "tube") return null;
  if (part.materialId) return book.materials.find((material) => material.id === part.materialId)?.piece ?? null;
  return part.material ?? "paint";
}

type Edge = "banding" | "filler" | null;

function edgeFinish(finish: PartMaterial, curved: boolean, rules: ShopRules): Edge {
  if (finish === "paint") return curved ? "filler" : rules.paintedEdges;
  if (finish === "mdf" || finish === "wood" || finish === "laminate") return rules.rawEdges === "banding" ? "banding" : null;
  return null;
}

export function finishingNeeds(parts: ScenePart[], book: PriceBook): FinishingNeeds {
  const needs: FinishingNeeds = { bandingMm: 0, bandedEdges: 0, bandedPieces: 0, fillerMm: 0, filledPieces: 0, paintedMm2: 0, paintedPieces: 0, bentPieces: 0 };
  for (const part of parts) {
    const finish = finishOf(part, book);
    if (!finish) continue;
    let straight = 0;
    let curved = 0;
    let edges = 0;
    let painted = 0;
    if (part.shape === "cylinder" && part.round) {
      painted = roundMeasure(part).surface;
    } else if (part.shape === "cylinder") {
      const radius = part.width / 2;
      const disc = Math.PI * radius * radius;
      if (part.height <= THIN_PIECE_MM) {
        curved = Math.PI * part.width;
        painted = 2 * disc + curved * part.height;
      } else {
        painted = Math.PI * part.width * part.height + 2 * disc;
      }
    } else if (part.curve) {
      const flat = flatPiece(part);
      straight = 2 * flat.height;
      curved = 2 * flat.width;
      edges = 4;
      painted = 2 * flat.width * flat.height + (straight + curved) * flat.depth;
      needs.bentPieces += 1;
    } else if (faceAxes(part).thickness <= THIN_PIECE_MM) {
      const face = panelFace(part);
      straight = face.straight;
      curved = face.curved;
      edges = face.edges;
      painted = 2 * face.area + (face.straight + face.curved) * faceAxes(part).thickness;
    } else {
      const [a, b, c] = [part.width, part.height, part.depth].sort((x, y) => x - y);
      if (a <= THIN_PIECE_MM) {
        straight = 2 * (b + c);
        edges = 4;
        painted = 2 * b * c + straight * a;
      } else {
        straight = 4 * (a + b + c);
        edges = 12;
        painted = 2 * (a * b + a * c + b * c);
      }
    }

    let banded = false;
    let filled = false;
    for (const [length, isCurved] of [[straight, false], [curved, true]] as const) {
      if (length <= 0) continue;
      const kind = edgeFinish(finish, isCurved, book.rules);
      if (kind === "banding") {
        needs.bandingMm += length;
        banded = true;
      } else if (kind === "filler") {
        needs.fillerMm += length;
        filled = true;
      }
    }
    if (banded) {
      needs.bandedEdges += edges || 1;
      needs.bandedPieces += 1;
    }
    if (filled) needs.filledPieces += 1;
    if (finish === "paint") {
      needs.paintedMm2 += painted;
      needs.paintedPieces += 1;
    }
  }
  return needs;
}

const roundUp = (value: number, step: number) => Math.ceil(value / step - 1e-9) * step;
const pieces = (count: number) => `${count} ${count === 1 ? "piece" : "pieces"}`;

/** Engine lines for edge banding, filler, primer, and paint. Only items the shop has priced are used. */
export function finishingLines(parts: ScenePart[], book: PriceBook): BomLine[] {
  const needs = finishingNeeds(parts, book);
  const rules = book.rules;
  const lines: BomLine[] = [];
  const push = (itemId: string, quantity: number, description: string) => {
    const item = book.items.find((entry) => entry.id === itemId);
    if (!item || quantity <= 0) return;
    lines.push({
      key: `FIN-${itemId}`,
      sku: `ITEM-${itemId}`,
      group: item.group,
      description,
      quantity,
      unit: item.unit,
      unitCostCents: item.priceCents,
      totalCents: lineCents(quantity, item.priceCents),
    });
  };

  if (needs.bandingMm > 0) {
    const meters = ((needs.bandingMm + needs.bandedEdges * rules.edgeAllowanceMm * 2) * (1 + rules.edgeWastePercent / 100)) / 1000;
    push("fin-edge-banding", roundUp(meters, 1), `Edge banding, ${(needs.bandingMm / 1000).toFixed(1)} m of cut edge on ${pieces(needs.bandedPieces)}`);
  }
  if (needs.fillerMm > 0) {
    push("fin-edge-filler", roundUp(needs.fillerMm / 1000, 1), `Edge filling and sealing, curved and painted edges on ${pieces(needs.filledPieces)}`);
  }
  if (needs.paintedMm2 > 0) {
    const areaM2 = needs.paintedMm2 / 1_000_000;
    const liters = (coats: number) => roundUp((areaM2 * coats * (1 + rules.sprayWastePercent / 100)) / rules.coverageM2PerLiter, 0.5);
    const where = `${areaM2.toFixed(1)} m² on ${pieces(needs.paintedPieces)}`;
    if (rules.primerCoats > 0) push("fin-primer", liters(rules.primerCoats), `Primer, ${rules.primerCoats} ${rules.primerCoats === 1 ? "coat" : "coats"} on ${where}`);
    if (rules.topCoats > 0) push("fin-paint", liters(rules.topCoats), `Paint, ${rules.topCoats} ${rules.topCoats === 1 ? "coat" : "coats"} on ${where}`);
  }
  if (needs.bentPieces > 0) push("lab-kerf-bend", needs.bentPieces, `Kerf bending, ${pieces(needs.bentPieces)} bent to a curve`);
  return lines;
}
