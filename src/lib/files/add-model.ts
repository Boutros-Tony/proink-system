import { importModelFile } from "@/lib/files/import-model";
import { saveMeshes } from "@/lib/studio/meshes";
import { addParts, groupParts, placementFor } from "@/lib/systems/modular/ops";
import type { DesignDocument } from "@/lib/systems/modular/schema";

/** Read a glTF, OBJ, or STL file and put its pieces on the stand, grouped, in free floor space. */
export async function addModelFile(document: DesignDocument, file: File) {
  const imported = await importModelFile(file);
  await saveMeshes(imported.meshes);
  const minX = Math.min(...imported.drafts.map((draft) => draft.x));
  const minZ = Math.min(...imported.drafts.map((draft) => draft.z));
  const spanX = Math.max(...imported.drafts.map((draft) => draft.x + draft.width)) - minX;
  const spanZ = Math.max(...imported.drafts.map((draft) => draft.z + draft.depth)) - minZ;
  const place = placementFor(document, spanX, spanZ);
  const drafts = imported.drafts.map((draft) => ({ ...draft, x: draft.x - minX + place.x, z: draft.z - minZ + place.z }));
  const added = addParts(document, drafts);
  const grouped = groupParts(added.document, added.ids, file.name.replace(/\.[^.]+$/, "") || "Import");
  const count = imported.drafts.length;
  return {
    document: grouped.document,
    ids: added.ids,
    note: `${count} ${count === 1 ? "piece" : "pieces"} from ${imported.fileName}. ${imported.unitNote}${imported.unnamed ? ` ${imported.unnamed} still need a material.` : ""}`,
  };
}
