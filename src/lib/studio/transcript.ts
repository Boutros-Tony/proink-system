import type { UIMessage } from "ai";

/**
 * The chat to store after a turn. When the request carries every stored message, it is the new chat.
 * When it is missing some (a browser that lost its state), the stored messages stay and the new ones are added after them.
 */
export function mergeTranscript(stored: UIMessage[], incoming: UIMessage[]): UIMessage[] {
  const sent = new Map(incoming.map((message) => [message.id, message]));
  if (stored.every((message) => sent.has(message.id))) return incoming;
  const kept = new Set(stored.map((message) => message.id));
  return [...stored.map((message) => sent.get(message.id) ?? message), ...incoming.filter((message) => !kept.has(message.id))];
}

/**
 * Inline files are swapped for their storage path, so a chat row stays small.
 * `files` maps an attachment's file name to where it was uploaded. `image` stores a generated picture and returns its path.
 */
export async function slimTranscript(messages: UIMessage[], files: Record<string, string>, image: (dataUrl: string, key: string) => Promise<string | null>) {
  return Promise.all(
    messages.map(async (message) => ({
      ...message,
      parts: await Promise.all(
        message.parts.map(async (part) => {
          if (part.type === "file" && part.url?.startsWith("data:")) {
            const path = part.filename ? files[part.filename] : undefined;
            return { ...part, url: path ? `sb://studio-attachments/${path}` : "" };
          }
          if (part.type === "tool-generateStandImage" && part.state === "output-available") {
            const output = part.output as { image?: unknown } | null;
            if (typeof output?.image === "string" && output.image.startsWith("data:")) {
              const path = await image(output.image, part.toolCallId);
              return { ...part, output: { ...output, image: path ? `sb://studio-simulations/${path}` : "" } };
            }
          }
          return part;
        }),
      ),
    })),
  );
}
