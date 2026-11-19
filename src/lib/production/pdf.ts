import PDFDocument from "pdfkit";
import { formatCents } from "../format";
import { QUOTATION_FOOTER, quotationTerms, sectionMark, sectionSizeText, type QuoteMeta, type QuoteSection } from "../systems/sections";
import type { DesignDocument } from "../systems/modular/schema";

function toBuffer(doc: PDFKit.PDFDocument) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

export async function buildQuotationPdf(input: {
  ref: string;
  issuedAt: Date;
  jobTitle: string;
  clientName: string;
  document: DesignDocument;
  quote: QuoteMeta;
  sections: QuoteSection[];
  sellCents: number;
  vatCents: number;
  grandTotalCents: number;
}) {
  const doc = new PDFDocument({ size: "A4", margin: 42 });
  const red = "#e10600";
  const ink = "#1a1814";
  const left = 42;
  const width = 528;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = `${input.issuedAt.getDate()}-${months[input.issuedAt.getMonth()]}-${String(input.issuedAt.getFullYear()).slice(2)}`;

  const footer = () => {
    doc.font("Helvetica").fontSize(7).fillColor("#6b6560").text(QUOTATION_FOOTER, left, 760, { width, align: "center" });
  };
  const rule = (y: number) => doc.moveTo(left, y).lineTo(left + width, y).strokeColor("#1a1814").lineWidth(0.6).stroke();

  doc.circle(58, 58, 8).fill("#2f6fed");
  doc.circle(74, 50, 7).fill("#f5a524");
  doc.circle(62, 74, 8).fill("#1e4b9c");
  doc.circle(80, 70, 7).fill(red);
  doc.fillColor("#2c3a4a").font("Helvetica-Bold").fontSize(22).text("Proink", 96, 46, { lineBreak: false });
  doc.font("Helvetica").fontSize(8).fillColor("#8aa0b8").text("Your Partner For Growth", 96, 70, { lineBreak: false });
  doc.font("Helvetica").fontSize(9).fillColor(ink);
  doc.text("Date:", 400, 46, { width: 50, lineBreak: false });
  doc.text(date, 450, 46, { width: 120, align: "right" });
  doc.text("Ref :", 400, 60, { width: 50, lineBreak: false });
  doc.text(input.ref, 450, 60, { width: 120, align: "right" });

  doc.font("Helvetica-Bold").fontSize(12).text("QUOTATION", left, 100, { width, align: "center" });

  const boxTop = 122;
  doc.rect(left, boxTop, width, 58).strokeColor(ink).lineWidth(1).stroke();
  const rows: [string, string][] = [
    ["Client Name", input.clientName],
    ["Attention", input.quote.attention],
    ["Title", input.quote.title.trim() || input.jobTitle],
  ];
  rows.forEach(([label, value], index) => {
    const y = boxTop + 8 + index * 16;
    doc.font("Helvetica").fontSize(9).fillColor(ink).text(label, left + 8, y, { width: 78, lineBreak: false });
    doc.font("Helvetica-Bold").text(value || "—", left + 90, y, { width: 420 });
  });

  let y = boxTop + 74;
  doc.font("Helvetica").fontSize(9).fillColor(red).text("Selling Price", left, y, { width, align: "right" });
  y += 18;

  for (const [index, section] of input.sections.entries()) {
    if (y > 660) {
      footer();
      doc.addPage();
      y = 48;
    }
    const mark = sectionMark(input.sections, index);
    if (mark) doc.fillColor(red).font("Helvetica-Bold").fontSize(10).text(`ITEM ${mark}`, left + 8, y, { width: 70, lineBreak: false });
    doc.fillColor(ink).font("Helvetica").fontSize(10).text(section.title, left + 90, y, { width: 280 });
    doc.font("Helvetica-Bold").text(formatCents(section.sellCents), left + 390, y, { width: 130, align: "right" });
    const size = section.jobWide ? "" : sectionSizeText(input.document, section.partIds);
    y = Math.max(doc.y, y + 14);
    if (size) {
      doc.font("Helvetica").fontSize(9).fillColor(ink).text(size, left + 90, y, { width: 300 });
      y = doc.y + 10;
    } else {
      y += 8;
    }
  }

  if (input.quote.notes) {
    doc.font("Helvetica").fontSize(10).fillColor(ink).text(input.quote.notes, left + 90, y, { width: 360 });
    y = doc.y + 12;
  }
  doc.font("Helvetica-Bold").fontSize(10).fillColor(ink).text(`Production Time frame ${input.quote.productionDays} working days upon quotation approval`, left + 90, y, { width: 400 });
  y = doc.y + 18;

  const terms = quotationTerms(input.quote);
  const termsHeight = 16 + terms.length * 12 + 12;
  if (y + termsHeight > 740) {
    footer();
    doc.addPage();
    y = 48;
  }
  doc.rect(left, y, width, termsHeight).strokeColor(ink).lineWidth(1).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(ink).text("Terms & Conditions:", left + 8, y + 8, { lineBreak: false });
  terms.forEach((line, index) => {
    doc.font("Helvetica").fontSize(8).fillColor(ink).text(line, left + 8, y + 24 + index * 12, { width: 300 });
  });
  const totals: [string, string, boolean][] = [
    ["Total HTC in USD :", formatCents(input.sellCents), true],
    [`VAT ${input.quote.vatPercent}%`, formatCents(input.vatCents), false],
    ["Grand Total TTC in USD :", formatCents(input.grandTotalCents), true],
  ];
  totals.forEach(([label, value, accent], index) => {
    const row = y + 14 + index * 16;
    doc.font("Helvetica-Bold").fontSize(9).fillColor(accent ? red : ink).text(label, left + 300, row, { width: 130, align: "right", lineBreak: false });
    doc.fillColor(ink).text(value, left + 432, row, { width: 88, align: "right" });
  });

  footer();
  rule(752);
  return toBuffer(doc);
}
