import type { PriceBook, PricedMaterial } from "../materials";
import type { DesignDocument, PartMaterial } from "./schema";

/** The price book plus materials estimated for this job. A job material whose id is already in the book is ignored. */
export function bookForJob(book: PriceBook, document: Pick<DesignDocument, "jobMaterials">): PriceBook {
  const extras = (document.jobMaterials ?? []).filter((material) => book.materials.every((item) => item.id !== material.id));
  if (extras.length === 0) return book;
  return { ...book, materials: [...book.materials, ...extras] };
}

function slug(name: string) {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.slice(0, 50) || "material";
}

function freshId(name: string, taken: Set<string>) {
  const base = `est-${slug(name)}`.slice(0, 60);
  if (!taken.has(base)) return base;
  let number = 2;
  let id = "";
  do {
    const suffix = `-${number}`;
    id = `${base.slice(0, 60 - suffix.length)}${suffix}`;
    number += 1;
  } while (taken.has(id));
  return id;
}

/**
 * Keep an estimated board or sheet on this job. The same name replaces the earlier estimate and keeps its id.
 */
export function addJobMaterial(
  document: DesignDocument,
  draft: { name: string; piece: PartMaterial | null; unit: "board" | "m2"; priceCents: number; boardWidthMm?: number; boardHeightMm?: number; thicknessMm?: number },
): { document: DesignDocument; id: string } {
  const existing = document.jobMaterials ?? [];
  const previous = existing.find((item) => item.name === draft.name);
  const id = previous?.id ?? freshId(draft.name, new Set(existing.map((item) => item.id)));
  const material: PricedMaterial = {
    id,
    name: draft.name,
    piece: draft.piece,
    unit: draft.unit,
    priceCents: Math.round(draft.priceCents),
    wastePercent: 10,
    estimated: true,
    ...(draft.boardWidthMm !== undefined ? { boardWidthMm: draft.boardWidthMm } : {}),
    ...(draft.boardHeightMm !== undefined ? { boardHeightMm: draft.boardHeightMm } : {}),
    ...(draft.thicknessMm !== undefined ? { thicknessMm: draft.thicknessMm } : {}),
  };
  const jobMaterials = previous ? existing.map((item) => (item.id === id ? material : item)) : [...existing, material];
  return { document: { ...document, jobMaterials }, id };
}
