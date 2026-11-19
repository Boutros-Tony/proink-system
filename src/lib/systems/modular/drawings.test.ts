import { describe, expect, it } from "vitest";
import { compileDesign } from "./compile";
import { technicalSvg } from "./drawings";
import { addParts } from "./ops";
import { createEmptyDesign } from "./patch";

const round = (size: number) => ({ topLeft: size / 2, topRight: size / 2, bottomLeft: size / 2, bottomRight: size / 2 });

function drawing(parts: Parameters<typeof addParts>[1]) {
  const document = addParts(createEmptyDesign(), parts).document;
  return technicalSvg(document, compileDesign(document));
}

describe("front view openings", () => {
  it("cuts a ring with an even-odd fill and leaves a plain box solid", () => {
    const ring = drawing([
      {
        name: "Ring",
        shape: "box",
        x: 0,
        y: 0,
        z: 0,
        width: 2000,
        height: 2000,
        depth: 300,
        corners: round(2000),
        holes: [{ x: 200, y: 200, width: 1600, height: 1600, corners: round(1600) }],
      },
    ]);
    expect(ring).toContain('fill-rule="evenodd"');

    const window = drawing([
      {
        name: "Window",
        shape: "box",
        x: 0,
        y: 0,
        z: 0,
        width: 1000,
        height: 1000,
        depth: 18,
        holes: [{ x: 300, y: 300, width: 400, height: 400 }],
      },
    ]);
    expect(window).toContain('fill-rule="evenodd"');

    const plain = drawing([{ name: "Panel", shape: "box", x: 0, y: 0, z: 0, width: 1000, height: 800, depth: 18 }]);
    expect(plain).not.toContain("evenodd");
  });
});
