import { z } from "zod";
import { seedCatalog, type CatalogItem } from "./catalog";
import { buildCuttingPlan, materialsForPiece, THIN_PIECE_MM, type CuttingPlan } from "../production/cutting";
import { flatPiece } from "./modular/geometry";
import { roundBlanks } from "./modular/round";
import { pricedMaterialSchema, type PartMaterial, type PricedMaterial, type ScenePart } from "./modular/schema";
import { SHOP_BOARDS, SHOP_ITEMS } from "./shop-list";
import { equipmentKind } from "./equipment";
import { QUOTE_GROUPS } from "./types";

export { pricedMaterialSchema, THIN_PIECE_MM };
export type { PricedMaterial };

/**
 * Everything else a job buys that is not a board or a stand-system item: screws, glue, paint, cable,
 * transport, an hour of the installation crew. The cost review looks here first, so an item the shop
 * has priced once is reused on every job.
 */
export const priceItemSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(100),
  group: z.enum(QUOTE_GROUPS),
  /** What one unit is: each, set, meter, m2, liter, hour, day, trip. */
  unit: z.string().min(1).max(20),
  priceCents: z.number().int().min(0).max(100_000_000),
});
export type PriceItem = z.infer<typeof priceItemSchema>;

/**
 * How the workshop finishes what it builds. The engine reads these to count edge banding, filler, primer,
 * and paint from the pieces. The defaults are common practice for exhibition joinery.
 */
export const shopRulesSchema = z.object({
  /** Straight cut edges of painted MDF: banded with paintable edging, or filled and sealed. Curved edges are always filled. */
  paintedEdges: z.enum(["banding", "filler"]),
  /** Cut edges of raw MDF, plywood, and laminate board: banded, or left raw. */
  rawEdges: z.enum(["banding", "none"]),
  /** Extra banding cut off at each end of every edge, in mm. */
  edgeAllowanceMm: z.number().min(0).max(500),
  edgeWastePercent: z.number().min(0).max(100),
  primerCoats: z.number().int().min(0).max(6),
  topCoats: z.number().int().min(0).max(6),
  /** Square meters one liter covers in one coat. */
  coverageM2PerLiter: z.number().positive().max(100),
  /** Paint lost to spraying, as a percentage of what lands on the piece. */
  sprayWastePercent: z.number().min(0).max(200),
});
export type ShopRules = z.infer<typeof shopRulesSchema>;

export function defaultShopRules(): ShopRules {
  return { paintedEdges: "banding", rawEdges: "banding", edgeAllowanceMm: 25, edgeWastePercent: 10, primerCoats: 2, topCoats: 2, coverageM2PerLiter: 12, sprayWastePercent: 25 };
}

/**
 * The price book: what the shop pays for the materials it builds with. Settings edits it,
 * and every cost, board count, and quotation reads from it.
 */
export const priceBookSchema = z.object({
  version: z.literal(1),
  materials: z.array(pricedMaterialSchema).max(100),
  /** Price overrides for the stand-system items (extrusion, panels, print, floor, and so on), by SKU, in cents. */
  catalog: z.record(z.string(), z.number().int().min(0).max(100_000_000)),
  /** Other priced items. A book saved before this list existed has none, and gets the starting list. */
  items: z.array(priceItemSchema).max(300).optional(),
  /** Which starting list the items came from. A book on an older list gets the newer starting items once. */
  starter: z.number().int().optional(),
  /** Read on its own, so a bad rule falls back to its default without losing the prices. */
  rules: z.unknown().optional(),
});
export type PriceBook = Omit<z.infer<typeof priceBookSchema>, "rules"> & { items: PriceItem[]; rules: ShopRules };

function readRules(input: unknown): ShopRules {
  const rules = defaultShopRules();
  if (!input || typeof input !== "object") return rules;
  const saved = input as Record<string, unknown>;
  const shape = shopRulesSchema.shape;
  for (const key of Object.keys(shape) as (keyof ShopRules)[]) {
    const parsed = shape[key].safeParse(saved[key]);
    if (parsed.success) Object.assign(rules, { [key]: parsed.data });
  }
  return rules;
}

export const PIECE_MATERIALS: { id: PartMaterial; label: string }[] = [
  { id: "paint", label: "Paint" },
  { id: "mdf", label: "MDF" },
  { id: "wood", label: "Wood" },
  { id: "laminate", label: "Laminate" },
  { id: "metal", label: "Metal" },
  { id: "glass", label: "Glass" },
];

export const DEFAULT_BOARD = { width: 2440, height: 1220 } as const;

/** The shop's boards, from the price list in shop-list.ts. Painted pieces are cut from the MDF boards. */
export function defaultMaterials(): PricedMaterial[] {
  return SHOP_BOARDS.map((board) => ({
    id: board.id,
    name: board.name,
    piece: board.piece,
    unit: "board",
    priceCents: board.priceCents,
    boardWidthMm: board.widthMm,
    boardHeightMm: board.heightMm,
    thicknessMm: board.thicknessMm,
    wastePercent: 10,
  }));
}

/**
 * The shop's priced items, from shop-list.ts, followed by items the list does not cover.
 * Those later items are still placeholders, waiting for the shop's own price.
 */
export function defaultPriceItems(): PriceItem[] {
  const item = (id: string, name: string, group: PriceItem["group"], unit: string, priceCents: number): PriceItem => ({ id, name, group, unit, priceCents });
  const shop: PriceItem[] = SHOP_ITEMS.map((entry) => ({ id: entry.id, name: entry.name, group: entry.group, unit: entry.unit, priceCents: entry.priceCents }));
  const placeholders: PriceItem[] = [
    item("hw-cam-dowels", "Cam locks and dowels, set of 20", "hardware", "set", 1200),
    item("hw-lock", "Door handle and lock", "hardware", "each", 1500),
    item("hw-feet", "Leveling feet", "hardware", "each", 250),
    item("hw-cable-ties", "Cable ties, pack of 100", "hardware", "pack", 400),
    item("av-tv", "TV 55 inch, rented for the show", "equipment", "each", 12000),
    item("av-tv-mount", "TV wall mount bracket", "equipment", "each", 3500),
    item("av-hdmi", "HDMI cable", "equipment", "each", 800),
    item("av-player", "Media player", "equipment", "each", 6000),
    item("fin-edge-banding", "Edge banding", "finishing", "meter", 120),
    item("fin-edge-filler", "Edge filling and sealing", "finishing", "meter", 150),
    item("fin-primer", "Primer", "finishing", "liter", 1100),
    // $35 per 3.785 L gallon of the shop's PU paint, which is 925 cents per liter.
    item("fin-paint", "Paint or lacquer", "finishing", "liter", 925),
    item("gfx-lamination", "Print lamination", "graphics", "m2", 600),
    item("gfx-print", "Large-format print", "graphics", "m2", 1500),
    item("pos-shelf-talker", "Shelf talker, printed PVC", "graphics", "each", 400),
    item("pos-wobbler", "Wobbler with flexible arm", "graphics", "each", 200),
    item("hw-alu-price-rail", "Aluminium price rail 39 mm", "hardware", "meter", 900),
    item("hw-standoffs", "Sign stand-off fixing", "hardware", "each", 300),
    item("ltg-lightbox", "Lightbox frame and LEDs, per m² of face", "lighting", "m2", 18000),
    item("lab-cnc", "CNC or laser cutting", "labor", "hour", 4000),
    item("hw-plinth-clips", "Plinth clip", "hardware", "each", 50),
    item("hw-foot-rail-tube", "Foot rail tube 50 mm", "hardware", "meter", 4500),
    item("hw-foot-rail-bracket", "Foot rail bracket", "hardware", "each", 2500),
    item("hw-foot-rail-fitting", "Foot rail elbow or end cap", "hardware", "each", 1500),
    item("fab-steel", "Steel frame, made and painted", "structure", "kg", 450),
    item("el-socket", "Power strip", "electrical", "each", 1200),
    item("el-breaker", "Breaker box", "electrical", "each", 4500),
    item("lab-workshop", "Workshop fabrication", "labor", "hour", 4500),
    item("lab-paint", "Painting and finishing", "labor", "hour", 4000),
    item("lab-kerf-bend", "Kerf bending, per bent piece", "labor", "each", 13500),
    item("lab-artwork", "Artwork preparation", "labor", "hour", 5000),
    item("lab-install", "On-site installation crew", "labor", "hour", 5500),
    item("lab-dismantle", "Dismantling on site", "labor", "hour", 5500),
    item("lab-electrician", "Electrician", "labor", "hour", 6500),
    item("log-packaging", "Packaging: film, wrap, and corners", "logistics", "set", 3000),
    item("log-transport", "Truck transport", "logistics", "trip", 25000),
    item("oth-tools", "Tool and lift rental", "other", "day", 8000),
  ];
  return [...shop, ...placeholders];
}

/** Starting items by the list version that added them. */
const ADDED_IN: Record<number, string[]> = {
  2: ["av-tv", "av-tv-mount", "av-hdmi", "av-player"],
  3: ["fin-edge-filler", "lab-kerf-bend"],
  4: ["gfx-print", "pos-shelf-talker", "pos-wobbler", "hw-data-strip", "hw-alu-price-rail", "hw-standoffs", "ltg-lightbox", "lab-cnc"],
  5: ["hw-plinth-clips", "hw-foot-rail-tube", "hw-foot-rail-bracket", "hw-foot-rail-fitting", "fab-steel"],
};
const STARTER_VERSION = 5;

export function defaultPriceBook(): PriceBook {
  return { version: 1, materials: defaultMaterials(), catalog: {}, items: defaultPriceItems(), starter: STARTER_VERSION, rules: defaultShopRules() };
}

/** Items the shop already has stay as they are. Starting items added since the book was saved are appended once. */
function upgradeItems(saved: PriceItem[] | undefined, starter: number | undefined): PriceItem[] {
  if (!saved) return defaultPriceItems();
  const from = starter ?? 1;
  if (from >= STARTER_VERSION) return saved;
  const added = new Set(Object.entries(ADDED_IN).flatMap(([version, ids]) => (Number(version) > from ? ids : [])));
  const have = new Set(saved.map((item) => item.id));
  return [...saved, ...defaultPriceItems().filter((item) => added.has(item.id) && !have.has(item.id))];
}

function withBoardSize(material: PricedMaterial): PricedMaterial {
  if (material.unit !== "board") return material;
  return {
    ...material,
    boardWidthMm: material.boardWidthMm ?? DEFAULT_BOARD.width,
    boardHeightMm: material.boardHeightMm ?? DEFAULT_BOARD.height,
  };
}

/** Read a stored or posted price book. Anything unreadable falls back to the defaults. */
export function readPriceBook(input: unknown): PriceBook {
  const parsed = priceBookSchema.safeParse(input);
  if (!parsed.success) return defaultPriceBook();
  return {
    ...parsed.data,
    materials: parsed.data.materials.map(withBoardSize),
    items: upgradeItems(parsed.data.items, parsed.data.starter),
    starter: STARTER_VERSION,
    rules: readRules(parsed.data.rules),
  };
}

/** The booth-system catalog with the shop's own prices applied. Applying twice changes nothing. */
export function applyPriceBook(catalog: CatalogItem[], book: PriceBook): CatalogItem[] {
  return catalog.map((item) => {
    const price = book.catalog[item.sku];
    return price === undefined ? item : { ...item, unitCostCents: price };
  });
}

/** The booth-system items whose prices can be edited. System limits carry no price. */
export function systemPriceItems(): CatalogItem[] {
  return seedCatalog().filter((item) => item.unitCostCents > 0);
}

export function materialForPiece(book: PriceBook, piece: PartMaterial | undefined) {
  return materialsForPiece(book.materials, piece ?? "paint")[0] ?? null;
}

export function boardAreaM2(material: PricedMaterial) {
  if (material.unit !== "board") return 0;
  return ((material.boardWidthMm ?? DEFAULT_BOARD.width) * (material.boardHeightMm ?? DEFAULT_BOARD.height)) / 1_000_000;
}

/** What one square meter of the material costs, whether it is bought by the board or by the meter. */
export function pricePerM2Cents(material: PricedMaterial) {
  if (material.unit === "m2") return material.priceCents;
  const area = boardAreaM2(material);
  return area > 0 ? Math.round(material.priceCents / area) : 0;
}

function sortedSides(part: Pick<ScenePart, "shape" | "width" | "height" | "depth">) {
  const depth = part.shape === "cylinder" ? part.width : part.depth;
  return [part.width, part.height, depth].sort((a, b) => a - b);
}

/** Board needed for one piece, in mm². A thin piece is one panel. A thick one counts every face. */
export function partBoardAreaMm2(bent: Pick<ScenePart, "shape" | "width" | "height" | "depth" | "curve" | "round">) {
  const part = flatPiece(bent);
  if (part.shape === "tube") return 0;
  if (part.shape === "cylinder" && bent.round) return roundBlanks(bent).reduce((sum, blank) => sum + blank.w * blank.h, 0);
  if (part.shape === "cylinder") {
    const radius = part.width / 2;
    const disc = Math.PI * radius * radius;
    return part.height <= THIN_PIECE_MM ? disc : Math.PI * part.width * part.height + 2 * disc;
  }
  const [a, b, c] = sortedSides(part);
  return a <= THIN_PIECE_MM ? b * c : 2 * (a * b + a * c + b * c);
}

export type MaterialUsage = {
  materialId: string;
  name: string;
  unit: "board" | "m2";
  pieces: number;
  /** Area the pieces need, in m². */
  areaM2: number;
  /** Area to buy, in m², with offcuts included. */
  buyM2: number;
  /** Whole boards for a board material, or square meters to buy for an m² material. */
  quantity: number;
  unitCents: number;
  totalCents: number;
  boardSize: string | null;
  /** Pieces too big for one board, so they need joining. */
  oversize: string[];
};

export type MaterialEstimate = {
  usage: MaterialUsage[];
  /** Bought-in equipment drawn as a box, such as a TV. It is not cut from board, so it is not counted as board. */
  equipment: ScenePart[];
  /** Pieces whose material has no price entry. */
  unpriced: ScenePart[];
  /** How the sheets are cut. Board quantities above come from this plan. */
  cutting: CuttingPlan;
};

/** How much of each material the custom pieces use, how many boards that is, and what it costs. */
export function estimateMaterials(parts: ScenePart[], book: PriceBook): MaterialEstimate {
  const equipment: ScenePart[] = [];
  const work: ScenePart[] = [];
  for (const part of parts) {
    if (equipmentKind(part)) equipment.push(part);
    else work.push(part);
  }
  const cutting = buildCuttingPlan(work, book.materials);
  const unpriced: ScenePart[] = [];
  const usage: MaterialUsage[] = [];

  for (const group of cutting.groups) {
    const used = work.filter((part) => group.partIds.includes(part.id));
    if (group.soldByM2) {
      const material = book.materials.find((item) => item.id === group.meterId);
      if (!material) {
        unpriced.push(...used);
        continue;
      }
      const areaM2 = group.areaM2;
      const buyM2 = areaM2 * (1 + material.wastePercent / 100);
      const quantity = Math.round(buyM2 * 100) / 100;
      usage.push({
        materialId: material.id,
        name: material.name,
        unit: "m2",
        pieces: used.length,
        areaM2,
        buyM2,
        quantity,
        unitCents: material.priceCents,
        totalCents: Math.round(quantity * material.priceCents),
        boardSize: null,
        oversize: [],
      });
      continue;
    }
    if (group.suggested) {
      unpriced.push(...used);
      continue;
    }
    const largestId = group.tally[0]?.id;
    for (const line of group.tally) {
      if (line.priceCents === null || line.count <= 0) continue;
      const onBoard = group.boards.filter((board) => board.stock.id === line.id).flatMap((board) => board.pieces);
      const pieceIds = new Set(onBoard.map((piece) => piece.partId));
      const areaM2 = onBoard.reduce((sum, piece) => sum + (piece.width * piece.height) / 1_000_000, 0);
      const buyM2 = (line.count * line.width * line.height) / 1_000_000;
      usage.push({
        materialId: line.id,
        name: line.name,
        unit: "board",
        pieces: pieceIds.size,
        areaM2,
        buyM2,
        quantity: line.count,
        unitCents: line.priceCents,
        totalCents: line.totalCents ?? 0,
        boardSize: `${line.width} × ${line.height} mm`,
        oversize: line.id === largestId ? group.oversize : [],
      });
    }
  }
  return { usage, equipment, unpriced, cutting };
}
