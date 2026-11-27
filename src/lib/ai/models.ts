export const PROVIDERS = [
  {
    id: "openai",
    label: "OpenAI",
    defaultModel: "gpt-4o",
    env: "OPENAI_API_KEY",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-5",
    env: "ANTHROPIC_API_KEY",
  },
  {
    id: "google",
    label: "Google",
    defaultModel: "gemini-3.8-flash",
    env: "GOOGLE_GENERATIVE_AI_API_KEY",
  },
] as const;

export type ProviderId = (typeof PROVIDERS)[number]["id"];

export type ModelOption = {
  id: string;
  label: string;
  provider: ProviderId;
  providerLabel: string;
  tier: "premium" | "standard";
  model: string;
};

export const MODEL_CATALOG: ModelOption[] = [
  // Premium — flagship models for complex sheets, renders, and full stand builds
  {
    id: "google:gemini-4-carbon",
    label: "Gemini 4 Carbon",
    provider: "google",
    providerLabel: "Google",
    tier: "premium",
    model: "gemini-4-carbon",
  },
  {
    id: "google:gemini-4-neon",
    label: "Gemini 4 Neon",
    provider: "google",
    providerLabel: "Google",
    tier: "premium",
    model: "gemini-4-neon",
  },
  {
    id: "google:gemini-4-argon",
    label: "Gemini 4 Argon",
    provider: "google",
    providerLabel: "Google",
    tier: "premium",
    model: "gemini-4-argon",
  },
  {
    id: "google:gemini-3.5-pro",
    label: "Gemini 3.5 Pro",
    provider: "google",
    providerLabel: "Google",
    tier: "premium",
    model: "gemini-3.5-pro",
  },
  {
    id: "anthropic:claude-fable-5-2",
    label: "Claude Fable 5.2",
    provider: "anthropic",
    providerLabel: "Anthropic",
    tier: "premium",
    model: "claude-fable-5-2",
  },
  {
    id: "anthropic:claude-sonnet-4-5",
    label: "Claude Sonnet 5.5",
    provider: "anthropic",
    providerLabel: "Anthropic",
    tier: "premium",
    model: "claude-sonnet-4-5",
  },
  {
    id: "anthropic:claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "anthropic",
    providerLabel: "Anthropic",
    tier: "premium",
    model: "claude-opus-5-5",
  },
  {
    id: "openai:gpt-4.1",
    label: "OpenAI Astra (GPT-4.1)",
    provider: "openai",
    providerLabel: "OpenAI",
    tier: "premium",
    model: "gpt-4.1",
  },

  // Standard & Fast — affordable models for normal daily use
  {
    id: "google:gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    provider: "google",
    providerLabel: "Google",
    tier: "standard",
    model: "gemini-3.8-flash",
  },
  {
    id: "anthropic:claude-3-5-haiku-latest",
    label: "Claude Haiku",
    provider: "anthropic",
    providerLabel: "Anthropic",
    tier: "standard",
    model: "claude-3-5-haiku-latest",
  },
  {
    id: "openai:gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    provider: "openai",
    providerLabel: "OpenAI",
    tier: "standard",
    model: "gpt-4.1-mini",
  },
];

/**
 * Google image models for the simulation agent.
 * Pro is the highest-quality picture. 2.1 is the current best everyday model.
 */
export const IMAGE_MODEL_CATALOG: ModelOption[] = [
  {
    id: "google:gemini-3-pro-image",
    label: "Nano Banana Pro",
    provider: "google",
    providerLabel: "Google",
    tier: "premium",
    model: "gemini-3-pro-image",
  },
  {
    id: "google:gemini-nano-banana-2.1",
    label: "Nano Banana 2.1",
    provider: "google",
    providerLabel: "Google",
    tier: "standard",
    model: "gemini-nano-banana-2.1",
  },
];

export const DEFAULT_IMAGE_MODEL = IMAGE_MODEL_CATALOG[0].model;

export function findImageModel(model: string): ModelOption {
  return IMAGE_MODEL_CATALOG.find((item) => item.model === model) ?? IMAGE_MODEL_CATALOG[0];
}

export function providerById(id: string) {
  return PROVIDERS.find((provider) => provider.id === id);
}

export const EFFORTS = ["low", "medium", "high"] as const;
export type Effort = "low" | "medium" | "high";

/** Claude models that always think. They default to high effort, which costs minutes and dollars per step. */
const THINKING_CLAUDE = /^claude-(fable|opus-5|sonnet-5)/;
const OPENAI_REASONING = /^(?:o1|o3|o4|gpt-5)(?:[.-]|$)/;
const GEMINI_25 = /^gemini-2\.5(?:[.-]|$)/;
const GEMINI_MAJOR = /^gemini-(\d+)(?:[.-]|$)/;

/** Gemini 2.5 takes a token budget. Gemini 3 and newer take a thinking level. */
export function googleEffortShape(modelId: string): "budget" | "level" | null {
  if (GEMINI_25.test(modelId)) return "budget";
  const major = GEMINI_MAJOR.exec(modelId);
  if (major && Number(major[1]) >= 3) return "level";
  return null;
}

export function supportsEffort(providerId: string, modelId: string) {
  if (providerId === "anthropic") return THINKING_CLAUDE.test(modelId);
  if (providerId === "openai") return OPENAI_REASONING.test(modelId);
  if (providerId === "google") return googleEffortShape(modelId) !== null;
  return false;
}

export function findModelOption(provider: ProviderId, model: string): ModelOption {
  return (
    MODEL_CATALOG.find((item) => item.provider === provider && item.model === model) ??
    MODEL_CATALOG.find((item) => item.model === model) ??
    MODEL_CATALOG[0]
  );
}
