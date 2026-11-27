import { describe, expect, it } from "vitest";
import { DEFAULT_BALANCE_MILLS, MILLS_PER_DOLLAR, dollarsToMills, millsForImage, millsForUsage, readSpend, usageReading } from "./spend";

describe("usageReading", () => {
  it("reads 0% and the full balance when nothing has been spent", () => {
    const reading = usageReading(20 * MILLS_PER_DOLLAR, 0);
    expect(reading.percent).toBe(0);
    expect(reading.leftMills).toBe(20 * MILLS_PER_DOLLAR);
  });

  it("reads 50% with half the credits left", () => {
    const reading = usageReading(20 * MILLS_PER_DOLLAR, 10 * MILLS_PER_DOLLAR);
    expect(reading.percent).toBe(50);
    expect(reading.leftMills).toBe(10 * MILLS_PER_DOLLAR);
    expect(reading.overMills).toBe(0);
  });

  it("stops the meter at 100% once the balance is gone", () => {
    const reading = usageReading(20 * MILLS_PER_DOLLAR, 30 * MILLS_PER_DOLLAR);
    expect(reading.percent).toBe(100);
    expect(reading.leftMills).toBe(0);
    expect(reading.overMills).toBe(10 * MILLS_PER_DOLLAR);
  });

  it("uses a $20 starting balance", () => {
    expect(DEFAULT_BALANCE_MILLS).toBe(dollarsToMills(20));
  });

  it("reads $0.39 spent from a $20 credit as 2% with $19.61 left", () => {
    const reading = usageReading(dollarsToMills(20), dollarsToMills(0.39));
    expect(reading.percent).toBe(2);
    expect(reading.leftMills).toBe(dollarsToMills(19.61));
  });
});

describe("millsForUsage", () => {
  it("prices a million gpt-4o input tokens at $2.50", () => {
    expect(millsForUsage("openai", "gpt-4o", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(2.5 * MILLS_PER_DOLLAR);
  });

  it("prices mini models on their own rate", () => {
    expect(millsForUsage("openai", "gpt-4o-mini", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(0.15 * MILLS_PER_DOLLAR);
  });

  it("prices each provider from its own list", () => {
    expect(millsForUsage("anthropic", "claude-sonnet-4-5", { inputTokens: 0, outputTokens: 1_000_000 })).toBe(15 * MILLS_PER_DOLLAR);
    expect(millsForUsage("google", "gemini-2.5-flash", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(0.3 * MILLS_PER_DOLLAR);
    expect(millsForUsage("google", "gemini-4-neon", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(18 * MILLS_PER_DOLLAR);
  });

  it("ignores an unknown provider", () => {
    expect(millsForUsage("local", "gpt-4o", { inputTokens: 100, outputTokens: 100 })).toBe(0);
  });
});

describe("millsForImage", () => {
  it("prices one Nano Banana Pro picture at $0.134", () => {
    expect(millsForImage("gemini-3-pro-image")).toBe(Math.round(0.134 * MILLS_PER_DOLLAR));
  });

  it("prices one Nano Banana 2.1 picture at $0.0336", () => {
    expect(millsForImage("gemini-nano-banana-2.1")).toBe(Math.round(0.0336 * MILLS_PER_DOLLAR));
  });

  it("adds the prompt and thinking on top of the picture", () => {
    const picture = millsForImage("gemini-3-pro-image");
    const withPrompt = millsForImage("gemini-3-pro-image", { inputTokens: 1_000_000, outputTokens: 1120 });
    const withThinking = millsForImage("gemini-3-pro-image", { inputTokens: 0, outputTokens: 1120 + 1_000_000 });
    expect(withPrompt - picture).toBe(2 * MILLS_PER_DOLLAR);
    expect(withThinking - picture).toBe(12 * MILLS_PER_DOLLAR);
  });
});

describe("readSpend", () => {
  it("reads a note nested on a response", () => {
    expect(readSpend({ spend: { id: "a", provider: "google", model: "gemini-2.5-flash", mills: 500 } })).toEqual({
      id: "a",
      provider: "google",
      model: "gemini-2.5-flash",
      mills: 500,
    });
  });

  it("drops a note that spent nothing", () => {
    expect(readSpend({ id: "a", provider: "openai", model: "gpt-4o", mills: 0 })).toBeNull();
  });
});
