import { google } from "@ai-sdk/google";
import { generateImage } from "ai";
import type { SimulationEdit } from "./image-edit";
import { findImageModel } from "./models";
import { simulationPrompt } from "./image-prompt";
import { spendForImage } from "./spend";

/** Image generation uses Google. The chat model can still be another provider. */
export function resolveImageModel(modelId: string) {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { error: "Image generation needs GOOGLE_GENERATIVE_AI_API_KEY in .env.local." };
  }
  const chosen = findImageModel(modelId);
  return { provider: "google" as const, modelId: chosen.model, model: google.image(chosen.model) };
}

export async function generateStandSimulation(modelId: string, description: string, edit?: SimulationEdit | null) {
  const resolved = resolveImageModel(modelId);
  if ("error" in resolved) return { error: resolved.error };
  try {
    const result = await generateImage({
      model: resolved.model,
      prompt: edit
        ? {
            text: simulationPrompt(description, { region: edit.region, referenceCount: edit.references.length }),
            images: [edit.base, ...edit.references],
          }
        : simulationPrompt(description),
      aspectRatio: "16:9",
    });
    const mediaType = result.image.mediaType || "image/png";
    const spend = spendForImage(resolved.provider, resolved.modelId, result.usage);
    return { mediaType, image: `data:${mediaType};base64,${result.image.base64}`, ...(spend ? { spend } : {}) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The simulation image could not be generated." };
  }
}
