import { generateText } from "ai";
import { SUGGEST_MATERIALS_PROMPT, readSuggestions } from "@/lib/ai/suggest-materials";
import { resolveLanguageModel } from "@/lib/ai/resolve-model";
import { spendFor } from "@/lib/ai/spend";
import { requireStudio } from "@/lib/studio/server-data";

export const maxDuration = 60;

type RequestPiece = {
  id?: string;
  name?: string;
  sourceMaterial?: string;
  width?: number;
  height?: number;
  depth?: number;
};

/** Suggest a shop material and color for imported pieces the file did not label. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    pieces?: RequestPiece[];
    provider?: string;
    model?: string;
  } | null;
  if (!(await requireStudio())) return Response.json({ error: "Sign in required." }, { status: 401 });
  const pieces = (body?.pieces ?? []).filter((piece) => piece.id && piece.name).slice(0, 80);
  if (pieces.length === 0) return Response.json({ error: "Nothing to label." }, { status: 400 });

  const resolved = resolveLanguageModel(body?.provider ?? "", body?.model ?? "");
  if ("error" in resolved) return Response.json({ error: resolved.error }, { status: 503 });

  const lines = pieces.map(
    (piece, index) =>
      `${index + 1}. id ${piece.id} · ${piece.name} · ${Math.round(piece.width ?? 0)} × ${Math.round(piece.height ?? 0)} × ${Math.round(piece.depth ?? 0)} mm${piece.sourceMaterial ? ` · file material "${piece.sourceMaterial}"` : ""}`,
  );

  try {
    const result = await generateText({
      model: resolved.model,
      system: SUGGEST_MATERIALS_PROMPT,
      prompt: lines.join("\n"),
    });
    const spend = spendFor(body?.provider ?? "", body?.model ?? "", result.usage);
    const suggestions = readSuggestions(result.text, new Set(pieces.map((piece) => piece.id as string)));
    if (!suggestions) return Response.json({ error: "The estimator did not return usable materials. Try again.", ...(spend ? { spend } : {}) }, { status: 502 });
    return Response.json({ suggestions, ...(spend ? { spend } : {}) });
  } catch (error) {
    console.error("Material suggestion failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "The suggestion failed." }, { status: 502 });
  }
}
