import { generateText } from "ai";
import { LEBANESE_SYSTEM_PROMPT, readTranslations } from "@/lib/ai/lebanese";
import { resolveLanguageModel } from "@/lib/ai/resolve-model";
import { spendFor } from "@/lib/ai/spend";
import { requireStudio } from "@/lib/studio/server-data";

export const maxDuration = 60;

const MAX_MESSAGES = 40;
const MAX_LENGTH = 600;

/** Turn the Check panel's messages into Lebanese Arabic written in English letters. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { texts?: unknown; provider?: string; model?: string } | null;
  if (!(await requireStudio())) return Response.json({ error: "Sign in required." }, { status: 401 });
  const texts = Array.isArray(body?.texts) ? body.texts.filter((item): item is string => typeof item === "string") : [];
  if (texts.length === 0 || texts.length > MAX_MESSAGES || texts.some((text) => !text.trim() || text.length > MAX_LENGTH)) {
    return Response.json({ error: "Send between 1 and 40 short messages to translate." }, { status: 400 });
  }

  const resolved = resolveLanguageModel(body?.provider ?? "", body?.model ?? "");
  if ("error" in resolved) return Response.json({ error: resolved.error }, { status: 503 });

  try {
    const result = await generateText({
      model: resolved.model,
      system: LEBANESE_SYSTEM_PROMPT,
      prompt: JSON.stringify(texts),
    });
    const spend = spendFor(body?.provider ?? "", body?.model ?? "", result.usage);
    const translations = readTranslations(result.text, texts.length);
    if (!translations) {
      return Response.json({ error: "The model did not return a clean translation. Try again.", ...(spend ? { spend } : {}) }, { status: 502 });
    }
    return Response.json({ translations, ...(spend ? { spend } : {}) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The translation failed." }, { status: 502 });
  }
}
