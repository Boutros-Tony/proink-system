import { formatBoardSize, labelPoint, shapeOnBoard, type CuttingPlan, type MaterialCut, type PlacedPiece } from "./cutting";

const BOARD_GAP = 200;

/** ASCII DXF R12 of one material's sheets, in millimetres, for a CNC or laser. */
export function cuttingDxf(group: MaterialCut): string {
  const lines: string[] = [
    "0",
    "SECTION",
    "2",
    "HEADER",
    "9",
    "$ACADVER",
    "1",
    "AC1009",
    "9",
    "$INSUNITS",
    "70",
    "4",
    "0",
    "ENDSEC",
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "TABLE",
    "2",
    "LTYPE",
    "70",
    "1",
    "0",
    "LTYPE",
    "2",
    "CONTINUOUS",
    "70",
    "0",
    "3",
    "Solid line",
    "72",
    "65",
    "73",
    "0",
    "40",
    "0.0",
    "0",
    "ENDTAB",
    "0",
    "TABLE",
    "2",
    "LAYER",
    "70",
    "4",
  ];
  layer(lines, "SHEET", 8);
  layer(lines, "CUT", 1);
  layer(lines, "HOLES", 5);
  layer(lines, "LABELS", 7);
  lines.push("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");

  let originX = 0;
  for (const board of group.boards) {
    const { width, height } = board.stock;
    const toDxf = (x: number, y: number): [number, number] => [originX + x, height - y];
    polyline(lines, "SHEET", [
      toDxf(0, 0),
      toDxf(width, 0),
      toDxf(width, height),
      toDxf(0, height),
    ]);
    text(lines, originX, -60, 40, `Board ${board.number} of ${board.total} · ${formatBoardSize(width, height)} · ${group.title}`, false);
    for (const piece of board.pieces) drawPiece(lines, piece, toDxf);
    originX += width + BOARD_GAP;
  }

  lines.push("0", "ENDSEC", "0", "EOF");
  return lines.join("\n");
}

/** One DXF per material that has sheets. Names are slugs, and a repeated slug gets -2, -3. */
export function cuttingDxfFiles(plan: CuttingPlan): { name: string; text: string }[] {
  const used = new Set<string>();
  const files: { name: string; text: string }[] = [];
  for (const group of plan.groups) {
    if (group.boards.length === 0) continue;
    const base = slug(group.title);
    let name = `${base}.dxf`;
    let extra = 2;
    while (used.has(name)) {
      name = `${base}-${extra}.dxf`;
      extra += 1;
    }
    used.add(name);
    files.push({ name, text: cuttingDxf(group) });
  }
  return files;
}

function drawPiece(lines: string[], piece: PlacedPiece, toDxf: (x: number, y: number) => [number, number]) {
  const shape = shapeOnBoard(piece);
  if (shape) {
    polyline(lines, "CUT", shape.outer.map(([x, y]) => toDxf(x, y)));
    for (const hole of shape.holes) polyline(lines, "HOLES", hole.map(([x, y]) => toDxf(x, y)));
  } else if (!piece.nested) {
    const pw = piece.rotated ? piece.height : piece.width;
    const ph = piece.rotated ? piece.width : piece.height;
    polyline(lines, "CUT", [
      toDxf(piece.x, piece.y),
      toDxf(piece.x + pw, piece.y),
      toDxf(piece.x + pw, piece.y + ph),
      toDxf(piece.x, piece.y + ph),
    ]);
  }
  const [x, y] = labelPoint(piece);
  const [lx, ly] = toDxf(x, y);
  text(lines, lx, ly, 30, piece.code, true);
}

function polyline(lines: string[], layerName: string, points: Array<[number, number]>) {
  if (points.length < 3) return;
  lines.push("0", "POLYLINE", "8", layerName, "66", "1", "10", "0.00", "20", "0.00", "30", "0.00", "70", "1");
  for (const [x, y] of points) lines.push("0", "VERTEX", "8", layerName, "10", num(x), "20", num(y), "30", "0.00");
  lines.push("0", "SEQEND", "8", layerName);
}

function text(lines: string[], x: number, y: number, height: number, value: string, centred: boolean) {
  lines.push("0", "TEXT", "8", "LABELS", "10", num(x), "20", num(y), "40", num(height), "1", ascii(value));
  if (centred) lines.push("72", "1", "11", num(x), "21", num(y), "73", "2");
}

function layer(lines: string[], name: string, color: number) {
  lines.push("0", "LAYER", "2", name, "70", "0", "62", String(color), "6", "CONTINUOUS");
}

function num(value: number) {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function ascii(value: string) {
  return value.replaceAll("·", "-").replaceAll("×", "x").replace(/[^\x20-\x7E]/g, "");
}

function slug(title: string) {
  const stem = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
  return stem || "boards";
}
