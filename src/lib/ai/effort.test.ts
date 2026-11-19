import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supportsEffort } from "./models";
import { resolveLanguageModel } from "./resolve-model";

describe("supportsEffort", () => {
  it("matches thinking models and ignores the rest", () => {
    expect(supportsEffort("anthropic", "claude-fable-5-2")).toBe(true);
    expect(supportsEffort("anthropic", "claude-opus-5-5")).toBe(true);
    expect(supportsEffort("anthropic", "claude-sonnet-5")).toBe(true);
    expect(supportsEffort("anthropic", "claude-sonnet-4-5")).toBe(false);
    expect(supportsEffort("anthropic", "claude-3-5-haiku-latest")).toBe(false);

    expect(supportsEffort("google", "gemini-2.5-flash")).toBe(true);
    expect(supportsEffort("google", "gemini-2.5-pro")).toBe(true);
    expect(supportsEffort("google", "gemini-3.8-flash")).toBe(true);
    expect(supportsEffort("google", "gemini-4-carbon")).toBe(true);
    expect(supportsEffort("google", "gemini-2.0-flash")).toBe(false);
    expect(supportsEffort("google", "gemini-pro-latest")).toBe(false);

    expect(supportsEffort("openai", "o1")).toBe(true);
    expect(supportsEffort("openai", "o3-mini")).toBe(true);
    expect(supportsEffort("openai", "o4-mini")).toBe(true);
    expect(supportsEffort("openai", "gpt-5")).toBe(true);
    expect(supportsEffort("openai", "gpt-5.4")).toBe(true);
    expect(supportsEffort("openai", "gpt-4o")).toBe(false);
    expect(supportsEffort("openai", "gpt-4.1")).toBe(false);

    expect(supportsEffort("openai", "claude-opus-5-5")).toBe(false);
    expect(supportsEffort("google", "gpt-5")).toBe(false);
  });
});

describe("resolveLanguageModel effort", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets Anthropic effort and keeps the thinking options", () => {
    const resolved = resolveLanguageModel("anthropic", "claude-opus-5-5", "high");
    expect(resolved).toEqual(
      expect.objectContaining({
        providerOptions: {
          anthropic: {
            effort: "high",
            thinking: { type: "adaptive", display: "summarized", blockBinding: { prefixMismatchBehavior: "drop_block" } },
          },
        },
      }),
    );
  });

  it("sets OpenAI reasoningEffort and defaults a missing or invalid effort to medium", () => {
    expect(resolveLanguageModel("openai", "gpt-5", "low")).toEqual(expect.objectContaining({ providerOptions: { openai: { reasoningEffort: "low" } } }));
    expect(resolveLanguageModel("openai", "o3")).toEqual(expect.objectContaining({ providerOptions: { openai: { reasoningEffort: "medium" } } }));
    expect(resolveLanguageModel("openai", "o4-mini", "max" as never)).toEqual(expect.objectContaining({ providerOptions: { openai: { reasoningEffort: "medium" } } }));
  });

  it("sets Gemini thinkingLevel, and a token budget on Gemini 2.5", () => {
    expect(resolveLanguageModel("google", "gemini-3.8-flash", "high")).toEqual(
      expect.objectContaining({
        providerOptions: { google: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } } },
      }),
    );
    expect(resolveLanguageModel("google", "gemini-2.5-flash", "low")).toEqual(
      expect.objectContaining({
        providerOptions: { google: { thinkingConfig: { thinkingBudget: 1024, includeThoughts: true } } },
      }),
    );
    expect(resolveLanguageModel("google", "gemini-2.5-pro")).toEqual(
      expect.objectContaining({
        providerOptions: { google: { thinkingConfig: { thinkingBudget: 4096, includeThoughts: true } } },
      }),
    );
    expect(resolveLanguageModel("google", "gemini-4-carbon", "high")).toEqual(
      expect.objectContaining({
        providerOptions: { google: { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } } },
      }),
    );
  });

  it("leaves models that do not think unchanged", () => {
    for (const [provider, model] of [
      ["openai", "gpt-4o"],
      ["anthropic", "claude-sonnet-4-5"],
      ["google", "gemini-2.0-flash"],
    ] as const) {
      const resolved = resolveLanguageModel(provider, model, "high");
      expect(resolved).not.toHaveProperty("providerOptions");
      expect(resolved).toHaveProperty("model");
    }
  });
});
