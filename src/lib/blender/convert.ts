import type { BufferGeometry, Mesh, MeshStandardMaterial } from "three";
import { buildExportScene } from "@/lib/files/export-glb";
import type { LetterFont } from "@/lib/files/letter-geometry";
import { guessMaterial } from "@/lib/files/mesh-units";
import type { StoredMesh } from "@/lib/studio/meshes";
import { compileDesign } from "@/lib/systems/modular/compile";
import { itemSlug } from "@/lib/systems/modular/elements";
import { partCenter } from "@/lib/systems/modular/geometry";
import { updateParts } from "@/lib/systems/modular/ops";
import { applyDesignPatch } from "@/lib/systems/modular/patch";
import { partMaterialSchema, partSchema, type DesignDocument, type ScenePart } from "@/lib/systems/modular/schema";
import { flatBoard } from "./flat";
import type { BlenderMaterial, BlenderObjectIn, BlenderObjectOut } from "./protocol";

type Vec = [number, number, number];

/** Meshes made in Blender are stored under ids that start with this, so sync knows never to reshape them. */
export const BLENDER_MESH_PREFIX = "blender-";

/** Studio axes (Y up, +Z toward the viewer) to Blender's (Z up, the viewer at -Y). Same units. */
export function toBlenderAxes([x, y, z]: Vec): Vec {
  return [x, -z, y];
}

export function fromBlenderAxes([x, y, z]: Vec): Vec {
  return [x, z, -y];
}

const tidy = (value: number, places = 6) => Math.round(value * 10 ** places) / 10 ** places;
const tenth = (value: number) => Math.round(value * 10) / 10;

/** Short stable fingerprint of text. */
export function fingerprint(text: string) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x5bd1e995);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

function numbersPrint(values: ArrayLike<number>) {
  const parts: string[] = [];
  for (let index = 0; index < values.length; index += 1) parts.push(String(tidy(values[index], 5)));
  return fingerprint(parts.join(","));
}

function hex(material: MeshStandardMaterial) {
  return `#${material.color.getHexString()}`;
}

function blenderMaterial(material: MeshStandardMaterial, label: string): BlenderMaterial {
  const color = hex(material);
  const alpha = material.transparent ? material.opacity : 1;
  return { name: `ProInk ${label} ${color}${alpha < 1 ? " clear" : ""}`, color, metalness: material.metalness, roughness: material.roughness, alpha };
}

function meshPositions(geometry: BufferGeometry) {
  const source = geometry.getAttribute("position");
  const positions: number[] = new Array(source.count * 3);
  for (let index = 0; index < source.count; index += 1) {
    const [x, y, z] = toBlenderAxes([source.getX(index), source.getY(index), source.getZ(index)]);
    positions[index * 3] = tidy(x);
    positions[index * 3 + 1] = tidy(y);
    positions[index * 3 + 2] = tidy(z);
  }
  const indices = geometry.index ? Array.from(geometry.index.array as ArrayLike<number>) : undefined;
  return { positions, indices };
}

/** A piece made in Blender, which sync renames and retags but never reshapes. */
export function madeInBlender(part: ScenePart) {
  return part.shape === "mesh" && Boolean(part.meshId?.startsWith(BLENDER_MESH_PREFIX));
}

/**
 * The stand as Blender objects: every piece built from the studio's own geometry, so Blender shows exactly
 * what is priced and cut, plus the modular booth for reference. A hidden piece is sent hidden without a mesh.
 */
export function toBlenderObjects(document: DesignDocument, findMesh: (id: string) => StoredMesh | undefined, font: LetterFont | null): BlenderObjectIn[] {
  const byId = new Map(document.parts.map((part) => [part.id, part]));
  const built = buildExportScene(compileDesign(document), document.envelope, findMesh, font);
  const objects: BlenderObjectIn[] = [];
  const placed = new Set<string>();
  let boothIndex = 0;
  try {
    for (const child of built.scene.children) {
      const mesh = child as Mesh;
      if (!mesh.isMesh) continue;
      const material = mesh.material as MeshStandardMaterial;
      const location = toBlenderAxes([mesh.position.x, mesh.position.y, mesh.position.z]).map((value) => tidy(value)) as Vec;
      const rotation: Vec = [0, tidy(-mesh.rotation.z), tidy(mesh.rotation.y)];
      const part = typeof mesh.userData.partId === "string" ? byId.get(mesh.userData.partId) : undefined;
      if (!part) {
        const { positions, indices } = meshPositions(mesh.geometry);
        boothIndex += 1;
        const id = `booth-${boothIndex}`;
        objects.push({ id, name: mesh.name, source: "booth", hash: fingerprint(`${mesh.name}|${location}|${hex(material)}|${numbersPrint(positions)}`), tag: "", positions, indices, location, rotation, hidden: false, material: blenderMaterial(material, "booth") });
        continue;
      }
      placed.add(part.id);
      const tag = JSON.stringify(part);
      const label = part.material ?? "paint";
      if (madeInBlender(part)) {
        objects.push({ id: part.id, name: part.name, source: "blender", hash: fingerprint(`blender|${tag}`), tag, location, rotation, hidden: false, material: blenderMaterial(material, label) });
        continue;
      }
      const missingMesh = part.shape === "mesh" && !(part.meshId && findMesh(part.meshId));
      const lettersDrawn = part.shape !== "letters" || Boolean(font);
      const geometry = missingMesh ? {} : meshPositions(mesh.geometry);
      objects.push({
        id: part.id,
        name: part.name,
        source: "studio",
        hash: fingerprint(`studio|${tag}|${lettersDrawn ? "font" : "block"}|${missingMesh ? "kept" : "mesh"}`),
        tag,
        ...geometry,
        location,
        rotation,
        hidden: false,
        material: blenderMaterial(material, label),
      });
    }
  } finally {
    built.scene.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }
  for (const part of document.parts) {
    if (placed.has(part.id) || !part.hidden) continue;
    const center = partCenter(part);
    const tag = JSON.stringify(part);
    const location = toBlenderAxes([center.x / 1000, center.y / 1000, center.z / 1000]).map((value) => tidy(value)) as Vec;
    objects.push({
      id: part.id,
      name: part.name,
      source: madeInBlender(part) ? "blender" : "studio",
      hash: fingerprint(`hidden|${tag}`),
      tag,
      location,
      rotation: [0, part.shape === "cylinder" ? 0 : tidy((-(part.tilt ?? 0) * Math.PI) / 180), part.shape === "cylinder" ? 0 : tidy(((part.rotation ?? 0) * Math.PI) / 180)],
      hidden: true,
      material: { name: `ProInk ${part.material ?? "paint"} ${part.color ?? "#f3efe6"}`, color: part.color ?? "#f3efe6", metalness: 0, roughness: 0.6, alpha: 1 },
    });
  }
  return objects;
}

/** Blender's Euler XYZ as a matrix, applied to a vector: X first, then Y, then Z. */
function rotate([x, y, z]: Vec, [a, b, c]: Vec): Vec {
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  const y1 = y * ca - z * sa;
  const z1 = y * sa + z * ca;
  const x2 = x * cb + z1 * sb;
  const z2 = -x * sb + z1 * cb;
  return [x2 * cc - y1 * sc, x2 * sc + y1 * cc, z2];
}

const degrees = (radians: number) => Math.round(((radians * 180) / Math.PI) * 10) / 10;

type Meta = { name?: string; material?: string; kind?: string; item?: string; materialId?: string; color?: string; group?: string };

function readTag(tag: string): Record<string, unknown> | null {
  if (!tag) return null;
  try {
    const parsed: unknown = JSON.parse(tag);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function metaOf(tag: Record<string, unknown> | null): Meta {
  if (!tag) return {};
  const text = (key: string) => (typeof tag[key] === "string" && (tag[key] as string).trim() ? (tag[key] as string).trim() : undefined);
  return { name: text("name"), material: text("material"), kind: text("kind"), item: text("item"), materialId: text("materialId"), color: text("color"), group: text("group") };
}

/** Blender adds .001 to a copied name. The piece keeps its own name unless it was really renamed. */
function keptName(blenderName: string, studioName: string) {
  const plain = blenderName.replace(/\.\d{3}$/, "");
  return plain === studioName ? studioName : blenderName;
}

/** A piece modeled in Blender: its evaluated mesh turned and scaled as it stands, centered in its own box. */
function freeformPiece(object: BlenderObjectOut, meta: Meta) {
  const raw = object.positions ?? [];
  const points: Vec[] = [];
  const min: Vec = [Infinity, Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index + 2 < raw.length; index += 3) {
    const scaled: Vec = [raw[index] * object.scale[0], raw[index + 1] * object.scale[1], raw[index + 2] * object.scale[2]];
    const point = fromBlenderAxes(rotate(scaled, object.rotation)).map((value) => value * 1000) as Vec;
    points.push(point);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  if (points.length < 3) return null;
  const middle = min.map((value, axis) => (value + max[axis]) / 2) as Vec;
  const positions = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    for (let axis = 0; axis < 3; axis += 1) positions[index * 3 + axis] = tidy(point[axis] - middle[axis], 3);
  });
  const indices = object.indices && object.indices.length > 0 ? Uint32Array.from(object.indices) : null;
  const [width, height, depth] = max.map((value, axis) => Math.max(1, tenth(value - min[axis])));
  const meshId = `${BLENDER_MESH_PREFIX}${numbersPrint(positions)}${indices ? numbersPrint(indices).slice(0, 8) : ""}`;
  const stored: StoredMesh = { id: meshId, positions, indices, width, height, depth };
  const origin = fromBlenderAxes(object.location).map((value) => value * 1000) as Vec;
  const center = origin.map((value, axis) => value + middle[axis]) as Vec;
  const material = partMaterialSchema.safeParse(meta.material ?? guessMaterial(object.materialName) ?? guessMaterial(object.name));
  const kind = ["built", "letters", "equipment", "rental"].includes(meta.kind ?? "") ? (meta.kind as ScenePart["kind"]) : undefined;
  const part: ScenePart = {
    id: object.id,
    name: meta.name ? keptName(object.name, meta.name) : object.name,
    shape: "mesh",
    meshId,
    x: tenth(center[0] - width / 2),
    y: tenth(center[1] - height / 2),
    z: tenth(center[2] - depth / 2),
    width,
    height,
    depth,
    ...(material.success ? { material: material.data } : {}),
    ...(meta.materialId ? { materialId: meta.materialId } : {}),
    ...(meta.color ? { color: meta.color } : {}),
    ...(kind ? { kind } : {}),
    ...(meta.group ? { group: meta.group } : meta.item ? { group: itemSlug(meta.item) } : {}),
    ...(object.hidden ? { hidden: true } : {}),
  };
  return { part, stored, item: meta.item };
}

/** The evaluated mesh's corners where the object stands, in studio millimeters and axes. */
function placedPoints(object: BlenderObjectOut) {
  const raw = object.positions ?? [];
  const origin = fromBlenderAxes(object.location).map((value) => value * 1000);
  const points: Vec[] = [];
  for (let index = 0; index + 2 < raw.length; index += 3) {
    const scaled: Vec = [raw[index] * object.scale[0], raw[index + 1] * object.scale[1], raw[index + 2] * object.scale[2]];
    points.push(fromBlenderAxes(rotate(scaled, object.rotation)).map((value, axis) => value * 1000 + origin[axis]) as Vec);
  }
  return points;
}

/** A flat piece modeled or reshaped in Blender, as a board the studio cuts, prices, and draws. Null when it is not one. */
function boardPiece(object: BlenderObjectOut, meta: Meta, base: ScenePart | null) {
  if (base?.shape === "letters" || meta.kind === "letters" || !object.positions?.length) return null;
  const board = flatBoard(placedPoints(object), object.indices ?? null);
  if (!board) return null;
  const material = partMaterialSchema.safeParse(meta.material ?? guessMaterial(object.materialName) ?? guessMaterial(object.name));
  const kind = ["built", "equipment", "rental"].includes(meta.kind ?? "") ? (meta.kind as ScenePart["kind"]) : undefined;
  const parsed = partSchema.safeParse({
    id: object.id,
    name: meta.name ? keptName(object.name, meta.name) : object.name,
    shape: "box",
    ...board,
    ...(material.success ? { material: material.data } : {}),
    ...(meta.materialId ? { materialId: meta.materialId } : {}),
    ...(meta.color ? { color: meta.color } : {}),
    ...(kind ? { kind } : {}),
    ...(meta.group ? { group: meta.group } : meta.item ? { group: itemSlug(meta.item) } : {}),
    ...(base?.locked ? { locked: true } : {}),
    ...(base?.images?.length ? { images: base.images } : {}),
    ...(object.hidden ? { hidden: true } : {}),
  });
  return parsed.success ? { part: parsed.data, item: meta.item } : null;
}

/** A studio piece as Blender has it now: moved, turned, or stretched there, its shape otherwise its own. */
function studioPiece(document: DesignDocument, object: BlenderObjectOut, base: ScenePart, notes: string[]) {
  const [sx, sy, sz] = object.scale;
  const width = tenth(base.width * Math.abs(sx));
  const height = tenth(base.height * Math.abs(sz));
  const depth = base.shape === "cylinder" ? width : tenth(base.depth * Math.abs(sy));
  const center = fromBlenderAxes(object.location).map((value) => value * 1000) as Vec;
  const [rx, ry, rz] = object.rotation;
  const upright = base.shape === "cylinder";
  if (Math.abs(rx) > 0.005 || (upright && (Math.abs(ry) > 0.005 || Math.abs(rz) > 0.005))) {
    notes.push(`${object.name}: turned in a way the studio cannot build, so it was set back ${upright ? "upright" : "to a turn about the vertical and a tilt seen from the front"}.`);
  }
  const changes = {
    name: keptName(object.name, base.name),
    width,
    height,
    depth,
    x: tenth(center[0] - width / 2),
    y: tenth(center[1] - height / 2),
    z: tenth(center[2] - depth / 2),
    ...(upright ? {} : { rotation: degrees(rz), tilt: degrees(-ry) }),
    hidden: object.hidden,
  };
  const loose: ScenePart = { ...base, id: object.id, locked: false };
  const [moved] = updateParts({ ...document, parts: [loose] }, [object.id], changes).parts;
  const part: ScenePart = { ...moved };
  if (base.locked) part.locked = true;
  else delete part.locked;
  if (!part.hidden) delete part.hidden;
  if (part.tilt === 0) delete part.tilt;
  if (part.rotation === 0) delete part.rotation;
  return part;
}

export type PulledScene = { document: DesignDocument; meshes: StoredMesh[]; notes: string[]; empty: boolean };

/**
 * The stand as it is drawn in Blender. Studio pieces keep their shape, material, and every cut, and take Blender's
 * position, turn, and size. Pieces modeled or reshaped in Blender that are flat boards, standing or lying, become
 * boards cut from sheet with their outline and openings. Anything else becomes a custom piece priced from its size.
 * Pieces deleted in Blender are removed. A Blender scene with no ProInk objects at all leaves the stand untouched.
 */
export function fromBlenderScene(document: DesignDocument, objects: BlenderObjectOut[]): PulledScene {
  const drawn = objects.filter((object) => object.source !== "booth");
  const notes: string[] = [];
  if (document.parts.length > 0 && !drawn.some((object) => object.hash)) return { document, meshes: [], notes, empty: true };

  const parts: ScenePart[] = [];
  const meshes: StoredMesh[] = [];
  const groups: Record<string, string> = { ...(document.groups ?? {}) };
  let custom = 0;
  let boards = 0;
  let unnamed = 0;
  for (const object of drawn) {
    const tag = readTag(object.tag);
    const studio = object.source === "studio" ? partSchema.safeParse(tag ?? {}) : null;
    if (studio?.success && !object.reshaped) {
      parts.push(studioPiece(document, object, studio.data, notes));
      continue;
    }
    const board = boardPiece(object, metaOf(tag), studio?.success ? studio.data : null);
    if (board) {
      parts.push(board.part);
      if (board.item && board.part.group) groups[board.part.group] = board.item;
      boards += 1;
      if (!board.part.material && !board.part.materialId) unnamed += 1;
      continue;
    }
    if (object.source === "studio" && object.reshaped) notes.push(`${object.name}: its mesh was changed in Blender, so it is now a custom piece priced from its size, not cut from board.`);
    const piece = freeformPiece(object, metaOf(tag));
    if (!piece) continue;
    parts.push(piece.part);
    meshes.push(piece.stored);
    if (piece.item && piece.part.group) groups[piece.part.group] = piece.item;
    custom += 1;
    if (!piece.part.material && !piece.part.materialId) unnamed += 1;
  }

  const seen = new Set(parts.map((part) => part.id));
  // A hidden piece, or a mesh imported in the studio, may never have reached Blender, so it was not deleted there.
  const unsent = document.parts.filter((part) => !seen.has(part.id) && (part.hidden || (part.shape === "mesh" && !madeInBlender(part))));
  parts.push(...unsent);
  const order = new Map(document.parts.map((part, index) => [part.id, index]));
  parts.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  const kept = new Set(parts.map((part) => part.id));
  const removed = document.parts.filter((part) => !kept.has(part.id)).length;
  if (removed > 0) notes.push(`${removed} ${removed === 1 ? "piece was" : "pieces were"} deleted in Blender.`);
  if (boards > 0) notes.push(`${boards} flat ${boards === 1 ? "piece" : "pieces"} from Blender ${boards === 1 ? "is" : "are"} now cut from board, with ${boards === 1 ? "its" : "their"} outline and openings.`);
  if (custom > 0) notes.push(`${custom} custom ${custom === 1 ? "piece is" : "pieces are"} priced from ${custom === 1 ? "its" : "their"} size.`);
  if (unnamed > 0) notes.push(`${unnamed} ${unnamed === 1 ? "piece has" : "pieces have"} no material yet: name the Blender material MDF, wood, metal, glass, laminate, or paint, or pick it in the Edit panel.`);
  const next = applyDesignPatch(document, { parts, ...(Object.keys(groups).length > 0 ? { groups } : {}) });
  return { document: next, meshes, notes, empty: false };
}
