import { seedCatalog } from "../systems/catalog";
import { applyCosting, readCosting, type Costing, type CostLine } from "../systems/costing";
import type { PriceBook } from "../systems/materials";
import { produceDesign } from "../systems/modular/produce";
import type { DesignDocument } from "../systems/modular/schema";
import { clientSections, quoteTotals, sectionCostCents, type QuoteSection } from "../systems/sections";

/** Sections for the PDF. A price the user typed stays. An older cost-type layout is rebuilt into items. */
export function sectionsForQuote(document: DesignDocument, costing: Costing, lines: CostLine[], marginPercent: number): QuoteSection[] {
  return clientSections(document, lines, marginPercent, costing.quote, costing.sections);
}

export function quotationFigures(document: DesignDocument, costingInput: unknown, book: PriceBook, marginPercent: number) {
  const costing = readCosting(costingInput);
  const lines = applyCosting(produceDesign(document, seedCatalog(), book).lines, costing).lines;
  const sections = sectionsForQuote(document, costing, lines, marginPercent);
  const costCents = sections.reduce((sum, section) => sum + sectionCostCents(section, lines), 0);
  return { costing, lines, sections, costCents, ...quoteTotals(sections, costing.quote.vatPercent) };
}
