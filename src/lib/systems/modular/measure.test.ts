import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HOOK_BRIEF, hookStand } from "../../../../evals/cases/hook-stand";
import { createEmptyDesign } from "./patch";
import { measureStand } from "./measure";

/** Front of the sloped side at height y. Full 400 deep through 900, then back to 200 deep at 1600. */
function standFront(y: number) {
  if (y <= 900) return 400;
  return 400 - (200 * (y - 900)) / 700;
}

/** Largest overhang of a 300 mm hook (front at z 317) over the three sample heights. */
function worstOverhang(bottom: number) {
  const samples = [bottom + 1, bottom + 20, bottom + 39];
  return Math.max(...samples.map((y) => 317 - standFront(y)));
}

function frontPast(lines: string[], row: number) {
  return lines
    .filter((line) => line.includes(`row ${row} `) && line.includes("past the front"))
    .map((line) => Number(line.match(/reaches (\d+) mm/)?.[1]));
}

describe("measureStand", () => {
  it("measures the sloped hook stand", () => {
    const lines = measureStand(hookStand());
    expect(lines[0]).toBe("The built pieces span 600 wide × 1600 high × 400 deep.");
    expect(lines.some((line) => line.startsWith("Drawing fault:"))).toBe(false);

    const row1 = frontPast(lines, 1);
    const row2 = frontPast(lines, 2);
    expect(row1).toHaveLength(4);
    expect(row2).toHaveLength(4);
    for (const mm of row1) expect(Math.abs(mm - worstOverhang(1450))).toBeLessThanOrEqual(1);
    for (const mm of row2) expect(Math.abs(mm - worstOverhang(1250))).toBeLessThanOrEqual(1);
    expect(row1[0]).toBeGreaterThan(row2[0] ?? 0);

    const sticking = lines.filter((line) => line.includes("past the"));
    expect(sticking.some((line) => /row [345] /.test(line))).toBe(false);
    expect(lines.filter((line) => line.startsWith("Clear height"))).toEqual([]);
  });

  it("measures nothing until the pieces are assembled", () => {
    const stand = hookStand();
    expect(measureStand({ ...stand, assembled: false })).toEqual([]);
    const parked = { ...stand };
    delete parked.assembled;
    expect(measureStand(parked)).toEqual([]);
  });

  it("reports no protrusion when the sides are plain rectangles", () => {
    const lines = measureStand(hookStand({ sloped: false }));
    expect(lines.some((line) => line.includes("mm past"))).toBe(false);
    expect(lines).toContain("No piece reaches past the built pieces at its height.");
  });

  it("reports the clear height between two shelves", () => {
    const stand = hookStand();
    stand.parts.push({
      id: "upper",
      name: "Upper shelf",
      shape: "box",
      x: 17,
      y: 397,
      z: 17,
      width: 566,
      height: 17,
      depth: 383,
      material: "paint",
      group: "hook-stand",
    });
    expect(measureStand(stand)).toContain("Clear height between Base shelf (base) and Upper shelf (upper): 280 mm.");
  });

  it("uses the cut front of a chamfered side", () => {
    const stand = createEmptyDesign();
    stand.assembled = true;
    stand.parts = [
      {
        id: "side",
        name: "Side",
        shape: "box",
        x: 0,
        y: 0,
        z: 0,
        width: 400,
        height: 200,
        depth: 200,
        material: "paint",
        face: "side",
        chamfers: { topLeft: { x: 100, y: 100 } },
      },
      {
        id: "rod",
        name: "Rod",
        shape: "box",
        kind: "equipment",
        x: 100,
        y: 150,
        z: 0,
        width: 6,
        height: 40,
        depth: 200,
        material: "metal",
      },
    ];
    expect(measureStand(stand)).toContain(
      "Rod (rod) reaches 89 mm past the front of the stand at its height: its front is at 200, the stand's front there is at 111.",
    );
  });

  it("ignores hidden pieces and prefixes drawing faults", () => {
    const stand = hookStand();
    for (const part of stand.parts) if (part.name.includes("row 1 ")) part.hidden = true;
    expect(measureStand(stand).some((line) => line.includes("row 1 "))).toBe(false);

    stand.parts.push({
      id: "loose",
      name: "Loose panel",
      shape: "box",
      x: 2000,
      y: 400,
      z: 2000,
      width: 200,
      height: 200,
      depth: 18,
      material: "paint",
    });
    const fault = measureStand(stand).find((line) => line.startsWith("Drawing fault:"));
    expect(fault).toContain("Loose panel (loose)");
  });

  it("matches the committed eval cases", () => {
    const sloped = JSON.parse(readFileSync(resolve("evals/cases/hooks-sloped-side/job.json"), "utf8")) as {
      document: unknown;
      brief: string;
      sourceKind: string;
    };
    expect(sloped.document).toEqual(hookStand());
    expect(sloped.brief).toBe(HOOK_BRIEF);
    expect(sloped.sourceKind).toBe("description");
    const fit = JSON.parse(readFileSync(resolve("evals/cases/hooks-fit/job.json"), "utf8")) as { document: unknown };
    expect(fit.document).toEqual(hookStand({ topHookDepth: 150 }));
    const slopedExpected = JSON.parse(readFileSync(resolve("evals/cases/hooks-sloped-side/expected.json"), "utf8")) as { mustFind: string[] };
    const fitExpected = JSON.parse(readFileSync(resolve("evals/cases/hooks-fit/expected.json"), "utf8")) as { mustFind: string[]; mustNotFind: string[] };
    expect(slopedExpected.mustFind).toHaveLength(1);
    expect(fitExpected.mustFind).toEqual([]);
    expect(fitExpected.mustNotFind).toEqual(["Hooks stick out past the front of the stand."]);
  });
});
