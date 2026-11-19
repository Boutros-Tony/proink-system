import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LetterFont } from "@/lib/files/letter-geometry";
import type { StoredMesh } from "@/lib/studio/meshes";
import type { DesignDocument } from "@/lib/systems/modular/schema";
import { fromBlenderScene, toBlenderObjects, type PulledScene } from "./convert";
import { BLENDER_URL, type BlenderRequest, type ExecReply, type LookReply, type LookView, type PingReply, type SaveReply, type SceneReply, type SyncReply } from "./protocol";

/** Blender runs on the studio laptop, so the link only exists when the studio runs there too, or a URL is set. */
export function blenderAllowed() {
  return process.env.NODE_ENV === "development" || Boolean(process.env.BLENDER_URL);
}

type Failure = { ok: false; error: string };

async function call<T>(request: BlenderRequest, timeoutMs = 60_000): Promise<T | Failure> {
  if (!blenderAllowed()) return { ok: false, error: "Blender only connects when the studio runs on the laptop." };
  try {
    const response = await fetch(BLENDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    const reply = (await response.json()) as T | Failure;
    return reply;
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "Blender did not answer in time." : "Blender is not open, or the ProInk Bridge add-on is not running.";
    return { ok: false, error: reason };
  }
}

export function failed(reply: unknown): reply is Failure {
  return !reply || typeof reply !== "object" || (reply as { ok?: unknown }).ok !== true;
}

let font: Promise<LetterFont | null> | null = null;

/** The cut-letter font read from disk, so letters reach Blender as letters and not blocks. */
function letterFont() {
  font ??= readFile(path.join(process.cwd(), "public/fonts/Roboto-Regular.ttf"))
    .then(async (buffer) => {
      const opentype = await import("opentype.js");
      return opentype.parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)) as LetterFont;
    })
    .catch(() => null);
  return font;
}

export function pingBlender() {
  return call<PingReply>({ command: "ping" }, 4_000);
}

/** Make Blender show the stand. Only pieces that changed are rebuilt. Meshes imported in the studio are sent when given. */
export async function pushToBlender(document: DesignDocument, meshes: StoredMesh[] = []) {
  const byId = new Map(meshes.map((mesh) => [mesh.id, mesh]));
  const objects = toBlenderObjects(document, (id) => byId.get(id), await letterFont());
  return call<SyncReply>({ command: "sync", objects, prune: true }, 120_000);
}

/** The stand as it is drawn in Blender, then Blender retagged so both agree. */
export async function pullFromBlender(document: DesignDocument): Promise<(PulledScene & { ok: true; file: string }) | Failure> {
  const scene = await call<SceneReply>({ command: "scene" }, 120_000);
  if (failed(scene)) return scene;
  const pulled = fromBlenderScene(document, scene.objects);
  if (!pulled.empty) {
    const synced = await pushToBlender(pulled.document, pulled.meshes);
    if (failed(synced)) return synced;
  }
  return { ok: true, file: scene.file, ...pulled };
}

export function runInBlender(code: string) {
  return call<ExecReply>({ command: "exec", code }, 180_000);
}

export function lookInBlender(views: LookView[], size = 896) {
  return call<LookReply>({ command: "look", views, size }, 120_000);
}

export function saveBlender(file?: string) {
  return call<SaveReply>({ command: "save", ...(file ? { path: file } : {}) }, 60_000);
}
