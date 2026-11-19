import { describe, expect, it } from "vitest";
import { addParts } from "@/lib/systems/modular/ops";
import { createEmptyDesign } from "@/lib/systems/modular/patch";
import type { ScenePart } from "@/lib/systems/modular/schema";
import { fromBlenderScene, toBlenderObjects } from "./convert";
import type { BlenderObjectOut } from "./protocol";

/** Build the pieces with the studio's own geometry, then hand them back as if they had been modeled in Blender. */
function modeledInBlender(drafts: ScenePart[]) {
  const document = addParts(createEmptyDesign(), drafts).document;
  const objects: BlenderObjectOut[] = toBlenderObjects(document, () => undefined, null).map((object) => ({
    id: `${object.id}-b`,
    name: object.name,
    source: "blender",
    tag: "",
    hash: "",
    reshaped: false,
    location: object.location,
    rotation: object.rotation,
    scale: [1, 1, 1],
    hidden: false,
    materialName: "MDF 18",
    positions: object.positions,
    indices: object.indices,
  }));
  const pulled = fromBlenderScene(createEmptyDesign(), objects);
  return { pulled, sent: document, part: (id: string) => pulled.document.parts.find((part) => part.id === `${id}-b`)! };
}

describe("flat pieces from Blender", () => {
  it("reads an upright board, turned, as a board cut from sheet", () => {
    const { pulled, part } = modeledInBlender([{ id: "wall", name: "Wall", shape: "box", x: 500, y: 0, z: 300, width: 1200, height: 2400, depth: 18, material: "mdf", rotation: 30 }]);
    const wall = part("wall");
    expect(wall.shape).toBe("box");
    expect([wall.width, wall.height, wall.depth]).toEqual([1200, 2400, 18]);
    expect(wall.rotation).toBe(30);
    expect(wall.outline).toBeUndefined();
    expect(wall.material).toBe("mdf");
    expect([wall.x, wall.y, wall.z]).toEqual([500, 0, 300]);
    expect(pulled.meshes).toHaveLength(0);
    expect(pulled.notes.join(" ")).toMatch(/now cut from board/);
  });

  it("keeps square and round openings", () => {
    const { part } = modeledInBlender([
      {
        id: "panel",
        name: "Panel",
        shape: "box",
        x: 0,
        y: 0,
        z: 0,
        width: 1000,
        height: 800,
        depth: 18,
        material: "mdf",
        holes: [
          { x: 100, y: 100, width: 300, height: 200 },
          { x: 600, y: 400, width: 200, height: 200, corners: { topLeft: 100, topRight: 100, bottomLeft: 100, bottomRight: 100 } },
        ],
      },
    ]);
    const panel = part("panel");
    expect(panel.shape).toBe("box");
    const holes = [...(panel.holes ?? [])].sort((a, b) => a.x - b.x);
    expect(holes[0]).toEqual({ x: 100, y: 100, width: 300, height: 200 });
    expect(holes[1].x).toBeCloseTo(600, 0);
    expect(holes[1].width).toBeCloseTo(200, 0);
    expect(holes[1].corners?.topLeft).toBeCloseTo(100, 0);
  });

  it("reads a shelf lying flat and turned about the vertical", () => {
    const { part } = modeledInBlender([{ id: "shelf", name: "Shelf", shape: "box", x: 0, y: 900, z: 0, width: 800, height: 18, depth: 300, material: "mdf", rotation: 20 }]);
    const shelf = part("shelf");
    expect(shelf.shape).toBe("box");
    expect(shelf.face).toBe("top");
    expect(shelf.rotation).toBe(20);
    expect([shelf.width, shelf.height, shelf.depth]).toEqual([800, 18, 300]);
    expect(shelf.y).toBe(900);
  });

  it("reads curved edges back as true arcs", () => {
    const cloud = [[300, 0], [2100, 0, 1], [2100, 600, 1], [1600, 1000, 1], [800, 1000, 1], [300, 600, 1]] as ScenePart["outline"];
    const { part, sent } = modeledInBlender([{ id: "cloud", name: "Cloud", shape: "box", x: 0, y: 0, z: 0, width: 2400, height: 1400, depth: 18, material: "mdf", outline: cloud }]);
    const board = part("cloud");
    expect(board.shape).toBe("box");
    expect(board.depth).toBe(18);
    const bulges = (outline: ScenePart["outline"]) => outline!.map((point) => Math.round((point[2] ?? 0) * 100) / 100).sort();
    expect(bulges(board.outline)).toEqual(bulges(sent.parts[0].outline));
  });

  it("reads Blender's own cube, stretched into a panel and turned, as a board", () => {
    const corners = [-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1];
    const faces = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7];
    const cube: BlenderObjectOut = { id: "cube", name: "Cube", source: "blender", tag: "", hash: "", reshaped: false, location: [1, -0.5, 1.2], rotation: [0, 0, Math.PI / 6], scale: [0.6, 0.009, 1.2], hidden: false, materialName: "Plywood", positions: corners, indices: faces };
    const pulled = fromBlenderScene(createEmptyDesign(), [cube]);
    const panel = pulled.document.parts[0];
    expect(panel.shape).toBe("box");
    expect([panel.width, panel.height, panel.depth]).toEqual([1200, 2400, 18]);
    expect(panel.rotation).toBe(30);
    expect([panel.x, panel.y, panel.z]).toEqual([400, 0, 491]);
    expect(panel.material).toBe("wood");
  });

  it("leaves a leaning board and a block as custom pieces", () => {
    const { part } = modeledInBlender([
      { id: "lean", name: "Lean", shape: "box", x: 0, y: 0, z: 0, width: 18, height: 1000, depth: 1000, material: "mdf", tilt: 15 },
      { id: "block", name: "Block", shape: "box", x: 2000, y: 0, z: 0, width: 500, height: 500, depth: 500, material: "mdf" },
    ]);
    expect(part("block").shape).toBe("mesh");
    expect(part("lean").shape).toBe("mesh");
  });
});
