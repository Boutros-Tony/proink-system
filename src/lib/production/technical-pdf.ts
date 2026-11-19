import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";
import { constraintNumber, findSku, LIMIT_DEFAULTS, seedCatalog, SKU } from "../systems/catalog";
import { compileDesign } from "../systems/modular/compile";
import { assemblyNotes, elevationSvg, pieceSchedule, planSvg, technicalSvg } from "../systems/modular/drawings";
import { imageLayout } from "../systems/modular/images";
import type { ProductionResult } from "../systems/modular/produce";
import { EDGES, type DesignDocument } from "../systems/modular/schema";
import { cuttingGroupSvg } from "./cutting-svg";

/** A picture from the browser's library, sent along so the file can show what is printed where. */
export type ArtworkFile = { id: string; name: string; dataUrl: string; width: number; height: number };

export type TechnicalInput = {
  document: DesignDocument;
  production: ProductionResult;
  jobTitle: string;
  clientName: string;
  artwork: ArtworkFile[];
  issuedAt?: Date;
};

type Column = { label: string; width: number; align?: "left" | "right" };

const INK = "#1a1814";
const MUTED = "#6b6560";
const RED = "#e10600";
const MARGIN = 36;
const BOARDS_PER_PAGE = 6;

function toBuffer(doc: PDFKit.PDFDocument) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

function bareSvg(markup: string) {
  return markup.replace(/^<\?xml[^>]*>\s*/, "");
}

function svgSize(markup: string) {
  const match = markup.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 1, height: 1 };
}

/**
 * The workshop's technical file, one PDF on A3 landscape: the drawing with its overall sizes, the piece list,
 * the board sheets as they are cut, what to buy, the print files, and how it goes together. No prices.
 */
export async function buildTechnicalPdf(input: TechnicalInput) {
  const { document, production } = input;
  const doc = new PDFDocument({ size: "A3", layout: "landscape", margin: MARGIN, bufferPages: true, info: { Title: `${input.jobTitle} technical file`, Author: "Proink" } });
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const contentW = pageW - MARGIN * 2;
  const bottom = pageH - MARGIN - 24;
  const issued = input.issuedAt ?? new Date();
  const date = issued.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const model = compileDesign(document);
  const hasBooth = document.walls.some((wall) => wall.bays.length > 0);
  const schedule = pieceSchedule(document.parts);
  let first = true;

  /** A new page with its sheet title. Returns the y where the content starts. */
  const sheet = (title: string, detail = "") => {
    if (!first) doc.addPage();
    first = false;
    doc.font("Helvetica-Bold").fontSize(16).fillColor(INK).text(title, MARGIN, MARGIN, { lineBreak: false });
    if (detail) doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(detail, MARGIN, MARGIN + 22, { width: contentW * 0.6 });
    const job = [input.jobTitle, input.clientName].filter(Boolean).join(" · ");
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text("PROINK", MARGIN, MARGIN, { width: contentW, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`${job} · ${date}`, MARGIN, MARGIN + 15, { width: contentW, align: "right" });
    doc.moveTo(MARGIN, MARGIN + 44).lineTo(pageW - MARGIN, MARGIN + 44).lineWidth(0.6).strokeColor("#d4d0c8").stroke();
    return MARGIN + 58;
  };

  const drawing = (markup: string, top: number, box = { x: MARGIN, w: contentW, h: bottom - top }) => {
    const size = svgSize(markup);
    const scale = Math.min(box.w / size.width, box.h / size.height);
    const width = size.width * scale;
    const height = size.height * scale;
    SVGtoPDF(doc, bareSvg(markup), box.x + (box.w - width) / 2, top, { width, height, preserveAspectRatio: "xMidYMid meet", assumePt: true });
    return top + height;
  };

  const table = (title: string, detail: string, columns: Column[], rows: string[][]) => {
    let y = sheet(title, detail);
    const header = () => {
      let x = MARGIN;
      doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED);
      for (const column of columns) {
        doc.text(column.label, x + 6, y, { width: column.width - 12, align: column.align ?? "left", lineBreak: false });
        x += column.width;
      }
      y += 18;
      doc.moveTo(MARGIN, y - 4).lineTo(MARGIN + contentW, y - 4).lineWidth(0.6).strokeColor("#d4d0c8").stroke();
    };
    header();
    rows.forEach((row, index) => {
      doc.font("Helvetica").fontSize(10);
      const tall = Math.max(16, ...row.map((cell, cellIndex) => doc.heightOfString(cell, { width: columns[cellIndex].width - 12 }))) + 6;
      if (y + tall > bottom) {
        y = sheet(`${title} (continued)`);
        header();
      }
      if (index % 2 === 0) doc.rect(MARGIN, y - 3, contentW, tall).fill("#f7f5f2");
      let x = MARGIN;
      row.forEach((cell, cellIndex) => {
        doc.font(cellIndex === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(10).fillColor(INK).text(cell, x + 6, y, { width: columns[cellIndex].width - 12, align: columns[cellIndex].align ?? "left" });
        x += columns[cellIndex].width;
      });
      y += tall;
    });
    return y;
  };

  const share = (fractions: number[]) => fractions.map((fraction) => contentW * fraction);

  // 1. The drawing.
  if (document.parts.length === 0 && !hasBooth) {
    const y = sheet("Technical drawing");
    doc.font("Helvetica").fontSize(12).fillColor(MUTED).text("Nothing has been drawn yet.", MARGIN, y);
    return toBuffer(doc);
  }
  {
    const { width, depth, height } = document.envelope;
    const top = sheet("Technical drawing", `Overall ${Math.round(width)} × ${Math.round(depth)} × ${Math.round(height)} mm. The circled numbers are the pieces on the next page. All sizes in millimetres.`);
    drawing(technicalSvg(document, model, { bare: true }), top);
  }

  // 2. The pieces.
  if (schedule.length > 0) {
    const widths = share([0.06, 0.4, 0.16, 0.3, 0.08]);
    table(
      "Pieces",
      `${document.parts.filter((part) => !part.hidden).length} pieces. The same piece made more than once is on one line with its count.`,
      [
        { label: "No.", width: widths[0] },
        { label: "Piece", width: widths[1] },
        { label: "Material", width: widths[2] },
        { label: "Size W × D × H (mm)", width: widths[3] },
        { label: "Qty", width: widths[4], align: "right" },
      ],
      schedule.map((row) => [String(row.mark), row.name, row.material, row.size, String(row.parts.length)]),
    );
  }

  // 3. The modular frame, when there is one.
  if (hasBooth) {
    const top = sheet("Booth plan", `${document.envelope.width} × ${document.envelope.depth} mm, module ${document.module} mm.`);
    drawing(planSvg(document, model), top);
    const edges = EDGES.filter((edge) => document.walls.find((wall) => wall.edge === edge)?.bays.length);
    if (edges.length > 0) {
      const y = sheet("Booth walls");
      const cellW = (contentW - 24) / 2;
      const cellH = (bottom - y - 24) / 2;
      edges.forEach((edge, index) => {
        const x = MARGIN + (index % 2) * (cellW + 24);
        const top = y + Math.floor(index / 2) * (cellH + 24);
        drawing(elevationSvg(document, edge), top, { x, w: cellW, h: cellH });
      });
    }
    if (production.panels.length > 0) {
      const widths = share([0.2, 0.2, 0.25, 0.35]);
      table(
        "Booth panels",
        "",
        [
          { label: "Bay", width: widths[0] },
          { label: "Kind", width: widths[1] },
          { label: "Size (mm)", width: widths[2] },
          { label: "Finish", width: widths[3] },
        ],
        production.panels.map((panel) => [`${panel.edge} ${panel.bayIndex + 1}`, panel.kind, `${panel.widthMm} × ${panel.heightMm}`, panel.finish || "—"]),
      );
    }
    if (production.cuts.length > 0) {
      const widths = share([0.5, 0.3, 0.2]);
      table(
        "Frame profiles",
        `${production.bars} bars of ${production.stockLengthMm} mm.`,
        [
          { label: "Profile", width: widths[0] },
          { label: "Length (mm)", width: widths[1] },
          { label: "Qty", width: widths[2], align: "right" },
        ],
        production.cuts.map((cut) => [cut.part, String(cut.lengthMm), String(cut.quantity)]),
      );
    }
  }

  // 4. Board sheets, a few boards to a page so the codes stay readable.
  for (const group of production.cutting.groups) {
    if (group.boards.length === 0) continue;
    for (let start = 0; start < group.boards.length; start += BOARDS_PER_PAGE) {
      const boards = group.boards.slice(start, start + BOARDS_PER_PAGE);
      const range = group.boards.length > BOARDS_PER_PAGE ? ` · boards ${start + 1}–${start + boards.length} of ${group.boards.length}` : "";
      const top = sheet(`Board sheets · ${group.title}`, `Each board as it is cut. The code on a piece is its part.${range}`);
      drawing(cuttingGroupSvg(group, boards), top);
    }
  }

  // 5. What to buy.
  if (production.materials.length > 0) {
    const widths = share([0.36, 0.1, 0.14, 0.16, 0.12, 0.12]);
    table(
      "Materials to buy",
      "Quantities only. Prices are in the quotation.",
      [
        { label: "Material", width: widths[0] },
        { label: "Pieces", width: widths[1], align: "right" },
        { label: "Area (m²)", width: widths[2], align: "right" },
        { label: "To buy with waste (m²)", width: widths[3], align: "right" },
        { label: "Quantity", width: widths[4], align: "right" },
        { label: "Board", width: widths[5] },
      ],
      production.materials.map((usage) => [
        usage.name,
        String(usage.pieces),
        usage.areaM2.toFixed(2),
        usage.buyM2.toFixed(2),
        `${usage.quantity} ${usage.unit === "board" ? (usage.quantity === 1 ? "board" : "boards") : "m²"}`,
        usage.boardSize ?? "—",
      ]),
    );
  }

  // 6. Print files: every picture on every piece, at its printed size.
  const library = new Map(input.artwork.map((file) => [file.id, file]));
  const prints = document.parts.flatMap((part) =>
    (part.images ?? []).map((image) => {
      const file = library.get(image.assetId);
      const layout = imageLayout(part, image, file && file.height > 0 ? file.width / file.height : 1);
      return { part: part.name, face: layout.face, width: Math.round(layout.width), height: Math.round(layout.height), file };
    }),
  );
  const bleed = constraintNumber(findSku(seedCatalog(), SKU.print), "bleedMm", LIMIT_DEFAULTS.bleedMm);
  const boothPrints = production.panels.filter((panel) => panel.kind === "graphic" || panel.kind === "lightbox");
  if (prints.length > 0 || boothPrints.length > 0) {
    let y = sheet("Print files", boothPrints.length > 0 ? `Booth graphics include ${bleed} mm bleed on each edge.` : "Printed size of each picture on its piece.");
    const rowH = 74;
    const row = (picture: ArtworkFile | undefined, title: string, detail: string) => {
      if (y + rowH > bottom) y = sheet("Print files (continued)");
      doc.rect(MARGIN, y, 64, 64).lineWidth(0.6).strokeColor("#d4d0c8").stroke();
      if (picture) {
        try {
          const comma = picture.dataUrl.indexOf(",");
          doc.image(Buffer.from(picture.dataUrl.slice(comma + 1), "base64"), MARGIN + 2, y + 2, { fit: [60, 60], align: "center", valign: "center" });
        } catch {
          doc.font("Helvetica").fontSize(8).fillColor(MUTED).text("No preview", MARGIN + 4, y + 26, { width: 56, align: "center" });
        }
      }
      doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(title, MARGIN + 80, y + 10, { width: contentW - 80 });
      doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(detail, MARGIN + 80, y + 30, { width: contentW - 80 });
      y += rowH;
    };
    for (const print of prints) row(print.file, `${print.part} · ${print.face}`, `Print ${print.width} × ${print.height} mm · ${print.file ? print.file.name : "picture not supplied"}`);
    for (const panel of boothPrints) row(undefined, `Booth ${panel.edge} bay ${panel.bayIndex + 1} · ${panel.kind}`, `Print ${panel.widthMm + bleed * 2} × ${panel.heightMm + bleed * 2} mm with bleed · ${panel.graphicAssetId || "artwork missing"}`);
  }

  // 7. How it goes together.
  {
    const y = sheet("Assembly notes");
    doc.font("Helvetica").fontSize(11).fillColor(INK).text(assemblyNotes(document), MARGIN, y, { width: contentW * 0.7, lineGap: 4 });
  }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // Writing below the bottom margin would start a new page.
    doc.page.margins.bottom = 0;
    const footerY = pageH - MARGIN - 10;
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(`Proink technical file · ${input.jobTitle}`, MARGIN, footerY, { width: contentW / 2, lineBreak: false });
    doc.fillColor(RED).text(`Page ${index + 1} of ${range.count}`, MARGIN + contentW / 2, footerY, { width: contentW / 2, align: "right", lineBreak: false });
  }
  return toBuffer(doc);
}
