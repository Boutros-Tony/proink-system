import { BufferAttribute, BufferGeometry, Color, Mesh, Object3D, type Material } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { guessMaterial, millimetersPerUnit, unitLabel } from "@/lib/files/mesh-units";
import type { StoredMesh } from "@/lib/studio/meshes";
import type { PartDraft } from "@/lib/systems/modular/schema";

const MAX_MESHES = 800;
const MAX_VERTICES = 1_500_000;
/** A surface with no thickness still has to occupy a board size, so it can be shown and quoted. */
const MIN_THICKNESS = 1;

export type ImportedModel = {
  fileName: string;
  /** Plain sentence about the unit that was assumed, shown after import. */
  unitNote: string;
  drafts: PartDraft[];
  meshes: StoredMesh[];
  /** Pieces whose file material did not match a shop material. */
  unnamed: number;
};

type RawPiece = {
  name: string;
  geometry: BufferGeometry;
  materialName?: string;
  color?: string;
};

export async function importModelFile(file: File): Promise<ImportedModel> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["glb", "gltf", "obj", "stl"].includes(extension)) {
    throw new Error("Use a glTF (.glb), OBJ, or STL file. Blender, 3ds Max, and Rhino can all export one of those.");
  }
  const buffer = await file.arrayBuffer();
  const root = await loadRoot(extension, buffer, file.name);
  const raw = collect(root, file.name.replace(/\.[^.]+$/, ""));
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh) mesh.geometry?.dispose();
  });
  if (raw.length === 0) throw new Error("That file has no geometry.");

  const extent = largestExtent(raw);
  const scale = millimetersPerUnit(extension, extent);
  const pieces = raw.map((piece) => scaleAndCenter(piece, scale)).filter((piece): piece is CenteredPiece => piece !== null);
  if (pieces.length === 0) throw new Error("That file has no usable surfaces.");

  const base = file.name.replace(/\.[^.]+$/, "") || "Import";
  const minY = Math.min(...pieces.map((piece) => piece.minY));
  const drafts: PartDraft[] = [];
  const meshes: StoredMesh[] = [];
  let unnamed = 0;
  pieces.forEach((piece, index) => {
    const material = guessMaterial(piece.materialName);
    if (!material) unnamed += 1;
    const id = `mesh-${crypto.randomUUID()}`;
    meshes.push({
      id,
      positions: piece.positions,
      indices: piece.indices,
      width: piece.width,
      height: piece.height,
      depth: piece.depth,
    });
    drafts.push({
      name: piece.name || `${base} ${index + 1}`,
      shape: "mesh",
      meshId: id,
      sourceFile: file.name,
      ...(piece.materialName ? { sourceMaterial: piece.materialName } : {}),
      x: Math.round(piece.minX),
      y: Math.round(piece.minY - minY),
      z: Math.round(piece.minZ),
      width: Math.max(1, Math.round(piece.width)),
      height: Math.max(1, Math.round(piece.height)),
      depth: Math.max(1, Math.round(piece.depth)),
      ...(material ? { material } : {}),
      ...(piece.color ? { color: piece.color } : { color: "#d9dbe3" }),
    });
  });

  return {
    fileName: file.name,
    unitNote: `${file.name} was read in ${unitLabel(scale)}.`,
    drafts,
    meshes,
    unnamed,
  };
}

type GltfBuffer = { uri?: string; byteLength?: number };
type GltfView = { buffer?: number; byteOffset?: number; byteLength?: number };
type GltfJson = { buffers?: GltfBuffer[]; bufferViews?: GltfView[] };

/** Turn a JSON glTF, including one whose buffers are inline data URIs, into a single GLB the loader can read. */
function packGltf(buffer: ArrayBuffer): ArrayBuffer {
  const header = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
  if (header.length === 4 && header[0] === 0x67 && header[1] === 0x6c && header[2] === 0x54 && header[3] === 0x46) return buffer;

  let json: GltfJson;
  try {
    json = JSON.parse(new TextDecoder().decode(buffer)) as GltfJson;
  } catch {
    throw new Error("That glTF file could not be read.");
  }
  const sources = json.buffers ?? [];
  if (sources.length === 0 || sources.every((source) => !source.uri)) return buffer;

  const external = sources.find((source) => source.uri && !source.uri.startsWith("data:"));
  if (external?.uri) {
    const name = external.uri.split("/").pop() || external.uri;
    throw new Error(`This glTF needs a separate file (${name}). Export a single .glb instead, which keeps the geometry inside one file.`);
  }

  const chunks: Uint8Array[] = [];
  const starts: number[] = [];
  let offset = 0;
  for (const source of sources) {
    const bytes = decodeDataUri(source.uri ?? "");
    const padding = (4 - ((offset + bytes.length) % 4)) % 4;
    starts.push(offset);
    chunks.push(bytes);
    if (padding > 0) chunks.push(new Uint8Array(padding));
    offset += bytes.length + padding;
  }
  const bin = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) {
    bin.set(chunk, cursor);
    cursor += chunk.length;
  }
  for (const view of json.bufferViews ?? []) {
    view.byteOffset = (view.byteOffset ?? 0) + (starts[view.buffer ?? 0] ?? 0);
    view.buffer = 0;
  }
  json.buffers = [{ byteLength: bin.byteLength }];
  return encodeGlb(json, bin);
}

function decodeDataUri(uri: string) {
  const comma = uri.indexOf(",");
  const payload = comma >= 0 ? uri.slice(comma + 1) : uri;
  const binary = atob(payload.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function encodeGlb(json: unknown, bin: Uint8Array) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;
  const out = new ArrayBuffer(total);
  const view = new DataView(out);
  const bytes = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  let cursor = 12;
  view.setUint32(cursor, jsonBytes.length + jsonPad, true);
  view.setUint32(cursor + 4, 0x4e4f534a, true);
  bytes.set(jsonBytes, cursor + 8);
  bytes.fill(0x20, cursor + 8 + jsonBytes.length, cursor + 8 + jsonBytes.length + jsonPad);
  cursor += 8 + jsonBytes.length + jsonPad;
  view.setUint32(cursor, bin.length + binPad, true);
  view.setUint32(cursor + 4, 0x004e4942, true);
  bytes.set(bin, cursor + 8);
  return out;
}

async function loadRoot(extension: string, buffer: ArrayBuffer, fileName: string): Promise<Object3D> {
  if (extension === "glb" || extension === "gltf") {
    // Exporters such as Rhino write one tiny data-URI buffer per accessor. The loader
    // fetches each of those separately and drops the file. Pack them into one GLB first.
    const gltf = await new GLTFLoader().parseAsync(packGltf(buffer), "");
    return gltf.scene;
  }
  if (extension === "obj") {
    const text = new TextDecoder().decode(buffer);
    return new OBJLoader().parse(text);
  }
  const geometry = new STLLoader().parse(buffer);
  const mesh = new Mesh(geometry);
  mesh.name = fileName.replace(/\.[^.]+$/, "") || "Imported piece";
  const root = new Object3D();
  root.add(mesh);
  return root;
}

function collect(root: Object3D, fallback: string): RawPiece[] {
  root.updateWorldMatrix(true, true);
  const buckets = new Map<Object3D, { name: string; geometries: BufferGeometry[]; materialName?: string; color?: string }>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    const count = geometry.getAttribute("position")?.count ?? 0;
    if (count < 3) {
      geometry.dispose();
      return;
    }
    // A glTF mesh with several materials arrives as sibling meshes. Keep them as one piece.
    const parent = mesh.parent;
    const owner = parent && parent !== root && parent.children.length > 1 && parent.children.every((child) => (child as Mesh).isMesh) ? parent : mesh;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const bucket = buckets.get(owner) ?? {
      name: owner.name || mesh.name || `${fallback} ${buckets.size + 1}`,
      geometries: [],
    };
    if (!bucket.materialName) bucket.materialName = materialName(material);
    if (!bucket.color) bucket.color = materialColor(material);
    bucket.geometries.push(geometry);
    buckets.set(owner, bucket);
  });

  const pieces: RawPiece[] = [];
  let vertices = 0;
  for (const bucket of buckets.values()) {
    if (pieces.length >= MAX_MESHES || vertices >= MAX_VERTICES) {
      bucket.geometries.forEach((geometry) => geometry.dispose());
      continue;
    }
    const geometry = mergeGeometries(bucket.geometries);
    const count = geometry.getAttribute("position")?.count ?? 0;
    vertices += count;
    pieces.push({ name: bucket.name, geometry, materialName: bucket.materialName, color: bucket.color });
  }
  return pieces;
}

function mergeGeometries(geometries: BufferGeometry[]) {
  if (geometries.length === 1) return geometries[0];
  let vertCount = 0;
  let indexCount = 0;
  for (const geometry of geometries) {
    const count = geometry.getAttribute("position").count;
    vertCount += count;
    indexCount += geometry.getIndex()?.count ?? count;
  }
  const positions = new Float32Array(vertCount * 3);
  const indices = new Uint32Array(indexCount);
  let vertex = 0;
  let index = 0;
  for (const geometry of geometries) {
    const position = geometry.getAttribute("position");
    const base = vertex;
    for (let cursor = 0; cursor < position.count; cursor += 1) {
      positions[(vertex + cursor) * 3] = position.getX(cursor);
      positions[(vertex + cursor) * 3 + 1] = position.getY(cursor);
      positions[(vertex + cursor) * 3 + 2] = position.getZ(cursor);
    }
    const source = geometry.getIndex();
    if (source) {
      for (let cursor = 0; cursor < source.count; cursor += 1) indices[index++] = source.getX(cursor) + base;
    } else {
      for (let cursor = 0; cursor < position.count; cursor += 1) indices[index++] = base + cursor;
    }
    vertex += position.count;
    geometry.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute("position", new BufferAttribute(positions, 3));
  merged.setIndex(new BufferAttribute(indices, 1));
  return merged;
}

function materialName(material: Material | undefined) {
  const name = material?.name?.trim();
  return name && name !== "default" ? name : undefined;
}

function materialColor(material: Material | undefined) {
  if (!material || !("color" in material)) return undefined;
  const color = (material as { color?: Color }).color;
  return color instanceof Color ? `#${color.getHexString()}` : undefined;
}

function largestExtent(pieces: RawPiece[]) {
  let max = 0;
  for (const piece of pieces) {
    const position = piece.geometry.getAttribute("position");
    if (!position) continue;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let index = 0; index < position.count; index += 1) {
      minX = Math.min(minX, position.getX(index));
      minY = Math.min(minY, position.getY(index));
      minZ = Math.min(minZ, position.getZ(index));
      maxX = Math.max(maxX, position.getX(index));
      maxY = Math.max(maxY, position.getY(index));
      maxZ = Math.max(maxZ, position.getZ(index));
    }
    max = Math.max(max, maxX - minX, maxY - minY, maxZ - minZ);
  }
  return max;
}

type CenteredPiece = {
  name: string;
  materialName?: string;
  color?: string;
  positions: Float32Array;
  indices: Uint32Array | null;
  width: number;
  height: number;
  depth: number;
  minX: number;
  minY: number;
  minZ: number;
};

function scaleAndCenter(piece: RawPiece, scale: number): CenteredPiece | null {
  const position = piece.geometry.getAttribute("position");
  if (!position) return null;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const positions = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const x = position.getX(index) * scale;
    const y = position.getY(index) * scale;
    const z = position.getZ(index) * scale;
    positions[index * 3] = x;
    positions[index * 3 + 1] = y;
    positions[index * 3 + 2] = z;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }
  let width = maxX - minX;
  let height = maxY - minY;
  let depth = maxZ - minZ;
  // CAD and Rhino exports are often open surfaces: a floor is 3 m by 3 m by exactly 0.
  const spanned = [width, height, depth].filter((size) => size >= 0.5).length;
  if (spanned < 2) return null;
  if (width < 0.5) width = MIN_THICKNESS;
  if (height < 0.5) height = MIN_THICKNESS;
  if (depth < 0.5) depth = MIN_THICKNESS;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const centerZ = (minZ + maxZ) / 2;
  for (let index = 0; index < position.count; index += 1) {
    positions[index * 3] -= centerX;
    positions[index * 3 + 1] -= centerY;
    positions[index * 3 + 2] -= centerZ;
  }
  const source = piece.geometry.getIndex();
  const indices = source ? new Uint32Array(source.count) : null;
  if (source && indices) {
    for (let index = 0; index < source.count; index += 1) indices[index] = source.getX(index);
  }
  piece.geometry.dispose();
  return {
    name: piece.name,
    materialName: piece.materialName,
    color: piece.color,
    positions,
    indices,
    width,
    height,
    depth,
    minX,
    minY,
    minZ,
  };
}
