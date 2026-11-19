import { describe, expect, it } from "vitest";
import { finishingNeeds } from "../finishing";
import { defaultPriceBook } from "../materials";
import { arrangeParts } from "./assemble";
import { changeReport } from "./change-report";
import { compileDesign } from "./compile";
import { technicalSvg } from "./drawings";
import { boxGeometry } from "./front-face";
import { clampOutline } from "./geometry";
import { addParts, updateParts } from "./ops";
import { createEmptyDesign } from "./patch";
import type { ScenePart } from "./schema";

/** A side panel 400 deep and 1200 high: sloping front, 50 mm toe step 100 mm high. */
const TOE: [number, number][] = [
  [0, 0],
  [400, 0],
  [400, 1200],
  [150, 1200],
  [50, 100],
  [0, 100],
];

function sidePanel(): ScenePart {
  return { id: "s", name: "Side", shape: "box", x: 0, y: 0, z: 0, width: 18, height: 1200, depth: 400, material: "mdf", face: "side", outline: TOE };
}

describe("a free outline on a face", () => {
  it("keeps a six-point shape and drops what is not a corner", () => {
    expect(clampOutline(400, 1200, TOE)).toEqual(TOE);
    expect(clampOutline(400, 1200, [[0, 0], [200, 0], [400, 0], [400, 1200], [0, 1200], [0, 0]])).toBeUndefined();
    expect(clampOutline(400, 1200, [[0, 0], [900, 0], [0, 1200]])).toEqual([[0, 0], [400, 0], [0, 1200]]);
    expect(clampOutline(400, 1200, [[0, 0], [400, 1200], [400, 0], [0, 1200]])).toBeUndefined();
    expect(clampOutline(400, 1200, [...TOE].reverse())).toEqual(TOE);
  });

  it("wins over corners and cuts, and keeps only openings inside it", () => {
    const { document, ids } = addParts(createEmptyDesign(), [
      { ...sidePanel(), id: undefined, corners: { topLeft: 50 }, chamfers: { topRight: { x: 100, y: 100 } }, holes: [{ x: 250, y: 500, width: 100, height: 100 }, { x: 10, y: 1000, width: 60, height: 60 }] },
    ]);
    const part = document.parts.find((item) => item.id === ids[0])!;
    expect(part.outline).toEqual(TOE);
    expect(part.corners).toBeUndefined();
    expect(part.chamfers).toBeUndefined();
    expect(part.holes).toEqual([{ x: 250, y: 500, width: 100, height: 100 }]);
  });

  it("draws the slope at the front of a side panel in 3D", () => {
    const geometry = boxGeometry(sidePanel())!;
    const position = geometry.getAttribute("position");
    const top: number[] = [];
    for (let index = 0; index < position.count; index += 1) {
      if (Math.abs(position.getY(index) - 0.6) < 1e-6) top.push(Math.round(position.getZ(index) * 1000));
    }
    // The top runs from the back (-200) to 150 mm behind the front (+50), so the slope faces the viewer.
    expect(Math.min(...top)).toBe(-200);
    expect(Math.max(...top)).toBe(50);
  });

  it("stretches with the piece and goes back to a rectangle on null", () => {
    const document = addParts(createEmptyDesign(), [sidePanel()]).document;
    const taller = updateParts(document, ["s"], { height: 2400 });
    expect(taller.parts[0].outline).toContainEqual([150, 2400]);
    const plain = updateParts(taller, ["s"], { outline: null });
    expect(plain.parts[0].outline).toBeUndefined();
  });

  it("is measured for edging along its real edges", () => {
    const needs = finishingNeeds([sidePanel()], defaultPriceBook());
    const slope = Math.hypot(100, 1100);
    expect(needs.bandingMm).toBeCloseTo(400 + 1200 + 250 + slope + 50 + 100, 0);
    expect(needs.bandedEdges).toBe(6);
  });

  it("is drawn as its shape on the technical drawing", () => {
    const document = addParts(createEmptyDesign(), [sidePanel()]).document;
    const svg = technicalSvg(document, compileDesign(document));
    expect(svg).toMatch(/<path d="M [^"]* L [^"]* L [^"]* L [^"]* L [^"]* L [^"]* Z"/);
  });

  it("tells the model when an outline was not kept", () => {
    const document = addParts(createEmptyDesign(), [{ ...sidePanel(), outline: undefined }]).document;
    const crossing: [number, number][] = [[0, 0], [400, 1200], [400, 0], [0, 1200]];
    const after = updateParts(document, ["s"], { outline: crossing });
    expect(changeReport(document, after, ["s"], { outline: crossing }).adjusted.join(" ")).toContain("edges cross");
  });

  it("follows the piece when assembly turns it", () => {
    const front: ScenePart = { id: "f", name: "Panel", shape: "box", x: 0, y: 0, z: 0, width: 400, height: 1200, depth: 18, outline: TOE };
    const document = addParts(createEmptyDesign(), [front]).document;
    const turned = arrangeParts(document, [{ id: "f", x: 0, y: 0, z: 0, width: 1200, height: 400, depth: 18 }]).document.parts[0];
    expect(turned.outline).toHaveLength(6);
    expect(turned.outline).toContainEqual([1200, 150]);
  });
});
