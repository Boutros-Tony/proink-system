import { describe, expect, it } from "vitest";
import { importModelFile } from "./import-model";

const OBJ = `o Counter
v 0 0 0
v 1 0 0
v 1 0.8 0
v 0 0.8 0
v 0 0 0.4
v 1 0 0.4
v 1 0.8 0.4
v 0 0.8 0.4
f 1 2 3 4
f 5 6 7 8
`;

describe("importing a 3D file", () => {
  it("keeps the real triangles and reads a meter-sized OBJ as millimeters", async () => {
    const file = new File([OBJ], "counter.obj", { type: "text/plain" });
    const imported = await importModelFile(file);
    expect(imported.drafts).toHaveLength(1);
    const piece = imported.drafts[0];
    expect(piece.shape).toBe("mesh");
    expect(piece.name).toBe("Counter");
    expect(piece.width).toBe(1000);
    expect(piece.height).toBe(800);
    expect(piece.depth).toBe(400);
    expect(imported.meshes[0]?.positions.length).toBeGreaterThan(8);
    expect(imported.unitNote).toContain("meters");
  });

  it("reads a glTF whose surfaces have no thickness and whose buffers are separate data URIs", async () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    const file = new File([gltfFile(positions, indices)], "panel.gltf", { type: "model/gltf+json" });
    const imported = await importModelFile(file);
    expect(imported.drafts).toHaveLength(1);
    const piece = imported.drafts[0];
    expect(piece.name).toBe("Panel");
    expect(piece.width).toBe(1000);
    expect(piece.height).toBe(1000);
    expect(piece.depth).toBe(1);
  });
});

function dataUri(bytes: Uint8Array) {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return `data:application/octet-stream;base64,${btoa(text)}`;
}

/** A 1 m square in the XY plane, split the way Rhino writes glTF: one buffer per accessor. */
function gltfFile(positions: Float32Array, indices: Uint16Array) {
  const positionBytes = new Uint8Array(positions.buffer);
  const indexBytes = new Uint8Array(indices.buffer);
  return JSON.stringify({
    asset: { version: "2.0" },
    buffers: [
      { uri: dataUri(positionBytes), byteLength: positionBytes.byteLength },
      { uri: dataUri(indexBytes), byteLength: indexBytes.byteLength },
    ],
    bufferViews: [
      { buffer: 0, byteLength: positionBytes.byteLength },
      { buffer: 1, byteLength: indexBytes.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 6, type: "SCALAR" },
    ],
    meshes: [
      {
        name: "Panel",
        primitives: [
          { attributes: { POSITION: 0 }, indices: 1 },
          { attributes: { POSITION: 0 }, indices: 1 },
        ],
      },
    ],
    nodes: [{ name: "Panel", mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  });
}
