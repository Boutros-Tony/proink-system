import { formatBoardSize, labelPoint, shapeOnBoard, tallyText, type CutBoard, type CuttingPlan, type MaterialCut, type PlacedPiece } from "./cutting";

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** One drawing of every sheet, the file the workshop cuts from. */
export function cuttingPlanSvg(plan: CuttingPlan) {
  const width = 1100;
  let y = 36;
  const chunks: string[] = [];
  chunks.push(
    `<text x="36" y="${y}" font-family="Helvetica" font-size="28" font-weight="700" fill="#1c1b18">Cutting plans</text>`,
  );
  if (plan.bladeSummary) {
    chunks.push(
      `<text x="${width - 36}" y="${y}" text-anchor="end" font-family="Helvetica" font-size="14" fill="#5c564c">${escapeXml(plan.bladeSummary)}</text>`,
    );
  }
  y += 28;
  chunks.push(
    `<text x="36" y="${y}" font-family="Helvetica" font-size="13" fill="#5c564c">Each board as the workshop cuts it. The code is the part. Red dashed lines are the cuts.</text>`,
  );
  y += 36;

  if (plan.groups.length === 0) {
    chunks.push(`<text x="36" y="${y + 12}" font-family="Helvetica" font-size="16" fill="#5c564c">Nothing to cut yet.</text>`);
    y += 48;
  }

  for (const group of plan.groups) {
    y = drawGroup(chunks, group, y, width);
  }

  const height = Math.max(y + 24, 240);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#f6f4ef"/>
  ${chunks.join("\n  ")}
</svg>`;
}

/** One material's sheets on their own drawing, for a page of the technical file. `boards` picks some of them. */
export function cuttingGroupSvg(group: MaterialCut, boards: CutBoard[] = group.boards) {
  const width = 1100;
  const chunks: string[] = [];
  const y = drawGroup(chunks, { ...group, boards }, 28, width);
  const height = Math.max(y, 240);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  ${chunks.join("\n  ")}
</svg>`;
}

function drawGroup(chunks: string[], group: MaterialCut, y: number, width: number) {
  chunks.push(`<text x="36" y="${y}" font-family="Helvetica" font-size="16" font-weight="700" fill="#1c1b18">${escapeXml(group.title)}</text>`);
  y += 20;
  chunks.push(
    `<text x="36" y="${y}" font-family="Helvetica" font-size="13" fill="#3f4a3a">${escapeXml(tallyText(group))} · ${group.usedPercent}% used</text>`,
  );
  y += 18;
  chunks.push(
    `<text x="36" y="${y}" font-family="Helvetica" font-size="12" fill="#5c564c">${escapeXml(`${group.blade.title}. ${group.blade.detail}`)}</text>`,
  );
  y += 16;
  if (group.suggestionNote) {
    const note = wrap(group.suggestionNote, 110);
    for (const line of note) {
      chunks.push(`<text x="36" y="${y}" font-family="Helvetica" font-size="12" fill="#8a5a12">${escapeXml(line)}</text>`);
      y += 16;
    }
  }
  y += 12;
  let x = 36;
  let rowHeight = 0;
  for (const board of group.boards) {
    const drawW = 320;
    const drawH = Math.max(120, Math.round((drawW * board.stock.height) / board.stock.width));
    const blockH = drawH + 36;
    if (x > 36 && x + drawW > width - 36) {
      x = 36;
      y += rowHeight + 28;
      rowHeight = 0;
    }
    drawBoard(chunks, board, x, y, drawW, drawH, group.blade.kerfMm > 0);
    rowHeight = Math.max(rowHeight, blockH);
    x += drawW + 28;
  }
  return y + rowHeight + 36;
}

function drawBoard(chunks: string[], board: CutBoard, x: number, y: number, drawW: number, drawH: number, saw: boolean) {
  const sx = drawW / board.stock.width;
  const sy = drawH / board.stock.height;
  chunks.push(`<rect x="${x}" y="${y}" width="${drawW}" height="${drawH}" fill="#e7e9ee" stroke="#1c1b18" stroke-width="1.5"/>`);
  for (const offcut of board.offcuts) {
    chunks.push(
      `<rect x="${x + offcut.x * sx}" y="${y + offcut.y * sy}" width="${offcut.width * sx}" height="${offcut.height * sy}" fill="#d7f0df"/>`,
    );
  }
  for (const piece of board.pieces) drawPiece(chunks, piece, x, y, sx, sy, saw);
  const caption = `Board ${board.number} of ${board.total} · ${formatBoardSize(board.stock.width, board.stock.height)} · ${board.usedPercent}% used`;
  chunks.push(
    `<text x="${x}" y="${y + drawH + 18}" font-family="Helvetica" font-size="12" fill="#1c1b18">${escapeXml(caption)}</text>`,
  );
}

function drawPiece(chunks: string[], piece: PlacedPiece, originX: number, originY: number, sx: number, sy: number, saw: boolean) {
  const pw = piece.rotated ? piece.height : piece.width;
  const ph = piece.rotated ? piece.width : piece.height;
  const x = originX + piece.x * sx;
  const y = originY + piece.y * sy;
  const w = pw * sx;
  const h = ph * sy;
  const dash = saw ? ` stroke="#c4374b" stroke-width="1.4" stroke-dasharray="5 4"` : ` stroke="#1c1b18" stroke-width="1"`;
  const join = piece.joinCount ? ` (${piece.joinIndex} of ${piece.joinCount})` : "";
  const detail = [piece.partName, piece.detail, piece.shape ? "shaped" : "", join.trim()].filter(Boolean).join(" · ");
  chunks.push(`<g><title>${escapeXml(`${piece.code} ${detail} — ${Math.round(piece.width)} × ${Math.round(piece.height)} mm`)}</title>`);
  if (!piece.nested) chunks.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${piece.shape ? "#f7f4ee" : piece.fill}"${dash}/>`);
  if (piece.shape) chunks.push(`<path d="${shapePath(piece, originX, originY, sx, sy)}" fill="${piece.fill}" fill-rule="evenodd"${piece.nested ? dash : ` stroke="#1c1b18" stroke-width="1.2"`}/>`);
  const [lx, ly] = labelPoint(piece);
  const cx = originX + lx * sx;
  const cy = originY + ly * sy;
  if (w > 36 && h > 22) {
    chunks.push(`<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-family="Helvetica" font-size="13" font-weight="700" fill="#1c1b18">${escapeXml(piece.code)}</text>`);
  }
  if (w > 70 && h > 42) {
    chunks.push(`<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-family="Helvetica" font-size="10" fill="#3d4450">${Math.round(piece.width)}×${Math.round(piece.height)}</text>`);
  }
  chunks.push(`</g>`);
}

function shapePath(piece: PlacedPiece, originX: number, originY: number, sx: number, sy: number) {
  const at = ([bx, by]: [number, number]) => `${Math.round((originX + bx * sx) * 100) / 100} ${Math.round((originY + by * sy) * 100) / 100}`;
  const shape = shapeOnBoard(piece)!;
  const ring = (points: [number, number][]) => `M ${points.map(at).join(" L ")} Z`;
  return [ring(shape.outer), ...shape.holes.map(ring)].join(" ");
}

function wrap(value: string, width: number) {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
