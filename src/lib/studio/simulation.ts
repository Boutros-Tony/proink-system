/**
 * The latest stand simulation, kept on this device like the 3D model.
 * IndexedDB holds the picture because a render is too large for localStorage.
 * Swap this store for the database later; the studio only calls these functions.
 */

const DB_NAME = "proink-simulation";
const STORE = "images";
const CURRENT = "current";

let image: string | null = null;
let hydrated = false;
/** A save or a clear in this visit wins over a hydrate that finishes later. */
let touched = false;
const listeners = new Set<() => void>();

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
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(CURRENT);
    request.onsuccess = () => {
      const saved = request.result as { id: string; image?: string } | undefined;
      if (touched || image || typeof saved?.image !== "string" || !saved.image) return;
      image = saved.image;
      publish();
    };
  });
}

export function getSimulation() {
  hydrate();
  return image;
}

export function getServerSimulation() {
  return null;
}

export function subscribeSimulation(listener: () => void) {
  hydrate();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Remember the picture just generated. Replaces the previous one. */
export function setSimulation(next: string) {
  hydrate();
  if (!next || next === image) return;
  touched = true;
  image = next;
  publish();
  void openDatabase().then((db) => {
    if (!db) return;
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put({ id: CURRENT, image: next });
  });
}

/** A new job starts with no picture. */
export function clearSimulation() {
  hydrate();
  touched = true;
  if (image === null) {
    void openDatabase().then((db) => {
      if (!db) return;
      db.transaction(STORE, "readwrite").objectStore(STORE).delete(CURRENT);
    });
    return;
  }
  image = null;
  publish();
  void openDatabase().then((db) => {
    if (!db) return;
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(CURRENT);
  });
}
