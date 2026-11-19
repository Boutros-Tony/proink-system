/**
 * Imported 3D geometry, kept in the browser. A design only stores the mesh id, the same way
 * pictures are stored, so the file can be large without being sent to the AI on every message.
 */

export type StoredMesh = {
  id: string;
  /** Centered on the origin, in millimeters, before any resize in the studio. */
  positions: Float32Array;
  indices: Uint32Array | null;
  width: number;
  height: number;
  depth: number;
};

const DB_NAME = "proink-meshes";
const STORE = "meshes";

const cache = new Map<string, StoredMesh>();
let hydrated = false;
const listeners = new Set<() => void>();
let savedHook: ((mesh: StoredMesh) => void) | null = null;

/** Cloud sync registers this so a new mesh is copied to storage. */
export function onMeshSaved(hook: (mesh: StoredMesh) => void) {
  savedHook = hook;
}

function publish() {
  listeners.forEach((listener) => listener());
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  void openDatabase().then((db) => {
    if (!db) return;
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => {
      for (const mesh of request.result as StoredMesh[]) {
        if (!cache.has(mesh.id)) cache.set(mesh.id, mesh);
      }
      publish();
    };
  });
}

export function subscribeMeshes(listener: () => void) {
  hydrate();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getMesh(id: string | undefined) {
  hydrate();
  return id ? cache.get(id) : undefined;
}

export function localMeshes() {
  return new Promise<StoredMesh[]>((resolve) => {
    void openDatabase().then((db) => {
      if (!db) {
        resolve([]);
        return;
      }
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result as StoredMesh[]);
      request.onerror = () => resolve([]);
    });
  });
}

/** Add meshes loaded from storage. Does not upload them again. */
export function installMeshes(meshes: StoredMesh[]) {
  for (const mesh of meshes) cache.set(mesh.id, mesh);
  publish();
  void saveMeshes(meshes, false);
}

export async function saveMeshes(meshes: StoredMesh[], upload = true) {
  for (const mesh of meshes) cache.set(mesh.id, mesh);
  publish();
  const db = await openDatabase();
  if (db && meshes.length > 0) {
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      for (const mesh of meshes) store.put(mesh);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    });
  }
  if (upload) for (const mesh of meshes) savedHook?.(mesh);
}
