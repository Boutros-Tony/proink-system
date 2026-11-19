import { describe, expect, it } from "vitest";
import { cuttingDxf, cuttingDxfFiles } from "./dxf";
import type { CutBoard, CuttingPlan, MaterialCut, PlacedPiece, StockChoice } from "./cutting";

function stock(width: number, height: number): StockChoice {
  return { id: `${width}x${height}`, name: "Sheet", width, height, priceCents: 1000, suggested: false };
}

function piece(overrides: Partial<PlacedPiece> & Pick<PlacedPiece, "id" | "code" | "width" | "height" | "x" | "y" | "rotated">): PlacedPiece {
  return { partId: overrides.id, partName: overrides.code, fill: "#d7e3ff", detail: "", ...overrides };
}

function board(number: number, total: number, sheet: StockChoice, pieces: PlacedPiece[]): CutBoard {
  return { stock: sheet, number, total, pieces, offcuts: [], usedPercent: 0 };
}

function group(title: string, boards: CutBoard[]): MaterialCut {
  return {
    id: title || "empty",
    piece: "mdf",
    title,
    blade: { id: "panel", kerfMm: 4, title: "Panel-saw blade, 4 mm", detail: "Carbide blade." },
    boards,
    tally: [],
    usedPercent: 0,
    soldByM2: false,
    meterId: null,
    suggested: false,
    suggestionNote: null,
    partIds: [],
    oversize: [],
    areaM2: 0,
  };
}

describe("cutting dxf", () => {
  const sheet = stock(1220, 2440);
  const rect = piece({ id: "rect", code: "R", width: 200, height: 100, x: 0, y: 0, rotated: false });
  const turned = piece({ id: "turned", code: "T", width: 400, height: 150, x: 500, y: 10, rotated: true });
  const shaped = piece({
    id: "shaped",
    code: "S",
    width: 100,
    height: 100,
    x: 10,
    y: 1200,
    rotated: false,
    shape: {
      outer: [
        [0, 0],
        [100, 0],
        [100, 100],
        [0, 100],
      ],
      holes: [
        [
          [20, 20],
          [80, 20],
          [80, 80],
          [20, 80],
        ],
      ],
    },
  });
  const boards = [
    board(1, 2, sheet, [rect, turned, shaped]),
    board(2, 2, stock(1000, 1000), []),
  ];
  const cut = group("Oak · veneer", boards);

  it("writes an R12 drawing with the sheet, the cuts, and the hole", () => {
    const text = cuttingDxf(cut);
    expect(text.startsWith("0\nSECTION\n2\nHEADER\n")).toBe(true);
    expect(text.endsWith("EOF")).toBe(true);
    expect(text).toContain("9\n$ACADVER\n1\nAC1009\n");
    expect(text).toContain("9\n$INSUNITS\n70\n4\n");
    expect(text).toContain("2\nSHEET\n70\n0\n62\n8\n");
    expect(text).toContain("2\nCUT\n70\n0\n62\n1\n");
    expect(text).toContain("2\nHOLES\n70\n0\n62\n5\n");
    expect(text).toContain("2\nLABELS\n70\n0\n62\n7\n");
    const polylines = text.match(/\nPOLYLINE\n/g) ?? [];
    expect(polylines).toHaveLength(2 + 2 + 1 + 1);
    expect(text).toContain("20\n2440.00\n");
    expect(text).toContain("20\n2340.00\n");
    expect(text).toContain("10\n650.00\n20\n2430.00\n");
    expect(text).toContain("10\n1420.00\n");
    expect(text).toContain("1\nBoard 1 of 2 - 1220 x 2440 mm - Oak - veneer\n");
    expect(text).toContain("1\nBoard 2 of 2 - 1 x 1 m - Oak - veneer\n");
    expect(text).toContain("1\nR\n72\n1\n11\n100.00\n21\n2390.00\n73\n2\n");
    expect(text).toContain("8\nHOLES\n10\n30.00\n20\n1160.00\n");
  });

  it("names one file per group and adds -2 when the slug repeats", () => {
    const plan: CuttingPlan = {
      groups: [
        group("MDF Boards", boards),
        group("MDF boards!!", boards),
        group("MDF boards", []),
        group("***", boards),
        group("A".repeat(70), boards),
      ],
      bladeSummary: null,
    };
    const files = cuttingDxfFiles(plan);
    expect(files.map((file) => file.name)).toEqual(["mdf-boards.dxf", "mdf-boards-2.dxf", "boards.dxf", `${"a".repeat(60)}.dxf`]);
    expect(files[0].text.startsWith("0\nSECTION\n2\nHEADER\n")).toBe(true);
  });
});
