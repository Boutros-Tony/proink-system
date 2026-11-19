import JSZip from "jszip";
import { readCosting, type Costing } from "@/lib/systems/costing";
import { openDesignDocument, type DesignDocument } from "@/lib/systems/modular/schema";
import type { StudioAsset } from "@/lib/studio/assets";
import type { StoredMesh } from "@/lib/studio/meshes";

/**
 * A stand saved as one folder, zipped. It holds the 3D model for other programs and everything the studio
 * needs to open the same stand again: the design, its pictures, its imported 3D pieces, and this job's costing.
 *
 *   proink-<name>/
 *     project.json      what this folder is
 *     design.json       the stand, the file the studio opens
 *     model.glb         the 3D model for Blender, Rhino, and viewers
 *     costing.json      this job's price changes and added lines
 *     pictures/         the logos and photos used on the stand, with a manifest
 *     meshes/           the imported 3D pieces, with a manifest
 *     README.txt
 */

export const PROJECT_FORMAT = "proink-studio-project";
const PROJECT_VERSION = 1;

type PictureEntry = { id: string; name: string; width: number; height: number; file: string };
type MeshEntry = { id: string; width: number; height: number; depth: number; positions: string; indices: string | null };

export type ProjectContent = {
  name: string;
  document: DesignDocument;
  costing: Costing;
  assets: StudioAsset[];
  meshes: StoredMesh[];
};

export type OpenedProject = ProjectContent & {
  /** Things the folder promised but did not contain, so the person is told rather than surprised. */
  warnings: string[];
};

export function usedAssetIds(document: DesignDocument) {
  const ids = new Set<string>();
  for (const part of document.parts) for (const image of part.images ?? []) ids.add(image.assetId);
  for (const wall of document.walls) for (const bay of wall.bays) if (bay.graphicAssetId) ids.add(bay.graphicAssetId);
  return ids;
}

export function usedMeshIds(document: DesignDocument) {
  const ids = new Set<string>();
  for (const part of document.parts) if (part.shape === "mesh" && part.meshId) ids.add(part.meshId);
  return ids;
}

export function projectFolderName(title: string) {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `proink-${slug || "stand"}`;
}

function bytesOf(typed: Float32Array | Uint32Array) {
  return new Uint8Array(typed.buffer.slice(typed.byteOffset, typed.byteOffset + typed.byteLength));
}

function splitDataUrl(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma < 0) return null;
  const header = dataUrl.slice(5, comma);
  const payload = dataUrl.slice(comma + 1);
  const base64 = header.endsWith(";base64");
  const mime = header.split(";")[0] || "image/png";
  return { mime, base64: base64 ? payload : btoa(unescape(encodeURIComponent(decodeURIComponent(payload)))) };
}

function extensionFor(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/svg+xml") return "svg";
  return "png";
}

function mimeFor(file: string) {
  const extension = file.split(".").pop()?.toLowerCase();
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return "image/png";
}

function safeFile(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

export type BuildInput = {
  title: string;
  document: DesignDocument;
  costing: Costing;
  /** The model file, already written. Left out when the 3D file could not be made. */
  glb: ArrayBuffer | null;
  assets: StudioAsset[];
  findMesh: (id: string) => StoredMesh | undefined;
};

export type BuiltProject = { folder: string; bytes: Uint8Array; pictures: number; meshes: number; missing: number };

export async function buildProjectZip(input: BuildInput): Promise<BuiltProject> {
  const folder = projectFolderName(input.title);
  const zip = new JSZip();
  const root = zip.folder(folder);
  if (!root) throw new Error("The folder could not be created.");

  const wantedAssets = usedAssetIds(input.document);
  const pictures: PictureEntry[] = [];
  const pictureFolder = root.folder("pictures");
  for (const asset of input.assets) {
    if (!wantedAssets.has(asset.id)) continue;
    const parts = splitDataUrl(asset.dataUrl);
    if (!parts) continue;
    const file = `${safeFile(asset.id)}-${safeFile(asset.name)}.${extensionFor(parts.mime)}`;
    pictureFolder?.file(file, parts.base64, { base64: true });
    pictures.push({ id: asset.id, name: asset.name, width: asset.width, height: asset.height, file });
  }

  const meshEntries: MeshEntry[] = [];
  const meshFolder = root.folder("meshes");
  let missing = 0;
  for (const id of usedMeshIds(input.document)) {
    const mesh = input.findMesh(id);
    if (!mesh) {
      missing += 1;
      continue;
    }
    const positions = `${safeFile(id)}.positions.bin`;
    const indices = mesh.indices && mesh.indices.length > 0 ? `${safeFile(id)}.indices.bin` : null;
    meshFolder?.file(positions, bytesOf(mesh.positions));
    if (indices && mesh.indices) meshFolder?.file(indices, bytesOf(mesh.indices));
    meshEntries.push({ id, width: mesh.width, height: mesh.height, depth: mesh.depth, positions, indices });
  }
  missing += [...wantedAssets].filter((id) => !pictures.some((picture) => picture.id === id)).length;

  root.file(
    "project.json",
    JSON.stringify(
      {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        title: input.title,
        exportedAt: new Date().toISOString(),
        units: "design.json is in millimeters. model.glb is in meters, Y up, origin at the back-left floor corner.",
        pictures: pictures.length,
        meshes: meshEntries.length,
        hasModel: input.glb !== null,
      },
      null,
      2,
    ),
  );
  root.file("design.json", JSON.stringify(input.document, null, 2));
  root.file("costing.json", JSON.stringify(input.costing, null, 2));
  if (input.glb) root.file("model.glb", input.glb);
  if (pictures.length > 0) pictureFolder?.file("manifest.json", JSON.stringify(pictures, null, 2));
  if (meshEntries.length > 0) meshFolder?.file("manifest.json", JSON.stringify(meshEntries, null, 2));
  root.file(
    "README.txt",
    [
      `${input.title}`,
      "",
      "This folder was saved from ProInk Studio.",
      "",
      "To open it again: in the studio, go to Files, then Open file, and choose this zip.",
      "Keep the folder together. design.json alone opens the stand, but without its pictures and imported pieces.",
      "",
      "model.glb is the 3D model. Open it in Blender, Rhino, or any glTF viewer.",
      "You can also add it to a stand from Edit, then Import 3D file.",
    ].join("\n"),
  );

  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { folder, bytes, pictures: pictures.length, meshes: meshEntries.length, missing };
}

type Readable = { name: string; arrayBuffer(): Promise<ArrayBuffer> };

/** Is this a saved folder (zip) or a bare design file? Anything else is treated as a 3D model by the caller. */
export function projectKind(name: string): "zip" | "design" | "other" {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "zip") return "zip";
  if (extension === "json") return "design";
  return "other";
}

export async function openProjectArchive(file: Readable): Promise<OpenedProject> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new Error("That zip could not be read.");
  }
  // The folder may have been re-zipped with a different name or none at all.
  const marker = Object.keys(zip.files).find((name) => name === "project.json" || name.endsWith("/project.json"));
  const designName = Object.keys(zip.files).find((name) => name === "design.json" || name.endsWith("/design.json"));
  if (!marker && !designName) throw new Error("This zip is not a ProInk Studio folder. It has no design.json.");
  const prefix = (marker ?? designName ?? "").replace(/(project|design)\.json$/, "");

  const text = async (path: string) => {
    const entry = zip.file(path);
    return entry ? entry.async("string") : null;
  };
  const warnings: string[] = [];

  let title = "";
  if (marker) {
    try {
      const info = JSON.parse((await text(marker)) ?? "{}") as { format?: string; title?: string };
      if (info.format !== PROJECT_FORMAT) throw new Error("format");
      title = typeof info.title === "string" ? info.title : "";
    } catch {
      throw new Error("This zip is not a ProInk Studio folder.");
    }
  }

  const designText = await text(`${prefix}design.json`);
  if (!designText) throw new Error("This folder has no design.json.");
  const design = parseDesign(designText);

  let costing: Costing = readCosting(null);
  const costingText = await text(`${prefix}costing.json`);
  if (costingText) {
    try {
      costing = readCosting(JSON.parse(costingText));
    } catch {
      warnings.push("The saved costing could not be read, so prices start fresh.");
    }
  }

  const assets: StudioAsset[] = [];
  const pictureManifest = await text(`${prefix}pictures/manifest.json`);
  if (pictureManifest) {
    try {
      for (const entry of JSON.parse(pictureManifest) as PictureEntry[]) {
        const data = await zip.file(`${prefix}pictures/${entry.file}`)?.async("base64");
        if (!data) {
          warnings.push(`Picture ${entry.name} is missing from the folder.`);
          continue;
        }
        assets.push({
          id: entry.id,
          name: entry.name,
          dataUrl: `data:${mimeFor(entry.file)};base64,${data}`,
          width: entry.width,
          height: entry.height,
          bytes: Math.round((data.length * 3) / 4),
        });
      }
    } catch {
      warnings.push("The pictures list could not be read.");
    }
  }

  const meshes: StoredMesh[] = [];
  const meshManifest = await text(`${prefix}meshes/manifest.json`);
  if (meshManifest) {
    try {
      for (const entry of JSON.parse(meshManifest) as MeshEntry[]) {
        const positions = await zip.file(`${prefix}meshes/${entry.positions}`)?.async("arraybuffer");
        const indices = entry.indices ? await zip.file(`${prefix}meshes/${entry.indices}`)?.async("arraybuffer") : null;
        if (!positions || positions.byteLength % 12 !== 0) {
          warnings.push("One imported 3D piece is missing from the folder.");
          continue;
        }
        meshes.push({
          id: entry.id,
          positions: new Float32Array(positions),
          indices: indices && indices.byteLength % 4 === 0 ? new Uint32Array(indices) : null,
          width: entry.width,
          height: entry.height,
          depth: entry.depth,
        });
      }
    } catch {
      warnings.push("The imported 3D pieces list could not be read.");
    }
  }

  const haveAssets = new Set(assets.map((asset) => asset.id));
  const lostPictures = [...usedAssetIds(design)].filter((id) => !haveAssets.has(id)).length;
  if (lostPictures > 0) warnings.push(`${lostPictures} ${lostPictures === 1 ? "picture is" : "pictures are"} not in the folder.`);
  const haveMeshes = new Set(meshes.map((mesh) => mesh.id));
  const lostMeshes = [...usedMeshIds(design)].filter((id) => !haveMeshes.has(id)).length;
  if (lostMeshes > 0) warnings.push(`${lostMeshes} imported 3D ${lostMeshes === 1 ? "piece is" : "pieces are"} not in the folder and show as boxes.`);

  return { name: title || file.name.replace(/\.[^.]+$/, ""), document: design, costing, assets, meshes, warnings };
}

export async function openDesignFile(file: Readable): Promise<OpenedProject> {
  const design = parseDesign(new TextDecoder().decode(await file.arrayBuffer()));
  const lostPictures = usedAssetIds(design).size;
  const lostMeshes = usedMeshIds(design).size;
  const warnings: string[] = [];
  if (lostPictures > 0 || lostMeshes > 0) warnings.push("A design file does not carry pictures or imported 3D pieces. Open the zip folder to get them back.");
  return { name: file.name.replace(/\.[^.]+$/, ""), document: design, costing: readCosting(null), assets: [], meshes: [], warnings };
}

function parseDesign(text: string): DesignDocument {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("That file is not a design. It could not be read as JSON.");
  }
  const opened = openDesignDocument(json);
  if (opened.status === "ready") return opened.document;
  if (opened.status === "unavailable") throw new Error("This is a custom carpentry design, which this studio cannot open yet.");
  throw new Error(`That design is not valid: ${opened.message}`);
}
