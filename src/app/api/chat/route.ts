import {
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  generateText,
  stepCountIs,
  streamText,
  toUIMessageStream,
  tool,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { after } from "next/server";
import { z } from "zod";
import { enableDevtools } from "@/lib/ai/devtools";
import { dataRefs, equipmentSuggestions, resolveSuggestions } from "@/lib/ai/cost-review";
import { editFromMessages } from "@/lib/ai/image-edit";
import { generateStandSimulation, resolveImageModel } from "@/lib/ai/generate-stand-image";
import { IMAGE_TOOLS, imagePrompt } from "@/lib/ai/image-prompt";
import { briefInspection } from "@/lib/ai/brief-inspection";
import { createChatLog, readStepCount } from "@/lib/ai/chat-timing";
import { inspectionFiles, jobBrief } from "@/lib/ai/job-brief";
import { inspectStand } from "@/lib/ai/inspect";
import { createToolGate, runGated, type GateMode } from "@/lib/ai/tool-gate";
import { briefPriceBoards, priceBoardPieces, rememberItem } from "@/lib/ai/price-boards";
import { PRICE_TOOLS, pricePrompt } from "@/lib/ai/price-prompt";
import { QUOTE_TOOLS, quotePrompt, type QuoteSource } from "@/lib/ai/quote-prompt";
import { pastQuotesAvailable, searchPastJobs } from "@/lib/archive/past-quotes";
import { EFFORTS, resolveLanguageModel } from "@/lib/ai/resolve-model";
import { seedCatalog } from "@/lib/systems/catalog";
import { addExtras, applyCostEdits, applyCosting, dropCutExtras, extraKey, isCutExtraKey, readCosting, replaceCutExtras, type CostEdit, type ExtraLine } from "@/lib/systems/costing";
import { applyPriceBook } from "@/lib/systems/materials";
import { chatRun, expandStoredFiles, loadShopPriceBook, requireStudio, saveProjectWork } from "@/lib/studio/server-data";
import { changeReport, describePart } from "@/lib/systems/modular/change-report";
import { elementDraftSchema, placeElements, resolveItemId } from "@/lib/systems/modular/elements";
import { bookForJob, addJobMaterial } from "@/lib/systems/modular/job-materials";
import { addParts, editableIds, moveParts, partIds, removeParts, updateParts } from "@/lib/systems/modular/ops";
import { applyDesignPatch } from "@/lib/systems/modular/patch";
import { arrangeParts, checkAssembly, placementSchema } from "@/lib/systems/modular/assemble";
import { ASSEMBLE_TOOLS, assemblePrompt } from "@/lib/ai/assemble-prompt";
import { produceDesign } from "@/lib/systems/modular/produce";
import { setReview } from "@/lib/systems/modular/review";
import { applyItemEdits, buildSections } from "@/lib/systems/sections";
import {
  designPatchSchema,
  partChangesSchema,
  partDraftSchema,
  partMaterialSchema,
  type DesignDocument,
} from "@/lib/systems/modular/schema";
import { validateDesign } from "@/lib/systems/modular/validate";
import { QUOTE_GROUPS } from "@/lib/systems/types";
import { applyTemplate, getTemplate, templateCatalog } from "@/lib/systems/templates";
import { readDesignBody } from "@/lib/files/read-design";
import { spendFor } from "@/lib/ai/spend";
import { mentionNote, readMentions } from "@/lib/studio/mentions";
import { BLENDER_SECTION, BLENDER_TOOLS } from "@/lib/ai/blender-prompt";
import { blenderAllowed, failed, lookInBlender, pullFromBlender, pushToBlender, runInBlender } from "@/lib/blender/bridge";
import type { LookReply } from "@/lib/blender/protocol";
import { attachedPictures, pictureList, zoomPicture } from "@/lib/ai/zoom";

export const maxDuration = 300;

// Slow thinking models such as Claude Fable need minutes for a quote. Hosted, both stay under maxDuration.
// The studio computer has no hosting limit, so a slow model can finish there and be judged on its result.
const LOCAL = process.env.NODE_ENV === "development";
const RUN_LIMIT_MS = LOCAL ? 20 * 60_000 : 290_000;
const ASSEMBLE_LIMIT_MS = LOCAL ? 20 * 60_000 : 180_000;
const SIDE_FACE =
  "On the side face the left edge is the front, toward the viewer, and the right edge is the back: topLeft is the top front corner, topRight the top back, bottomLeft the bottom front, bottomRight the bottom back. A chamfer's x and a hole's x run from the front edge toward the back.";
const OUTLINE =
  "outline draws any shape on the shaped face, straight or round, for a shape corners and chamfers cannot make: its points in order counterclockwise, [x, y] in mm from that face's bottom-left corner, 3 to 48 points. A side panel 400 deep and 1200 high with a sloping front and a 50 mm toe step 100 mm high is face side with outline [[0,0],[400,0],[400,1200],[150,1200],[50,100],[0,100]]. " +
  "A third number makes the edge from that point to the next a true circular arc: 1 is a half circle, 0.414 a quarter circle, 0.2 a gentle curve, above 1 more than a half circle; positive bulges outward, negative cuts inward. Never draw a curve as many short straight edges. A cloud 2400 wide and 1400 high is [[300,0],[2100,0,1],[2100,600,1],[1600,1000,1],[800,1000,1],[300,600,1]]: a flat bottom, then five round bumps. An arch-topped panel 1000 wide and 2000 high is [[0,0],[1000,0],[1000,1500,1],[0,1500]]. A round disc is four points with 0.414 each. " +
  "An arc that would run off the face is flattened, so keep each bump inside the box. It replaces corners and chamfers, openings are still cut inside it, and null goes back to a rectangle. The box stays the outline's full size.";
const ROUND_AND_TUBE =
  "A cylinder stands upright, width its bottom diameter and height its height, and may set round for anything turned about its axis: top is the top diameter (0 makes a cone, smaller than width a tapered column or lamp shade); wall makes it hollow with that wall in mm (a drum, a ring planter, a pipe); sweep below 360 builds only that many degrees of the circle, centered on the front, with flat cut faces toward the back (180 is a half column against a wall, 90 a quarter-round corner). profile draws its side as [radius, height] points from the bottom up with the same arc bulges as an outline, for a dome, a ball, a vase, a bollard, or a podium with a lip: a dome 1200 wide and 600 high is [[600,0,0.414],[0,600]], a ball 600 across is [[0,0,1],[0,600]]. round null makes it a plain cylinder. Never build a cone, dome, sphere, or half column from boxes or stacked discs. " +
  "shape tube is a round bar, pipe, neon line, or hoop running along a path: the box is the space it fills, depth is the bar's diameter, and path is its centerline on the face set by face (front by default), [x, y] mm points from that face's bottom-left corner, 2 to 48 points, with the same arc bulges. closed true joins the last point to the first. A hoop 1000 across in 40 mm pipe is a box 1000 × 1000 × 40 with path [[0,500,1],[1000,500,1]] and closed true; a floor-to-ceiling handrail bent once is two points and one more. A neon script or line drawing is one tube per stroke. Never draw a pipe or neon as many short boxes.";

enableDevtools();

/**
 * The chat shows which pieces a message was about as chips. The model cannot see chips,
 * so each user message gets a short note naming the pieces and ids it meant. That keeps
 * "make it taller" pointing at the right piece even after the selection changes.
 */
function withMentions(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => {
    if (message.role !== "user") return message;
    const note = mentionNote(readMentions(message.metadata));
    if (!note) return message;
    return { ...message, parts: [...message.parts, { type: "text" as const, text: note }] };
  });
}

function isDesignDocument(value: unknown): value is DesignDocument {
  return Boolean(value && typeof value === "object" && (value as DesignDocument).schemaVersion === 1 && Array.isArray((value as DesignDocument).parts));
}

function textList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** What quote mode sends the model instead of the whole design. The chat still stores the full result. */
function briefQuoteResult(output: unknown) {
  if (isDesignDocument(output)) return `${output.parts.length} pieces are in the job. Their sizes and materials are in the system prompt.`;
  if (!output || typeof output !== "object") return "Done.";
  const record = output as Record<string, unknown>;
  if (typeof record.error === "string") return record.error;
  const lines: string[] = [];
  if (Array.isArray(record.ids)) {
    const names = new Map(isDesignDocument(record.document) ? record.document.parts.map((part) => [part.id, part.name]) : []);
    const listed = record.ids.slice(0, 60).map((id) => `${id} "${names.get(String(id)) ?? id}"`);
    lines.push(`New pieces: ${listed.join(", ")}.`);
  }
  if (Array.isArray(record.boards)) {
    for (const board of record.boards) {
      if (!board || typeof board !== "object") continue;
      const item = board as { name?: string; boards?: number; size?: string | null; totalCents?: number };
      lines.push(`${item.name ?? "Board"}${item.size ? `, ${item.size}` : ""}: ${item.boards ?? 0} at $${((item.totalCents ?? 0) / 100).toFixed(2)}.`);
    }
  }
  if (Array.isArray(record.missing) && record.missing.length > 0) lines.push(`Missing ids: ${record.missing.join(", ")}.`);
  if (Array.isArray(record.locked) && record.locked.length > 0) lines.push(`Locked ids: ${record.locked.join(", ")}.`);
  if (typeof record.printed === "string" && record.printed.trim()) lines.push(`Blender printed:\n${record.printed.trim()}`);
  if (typeof record.blender === "string") lines.push(`Blender: ${record.blender}`);
  if (textList(record.notes).length > 0) lines.push(`From Blender: ${textList(record.notes).join(" ")}`);
  if (isDesignDocument(record.document)) {
    const total = record.document.parts.length;
    const count = `${total} ${total === 1 ? "piece is" : "pieces are"} in the job.`;
    lines.push(Array.isArray(record.changed) ? count : `${count} Their sizes and materials are in the system prompt.`);
  }
  if (Array.isArray(record.issues)) {
    const errors = record.issues.flatMap((issue) => (issue && typeof issue === "object" && (issue as { severity?: string }).severity === "error" && typeof (issue as { message?: string }).message === "string" ? [(issue as { message: string }).message] : []));
    if (errors.length > 0) lines.push(`Errors: ${errors.slice(0, 5).join(" ")}`);
  }
  if (typeof record.materialId === "string") lines.push(`materialId ${record.materialId}.${typeof record.note === "string" ? ` ${record.note}` : ""}`);
  if (record.inspection && typeof record.inspection === "object") lines.push(briefInspection(output));
  const report: string[] = [];
  const changed = textList(record.changed);
  if (changed.length > 0) {
    const shown = changed.slice(0, 60);
    report.push("Changed:", ...shown);
    if (changed.length > shown.length) report.push(`…and ${changed.length - shown.length} more`);
  }
  const adjusted = textList(record.adjusted);
  if (adjusted.length > 0) report.push("Adjusted:", ...adjusted);
  const unchanged = textList(record.unchanged);
  if (unchanged.length > 0) report.push(`Not changed: ${unchanged.join(", ")}.`);
  const removed = textList(record.removed);
  if (removed.length > 0) report.push(`Removed: ${removed.join(", ")}.`);
  return [lines.join(" "), report.join("\n")].filter(Boolean).join("\n") || "Done.";
}

/** Pricing mode hides the document that suggestCosts returns for the client. The model still sees each line. */
function briefSuggestCosts(output: unknown) {
  if (!output || typeof output !== "object") return "Done.";
  const record = output as {
    error?: string;
    suggestions?: { description?: string; quantity?: number; unit?: string; unitCents?: number; source?: string }[];
    totalCents?: number;
    note?: string;
    alreadyOnCostNote?: string;
    countedByStudioNote?: string;
  };
  if (record.error) return record.error;
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const lines = (record.suggestions ?? []).map((line) => {
    const total = Math.round((line.quantity ?? 0) * (line.unitCents ?? 0));
    return `- ${line.description ?? "Line"}: ${line.quantity ?? 0} ${line.unit ?? ""} = ${dollars(total)}${line.source === "new" ? " estimated" : ""}`;
  });
  return [`${lines.length} lines, ${dollars(record.totalCents ?? 0)}.`, ...lines, record.note, record.alreadyOnCostNote, record.countedByStudioNote].filter(Boolean).join("\n");
}

/** What assembly sends the model after each arrangement: only what still needs fixing. */
function briefAssembly(output: unknown) {
  if (!output || typeof output !== "object") return "Done.";
  const record = output as {
    error?: string;
    placed?: number;
    rejected?: { id: string; reason: string }[];
    waiting?: string[];
    check?: { overlaps?: string[]; floating?: string[] };
    note?: string;
  };
  if (record.error) return record.error;
  const lines = [`Placed ${record.placed ?? 0} pieces.`];
  for (const item of record.rejected ?? []) lines.push(`Not placed ${item.id}: ${item.reason}`);
  if (record.waiting?.length) lines.push(`Not placed yet: ${record.waiting.join(", ")}.`);
  const problems = [...(record.check?.overlaps ?? []), ...(record.check?.floating ?? [])];
  lines.push(problems.length ? `Fix: ${problems.join("; ")}.` : "No piece passes through another and nothing floats.");
  if (record.note) lines.push(`Assembler's note: ${record.note}`);
  return lines.join("\n");
}

/**
 * Assembly reads what the user wrote and the latest sheet they attached, nothing else.
 * Earlier replies and tool results are left out: the pieces are in the system prompt.
 */
function assemblyHistory(messages: UIMessage[]): UIMessage[] {
  const users = messages.filter((message) => message.role === "user");
  const withFile = users.findLast((message) => message.parts.some((part) => part.type === "file"));
  return users.map((message) => ({
    ...message,
    parts: message.parts.filter((part) => part.type === "text" || (part.type === "file" && message === withFile)),
  }));
}

/** Drop designs already stored in the chat before a quote request. The saved chat is not changed. */
function slimQuoteHistory(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (!part || typeof part !== "object" || !("output" in part)) return part;
      const output = part.output;
      if (isDesignDocument(output)) return { ...part, output: { note: briefQuoteResult(output) } };
      if (!output || typeof output !== "object" || !isDesignDocument((output as { document?: unknown }).document)) return part;
      const record = output as Record<string, unknown>;
      const { document: _document, issues: _issues, ...kept } = record;
      return { ...part, output: { ...kept, note: briefQuoteResult(output) } };
    }),
  })) as UIMessage[];
}

const messageId = createIdGenerator({ prefix: "msg", size: 16 });

async function drain(stream: ReadableStream<unknown>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {
    // Reading is what moves the reply forward; the parts are stored by the stream's callbacks.
  }
}

function readFiles(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => typeof entry[1] === "string" && /^[0-9a-f-]{36}\//.test(entry[1])));
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    messages?: UIMessage[];
    document?: unknown;
    selection?: unknown;
    assets?: unknown;
    priceBook?: unknown;
    costing?: unknown;
    marginPercent?: number;
    projectId?: string;
    /** simulation, technical, 3d_file, or description. Quote mode prices each one differently. */
    sourceKind?: string;
    /** `quote` is Build: prices, draws, and can make a simulation. `image` only edits a simulation. */
    mode?: string;
    /** Put the priced pieces together into the stand. Nothing is added, removed, or resized. */
    assemble?: boolean;
    provider?: string;
    model?: string;
    /** low, medium, or high. Thinking models use medium when this is missing. */
    effort?: string;
    /** Google image model. Build uses it for a simulation. Image edits use it too. */
    imageModel?: string;
    /** The chat this turn belongs to. The server stores the turn there. */
    chatId?: string;
    /** Where each attached file was uploaded, by file name. */
    files?: unknown;
    /** The drawing lives in Blender on this laptop: every change is mirrored there, and the Blender tools are on. */
    blender?: boolean;
  };
  const gate = await requireStudio();
  if (!gate) return Response.json({ error: "Sign in required." }, { status: 401 });
  const design = readDesignBody(body.document);
  if ("error" in design) {
    return Response.json({ error: design.error }, { status: design.status });
  }
  if (!body.projectId || !(await saveProjectWork(body.projectId, design.document, body.costing))) {
    return Response.json({ error: "This job is not open." }, { status: 404 });
  }
  const effort = EFFORTS.find((item) => item === body.effort);
  const resolved = resolveLanguageModel(body.provider ?? "", body.model ?? "", effort);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: 503 });
  }

  let current = design.document;
  const selection = Array.isArray(body.selection)
    ? body.selection.filter((id): id is string => typeof id === "string")
    : [];
  const priceBook = await loadShopPriceBook();
  const sourceKind: QuoteSource = body.sourceKind === "simulation" || body.sourceKind === "technical" || body.sourceKind === "3d_file" ? body.sourceKind : "description";
  const catalog = seedCatalog().map((item) => ({
    sku: item.sku,
    name: item.name,
    category: item.category,
    unit: item.unit,
    constraints: item.constraints,
  }));

  // Edits that name pieces report ids that did not exist or are locked, so the model can correct itself.
  function report(ids: string[]) {
    const known = partIds(current);
    const open = new Set(editableIds(current, ids));
    return {
      missing: ids.filter((id) => !known.has(id)),
      locked: ids.filter((id) => known.has(id) && !open.has(id)),
    };
  }

  function result(extra: Record<string, unknown> = {}) {
    return { ...extra, document: current, issues: validateDesign(current, seedCatalog(), priceBook) };
  }

  function attempt(run: () => Record<string, unknown>) {
    try {
      return run();
    } catch (error) {
      return { error: error instanceof Error ? error.message : "The change did not match the booth schema." };
    }
  }

  // Pricing (`price`) asks and prices, and does not draw. Engineering (`quote`) is today's Build.
  // mode "image" only edits a simulation. Assemble only moves pieces.
  const assembleMode = body.assemble === true;
  const imageMode = !assembleMode && body.mode === "image";
  const priceMode = !assembleMode && !imageMode && body.mode === "price";
  const buildMode = !assembleMode && !imageMode && !priceMode;
  // Same check as resolveImageModel and /api/providers: GOOGLE_GENERATIVE_AI_API_KEY is set.
  const standImage = buildMode && !("error" in resolveImageModel(body.imageModel ?? ""));
  const pastQuotes = (buildMode || priceMode) && pastQuotesAvailable();
  const messages = await expandStoredFiles(body.messages ?? []);
  const pictures = buildMode || priceMode ? await attachedPictures(messages) : [];
  const zooms = new Map<string, string>();
  const costing = readCosting(body.costing);
  /** The costs as this reply changes them. Stored with the drawing after every step. */
  let costingNow = costing;
  // Job materials can be added during this reply, so the book is read again at each use.
  function jobBook() {
    return bookForJob(priceBook, current);
  }
  function jobRefs() {
    return dataRefs(jobBook(), applyPriceBook(seedCatalog(), priceBook));
  }
  // Lines already waiting in the cost panel. Lines suggested during this request are added as they come.
  const pending: ExtraLine[] = [...(costing.review?.suggestions ?? [])];

  function quoteSystem() {
    const costed = applyCosting(produceDesign(current, seedCatalog(), priceBook).lines, costing);
    const hasFiles = messages.some((message) => message.parts.some((part) => part.type === "file"));
    const jobText = messages
      .filter((message) => message.role === "user")
      .flatMap((message) => message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])))
      .join("\n");
    const prompt = quotePrompt({ document: current, book: jobBook(), refs: jobRefs(), costed, hasFiles, sourceKind, pastQuotes, selection, jobText, pictures: pictureList(pictures), image: standImage });
    return blenderMode ? `${prompt}\n\n${BLENDER_SECTION}` : prompt;
  }

  function priceSystem() {
    // The lines already stored on this job, including earlier board prices, so the model does not add them again.
    const costed = applyCosting(produceDesign(current, seedCatalog(), priceBook).lines, costingNow);
    const hasFiles = messages.some((message) => message.parts.some((part) => part.type === "file"));
    return pricePrompt({ document: current, book: jobBook(), refs: jobRefs(), costed, hasFiles, sourceKind, pastQuotes, pictures: pictureList(pictures) });
  }

  /** Once pieces exist, priced board lines would be counted again by the cutting plan. */
  function clearCutLines(): CostEdit[] {
    if (current.parts.length === 0) return [];
    const dropped = dropCutExtras(costingNow);
    costingNow = dropped.costing;
    return dropped.edits;
  }

  const blenderMode = !imageMode && !priceMode && body.blender === true && blenderAllowed();
  /** Screenshots for the model in this reply only. The stored chat keeps a note, not the pictures. */
  const blenderShots = new Map<string, LookReply["images"]>();
  /** Show Blender the stand as it is now. Says what went wrong, or nothing. */
  async function mirror() {
    const synced = await pushToBlender(current);
    return failed(synced) ? (synced && "error" in synced ? String(synced.error) : "Blender did not update.") : synced.missing.length > 0 ? `${synced.missing.length} imported pieces are not in Blender yet; turn the Blender switch off and on to send them.` : "";
  }

  /** What assembly placed and could not place during this reply, across every arrangeParts call. */
  const assembled = { placed: new Set<string>(), rejected: new Map<string, string>() };
  /** Successful production checks in this reply. The foreman runs at most twice. */
  let inspections = 0;
  const arrangeTool = tool({
    description:
      "Assembly. Put pieces at absolute positions in millimeters. x, y, z is the minimum corner. To turn a box, send its sizes in a different order. A bent board keeps its width across the curve: its line in the piece list says the two ways to send it. corner sets which corner a quarter-circle piece rounds. tilt slopes a piece seen from the front, such as a roof board on a pitch. A piece that cannot take the sizes sent is left where it was and reported. The result lists pieces that pass through each other or float.",
    inputSchema: z.object({ pieces: z.array(placementSchema).min(1).max(120) }),
    execute: async ({ pieces }) =>
      attempt(() => {
        const arranged = arrangeParts(current, pieces);
        current = arranged.document;
        const placed = new Set(arranged.placed);
        for (const id of placed) {
          assembled.placed.add(id);
          assembled.rejected.delete(id);
        }
        for (const item of arranged.rejected) assembled.rejected.set(item.id, item.reason);
        const waiting = current.parts.filter((part) => !part.locked && !placed.has(part.id) && !pieces.some((piece) => piece.id === part.id)).map((part) => part.id);
        return { document: current, placed: arranged.placed.length, rejected: arranged.rejected, waiting, check: checkAssembly(current.parts) };
      }),
    toModelOutput: ({ output }) => ({ type: "text", value: briefAssembly(output) }),
  });
  // Replaced after the Blender wrap, and before the step gate, so assemble's own arrangeParts calls stay out of the gate.
  let arrangeForAssembly: (input: never, options: never) => Promise<unknown> = arrangeTool.execute as never;

  const tools = {
      addElements: tool({
        description:
          "Quote mode. Add the elements the workshop builds, with their size, material, and kind, from a sheet, a render, or the conversation. kind is built, letters, equipment, or rental. Dimensions are millimeters. A flat piece cut from board (panel, shelf, lip, header, plinth) has depth equal to the board thickness, the thickness printed on the sheet, otherwise the thickness of the shop's board it is cut from (listed in the system prompt). The reply includes boards: the sheets the studio will buy and what they cost. Quote those numbers exactly. Send one entry per kind of element with quantity set. The studio lays them out, so never give positions. Elements already in the job are not touched. For cut letters, set text to the characters, spaces included, instead of one box per letter. A piece cut from acrylic, foam PVC, or another listed sheet sets materialId to that sheet's id. When the sheet shows more than one unit, set item to a short name for that unit. Leave item out when the job is one unit. A box may set corners, chamfers, holes, outline, and face, as in addParts. " + SIDE_FACE + " " + OUTLINE + " " + ROUND_AND_TUBE,
        inputSchema: z.object({ elements: z.array(elementDraftSchema).min(1).max(60) }),
        execute: async ({ elements }) =>
          attempt(() => {
            const placed = placeElements(current, elements);
            current = placed.document;
            const boards = produceDesign(current, seedCatalog(), priceBook).materials
              .filter((usage) => usage.quantity > 0)
              .map((usage) => ({
                name: usage.name,
                boards: usage.quantity,
                unit: usage.unit,
                size: usage.boardSize,
                pieces: usage.pieces,
                totalCents: usage.totalCents,
              }));
            const known = new Set(bookForJob(priceBook, current).materials.map((material) => material.id));
            const unknown = [...new Set(elements.flatMap((element) => (element.materialId && !known.has(element.materialId) ? [element.materialId] : [])))];
            const edits = clearCutLines();
            return result({ ids: placed.ids, boards, ...(edits.length > 0 ? { edits } : {}), ...(unknown.length > 0 ? { unknownMaterialIds: unknown, note: "These ids are not in the shop's sheets, so those pieces were priced by material instead." } : {}) });
          }),
      }),
      priceBoards: tool({
        description:
          "Pricing mode. Price every flat piece the workshop cuts from board or sheet. Send the full list each time: this replaces the board lines already on the cost. Dimensions are millimeters. thickness is the board thickness. Material is paint, mdf, wood, laminate, metal, or glass. A piece cut from a listed sheet also sets materialId. Set item to the unit's name when the job has more than one unit, the same name every time. Leave item off when the job is one unit.",
        inputSchema: z.object({
          pieces: z
            .array(
              z.object({
                name: z.string().min(1).max(80),
                width: z.number().positive().max(50_000),
                height: z.number().positive().max(50_000),
                thickness: z.number().positive().max(50_000),
                material: partMaterialSchema,
                materialId: z.string().min(1).max(60).optional(),
                quantity: z.number().int().min(1).max(200).default(1),
                item: z.string().min(1).max(80).optional(),
              }),
            )
            .min(1)
            .max(120),
        }),
        execute: async ({ pieces }) =>
          attempt(() => {
            const priced = priceBoardPieces(current, pieces, priceBook);
            current = priced.document;
            costingNow = replaceCutExtras(costingNow, priced.extras);
            return {
              suggestions: priced.extras,
              ...(priced.groupsChanged ? { document: priced.document } : {}),
              boards: priced.boards,
              other: priced.other,
              totalCents: priced.totalCents,
              ...(priced.unpriced.length > 0 ? { unpriced: priced.unpriced } : {}),
              ...(priced.note ? { note: priced.note } : {}),
            };
          }),
        toModelOutput: ({ output }) => ({ type: "text", value: briefPriceBoards(output) }),
      }),
      suggestCosts: tool({
        description: (priceMode
          ? "Pricing mode. Suggest every other cost the job needs: hardware, finishing, printing, bought-in equipment and furniture, lighting, electrical, labor, installation, transport. Boards, sheets, edge banding, primer, and paint come from priceBoards, so leave them out; acrylic or foam pieces go in with priceBoards and materialId. "
          : "Quote mode. Suggest every other cost the job needs: hardware, finishing, printing, bought-in equipment and furniture, lighting, electrical, labor, installation, transport. The boards and sheets the elements are cut from are priced by the engine, so leave them out; acrylic or foam pieces go in with addElements and materialId. ") +
          "Use match with an id from the shop's own prices when one fits, otherwise match null with an honest estimateUsd for one unit. The lines go straight into the price; the user can change or remove any of them in the Price panel. Set item to the unit's name for print and anything that belongs to one unit. Leave item off for installation, transport, and delivery.",
        inputSchema: z.object({
          items: z
            .array(
              z.object({
                description: z.string().min(1).max(160),
                group: z.enum(QUOTE_GROUPS),
                quantity: z.number().positive(),
                unit: z.string().min(1).max(20),
                reason: z.string().max(400),
                match: z.string().nullable(),
                estimateUsd: z.number().min(0).nullable(),
                item: z.string().min(1).max(80).optional(),
              }),
            )
            .min(1)
            .max(60),
        }),
        execute: async ({ items }) =>
          attempt(() => {
            const groupsBefore = current.groups;
            const costed = applyCosting(produceDesign(current, seedCatalog(), priceBook).lines, costing);
            // A TV always needs its mount, cable, and player, so those are added without relying on the model.
            const known = new Set(pending.flatMap((line) => [line.description.toLowerCase(), ...(line.ref ? [line.ref] : [])]));
            const equipment = equipmentSuggestions(current, jobRefs(), costed).filter((line) => !known.has(line.description.toLowerCase()) && !(line.ref && known.has(line.ref)));
            // A sheet bought as a cost line never reaches the cutting plan, so it has to come in as pieces.
            const sheets = items.filter((item) => item.match?.startsWith("material:"));
            const named = items
              .filter((item) => !item.match?.startsWith("material:"))
              .map((item) => {
                if (!item.item) return item;
                if (!priceMode) return { ...item, item: resolveItemId(current, item.item) };
                const remembered = rememberItem(current, item.item);
                current = remembered.document;
                return { ...item, item: remembered.id };
              });
            const engine = new Set(costed.lines.filter((line) => line.origin === "design" && line.ref).map((line) => line.ref!));
            const onCost = new Set([...costed.lines.flatMap((line) => (line.ref ? [line.ref] : [])), ...pending.flatMap((line) => (line.ref ? [line.ref] : []))]);
            const fresh = resolveSuggestions(named, { refs: jobRefs(), costed, preset: [...pending, ...equipment] });
            const taken = new Set(fresh.flatMap((line) => (line.ref ? [line.ref] : [])));
            const repeats = named.filter((item) => item.match && onCost.has(item.match) && !taken.has(item.match));
            const countedByStudio = repeats.filter((item) => engine.has(item.match!)).map((item) => item.description);
            const alreadyOnCost = repeats.filter((item) => !engine.has(item.match!)).map((item) => item.description);
            const added = [...equipment, ...fresh];
            pending.push(...added);
            costingNow = addExtras(costingNow, added);
            return {
              suggestions: added,
              skipped: items.length - fresh.length,
              ...(alreadyOnCost.length > 0 ? { alreadyOnCost, alreadyOnCostNote: "These match a shop price already on the cost, so they were not added. For extra work, send them again with match null, the work named, and that item's price as estimateUsd." } : {}),
              ...(countedByStudio.length > 0 ? { countedByStudio, countedByStudioNote: "The studio already counts these from the pieces. Do not add them again." } : {}),
              estimated: added.filter((line) => line.source === "new").length,
              totalCents: added.reduce((sum, line) => sum + Math.round(line.quantity * line.unitCents), 0),
              ...(priceMode && current.groups !== groupsBefore ? { document: current } : {}),
              ...(sheets.length > 0
                ? {
                    sheetsRefused: sheets.map((item) => item.description),
                    note: priceMode
                      ? "Sheets are not cost lines. Call priceBoards with the pieces cut from them and their materialId."
                      : "Sheets are not cost lines. Add the pieces cut from them with addElements and materialId, so the cutting plan counts the boards.",
                  }
                : {}),
            };
          }),
      }),
      editCosts: tool({
        description: priceMode
          ? "Pricing mode. Change or take off lines already on the cost, by their key from <already-on-cost> or the extra:<id> of a line suggestCosts added. Set remove to take a line off. Set quantity or unitUsd to change it. When the user changes how many of something or its price, change that line instead of adding a second one. A board line changes only through priceBoards. Call priceBoards again with the full list."
          : "Quote mode. Change or take off lines already on the cost, by their key from <already-on-cost> or the extra:<id> of a line suggestCosts added. Set remove to take a line off. Set quantity or unitUsd to change it. When the user changes how many of something or its price, change that line instead of adding a second one. A line the studio counts from the pieces comes back when the pieces change, so change the pieces instead when the drawing is wrong.",
        inputSchema: z.object({
          lines: z
            .array(
              z.object({
                key: z.string().min(1).max(120),
                remove: z.boolean().optional(),
                quantity: z.number().min(0).max(1_000_000).optional(),
                unitUsd: z.number().min(0).max(1_000_000).optional(),
              }),
            )
            .min(1)
            .max(40),
        }),
        execute: async ({ lines }) =>
          attempt(() => {
            if (priceMode && lines.some((change) => isCutExtraKey(change.key))) {
              return { error: "Board lines change only through priceBoards. Call priceBoards again with the full list." };
            }
            const costed = applyCosting(produceDesign(current, seedCatalog(), priceBook).lines, costingNow);
            const edits: CostEdit[] = [];
            const missing: string[] = [];
            const done: string[] = [];
            for (const change of lines) {
              const line = costed.lines.find((candidate) => candidate.key === change.key);
              if (!line || (!change.remove && change.quantity === undefined && change.unitUsd === undefined)) {
                missing.push(change.key);
                continue;
              }
              edits.push({
                key: line.key,
                ...(change.remove ? { remove: true } : {}),
                ...(change.quantity !== undefined ? { quantity: change.quantity } : {}),
                ...(change.unitUsd !== undefined ? { unitCents: Math.round(change.unitUsd * 100) } : {}),
                baseQuantity: line.baseQuantity,
                baseUnitCents: line.baseUnitCents,
              });
              done.push(`${line.description}: ${change.remove ? "taken off" : [change.quantity !== undefined ? `quantity ${change.quantity}` : "", change.unitUsd !== undefined ? `$${change.unitUsd} each` : ""].filter(Boolean).join(", ")}`);
            }
            costingNow = applyCostEdits(costingNow, edits);
            const removed = new Set(edits.filter((edit) => edit.remove).map((edit) => edit.key));
            for (let index = pending.length - 1; index >= 0; index -= 1) if (removed.has(extraKey(pending[index].id))) pending.splice(index, 1);
            const after = applyCosting(produceDesign(current, seedCatalog(), priceBook).lines, costingNow);
            return {
              edits,
              done,
              ...(missing.length > 0 ? { missing, missingNote: "No line on the cost has these keys, or nothing was asked to change. Use the keys from <already-on-cost> or extra:<id>." } : {}),
              subtotalCents: after.subtotalCents,
            };
          }),
      }),
      findPastQuotes: tool({
        description: "Quote mode. Search the studio's past proformas for jobs like this one. Give a few words: client, kind of piece, main materials. Returns up to six past jobs with the PI number, date, client, job name, sizes, materials, and the price the client paid before VAT. Use them only to check your estimate. Read a job's note when it has one: a package price covers more than that job.",
        inputSchema: z.object({ query: z.string().min(2).max(200) }),
        execute: async ({ query }) => {
          const jobs = searchPastJobs(query);
          return jobs.length > 0 ? { jobs } : { jobs, note: "No similar past job." };
        },
      }),
      groupSections: tool({
        description:
          "Quote mode. Rename an item on the client quotation, or move pieces between items. The quotation builds itself, so call this only when the user asked for one of those. Do not send prices.",
        inputSchema: z.object({
          items: z
            .array(
              z.object({
                itemId: z.string().min(1).max(80),
                title: z.string().min(1).max(120).optional(),
                partIds: z.array(z.string()).max(80).optional(),
              }),
            )
            .max(20)
            .optional(),
        }),
        execute: async ({ items }) => {
          if (items && items.length > 0) current = applyItemEdits(current, items);
          const costed = applyCosting(produceDesign(current, seedCatalog(), priceBook).lines, costing);
          const margin = typeof body.marginPercent === "number" ? body.marginPercent : 20;
          // A rename lands on the item itself, so an older typed name must not win over it.
          const previous = costing.sections.map((section) => {
            const edit = items?.find((item) => resolveItemId(current, item.itemId) === section.itemId);
            return edit?.title ? { ...section, title: edit.title, titleEdited: false } : section;
          });
          const grouped = buildSections(current, costed.lines, margin, costing.quote, previous);
          costingNow = { ...costingNow, sections: grouped };
          return { sections: grouped, count: grouped.length, ...(items && items.length > 0 ? { document: current } : {}) };
        },
      }),
      nameItems: tool({
        description: "Pricing mode. Rename an item. item is the item's current name or id. title is the new name. Call this only when the user asked to rename an item.",
        inputSchema: z.object({
          items: z.array(z.object({ item: z.string().min(1).max(80), title: z.string().min(1).max(80) })).min(1).max(20),
        }),
        execute: async ({ items }) => {
          current = applyItemEdits(current, items.map((row) => ({ itemId: row.item, title: row.title })));
          const costed = applyCosting(produceDesign(current, seedCatalog(), priceBook).lines, costingNow);
          const margin = typeof body.marginPercent === "number" ? body.marginPercent : 20;
          const previous = costingNow.sections.map((section) => {
            const edit = items.find((item) => resolveItemId(current, item.item) === section.itemId);
            return edit ? { ...section, title: edit.title, titleEdited: false } : section;
          });
          const grouped = buildSections(current, costed.lines, margin, costingNow.quote, previous);
          costingNow = { ...costingNow, sections: grouped };
          return { document: current, sections: grouped, count: grouped.length };
        },
        toModelOutput: ({ output }) => ({
          type: "text",
          value: output && typeof output === "object" && "count" in output ? `Renamed. ${String((output as { count: unknown }).count)} rows.` : "Renamed.",
        }),
      }),
      getDesign: tool({
        description: "Read the current booth document.",
        inputSchema: z.object({}),
        execute: async () => current satisfies DesignDocument,
      }),
      listCatalog: tool({
        description: "List booth components and their manufacturing limits. Prices are not included.",
        inputSchema: z.object({}),
        execute: async () => catalog,
      }),
      listTemplates: tool({
        description: "List the stand templates with the parameters each one accepts.",
        inputSchema: z.object({}),
        execute: async () => templateCatalog(),
      }),
      addParts: tool({
        description:
          "Add new pieces (boxes, cylinders, tubes, and cut letters) without touching the pieces already drawn. Dimensions are millimeters. A box may include corners to round its front face, or chamfers to cut a corner straight. A chamfer corner is { x, y }: x along the top or bottom, y along the side. A sloping top is a chamfer across the whole width, not a radius. A box may include holes, openings cut through its front face ({ x, y, width, height, corners }, from its bottom-left corner; y 0 is open at the bottom), for rings, arches, and windows. Set face 'top' or 'side' to put the corners, cuts, and openings on the face seen from above or from the right instead. " + SIDE_FACE + " " + OUTLINE + " " + ROUND_AND_TUBE + " A curved panel sets curve { thickness, toward }: width is the straight distance between its ends and depth how far it bows. Cut letters use shape letters and a label with the exact characters, spaces included. Use this for any addition.",
        inputSchema: z.object({ parts: z.array(partDraftSchema).min(1) }),
        execute: async ({ parts }) =>
          attempt(() => {
            const added = addParts(current, parts);
            current = added.document;
            const byId = new Map(current.parts.map((part) => [part.id, part]));
            const changed = added.ids.slice(0, 40).flatMap((id) => {
              const part = byId.get(id);
              return part ? [describePart(part)] : [];
            });
            const edits = clearCutLines();
            return result({ ids: added.ids, changed, ...(edits.length > 0 ? { edits } : {}) });
          }),
      }),
      updateParts: tool({
        description:
          "Change named pieces by id. Send only the fields to change, such as height, color, material, name, rotation, position, corners, chamfers, holes, shape, or label. Locked pieces are skipped. Rotation is degrees about the vertical axis around the piece's center. tilt slopes a piece about its front-to-back axis around its center, counterclockwise seen from the front, for a roof board on a pitch or an angled panel: the piece keeps its true sizes, so never use a bigger or chamfered box for a sloping board. corners rounds a box's front face: topLeft, topRight, bottomLeft, bottomRight, in millimeters. chamfers cuts a corner in a straight line: { x, y } in millimeters, x along the top or bottom and y along the side. A sloping edge is a chamfer across the whole width, not a radius. Send the whole chamfers object. holes replaces every opening on a box; send [] to fill them in. face picks which face carries the corners, cuts, and openings: front, top (seen from above), or side (seen from the right). " + SIDE_FACE + " " + OUTLINE + " " + ROUND_AND_TUBE + " Changing a path or round replaces it whole. curve { thickness, axis, toward, corner } bends the board across its width: axis height (default) shows the curve from above, axis depth from the front, and corner makes it a quarter circle rounding that corner. curve null makes it flat again. Reordering a bent board's sizes turns it and keeps its bend. shape letters with a label turns a piece into cut letters.",
        inputSchema: z.object({ ids: z.array(z.string()).min(1), changes: partChangesSchema }),
        execute: async ({ ids, changes }) =>
          attempt(() => {
            const before = current;
            const problems = report(ids);
            current = updateParts(current, ids, changes);
            return result({ ...problems, ...changeReport(before, current, ids, changes) });
          }),
      }),
      moveParts: tool({
        description: "Move named pieces by an offset in millimeters. +X is right, +Y is up, +Z is toward the viewer. Locked pieces are skipped.",
        inputSchema: z.object({
          ids: z.array(z.string()).min(1),
          x: z.number().optional(),
          y: z.number().optional(),
          z: z.number().optional(),
        }),
        execute: async ({ ids, x, y, z: dz }) =>
          attempt(() => {
            const before = current;
            const problems = report(ids);
            current = moveParts(current, ids, { x, y, z: dz });
            return result({ ...problems, ...changeReport(before, current, ids) });
          }),
      }),
      arrangeParts: arrangeTool,
      assemble: tool({
        description:
          "Put the pieces together into the stand, from the attached picture and the conversation. Nothing is added, removed, or resized. Call it when the user asks to assemble, to see the stand built, or to fix how pieces sit, after the pieces exist. Send request only to say what to fix when the user's message does not say it, such as which pieces still float.",
        inputSchema: z.object({ request: z.string().max(600).optional() }),
        execute: async ({ request: ask }, { abortSignal }) => {
          if (current.parts.length === 0) return { error: "There are no pieces to assemble yet." };
          assembled.placed.clear();
          assembled.rejected.clear();
          const history = assemblyHistory(messages);
          if (ask) history.push({ id: "assemble-request", role: "user", parts: [{ type: "text", text: ask }] });
          const sub = await generateText({
            model: resolved.model,
            system: assemblePrompt(current),
            ...("providerOptions" in resolved ? { providerOptions: resolved.providerOptions } : {}),
            messages: await convertToModelMessages(history),
            tools: {
              arrangeParts: tool({
                description: arrangeTool.description,
                inputSchema: z.object({ pieces: z.array(placementSchema).min(1).max(120) }),
                execute: (input, options) => arrangeForAssembly(input as never, options as never),
                toModelOutput: ({ output }) => ({ type: "text", value: briefAssembly(output) }),
              }),
            },
            temperature: 0,
            stopWhen: stepCountIs(4),
            abortSignal,
          });
          const waiting = current.parts.filter((part) => !part.locked && !assembled.placed.has(part.id) && !assembled.rejected.has(part.id)).map((part) => part.id);
          const spend = spendFor(body.provider ?? "", body.model ?? "", sub.usage);
          return {
            document: current,
            placed: assembled.placed.size,
            rejected: [...assembled.rejected].map(([id, reason]) => ({ id, reason })),
            waiting,
            check: checkAssembly(current.parts),
            note: sub.text.trim().slice(0, 1200),
            steps: sub.steps.length,
            ...(spend ? { spend } : {}),
          };
        },
        toModelOutput: ({ output }) => ({ type: "text", value: briefAssembly(output) }),
      }),
      askUser: tool({
        description:
          "Ask the user up to six questions and wait for the answers. Each question has two to six short options, most likely first, and that one's label ends with \"(recommended)\". The user can pick options or type their own answer. Use it whenever a missing fact changes the pieces or the price, instead of asking in the reply.",
        inputSchema: z.object({
          questions: z
            .array(
              z.object({
                id: z.string().min(1).max(40),
                prompt: z.string().min(3).max(300),
                options: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(120) })).min(2).max(6),
                allowMultiple: z.boolean().optional(),
              }),
            )
            .min(1)
            .max(6),
        }),
        outputSchema: z.object({
          answers: z.array(z.object({ id: z.string(), selected: z.array(z.string()), custom: z.string().optional() })),
          skipped: z.boolean().optional(),
          note: z.string().optional(),
        }),
      }),
      removeParts: tool({
        description: "Delete named pieces by id. Locked pieces are skipped.",
        inputSchema: z.object({ ids: z.array(z.string()).min(1) }),
        execute: async ({ ids }) =>
          attempt(() => {
            const before = current;
            const problems = report(ids);
            current = removeParts(current, ids);
            const names = new Map(before.parts.map((part) => [part.id, part.name]));
            const remaining = partIds(current);
            const removed = ids.filter((id) => names.has(id) && !remaining.has(id)).map((id) => `${id} "${names.get(id)}"`);
            return result({ ...problems, removed });
          }),
      }),
      applyTemplate: tool({
        description:
          "Start from a template. Use mode replace to start a new canvas, or add to place a group of pieces beside what is drawn. Booth templates always replace the canvas. Unknown values fall back to the template defaults and out-of-range values are clamped.",
        inputSchema: z.object({
          templateId: z.string(),
          values: z.record(z.string(), z.number()).optional(),
          mode: z.enum(["replace", "add"]).optional(),
        }),
        execute: async ({ templateId, values, mode }) =>
          attempt(() => {
            const template = getTemplate(templateId);
            if (!template) return { error: `No template named ${templateId}. Call listTemplates.` };
            const built = applyTemplate(current, template, values ?? {}, mode ?? "replace");
            current = built.document;
            const edits = clearCutLines();
            return result({ ids: built.ids, ...(edits.length > 0 ? { edits } : {}) });
          }),
      }),
      applyDesignPatch: tool({
        description:
          "Replace whole parts of the scene at once. Use it for a modular booth (walls with bays and features, parts as an empty array), to redraw a scene from a drawing, or to clear everything. Dimensions are millimeters. For edits to pieces that already exist, use updateParts, moveParts, addParts, and removeParts instead, because this tool replaces any list you send.",
        inputSchema: designPatchSchema,
        execute: async (patch) =>
          attempt(() => {
            if (buildMode && patch.parts && patch.parts.length > 0) {
              return { error: "Here pieces are added with addElements and changed with updateParts, moveParts, and removeParts, so nothing already drawn is lost. Use this tool only for a modular booth frame (walls and features) or with parts [] to clear everything." };
            }
            current = applyDesignPatch(current, patch);
            const edits = clearCutLines();
            return result(edits.length > 0 ? { edits } : {});
          }),
      }),
      generateStandImage: tool({
        description:
          "Generate one photoreal simulation of the stand, or edit the current one. For a new picture, describe the pieces, materials, colors, and graphics from the job. For an edit, describe only the change. When the user selected an area or uploaded artwork, say to change that area of the same picture and to leave the rest identical. The camera, light, and hall are added for you. Call this once per picture.",
        inputSchema: z.object({
          description: z.string().min(20).max(4000),
        }),
        execute: async ({ description }) => generateStandSimulation(body.imageModel ?? "", description, editFromMessages(messages)),
        toModelOutput: ({ output }) => ({
          type: "text",
          value:
            output && typeof output === "object" && "error" in output && output.error
              ? `Image generation failed: ${output.error}`
              : "The simulation image was generated and is shown to the user. Do not repeat the image prompt.",
        }),
      }),
      blenderPython: tool({
        description:
          "Blender mode. Run Python inside the Blender drawing on the studio laptop, for freeform and decorative work the piece tools cannot make. Tag every object you create with proink.tag. Afterwards the studio reads the drawing back, so moved, turned, and new objects are priced. Returns what the code printed, or the error.",
        inputSchema: z.object({
          purpose: z.string().min(3).max(200),
          code: z.string().min(1).max(20_000),
        }),
        execute: async ({ code }) => {
          if (!blenderMode) return { error: "Blender is not linked. Ask the user to open Blender and turn on the Blender link in the 3D view." };
          const ran = await runInBlender(code);
          if (failed(ran) && !("output" in ran)) return { error: "error" in ran ? ran.error : "Blender did not answer." };
          const pulled = await pullFromBlender(current);
          if (!failed(pulled) && !pulled.empty) current = pulled.document;
          const edits = clearCutLines();
          return result({
            ran: ran.ok,
            printed: "output" in ran ? String(ran.output).slice(-4000) : "",
            ...(ran.ok ? {} : { error: String((ran as { error?: string }).error ?? "The code failed.").slice(-3000) }),
            notes: failed(pulled) ? [String(pulled.error)] : pulled.notes,
            ...(edits.length > 0 ? { edits } : {}),
          });
        },
      }),
      blenderLook: tool({
        description: "Blender mode. See the drawing in Blender: front, side (from the right), top, and a three-quarter view. Use it to check a new or complicated shape against the client's reference before answering.",
        inputSchema: z.object({ views: z.array(z.enum(["front", "side", "top", "iso"])).min(1).max(4) }),
        execute: async ({ views }, { toolCallId }) => {
          if (!blenderMode) return { error: "Blender is not linked." };
          const shot = await lookInBlender(views);
          if (failed(shot)) return { error: "error" in shot ? shot.error : "Blender did not answer." };
          blenderShots.set(toolCallId, shot.images);
          return { views: shot.images.map((image) => image.view) };
        },
        toModelOutput: ({ toolCallId, output }) => {
          const images = blenderShots.get(toolCallId);
          if (!images?.length) {
            const error = output && typeof output === "object" && "error" in output ? String(output.error) : "";
            return { type: "text", value: error ? `No screenshots: ${error}` : "These screenshots were shown earlier. Look again to see the drawing as it is now." };
          }
          return {
            type: "content",
            value: [
              { type: "text", text: `Blender drawing: ${images.map((image) => image.view).join(", ")}. Front looks from the viewer, side from the right, top from above.` },
              ...images.map((image) => ({ type: "file" as const, data: { type: "data" as const, data: image.png }, mediaType: "image/png" })),
            ],
          };
        },
      }),
      zoomFile: tool({
        description: "See part of an attached picture at full resolution, to read a small detail: an edge, a corner, a label, a written size, a row of shelves. The region is in fractions of the picture from its top-left corner: x 0.5, y 0, width 0.5, height 0.5 is the top-right quarter.",
        inputSchema: z.object({
          picture: z.number().int().min(1).describe("The picture's number from the list."),
          x: z.number().min(0).max(1),
          y: z.number().min(0).max(1),
          width: z.number().min(0.02).max(1),
          height: z.number().min(0.02).max(1),
          lookingFor: z.string().max(200).describe("What you want to read there."),
        }),
        execute: async ({ picture, x, y, width, height }, { toolCallId }) => {
          const found = pictures.find((item) => item.number === picture);
          if (!found) return { error: `There is no picture ${picture}. The pictures are numbered 1 to ${pictures.length}.` };
          const zoom = await zoomPicture(found, { x, y, width, height });
          zooms.set(toolCallId, zoom.png);
          return { picture, name: found.name, pixels: zoom.region };
        },
        toModelOutput: ({ toolCallId, output }) => {
          const png = zooms.get(toolCallId);
          if (!png) {
            const error = output && typeof output === "object" && "error" in output ? String(output.error) : "";
            return { type: "text", value: error || "This zoom was shown earlier. Zoom again to see it." };
          }
          const record = output as { name: string; pixels: { left: number; top: number; width: number; height: number } };
          return {
            type: "content",
            value: [
              { type: "text", text: `${record.name}, pixels ${record.pixels.left}, ${record.pixels.top} to ${record.pixels.left + record.pixels.width}, ${record.pixels.top + record.pixels.height}, enlarged.` },
              { type: "file" as const, data: { type: "data" as const, data: png }, mediaType: "image/png" },
            ],
          };
        },
      }),
      inspect: tool({
        description:
          "Run the production check. The workshop foreman looks at the finished job and returns findings and questions. Call it after pieces were added, removed, resized, or assembled. No input is required. focus is an optional short note on what to look at.",
        inputSchema: z.object({ focus: z.string().max(300).optional() }),
        execute: async ({ focus }, { abortSignal }) => {
          if (current.parts.length === 0) return { error: "There are no pieces to check yet." };
          if (inspections >= 2) return { error: "The production check already ran twice in this reply. Report the open findings." };
          const asked = focus?.trim();
          const outcome = await inspectStand({
            document: current,
            book: jobBook(),
            brief: [jobBrief(messages), asked ? `Focus: ${asked}` : ""].filter(Boolean).join("\n\n"),
            sourceKind,
            model: resolved.model,
            ...("providerOptions" in resolved ? { providerOptions: resolved.providerOptions } : {}),
            files: inspectionFiles(messages),
            abortSignal,
          });
          if ("error" in outcome) return { error: outcome.error };
          inspections += 1;
          current = setReview(current, outcome.inspection);
          const spend = spendFor(body.provider ?? "", body.model ?? "", outcome.usage);
          return { document: current, inspection: outcome.inspection, ...(spend ? { spend } : {}) };
        },
        toModelOutput: ({ output }) => ({ type: "text", value: briefInspection(output, { ask: !assembleMode }) }),
      }),
      addJobMaterial: tool({
        description: priceMode
          ? "Pricing mode. Add one board or sheet priced by estimate for this job only. Only for a board or sheet that is in neither <materials> nor <sheets>; never for hardware, labor or anything bought by the piece (that is suggestCosts). Set materialId on the priceBoards pieces cut from it to the id this returns."
          : "Quote mode. Add one board or sheet priced by estimate for this job only. Only for a board or sheet that is in neither <materials> nor <sheets>; never for hardware, labor or anything bought by the piece (that is suggestCosts). Set materialId on the pieces cut from it to the id this returns.",
        inputSchema: z.object({
          name: z.string().min(2).max(70),
          piece: partMaterialSchema.nullable(),
          unit: z.enum(["board", "m2"]),
          priceUsd: z.number().positive(),
          boardWidthMm: z.number().positive().nullable().optional(),
          boardHeightMm: z.number().positive().nullable().optional(),
          thicknessMm: z.number().positive().nullable().optional(),
        }),
        execute: async ({ name, piece, unit, priceUsd, boardWidthMm, boardHeightMm, thicknessMm }) =>
          attempt(() => {
            const priceCents = Math.round(priceUsd * 100);
            if (priceCents <= 0) return { error: "Give a price above zero." };
            const added = addJobMaterial(current, {
              name,
              piece,
              unit,
              priceCents,
              ...(typeof boardWidthMm === "number" ? { boardWidthMm } : {}),
              ...(typeof boardHeightMm === "number" ? { boardHeightMm } : {}),
              ...(typeof thicknessMm === "number" ? { thicknessMm } : {}),
            });
            current = added.document;
            return result({ materialId: added.id, note: priceMode ? "Priced by estimate on this job only. Set materialId on the priceBoards pieces cut from it." : "Priced by estimate on this job only. Set materialId on the pieces cut from it." });
          }),
      }),
  };

  if (blenderMode) {
    // Every piece change shows in Blender before the model takes its next step.
    const mirrored = tools as unknown as Record<string, { execute?: (input: unknown, options: unknown) => Promise<unknown> }>;
    for (const name of ["addElements", "addParts", "updateParts", "moveParts", "removeParts", "applyTemplate", "applyDesignPatch", "arrangeParts"]) {
      const original = mirrored[name]?.execute;
      if (!original) continue;
      mirrored[name].execute = async (input, options) => {
        const output = await original(input, options);
        const trouble = await mirror();
        return trouble && output && typeof output === "object" ? { ...output, blender: trouble } : output;
      };
    }
  }
  arrangeForAssembly = tools.arrangeParts.execute as never;

  const outgoing = assembleMode ? assemblyHistory(messages) : buildMode || priceMode ? slimQuoteHistory(withMentions(messages)) : withMentions(messages);
  if (buildMode) {
    const brief = ({ output }: { output: unknown }) => ({ type: "text" as const, value: briefQuoteResult(output) });
    for (const name of ["getDesign", "addElements", "updateParts", "moveParts", "removeParts", "applyTemplate", "applyDesignPatch", "blenderPython", "addJobMaterial"] as const) tools[name].toModelOutput = brief;
  }
  if (priceMode) tools.suggestCosts.toModelOutput = ({ output }) => ({ type: "text", value: briefSuggestCosts(output) });

  const modelMessages = await convertToModelMessages(outgoing, { tools });
  const run = typeof body.chatId === "string" && body.chatId ? chatRun(gate, { chatId: body.chatId, projectId: body.projectId, files: readFiles(body.files) }) : null;
  const stopper = new AbortController();
  if (run) {
    await run.start(() => stopper.abort());
    // The user's message is stored before the reply starts, so a reload while waiting does not lose it.
    void run.save(body.messages ?? []);
  }

  // Gemini reads attached pictures at high resolution, so small edges and written sizes stay legible.
  function providerOptions() {
    const options = "providerOptions" in resolved ? resolved.providerOptions : undefined;
    if (body.provider !== "google" || !pictures.length) return options ? { providerOptions: options } : {};
    return { providerOptions: { ...options, google: { ...options?.google, mediaResolution: "MEDIA_RESOLUTION_HIGH" } } };
  }

  const limitMs = assembleMode ? ASSEMBLE_LIMIT_MS : RUN_LIMIT_MS;
  const deadline = AbortSignal.timeout(limitMs);
  const tooLong = `The model took longer than ${Math.round(limitMs / 60_000)} minutes, so the reply was stopped. Changes made before that are kept. Try again, or pick a faster model.`;

  // Calls in one step start together. These three wait for the ones that started before them.
  const toolGate = createToolGate();
  const logMode = priceMode ? "price" : imageMode ? "image" : assembleMode ? "assemble" : "quote";
  const timing = createChatLog(Date.now, logMode);
  const guarded = tools as unknown as Record<string, { execute?: (input: never, options: never) => Promise<unknown> }>;
  for (const name of Object.keys(guarded)) {
    const original = guarded[name]?.execute;
    if (!original) continue;
    const mode: GateMode = name === "assemble" || name === "inspect" ? "block" : name === "arrangeParts" ? "wait" : "plain";
    guarded[name].execute = async (input, options) => {
      const slot = timing.toolStart(name);
      let time = { waitMs: 0, runMs: 0 };
      try {
        const output = await runGated({
          gate: toolGate,
          mode,
          run: () => original(input, options),
          onTime: (next) => {
            time = next;
          },
        });
        const steps = readStepCount(output);
        slot.finish({ ...time, ...(steps != null ? { steps } : {}) });
        if ((name === "assemble" || name === "inspect") && output && typeof output === "object") (output as { ms?: number }).ms = time.runMs;
        return output;
      } catch (error) {
        slot.finish(time);
        throw error;
      }
    };
  }

  const modelLabel = [body.provider, body.model].filter(Boolean).join("/") || "unknown";
  const stream = streamText({
    model: resolved.model,
    system: assembleMode
      ? assemblePrompt(current, { inspect: true })
      : imageMode
        ? imagePrompt(current)
        : priceMode
          ? priceSystem()
          : quoteSystem(),
    ...providerOptions(),
    messages: modelMessages,
    temperature: imageMode ? undefined : 0,
    stopWhen: stepCountIs(imageMode ? 4 : assembleMode ? 6 : priceMode ? 8 : 20),
    activeTools: assembleMode
      ? [...ASSEMBLE_TOOLS]
      : imageMode
        ? [...IMAGE_TOOLS]
        : priceMode
          ? [...PRICE_TOOLS, ...(pastQuotes ? ["findPastQuotes" as const] : []), ...(pictures.length ? ["zoomFile" as const] : [])]
          : [...QUOTE_TOOLS, ...(standImage ? ["generateStandImage" as const] : []), ...(pastQuotes ? ["findPastQuotes" as const] : []), ...(blenderMode ? BLENDER_TOOLS : []), ...(pictures.length ? ["zoomFile" as const] : [])],
    // A reload or a closed tab does not end the reply. Only Stop does, through the chat's stop flag, or the time limit.
    abortSignal: AbortSignal.any([run ? stopper.signal : request.signal, deadline]),
    ...(process.env.NODE_ENV === "development" ? { include: { requestBody: true } } : {}),
    tools,
    onStepStart: () => {
      toolGate.reset();
      timing.stepStart();
    },
    onStepEnd: () => timing.stepEnd(),
    onEnd: () => timing.finish(modelLabel),
    onAbort: () => timing.finish(modelLabel, true),
  });

  const providerId = body.provider ?? "";
  const modelId = body.model ?? "";
  // The browser and the server read their own copy of the reply. The server's copy is read to the end
  // whatever happens to the browser, and it is the one that is stored.
  const replyId = messageId();
  const originalMessages = body.messages ?? [];
  if (run) {
    const work = () => ({ document: current, costing: costingNow });
    const stored = toUIMessageStream({
      stream: stream.stream,
      tools,
      originalMessages,
      generateMessageId: () => replyId,
      onStepEnd: ({ messages: saved }) => void run.save(saved, work()),
      onEnd: ({ messages: saved }) => run.save(deadline.aborted ? withNote(saved, tooLong, replyId) : saved, work()),
    });
    const done = drain(stored)
      .catch((error: unknown) => console.error("The reply could not be stored", error))
      .finally(() => run.finish());
    after(() => done);
  }

  const live = stream.toUIMessageStream({
    originalMessages,
    generateMessageId: () => replyId,
    messageMetadata: ({ part }) => {
      if (part.type !== "finish") return undefined;
      const spend = spendFor(providerId, modelId, part.totalUsage);
      return spend ? { spend } : undefined;
    },
  });
  // The time limit ends the reply like Stop does, which the chat shows as nothing. Say why instead.
  const explained = live.pipeThrough(
    new TransformStream<UIMessageChunk, UIMessageChunk>({
      transform(chunk, controller) {
        controller.enqueue(chunk.type === "abort" && deadline.aborted ? { type: "error", errorText: tooLong } : chunk);
      },
    }),
  );
  return createUIMessageStreamResponse({ stream: explained });
}

/** The stored reply ends with a line saying why it stopped, so the chat shows it after a reload. */
function withNote(messages: UIMessage[], note: string, replyId: string): UIMessage[] {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return [...messages, { id: replyId, role: "assistant", parts: [{ type: "text", text: note }] }];
  return [...messages.slice(0, -1), { ...last, parts: [...last.parts, { type: "text", text: note }] }];
}
