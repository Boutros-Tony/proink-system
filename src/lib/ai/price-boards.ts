import { seedCatalog } from "@/lib/systems/catalog";
import type { ExtraLine } from "@/lib/systems/costing";
import { splitPricedLines } from "@/lib/systems/board-split";
import { bookForJob } from "@/lib/systems/modular/job-materials";
import { estimateMaterials, type PriceBook } from "@/lib/systems/materials";
import { placeElements, resolveItemId, type ElementDraft } from "@/lib/systems/modular/elements";
import { produceDesign } from "@/lib/systems/modular/produce";
import type { DesignDocument, PartMaterial } from "@/lib/systems/modular/schema";
import type { BomLine } from "@/lib/systems/types";

export type BoardPieceInput = {
  name: string;
  width: number;
  height: number;
  thickness: number;
  material: PartMaterial;
  materialId?: string;
  quantity?: number;
  item?: string;
};

export type PricedBoard = { name: string; size: string | null; boards: number; unit: string; totalCents: number };

export type PricedBoards = {
  /** The job document with item names added. Parts are the ones that were already there. */
  document: DesignDocument;
  groupsChanged: boolean;
  extras: ExtraLine[];
  boards: PricedBoard[];
  other: { description: string; totalCents: number }[];
  totalCents: number;
  unpriced: { name: string; reason: string }[];
  note?: string;
};

/** A sheet the engine did not buy, or a finish it counted, is not a booth-frame line. */
function fromPieces(line: BomLine) {
  return line.quantity > 0 && (line.sku.startsWith("MAT-") || line.sku.startsWith("ITEM-") || line.key.startsWith("FIN-"));
}

/**
 * Price flat pieces without drawing them. The cutting plan runs on a throwaway copy that has no
 * frame, so a booth that is already on the job cannot add extrusion or floor lines to the price.
 */
export function priceBoardPieces(document: DesignDocument, pieces: BoardPieceInput[], book: PriceBook): PricedBoards {
  const temp: DesignDocument = {
    ...document,
    parts: [],
    walls: document.walls.map((wall) => ({ ...wall, bays: [] })),
    features: [],
  };
  const drafts: ElementDraft[] = pieces.map((piece) => ({
    name: piece.name,
    width: piece.width,
    height: piece.height,
    depth: piece.thickness,
    material: piece.material,
    ...(piece.materialId ? { materialId: piece.materialId } : {}),
    quantity: piece.quantity ?? 1,
    ...(piece.item?.trim() ? { item: piece.item.trim() } : {}),
    kind: "built",
  }));
  const placed = placeElements(temp, drafts);

  // placeElements slugs each name. An item already on the job keeps the id it already has.
  const groups = { ...document.groups };
  const idMap = new Map<string, string>();
  for (const [slug, title] of Object.entries(placed.document.groups ?? {})) {
    const resolved = resolveItemId({ ...document, groups }, title);
    idMap.set(slug, resolved);
    if (!groups[resolved]) groups[resolved] = title.slice(0, 80);
  }
  const parts = placed.document.parts.map((part) => {
    if (!part.group) return part;
    const id = idMap.get(part.group) ?? part.group;
    return id === part.group ? part : { ...part, group: id };
  });
  const groupsChanged = JSON.stringify(groups) !== JSON.stringify(document.groups ?? {});
  const next: DesignDocument = groupsChanged ? { ...document, groups } : document;

  const pricedDoc: DesignDocument = { ...temp, parts, groups, jobMaterials: document.jobMaterials };
  const produced = produceDesign(pricedDoc, seedCatalog(), book);
  const counted = produced.lines.filter(fromPieces);
  const jobBook = bookForJob(book, document);
  const known = new Set(jobBook.materials.map((material) => material.id));
  const unknown = [...new Set(pieces.flatMap((piece) => (piece.materialId && !known.has(piece.materialId) ? [piece.materialId] : [])))];
  const estimate = estimateMaterials(parts, jobBook);
  const seen = new Set<string>();
  const unpriced = estimate.unpriced.flatMap((part) => {
    if (seen.has(part.name)) return [];
    seen.add(part.name);
    const reason = part.materialId ? `No shop price for material ${part.materialId}.` : `No shop price for ${part.material ?? "this material"}.`;
    return [{ name: part.name, reason }];
  });

  return {
    document: next,
    groupsChanged,
    extras: splitPricedLines(counted, parts, jobBook, groups),
    boards: produced.materials
      .filter((usage) => usage.quantity > 0)
      .map((usage) => ({
        name: usage.name,
        size: usage.boardSize,
        boards: usage.quantity,
        unit: usage.unit,
        totalCents: usage.totalCents,
      })),
    other: counted
      .filter((line) => !line.sku.startsWith("MAT-"))
      .map((line) => ({ description: line.description, totalCents: line.totalCents })),
    totalCents: counted.reduce((sum, line) => sum + line.totalCents, 0),
    unpriced,
    ...(unknown.length > 0 ? { note: `These ids are not in the shop's sheets, so those pieces were priced by material instead: ${unknown.join(", ")}.` } : {}),
  };
}

/** Remember an item name under the same id priceBoards uses, without renaming one that is already there. */
export function rememberItem(document: DesignDocument, name: string): { document: DesignDocument; id: string } {
  const id = resolveItemId(document, name);
  if (document.groups?.[id]) return { document, id };
  const title = name.trim().slice(0, 80) || id;
  return { document: { ...document, groups: { ...document.groups, [id]: title } }, id };
}

/** What the model reads after priceBoards. The client still gets the extras and the document. */
export function briefPriceBoards(output: unknown) {
  if (!output || typeof output !== "object") return "Done.";
  const record = output as {
    error?: string;
    boards?: PricedBoard[];
    other?: { description?: string; totalCents?: number }[];
    totalCents?: number;
    unpriced?: { name?: string; reason?: string }[];
    note?: string;
  };
  if (typeof record.error === "string" && record.error) return record.error;
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const lines: string[] = [];
  for (const board of record.boards ?? []) {
    lines.push(`${board.name}${board.size ? `, ${board.size}` : ""}: ${board.boards} ${board.unit} at ${dollars(board.totalCents)}.`);
  }
  for (const line of record.other ?? []) lines.push(`${line.description ?? "Line"}: ${dollars(line.totalCents ?? 0)}.`);
  lines.push(`Total: ${dollars(record.totalCents ?? 0)}.`);
  for (const piece of record.unpriced ?? []) lines.push(`Could not price ${piece.name}: ${piece.reason}`);
  if (record.note) lines.push(record.note);
  return lines.join("\n");
}
