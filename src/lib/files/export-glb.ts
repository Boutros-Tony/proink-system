import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SphereGeometry,
} from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import type { StoredMesh } from "@/lib/studio/meshes";
import type { CompiledModel } from "@/lib/systems/modular/compile";
import { buildLetterGeometry, type LetterFont } from "@/lib/files/letter-geometry";
import { boxGeometry } from "@/lib/systems/modular/front-face";
import { roundGeometry, tubeGeometry } from "@/lib/systems/modular/round-geometry";
import { partCenter } from "@/lib/systems/modular/geometry";
import type { PartMaterial } from "@/lib/systems/modular/schema";

/**
 * The 3D model as a glTF binary (.glb) that Blender, Rhino, and every viewer can open. It uses the same
 * numbers the studio draws from: meters, Y up, with the origin at the back-left floor corner of the stand.
 * Every piece keeps its name so it is easy to find again.
 */

const FINISH: Record<PartMaterial, { roughness: number; metalness: number }> = {
  paint: { roughness: 0.52, metalness: 0 },
  mdf: { roughness: 0.94, metalness: 0 },
  wood: { roughness: 0.58, metalness: 0 },
  laminate: { roughness: 0.24, metalness: 0.02 },
  metal: { roughness: 0.28, metalness: 0.88 },
  glass: { roughness: 0.06, metalness: 0 },
};

const PANEL_COLOR = { graphic: "#8f93f5", solid: "#eef0f7", lightbox: "#fff6dc" } as const;

type Position = [number, number, number];

export type ExportScene = { scene: Scene; pieces: number; missingMeshes: number };

function meshGeometry(stored: StoredMesh, width: number, height: number, depth: number) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(stored.positions.slice(), 3));
  if (stored.indices && stored.indices.length > 0) geometry.setIndex(new BufferAttribute(stored.indices.slice(), 1));
  geometry.computeVertexNormals();
  geometry.scale(
    (stored.width > 0 ? width / stored.width : 1) / 1000,
    (stored.height > 0 ? height / stored.height : 1) / 1000,
    (stored.depth > 0 ? depth / stored.depth : 1) / 1000,
  );
  return geometry;
}

/** Put the visible stand into a three.js scene. Sizes and positions in the model are mm, the scene is meters. */
export function buildExportScene(model: CompiledModel, envelope: { width: number; depth: number; height: number }, findMesh: (id: string) => StoredMesh | undefined, letterFont: LetterFont | null = null): ExportScene {
  const scene = new Scene();
  const materials = new Map<string, MeshStandardMaterial>();
  let pieces = 0;
  let missingMeshes = 0;

  const material = (color: string, metalness = 0, roughness = 0.6, extra?: { opacity?: number; emissive?: string; doubleSided?: boolean }) => {
    const key = `${color}|${metalness}|${roughness}|${extra?.opacity ?? 1}|${extra?.emissive ?? ""}|${extra?.doubleSided ?? false}`;
    let made = materials.get(key);
    if (!made) {
      made = new MeshStandardMaterial({
        color,
        metalness,
        roughness,
        transparent: (extra?.opacity ?? 1) < 1,
        opacity: extra?.opacity ?? 1,
        emissive: extra?.emissive ?? "#000000",
        side: extra?.doubleSided ? DoubleSide : undefined,
      });
      materials.set(key, made);
    }
    return made;
  };

  const place = (name: string, geometry: BufferGeometry, mat: MeshStandardMaterial, at: Position, rotationY = 0, tiltZ = 0, partId?: string) => {
    const mesh = new Mesh(geometry, mat);
    mesh.name = name;
    if (partId) mesh.userData.partId = partId;
    mesh.position.set(at[0] / 1000, at[1] / 1000, at[2] / 1000);
    // Tilt (Z) happens in the piece's own frame, then the vertical turn (Y).
    mesh.rotation.order = "YXZ";
    mesh.rotation.set(0, rotationY, tiltZ);
    scene.add(mesh);
    pieces += 1;
  };
  const box = (width: number, height: number, depth: number) => new BoxGeometry(width / 1000, height / 1000, depth / 1000);

  if (model.floor) place("Floor", box(envelope.width, 20, envelope.depth), material("#c3c8da", 0, 0.9), [envelope.width / 2, 10, envelope.depth / 2]);

  for (const post of model.posts) place("Post", box(post.size, post.height, post.size), material("#aab2c4", 0.45, 0.35), [post.x, post.height / 2, post.z]);

  for (const beam of model.beams) {
    const dx = beam.x2 - beam.x1;
    const dz = beam.z2 - beam.z1;
    place(`Beam ${beam.edge} ${beam.bayIndex + 1} ${beam.level}`, box(Math.hypot(dx, dz), beam.profile, beam.profile), material("#bcc3d2", 0.4, 0.4), [(beam.x1 + beam.x2) / 2, beam.y, (beam.z1 + beam.z2) / 2], Math.atan2(dz / 1000, dx / 1000));
  }

  for (const panel of model.panels) {
    const horizontal = panel.edge === "back" || panel.edge === "front";
    place(
      `Panel ${panel.edge} ${panel.bayIndex + 1} (${panel.kind})`,
      horizontal ? box(panel.width, panel.height, panel.thickness) : box(panel.thickness, panel.height, panel.width),
      material(PANEL_COLOR[panel.kind], 0, 0.6),
      [panel.x, panel.y, panel.z],
    );
  }

  for (const fascia of model.fascias) {
    const sideways = fascia.edge === "left" || fascia.edge === "right";
    place(
      `Fascia ${fascia.edge}`,
      sideways ? box(fascia.thickness, fascia.height, fascia.length) : box(fascia.length, fascia.height, fascia.thickness),
      material("#1a1d33", 0, 0.6),
      [fascia.x, fascia.y, fascia.z],
    );
  }

  for (const counter of model.counters) place("Counter", box(counter.width, counter.height, counter.depth), material("#3d3f6e", 0, 0.6), [counter.x, counter.y, counter.z]);

  for (const spot of model.spots) place("Spotlight", new SphereGeometry(0.045, 16, 16), material("#f0c14a", 0, 0.5, { emissive: "#f0c14a" }), [spot.x, spot.y, spot.z]);

  for (const part of model.parts) {
    if (part.hidden) continue;
    const center = partCenter(part);
    const finish = FINISH[part.material ?? "paint"];
    const glass = part.material === "glass";
    const mat = material(part.color ?? "#f3efe6", finish.metalness, finish.roughness, { opacity: glass ? 0.42 : 1, doubleSided: part.shape === "mesh" });
    let geometry: BufferGeometry;
    if (part.shape === "mesh") {
      const stored = part.meshId ? findMesh(part.meshId) : undefined;
      if (!stored) missingMeshes += 1;
      geometry = stored ? meshGeometry(stored, part.width, part.height, part.depth) : box(part.width, part.height, part.depth);
    } else if (part.shape === "letters") {
      geometry = (letterFont && buildLetterGeometry(letterFont, part.label?.trim() || part.name, part.width, part.height, part.depth)) || box(part.width, part.height, part.depth);
    } else if (part.shape === "cylinder") {
      geometry = roundGeometry(part) ?? new CylinderGeometry(part.width / 2000, part.width / 2000, part.height / 1000, 48);
    } else if (part.shape === "tube") {
      geometry = tubeGeometry(part) ?? box(part.width, part.height, part.depth);
    } else {
      geometry = boxGeometry(part) ?? box(part.width, part.height, part.depth);
    }
    const upright = part.shape === "cylinder";
    place(
      part.name,
      geometry,
      mat,
      [center.x, center.y, center.z],
      upright ? 0 : ((part.rotation ?? 0) * Math.PI) / 180,
      upright ? 0 : ((part.tilt ?? 0) * Math.PI) / 180,
      part.id,
    );
  }

  return { scene, pieces, missingMeshes };
}

/** Write the scene as one .glb file and free the geometry. */
export async function exportGlb(built: ExportScene): Promise<ArrayBuffer> {
  try {
    const result = await new GLTFExporter().parseAsync(built.scene, { binary: true });
    if (!(result instanceof ArrayBuffer)) throw new Error("The 3D file could not be written.");
    return result;
  } finally {
    built.scene.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }
}
