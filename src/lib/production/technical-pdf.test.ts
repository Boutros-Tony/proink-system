import { describe, expect, it } from "vitest";
import { seedCatalog } from "../systems/catalog";
import { pieceSchedule, technicalSvg } from "../systems/modular/drawings";
import { compileDesign } from "../systems/modular/compile";
import { createEmptyDesign } from "../systems/modular/patch";
import { produceDesign } from "../systems/modular/produce";
import type { DesignDocument, ScenePart } from "../systems/modular/schema";
import { buildTechnicalPdf } from "./technical-pdf";

function board(id: string, name: string, x: number, width: number, height: number): ScenePart {
  return { id, name, shape: "box", x, y: 0, z: 0, width, height, depth: 18, material: "mdf" };
}

function stand(): DesignDocument {
  return {
    ...createEmptyDesign(),
    parts: [
      board("back", "Back wall", 0, 3000, 2500),
      board("s1", "Shelf 1", 200, 800, 18),
      board("s2", "Shelf 2", 1200, 800, 18),
      board("s3", "Shelf 3", 2200, 800, 18),
      { id: "pole", name: "Pole", shape: "cylinder", x: 0, y: 0, z: 400, width: 60, height: 2400, depth: 60, material: "metal" },
    ],
  };
}

describe("technical file", () => {
  it("lists the same piece once with its count", () => {
    const rows = pieceSchedule(stand().parts);
    expect(rows.map((row) => [row.name, row.parts.length])).toEqual([
      ["Back wall", 1],
      ["Shelf", 3],
      ["Pole", 1],
    ]);
    expect(rows[2].size).toBe("Ø 60 × 2400");
  });

  it("keeps the drawing to the overall sizes and the piece list", () => {
    const document = stand();
    const svg = technicalSvg(document, compileDesign(document));
    expect(svg).not.toContain(">X<");
    expect(svg).toContain("Size W × D × H (mm)");
    expect(technicalSvg(document, compileDesign(document), { bare: true })).not.toContain("PIECES");
  });

  it("writes one PDF with the drawing, pieces, board sheets, and notes", async () => {
    const document = stand();
    const production = produceDesign(document, seedCatalog());
    const pdf = await buildTechnicalPdf({ document, production, jobTitle: "Test stand", clientName: "Client", artwork: [], issuedAt: new Date(2026, 10, 15) });
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF")).toBe(true);
    const pages = text.match(/\/Type \/Page\b/g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(4);
  });
});
