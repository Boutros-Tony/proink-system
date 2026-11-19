import { describe, expect, it } from "vitest";
import { findingIdsToAccept } from "./kept-findings";

const input = {
  questions: [
    {
      id: "finding:ab12cd34",
      prompt: "The hook sticks out. Shorten it?",
      options: [
        { id: "fix", label: "Shorten to 220 mm (recommended)" },
        { id: "keep", label: "Keep as drawn" },
      ],
    },
    {
      id: "finding:ef56ab78",
      prompt: "The shelf is thin.",
      options: [
        { id: "thicker", label: "Use 18 mm (recommended)" },
        { id: "keep", label: "Keep as drawn" },
      ],
    },
    {
      id: "load",
      prompt: "What goes on it?",
      options: [
        { id: "shoes", label: "Shoes (recommended)" },
        { id: "keep", label: "Keep as drawn" },
      ],
    },
  ],
};

describe("finding ids to accept", () => {
  it("accepts a finding only when the chosen option id is keep", () => {
    const ids = findingIdsToAccept(input, {
      answers: [
        { id: "finding:ab12cd34", selected: ["Keep as drawn"] },
        { id: "finding:ef56ab78", selected: ["Use 18 mm (recommended)"] },
        { id: "load", selected: ["keep"] },
      ],
    });
    expect(ids).toEqual(["ab12cd34"]);
  });

  it("maps an answer that stored the option id", () => {
    expect(findingIdsToAccept(input, { answers: [{ id: "finding:ef56ab78", selected: ["keep"] }] })).toEqual(["ef56ab78"]);
  });

  it("does nothing when the user also typed their own answer, skipped, or chose a fix as well", () => {
    expect(findingIdsToAccept(input, { answers: [{ id: "finding:ab12cd34", selected: ["Keep as drawn"], custom: "Leave 250" }] })).toEqual([]);
    expect(findingIdsToAccept(input, { skipped: true, answers: [{ id: "finding:ab12cd34", selected: ["Keep as drawn"] }] })).toEqual([]);
    expect(findingIdsToAccept(input, { answers: [{ id: "finding:ab12cd34", selected: ["Keep as drawn", "Shorten to 220 mm (recommended)"] }] })).toEqual([]);
  });
});
