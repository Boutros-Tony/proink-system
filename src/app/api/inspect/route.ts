import { inspectStand } from "@/lib/ai/inspect";
import { EFFORTS, resolveLanguageModel } from "@/lib/ai/resolve-model";
import { spendFor } from "@/lib/ai/spend";
import { readDesignBody } from "@/lib/files/read-design";
import { bookForJob } from "@/lib/systems/modular/job-materials";
import { setReview } from "@/lib/systems/modular/review";
import { loadShopPriceBook, requireStudio } from "@/lib/studio/server-data";

export const maxDuration = 120;

/** The workshop foreman looks at one finished stand. The client stores the review on the job. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    document?: unknown;
    provider?: string;
    model?: string;
    effort?: string;
    brief?: string;
    sourceKind?: string;
    projectId?: string;
  } | null;
  if (!body) return Response.json({ error: "Send the stand to check." }, { status: 400 });
  if (!(await requireStudio())) return Response.json({ error: "Sign in required." }, { status: 401 });

  const design = readDesignBody(body.document);
  if ("error" in design) return Response.json({ error: design.error }, { status: design.status });
  if (design.document.parts.length === 0) return Response.json({ error: "There are no pieces to check yet." }, { status: 400 });

  const effort = EFFORTS.find((item) => item === body.effort);
  const resolved = resolveLanguageModel(body.provider ?? "", body.model ?? "", effort);
  if ("error" in resolved) return Response.json({ error: resolved.error }, { status: 503 });

  const sourceKind = body.sourceKind === "simulation" || body.sourceKind === "technical" || body.sourceKind === "3d_file" ? body.sourceKind : "description";
  const brief = typeof body.brief === "string" ? body.brief.slice(0, 8000) : "";

  try {
    const outcome = await inspectStand({
      document: design.document,
      book: bookForJob(await loadShopPriceBook(), design.document),
      brief,
      sourceKind,
      model: resolved.model,
      ...("providerOptions" in resolved ? { providerOptions: resolved.providerOptions } : {}),
    });
    if ("error" in outcome) return Response.json({ error: outcome.error }, { status: 502 });
    const review = setReview(design.document, outcome.inspection).review;
    if (!review) return Response.json({ error: "The production check could not be stored." }, { status: 502 });
    const spend = spendFor(body.provider ?? "", body.model ?? "", outcome.usage);
    return Response.json({ review, ...(spend ? { spend } : {}) });
  } catch (error) {
    console.error("Production check failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "The production check failed." }, { status: 502 });
  }
}
