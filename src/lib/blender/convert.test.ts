import { describe, expect, it } from "vitest";
import { addParts } from "@/lib/systems/modular/ops";
import { createEmptyDesign } from "@/lib/systems/modular/patch";
import type { DesignDocument } from "@/lib/systems/modular/schema";
import { fromBlenderScene, fromBlenderAxes, toBlenderAxes, toBlenderObjects } from "./convert";
import type { BlenderObjectIn, BlenderObjectOut } from "./protocol";

const CLOUD = [[300, 0], [2100, 0, 1], [2100, 600, 1], [1600, 1000, 1], [800, 1000, 1], [300, 600, 1]] as [number, number, number?][];

function stand(): DesignDocument {
  return addParts(createEmptyDesign(), [
    { id: "cloud", name: "Cloud", shape: "box", x: 100, y: 0, z: 200, width: 2400, height: 1400, depth: 18, material: "mdf", outline: CLOUD as never, rotation: 30, tilt: 10 },
    { id: "drum", name: "Drum", shape: "cylinder", x: 3000, y: 0, z: 0, width: 600, height: 900, depth: 600, material: "paint", round: { wall: 20 } },
  ]).document;
}

/** What Blender would report right after a sync, with any edit made to it. */
function asBlender(object: BlenderObjectIn, edit: Partial<BlenderObjectOut> = {}): BlenderObjectOut {
  return { id: object.id, name: object.name, source: object.source, tag: object.tag, hash: object.hash, reshaped: false, location: object.location, rotation: object.rotation, scale: [1, 1, 1], hidden: object.hidden, materialName: object.material.name, ...edit };
}

describe("Blender link", () => {
  it("swaps the axes both ways", () => {
    expect(toBlenderAxes([1, 2, 3])).toEqual([1, -3, 2]);
    expect(fromBlenderAxes(toBlenderAxes([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it("sends each piece built from the studio's own geometry, centered, with its turn and tilt", () => {
    const objects = toBlenderObjects(stand(), () => undefined, null);
    const cloud = objects.find((object) => object.id === "cloud")!;
    expect(cloud.source).toBe("studio");
    expect(cloud.positions!.length).toBeGreaterThan(300);
    expect(cloud.location).toEqual([1.3, -0.209, 0.7]);
    expect(cloud.rotation[1]).toBeCloseTo((-10 * Math.PI) / 180, 5);
    expect(cloud.rotation[2]).toBeCloseTo((30 * Math.PI) / 180, 5);
    expect(toBlenderObjects(stand(), () => undefined, null).find((object) => object.id === "cloud")!.hash).toBe(cloud.hash);
  });

  it("reads back the same stand when nothing changed in Blender", () => {
    const document = stand();
    const objects = toBlenderObjects(document, () => undefined, null).map((object) => asBlender(object));
    const pulled = fromBlenderScene(document, objects);
    expect(pulled.empty).toBe(false);
    expect(pulled.document.parts).toEqual(document.parts);
    expect(pulled.notes).toEqual([]);
  });

  it("takes a move, a stretch, and a turn made in Blender, and keeps the cut shape", () => {
    const document = stand();
    const objects = toBlenderObjects(document, () => undefined, null).map((object) =>
      object.id === "cloud" ? asBlender(object, { location: [object.location[0] + 0.5, object.location[1], object.location[2]], scale: [0.5, 1, 0.5], rotation: [0, 0, Math.PI / 2] }) : asBlender(object),
    );
    const cloud = fromBlenderScene(document, objects).document.parts.find((part) => part.id === "cloud")!;
    expect([cloud.width, cloud.height, cloud.depth]).toEqual([1200, 700, 18]);
    expect(cloud.x).toBeCloseTo(1300 + 500 - 600, 1);
    expect(cloud.rotation).toBe(90);
    expect(cloud.tilt).toBeUndefined();
    expect(cloud.outline?.[1]).toEqual([1050, 0, 1]);
  });

  it("turns a model made in Blender into a custom piece, priced from its size", () => {
    const document = stand();
    const objects = toBlenderObjects(document, () => undefined, null).map((object) => asBlender(object));
    const cube = [-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5];
    objects.push({ id: "mascot-ab12", name: "Mascot", source: "blender", tag: "", hash: "", reshaped: false, location: [1, -1, 0.5], rotation: [0, 0, Math.PI / 2], scale: [2, 1, 1], hidden: false, materialName: "MDF white", positions: cube, indices: [0, 1, 2, 0, 2, 3] });
    const pulled = fromBlenderScene(document, objects);
    const mascot = pulled.document.parts.find((part) => part.id === "mascot-ab12")!;
    expect(mascot.shape).toBe("mesh");
    expect(mascot.material).toBe("mdf");
    expect([mascot.width, mascot.height, mascot.depth]).toEqual([1000, 1000, 2000]);
    expect([mascot.x, mascot.y, mascot.z]).toEqual([500, 0, 0]);
    expect(pulled.meshes).toHaveLength(1);
    expect(pulled.meshes[0].id).toBe(mascot.meshId);
    expect(pulled.notes.join(" ")).toMatch(/custom piece is priced from its size/);
  });

  it("removes what was deleted in Blender, but never wipes the stand from an empty Blender", () => {
    const document = stand();
    const objects = toBlenderObjects(document, () => undefined, null).map((object) => asBlender(object));
    const left = fromBlenderScene(document, objects.filter((object) => object.id !== "drum"));
    expect(left.document.parts.map((part) => part.id)).toEqual(["cloud"]);
    const fresh = fromBlenderScene(document, []);
    expect(fresh.empty).toBe(true);
    expect(fresh.document).toBe(document);
  });

  it("makes a studio piece reshaped in Blender a custom piece and says so", () => {
    const document = stand();
    const objects = toBlenderObjects(document, () => undefined, null).map((object) =>
      object.id === "drum" ? asBlender(object, { reshaped: true, positions: object.positions, indices: object.indices }) : asBlender(object),
    );
    const pulled = fromBlenderScene(document, objects);
    const drum = pulled.document.parts.find((part) => part.id === "drum")!;
    expect(drum.shape).toBe("mesh");
    expect(drum.material).toBe("paint");
    expect(Math.round(drum.width)).toBe(600);
    expect(pulled.notes.join(" ")).toMatch(/not cut from board/);
  });
});
