import { lineCents } from "./catalog";
import { isCutExtraId, lineRef, type ExtraLine } from "./costing";
import { finishingNeeds } from "./finishing";
import { partBoardAreaMm2, type PriceBook } from "./materials";
import type { ScenePart } from "./modular/schema";
import type { BomLine } from "./types";

/**
 * Turn the engine's board and finishing totals into one extra per item.
 * One item, or none, stays a single line with no item, because the quotation is one row.
 * Several items share each total by what that item contributed, and the shares add back to the total.
 */

function splitCents(total: number, weights: number[]) {
  const cents = Math.max(0, Math.round(total));
  if (weights.length === 0 || cents === 0) return weights.map(() => 0);
  const usable = weights.some((weight) => weight > 0) ? weights : weights.map(() => 1);
  const sum = usable.reduce((acc, weight) => acc + weight, 0);
  const exact = usable.map((weight) => (cents * weight) / sum);
  const floors = exact.map((value) => Math.floor(value));
  let left = cents - floors.reduce((acc, value) => acc + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const row of order) {
    if (left <= 0) break;
    floors[row.index] += 1;
    left -= 1;
  }
  return floors;
}

/** A quantity whose rounded line total is exactly `cents` at this unit price. */
function quantityFor(cents: number, unitCents: number) {
  if (cents <= 0 || unitCents <= 0) return 0;
  let quantity = cents / unitCents;
  for (let step = 0; step < 6 && lineCents(quantity, unitCents) !== cents; step += 1) {
    quantity += (cents - lineCents(quantity, unitCents)) / unitCents;
  }
  return Math.round(quantity * 1e6) / 1e6;
}

/** Board area of the pieces that belong on this sheet line. Same match as the quotation rows. */
function areaFor(parts: ScenePart[], line: Pick<BomLine, "sku" | "piece">) {
  const materialId = line.sku.startsWith("MAT-") ? line.sku.slice(4) : null;
  return parts.reduce((sum, part) => {
    if (part.kind === "equipment" || part.kind === "rental") return sum;
    if (materialId || line.piece) {
      const own = part.materialId === materialId;
      const byType = !part.materialId && Boolean(line.piece) && (part.material ?? "paint") === line.piece;
      if (!own && !byType) return sum;
    }
    return sum + partBoardAreaMm2(part);
  }, 0);
}

/** What drives a finishing line: edge length, painted area, or bent pieces. */
function finishWeight(parts: ScenePart[], line: BomLine, book: PriceBook) {
  const needs = finishingNeeds(parts, book);
  const key = `${line.key} ${line.sku}`.toLowerCase();
  if (key.includes("edge-banding")) return needs.bandingMm;
  if (key.includes("filler")) return needs.fillerMm;
  if (key.includes("primer")) return needs.paintedMm2;
  if (key.includes("kerf")) return needs.bentPieces;
  if (key.includes("paint")) return needs.paintedMm2;
  return 0;
}

function weightsFor(line: BomLine, groups: { parts: ScenePart[] }[], book: PriceBook) {
  const material = line.sku.startsWith("MAT-") || line.group === "materials";
  const direct = groups.map((group) => (material ? areaFor(group.parts, line) : finishWeight(group.parts, line, book)));
  if (direct.some((weight) => weight > 0)) return direct;
  const area = groups.map((group) => group.parts.reduce((sum, part) => sum + partBoardAreaMm2(part), 0));
  if (area.some((weight) => weight > 0)) return area;
  return groups.map(() => 1);
}

export function splitPricedLines(lines: BomLine[], parts: ScenePart[], book: PriceBook, titles: Record<string, string> = {}): ExtraLine[] {
  const itemIds = [...new Set(parts.map((part) => part.group).filter((id): id is string => Boolean(id)))];
  const split = itemIds.length >= 2;
  const groups = itemIds.map((id) => ({ id, parts: parts.filter((part) => part.group === id) }));
  const extras: ExtraLine[] = [];
  let count = 0;

  for (const line of lines) {
    if (line.totalCents <= 0 && line.quantity <= 0) continue;
    const shares = split ? splitCents(line.totalCents, weightsFor(line, groups, book)) : [line.totalCents];
    const ids = split ? itemIds : [undefined];
    shares.forEach((cents, index) => {
      if (cents <= 0) return;
      const item = ids[index];
      const title = item ? titles[item] ?? item : "";
      count += 1;
      const id = `cut-${count}`;
      extras.push({
        id,
        description: (split && title ? `${line.description} · ${title}` : line.description).slice(0, 160),
        group: line.group,
        quantity: quantityFor(cents, line.unitCostCents),
        unit: line.unit.slice(0, 20) || "each",
        unitCents: line.unitCostCents,
        source: "data",
        ref: lineRef(line),
        ...(item ? { item } : {}),
      });
    });
  }

  return extras.filter((line) => isCutExtraId(line.id));
}
