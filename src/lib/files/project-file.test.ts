import { describe, expect, it } from "vitest";
import { buildProjectZip, openDesignFile, openProjectArchive, projectFolderName, usedAssetIds, usedMeshIds } from "@/lib/files/project-file";
import { emptyCosting } from "@/lib/systems/costing";
import { addParts, defaultPart } from "@/lib/systems/modular/ops";
import { createEmptyDesign } from "@/lib/systems/modular/patch";
import type { StoredMesh } from "@/lib/studio/meshes";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function sample() {
  const base = createEmptyDesign();
  const box = { ...defaultPart(base, "box"), name: "Logo block", images: [{ assetId: "img-1", face: "front" as const }] };
  const imported = { ...defaultPart(base, "box"), name: "Chair", shape: "mesh" as const, meshId: "mesh-1" };
  const document = addParts(addParts(base, [box]).document, [imported]).document;
  const mesh: StoredMesh = {
    id: "mesh-1",
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    width: 1,
    height: 1,
    depth: 1,
  };
  const asset = { id: "img-1", name: "Logo", dataUrl: PIXEL, width: 1, height: 1, bytes: 70 };
  return { document, mesh, asset };
}

describe("model folder", () => {
  it("names the folder from the job title", () => {
    expect(projectFolderName("Café Noir — Stand #4")).toBe("proink-cafe-noir-stand-4");
    expect(projectFolderName("???")).toBe("proink-stand");
  });

  it("saves and reopens the design with its pictures, imported pieces, and costing", async () => {
    const { document, mesh, asset } = sample();
    const costing = { ...emptyCosting(), overrides: { "A:1": { unitCents: 123 } } };
    const built = await buildProjectZip({
      title: "Test stand",
      document,
      costing,
      glb: new Uint8Array([1, 2, 3]).buffer,
      assets: [asset, { ...asset, id: "unused" }],
      findMesh: (id) => (id === "mesh-1" ? mesh : undefined),
    });
    expect(built.pictures).toBe(1);
    expect(built.meshes).toBe(1);
    expect(built.missing).toBe(0);

    const opened = await openProjectArchive({ name: `${built.folder}.zip`, arrayBuffer: async () => built.bytes.slice().buffer });
    expect(opened.document).toEqual(document);
    expect(opened.name).toBe("Test stand");
    expect(opened.costing.overrides["A:1"]).toEqual({ unitCents: 123 });
    expect(opened.assets.map((item) => item.id)).toEqual(["img-1"]);
    expect(opened.assets[0].dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(Array.from(opened.meshes[0].positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(opened.meshes[0].indices ?? [])).toEqual([0, 1, 2]);
    expect(opened.warnings).toEqual([]);
  });

  it("counts what could not be found instead of failing", async () => {
    const { document } = sample();
    const built = await buildProjectZip({ title: "Gaps", document, costing: emptyCosting(), glb: null, assets: [], findMesh: () => undefined });
    expect(built.missing).toBe(2);
    const opened = await openProjectArchive({ name: "gaps.zip", arrayBuffer: async () => built.bytes.slice().buffer });
    expect(opened.warnings.length).toBe(2);
  });

  it("opens a bare design file and warns that pictures are not inside", async () => {
    const { document } = sample();
    const opened = await openDesignFile({ name: "stand.json", arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(document)).buffer });
    expect(opened.document).toEqual(document);
    expect(opened.warnings.length).toBe(1);
    expect(usedAssetIds(document).has("img-1")).toBe(true);
    expect(usedMeshIds(document).has("mesh-1")).toBe(true);
  });

  it("rejects things that are not a design or a saved folder", async () => {
    await expect(openDesignFile({ name: "x.json", arrayBuffer: async () => new TextEncoder().encode("nope").buffer })).rejects.toThrow(/JSON/);
    await expect(openProjectArchive({ name: "x.zip", arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer })).rejects.toThrow(/zip/);
  });
});
