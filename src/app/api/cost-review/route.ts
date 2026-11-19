import { generateText } from "ai";
import { COST_REVIEW_PROMPT, dataRefs, equipmentSuggestions, readReview, reviewBrief } from "@/lib/ai/cost-review";
import { resolveLanguageModel } from "@/lib/ai/resolve-model";
import { readDesignBody } from "@/lib/files/read-design";
import { seedCatalog } from "@/lib/systems/catalog";
import { applyCosting, readCosting } from "@/lib/systems/costing";
import { applyPriceBook } from "@/lib/systems/materials";
import { spendFor } from "@/lib/ai/spend";
import { produceDesign } from "@/lib/systems/modular/produce";
import { loadShopPriceBook, requireStudio } from "@/lib/studio/server-data";

export const maxDuration = 120;

/** Go through the whole stand and list what production needs that the engine does not already count. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    document?: unknown;
    priceBook?: unknown;
    costing?: unknown;
    provider?: string;
    model?: string;
  } | null;
  if (!body) return Response.json({ error: "Send the stand to review." }, { status: 400 });
  if (!(await requireStudio())) return Response.json({ error: "Sign in required." }, { status: 401 });

  const design = readDesignBody(body.document);
  if ("error" in design) return Response.json({ error: design.error }, { status: design.status });
  const empty = design.document.parts.length === 0 && design.document.walls.every((wall) => wall.bays.length === 0);
  if (empty) return Response.json({ error: "Draw something first. There is nothing to cost yet." }, { status: 400 });

  const resolved = resolveLanguageModel(body.provider ?? "", body.model ?? "");
  if ("error" in resolved) return Response.json({ error: resolved.error }, { status: 503 });

  const book = await loadShopPriceBook();
  const costing = readCosting(body.costing);
  const production = produceDesign(design.document, seedCatalog(), book);
  const costed = applyCosting(production.lines, costing);
  const refs = dataRefs(book, applyPriceBook(seedCatalog(), book));
  // A TV and what it needs are added directly, so they cannot be forgotten.
  const preset = equipmentSuggestions(design.document, refs, costed);

  try {
    const result = await generateText({
      model: resolved.model,
      temperature: 0,
      system: COST_REVIEW_PROMPT,
      prompt: reviewBrief({ document: design.document, production, costed, refs, preset }),
    });
    const review = readReview(result.text, { refs, costed, preset });
    const spend = spendFor(body.provider ?? "", body.model ?? "", result.usage);
    if (!review) return Response.json({ error: "The estimator did not return a usable list. Try again.", ...(spend ? { spend } : {}) }, { status: 502 });
    return Response.json({ ...review, ...(spend ? { spend } : {}) });
  } catch (error) {
    console.error("Cost review failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "The review failed." }, { status: 502 });
  }
}
