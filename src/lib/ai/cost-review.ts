import { QUOTE_GROUPS, type QuoteGroup } from "../systems/types";
import type { CatalogItem } from "../systems/catalog";
import { lineRef, newExtraId, REVIEW_AREAS, type CheckedArea, type CostedJob, type ExtraLine } from "../systems/costing";
import { equipmentKind } from "../systems/equipment";
import type { PriceBook } from "../systems/materials";
import { faceSize } from "../systems/modular/images";
import type { ProductionResult } from "../systems/modular/produce";
import type { DesignDocument } from "../systems/modular/schema";

/**
 * The cost review: an estimator that goes through the whole stand and lists everything production needs
 * that the engine does not already count. It reuses the shop's own prices when the item exists and
 * suggests a priced estimate when it does not.
 */

export type DataRef = {
  ref: string;
  name: string;
  group: QuoteGroup;
  unit: string;
  unitCents: number;
};

function asGroup(value: string): QuoteGroup {
  return (QUOTE_GROUPS as readonly string[]).includes(value) ? (value as QuoteGroup) : "other";
}

/** Every priced thing the shop already has, by the id the model must quote back. */
export function dataRefs(book: PriceBook, catalog: CatalogItem[]): DataRef[] {
  const refs: DataRef[] = [];
  for (const item of catalog) {
    if (item.unitCostCents <= 0) continue;
    refs.push({ ref: `catalog:${item.sku}`, name: item.name, group: asGroup(item.category), unit: item.unit === "each" ? "each" : item.unit, unitCents: item.unitCostCents });
  }
  for (const material of book.materials) {
    const size = material.unit === "board" && material.boardWidthMm && material.boardHeightMm ? ` (${material.boardWidthMm} × ${material.boardHeightMm} mm)` : "";
    refs.push({ ref: `material:${material.id}`, name: `${material.name}${size}`, group: "materials", unit: material.unit === "board" ? "board" : "m2", unitCents: material.priceCents });
  }
  for (const item of book.items) {
    refs.push({ ref: `item:${item.id}`, name: item.name, group: item.group, unit: item.unit, unitCents: item.priceCents });
  }
  return refs;
}

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

const mm = (value: number) => Math.round(value);

/** The stand written out for the estimator: every piece, every wall, every feature, and what is already costed. */
export function reviewBrief(input: {
  document: DesignDocument;
  production: ProductionResult;
  costed: CostedJob;
  refs: DataRef[];
  /** Lines already suggested without asking the model, so it does not repeat them. */
  preset: ExtraLine[];
}) {
  const { document, production, costed, refs, preset } = input;
  const boothBuilt = document.walls.some((wall) => wall.bays.length > 0);
  // Equipment such as a TV is bought in, not built, so it is listed apart from the pieces the workshop makes.
  const built = document.parts.filter((part) => !equipmentKind(part));
  const shown = built.slice(0, 120);
  const pieces = shown.map((part, index) => {
    const depth = part.shape === "cylinder" ? part.width : part.depth;
    const pictures = (part.images ?? []).map((image) => {
      const face = image.face ?? "front";
      const size = faceSize(part, face);
      return `${face} ${((size.width * size.height) / 1_000_000).toFixed(2)} m² face`;
    });
    const group = part.group ? ` · group "${document.groups?.[part.group] ?? part.group}"` : "";
    const letters = part.shape === "letters" && part.label ? ` · cut letters "${part.label}"` : "";
    return `${index + 1}. ${part.name} · ${part.shape} ${mm(part.width)} × ${mm(part.height)} × ${mm(depth)} mm · ${part.material ?? "paint"}${letters}${part.hidden ? " · hidden" : ""}${group}${pictures.length ? ` · printed pictures on: ${pictures.join(", ")}` : ""}`;
  });
  if (built.length > shown.length) pieces.push(`…and ${built.length - shown.length} more pieces like the ones above.`);

  const walls = document.walls
    .filter((wall) => wall.bays.length > 0)
    .map((wall) => `${wall.edge}: ${wall.bays.map((bay) => `${bay.kind}${bay.span > 1 ? ` (${bay.span} modules)` : ""}`).join(", ")}`);

  const covered = costed.lines.map((line) => {
    const note = line.excluded ? " [EXCLUDED from this job]" : line.priceEdited || line.quantityEdited ? " [edited for this job]" : "";
    return `- ${line.description} · ${line.group} · ${line.quantity} ${line.unit} × ${dollars(line.unitCostCents)} = ${dollars(line.totalCents)}${note}`;
  });

  const equipment = document.parts.flatMap((part) => {
    const kind = equipmentKind(part);
    if (!kind) return [];
    const depth = part.shape === "cylinder" ? part.width : part.depth;
    return [`- "${part.name}" (${kind === "screen" ? "screen" : "device"}) ${mm(part.width)} × ${mm(part.height)} × ${mm(depth)} mm, at x ${mm(part.x)}, y ${mm(part.y)}, z ${mm(part.z)}`];
  });

  const data = refs.map((item) => `${item.ref} | ${item.name} | ${item.group} | per ${item.unit} | ${dollars(item.unitCents)}`);

  return [
    `STAND`,
    `Overall size: ${mm(document.envelope.width)} × ${mm(document.envelope.depth)} × ${mm(document.envelope.height)} mm. Modular booth frame: ${boothBuilt ? "yes" : "no"}.`,
    boothBuilt ? `Walls and bays:\n${walls.join("\n")}` : "",
    document.features.length ? `Features: ${JSON.stringify(document.features)}` : "",
    built.length ? `Custom pieces the workshop builds (${built.length}):\n${pieces.join("\n")}` : "No custom pieces to build.",
    ``,
    `WHAT THE ENGINE ALREADY COUNTS`,
    `Frame: ${production.bars} aluminum bars of ${production.stockLengthMm} mm, ${production.connectorCount} connectors. Infill panels: ${production.panels.length}. Printed wall area: ${production.printAreaM2.toFixed(2)} m². Floor covering: ${production.floorAreaM2.toFixed(2)} m². Frame assembly labor: ${production.laborHours.toFixed(1)} hours (modular frame only, not custom pieces).`,
    production.materials.length
      ? `Boards and sheets for custom pieces, offcuts included: ${production.materials.map((usage) => `${usage.name}: ${usage.quantity} ${usage.unit} for ${usage.pieces} pieces (${usage.areaM2.toFixed(2)} m² needed)`).join("; ")}.`
      : "No boards counted.",
    equipment.length
      ? `\nBOUGHT-IN EQUIPMENT ON THE STAND (drawn as boxes, but NOT made of board and NOT in the board count; each needs the device, a mount or stand, cables, and power)\n${equipment.join("\n")}`
      : "",
    preset.length ? `\nALREADY SUGGESTED FOR THE EQUIPMENT ABOVE (do not suggest these again)\n${preset.map((item) => `- ${item.quantity} × ${item.description}`).join("\n")}` : "",
    ``,
    `LINES ALREADY ON THE COST (do not add these again)`,
    covered.length ? covered.join("\n") : "None yet.",
    ``,
    `THE SHOP'S OWN PRICES (use these ids in "match")`,
    data.join("\n"),
  ]
    .filter((part) => part !== "")
    .join("\n");
}

export const COST_REVIEW_PROMPT = `You are the production estimator at a stand-building workshop. You are given a stand that was designed on screen. Your job is to find every cost that building, finishing, packing, moving, installing, and dismantling it will really involve, and that is NOT already on the cost list. Forget nothing. A forgotten box of screws or a forgotten truck trip costs the shop money.

The engine already counts: the frame bars and connectors, infill panels, printed wall graphics, floor covering, modular frame assembly labor, the boards or sheets the custom pieces are cut from, and their edge banding, edge filling, primer, and paint. Those lines are listed under "LINES ALREADY ON THE COST". Never add them again. If a line is marked EXCLUDED the user left it out on purpose, so do not suggest it back.

Think through every area below, one at a time, for THIS stand. For each area decide whether it is already costed, needs new lines, or is genuinely not needed for this stand, and say which in "checked".
1. Frame and structure: what holds it up. Feet, leveling, bracing, anchors, corner and joining pieces.
2. Boards and panels: usually counted. Check that nothing made of another material (glass, acrylic, metal sheet, foam board) is missing a line.
3. Hardware and fixings: screws, cam locks, dowels, brackets, hinges, handles, locks, shelf pins, glass clips. Scale to the number of pieces and joints.
4. Adhesives and finishing: glue, silicone, sanding, protective coating. Edge banding, edge filling, primer, and paint are counted by the engine from the pieces and appear under LINES ALREADY ON THE COST; never add them again.
5. Printing and graphics: every picture or logo on a piece prints on its own. Estimate its print area from the face size given and price the print, lamination, and the labor to apply it. The engine's printed area covers only the booth walls.
6. Displays and equipment: any TV, monitor, screen, projector, speaker, tablet, or laptop on the stand is bought-in or rented equipment. It is NOT cut from board and it is not in the board count, even though it is drawn as a box. Every one of them needs the device itself (or its rental), a wall mount, bracket, or hook sized to it, or a floor stand, the cables (HDMI and power), something to play from (a media player), and a power point. Never skip a TV, and never skip its mount. List what is on the stand under BOUGHT-IN EQUIPMENT and cost each one. Do not give those pieces boards, edge banding, paint, or workshop labor: they are not built.
7. Lighting and electrical: each lightbox and spotlight needs a driver or power supply, cable, and connection. A stand with lighting needs power distribution, a breaker, and an electrician. Add LED strip when a piece looks like a lit sign, shelf, or counter.
8. Flooring: if floor covering is counted, it also needs tape, edge trim, and protection. A raised platform or plinth also needs its own finish.
9. Workshop labor: the engine counts labor only for the modular frame. Every custom piece still has to be cut, assembled, sanded, painted, and finished in the workshop. Estimate hours from the number and size of the pieces. Add artwork preparation hours when there are pictures to print.
10. On-site installation: crew hours to install, supervision, and dismantling after the show. Scale to the stand size and number of pieces.
11. Packaging and transport: wrapping and corner protection, crating, truck trips, loading and handling, storage if the stand must wait. Scale to the volume and the number of pieces.
12. Tools and consumables: lift or scaffold rental for a tall stand, tool hire, tape, blades, cleaning, anything small a crew uses up.

Rules:
- Prefer the shop's own prices. Each of them has an id like "item:screw-black-30" in THE SHOP'S OWN PRICES. When a line you need is one of them, set "match" to that exact id and give only the quantity in that item's unit. Its price comes from the shop, so do not give a price for it.
- Only when nothing in the shop's prices fits, set "match" to null, give a clear name, the unit one of each, set, box, meter, m2, liter, hour, day, trip, and "estimateUsd" as your honest estimate of the price of ONE unit in US dollars. The user will review it and may save it to their prices.
- Quantities must be real numbers worked out from the stand: counts from the pieces listed, areas from their sizes. Round up where you buy whole units. Never use 0.
- Use "group" from: ${QUOTE_GROUPS.join(", ")}.
- "reason" is one short sentence saying what on the stand this line is for, for example "14 pieces need about 40 screws and 12 cam locks to join".
- Do not pad the list. Every line must be something this stand really needs. If an area needs nothing, say so in "checked" instead of adding a line.

Reply with only one JSON object, no code fences and no other text:
{
  "summary": "two or three plain sentences: what you found and what matters most",
  "checked": [ { "area": one of ${REVIEW_AREAS.map((area) => `"${area}"`).join(", ")}, "status": "costed" | "suggested" | "not-needed", "note": "one short sentence" } ],
  "items": [ { "description": "...", "group": "...", "quantity": 0, "unit": "...", "reason": "...", "match": "item:..." or null, "estimateUsd": 0 } ]
}
Include every one of the twelve areas in "checked", in order.`;

export type ReviewResult = {
  summary: string;
  checked: CheckedArea[];
  suggestions: ExtraLine[];
};

const MAX_ITEMS = 40;

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function num(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** What the matcher needs to know about the job: the shop's prices, what is already costed, and what is already suggested. */
export type SuggestionContext = { refs: DataRef[]; costed: CostedJob; preset?: ExtraLine[] };

/**
 * Turn the estimator's items into cost lines. An item that matches one of the shop's own prices takes that
 * price. Anything else becomes an estimate. Items already on the cost, or already in `preset`, are skipped,
 * and items that cannot be used are dropped one by one. Only the new lines are returned.
 */
export function resolveSuggestions(items: unknown[], context: SuggestionContext): ExtraLine[] {
  const byRef = new Map(context.refs.map((item) => [item.ref, item]));
  const covered = new Set(context.costed.lines.flatMap((line) => (line.ref ? [line.ref] : [lineRef(line)])));
  const described = new Set(context.costed.lines.map((line) => line.description.toLowerCase()));
  for (const item of context.preset ?? []) {
    if (item.ref) covered.add(item.ref);
    described.add(item.description.toLowerCase());
  }
  const suggestions: ExtraLine[] = [];
  // One price item named twice in the same list (edge banding for two pieces) is one line with both quantities.
  const added = new Map<string, ExtraLine>();

  for (const raw of items) {
    if (suggestions.length >= MAX_ITEMS) break;
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const quantity = num(item.quantity);
    if (quantity === null || quantity <= 0 || quantity > 1_000_000) continue;
    const rounded = Math.round(quantity * 100) / 100 || 0.01;
    const reason = text(item.reason, 400) || undefined;
    const itemId = text(item.item, 80) || undefined;

    const match = typeof item.match === "string" ? byRef.get(item.match) : undefined;
    if (match) {
      const same = added.get(match.ref);
      if (same) {
        same.quantity = Math.min(1_000_000, Math.round((same.quantity + rounded) * 100) / 100);
        continue;
      }
      if (covered.has(match.ref)) continue;
      covered.add(match.ref);
      described.add(match.name.slice(0, 160).toLowerCase());
      const line: ExtraLine = {
        id: newExtraId(),
        description: match.name.slice(0, 160),
        group: match.group,
        quantity: rounded,
        unit: match.unit.slice(0, 20),
        unitCents: match.unitCents,
        source: "data",
        ref: match.ref,
        reason,
        ...(itemId ? { item: itemId } : {}),
      };
      added.set(match.ref, line);
      suggestions.push(line);
      continue;
    }

    const description = text(item.description, 160);
    if (!description || described.has(description.toLowerCase())) continue;
    const estimate = num(item.estimateUsd);
    const unitCents = estimate !== null && estimate >= 0 && estimate <= 1_000_000 ? Math.round(estimate * 100) : 0;
    described.add(description.toLowerCase());
    suggestions.push({
      id: newExtraId(),
      description,
      group: asGroup(text(item.group, 20)),
      quantity: rounded,
      unit: text(item.unit, 20) || "each",
      unitCents,
      source: "new",
      reason,
      ...(itemId ? { item: itemId } : {}),
    });
  }
  return suggestions;
}

/** Read the model's reply. Items that cannot be used are dropped one by one instead of failing the whole review. */
export function readReview(reply: string, context: SuggestionContext): ReviewResult | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const body = parsed as { summary?: unknown; checked?: unknown; items?: unknown };
  if (!Array.isArray(body.items)) return null;

  const preset = context.preset ?? [];
  const suggestions: ExtraLine[] = [...preset, ...resolveSuggestions(body.items, context)];

  const checked = (Array.isArray(body.checked) ? body.checked : []).flatMap((raw): CheckedArea[] => {
    if (!raw || typeof raw !== "object") return [];
    const area = raw as Record<string, unknown>;
    const name = text(area.area, 60);
    const status = area.status;
    if (!name || (status !== "costed" && status !== "suggested" && status !== "not-needed")) return [];
    return [{ area: name, status, note: text(area.note, 300) }];
  });

  return { summary: text(body.summary, 1000), checked, suggestions };
}

/**
 * What a TV on the stand always needs, added without asking the model, so a screen is never forgotten:
 * the TV, its wall mount, a cable, and a player. Only items the shop has priced are used.
 */
export function equipmentSuggestions(document: DesignDocument, refs: DataRef[], costed: CostedJob): ExtraLine[] {
  const screens = document.parts.filter((part) => equipmentKind(part) === "screen");
  if (screens.length === 0) return [];
  const byRef = new Map(refs.map((item) => [item.ref, item]));
  const covered = new Set(costed.lines.flatMap((line) => (line.ref ? [line.ref] : [])));
  const names = screens.slice(0, 3).map((part) => `"${part.name}"`).join(", ");
  const why: Record<string, string> = {
    "item:av-tv": `${screens.length === 1 ? "The stand has a screen" : `The stand has ${screens.length} screens`}: ${names}. It is bought-in equipment, not board.`,
    "item:av-tv-mount": "Each screen needs a wall mount or bracket to hang on.",
    "item:av-hdmi": "Each screen needs a cable from its player.",
    "item:av-player": "Each screen needs something to play from.",
  };
  return Object.entries(why).flatMap(([ref, reason]): ExtraLine[] => {
    const item = byRef.get(ref);
    if (!item || covered.has(ref)) return [];
    const shared = screens.every((part) => part.group && part.group === screens[0]?.group) ? screens[0]?.group : undefined;
    return [{ id: newExtraId(), description: item.name, group: item.group, quantity: screens.length, unit: item.unit, unitCents: item.unitCents, source: "data", ref, reason, ...(shared ? { item: shared } : {}) }];
  });
}
