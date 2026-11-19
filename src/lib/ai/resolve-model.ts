import type { SharedV4ProviderOptions } from "@ai-sdk/provider";
import { anthropic, type AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import { google, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { openai, type OpenAILanguageModelResponsesOptions } from "@ai-sdk/openai";
import { googleEffortShape, providerById, supportsEffort, type Effort } from "./models";

export { EFFORTS, supportsEffort, type Effort } from "./models";

const GEMINI_25_BUDGET = { low: 1024, medium: 4096, high: 12288 } as const;

function chosenEffort(effort?: Effort): Effort {
  return effort === "low" || effort === "high" ? effort : "medium";
}

function withProviderOptions<T>(model: T, providerOptions: SharedV4ProviderOptions) {
  return { model, providerOptions };
}

export function resolveLanguageModel(providerId: string, modelId: string, effort?: Effort) {
  const provider = providerById(providerId);
  if (!provider) return { error: "Choose OpenAI, Anthropic, or Google." };
  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(modelId)) {
    return { error: "Enter a model id such as gpt-4o, claude-sonnet-4-5, or gemini-3.8-flash." };
  }
  if (!process.env[provider.env]) {
    return { error: `Add ${provider.env} to .env.local to use ${provider.label}.` };
  }
  const level = chosenEffort(effort);
  if (provider.id === "openai") {
    if (!supportsEffort("openai", modelId)) return { model: openai(modelId) };
    const options = { reasoningEffort: level } satisfies OpenAILanguageModelResponsesOptions;
    return withProviderOptions(openai(modelId), { openai: options });
  }
  if (provider.id === "anthropic") {
    if (!supportsEffort("anthropic", modelId)) return { model: anthropic(modelId) };
    // Summarized thinking streams to the chat, so a long think shows what it is working on.
    // The system prompt carries the current design, so it changes every turn. Earlier thinking is bound
    // to the prompt it was made with, and Anthropic rejects it after a change unless it may be dropped.
    const options = {
      effort: level,
      thinking: { type: "adaptive", display: "summarized", blockBinding: { prefixMismatchBehavior: "drop_block" } },
    } satisfies AnthropicLanguageModelOptions;
    return withProviderOptions(anthropic(modelId), { anthropic: options });
  }
  const shape = googleEffortShape(modelId);
  if (!shape) return { model: google(modelId) };
  if (shape === "budget") {
    const options = { thinkingConfig: { thinkingBudget: GEMINI_25_BUDGET[level], includeThoughts: true } } satisfies GoogleLanguageModelOptions;
    return withProviderOptions(google(modelId), { google: options });
  }
  const options = { thinkingConfig: { thinkingLevel: level, includeThoughts: true } } satisfies GoogleLanguageModelOptions;
  return withProviderOptions(google(modelId), { google: options });
}
