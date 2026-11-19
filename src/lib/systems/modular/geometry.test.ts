import { describe, expect, it } from "vitest";
import { resolveFront } from "./geometry";

describe("front face", () => {
  it("slopes a top edge with a straight cut across the whole width", () => {
    const face = resolveFront(400, 1200, undefined, { topRight: { x: 400, y: 300 } });
    expect(face?.topRight).toEqual({ radius: 0, cutX: 400, cutY: 300 });
    expect(face?.topLeft).toEqual({ radius: 0, cutX: 0, cutY: 0 });
  });

  it("lets a straight cut replace a radius on the same corner", () => {
    const face = resolveFront(400, 1200, { topRight: 80 }, { topRight: { x: 400, y: 300 } });
    expect(face?.topRight.radius).toBe(0);
    expect(face?.topRight.cutX).toBe(400);
  });

  it("shrinks two cuts that do not fit on one edge", () => {
    const face = resolveFront(400, 1200, undefined, {
      topLeft: { x: 300, y: 100 },
      topRight: { x: 300, y: 100 },
    });
    expect((face?.topLeft.cutX ?? 0) + (face?.topRight.cutX ?? 0)).toBeCloseTo(400);
  });

  it("ignores a cut until both directions are set", () => {
    expect(resolveFront(400, 1200, undefined, { topRight: { x: 400 } })).toBeUndefined();
  });
});
