import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { inspectionFiles, jobBrief } from "./job-brief";

function user(id: string, text: string, extra: UIMessage["parts"] = []): UIMessage {
  return { id, role: "user", parts: [...(text ? [{ type: "text" as const, text }] : []), ...extra] };
}

function asked(id: string, output: unknown, state: "output-available" | "input-available" = "output-available"): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-askUser",
        toolCallId: `${id}-call`,
        state,
        input: {
          questions: [
            { id: "finish", prompt: "What finish?", options: [] },
            { id: "load", prompt: "What goes on the shelf?", options: [] },
          ],
        },
        output,
      },
    ],
  } as UIMessage;
}

describe("job brief", () => {
  it("keeps user text and answered questions in order, and drops a question that was not answered", () => {
    const brief = jobBrief([
      user("u1", "A wall of shelves."),
      asked("a1", { answers: [{ id: "finish", selected: ["Painted (recommended)"] }, { id: "load", selected: [], custom: "Shoes" }] }),
      asked("a2", undefined, "input-available"),
      user("u2", "Make the hooks shorter."),
    ]);
    expect(brief).toBe("A wall of shelves.\n\nQuestion: What finish?\nAnswer: Painted (recommended)\nQuestion: What goes on the shelf?\nAnswer: Shoes\n\nMake the hooks shorter.");
  });

  it("skips a question the user answered by typing in the chat", () => {
    const brief = jobBrief([asked("a1", { answers: [], note: "The user replied in the chat instead." }), user("u1", "Painted, please.")]);
    expect(brief).toBe("Painted, please.");
  });

  it("keeps the most recent part of a long conversation", () => {
    const filler = "x".repeat(3000);
    const brief = jobBrief([user("u1", filler), user("u2", filler), user("u3", filler), user("u4", "LATEST-MARKER")]);
    expect(brief.length).toBeLessThanOrEqual(6000);
    expect(brief.endsWith("LATEST-MARKER")).toBe(true);
    expect(brief).not.toBe([filler, filler, filler, "LATEST-MARKER"].join("\n\n"));
  });
});

describe("inspection files", () => {
  it("uses the latest client sheet and skips a simulation the studio sent back", () => {
    const sheet = { type: "file" as const, mediaType: "application/pdf", url: "data:application/pdf;base64,QQ==", filename: "stand.pdf" };
    const picture = { type: "file" as const, mediaType: "image/png", url: "data:image/png;base64,QQ==", filename: "photo.png" };
    const simulation = { type: "file" as const, mediaType: "image/png", url: "data:image/png;base64,UU==", filename: "simulation-1.png" };
    const messages: UIMessage[] = [
      user("u1", "See the sheet.", [sheet]),
      { id: "edit", role: "user", metadata: { simulationEdit: { region: { x: 0, y: 0, width: 1, height: 1 } } }, parts: [{ type: "text", text: "Change the header." }, simulation, picture] } as UIMessage,
    ];
    expect(inspectionFiles(messages)).toEqual([{ mediaType: "application/pdf", data: sheet.url, filename: "stand.pdf" }]);
    expect(inspectionFiles([messages[1]])).toEqual([]);
  });
});
