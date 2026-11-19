import type { UIMessage } from "ai";
import { createClient } from "@/lib/supabase/server";
import { readCosting } from "@/lib/systems/costing";
import { defaultPriceBook, readPriceBook, type PriceBook } from "@/lib/systems/materials";
import { mergeTranscript, slimTranscript } from "@/lib/studio/transcript";

export async function requireStudio() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const { data: profile } = await supabase.from("studio_profiles").select("role").eq("id", data.user.id).maybeSingle();
  if (!profile) return null;
  return { supabase, userId: data.user.id, role: profile.role as string };
}

type MaterialRow = {
  id: string;
  name: string;
  piece: PriceBook["materials"][number]["piece"];
  unit: "board" | "m2";
  price_cents: number;
  board_width_mm: number | null;
  board_height_mm: number | null;
  thickness_mm: number | null;
  waste_percent: number;
};

type ItemRow = { id: string; name: string; group: PriceBook["items"][number]["group"]; unit: string; price_cents: number };

/** The shop's prices from the database. An empty book falls back to the starting prices. */
export async function loadShopPriceBook(): Promise<PriceBook> {
  const gate = await requireStudio();
  if (!gate) return defaultPriceBook();
  const [materials, items, catalog, rules] = await Promise.all([
    gate.supabase.from("studio_materials").select("*"),
    gate.supabase.from("studio_price_items").select("*"),
    gate.supabase.from("studio_catalog_prices").select("*"),
    gate.supabase.from("studio_settings").select("value").eq("key", "shop_rules").maybeSingle(),
  ]);
  if (!materials.data?.length && !items.data?.length) return defaultPriceBook();
  const prices: Record<string, number> = {};
  for (const row of catalog.data ?? []) prices[row.sku as string] = row.price_cents as number;
  return readPriceBook({
    version: 1,
    starter: 2,
    materials: ((materials.data ?? []) as MaterialRow[]).map((row) => ({
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
    items: ((items.data ?? []) as ItemRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      group: row.group,
      unit: row.unit,
      priceCents: row.price_cents,
    })),
    catalog: prices,
    rules: rules.data?.value,
  });
}

/** Keep the job's design and its own price edits. Returns false when the job is not one this user can write. */
export async function saveProjectWork(projectId: string, document: unknown, costing: unknown) {
  const gate = await requireStudio();
  if (!gate) return false;
  const { data, error } = await gate.supabase
    .from("studio_projects")
    .update({ document, costing: readCosting(costing), updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .select("id");
  return !error && (data?.length ?? 0) > 0;
}

type Studio = NonNullable<Awaited<ReturnType<typeof requireStudio>>>;

/** Checked this often for the Stop button while a reply runs. */
const STOP_CHECK_MS = 1500;

/**
 * One reply, run and stored on the server. The chat, the drawing, and the costs are saved after every step,
 * so a reload or a closed tab loses nothing, and the reply keeps going until it ends or the user presses Stop.
 * Saves run one after another.
 */
export function chatRun(gate: Studio, input: { chatId: string; projectId: string; files: Record<string, string> }) {
  const images = new Map<string, Promise<string | null>>();
  let queue: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setInterval> | null = null;
  const chat = () => gate.supabase.from("studio_chats");

  function storeImage(dataUrl: string, key: string) {
    const known = images.get(key);
    if (known) return known;
    const stored = (async () => {
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      const path = `${input.projectId}/${crypto.randomUUID()}.png`;
      const { error } = await gate.supabase.storage.from("studio-simulations").upload(path, Buffer.from(match[2], "base64"), { contentType: match[1] });
      if (error) return null;
      await gate.supabase.from("studio_projects").update({ simulation_path: path }).eq("id", input.projectId);
      return path;
    })();
    images.set(key, stored);
    return stored;
  }

  async function write(messages: UIMessage[], work?: { document: unknown; costing: unknown }) {
    const { data: row, error } = await chat().select("messages").eq("id", input.chatId).eq("project_id", input.projectId).maybeSingle();
    if (error || !row) return;
    const stored = Array.isArray(row.messages) ? (row.messages as UIMessage[]) : [];
    const slim = await slimTranscript(messages, input.files, storeImage);
    const now = new Date().toISOString();
    const update = await chat().update({ messages: mergeTranscript(stored, slim), updated_at: now }).eq("id", input.chatId);
    if (update.error) console.error("The chat could not be saved", update.error.message);
    if (work) {
      const project = await gate.supabase.from("studio_projects").update({ document: work.document, costing: readCosting(work.costing), updated_at: now }).eq("id", input.projectId);
      if (project.error) console.error("The job could not be saved", project.error.message);
    }
  }

  function save(messages: UIMessage[], work?: { document: unknown; costing: unknown }) {
    queue = queue.then(() => write(messages, work)).catch((error: unknown) => console.error("The chat could not be saved", error));
    return queue;
  }

  /** Mark the chat as working, and end the reply when the user presses Stop, from this tab or any other. */
  async function start(onStop: () => void) {
    await chat().update({ run_started_at: new Date().toISOString(), run_stop: false }).eq("id", input.chatId);
    timer = setInterval(async () => {
      const { data } = await chat().select("run_stop").eq("id", input.chatId).maybeSingle();
      if (data?.run_stop) {
        stopWatching();
        onStop();
      }
    }, STOP_CHECK_MS);
  }

  function stopWatching() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /** The reply is over: after everything queued is stored, the chat is no longer working. */
  async function finish() {
    stopWatching();
    await queue;
    await chat().update({ run_started_at: null, run_stop: false }).eq("id", input.chatId);
  }

  return { save, start, finish };
}

/** Ask the reply running on a chat to stop. The server ends it at its next check. */
export async function requestStop(chatId: string) {
  const gate = await requireStudio();
  if (!gate) return false;
  const { error } = await gate.supabase.from("studio_chats").update({ run_stop: true }).eq("id", chatId).not("run_started_at", "is", null);
  return !error;
}

/** Turn stored file paths back into data the model can read. */
export async function expandStoredFiles(messages: UIMessage[]) {
  const gate = await requireStudio();
  if (!gate) return messages;
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      parts: await Promise.all(
        message.parts.map(async (part) => {
          if (part.type !== "file" || !part.url?.startsWith("sb://")) return part;
          const parsed = part.url.match(/^sb:\/\/([^/]+)\/(.+)$/);
          if (!parsed) return part;
          const { data, error } = await gate.supabase.storage.from(parsed[1]).download(parsed[2]);
          if (error || !data || data.size > 12_000_000) return part;
          const bytes = Buffer.from(await data.arrayBuffer());
          const media = part.mediaType || "application/octet-stream";
          return { ...part, url: `data:${media};base64,${bytes.toString("base64")}` };
        }),
      ),
    })),
  );
}
