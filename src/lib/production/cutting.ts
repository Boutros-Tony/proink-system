import { equipmentKind } from "../systems/equipment";
import { faceAxes, faceShape, flatPiece } from "../systems/modular/geometry";
import { roundBlanks } from "../systems/modular/round";
import type { PartMaterial, ScenePart } from "../systems/modular/schema";
import { nestPair, type PairLayout } from "./nest";

/**
 * How the workshop cuts the job out of whole sheets.
 * Sizes and prices come from Materials. Two rows of the same piece (a 1 × 1 m paint board and a
 * 2 × 2 m paint board) are both available. Pieces are laid on the largest sheet they fit on.
 * A smaller sheet is used only for what is left over, when that leftover fits on one smaller sheet
 * instead of another large one. A piece bigger than every sheet is joined, still starting from the
 * largest sheet. A sheet the shop has not priced is drawn at a standard size and marked as a suggestion.
 */

/** Pieces up to this thick are one flat panel. Thicker pieces are built as a hollow box of boards. */
export const THIN_PIECE_MM = 50;

export type CuttingMaterial = {
  id: string;
  name: string;
  piece: PartMaterial | null;
  unit: "board" | "m2";
  priceCents: number;
  boardWidthMm?: number;
  boardHeightMm?: number;
  thicknessMm?: number;
  wastePercent: number;
  /** How the shop cuts this sheet. Left out, acrylic and thin metal are laser cut and the rest is sawn. */
  cutter?: Cutter;
  grain?: boolean;
  edgeMarginMm?: number;
};

export const CUTTERS = ["saw", "laser", "cnc"] as const;
export type Cutter = (typeof CUTTERS)[number];

/** Veneer and wood-look faces have a direction. Plain boards, paint-grade MDF and metal do not. */
export function defaultGrain(material: { name: string }) {
  return /veneer|wood ?grain|wood ?look|oak|walnut|teak|beech|cherry|maple|ash\b/i.test(material.name);
}

/** Laser and router keep clear of the clamps and the edge for their lead-in. Clean board on a saw is used to the edge. */
export function defaultEdgeMargin(cutter: Cutter) {
  return cutter === "laser" ? 5 : cutter === "cnc" ? 10 : 0;
}

/** The cutter a sheet uses when Materials does not say. */
export function defaultCutter(material: { name: string; piece?: PartMaterial | null; thicknessMm?: number }): Cutter {
  const text = material.name.toLowerCase();
  if (/plexi|acrylic|perspex/.test(text)) return "laser";
  const metal = material.piece === "metal" || /alumin|steel|\bmetal\b|inox|galvan/.test(text);
  if (metal && (material.thicknessMm ?? 3) <= 6) return "laser";
  return "saw";
}

export type BladeAdvice = {
  id: string;
  kerfMm: number;
  title: string;
  detail: string;
};

export type StockChoice = {
  id: string;
  name: string;
  width: number;
  height: number;
  priceCents: number | null;
  suggested: boolean;
  thicknessMm?: number;
  /** Pieces keep the sheet's grain direction: no quarter turns. */
  grain?: boolean;
};

export type CutPiece = {
  id: string;
  partId: string;
  partName: string;
  code: string;
  width: number;
  height: number;
  fill: string;
  joinIndex?: number;
  joinCount?: number;
  detail: string;
  /** The finished cut, in mm on the unrotated blank. Origin is the blank's bottom-left, y up. */
  shape?: { outer: [number, number][]; holes: [number, number][][] };
};

/**
 * `rotated` turns the blank a quarter turn on the sheet. `flipped` turns it half a turn as well. `nested` is a
 * shaped piece laid into another one's waste, so its rectangle overlaps its partner and only the shape is cut.
 */
export type PlacedPiece = CutPiece & { x: number; y: number; rotated: boolean; flipped?: boolean; nested?: boolean };

/** A placed piece's cut outline on the sheet, in mm from the sheet's top-left, y down. */
export function shapeOnBoard(piece: PlacedPiece): CutPiece["shape"] {
  if (!piece.shape) return undefined;
  const at = ([u, v]: [number, number]): [number, number] => {
    const [bx, by] = piece.flipped ? [piece.width - u, piece.height - v] : [u, v];
    return piece.rotated ? [piece.x + piece.height - by, piece.y + piece.width - bx] : [piece.x + bx, piece.y + piece.height - by];
  };
  return { outer: piece.shape.outer.map(at), holes: piece.shape.holes.map((hole) => hole.map(at)) };
}

function ringArea(points: [number, number][]) {
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    sum += x0 * y1 - x1 * y0;
  }
  return Math.abs(sum) / 2;
}

/** Board a piece really uses: its shape when it has one, otherwise its rectangle. */
export function pieceArea(piece: Pick<CutPiece, "width" | "height" | "shape">) {
  if (!piece.shape) return piece.width * piece.height;
  return Math.max(0, ringArea(piece.shape.outer) - piece.shape.holes.reduce((sum, hole) => sum + ringArea(hole), 0));
}

/** Where to write a piece's code: the middle of its shape, so a nested piece is not labelled inside its partner. */
export function labelPoint(piece: PlacedPiece): [number, number] {
  const shape = shapeOnBoard(piece);
  const w = piece.rotated ? piece.height : piece.width;
  const h = piece.rotated ? piece.width : piece.height;
  if (!shape) return [piece.x + w / 2, piece.y + h / 2];
  let area = 0;
  let cx = 0;
  let cy = 0;
  const ring = shape.outer;
  for (let index = 0; index < ring.length; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[(index + 1) % ring.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  return Math.abs(area) < 1e-6 ? [piece.x + w / 2, piece.y + h / 2] : [cx / (3 * area), cy / (3 * area)];
}

export type CutBoard = {
  stock: StockChoice;
  number: number;
  total: number;
  pieces: PlacedPiece[];
  offcuts: Array<{ x: number; y: number; width: number; height: number }>;
  usedPercent: number;
};

export type TallyLine = StockChoice & { count: number; totalCents: number | null };

export type MaterialCut = {
  id: string;
  piece: PartMaterial;
  title: string;
  blade: BladeAdvice;
  boards: CutBoard[];
  tally: TallyLine[];
  usedPercent: number;
  /** Bought by the square meter. The sheets are only a cutting guide. */
  soldByM2: boolean;
  /** The Materials entry priced by the square meter, when `soldByM2`. */
  meterId: string | null;
  /** None of these sheet sizes are in Materials. */
  suggested: boolean;
  suggestionNote: string | null;
  partIds: string[];
  /** Part names that do not fit on one sheet, so the plan joins them. */
  oversize: string[];
  /** Square meters of the pieces, used when the material is bought by the m². */
  areaM2: number;
};

export type CuttingPlan = {
  groups: MaterialCut[];
  /** Set when every material on the job uses the same blade. */
  bladeSummary: string | null;
};

const FILLS = ["#d7e3ff", "#f8d7b0", "#cfeeda", "#f6d0e2", "#e4d8ff", "#f7ecb0", "#c9eef2", "#f6d4c8", "#d9e2c8", "#f3d5d5"];

const PIECE_LABEL: Record<PartMaterial, string> = {
  paint: "Paint",
  mdf: "MDF",
  wood: "Wood",
  laminate: "Laminate",
  metal: "Metal",
  glass: "Glass",
};

type Rect = { w: number; h: number };
type Free = { x: number; y: number; w: number; h: number };
type Blank = Rect & {
  partId: string;
  partName: string;
  detail: string;
  joinIndex?: number;
  joinCount?: number;
  shape?: CutPiece["shape"];
  /** Two shaped pieces nested together, packed as this one rectangle. */
  pair?: { first: Blank; second: Blank; layout: PairLayout };
};

/** Turn a face outline into the blank's axes. Swapping x and y mirrors it, so the ring is put back counterclockwise. */
function orientShape(shape: NonNullable<CutPiece["shape"]>, faceWidth: number, blankWidth: number): NonNullable<CutPiece["shape"]> {
  if (Math.abs(faceWidth - blankWidth) <= 0.5) return shape;
  const turn = (points: [number, number][]) => {
    const swapped = points.map(([x, y]) => [y, x] as [number, number]);
    let area = 0;
    for (let index = 0; index < swapped.length; index += 1) {
      const [x0, y0] = swapped[index];
      const [x1, y1] = swapped[(index + 1) % swapped.length];
      area += x0 * y1 - x1 * y0;
    }
    return area < 0 ? swapped.reverse() : swapped;
  };
  return { outer: turn(shape.outer), holes: shape.holes.map(turn) };
}

type OpenBoard = {
  stock: StockChoice;
  free: Free[];
  placed: Array<Blank & { x: number; y: number; pw: number; ph: number; rotated: boolean; flipped?: boolean; nested?: boolean }>;
};

/** Shaped pieces that save the most board when laid head to tail go in as one rectangle. The rest stay as they are. */
function pairShaped(blanks: Blank[], stocks: StockChoice[], kerf: number): Blank[] {
  const shaped = blanks.flatMap((blank, index) => (blank.shape && !blank.joinCount ? [index] : [])).slice(0, 60);
  const options: Array<{ i: number; j: number; layout: PairLayout; saving: number }> = [];
  // Matching pieces nest the same way, so each pair of shapes is worked out once.
  const keyOf = (blank: Blank) => `${blank.w}x${blank.h}:${JSON.stringify(blank.shape)}`;
  const memo = new Map<string, PairLayout | null>();
  const onSheet = (w: number, h: number) => stocks.some((stock) => fitsStock(w, h, stock));
  for (let a = 0; a < shaped.length; a += 1) {
    for (let b = a + 1; b < shaped.length; b += 1) {
      const first = blanks[shaped[a]];
      const second = blanks[shaped[b]];
      const key = `${keyOf(first)}|${keyOf(second)}`;
      if (!memo.has(key)) memo.set(key, nestPair({ w: first.w, h: first.h, shape: first.shape! }, { w: second.w, h: second.h, shape: second.shape! }, kerf, 0.05, onSheet));
      const layout = memo.get(key) ?? null;
      if (!layout) continue;
      options.push({ i: shaped[a], j: shaped[b], layout, saving: first.w * first.h + second.w * second.h - layout.w * layout.h });
    }
  }
  options.sort((x, y) => y.saving - x.saving);
  const taken = new Set<number>();
  const pairs: Blank[] = [];
  for (const option of options) {
    if (taken.has(option.i) || taken.has(option.j)) continue;
    taken.add(option.i);
    taken.add(option.j);
    const first = blanks[option.i];
    const second = blanks[option.j];
    pairs.push({ w: option.layout.w, h: option.layout.h, partId: first.partId, partName: `${first.partName} + ${second.partName}`, detail: "nested pair", pair: { first, second, layout: option.layout } });
  }
  return [...blanks.filter((_, index) => !taken.has(index)), ...pairs];
}

/** A packed pair back as its two pieces, each where it sits inside the pair's rectangle on the sheet. */
function unpair(placed: OpenBoard["placed"][number]): OpenBoard["placed"] {
  if (!placed.pair) return [placed];
  const { first, second, layout } = placed.pair;
  const put = (blank: Blank, at: { x: number; y: number }, flipped: boolean) => {
    const x = placed.rotated ? placed.x + layout.h - at.y - blank.h : placed.x + at.x;
    const y = placed.rotated ? placed.y + layout.w - at.x - blank.w : placed.y + layout.h - at.y - blank.h;
    return { ...blank, x, y, pw: placed.rotated ? blank.h : blank.w, ph: placed.rotated ? blank.w : blank.h, rotated: placed.rotated, nested: true, ...(flipped ? { flipped: true } : {}) };
  };
  return [put(first, layout.first, layout.first.flipped), put(second, layout.second, layout.second.flipped)];
}

export function bladeFor(piece: PartMaterial, names: string[]): BladeAdvice {
  const text = names.join(" ").toLowerCase();
  if (/plexi|acrylic|perspex|polycarbonate/.test(text)) {
    return {
      id: "acrylic",
      kerfMm: 3,
      title: "Acrylic blade, 3 mm",
      detail: "Fine triple-chip blade. Slow feed so the plexi does not melt, and leave the film on while cutting.",
    };
  }
  if (piece === "glass" || /\bglass\b|mirror/.test(text)) {
    return {
      id: "glass",
      kerfMm: 0,
      title: "Glass cutter",
      detail: "Score and snap. A saw blade will shatter it.",
    };
  }
  if (piece === "metal" || /alumin|steel|\bmetal\b/.test(text)) {
    return {
      id: "metal",
      kerfMm: 3,
      title: "Non-ferrous metal blade, 3 mm",
      detail: "Carbide blade for sheet, with wax on the cut. Sheet thicker than 6 mm is sheared, not ripped.",
    };
  }
  if (/foam|foamex|\bpvc\b/.test(text)) {
    return {
      id: "foam",
      kerfMm: 3,
      title: "Fine-tooth blade, 3 mm",
      detail: "High tooth count so the foam does not chip.",
    };
  }
  if (piece === "laminate" || /laminate|melamine|\bhpl\b/.test(text)) {
    return {
      id: "laminate",
      kerfMm: 4,
      title: "Laminate blade, 4 mm",
      detail: "High-tooth blade. Cut face-down, or score the face first, so the laminate does not chip.",
    };
  }
  return {
    id: "panel",
    kerfMm: 4,
    title: "Panel-saw blade, 4 mm",
    detail: "Carbide blade, 60 to 80 teeth. The red dashed lines are this cut.",
  };
}

/** A laser or a CNC router instead of the saw. The material's blade id stays, so sheet sizes and grouping do not change. */
/**
 * The gap between pieces for each cutter. Fiber laser on metal follows the usual nesting table: 1.5 mm at 1 mm
 * thick, 2 at 3, 2.5 at 6, 3 at 10. Laser on acrylic or wood needs at least 3 mm so the web between cuts does not
 * burn through. A router needs its bit's width plus a few mm so the web holds the pieces still.
 */
export function cutterGap(cutter: Cutter, piece: PartMaterial, thicknessMm: number, kerfMm: number) {
  if (cutter === "laser") return piece === "metal" ? Math.max(1.5, Math.ceil((1.3 + thicknessMm * 0.17) * 2) / 2) : Math.max(3, Math.ceil(thicknessMm));
  if (cutter === "cnc") return 6 + 3;
  return kerfMm;
}

function cutWith(blade: BladeAdvice, cutter: Cutter, piece: PartMaterial, thicknessMm: number): BladeAdvice {
  const gap = cutterGap(cutter, piece, thicknessMm, blade.kerfMm);
  if (cutter === "laser") {
    return { ...blade, kerfMm: gap, title: `Laser cut, ${gap} mm apart`, detail: "The beam takes about 0.2 mm, so pieces nest close and shaped pieces share their waste. Keep 5–10 mm off the sheet edge. Keep the film on acrylic." };
  }
  if (cutter === "cnc") {
    return { ...blade, kerfMm: gap, title: `CNC router, 6 mm bit, ${gap} mm apart`, detail: "Pieces sit a bit's width plus 3 mm apart. Inside corners keep the bit's 3 mm radius. Cut small pieces first and hold them with tabs. Keep veneer grain one way." };
  }
  return blade;
}

function suggestedStocks(piece: PartMaterial, blade: BladeAdvice): StockChoice[] {
  const sheets: Array<[number, number, string]> =
    blade.id === "acrylic"
      ? [
          [3050, 2050, "Acrylic sheet 3050 × 2050 mm"],
          [2440, 1220, "Acrylic sheet 2440 × 1220 mm"],
        ]
      : blade.id === "glass"
        ? [[3210, 2250, "Jumbo glass 3210 × 2250 mm"]]
        : blade.id === "metal"
          ? [
              [2500, 1250, "Metal sheet 2500 × 1250 mm"],
              [2000, 1000, "Metal sheet 2000 × 1000 mm"],
            ]
          : blade.id === "laminate"
            ? [
                [2800, 2070, "Laminate board 2800 × 2070 mm"],
                [2440, 1220, "Laminate board 2440 × 1220 mm"],
              ]
            : blade.id === "foam"
              ? [
                  [3050, 1560, "Foam PVC 3050 × 1560 mm"],
                  [2440, 1220, "Foam PVC 2440 × 1220 mm"],
                ]
              : [
                  [2440, 1220, `${PIECE_LABEL[piece]} sheet 2440 × 1220 mm`],
                  [2000, 2000, `${PIECE_LABEL[piece]} sheet 2000 × 2000 mm`],
                ];
  return sheets.map(([width, height, name]) => ({
    id: `suggested-${piece}-${width}x${height}`,
    name,
    width,
    height,
    priceCents: null,
    suggested: true,
  }));
}

function facesOf(bent: ScenePart): Array<{ w: number; h: number; detail: string; shape?: CutPiece["shape"] }> {
  const part = flatPiece(bent);
  if (bent.curve) return [{ w: part.width, h: part.height, detail: "flat blank, kerf bent" }];
  if (part.shape === "letters") return [{ w: part.width, h: part.height, detail: part.label ? `letters ${part.label}` : "letters" }];
  if (part.shape === "tube") return [];
  if (part.shape === "cylinder" && part.round) return roundBlanks(part);
  if (part.shape === "cylinder") {
    const diameter = part.width;
    if (part.height <= THIN_PIECE_MM) return [{ w: diameter, h: diameter, detail: "disc" }];
    return [
      { w: Math.ceil(Math.PI * diameter), h: part.height, detail: "unrolled side" },
      { w: diameter, h: diameter, detail: "cap" },
      { w: diameter, h: diameter, detail: "cap" },
    ];
  }
  const thin = Math.min(part.width, part.height, part.depth);
  if (thin <= THIN_PIECE_MM) {
    const [a, b, c] = [part.width, part.height, part.depth].sort((left, right) => left - right);
    const axes = faceAxes(part);
    const shape = axes.thickness === thin ? faceShape(part) : null;
    return [{ w: c, h: b, detail: a === thin ? "" : "", ...(shape ? { shape: orientShape(shape, axes.width, c) } : {}) }];
  }
  const pairs: Array<[number, number, string]> = [
    [part.width, part.height, "front"],
    [part.width, part.depth, "top"],
    [part.height, part.depth, "side"],
  ];
  return pairs.flatMap(([w, h, detail]) => [
    { w, h, detail },
    { w, h, detail },
  ]);
}

function fits(w: number, h: number, stockW: number, stockH: number, turn = true) {
  return (w <= stockW + 0.5 && h <= stockH + 0.5) || (turn && h <= stockW + 0.5 && w <= stockH + 0.5);
}

function fitsStock(w: number, h: number, stock: StockChoice) {
  return fits(w, h, stock.width, stock.height, !stock.grain);
}

function stockEdges(stocks: StockChoice[]) {
  return [...new Set(stocks.flatMap((stock) => [stock.width, stock.height]).filter((edge) => edge > 0))].sort((a, b) => b - a);
}

/** Ways to cover a length with the edges of the sheets on hand. The last piece is trimmed to fit. */
function coverOptions(length: number, edges: number[]): number[][] {
  const options = [...new Set(edges.filter((edge) => edge > 0))].sort((a, b) => b - a);
  if (!options.length || length <= 0) return [[length]];
  const ways = [minCountCover(length, options), greedyCover(length, options), greedyCover(length, [...options].reverse())];
  const seen = new Set<string>();
  return ways.filter((way) => {
    const key = way.join(",");
    if (seen.has(key) || way.reduce((sum, part) => sum + part, 0) < length - 0.5) return false;
    seen.add(key);
    return true;
  });
}

function minCountCover(length: number, options: number[]): number[] {
  const max = length + options[0];
  const count = Array<number>(max + 1).fill(Number.POSITIVE_INFINITY);
  const prev = Array<number>(max + 1).fill(-1);
  const took = Array<number>(max + 1).fill(0);
  count[0] = 0;
  for (let cursor = 0; cursor <= max; cursor += 1) {
    if (!Number.isFinite(count[cursor])) continue;
    for (const option of options) {
      const next = cursor + option;
      if (next > max) continue;
      if (count[cursor] + 1 < count[next]) {
        count[next] = count[cursor] + 1;
        prev[next] = cursor;
        took[next] = option;
      }
    }
  }
  let best = -1;
  for (let cursor = length; cursor <= max; cursor += 1) {
    if (!Number.isFinite(count[cursor])) continue;
    if (best < 0 || cursor - length < best - length || (cursor - length === best - length && count[cursor] < count[best])) best = cursor;
  }
  if (best < 0) return [length];
  const chunks: number[] = [];
  for (let cursor = best; cursor > 0; cursor = prev[cursor]) chunks.push(took[cursor]);
  chunks.sort((a, b) => b - a);
  const pieces = [...chunks];
  pieces[pieces.length - 1] -= best - length;
  return pieces.filter((piece) => piece > 0);
}

function greedyCover(length: number, options: number[]): number[] {
  const pieces: number[] = [];
  let left = length;
  while (left > 0) {
    const fit = options.find((option) => option <= left) ?? options[options.length - 1];
    if (fit >= left) {
      pieces.push(left);
      break;
    }
    pieces.push(fit);
    left -= fit;
  }
  return pieces;
}

function gridOf(w: number, h: number, cellW: number, cellH: number): Rect[] | null {
  if (cellW < 1 || cellH < 1) return null;
  const across = Math.round(w / cellW);
  const down = Math.round(h / cellH);
  const count = across * down;
  if (across < 1 || down < 1 || count <= 1 || count > 40) return null;
  if (Math.abs(across * cellW - w) > 1 || Math.abs(down * cellH - h) > 1) return null;
  return Array.from({ length: count }, () => ({ w: cellW, h: cellH }));
}

type Score = { waste: number; cost: number; boards: number; unplaced: number; largeArea: number };

function compareScore(a: Score, b: Score) {
  if (a.unplaced !== b.unplaced) return a.unplaced - b.unplaced;
  if (a.waste !== b.waste) return a.waste - b.waste;
  if (a.largeArea !== b.largeArea) return b.largeArea - a.largeArea;
  if (a.cost !== b.cost) return a.cost - b.cost;
  return a.boards - b.boards;
}

function packBlanks(blanks: Blank[], stocks: StockChoice[], kerf: number): OpenBoard[] {
  if (!blanks.length || !stocks.length) return [];
  // Fill the largest sheet first. A smaller sheet replaces a large one only when every piece on
  // that sheet fits on the smaller one, so the leftover is not another full large board.
  return downgradeSparseBoards(greedyPack(blanks, stocks, kerf), stocks, kerf);
}

function downgradeSparseBoards(boards: OpenBoard[], stocks: StockChoice[], kerf: number): OpenBoard[] {
  const smallerFirst = [...stocks].sort((a, b) => a.width * a.height - b.width * b.height);
  return boards.map((board) => {
    const pieces = board.placed.map((piece) => ({ ...piece }));
    for (const stock of smallerFirst) {
      if (stock.width * stock.height >= board.stock.width * board.stock.height - 0.5) continue;
      const packed = greedyPack(pieces, [stock], kerf);
      if (packed.length === 1 && packed[0].placed.length === pieces.length) return packed[0];
    }
    return board;
  });
}

function scoreBoards(boards: OpenBoard[], blanks: Blank[], stocks: StockChoice[]): Score {
  const placed = boards.reduce((sum, board) => sum + board.placed.length, 0);
  const bought = boards.reduce((sum, board) => sum + board.stock.width * board.stock.height, 0);
  const used = boards.reduce((sum, board) => sum + board.placed.reduce((area, piece) => area + piece.w * piece.h, 0), 0);
  const cost = boards.reduce((sum, board) => sum + (board.stock.priceCents ?? 1_000_000_000), 0);
  const largest = stocks.reduce((area, stock) => Math.max(area, stock.width * stock.height), 0);
  const largeArea = boards
    .filter((board) => board.stock.width * board.stock.height >= largest - 0.5)
    .reduce((sum, board) => sum + board.placed.reduce((area, piece) => area + piece.w * piece.h, 0), 0);
  return { waste: bought - used, cost, boards: boards.length, unplaced: blanks.length - placed, largeArea };
}

function greedyPack(blanks: Blank[], stocks: StockChoice[], kerf: number): OpenBoard[] {
  const ordered = [...blanks].sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  const boards: OpenBoard[] = [];
  for (const blank of ordered) {
    let best: { board: OpenBoard; freeIndex: number; pw: number; ph: number; rotated: boolean } | null = null;
    for (const board of boards) {
      const spot = bestSpot(board, blank);
      if (!spot) continue;
      best = { board, ...spot };
      break;
    }
    if (!best) {
      const stock = largestFittingStock(blank, stocks);
      if (!stock) continue;
      const board: OpenBoard = { stock, free: [{ x: 0, y: 0, w: stock.width, h: stock.height }], placed: [] };
      const spot = bestSpot(board, blank);
      if (!spot) continue;
      boards.push(board);
      best = { board, ...spot };
    }
    commit(best.board, best.freeIndex, best.pw, best.ph, best.rotated, blank, kerf);
  }
  return boards;
}

/** Open the largest sheet this piece fits on. Smaller sheets are only for a leftover board. */
function largestFittingStock(blank: Rect, stocks: StockChoice[]): StockChoice | null {
  let best: StockChoice | null = null;
  let bestArea = -1;
  for (const stock of stocks) {
    if (!fitsStock(blank.w, blank.h, stock)) continue;
    const area = stock.width * stock.height;
    if (area > bestArea) {
      best = stock;
      bestArea = area;
    }
  }
  return best;
}

type Spot = { freeIndex: number; pw: number; ph: number; rotated: boolean; leftover: number; y: number; x: number };

function bestSpot(board: OpenBoard, blank: Rect): Spot | null {
  let best = null as Spot | null;
  board.free.forEach((free, freeIndex) => {
    for (const rotated of blank.w === blank.h || board.stock.grain ? [false] : [false, true]) {
      const pw = rotated ? blank.h : blank.w;
      const ph = rotated ? blank.w : blank.h;
      if (pw > free.w + 0.5 || ph > free.h + 0.5) continue;
      const leftover = free.w * free.h - pw * ph;
      const candidate = { freeIndex, pw, ph, rotated, leftover, y: free.y, x: free.x };
      if (
        !best ||
        leftover < best.leftover - 0.5 ||
        (Math.abs(leftover - best.leftover) <= 0.5 && (free.y < best.y - 0.5 || (Math.abs(free.y - best.y) <= 0.5 && free.x < best.x)))
      ) {
        best = candidate;
      }
    }
  });
  return best;
}

function commit(board: OpenBoard, freeIndex: number, pw: number, ph: number, rotated: boolean, blank: Blank, kerf: number) {
  const free = board.free[freeIndex];
  const x = free.x;
  const y = free.y;
  const remainW = free.w - pw;
  const remainH = free.h - ph;
  const next = board.free.filter((_, index) => index !== freeIndex);
  if (remainW > kerf) next.push({ x: x + pw + kerf, y, w: remainW - kerf, h: ph });
  if (remainH > kerf) next.push({ x: free.x, y: y + ph + kerf, w: free.w, h: remainH - kerf });
  board.free = next;
  board.placed.push({ ...blank, x, y, pw, ph, rotated });
}

function bestCover(w: number, h: number, stocks: StockChoice[], kerf: number, memo: Map<string, Rect[]>, depth = 0): Rect[] {
  w = Math.round(w);
  h = Math.round(h);
  const key = `${depth === 0 ? "top" : "sub"}:${w}x${h}`;
  const cached = memo.get(key);
  if (cached) return cached.map((rect) => ({ ...rect }));
  if (depth > 8) return [{ w, h }];
  // The piece itself stays whole when it fits a sheet, so the packer can put it on the largest one.
  // A join inside a bigger piece may still be divided, which is why this only applies at the top.
  const largestStock = stocks.reduce((best, stock) => (stock.width * stock.height > best.width * best.height ? stock : best), stocks[0]);
  const fillsLargest =
    largestStock !== undefined &&
    ((Math.abs(w - largestStock.width) <= 1 && Math.abs(h - largestStock.height) <= 1) ||
      (Math.abs(w - largestStock.height) <= 1 && Math.abs(h - largestStock.width) <= 1));
  if (fillsLargest || (depth === 0 && stocks.some((stock) => fitsStock(w, h, stock)))) {
    memo.set(key, [{ w, h }]);
    return [{ w, h }];
  }
  memo.set(key, [{ w, h }]);

  const candidates: Rect[][] = [];
  for (const stock of stocks) {
    for (const [cellW, cellH] of stock.grain
      ? ([[stock.width, stock.height]] as const)
      : ([
          [stock.width, stock.height],
          [stock.height, stock.width],
        ] as const)) {
      const grid = gridOf(w, h, cellW, cellH);
      if (grid) candidates.push(grid);
    }
  }
  const edges = stockEdges(stocks);
  if (edges.length) {
    for (const axis of ["w", "h"] as const) {
      const length = axis === "w" ? w : h;
      const cross = axis === "w" ? h : w;
      if (length <= Math.min(...edges)) continue;
      for (const parts of coverOptions(length, edges)) {
        if (parts.length < 2) continue;
        const rects = parts.flatMap((part) => {
          const pw = axis === "w" ? part : cross;
          const ph = axis === "w" ? cross : part;
          if (pw === w && ph === h) return [{ w, h }];
          return bestCover(pw, ph, stocks, kerf, memo, depth + 1);
        });
        candidates.push(rects);
      }
    }
  }

  let best = candidates[0] ?? [{ w, h }];
  let bestScore = scoreBoards(packBlanks(asBlanks(best), stocks, kerf), asBlanks(best), stocks);
  for (const candidate of candidates.slice(1)) {
    const blanks = asBlanks(candidate);
    const score = scoreBoards(packBlanks(blanks, stocks, kerf), blanks, stocks);
    if (compareScore(score, bestScore) < 0) {
      best = candidate;
      bestScore = score;
    }
  }
  const fitted = best.flatMap((rect) =>
    stocks.some((stock) => fitsStock(rect.w, rect.h, stock)) ? [rect] : forceSplit(rect, stocks, kerf, memo, depth),
  );
  memo.set(key, fitted);
  return fitted.map((rect) => ({ ...rect }));
}

function asBlanks(rects: Rect[]): Blank[] {
  return rects.map((rect) => ({ ...rect, partId: "", partName: "", detail: "" }));
}

function forceSplit(rect: Rect, stocks: StockChoice[], kerf: number, memo: Map<string, Rect[]>, depth: number): Rect[] {
  const edges = stockEdges(stocks).filter((edge) => edge < Math.max(rect.w, rect.h) - 0.5);
  const axis = rect.w >= rect.h ? "w" : "h";
  const length = axis === "w" ? rect.w : rect.h;
  const parts = coverOptions(length, edges).find((option) => option.length > 1);
  if (!parts || depth > 8) return [rect];
  return parts.flatMap((part) => {
    const pw = axis === "w" ? part : rect.w;
    const ph = axis === "w" ? rect.h : part;
    return bestCover(pw, ph, stocks, kerf, memo, depth + 1);
  });
}

function initials(name: string) {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const letters = words.map((word) => word[0] ?? "").join("").toUpperCase();
  return letters.slice(0, 4) || "P";
}

export function formatBoardSize(width: number, height: number) {
  const roundTenth = (mm: number) => mm >= 1000 && mm % 100 === 0;
  if (roundTenth(width) && roundTenth(height)) {
    const meters = (mm: number) => {
      const value = mm / 1000;
      return Number.isInteger(value) ? String(value) : value.toFixed(1);
    };
    return `${meters(width)} × ${meters(height)} m`;
  }
  return `${Math.round(width)} × ${Math.round(height)} mm`;
}

export function tallyText(group: MaterialCut) {
  const lines = group.tally.filter((line) => line.count > 0);
  if (!lines.length) return "No sheet";
  return lines
    .map((line) => {
      const noun = line.count === 1 ? "board" : "boards";
      return `${line.count} ${noun} of ${formatBoardSize(line.width, line.height)}`;
    })
    .join(" and ");
}

function toStock(material: CuttingMaterial): StockChoice | null {
  if (material.unit !== "board" || !material.boardWidthMm || !material.boardHeightMm) return null;
  return {
    id: material.id,
    name: material.name,
    width: material.boardWidthMm,
    height: material.boardHeightMm,
    priceCents: material.priceCents,
    suggested: false,
    thicknessMm: material.thicknessMm,
  };
}

function sameBlade(materialName: string, piece: PartMaterial, blade: BladeAdvice) {
  return bladeFor(piece, [materialName]).id === blade.id;
}

/** Painted pieces are cut from MDF when the price book has no painted board. A painted board, when there is one, still wins. */
export function materialsForPiece<T extends { piece: PartMaterial | null }>(materials: T[], piece: PartMaterial): T[] {
  const direct = materials.filter((material) => material.piece === piece);
  if (direct.length > 0 || piece !== "paint") return direct;
  return materials.filter((material) => material.piece === "mdf");
}

/** The thickness of the board a piece is cut from: its smallest dimension, or the wall of a hollow box. */
export function panelThicknessMm(part: ScenePart) {
  const flat = flatPiece(part);
  return Math.min(flat.width, flat.height, flat.depth);
}

/** The closer thickness. A tie takes the thicker board. */
export function nearestThickness(thicknesses: number[], target: number) {
  return thicknesses.reduce((best, value) => {
    const gap = Math.abs(value - target);
    const bestGap = Math.abs(best - target);
    if (gap < bestGap - 1e-6) return value;
    if (Math.abs(gap - bestGap) <= 1e-6 && value > best) return value;
    return best;
  });
}

/** Board thickness for a piece that does not name a sheet. Null when no candidate states a thickness. */
export function boardThicknessFor(part: ScenePart, candidates: { thicknessMm?: number }[]): number | null {
  const known = [...new Set(candidates.flatMap((item) => (item.thicknessMm === undefined ? [] : [item.thicknessMm])))];
  if (known.length === 0) return null;
  const panel = panelThicknessMm(part);
  const target = panel <= THIN_PIECE_MM ? panel : nearestThickness(known, 18);
  return nearestThickness(known, target);
}

export function formatThicknessMm(mm: number) {
  return String(Math.round(mm * 1000) / 1000);
}

export type ThicknessMismatch = { panelMm: number; boardMm: number; label: string };

/** A thin piece more than 1.5 mm from every board of its material. Hollow boxes and named sheets are left out. */
export function thicknessMismatch(part: ScenePart, materials: CuttingMaterial[]): ThicknessMismatch | null {
  if (part.materialId || equipmentKind(part)) return null;
  const piece = part.material ?? "paint";
  const blade = bladeFor(piece, [part.name, part.sourceMaterial ?? "", part.label ?? ""]);
  const family = materialsForPiece(materials, piece).filter((material) => sameBlade(material.name, piece, blade));
  if (family.length === 0 || family.some((material) => material.thicknessMm === undefined)) return null;
  const panelMm = panelThicknessMm(part);
  if (panelMm > THIN_PIECE_MM) return null;
  const boardMm = nearestThickness(
    family.map((material) => material.thicknessMm ?? 0),
    panelMm,
  );
  if (Math.abs(panelMm - boardMm) <= 1.5) return null;
  const stock = family.find((material) => material.piece)?.piece ?? piece;
  return { panelMm, boardMm, label: PIECE_LABEL[stock] };
}

export function buildCuttingPlan(parts: ScenePart[], materials: CuttingMaterial[]): CuttingPlan {
  const work = parts.filter((part) => !equipmentKind(part));
  const byId = new Map(materials.map((material) => [material.id, material]));
  const buckets = new Map<string, { key: string; piece: PartMaterial; blade: BladeAdvice; parts: ScenePart[]; row: CuttingMaterial | null; thickness: number | null }>();
  for (const part of work) {
    const piece = part.material ?? "paint";
    const row = (part.materialId && byId.get(part.materialId)) || null;
    if (row) {
      const blade = bladeFor(row.piece ?? piece, [row.name]);
      const key = `row:${row.id}`;
      const bucket = buckets.get(key) ?? { key, piece, blade, parts: [], row, thickness: null };
      bucket.parts.push(part);
      buckets.set(key, bucket);
      continue;
    }
    const blade = bladeFor(piece, [part.name, part.sourceMaterial ?? "", part.label ?? ""]);
    const candidates = materialsForPiece(materials, piece).filter((material) => sameBlade(material.name, piece, blade));
    const thickness = boardThicknessFor(part, candidates);
    const key = thickness === null ? `${piece}:${blade.id}` : `${piece}:${blade.id}:${formatThicknessMm(thickness)}`;
    const bucket = buckets.get(key) ?? { key, piece, blade, parts: [], row: null, thickness };
    bucket.parts.push(part);
    buckets.set(key, bucket);
  }

  const groups: MaterialCut[] = [];
  for (const { key, piece, blade: sawBlade, parts: used, row, thickness } of buckets.values()) {
    const family = row ? [row] : materialsForPiece(materials, piece).filter((material) => sameBlade(material.name, piece, sawBlade));
    const matching = family.filter((material) => thickness === null || material.thicknessMm === undefined || material.thicknessMm === thickness);
    const source = matching.find((material) => material.unit === "board") ?? matching[0];
    const cutter = source ? (source.cutter ?? defaultCutter(source)) : sawBlade.id === "acrylic" ? "laser" : "saw";
    const thickest = Math.max(1, ...used.map((part) => Math.min(part.width, part.height, part.depth)));
    const blade = cutWith(sawBlade, cutter, piece, source?.thicknessMm ?? thickest);
    const grain = source ? (source.grain ?? defaultGrain(source)) : false;
    const margin = Math.max(0, source?.edgeMarginMm ?? defaultEdgeMargin(cutter));
    const boardStocks = matching.flatMap((material) => {
      const stock = toStock(material);
      return stock ? [stock] : [];
    });
    const meter = matching.find((material) => material.unit === "m2") ?? null;
    const soldByM2 = boardStocks.length === 0 && meter !== null;
    const sheets = boardStocks.length > 0 ? boardStocks : suggestedStocks(piece, blade);
    const fullSheet = new Map(sheets.map((stock) => [stock.id, stock]));
    // Pieces are packed on the sheet less its margin, then moved in by the margin.
    const stocks = sheets.map((stock) => ({ ...stock, width: stock.width - 2 * margin, height: stock.height - 2 * margin, ...(grain ? { grain: true } : {}) }));
    const suggested = boardStocks.length === 0;
    const kerf = blade.kerfMm;
    const memo = new Map<string, Rect[]>();
    const blanks: Blank[] = [];
    const oversize: string[] = [];
    let areaMm2 = 0;
    for (const part of used) {
      const faces = facesOf(part);
      const largest = faces.reduce((best, face) => (face.w * face.h > best.w * best.h ? face : best), faces[0]);
      if (largest && !stocks.some((stock) => fitsStock(largest.w, largest.h, stock))) oversize.push(part.name);
      for (const face of faces) {
        areaMm2 += face.w * face.h;
        const covered = bestCover(face.w, face.h, stocks, kerf, memo);
        const joins = covered.length > 1;
        covered.forEach((rect, index) => {
          const whole = !joins && Math.abs(rect.w - face.w) <= 0.5 && Math.abs(rect.h - face.h) <= 0.5;
          blanks.push({
            ...rect,
            partId: part.id,
            partName: part.name,
            detail: face.detail,
            joinIndex: joins ? index + 1 : undefined,
            joinCount: joins ? covered.length : undefined,
            ...(whole && face.shape ? { shape: face.shape } : {}),
          });
        });
      }
    }
    const open = packBlanks(pairShaped(blanks, stocks, kerf), stocks, kerf).map((board) => ({
      stock: fullSheet.get(board.stock.id) ?? board.stock,
      free: board.free.map((free) => ({ ...free, x: free.x + margin, y: free.y + margin })),
      placed: board.placed.flatMap(unpair).map((piece) => ({ ...piece, x: piece.x + margin, y: piece.y + margin })),
    }));
    const codes = new Map<string, string>();
    const seen = new Map<string, number>();
    for (const part of used) {
      const base = initials(part.name);
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      codes.set(part.id, count === 1 ? base : `${base}${count}`);
    }
    const fillOf = new Map<string, string>();
    used.forEach((part, index) => fillOf.set(part.id, FILLS[index % FILLS.length]));

    const boards: CutBoard[] = open.map((board) => {
      const pieces: PlacedPiece[] = board.placed.map((piece, index) => ({
        id: `${piece.partId}-${index}-${piece.x}-${piece.y}`,
        partId: piece.partId,
        partName: piece.partName,
        code: codes.get(piece.partId) ?? "P",
        width: piece.w,
        height: piece.h,
        fill: fillOf.get(piece.partId) ?? FILLS[0],
        joinIndex: piece.joinIndex,
        joinCount: piece.joinCount,
        detail: piece.detail,
        ...(piece.shape ? { shape: piece.shape } : {}),
        x: piece.x,
        y: piece.y,
        rotated: piece.rotated,
        ...(piece.flipped ? { flipped: true } : {}),
        ...(piece.nested ? { nested: true } : {}),
      }));
      const usedArea = pieces.reduce((sum, piece) => sum + pieceArea(piece), 0);
      const boardArea = board.stock.width * board.stock.height;
      return {
        stock: board.stock,
        number: 0,
        total: 0,
        pieces,
        offcuts: board.free
          .filter((free) => free.w >= 40 && free.h >= 40 && free.w * free.h >= 20_000)
          .map((free) => ({ x: free.x, y: free.y, width: free.w, height: free.h })),
        usedPercent: boardArea > 0 ? Math.round((usedArea / boardArea) * 100) : 0,
      };
    });
    boards.forEach((board, index) => {
      board.number = index + 1;
      board.total = boards.length;
    });

    const tally: TallyLine[] = sheets
      .map((stock) => {
        const count = boards.filter((board) => board.stock.id === stock.id).length;
        return { ...stock, count, totalCents: stock.priceCents === null ? null : count * stock.priceCents };
      })
      .filter((line) => line.count > 0)
      .sort((a, b) => b.width * b.height - a.width * a.height);

    const bought = boards.reduce((sum, board) => sum + board.stock.width * board.stock.height, 0);
    const cut = boards.reduce((sum, board) => sum + board.pieces.reduce((area, piece) => area + pieceArea(piece), 0), 0);
    const realNames = boardStocks.map((stock) => stock.name);
    const label = PIECE_LABEL[matching.find((material) => material.piece)?.piece ?? piece];
    const title = row
      ? row.name
      : !suggested && realNames.length === 1
        ? realNames[0]
        : !suggested
          ? `${label} boards${thickness === null ? "" : `, ${formatThicknessMm(thickness)} mm`}`
          : `Suggested ${PIECE_LABEL[piece].toLowerCase()} sheets`;
    const suggestionNote = suggested
      ? soldByM2
        ? `You buy ${meter?.name ?? PIECE_LABEL[piece]} by the square meter, so the price stays in m². These sheet sizes are a cutting guide — add a board size in Materials if the supplier sells a fixed sheet.`
        : "These sheet sizes are not in Materials. Add each size there, with its price, and the next plan will buy from your list."
      : boardStocks.length > 1
        ? "Sizes and prices come from Materials. Pieces go on the largest sheet they fit. A smaller sheet is only used when the leftover fits on it instead of another large sheet."
        : null;

    groups.push({
      id: key,
      piece,
      title,
      blade,
      boards,
      tally,
      usedPercent: bought > 0 ? Math.round((cut / bought) * 100) : 0,
      soldByM2,
      meterId: soldByM2 ? (meter?.id ?? null) : null,
      suggested,
      suggestionNote,
      partIds: used.map((part) => part.id),
      oversize,
      areaM2: areaMm2 / 1_000_000,
    });
  }

  const blades = [...new Set(groups.map((group) => group.blade.title))];
  return { groups, bladeSummary: blades.length === 1 ? blades[0] : null };
}
