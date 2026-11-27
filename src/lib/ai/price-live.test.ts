import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generateText, stepCountIs, tool } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { dataRefs, resolveSuggestions } from "@/lib/ai/cost-review";
import { briefPriceBoards, priceBoardPieces, rememberItem } from "@/lib/ai/price-boards";
import { pricePrompt } from "@/lib/ai/price-prompt";
import { providerById } from "@/lib/ai/models";
import { resolveLanguageModel } from "@/lib/ai/resolve-model";
import { lineCents, seedCatalog } from "@/lib/systems/catalog";
import { applyCosting, emptyCosting, replaceCutExtras, type ExtraLine } from "@/lib/systems/costing";
import { applyPriceBook, defaultPriceBook, type PriceBook } from "@/lib/systems/materials";
import { addJobMaterial, bookForJob } from "@/lib/systems/modular/job-materials";
import { createEmptyDesign } from "@/lib/systems/modular/patch";
import { produceDesign } from "@/lib/systems/modular/produce";
import { partMaterialSchema, type DesignDocument } from "@/lib/systems/modular/schema";
import { applyItemEdits } from "@/lib/systems/sections";
import { QUOTE_GROUPS } from "@/lib/systems/types";

// A real model call. The unit suite skips it. Run with PRICE_LIVE=1.
const live = process.env.PRICE_LIVE === "1";

function loadEnv(name: string) {
  const path = resolve(name);
  if (existsSync(path)) process.loadEnvFile(path);
}

describe.skipIf(!live)("pricing mode live call", () => {
  it("prices a described shelf unit", async () => {
    loadEnv(".env.local");
    loadEnv(".env");
    const provider = providerById("google");
    if (!provider) throw new Error("Google provider is missing.");
    const modelId = process.env.EVAL_MODEL?.trim() || provider.defaultModel;
    const resolved = resolveLanguageModel("google", modelId, "low");
    if ("error" in resolved) throw new Error(resolved.error);

    let document: DesignDocument = createEmptyDesign();
    let costing = emptyCosting();
    const asked: { prompt: string; choice: string }[] = [];
    const book = (): PriceBook => bookForJob(defaultPriceBook(), document);
    const refs = () => dataRefs(book(), applyPriceBook(seedCatalog(), book()));
    const costed = () => applyCosting(produceDesign(document, seedCatalog(), book()).lines, costing);

    const system = pricePrompt({
      document,
      book: book(),
      refs: refs(),
      costed: costed(),
      hasFiles: false,
      sourceKind: "description",
    });

    const started = Date.now();
    const providerOptions = "providerOptions" in resolved ? resolved.providerOptions : undefined;
    const result = await generateText({
      model: resolved.model,
      ...(providerOptions ? { providerOptions } : {}),
      system,
      temperature: 0,
      stopWhen: stepCountIs(8),
      prompt: "one painted MDF shelf unit 100 x 180 x 40 cm, 4 shelves, LED strip under each shelf, deliver in Beirut",
      tools: {
        askUser: tool({
          description: "Ask the user up to six questions and wait. Each question has two to six options, most likely first, and that label ends with (recommended).",
          inputSchema: z.object({
            questions: z.array(z.object({
              id: z.string(),
              prompt: z.string(),
              options: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
              allowMultiple: z.boolean().optional(),
            })).min(1).max(6),
          }),
          // The product waits for the user. Here the first option is taken so the price step can still run.
          execute: async ({ questions }) => {
            for (const question of questions) asked.push({ prompt: question.prompt, choice: question.options[0]?.label ?? "" });
            return { answers: questions.map((question) => ({ id: question.id, selected: [question.options[0]?.id ?? ""], custom: "" })) };
          },
        }),
        priceBoards: tool({
          description: "Price every flat piece. Send the full list. Dimensions are millimeters.",
          inputSchema: z.object({
            pieces: z.array(z.object({
              name: z.string(),
              width: z.number(),
              height: z.number(),
              thickness: z.number(),
              material: partMaterialSchema,
              materialId: z.string().optional(),
              quantity: z.number().int().min(1).max(200).default(1),
              item: z.string().optional(),
            })).min(1).max(120),
          }),
          execute: async ({ pieces }) => {
            const priced = priceBoardPieces(document, pieces, book());
            document = priced.document;
            costing = replaceCutExtras(costing, priced.extras);
            return {
              suggestions: priced.extras,
              boards: priced.boards,
              other: priced.other,
              totalCents: priced.totalCents,
              ...(priced.unpriced.length > 0 ? { unpriced: priced.unpriced } : {}),
              ...(priced.note ? { note: priced.note } : {}),
            };
          },
          toModelOutput: ({ output }) => ({ type: "text", value: briefPriceBoards(output) }),
        }),
        suggestCosts: tool({
          description: "Add every cost that is not a board, edge banding, primer, or paint.",
          inputSchema: z.object({
            items: z.array(z.object({
              description: z.string(),
              group: z.enum(QUOTE_GROUPS),
              quantity: z.number().positive(),
              unit: z.string(),
              reason: z.string(),
              match: z.string().nullable(),
              estimateUsd: z.number().nullable(),
              item: z.string().optional(),
            })).min(1).max(60),
          }),
          execute: async ({ items }) => {
            const sheets = items.filter((item) => item.match?.startsWith("material:"));
            const named = items.filter((item) => !item.match?.startsWith("material:")).map((item) => {
              if (!item.item) return item;
              const remembered = rememberItem(document, item.item);
              document = remembered.document;
              return { ...item, item: remembered.id };
            });
            const added = resolveSuggestions(named, { refs: refs(), costed: costed() });
            costing = { ...costing, extras: [...costing.extras, ...added].slice(0, 200) };
            return {
              suggestions: added,
              totalCents: added.reduce((sum, line) => sum + lineCents(line.quantity, line.unitCents), 0),
              ...(sheets.length > 0 ? { note: "Sheets are not cost lines. Call priceBoards with the pieces cut from them and their materialId." } : {}),
            };
          },
        }),
        editCosts: tool({
          description: "Change a cost line that is not a board line.",
          inputSchema: z.object({ lines: z.array(z.object({ key: z.string(), remove: z.boolean().optional(), quantity: z.number().optional(), unitUsd: z.number().optional() })).min(1) }),
          execute: async ({ lines }) => {
            if (lines.some((line) => line.key.startsWith("extra:cut-"))) return { error: "Board lines change only through priceBoards. Call priceBoards again with the full list." };
            return { done: lines.map((line) => line.key) };
          },
        }),
        nameItems: tool({
          description: "Rename an item.",
          inputSchema: z.object({ items: z.array(z.object({ item: z.string(), title: z.string() })).min(1) }),
          execute: async ({ items }) => {
            document = applyItemEdits(document, items.map((row) => ({ itemId: row.item, title: row.title })));
            return { count: items.length };
          },
        }),
        addJobMaterial: tool({
          description: "Add one estimated sheet for this job, then use its id as materialId.",
          inputSchema: z.object({
            name: z.string(),
            piece: partMaterialSchema.nullable(),
            unit: z.enum(["board", "m2"]),
            priceUsd: z.number().positive(),
            boardWidthMm: z.number().nullable().optional(),
            boardHeightMm: z.number().nullable().optional(),
            thicknessMm: z.number().nullable().optional(),
          }),
          execute: async (input) => {
            const added = addJobMaterial(document, {
              name: input.name,
              piece: input.piece,
              unit: input.unit,
              priceCents: Math.round(input.priceUsd * 100),
              ...(typeof input.boardWidthMm === "number" ? { boardWidthMm: input.boardWidthMm } : {}),
              ...(typeof input.boardHeightMm === "number" ? { boardHeightMm: input.boardHeightMm } : {}),
              ...(typeof input.thicknessMm === "number" ? { thicknessMm: input.thicknessMm } : {}),
            });
            document = added.document;
            return { materialId: added.id };
          },
        }),
      },
    });

    const lines = costing.extras.map((line: ExtraLine) => `${line.description}: ${line.quantity} ${line.unit} = $${(lineCents(line.quantity, line.unitCents) / 100).toFixed(2)}`);
    const calls = result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName));
    writeFileSync("/tmp/price-live.json", JSON.stringify({
      model: modelId,
      steps: result.steps.length,
      ms: Date.now() - started,
      calls,
      asked,
      lines,
      parts: document.parts.length,
      reply: result.text.slice(0, 500),
    }, null, 2));
    expect(document.parts).toHaveLength(0);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps.length).toBeLessThanOrEqual(8);
  }, 8 * 60 * 1000);
});
