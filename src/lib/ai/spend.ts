import { providerById, type ProviderId } from "./models";

/** Thousandths of a cent. $1 is 100,000 mills, so small model calls still add up. */
export const MILLS_PER_DOLLAR = 100_000;

/** A fresh balance, so an unused provider reads 0% with the full amount left. */
export const DEFAULT_BALANCE_MILLS = 20 * MILLS_PER_DOLLAR;

export type TokenUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
};

export type SpendNote = {
  id: string;
  provider: ProviderId;
  model: string;
  mills: number;
};

type Rate = { prefix: string; input: number; output: number };

/**
 * Published list prices in USD per million tokens. Longer prefixes win, so
 * gpt-4o-mini is not billed as gpt-4o. Anything unrecognized uses the provider default.
 */
const RATES: Record<ProviderId, Rate[]> = {
  openai: [
    { prefix: "gpt-4o-mini", input: 0.15, output: 0.6 },
    { prefix: "gpt-4.1-nano", input: 0.1, output: 0.4 },
    { prefix: "gpt-4.1-mini", input: 0.4, output: 1.6 },
    { prefix: "gpt-4.1", input: 2, output: 8 },
    { prefix: "gpt-4o", input: 2.5, output: 10 },
    { prefix: "o4-mini", input: 1.1, output: 4.4 },
    { prefix: "o3-mini", input: 1.1, output: 4.4 },
    { prefix: "o3", input: 2, output: 8 },
    { prefix: "o1", input: 15, output: 60 },
    { prefix: "", input: 2.5, output: 10 },
  ],
  anthropic: [
    { prefix: "claude-fable-5-2", input: 8, output: 40 },
    { prefix: "claude-opus-5-5", input: 4, output: 20 },
    { prefix: "claude-opus", input: 15, output: 75 },
    { prefix: "claude-haiku", input: 0.8, output: 4 },
    { prefix: "claude-sonnet", input: 3, output: 15 },
    { prefix: "", input: 3, output: 15 },
  ],
  google: [
    // Introductory price through Nov 30, 2026. $4 / $20 after that.
    { prefix: "gemini-4-carbon", input: 2, output: 10 },
    { prefix: "gemini-4-neon", input: 3, output: 15 },
    // Placeholder: Pro-tier rate until the published price is confirmed.
    { prefix: "gemini-4-argon", input: 1.25, output: 10 },
    { prefix: "gemini-3.8-flash", input: 0.3, output: 2.5 },
    { prefix: "gemini-3.5-pro", input: 1.25, output: 10 },
    { prefix: "gemini-2.5-flash", input: 0.3, output: 2.5 },
    { prefix: "gemini-2.5-pro", input: 1.25, output: 10 },
    { prefix: "gemini-2.0-flash", input: 0.1, output: 0.4 },
    { prefix: "gemini-1.5-flash", input: 0.075, output: 0.3 },
    { prefix: "gemini-1.5-pro", input: 1.25, output: 5 },
    { prefix: "", input: 0.3, output: 2.5 },
  ],
};

/**
 * One generated picture at the default 1K size, plus the prompt and any thinking tokens.
 * The flat image price already covers the picture's own output tokens.
 */
const IMAGE_RATES: { prefix: string; imageDollars: number; imageTokens: number; input: number; thinking: number }[] = [
  { prefix: "gemini-3-pro-image", imageDollars: 0.134, imageTokens: 1120, input: 2, thinking: 12 },
  { prefix: "gemini-nano-banana-2.1", imageDollars: 0.0336, imageTokens: 1120, input: 1.5, thinking: 7.5 },
];

function imageRateFor(model: string) {
  const name = model.toLowerCase();
  return IMAGE_RATES.find((rate) => name.startsWith(rate.prefix));
}

/** What one image call cost, in mills. The picture is priced even when the provider reports no tokens. */
export function millsForImage(model: string, usage: TokenUsage = {}) {
  const rate = imageRateFor(model);
  if (!rate) return 0;
  const input = Math.max(0, usage.inputTokens ?? 0);
  const thinking = Math.max(0, (usage.outputTokens ?? 0) - rate.imageTokens);
  const dollars = rate.imageDollars + (input / 1_000_000) * rate.input + (thinking / 1_000_000) * rate.thinking;
  return Math.max(0, Math.round(dollars * MILLS_PER_DOLLAR));
}

export function spendForImage(providerId: string, model: string, usage?: TokenUsage, id = crypto.randomUUID()): SpendNote | null {
  const provider = providerById(providerId);
  const mills = millsForImage(model, usage);
  if (!provider || mills <= 0) return null;
  return { id, provider: provider.id, model: model.slice(0, 80) || provider.defaultModel, mills };
}

function rateFor(provider: ProviderId, model: string) {
  const name = model.toLowerCase();
  return RATES[provider].find((rate) => name.startsWith(rate.prefix)) ?? RATES[provider][RATES[provider].length - 1];
}

/** What one model call cost, in mills. Zero when the provider is unknown or no tokens were reported. */
export function millsForUsage(providerId: string, model: string, usage: TokenUsage) {
  const provider = providerById(providerId);
  if (!provider) return 0;
  const input = Math.max(0, usage.inputTokens ?? 0);
  const output = Math.max(0, usage.outputTokens ?? 0);
  if (input === 0 && output === 0) return 0;
  const rate = rateFor(provider.id, model);
  const dollars = (input / 1_000_000) * rate.input + (output / 1_000_000) * rate.output;
  return Math.max(0, Math.round(dollars * MILLS_PER_DOLLAR));
}

export function spendFor(providerId: string, model: string, usage: TokenUsage, id = crypto.randomUUID()): SpendNote | null {
  const provider = providerById(providerId);
  const mills = millsForUsage(providerId, model, usage);
  if (!provider || mills <= 0) return null;
  return { id, provider: provider.id, model: model.slice(0, 80) || provider.defaultModel, mills };
}

export function readSpend(value: unknown): SpendNote | null {
  if (!value || typeof value !== "object") return null;
  const raw = "spend" in value ? (value as { spend: unknown }).spend : value;
  if (!raw || typeof raw !== "object") return null;
  const { id, provider, model, mills } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !id || typeof model !== "string") return null;
  if (provider !== "openai" && provider !== "anthropic" && provider !== "google") return null;
  if (typeof mills !== "number" || !Number.isFinite(mills) || mills <= 0) return null;
  return { id, provider, model: model.slice(0, 80), mills: Math.round(mills) };
}

export type UsageReading = {
  /** 0 when nothing is spent, 100 when the balance is gone. */
  percent: number;
  spentMills: number;
  leftMills: number;
  overMills: number;
};

/**
 * Usage is the share of the balance that is gone.
 * $20 with nothing spent is 0%. Half spent is 50%, with $10 left.
 */
export function usageReading(balanceMills: number, spentMills: number): UsageReading {
  const balance = Math.max(0, balanceMills);
  const spent = Math.max(0, spentMills);
  const percent = balance <= 0 ? (spent > 0 ? 100 : 0) : Math.min(100, Math.round((spent / balance) * 100));
  return {
    percent,
    spentMills: spent,
    leftMills: Math.max(0, balance - spent),
    overMills: Math.max(0, spent - balance),
  };
}

export function dollarsToMills(dollars: number) {
  if (!Number.isFinite(dollars) || dollars <= 0) return 0;
  return Math.round(Math.min(dollars, 100_000) * MILLS_PER_DOLLAR);
}
