import { blenderAllowed, failed, pingBlender, pullFromBlender, pushToBlender, saveBlender } from "@/lib/blender/bridge";
import type { MeshJson } from "@/lib/blender/protocol";
import { readDesignBody } from "@/lib/files/read-design";
import type { StoredMesh } from "@/lib/studio/meshes";
import { requireStudio } from "@/lib/studio/server-data";

export const maxDuration = 300;

function readMeshes(input: unknown): StoredMesh[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    const mesh = item as Partial<MeshJson>;
    if (typeof mesh?.id !== "string" || !Array.isArray(mesh.positions)) return [];
    return [{ id: mesh.id, positions: Float32Array.from(mesh.positions), indices: Array.isArray(mesh.indices) ? Uint32Array.from(mesh.indices) : null, width: Number(mesh.width) || 1, height: Number(mesh.height) || 1, depth: Number(mesh.depth) || 1 }];
  });
}

function meshJson(mesh: StoredMesh): MeshJson {
  return { id: mesh.id, positions: Array.from(mesh.positions), indices: mesh.indices ? Array.from(mesh.indices) : null, width: mesh.width, height: mesh.height, depth: mesh.depth };
}

/**
 * The link to Blender on the studio laptop.
 * status: is Blender open. push: show the stand in Blender. pull: read the stand back from Blender. save: save the .blend file.
 */
export async function POST(request: Request) {
  if (!(await requireStudio())) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!blenderAllowed()) return Response.json({ connected: false, error: "Blender only connects when the studio runs on the laptop." });
  const body = (await request.json().catch(() => null)) as { action?: string; document?: unknown; meshes?: unknown; path?: string } | null;
  const action = body?.action;

  if (action === "status") {
    const ping = await pingBlender();
    return Response.json(failed(ping) ? { connected: false, error: ping && "error" in ping ? ping.error : "Blender is not open." } : { connected: true, file: ping.file, objects: ping.objects, blender: ping.blender });
  }
  if (action === "save") {
    const saved = await saveBlender(typeof body?.path === "string" ? body.path : undefined);
    return Response.json(saved);
  }
  if (action !== "push" && action !== "pull") return Response.json({ error: "Unknown action." }, { status: 400 });

  const design = readDesignBody(body?.document);
  if ("error" in design) return Response.json({ error: design.error }, { status: design.status });
  if (action === "push") {
    const synced = await pushToBlender(design.document, readMeshes(body?.meshes));
    return Response.json(synced);
  }
  const pulled = await pullFromBlender(design.document);
  if (failed(pulled)) return Response.json(pulled);
  return Response.json({ ok: true, file: pulled.file, empty: pulled.empty, notes: pulled.notes, document: pulled.document, meshes: pulled.meshes.map(meshJson) });
}
