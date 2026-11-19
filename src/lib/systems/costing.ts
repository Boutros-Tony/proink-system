import { z } from "zod";
import { lineCents } from "./catalog";
import { emptyQuoteMeta, quoteMetaSchema, sectionSchema } from "./sections";
import { QUOTE_GROUPS, type BomLine, type QuoteGroup } from "./types";

/**
 * What belongs to one job on top of the shop's standing prices: the price or quantity changed for this job
 * only, the lines the cost review added, and the review itself.
 * The price book (Settings) is never touched by anything here.
 */

export const lineOverrideSchema = z.object({
  unitCents: z.number().int().min(0).max(100_000_000).optional(),
  quantity: z.number().min(0).max(1_000_000).optional(),
  /** Left off this job's cost, for example flooring the client supplies. */
  excluded: z.boolean().optional(),
});
export type LineOverride = z.infer<typeof lineOverrideSchema>;

/**
 * A line the design does not produce by itself: a screw box, an hour of installation, a truck.
 * `data` came from the shop's own prices, `new` is an estimate for something the shop has not priced yet,
 * `manual` was typed in.
 */
export const extraLineSchema = z.object({
  id: z.string().min(1).max(60),
  description: z.string().min(1).max(160),
  group: z.enum(QUOTE_GROUPS),
  quantity: z.number().min(0).max(1_000_000),
  unit: z.string().min(1).max(20),
  unitCents: z.number().int().min(0).max(100_000_000),
  source: z.enum(["data", "new", "manual"]),
  /** The price-book entry it came from: `material:<id>`, `item:<id>`, or `catalog:<sku>`. */
  ref: z.string().max(100).optional(),
  /** Why the line is needed, in the estimator's words. */
  reason: z.string().max(400).optional(),
  /** The item this cost belongs to (`item-…`). Installation and transport leave this empty. */
  item: z.string().min(1).max(80).optional(),
});
export type ExtraLine = z.infer<typeof extraLineSchema>;

export const REVIEW_AREAS = [
  "Frame and structure",
  "Boards and panels",
  "Hardware and fixings",
  "Adhesives and finishing",
  "Printing and graphics",
  "Displays and equipment",
  "Lighting and electrical",
  "Flooring",
  "Workshop labor",
  "On-site installation",
  "Packaging and transport",
  "Tools and consumables",
] as const;

export const checkedAreaSchema = z.object({
  area: z.string().min(1).max(60),
  status: z.enum(["costed", "suggested", "not-needed"]),
  note: z.string().max(300),
});
export type CheckedArea = z.infer<typeof checkedAreaSchema>;

export const reviewSchema = z.object({
  /** Fingerprint of the design the review was written for, so a changed design can be spotted. */
  designKey: z.string().max(40),
  summary: z.string().max(1000),
  checked: z.array(checkedAreaSchema).max(30),
  suggestions: z.array(extraLineSchema).max(100),
  at: z.number(),
  /** The model that wrote it, so the user can tell which one produced the list. */
  model: z.string().max(80).optional(),
});
export type CostReview = z.infer<typeof reviewSchema>;

export const costingSchema = z.object({
  version: z.literal(1),
  overrides: z.record(z.string(), lineOverrideSchema),
  extras: z.array(extraLineSchema).max(200),
  review: reviewSchema.nullable(),
  /** The quotation the client is sent: one selling price per section. */
  sections: z.array(sectionSchema).max(40).default(() => []),
  quote: quoteMetaSchema.default(() => emptyQuoteMeta()),
  /** Suggested lines the user removed, by name, so a later check does not add them back. */
  skipped: z.array(z.string().max(160)).max(200).default(() => []),
});
export type Costing = z.infer<typeof costingSchema>;

export function emptyCosting(): Costing {
  return { version: 1, overrides: {}, extras: [], review: null, sections: [], quote: emptyQuoteMeta(), skipped: [] };
}

export function readCosting(input: unknown): Costing {
  const parsed = costingSchema.safeParse(input);
  return parsed.success ? parsed.data : emptyCosting();
}

/** A line as the cost panel shows it, with what was changed for this job. */
export type CostLine = BomLine & {
  origin: "design" | "extra";
  source: "design" | ExtraLine["source"];
  baseQuantity: number;
  baseUnitCents: number;
  quantityEdited: boolean;
  priceEdited: boolean;
  excluded: boolean;
  ref?: string;
  reason?: string;
  /** The item this extra belongs to, when it is not shared by the whole job. */
  item?: string;
};

export type CostedJob = {
  lines: CostLine[];
  /** Everything not excluded. */
  subtotalCents: number;
  excludedCents: number;
};

export function extraKey(id: string) {
  return `extra:${id}`;
}

/** The price-book entry a design line was priced from, so the review does not buy the same thing twice. */
export function lineRef(line: Pick<BomLine, "key" | "sku">): string {
  if (line.sku.startsWith("MAT-")) return `material:${line.sku.slice(4)}`;
  if (line.sku.startsWith("ITEM-")) return `item:${line.sku.slice(5)}`;
  return `catalog:${line.sku}`;
}

/** Put the job's own changes over the engine's lines and add the extras. The result is what is quoted. */
export function applyCosting(base: BomLine[], costing: Costing): CostedJob {
  const lines: CostLine[] = base.map((line) => {
    const override = costing.overrides[line.key];
    const quantity = override?.quantity ?? line.quantity;
    const unitCents = override?.unitCents ?? line.unitCostCents;
    return {
      ...line,
      origin: "design",
      source: "design",
      quantity,
      unitCostCents: unitCents,
      totalCents: lineCents(quantity, unitCents),
      baseQuantity: line.quantity,
      baseUnitCents: line.unitCostCents,
      quantityEdited: override?.quantity !== undefined && override.quantity !== line.quantity,
      priceEdited: override?.unitCents !== undefined && override.unitCents !== line.unitCostCents,
      excluded: override?.excluded === true,
      ref: lineRef(line),
    };
  });

  // Banding, filler, primer, and paint are counted by the engine now. An older job may still carry them as extras.
  const counted = new Set(base.filter((line) => line.sku.startsWith("ITEM-")).map(lineRef));
  for (const extra of costing.extras) {
    if (extra.ref && counted.has(extra.ref)) continue;
    lines.push({
      key: extraKey(extra.id),
      sku: extra.ref ?? "EXTRA",
      group: extra.group,
      description: extra.description,
      quantity: extra.quantity,
      unit: extra.unit,
      unitCostCents: extra.unitCents,
      totalCents: lineCents(extra.quantity, extra.unitCents),
      origin: "extra",
      source: extra.source,
      baseQuantity: extra.quantity,
      baseUnitCents: extra.unitCents,
      quantityEdited: false,
      priceEdited: false,
      excluded: false,
      ref: extra.ref,
      reason: extra.reason,
      ...(extra.item ? { item: extra.item } : {}),
    });
  }

  const order = (group: QuoteGroup) => QUOTE_GROUPS.indexOf(group);
  const sorted = lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => order(a.line.group) - order(b.line.group) || a.index - b.index)
    .map((item) => item.line);

  return {
    lines: sorted,
    subtotalCents: sorted.reduce((sum, line) => sum + (line.excluded ? 0 : line.totalCents), 0),
    excludedCents: sorted.reduce((sum, line) => sum + (line.excluded ? line.totalCents : 0), 0),
  };
}

/** The lines that go on the quotation and into the package: the ones that are not excluded. */
export function billableLines(job: CostedJob): BomLine[] {
  return job.lines
    .filter((line) => !line.excluded)
    .map(({ key, sku, group, description, quantity, unit, unitCostCents, totalCents }) => ({ key, sku, group, description, quantity, unit, unitCostCents, totalCents }));
}

/** A short fingerprint of the design, so the cost review can tell when the stand changed after it ran. */
export function designKey(document: unknown): string {
  const text = JSON.stringify(document);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Change one design line for this job. A value equal to the engine's own is dropped, so nothing shows as edited. */
export function setOverride(costing: Costing, line: Pick<CostLine, "key" | "baseQuantity" | "baseUnitCents">, change: LineOverride): Costing {
  const merged: LineOverride = { ...costing.overrides[line.key], ...change };
  if (merged.unitCents === line.baseUnitCents) delete merged.unitCents;
  if (merged.quantity === line.baseQuantity) delete merged.quantity;
  if (!merged.excluded) delete merged.excluded;
  const overrides = { ...costing.overrides };
  if (Object.keys(merged).length === 0) delete overrides[line.key];
  else overrides[line.key] = merged;
  return { ...costing, overrides };
}

/** Put suggested lines straight on the job, so they count in the price. A line already there, or one the user removed, is not added again. */
export function addExtras(costing: Costing, incoming: ExtraLine[]): Costing {
  const taken = new Set<string>(costing.skipped);
  for (const line of costing.extras) {
    if (line.ref) taken.add(line.ref);
    taken.add(line.description.toLowerCase());
  }
  const fresh = incoming.filter((line) => {
    if ((line.ref && taken.has(line.ref)) || taken.has(line.description.toLowerCase())) return false;
    if (line.ref) taken.add(line.ref);
    taken.add(line.description.toLowerCase());
    return true;
  });
  if (fresh.length === 0) return costing;
  return { ...costing, extras: [...costing.extras, ...fresh].slice(0, 200) };
}

/** Take a line off the job. A suggested line is remembered, so the next check leaves it out. */
export function removeExtra(costing: Costing, id: string): Costing {
  const line = costing.extras.find((extra) => extra.id === id);
  if (!line) return costing;
  const suggested = line.source !== "manual" && Boolean(line.reason);
  return {
    ...costing,
    extras: costing.extras.filter((extra) => extra.id !== id),
    skipped: suggested ? [...new Set([...costing.skipped, line.description.toLowerCase()])].slice(-200) : costing.skipped,
  };
}

/** One change to a cost line, made from the chat. Design lines carry the engine's own values so an override can be dropped when it matches. */
export const costEditSchema = z.object({
  key: z.string().min(1).max(120),
  remove: z.boolean().optional(),
  quantity: z.number().min(0).max(1_000_000).optional(),
  unitCents: z.number().int().min(0).max(100_000_000).optional(),
  baseQuantity: z.number().min(0).optional(),
  baseUnitCents: z.number().int().min(0).optional(),
});
export type CostEdit = z.infer<typeof costEditSchema>;

/** Apply chat edits in order. An added line is removed or changed in place; a design line is left off or overridden for this job. */
export function applyCostEdits(costing: Costing, edits: CostEdit[]): Costing {
  let next = costing;
  for (const edit of edits) {
    if (edit.key.startsWith("extra:")) {
      const id = edit.key.slice("extra:".length);
      if (edit.remove) {
        next = removeExtra(next, id);
        continue;
      }
      next = {
        ...next,
        extras: next.extras.map((line) =>
          line.id === id ? { ...line, ...(edit.quantity !== undefined ? { quantity: edit.quantity } : {}), ...(edit.unitCents !== undefined ? { unitCents: edit.unitCents } : {}) } : line,
        ),
      };
      continue;
    }
    const base = { key: edit.key, baseQuantity: edit.baseQuantity ?? 0, baseUnitCents: edit.baseUnitCents ?? 0 };
    next = setOverride(next, base, {
      ...(edit.remove ? { excluded: true } : {}),
      ...(edit.quantity !== undefined ? { quantity: edit.quantity } : {}),
      ...(edit.unitCents !== undefined ? { unitCents: edit.unitCents } : {}),
    });
  }
  return next;
}

export function newExtraId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
