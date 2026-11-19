import type { UIMessage } from "ai";
import { createClient } from "@/lib/supabase/client";
import { readCosting, type Costing } from "@/lib/systems/costing";
import { designKey } from "@/lib/systems/costing";
import { readPriceBook, type PriceBook, type PriceItem } from "@/lib/systems/materials";
import { createEmptyDesign } from "@/lib/systems/modular/patch";
import { openDesignDocument, type DesignDocument } from "@/lib/systems/modular/schema";
import { installAssets, localAssets, onAssetSaved, type StudioAsset } from "./assets";
import { getClients, replaceClients, subscribeClients, type Client } from "./clients";
import { installMeshes, localMeshes, onMeshSaved, type StoredMesh } from "./meshes";
import { getCosting, setCosting, subscribeCosting } from "./costing";
import { getJob, setJob, subscribeJob, type SourceKind } from "./job";
import { getBooth, replaceBooth, subscribeBooth } from "./local-booth";
import { getPriceBook, setPriceBook, subscribePriceBook } from "./price-book";
import { clearSimulation, setSimulation } from "./simulation";

export type ChatMode = "quote" | "design" | "image";

export type SavedJob = {
  projectId: string;
  chatId: string;
  title: string;
  mode: ChatMode;
  sourceKind: SourceKind;
  clientId: string | null;
  clientName: string;
  margin: number;
  document: DesignDocument;
  costing: Costing;
  messages: UIMessage[];
  simulationPath: string | null;
  /** A reply is still being written on the server. */
  running: boolean;
};

/** A reply ends within about two minutes. A mark older than this was left by a server that stopped, so it is ignored. */
const RUN_WINDOW_MS = 150_000;

function isRunning(startedAt: string | null | undefined) {
  if (!startedAt) return false;
  return Date.now() - new Date(startedAt).getTime() < RUN_WINDOW_MS;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let applying = false;
/** Design and cost saves start only after a job is on screen, so the empty startup design is never written over a saved one. */
let savesLive = false;
let started = false;
let projectId: string | null = null;
let chatId: string | null = null;
let designStamp = "";
let cloudError: string | null = null;
const cloudListeners = new Set<() => void>();

export function getCloudError() {
  return cloudError;
}

export function subscribeCloudError(listener: () => void) {
  cloudListeners.add(listener);
  return () => cloudListeners.delete(listener);
}
const files = new Map<string, string>();
const pending = new Map<string, () => Promise<void>>();
const timers = new Map<string, number>();

export function getActiveProjectId() {
  return projectId;
}

export function getActiveChatId() {
  return chatId;
}

export function setActiveJob(next: { projectId: string; chatId: string }) {
  projectId = next.projectId;
  chatId = next.chatId;
}

export function noteFile(filename: string, path: string) {
  files.set(filename, path);
}

function apply(run: () => void) {
  applying = true;
  try {
    run();
  } finally {
    applying = false;
  }
}

function schedule(key: string, run: () => Promise<void>, wait = 800) {
  pending.set(key, run);
  window.clearTimeout(timers.get(key));
  timers.set(key, window.setTimeout(() => void runPending(key), wait));
}

async function runPending(key: string) {
  const run = pending.get(key);
  pending.delete(key);
  if (run) await run().catch(fail);
}

export function cancelScheduled(key: string) {
  pending.delete(key);
  const timer = timers.get(key);
  if (timer !== undefined) window.clearTimeout(timer);
  timers.delete(key);
}

export async function flushCloud() {
  const runs = [...pending.entries()];
  pending.clear();
  for (const [key, run] of runs) {
    window.clearTimeout(timers.get(key));
    await run().catch(fail);
  }
}

function fail(error: unknown) {
  cloudError = error instanceof Error ? error.message : "The job could not be saved.";
  cloudListeners.forEach((listener) => listener());
}

function client() {
  return createClient();
}

export function startCloudSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  subscribePriceBook(() => {
    if (!applying) schedule("book", savePriceBook);
  });
  subscribeClients(() => {
    if (!applying) schedule("clients", saveClients);
  });
  subscribeCosting(() => {
    if (!applying && savesLive) schedule("costing", saveCosting);
  });
  subscribeBooth(() => {
    if (!applying && savesLive) schedule("design", saveDesign, 1200);
  });
  subscribeJob(() => {
    if (!applying) schedule("job", saveJobMeta, 400);
  });
  onAssetSaved((asset) => void uploadImage(asset));
  onMeshSaved((mesh) => void uploadMesh(mesh));
}

/** Prices and clients, for the settings pages. Jobs stay on the studio. */
export async function loadShop() {
  const supabase = client();
  await Promise.all([pullPriceBook(supabase), pullClients(supabase)]);
}

let opening: Promise<SavedJob[]> | null = null;

/** Load the jobs once. A send that starts while this is still running waits for the same load. */
export function openStudio() {
  if (!opening) {
    opening = loadStudio().finally(() => {
      opening = null;
    });
  }
  return opening;
}

export async function loadStudio(): Promise<SavedJob[]> {
  cloudError = null;
  const supabase = client();
  await loadShop();
  void pullLibrary();
  const { data, error } = await supabase
    .from("studio_chats")
    .select("id, title, mode, messages, run_started_at, studio_projects(id, title, client_id, client_name, source_kind, margin_percent, document, costing, simulation_path, updated_at)")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  const jobs = (data ?? []).flatMap((row) => readJob(row as unknown as ChatRow));
  if (jobs.length > 0) return jobs;
  return [await createJob({ title: "New chat", mode: "quote", document: getBooth(), costing: getCosting() })];
}

export async function createJob(input: {
  title: string;
  mode: ChatMode;
  document?: DesignDocument;
  costing?: Costing;
  client?: { id: string | null; name: string };
  margin?: number;
  sourceKind?: SourceKind;
}): Promise<SavedJob> {
  const supabase = client();
  const current = getJob();
  const meta = {
    client: input.client ?? current.client,
    margin: input.margin ?? current.margin,
    sourceKind: input.sourceKind ?? current.sourceKind,
  };
  const document = input.document ?? createEmptyDesign();
  const costing = input.costing ?? readCosting(null);
  const { data: project, error } = await supabase
    .from("studio_projects")
    .insert({
      title: input.title,
      client_id: uuidOrNull(meta.client.id),
      client_name: meta.client.name,
      source_kind: meta.sourceKind,
      margin_percent: meta.margin,
      document,
      costing,
    })
    .select("id")
    .single();
  if (error || !project) throw new Error(error?.message ?? "The job could not be created.");
  const { data: chat, error: chatError } = await supabase
    .from("studio_chats")
    .insert({ project_id: project.id, mode: input.mode, title: input.title, messages: [] })
    .select("id")
    .single();
  if (chatError || !chat) throw new Error(chatError?.message ?? "The chat could not be created.");
  return {
    projectId: project.id,
    chatId: chat.id,
    title: input.title,
    mode: input.mode,
    sourceKind: meta.sourceKind,
    clientId: uuidOrNull(meta.client.id),
    clientName: meta.client.name,
    margin: meta.margin,
    document,
    costing,
    messages: [],
    simulationPath: null,
    running: false,
  };
}

export function showJob(job: SavedJob) {
  // A save queued before this job opened would land on the new project and replace its design.
  cancelScheduled("design");
  cancelScheduled("costing");
  setActiveJob(job);
  designStamp = designKey(job.document);
  apply(() => {
    replaceBooth(job.document);
    setCosting(job.costing);
    setJob({
      client: { id: job.clientId, name: job.clientName },
      margin: job.margin,
      sourceKind: job.sourceKind,
    });
  });
  savesLive = true;
  void restoreSimulation(job.simulationPath);
  void loadDesignMeshes(job.document);
}

export async function deleteJob(id: string) {
  const supabase = client();
  // Every simulation is kept under the project's folder, not only the latest one on the project row.
  const [attachments, quotes, project, simulations] = await Promise.all([
    supabase.from("studio_attachments").select("bucket, path").eq("project_id", id),
    supabase.from("studio_quotations").select("id, pdf_path").eq("project_id", id),
    supabase.from("studio_projects").select("simulation_path").eq("id", id).maybeSingle(),
    supabase.storage.from("studio-simulations").list(id, { limit: 1000 }),
  ]);
  const failed = attachments.error ?? quotes.error ?? project.error ?? simulations.error;
  if (failed) throw new Error(failed.message);
  const files = new Map<string, Set<string>>();
  const add = (bucket: string, path: string | null) => {
    if (!path) return;
    const list = files.get(bucket) ?? new Set<string>();
    list.add(path);
    files.set(bucket, list);
  };
  for (const row of attachments.data ?? []) add(row.bucket as string, row.path as string);
  if (project.data?.simulation_path) add("studio-simulations", project.data.simulation_path as string);
  for (const file of simulations.data ?? []) add("studio-simulations", `${id}/${file.name}`);
  for (const row of quotes.data ?? []) add("studio-quotations", row.pdf_path as string | null);
  const removedFiles = await Promise.all([...files.entries()].map(([bucket, paths]) => supabase.storage.from(bucket).remove([...paths])));
  const fileError = removedFiles.find((result) => result.error)?.error;
  if (fileError) throw new Error(fileError.message);

  const quoteIds = (quotes.data ?? []).map((row) => row.id as string);
  if (quoteIds.length > 0) {
    await supabase.from("studio_corrections").delete().in("quotation_id", quoteIds);
    const removed = await supabase.from("studio_quotations").delete().in("id", quoteIds);
    if (removed.error) throw new Error(removed.error.message);
  }
  await supabase.from("studio_corrections").delete().eq("project_id", id);
  const { error } = await supabase.from("studio_projects").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** The chat's name and mode. Messages are stored by the server after each reply, never from the browser. */
export async function saveChatMeta(id: string, meta: { title: string; mode: ChatMode }) {
  const { error } = await client().from("studio_chats").update(meta).eq("id", id);
  if (error) fail(error);
}

export function scheduleChatMeta(id: string, meta: { title: string; mode: ChatMode }) {
  schedule(`chat:${id}`, () => saveChatMeta(id, meta), 400);
}

/** One chat as stored: its messages, and whether a reply is still being written. Null when the database could not be read. */
export async function loadChatState(id: string): Promise<{ messages: UIMessage[]; running: boolean } | null> {
  const { data, error } = await client().from("studio_chats").select("messages, run_started_at").eq("id", id).maybeSingle();
  if (error || !data) return null;
  return { messages: Array.isArray(data.messages) ? (data.messages as UIMessage[]) : [], running: isRunning(data.run_started_at as string | null) };
}

/** Show the drawing and costs a reply running on the server has stored so far. Nothing is saved back. */
export async function reloadJobWork() {
  if (!projectId) return;
  const id = projectId;
  const { data, error } = await client().from("studio_projects").select("document, costing, simulation_path").eq("id", id).maybeSingle();
  if (error || !data || projectId !== id) return;
  const opened = openDesignDocument(data.document);
  if (opened.status === "ready") {
    designStamp = designKey(opened.document);
    apply(() => replaceBooth(opened.document));
  }
  apply(() => setCosting(readCosting(data.costing)));
  if (data.simulation_path) void restoreSimulation(data.simulation_path as string);
}

/** Ask the server to end the reply on this chat. */
export async function stopChatRun(id: string) {
  await fetch("/api/chat/stop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chatId: id }) }).catch(() => undefined);
}

/** Where this session's attachments were uploaded, by file name, so the server can store links instead of the files. */
export function attachmentPaths() {
  return Object.fromEntries(files);
}

export async function uploadAttachment(file: File) {
  if (!projectId) throw new Error("Open a job before attaching a file.");
  const path = `${projectId}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const supabase = client();
  const { error } = await supabase.storage.from("studio-attachments").upload(path, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw new Error(error.message);
  await supabase.from("studio_attachments").insert({ project_id: projectId, bucket: "studio-attachments", path, filename: file.name, mime: file.type, bytes: file.size });
  noteFile(file.name, path);
  return path;
}

async function restoreSimulation(path: string | null) {
  clearSimulation();
  if (!path) return;
  const { data } = await client().storage.from("studio-simulations").createSignedUrl(path, 60 * 60);
  if (data?.signedUrl) setSimulation(data.signedUrl);
}

async function pullPriceBook(supabase: ReturnType<typeof client>) {
  const [materials, items, catalog, rules] = await Promise.all([
    supabase.from("studio_materials").select("*"),
    supabase.from("studio_price_items").select("*"),
    supabase.from("studio_catalog_prices").select("sku, price_cents"),
    supabase.from("studio_settings").select("value").eq("key", "shop_rules").maybeSingle(),
  ]);
  if (!materials.data?.length && !items.data?.length) {
    await writePriceBook(getPriceBook());
    return;
  }
  const prices: Record<string, number> = {};
  for (const row of catalog.data ?? []) prices[row.sku] = row.price_cents;
  apply(() =>
    setPriceBook(
      readPriceBook({
        version: 1,
        starter: 2,
        materials: (materials.data ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          piece: row.piece,
          unit: row.unit,
          priceCents: row.price_cents,
          ...(row.board_width_mm ? { boardWidthMm: Number(row.board_width_mm) } : {}),
          ...(row.board_height_mm ? { boardHeightMm: Number(row.board_height_mm) } : {}),
          ...(row.thickness_mm ? { thicknessMm: Number(row.thickness_mm) } : {}),
          wastePercent: Number(row.waste_percent),
        })),
        items: (items.data ?? []).map((row) => ({ id: row.id, name: row.name, group: row.group, unit: row.unit, priceCents: row.price_cents })),
        catalog: prices,
        // Until the settings table exists, the rules set on this computer are kept.
        rules: rules.data?.value ?? getPriceBook().rules,
      }),
    ),
  );
}

async function savePriceBook() {
  await writePriceBook(getPriceBook());
}

async function writePriceBook(book: PriceBook) {
  const supabase = client();
  const materials = book.materials.map((material) => ({
    id: material.id,
    name: material.name,
    piece: material.piece,
    unit: material.unit,
    price_cents: material.priceCents,
    board_width_mm: material.boardWidthMm ?? null,
    board_height_mm: material.boardHeightMm ?? null,
    thickness_mm: material.thicknessMm ?? null,
    waste_percent: material.wastePercent,
    updated_at: new Date().toISOString(),
  }));
  const items = book.items.map((item: PriceItem) => ({
    id: item.id,
    name: item.name,
    group: item.group,
    unit: item.unit,
    price_cents: item.priceCents,
    updated_at: new Date().toISOString(),
  }));
  const catalog = Object.entries(book.catalog).map(([sku, price_cents]) => ({ sku, price_cents }));
  const saved = await Promise.all([
    materials.length ? supabase.from("studio_materials").upsert(materials) : Promise.resolve({ error: null }),
    items.length ? supabase.from("studio_price_items").upsert(items) : Promise.resolve({ error: null }),
    catalog.length ? supabase.from("studio_catalog_prices").upsert(catalog) : Promise.resolve({ error: null }),
  ]);
  const problem = saved.find((result) => result.error);
  if (problem?.error) return fail(problem.error);
  // Not checked: an older database has no settings table yet, and the prices above must still save.
  await supabase.from("studio_settings").upsert({ key: "shop_rules", value: book.rules, updated_at: new Date().toISOString() });
  await dropMissing(supabase, "studio_materials", "id", materials.map((row) => row.id));
  await dropMissing(supabase, "studio_price_items", "id", items.map((row) => row.id));
  await dropMissing(supabase, "studio_catalog_prices", "sku", catalog.map((row) => row.sku));
}

async function pullClients(supabase: ReturnType<typeof client>) {
  const [clients, contacts, locations] = await Promise.all([
    supabase.from("studio_clients").select("*").order("created_at"),
    supabase.from("studio_client_contacts").select("*"),
    supabase.from("studio_client_locations").select("*"),
  ]);
  if (!clients.data?.length) {
    if (getClients().length > 0) await writeClients(getClients());
    return;
  }
  apply(() =>
    replaceClients(
      clients.data.map((row) => ({
        id: row.id,
        name: row.name,
        createdAt: Date.parse(row.created_at) || 0,
        contacts: (contacts.data ?? []).filter((item) => item.client_id === row.id).map((item) => ({ id: item.id, name: item.name, role: item.role, phone: item.phone, email: item.email })),
        locations: (locations.data ?? []).filter((item) => item.client_id === row.id).map((item) => ({
          id: item.id,
          place: item.place,
          spot: item.spot,
          widthMm: item.width_mm,
          heightMm: item.height_mm,
          depthMm: item.depth_mm,
        })),
      })),
    ),
  );
}

async function saveClients() {
  await writeClients(getClients());
}

async function writeClients(list: Client[]) {
  const supabase = client();
  const next = list.map((item) => ({ ...item, id: UUID.test(item.id) ? item.id : crypto.randomUUID() }));
  if (next.some((item, index) => item.id !== list[index]?.id)) apply(() => replaceClients(next));
  const { error } = await supabase.from("studio_clients").upsert(next.map((item) => ({ id: item.id, name: item.name, created_at: new Date(item.createdAt || Date.now()).toISOString() })));
  if (error) return fail(error);
  for (const item of next) {
    await supabase.from("studio_client_contacts").delete().eq("client_id", item.id);
    await supabase.from("studio_client_locations").delete().eq("client_id", item.id);
    if (item.contacts.length) {
      await supabase.from("studio_client_contacts").insert(item.contacts.map((contact) => ({ id: UUID.test(contact.id) ? contact.id : crypto.randomUUID(), client_id: item.id, name: contact.name, role: contact.role, phone: contact.phone, email: contact.email })));
    }
    if (item.locations.length) {
      await supabase.from("studio_client_locations").insert(item.locations.map((location) => ({ id: UUID.test(location.id) ? location.id : crypto.randomUUID(), client_id: item.id, place: location.place, spot: location.spot, width_mm: location.widthMm, height_mm: location.heightMm, depth_mm: location.depthMm })));
    }
  }
  await dropMissing(supabase, "studio_clients", "id", next.map((item) => item.id));
}

async function saveCosting() {
  if (!savesLive || !projectId) return;
  const { error } = await client().from("studio_projects").update({ costing: getCosting(), updated_at: new Date().toISOString() }).eq("id", projectId);
  if (error) fail(error);
}

async function saveDesign() {
  if (!savesLive || !projectId) return;
  const document = getBooth();
  const key = designKey(document);
  const supabase = client();
  const { error } = await supabase.from("studio_projects").update({ document, updated_at: new Date().toISOString() }).eq("id", projectId);
  if (error) return fail(error);
  if (key === designStamp) return;
  designStamp = key;
  await supabase.from("studio_design_versions").insert({ project_id: projectId, document, design_key: key, author: "user" });
}

async function saveJobMeta() {
  if (!projectId) return;
  const meta = getJob();
  const { error } = await client()
    .from("studio_projects")
    .update({
      client_id: uuidOrNull(meta.client.id),
      client_name: meta.client.name,
      source_kind: meta.sourceKind,
      margin_percent: meta.margin,
      updated_at: new Date().toISOString(),
    })
    .eq("id", projectId);
  if (error) fail(error);
}

async function dropMissing(supabase: ReturnType<typeof client>, table: "studio_materials" | "studio_price_items" | "studio_catalog_prices" | "studio_clients", column: "id" | "sku", keep: string[]) {
  if (keep.length === 0) {
    const { error } = await supabase.from(table).delete().neq(column, "");
    if (error) fail(error);
    return;
  }
  const { error } = await supabase.from(table).delete().not(column, "in", `(${keep.map((id) => `"${id}"`).join(",")})`);
  if (error) fail(error);
}

function uuidOrNull(id: string | null) {
  return id && UUID.test(id) ? id : null;
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "file";
}

type ChatRow = {
  id: string;
  title: string;
  mode: ChatMode;
  messages: unknown;
  run_started_at: string | null;
  studio_projects: {
    id: string;
    title: string;
    client_id: string | null;
    client_name: string;
    source_kind: SourceKind;
    margin_percent: number;
    document: unknown;
    costing: unknown;
    simulation_path: string | null;
  } | Array<{
    id: string;
    title: string;
    client_id: string | null;
    client_name: string;
    source_kind: SourceKind;
    margin_percent: number;
    document: unknown;
    costing: unknown;
    simulation_path: string | null;
  }> | null;
};

function readJob(row: ChatRow): SavedJob[] {
  const project = Array.isArray(row.studio_projects) ? row.studio_projects[0] : row.studio_projects;
  if (!project) return [];
  const opened = openDesignDocument(project.document);
  return [
    {
      projectId: project.id,
      chatId: row.id,
      title: row.title || project.title,
      mode: row.mode,
      sourceKind: project.source_kind,
      clientId: project.client_id,
      clientName: project.client_name ?? "",
      margin: Number(project.margin_percent) || 20,
      document: opened.status === "ready" ? opened.document : createEmptyDesign(),
      costing: readCosting(project.costing),
      messages: Array.isArray(row.messages) ? (row.messages as UIMessage[]) : [],
      simulationPath: project.simulation_path,
      running: isRunning(row.run_started_at),
    },
  ];
}

type LibraryRow = {
  id: string;
  kind: string;
  name: string;
  path: string;
  mime: string;
  width: number;
  height: number;
  depth: number;
  bytes: number;
};

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function byteCopy(view: ArrayBufferView) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
}

async function uploadImage(asset: StudioAsset) {
  const blob = await fetch(asset.dataUrl).then((response) => response.blob());
  const ext = blob.type === "image/jpeg" ? "jpg" : "png";
  const path = `library/images/${asset.id}.${ext}`;
  const supabase = client();
  const { error } = await supabase.storage.from("studio-assets").upload(path, blob, { upsert: true, contentType: blob.type || "image/png" });
  if (error) {
    fail(error);
    return;
  }
  const { error: rowError } = await supabase.from("studio_library").upsert({
    id: asset.id,
    kind: "image",
    name: asset.name,
    path,
    mime: blob.type || "image/png",
    width: asset.width,
    height: asset.height,
    depth: 0,
    bytes: asset.bytes,
  });
  if (rowError) fail(rowError);
}

async function uploadMesh(mesh: StoredMesh) {
  const path = `library/meshes/${mesh.id}.pos`;
  const supabase = client();
  const body = new Blob([byteCopy(mesh.positions)], { type: "application/octet-stream" });
  const { error } = await supabase.storage.from("studio-assets").upload(path, body, { upsert: true, contentType: "application/octet-stream" });
  if (error) {
    fail(error);
    return;
  }
  let indexPath = "";
  if (mesh.indices && mesh.indices.length > 0) {
    indexPath = `library/meshes/${mesh.id}.idx`;
    const indexBody = new Blob([byteCopy(mesh.indices)], { type: "application/octet-stream" });
    const index = await supabase.storage.from("studio-assets").upload(indexPath, indexBody, { upsert: true, contentType: "application/octet-stream" });
    if (index.error) {
      fail(index.error);
      return;
    }
  }
  const { error: rowError } = await supabase.from("studio_library").upsert({
    id: mesh.id,
    kind: "mesh",
    name: mesh.id,
    path,
    mime: indexPath,
    width: mesh.width,
    height: mesh.height,
    depth: mesh.depth,
    bytes: body.size,
  });
  if (rowError) fail(rowError);
}

const meshRows = new Map<string, LibraryRow>();
const meshLoads = new Map<string, Promise<void>>();
let library: Promise<void> | null = null;

/** Pictures are few and always shown, so they all load. Meshes load only when an open design uses them. */
function pullLibrary() {
  if (!library) library = readLibrary();
  return library;
}

async function readLibrary() {
  const supabase = client();
  const { data, error } = await supabase.from("studio_library").select("*");
  if (error) {
    fail(error);
    return;
  }
  const rows = (data ?? []) as LibraryRow[];
  const remote = new Set(rows.map((row) => row.id));
  for (const row of rows) if (row.kind === "mesh") meshRows.set(row.id, row);

  const downloaded = await Promise.all(
    rows
      .filter((row) => row.kind === "image")
      .map(async (row): Promise<StudioAsset | null> => {
        const file = await supabase.storage.from("studio-assets").download(row.path);
        if (!file.data) return null;
        return { id: row.id, name: row.name, dataUrl: await blobToDataUrl(file.data), width: Number(row.width), height: Number(row.height), bytes: row.bytes };
      }),
  );
  const images = downloaded.filter((asset): asset is StudioAsset => asset !== null);
  for (const asset of await localAssets()) {
    if (remote.has(asset.id)) continue;
    images.push(asset);
    void uploadImage(asset);
  }
  if (images.length > 0) installAssets(images);

  for (const mesh of await localMeshes()) {
    if (!remote.has(mesh.id)) void uploadMesh(mesh);
  }
}

async function downloadMesh(row: LibraryRow) {
  const supabase = client();
  const [positions, index] = await Promise.all([
    supabase.storage.from("studio-assets").download(row.path),
    row.mime ? supabase.storage.from("studio-assets").download(row.mime) : Promise.resolve({ data: null }),
  ]);
  if (!positions.data) return;
  installMeshes([
    {
      id: row.id,
      positions: new Float32Array(await positions.data.arrayBuffer()),
      indices: index.data ? new Uint32Array(await index.data.arrayBuffer()) : null,
      width: Number(row.width),
      height: Number(row.height),
      depth: Number(row.depth),
    },
  ]);
}

/** Fetch the imported 3D pieces this design draws that are not already on this device. */
async function loadDesignMeshes(document: DesignDocument) {
  const wanted = [...new Set(document.parts.flatMap((part) => (part.meshId ? [part.meshId] : [])))];
  if (wanted.length === 0) return;
  await pullLibrary();
  const local = new Set((await localMeshes()).map((mesh) => mesh.id));
  await Promise.all(
    wanted.map((id) => {
      const row = meshRows.get(id);
      if (local.has(id) || !row) return Promise.resolve();
      if (!meshLoads.has(id)) meshLoads.set(id, downloadMesh(row).catch(() => undefined));
      return meshLoads.get(id)!;
    }),
  );
}

