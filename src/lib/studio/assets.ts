/**
 * The local picture library. Logos and photos are kept in the browser (IndexedDB) and a
 * design only holds their ids. Later this store can be swapped for Supabase Storage
 * without touching the design format.
 */

export type StudioAsset = {
  id: string;
  name: string;
  /** PNG or JPEG data URL, already scaled down to a sensible size. */
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
};

/** Longest side kept for an uploaded picture. Plenty for a screen preview and a print proof. */
export const MAX_ASSET_SIDE = 2048;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const DB_NAME = "proink-studio";
const STORE = "assets";

const empty: StudioAsset[] = [];
let assets: StudioAsset[] = empty;
let hydrated = false;
const listeners = new Set<() => void>();
let savedHook: ((asset: StudioAsset) => void) | null = null;

/** Cloud sync registers this so a new picture is copied to storage. */
export function onAssetSaved(hook: (asset: StudioAsset) => void) {
  savedHook = hook;
}

function publish(next: StudioAsset[]) {
  assets = next;
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

export function localAssets() {
  return readAll();
}

/** Replace the library with pictures loaded from storage. Does not upload them again. */
export function installAssets(list: StudioAsset[]) {
  hydrate();
  publish(list);
  for (const asset of list) void writeOne(asset);
}

async function readAll(): Promise<StudioAsset[]> {
  const db = await openDatabase();
  if (!db) return [];
  return new Promise((resolve) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as StudioAsset[]);
    request.onerror = () => resolve([]);
  });
}

async function writeOne(asset: StudioAsset) {
  const db = await openDatabase();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(asset);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  void readAll().then((saved) => {
    if (saved.length === 0) return;
    const known = new Set(assets.map((asset) => asset.id));
    publish([...assets, ...saved.filter((asset) => !known.has(asset.id))]);
  });
}

export function getAssets() {
  hydrate();
  return assets;
}

export function getServerAssets() {
  return empty;
}

export function getAsset(id: string) {
  return getAssets().find((asset) => asset.id === id);
}

export function subscribeAssets(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("That file could not be read as a picture."));
    image.src = url;
  });
}

/** Read a picture file, scale it down if it is huge, and add it to the library. */
export async function addAssetFromFile(file: File): Promise<StudioAsset> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a PNG, JPG, SVG, or WebP picture.");
  if (file.size > MAX_FILE_BYTES) throw new Error("That picture is larger than 25 MB.");
  hydrate();

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    // An SVG without a size reports 0. Give it a generous raster size.
    const naturalWidth = image.naturalWidth || 1024;
    const naturalHeight = image.naturalHeight || 1024;
    const factor = Math.min(1, MAX_ASSET_SIDE / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(1, Math.round(naturalWidth * factor));
    const height = Math.max(1, Math.round(naturalHeight * factor));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot prepare pictures.");
    const photo = file.type === "image/jpeg";
    if (photo) {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(image, 0, 0, width, height);
    const dataUrl = canvas.toDataURL(photo ? "image/jpeg" : "image/png", 0.9);

    const asset: StudioAsset = {
      id: `img-${crypto.randomUUID().slice(0, 8)}`,
      name: file.name.replace(/\.[^.]+$/, "") || "Picture",
      dataUrl,
      width,
      height,
      bytes: Math.round((dataUrl.length * 3) / 4),
    };
    publish([...assets, asset]);
    await writeOne(asset);
    savedHook?.(asset);
    return asset;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Bring pictures back from a saved folder, keeping their ids so the design still finds them. */
export async function restoreAssets(list: StudioAsset[]) {
  hydrate();
  const known = new Set(assets.map((asset) => asset.id));
  const fresh = list.filter((asset) => !known.has(asset.id));
  if (fresh.length === 0) return;
  publish([...assets, ...fresh]);
  for (const asset of fresh) {
    await writeOne(asset);
    savedHook?.(asset);
  }
}

/** The short list the AI is told about: it can use a picture by id but never sees the pixels. */
export function describeAssets(list: StudioAsset[]) {
  return list.map((asset) => ({ id: asset.id, name: asset.name, width: asset.width, height: asset.height }));
}
