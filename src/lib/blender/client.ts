/**
 * The Blender switch in the browser. The server talks to Blender; this store only remembers
 * whether the open project wants that link, and the last answer.
 */

import type { MeshJson } from "@/lib/blender/protocol";
import { getActiveProjectId } from "@/lib/studio/cloud";
import { getMesh, saveMeshes } from "@/lib/studio/meshes";
import { openDesignDocument, type DesignDocument } from "@/lib/systems/modular/schema";

/** Meshes made in Blender. Same prefix as the server, kept here so the browser does not import server code. */
export const BLENDER_MESH_PREFIX = "blender-";

export type BlenderLinkState = {
  on: boolean;
  connected: boolean;
  file: string;
  busy: boolean;
  error: string;
  notes: string[];
};

const EMPTY_NOTES: string[] = [];
const CLOSED: BlenderLinkState = { on: false, connected: false, file: "", busy: false, error: "", notes: EMPTY_NOTES };

let state = CLOSED;
let tracked: string | null | undefined;
let epoch = 0;
/** Set when the last finished pull found an empty Blender scene, so the button can send the stand. */
let emptyPull = false;
/** A document a pull just wrote. The next auto-push skips this exact object. */
let pulled: DesignDocument | null = null;
const listeners = new Set<() => void>();

function publish() {
  listeners.forEach((listener) => listener());
}

function storageKey(id: string) {
  return `proink-blender:${id}`;
}

/** Read the switch for whichever project is open. Returns whether the stored state changed. */
function followProject() {
  if (typeof window === "undefined") return false;
  const id = getActiveProjectId();
  if (id === tracked) return false;
  tracked = id;
  epoch += 1;
  let on = false;
  if (id) {
    try {
      on = localStorage.getItem(storageKey(id)) === "1";
    } catch {
      on = false;
    }
  }
  const next = on ? { on: true, connected: false, file: "", busy: false, error: "", notes: EMPTY_NOTES } : CLOSED;
  if (state === next) return false;
  state = next;
  return true;
}

function adoptProject() {
  if (followProject()) publish();
}

export function syncBlenderProject() {
  adoptProject();
}

export function subscribeBlender(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getBlender() {
  followProject();
  return state;
}

export function getServerBlender() {
  return CLOSED;
}

export function setBlenderOn(id: string, on: boolean) {
  tracked = id;
  epoch += 1;
  try {
    if (on) localStorage.setItem(storageKey(id), "1");
    else localStorage.removeItem(storageKey(id));
  } catch {
    // Storage can be blocked. The switch still works until the page is closed.
  }
  state = on ? { on: true, connected: false, file: "", busy: false, error: "", notes: EMPTY_NOTES } : CLOSED;
  publish();
}

export function blenderLinked() {
  followProject();
  return state.on && state.connected;
}

export function markPulled(document: DesignDocument) {
  pulled = document;
}

export function takePulled(document: DesignDocument) {
  if (pulled !== document) return false;
  pulled = null;
  return true;
}

export function showBlenderNotes(notes: string[]) {
  state = { ...state, notes: notes.length > 0 ? notes : EMPTY_NOTES };
  publish();
}

export function clearBlenderNotes() {
  if (state.notes.length === 0) return;
  state = { ...state, notes: EMPTY_NOTES };
  publish();
}

export function pullWasEmpty() {
  return emptyPull;
}

function begin() {
  const token = ++epoch;
  state = { ...state, busy: true, error: "" };
  publish();
  return token;
}

function finish(token: number, patch: Partial<BlenderLinkState>) {
  if (token !== epoch) return false;
  state = { ...state, ...patch, busy: false };
  publish();
  return true;
}

async function post(body: unknown) {
  try {
    const response = await fetch("/api/blender", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json().catch(() => null)) as unknown;
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function meshesFor(document: DesignDocument): MeshJson[] {
  const meshes: MeshJson[] = [];
  const seen = new Set<string>();
  for (const part of document.parts) {
    const meshId = part.meshId;
    if (part.shape !== "mesh" || !meshId || meshId.startsWith(BLENDER_MESH_PREFIX) || seen.has(meshId)) continue;
    const mesh = getMesh(meshId);
    if (!mesh) continue;
    seen.add(meshId);
    meshes.push({ id: mesh.id, positions: Array.from(mesh.positions), indices: mesh.indices ? Array.from(mesh.indices) : null, width: mesh.width, height: mesh.height, depth: mesh.depth });
  }
  return meshes;
}

function asMeshes(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const mesh = item as Partial<MeshJson>;
    if (typeof mesh.id !== "string" || !Array.isArray(mesh.positions) || mesh.positions.some((value) => typeof value !== "number")) return [];
    const indices = Array.isArray(mesh.indices) && mesh.indices.every((value) => typeof value === "number") ? mesh.indices : null;
    return [{ id: mesh.id, positions: Float32Array.from(mesh.positions), indices: indices ? Uint32Array.from(indices) : null, width: Number(mesh.width) || 1, height: Number(mesh.height) || 1, depth: Number(mesh.depth) || 1 }];
  });
}

function notesOf(data: Record<string, unknown> | null) {
  if (!data || !Array.isArray(data.notes)) return EMPTY_NOTES;
  const notes = data.notes.filter((note): note is string => typeof note === "string" && note.length > 0);
  return notes.length > 0 ? notes : EMPTY_NOTES;
}

export async function refreshStatus() {
  adoptProject();
  if (!state.on) return;
  const token = epoch;
  const data = await post({ action: "status" });
  if (token !== epoch || !state.on) return;
  if (data?.connected === true) state = { ...state, connected: true, file: typeof data.file === "string" ? data.file : "", error: "" };
  else state = { ...state, connected: false, error: typeof data?.error === "string" ? data.error : "Blender is not open." };
  publish();
}

export async function pushDesign(document: DesignDocument, withMeshes: boolean) {
  adoptProject();
  if (!state.on) return;
  const token = begin();
  try {
    const data = await post({ action: "push", document, ...(withMeshes ? { meshes: meshesFor(document) } : {}) });
    if (data?.ok === true) finish(token, { connected: true, file: typeof data.file === "string" ? data.file : state.file, error: "" });
    else finish(token, { error: typeof data?.error === "string" ? data.error : "The stand could not be sent to Blender." });
  } catch (error) {
    finish(token, { error: error instanceof Error ? error.message : "The stand could not be sent to Blender." });
  }
}

/**
 * The design Blender has now, or null when Blender was empty, the pull failed, or a newer request took over.
 * Meshes are saved either way. `meshesOnly` keeps the open design and leaves notes alone: a missing mesh is filled in without applying Blender's scene.
 */
export async function pullDesign(document: DesignDocument, meshesOnly = false) {
  adoptProject();
  if (!state.on) return null;
  if (!meshesOnly) emptyPull = false;
  const token = begin();
  try {
    const data = await post({ action: "pull", document });
    if (data?.ok !== true) {
      finish(token, { error: typeof data?.error === "string" ? data.error : "Blender could not be read." });
      return null;
    }
    const meshes = asMeshes(data.meshes);
    if (meshes.length > 0) await saveMeshes(meshes);
    const notes = notesOf(data);
    const file = typeof data.file === "string" ? data.file : state.file;
    if (meshesOnly) {
      finish(token, { connected: true, file, error: "" });
      return null;
    }
    if (data.empty === true) {
      if (!finish(token, { connected: true, file, error: "", notes })) return null;
      emptyPull = true;
      return null;
    }
    const opened = openDesignDocument(data.document);
    if (opened.status !== "ready") {
      finish(token, { connected: true, file, error: opened.status === "invalid" ? opened.message : "Blender sent a design this studio cannot open.", notes });
      return null;
    }
    if (!finish(token, { connected: true, file, error: "", notes })) return null;
    return opened.document;
  } catch (error) {
    finish(token, { error: error instanceof Error ? error.message : "Blender could not be read." });
    return null;
  }
}

export async function saveBlend() {
  adoptProject();
  if (!state.on) return;
  const token = begin();
  try {
    const data = await post({ action: "save" });
    if (data?.ok === true) finish(token, { connected: true, file: typeof data.file === "string" ? data.file : state.file, error: "" });
    else finish(token, { error: typeof data?.error === "string" ? data.error : "The Blender file could not be saved." });
  } catch (error) {
    finish(token, { error: error instanceof Error ? error.message : "The Blender file could not be saved." });
  }
}
