import { describe, expect, it } from "vitest";
import { createEmptyDesign } from "../systems/modular/patch";
import type { DesignDocument } from "../systems/modular/schema";
import { readInspection } from "./inspect";

function document(): DesignDocument {
  return {
    ...createEmptyDesign(),
    parts: [
      { id: "shelf", name: "Shelf", shape: "box", x: 0, y: 0, z: 0, width: 400, height: 18, depth: 300 },
      { id: "hook", name: "Hook", shape: "box", kind: "equipment", x: 40, y: 80, z: 0, width: 6, height: 40, depth: 200 },
    ],
  };
}

function reply(body: unknown) {
  return JSON.stringify(body);
}

const good = {
  summary: "The top hooks stick out. Shorten them before cutting.",
  findings: [
    {
      severity: "serious",
      source: "design",
      pieces: ["hook"],
      problem: "The hook is longer than the stand is deep.",
      fix: "Use a 15 cm hook.",
    },
  ],
  questions: ["How heavy is one pack?"],
};

describe("readInspection", () => {
  it("reads a clean reply", () => {
    const inspection = readInspection(reply(good), document());
    expect(inspection?.summary).toBe(good.summary);
    expect(inspection?.findings).toHaveLength(1);
    expect(inspection?.findings[0]).toMatchObject({
      severity: "serious",
      source: "design",
      pieces: ["hook"],
      problem: good.findings[0].problem,
      fix: good.findings[0].fix,
    });
    expect(inspection?.findings[0]?.id).toMatch(/^[a-f0-9]{8}$/);
    expect(inspection?.questions).toEqual(["How heavy is one pack?"]);
  });

  it("reads a reply wrapped in prose and a code fence", () => {
    const wrapped = `Here is the check.\n\`\`\`json\n${reply(good)}\n\`\`\`\nThat is all.`;
    const inspection = readInspection(wrapped, document());
    expect(inspection?.findings[0]?.problem).toBe(good.findings[0].problem);
    expect(inspection?.questions).toEqual(good.questions);
  });

  it("drops unknown piece ids and keeps the same id for the same problem", () => {
    const first = readInspection(reply({ ...good, findings: [{ ...good.findings[0], pieces: ["hook", "missing", "shelf"] }] }), document());
    const second = readInspection(reply(good), document());
    expect(first?.findings[0]?.pieces).toEqual(["hook", "shelf"]);
    expect(first?.findings[0]?.id).toBe(second?.findings[0]?.id);
    const other = readInspection(reply({ ...good, findings: [{ ...good.findings[0], problem: "A different problem." }] }), document());
    expect(other?.findings[0]?.id).not.toBe(first?.findings[0]?.id);
  });

  it("drops bad entries and defaults a missing severity and source", () => {
    const inspection = readInspection(
      reply({
        summary: "Two notes.",
        findings: [null, "nope", { fix: "no problem" }, { problem: "The shelf may sag.", pieces: "shelf" }, { severity: "urgent", source: "shop", problem: "Check the fixing." }],
        questions: ["", 4, "Is it wall-fixed?"],
      }),
      document(),
    );
    expect(inspection?.findings.map((finding) => finding.problem)).toEqual(["The shelf may sag.", "Check the fixing."]);
    expect(inspection?.findings[0]).toMatchObject({ severity: "check", source: "design", pieces: [] });
    expect(inspection?.findings[1]).toMatchObject({ severity: "check", source: "design" });
    expect(inspection?.questions).toEqual(["Is it wall-fixed?"]);
  });

  it("sorts serious findings first and keeps the limits", () => {
    const findings = [
      ...Array.from({ length: 14 }, (_, index) => ({ severity: "check", problem: `Check ${index} is worth a look before cutting.` })),
      { severity: "serious", problem: "This one has to be remade." },
    ];
    const questions = Array.from({ length: 8 }, (_, index) => `Question ${index}? ${"x".repeat(400)}`);
    const inspection = readInspection(reply({ summary: "s".repeat(800), findings, questions }), document());
    expect(inspection?.summary).toHaveLength(600);
    expect(inspection?.findings).toHaveLength(12);
    expect(inspection?.findings[0]?.severity).toBe("serious");
    expect(inspection?.findings[0]?.problem).toBe("This one has to be remade.");
    expect(inspection?.findings.slice(1).every((finding) => finding.severity === "check")).toBe(true);
    expect(inspection?.questions).toHaveLength(6);
    expect(inspection?.questions[0]).toHaveLength(300);
  });

  it("returns null for garbage", () => {
    const stand = document();
    expect(readInspection("no json here", stand)).toBeNull();
    expect(readInspection("", stand)).toBeNull();
    expect(readInspection("{", stand)).toBeNull();
    expect(readInspection("[]", stand)).toBeNull();
    expect(readInspection("```json\n[]\n```", stand)).toBeNull();
    expect(readInspection("```\nnot json\n```", stand)).toBeNull();
  });
});
