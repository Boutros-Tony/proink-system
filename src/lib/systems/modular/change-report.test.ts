import { describe, expect, it } from "vitest";
import { changeReport, describePart } from "./change-report";
import { addParts, updateParts } from "./ops";
import { createEmptyDesign } from "./patch";
import type { ScenePart } from "./schema";

function panel(extra: Partial<ScenePart> = {}): ScenePart {
  return { id: "p3", name: "Left panel", shape: "box", x: 0, y: 0, z: 0, width: 1200, height: 2400, depth: 18, material: "paint", ...extra };
}

describe("change report", () => {
  it("describes size, corners, cuts, and openings that were stored", () => {
    expect(
      describePart(
        panel({
          corners: { topRight: 300 },
          chamfers: { topLeft: { x: 80, y: 40 } },
          holes: [
            { x: 100, y: 0, width: 400, height: 600, corners: { topLeft: 200, topRight: 200, bottomLeft: 200, bottomRight: 200 } },
            { x: 500, y: 900, width: 300, height: 300 },
          ],
        }),
      ),
    ).toBe(
      'p3 "Left panel" box 1200 × 2400 × 18 mm, paint, at 0, 0, 0, corners tl 0 tr 300 bl 0 br 0, chamfers tl 80×40, 2 openings: 400×600 at x 100 y 0 (r 200); 300×300 at x 500 y 900',
    );
  });

  it("puts a rename and a height change in changed", () => {
    const before = addParts(createEmptyDesign(), [panel()]).document;
    const after = updateParts(before, ["p3"], { name: "Side panel", height: 1800 });
    const report = changeReport(before, after, ["p3"], { name: "Side panel", height: 1800 });
    expect(report.changed).toHaveLength(1);
    expect(report.changed[0]).toContain('"Side panel"');
    expect(report.changed[0]).toContain("1800");
    expect(report.unchanged).toEqual([]);
    expect(report.adjusted).toEqual([]);
  });

  it("reports a corner radius the piece cannot hold", () => {
    const before = addParts(createEmptyDesign(), [panel({ width: 600, height: 600 })]).document;
    const requested = { corners: { topRight: 900 } };
    const after = updateParts(before, ["p3"], requested);
    const report = changeReport(before, after, ["p3"], requested);
    expect(report.adjusted).toContain('p3 "Left panel": corner topRight asked 900, set to 600 (limited by the piece size).');
  });

  it("reports an opening wider than the piece", () => {
    const before = addParts(createEmptyDesign(), [panel()]).document;
    const requested = { holes: [{ x: 5, y: 100, width: 1300, height: 400 }] };
    const after = updateParts(before, ["p3"], requested);
    const report = changeReport(before, after, ["p3"], requested);
    expect(report.adjusted).toContain('p3 "Left panel": opening 1 asked 1300 wide, set to 1190 (an opening keeps a 5 mm rim).');
  });

  it("ignores an unknown id", () => {
    const before = addParts(createEmptyDesign(), [panel()]).document;
    const after = updateParts(before, ["p3"], { height: 1800 });
    const report = changeReport(before, after, ["missing", "p3"], { height: 1800 });
    expect(report.changed).toHaveLength(1);
    expect(report.unchanged).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("missing");
  });

  it("puts an identical update in unchanged", () => {
    const before = addParts(createEmptyDesign(), [panel()]).document;
    const requested = { name: "Left panel", height: 2400 };
    const after = updateParts(before, ["p3"], requested);
    const report = changeReport(before, after, ["p3"], requested);
    expect(report.changed).toEqual([]);
    expect(report.unchanged).toEqual(["p3"]);
    expect(report.adjusted).toEqual([]);
  });
});
