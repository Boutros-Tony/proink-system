import { z } from "zod";
import type { CostLine } from "./costing";
import { partBoardAreaMm2 } from "./materials";
import { resolveItemId } from "./modular/elements";
import type { DesignDocument, ScenePart } from "./modular/schema";

/** What a client quotation is divided into, matching the way ProInk sells a stand. */
export const SECTION_KINDS = [
  "floor",
  "counter",
  "wall",
  "lightbox",
  "logo_signage",
  "ceiling_rigging",
  "storage_room",
  "screen_rental",
  "furniture_rental",
  "branding_print",
  "electrical",
  "installation_transport",
  "dismantling",
  "other",
] as const;

export type SectionKind = (typeof SECTION_KINDS)[number];

export const MEASURE_UNITS = ["m2", "lm", "each", "m2_day", "stand_m2"] as const;
export type MeasureUnit = (typeof MEASURE_UNITS)[number];

export const SECTION_KIND_LABEL: Record<SectionKind, string> = {
  floor: "Raised floor",
  counter: "Counters",
  wall: "Walls",
  lightbox: "Lightboxes",
  logo_signage: "Logo and signage",
  ceiling_rigging: "Ceiling and rigging",
  storage_room: "Storage room",
  screen_rental: "Screens",
  furniture_rental: "Furniture rental",
  branding_print: "Branding and print",
  electrical: "Electrical",
  installation_transport: "Installation and transport",
  dismantling: "Dismantling",
  other: "Other",
};

const MEASURE_LABEL: Record<MeasureUnit, string> = {
  m2: "m²",
  lm: "linear m",
  each: "each",
  m2_day: "m² / day",
  stand_m2: "stand m²",
};

export function measureLabel(unit: MeasureUnit) {
  return MEASURE_LABEL[unit];
}

export const quoteMetaSchema = z.object({
  title: z.string().max(160).default(""),
  attention: z.string().max(120).default(""),
  notes: z.string().max(2000).default(""),
  validityDays: z.number().int().min(1).max(365).default(2),
  paymentTerms: z.string().max(300).default("70% on approval, 30% on installation"),
  productionDays: z.number().int().min(1).max(365).default(20),
  vatPercent: z.number().min(0).max(100).default(11),
  /** Days a rental screen is on site. Used to turn screen area into m²/day. */
  eventDays: z.number().int().min(1).max(60).default(5),
});
export type QuoteMeta = z.infer<typeof quoteMetaSchema>;

export function emptyQuoteMeta(): QuoteMeta {
  return quoteMetaSchema.parse({});
}

export const sectionSchema = z.object({
  id: z.string().min(1).max(60),
  kind: z.enum(SECTION_KINDS),
  title: z.string().min(1).max(120),
  measureQty: z.number().min(0).max(1_000_000),
  measureUnit: z.enum(MEASURE_UNITS),
  specs: z.array(z.string().max(200)).max(12),
  includes: z.array(z.string().max(200)).max(12),
  excludes: z.array(z.string().max(200)).max(12),
  partIds: z.array(z.string()).max(400),
  lineKeys: z.array(z.string()).max(200),
  /** When true, the user typed this name, so it wins over the item's name. */
  titleEdited: z.boolean().optional(),
  /** The unit this row prices. Empty on the job-wide installation row. */
  itemId: z.string().min(1).max(80).optional(),
  /** Installation, transport, and dismantling for the whole job. One row, with no letter. */
  jobWide: z.boolean().default(false),
  /** This row's share of the cost, in cents. Set when a board or a labor line is split between items. */
  costCents: z.number().int().min(0).optional(),
  /** How much of each cost line landed on this row. */
  allocations: z.array(z.object({ key: z.string().max(120), cents: z.number().int() })).max(200).default([]),
  /** Selling price for the section. The margin is already inside it. */
  sellCents: z.number().int().min(0),
  /** When true, a later rebuild keeps this price. */
  sellEdited: z.boolean().default(false),
});
export type QuoteSection = z.infer<typeof sectionSchema>;

/** Cost plus margin, in cents. $100 at 20% is $120, with no rounding to the next $50. */
export function sellCents(costCents: number, marginPercent: number) {
  if (costCents <= 0) return 0;
  return Math.round(costCents * (1 + marginPercent / 100));
}

/** A price the user typed stays. Every other section is repriced from its cost and the current margin. */
export function withMargin(sections: QuoteSection[], lines: CostLine[], marginPercent: number): QuoteSection[] {
  return sections.map((section) => (section.sellEdited ? section : { ...section, sellCents: sellCents(sectionCostCents(section, lines), marginPercent) }));
}

/** Letterhead line on every client quotation. */
export const QUOTATION_FOOTER =
  "Dekweneh 1161 Bldg, 4th Fl, Tal el Zaatar Str, Dekweneh, Lebanon - T: 00 961 1 696647/48 - CR# 2050179 - VAT# 3339393-601";

function dimText(mm: number) {
  if (mm >= 1000) {
    const meters = Math.round(mm / 100) / 10;
    return `${meters}m`;
  }
  const cm = Math.round(mm) / 10;
  return Number.isInteger(cm) ? `${cm}cm` : `${cm}cm`;
}

/** The size printed under one item. Pieces are measured on their own, not from the booth envelope. */
export function sectionSizeText(document: DesignDocument, partIds: string[]) {
  const wanted = new Set(partIds);
  const parts = document.parts.filter((part) => wanted.has(part.id));
  if (parts.length === 0) return "";
  return standSizeText({ ...document, walls: document.walls.map((wall) => ({ ...wall, bays: [] })), parts });
}

/** Letter for an item row. The job-wide row has none. */
export function sectionMark(sections: QuoteSection[], index: number) {
  const section = sections[index];
  if (!section || section.jobWide) return "";
  const place = sections.slice(0, index + 1).filter((item) => !item.jobWide).length - 1;
  return sectionCode(place);
}

/**
 * Rows for the client quotation, always built from today's pieces and costs.
 * Saved rows only carry what the user changed: a name, or a price they typed.
 */
export function clientSections(document: DesignDocument, lines: CostLine[], marginPercent: number, meta: QuoteMeta, previous: QuoteSection[] = []) {
  return buildSections(document, lines, marginPercent, meta, previous);
}

/** Save a change to one row. The other rows are stored as they are built now, so nothing goes stale. */
export function editSection(rows: QuoteSection[], id: string, change: Partial<Pick<QuoteSection, "title" | "titleEdited" | "sellCents" | "sellEdited">>) {
  return rows.map((row) => (row.id === id ? { ...row, ...change } : row));
}

/** One size for the whole stand. A built booth uses its envelope. Flat panels use the two face sizes, not the board thickness. */
export function standSizeText(document: DesignDocument) {
  const booth = document.walls.some((wall) => wall.bays.length > 0);
  if (booth) return `${dimText(document.envelope.width)} x ${dimText(document.envelope.depth)} x ${dimText(document.envelope.height)} height`;
  if (document.parts.length === 0) return "";
  const height = Math.max(...document.parts.map((part) => part.height));
  const depth = Math.max(...document.parts.map((part) => (part.shape === "cylinder" ? part.width : part.depth)));
  const width = Math.max(...document.parts.map((part) => part.width));
  if (depth > 50) return `${dimText(width)} x ${dimText(depth)} x ${dimText(height)} height`;
  const spans = document.parts.map((part) => Math.round(part.width)).sort((a, b) => b - a);
  const deep = spans.find((span) => span < spans[0] - 5) ?? spans[0];
  return `${dimText(spans[0])} x ${dimText(deep)} x ${dimText(height)} height`;
}

export function quotationTerms(quote: QuoteMeta) {
  return [
    `This quotation is valid for ${quote.validityDays} Days from the date of issuance.`,
    "For confirmation, Please return a signed & stamped copy of the quotation via email.",
    `Payment Terms: ${quote.paymentTerms}.`,
    "Extra fees (if applicable) will be communicated in advance.",
    "The expected delivery timeline will be coordinated upon quotation and simulation approval.",
  ];
}

function areaM2(widthMm: number, depthMm: number) {
  return (widthMm * depthMm) / 1_000_000;
}

export function standAreaM2(document: DesignDocument) {
  return Math.round(areaM2(document.envelope.width, document.envelope.depth) * 100) / 100;
}

export function kindForPart(part: ScenePart): SectionKind {
  const name = part.name.toLowerCase();
  if (part.kind === "letters" || part.shape === "letters" || /logo|letter|signage/.test(name)) return "logo_signage";
  if (/floor|carpet|platform|raised/.test(name)) return "floor";
  if (/counter|reception|desk/.test(name)) return "counter";
  if (/lightbox|light box/.test(name)) return "lightbox";
  if (/storage|store room|closet/.test(name)) return "storage_room";
  if (/ceiling|rigging|truss/.test(name)) return "ceiling_rigging";
  if (/screen|led wall|led screen|\btv\b|display|monitor/.test(name)) return "screen_rental";
  if (part.kind === "rental" || /chair|sofa|stool|plant|furniture/.test(name)) return "furniture_rental";
  if (/wall|backdrop|partition/.test(name)) return "wall";
  return "other";
}

function partSpec(part: ScenePart) {
  const width = Math.round(part.width) / 1000;
  const height = Math.round(part.height) / 1000;
  const depth = Math.round(part.shape === "cylinder" ? part.width : part.depth) / 1000;
  const size = part.shape === "cylinder" ? `Ø ${width} m × ${height} m` : `${width} m × ${height} m × ${depth} m`;
  return `${part.name}, ${size}${part.material ? `, ${part.material}` : ""}`;
}

function codeFor(index: number) {
  return String.fromCharCode(65 + (index % 26));
}

const DEFAULT_ITEM = "item-default";
const DEFAULT_TITLE = "Stand";

/** Installation, transport, delivery, and dismantling cover the whole job, not one item. */
export function isJobWide(line: Pick<CostLine, "group" | "description">) {
  const text = line.description.toLowerCase();
  if (/dismant|install|transport|truck|delivery|shipping/.test(text)) return true;
  return line.group === "logistics";
}

function isMaterialLine(line: CostLine) {
  return line.group === "materials" || line.sku.startsWith("MAT-");
}

/** Board area of the pieces cut from one sheet line. A piece that names its Materials entry counts only for that entry. */
function boardArea(parts: ScenePart[], line?: Pick<CostLine, "sku" | "piece">) {
  const materialId = line?.sku.startsWith("MAT-") ? line.sku.slice(4) : null;
  return parts.reduce((sum, part) => {
    if (part.kind === "equipment" || part.kind === "rental") return sum;
    if (line && (materialId || line.piece)) {
      const own = part.materialId === materialId;
      const byType = !part.materialId && Boolean(line.piece) && (part.material ?? "paint") === line.piece;
      if (!own && !byType) return sum;
    }
    return sum + partBoardAreaMm2(part);
  }, 0);
}

/** Split a total across weights. The shares are whole cents and add up to the total. */
function splitCents(total: number, weights: number[]) {
  const cents = Math.max(0, Math.round(total));
  if (weights.length === 0 || cents === 0) return weights.map(() => 0);
  const usable = weights.some((weight) => weight > 0) ? weights : weights.map(() => 1);
  const sum = usable.reduce((acc, weight) => acc + weight, 0);
  const exact = usable.map((weight) => (cents * weight) / sum);
  const floors = exact.map((value) => Math.floor(value));
  let left = cents - floors.reduce((acc, value) => acc + value, 0);
  const order = exact.map((value, index) => ({ index, fraction: value - floors[index] })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const row of order) {
    if (left <= 0) break;
    floors[row.index] += 1;
    left -= 1;
  }
  return floors;
}

type ItemBucket = { id: string; title: string; parts: ScenePart[]; allocations: { key: string; cents: number }[] };

/**
 * One row per item the job builds, plus one installation row for the whole job.
 * A board shared by two items is split by the board area of each item's pieces.
 * A price the user typed stays on that item.
 */
export function buildSections(document: DesignDocument, lines: CostLine[], marginPercent: number, meta: QuoteMeta, previous: QuoteSection[] = []): QuoteSection[] {
  const billable = lines.filter((line) => !line.excluded);
  const buckets: ItemBucket[] = [];
  const byId = new Map<string, ItemBucket>();
  const take = (id: string, title: string) => {
    const found = byId.get(id);
    if (found) return found;
    const created: ItemBucket = { id, title, parts: [], allocations: [] };
    byId.set(id, created);
    buckets.push(created);
    return created;
  };

  for (const part of document.parts) {
    const id = part.group || DEFAULT_ITEM;
    const title = part.group ? document.groups?.[part.group] || DEFAULT_TITLE : meta.title.trim() || DEFAULT_TITLE;
    take(id, title).parts.push(part);
  }
  // A priced job has no pieces. An item named on the job and used by a cost line is still its own row.
  // Drawn jobs keep the rows their pieces already made, so this does not run once anything is drawn.
  if (document.parts.length === 0) {
    for (const line of billable) {
      if (!line.item || isJobWide(line) || byId.has(line.item)) continue;
      const title = document.groups?.[line.item];
      if (!title) continue;
      take(line.item, title);
    }
  }
  if (buckets.length === 0) take(DEFAULT_ITEM, meta.title.trim() || DEFAULT_TITLE);

  const give = (bucket: ItemBucket, key: string, cents: number) => {
    if (cents <= 0) return;
    const found = bucket.allocations.find((row) => row.key === key);
    if (found) found.cents += cents;
    else bucket.allocations.push({ key, cents });
  };
  const spread = (line: CostLine, weights: number[]) => {
    const shares = splitCents(line.totalCents, weights);
    buckets.forEach((bucket, index) => give(bucket, line.key, shares[index] ?? 0));
  };
  const weightNow = () => {
    const totals = buckets.map((bucket) => bucket.allocations.reduce((sum, row) => sum + row.cents, 0));
    if (totals.some((value) => value > 0)) return totals;
    const areas = buckets.map((bucket) => boardArea(bucket.parts));
    if (areas.some((value) => value > 0)) return areas;
    return buckets.map(() => 1);
  };

  const jobLines = billable.filter((line) => isJobWide(line));
  const rest = billable.filter((line) => !isJobWide(line));
  const shared: CostLine[] = [];
  for (const line of rest) {
    if (line.item && byId.has(line.item)) {
      give(byId.get(line.item)!, line.key, line.totalCents);
      continue;
    }
    if (isMaterialLine(line)) {
      const weights = buckets.map((bucket) => boardArea(bucket.parts, line));
      spread(line, weights.some((weight) => weight > 0) ? weights : weightNow());
      continue;
    }
    shared.push(line);
  }
  for (const line of shared) spread(line, weightNow());

  const rows: QuoteSection[] = buckets.map((bucket) => {
    const prior = previous.find((section) => section.itemId === bucket.id);
    const cost = bucket.allocations.reduce((sum, row) => sum + row.cents, 0);
    return {
      id: `sec-${bucket.id}`,
      kind: "other",
      title: prior?.titleEdited ? prior.title : bucket.title,
      ...(prior?.titleEdited ? { titleEdited: true } : {}),
      measureQty: 1,
      measureUnit: "each",
      specs: bucket.parts.slice(0, 8).map(partSpec),
      includes: bucket.parts.slice(0, 8).map((part) => part.name),
      excludes: [],
      partIds: bucket.parts.map((part) => part.id),
      lineKeys: bucket.allocations.map((row) => row.key),
      itemId: bucket.id,
      jobWide: false,
      costCents: cost,
      allocations: bucket.allocations,
      sellCents: prior?.sellEdited ? prior.sellCents : sellCents(cost, marginPercent),
      sellEdited: prior?.sellEdited === true,
    };
  });

  if (jobLines.length > 0) {
    const text = jobLines.map((line) => line.description.toLowerCase()).join(" ");
    const install = /install|transport|truck|delivery|shipping/.test(text);
    const dismantle = /dismant/.test(text);
    const title = dismantle && !install ? "Dismantling" : install ? "Installation and transport" : "Transport";
    const prior = previous.find((section) => section.jobWide);
    const cost = jobLines.reduce((sum, line) => sum + line.totalCents, 0);
    rows.push({
      id: "sec-job",
      kind: dismantle && !install ? "dismantling" : "installation_transport",
      title: prior?.titleEdited ? prior.title : title,
      ...(prior?.titleEdited ? { titleEdited: true } : {}),
      measureQty: 1,
      measureUnit: "each",
      specs: [],
      includes: [],
      excludes: [],
      partIds: [],
      lineKeys: jobLines.map((line) => line.key),
      jobWide: true,
      costCents: cost,
      allocations: jobLines.map((line) => ({ key: line.key, cents: line.totalCents })),
      sellCents: prior?.sellEdited ? prior.sellCents : sellCents(cost, marginPercent),
      sellEdited: prior?.sellEdited === true,
    });
  }

  return rows;
}

/** Rename an item, or move pieces onto one. Prices are rebuilt afterwards. */
export function applyItemEdits(document: DesignDocument, edits: { itemId: string; title?: string; partIds?: string[] }[]) {
  let parts = document.parts;
  const groups = { ...document.groups };
  for (const edit of edits) {
    const id = resolveItemId({ ...document, groups }, edit.itemId);
    const title = edit.title?.trim();
    if (title) groups[id] = title.slice(0, 80);
    else if (!groups[id]) groups[id] = DEFAULT_TITLE;
    if (edit.partIds && edit.partIds.length > 0) {
      const wanted = new Set(edit.partIds);
      parts = parts.map((part) => (wanted.has(part.id) ? { ...part, group: id } : part));
    }
  }
  return { ...document, parts, groups };
}

/**
 * Older callers sent their own groups. The quotation is one row per item now, so those groups are ignored
 * and the rows are built from the pieces.
 */
export function applySectionDrafts(
  drafts: unknown,
  document: DesignDocument,
  lines: CostLine[],
  marginPercent: number,
  meta: QuoteMeta,
  previous: QuoteSection[] = [],
): QuoteSection[] {
  void drafts;
  return buildSections(document, lines, marginPercent, meta, previous);
}

export function sectionCostCents(section: QuoteSection, lines: CostLine[]) {
  if (typeof section.costCents === "number") return section.costCents;
  const keys = new Set(section.lineKeys);
  return lines.filter((line) => !line.excluded && keys.has(line.key)).reduce((sum, line) => sum + line.totalCents, 0);
}

export function quoteTotals(sections: QuoteSection[], vatPercent: number) {
  const sellCents = sections.reduce((sum, section) => sum + section.sellCents, 0);
  const vatCents = Math.round(sellCents * (vatPercent / 100));
  return { sellCents, vatCents, grandTotalCents: sellCents + vatCents };
}

export function sectionCode(index: number) {
  return codeFor(index);
}
