import { describe, expect, it, vi } from "vitest";
import { createChatLog, formatChatDuration, formatChatLog, formatLogDuration, inspectionLine, withDuration } from "./chat-timing";

describe("chat timing", () => {
  it("formats the log the way the server prints it", () => {
    const text = formatChatLog({
      totalMs: 372_000,
      model: "google/gemini-4-argon",
      steps: [
        { ms: 48_000, tools: [] },
        {
          ms: 91_000,
          tools: [
            { name: "addElements", waitMs: 0, runMs: 200 },
            { name: "suggestCosts", waitMs: 0, runMs: 300 },
            { name: "assemble", waitMs: 40, runMs: 125_000, steps: 3 },
            { name: "inspect", waitMs: 0, runMs: 70_000 },
          ],
        },
        { ms: 55_000, tools: [] },
      ],
    });
    expect(text).toBe(
      [
        "[chat] 6m12s · model google/gemini-4-argon · steps 3",
        "  step 1 48s · step 2 1m31s (addElements 0.2s, suggestCosts 0.3s, assemble 2m05s/3 steps, inspect 1m10s) · step 3 55s",
      ].join("\n"),
    );
  });

  it("shows a wait that is long enough to matter, and marks a stopped reply", () => {
    const text = formatChatLog({
      totalMs: 130_000,
      model: "google/gemini-4-argon",
      stopped: true,
      steps: [{ ms: 130_000, tools: [{ name: "inspect", waitMs: 125_000, runMs: 70_000, steps: 1 }] }],
    });
    expect(text).toBe("[chat] 2m10s · model google/gemini-4-argon · steps 1 · stopped\n  step 1 2m10s (inspect wait 2m05s, 1m10s/1 step)");
  });

  it("formats chat lines with a space in the minutes", () => {
    expect(formatLogDuration(200)).toBe("0.2s");
    expect(formatChatDuration(70_000)).toBe("1m 10s");
    expect(withDuration("Stand assembled", 70_000)).toBe("Stand assembled · 1m 10s");
    expect(inspectionLine(2, 70_000)).toBe("Production check: 2 points to decide · 1m 10s");
    expect(inspectionLine(0)).toBe("Production check: no problems found");
    expect(inspectionLine(1, 5_000)).toBe("Production check: 1 point to decide · 5s");
  });

  it("prints one block when the reply ends, and not a second time when it is also stopped", () => {
    let clock = 1_000;
    const log = createChatLog(() => clock);
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.stepStart();
    clock = 1_400;
    const tool = log.toolStart("addElements");
    tool.finish({ waitMs: 0, runMs: 200 });
    clock = 1_500;
    log.stepEnd();
    log.finish("google/gemini-4-argon");
    log.finish("google/gemini-4-argon", true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe("[chat] 0.5s · model google/gemini-4-argon · steps 1\n  step 1 0.5s (addElements 0.2s)");
    spy.mockRestore();
  });
});
