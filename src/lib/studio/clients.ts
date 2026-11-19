/**
 * The shop's clients, kept on this device for now, the same way the price book is.
 * Settings edits the list and every new chat picks from it. When accounts arrive this file is the only place that changes.
 */

/** Someone to talk to at the client. */
export type ClientContact = { id: string; name: string; role: string; phone: string; email: string };

/** A place where the client's stands go, and how much room there is. Sizes are millimeters and only tracked for now. */
export type ClientLocation = {
  id: string;
  /** The site, for example "Spinneys Dbayeh". */
  place: string;
  /** Where inside it, for example "Entrance" or "Aisle 4". */
  spot: string;
  widthMm: number;
  heightMm: number;
  depthMm: number;
};

export type Client = {
  id: string;
  name: string;
  contacts: ClientContact[];
  locations: ClientLocation[];
  createdAt: number;
};

const KEY = "proink-clients";

const serverClients: Client[] = [];
let clients: Client[] = serverClients;
let hydrated = false;
const listeners = new Set<() => void>();

const text = (value: unknown, max = 160) => (typeof value === "string" ? value.slice(0, max) : "");
const mm = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);

function readContacts(value: unknown): ClientContact[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    return [{ id: text(raw.id) || `contact-${index}`, name: text(raw.name), role: text(raw.role), phone: text(raw.phone, 60), email: text(raw.email) }];
  });
}

function readLocations(value: unknown): ClientLocation[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const raw = item as Record<string, unknown>;
    return [{ id: text(raw.id) || `location-${index}`, place: text(raw.place), spot: text(raw.spot), widthMm: mm(raw.widthMm), heightMm: mm(raw.heightMm), depthMm: mm(raw.depthMm) }];
  });
}

function read(value: unknown): Client[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: Client[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const name = text(raw.name, 120).trim();
    if (!name || typeof raw.id !== "string" || seen.has(raw.id)) continue;
    seen.add(raw.id);
    result.push({
      id: raw.id,
      name,
      contacts: readContacts(raw.contacts),
      locations: readLocations(raw.locations),
      createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    });
  }
  return result;
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const saved = localStorage.getItem(KEY);
  if (!saved) return;
  try {
    clients = read(JSON.parse(saved));
  } catch {
    localStorage.removeItem(KEY);
  }
}

function publish() {
  try {
    localStorage.setItem(KEY, JSON.stringify(clients));
  } catch {
    // Storage can be full or blocked. The clients stay for this visit.
  }
  listeners.forEach((listener) => listener());
}

export function getClients() {
  hydrate();
  return clients;
}

export function getServerClients() {
  return serverClients;
}

export function subscribeClients(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    try {
      clients = event.newValue ? read(JSON.parse(event.newValue)) : [];
    } catch {
      return;
    }
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function findClientByName(name: string) {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  return getClients().find((client) => client.name.toLowerCase() === wanted);
}

/** Creates the client right away. A name that already exists gives back the existing client. */
export function addClient(name: string): Client {
  hydrate();
  const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 120);
  const existing = findClientByName(trimmed);
  if (existing) return existing;
  const client: Client = { id: `client-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: trimmed, contacts: [], locations: [], createdAt: Date.now() };
  clients = [...clients, client];
  publish();
  return client;
}

export function renameClient(id: string, name: string) {
  hydrate();
  const trimmed = name.trim().replace(/\s+/g, " ").slice(0, 120);
  if (!trimmed) return;
  clients = clients.map((client) => (client.id === id ? { ...client, name: trimmed } : client));
  publish();
}

export function removeClient(id: string) {
  hydrate();
  clients = clients.filter((client) => client.id !== id);
  publish();
}

export function newId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Change anything on a client except its name, which has its own check for duplicates. */
/** Replace the whole list, used when the saved clients are loaded from the database. */
export function replaceClients(next: Client[]) {
  hydrate();
  clients = next;
  publish();
}

export function updateClient(id: string, change: (client: Client) => Client) {
  hydrate();
  clients = clients.map((client) => (client.id === id ? change(client) : client));
  publish();
}
