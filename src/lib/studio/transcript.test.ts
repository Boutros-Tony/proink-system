import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { mergeTranscript, slimTranscript } from "./transcript";

function text(id: string, role: UIMessage["role"], words: string): UIMessage {
  return { id, role, parts: [{ type: "text", text: words }] };
}

describe("chat transcript", () => {
  it("stores the request as the chat when it carries every stored message", () => {
    const stored = [text("u1", "user", "price this"), text("a1", "assistant", "$100")];
    const incoming = [...stored, text("u2", "user", "and the boards?"), text("a2", "assistant", "2 boards")];
    expect(mergeTranscript(stored, incoming)).toBe(incoming);
  });

  it("keeps stored messages a browser lost, and adds the new turn after them", () => {
    const stored = [text("u1", "user", "price this"), text("a1", "assistant", "$100")];
    const incoming = [text("u2", "user", "hello again"), text("a2", "assistant", "hi")];
    expect(mergeTranscript(stored, incoming).map((message) => message.id)).toEqual(["u1", "a1", "u2", "a2"]);
  });

  it("never stores an empty chat over a full one", () => {
    const stored = [text("u1", "user", "price this"), text("a1", "assistant", "$100")];
    expect(mergeTranscript(stored, [])).toEqual(stored);
  });

  it("stores links instead of inline files and pictures", async () => {
    const messages: UIMessage[] = [
      {
        id: "u1",
        role: "user",
        parts: [
          { type: "file", mediaType: "image/png", filename: "sheet.png", url: "data:image/png;base64,AAAA" },
          { type: "file", mediaType: "image/png", filename: "lost.png", url: "data:image/png;base64,BBBB" },
        ],
      },
      {
        id: "a1",
        role: "assistant",
        parts: [{ type: "tool-generateStandImage", toolCallId: "t1", state: "output-available", input: { description: "x" }, output: { image: "data:image/png;base64,CCCC" } }],
      },
    ];
    const slim = await slimTranscript(messages, { "sheet.png": "p1/a-sheet.png" }, async () => "p1/sim.png");
    const files = slim[0].parts as { url: string }[];
    expect(files.map((part) => part.url)).toEqual(["sb://studio-attachments/p1/a-sheet.png", ""]);
    expect((slim[1].parts[0] as { output: { image: string } }).output.image).toBe("sb://studio-simulations/p1/sim.png");
  });
});
