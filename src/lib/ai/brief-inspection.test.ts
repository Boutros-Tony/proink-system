import { describe, expect, it } from "vitest";
import { briefInspection } from "./brief-inspection";

const finding = {
  id: "ab12cd34",
  severity: "serious",
  source: "design",
  pieces: ["hook", "side"],
  problem: "The hook reaches 80 mm past the side.",
  fix: "Shorten it to 220 mm.",
};

describe("brief inspection", () => {
  it("lists each finding and tells the model to ask", () => {
    const text = briefInspection({
      inspection: { summary: "One problem.", findings: [finding], questions: ["How heavy is the product?"] },
    });
    expect(text).toBe(
      [
        "ab12cd34 [serious] pieces: hook, side — The hook reaches 80 mm past the side. — Fix: Shorten it to 220 mm.",
        "Questions:",
        "How heavy is the product?",
        "Ask the user about these with askUser, one question per finding with id finding:<id>; do not change pieces for a finding before they answer.",
      ].join("\n"),
    );
  });

  it("says plainly when there is nothing to ask", () => {
    expect(briefInspection({ inspection: { summary: "Sound.", findings: [], questions: [] } })).toBe("No problems found and no questions.");
  });

  it("leaves the ask out when this reply cannot call askUser", () => {
    const text = briefInspection({ inspection: { findings: [finding], questions: [] } }, { ask: false });
    expect(text).toBe("ab12cd34 [serious] pieces: hook, side — The hook reaches 80 mm past the side. — Fix: Shorten it to 220 mm.");
    expect(text).not.toContain("askUser");
  });

  it("returns the error instead of a report", () => {
    expect(briefInspection({ error: "There are no pieces to check yet." })).toBe("There are no pieces to check yet.");
    expect(briefInspection({})).toBe("The production check failed.");
  });
});
