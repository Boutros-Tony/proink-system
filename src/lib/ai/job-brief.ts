import { getToolName, isToolUIPart, type UIMessage } from "ai";

const MAX_BRIEF = 6000;
/** The card sets this when the user answers in the composer instead. That text is already in their message. */
const ANSWERED_IN_CHAT = "The user replied in the chat instead.";

type Asked = { id: string; prompt: string };
type Given = { id: string; selected: string[]; custom?: string };

/**
 * What the user told the workshop, in order: their messages, and each question they answered.
 * Kept to the most recent part, so a long chat still fits in the foreman's brief.
 */
export function jobBrief(messages: UIMessage[]) {
  const blocks: string[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const text = message.parts
        .flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text.trim()] : []))
        .join("\n");
      if (text) blocks.push(text);
      continue;
    }
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      const answered = answeredQuestion(part);
      if (answered) blocks.push(answered);
    }
  }
  return latest(blocks.join("\n\n"), MAX_BRIEF);
}

/**
 * The client's own sheet: image or PDF parts on the latest user message that has any.
 * A simulation the studio sent back for an edit is not the client's file, so that message is skipped.
 */
export function inspectionFiles(messages: UIMessage[]) {
  const withFile = messages.findLast((message) => message.role === "user" && !simulationEdit(message) && message.parts.some((part) => part.type === "file"));
  if (!withFile) return [];
  return withFile.parts.flatMap((part) => {
    if (part.type !== "file") return [];
    const mediaType = part.mediaType?.trim() ?? "";
    if (!mediaType.startsWith("image/") && mediaType !== "application/pdf") return [];
    const data = part.url?.trim() ?? "";
    if (!data) return [];
    return [{ mediaType, data, ...(part.filename ? { filename: part.filename } : {}) }];
  });
}

function answeredQuestion(part: UIMessage["parts"][number]) {
  if (!isToolUIPart(part) || getToolName(part) !== "askUser" || part.state !== "output-available") return "";
  const output = part.output as { answers?: unknown; note?: unknown } | undefined;
  if (!output || output.note === ANSWERED_IN_CHAT) return "";
  const questions = asked(part.input);
  const lines: string[] = [];
  for (const answer of given(output.answers)) {
    const prompt = questions.find((question) => question.id === answer.id)?.prompt ?? answer.id;
    const chosen = [...answer.selected, answer.custom].filter((item): item is string => Boolean(item && item.trim()));
    if (chosen.length === 0) continue;
    lines.push(`Question: ${prompt}\nAnswer: ${chosen.join(", ")}`);
  }
  return lines.join("\n");
}

function asked(input: unknown): Asked[] {
  if (!input || typeof input !== "object" || !Array.isArray((input as { questions?: unknown }).questions)) return [];
  const questions: Asked[] = [];
  for (const item of (input as { questions: unknown[] }).questions) {
    if (!item || typeof item !== "object") continue;
    const question = item as { id?: unknown; prompt?: unknown };
    if (typeof question.id !== "string" || typeof question.prompt !== "string" || !question.prompt.trim()) continue;
    questions.push({ id: question.id, prompt: question.prompt.trim() });
  }
  return questions;
}

function given(value: unknown): Given[] {
  if (!Array.isArray(value)) return [];
  const answers: Given[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const answer = item as { id?: unknown; selected?: unknown; custom?: unknown };
    if (typeof answer.id !== "string") continue;
    const selected = Array.isArray(answer.selected) ? answer.selected.filter((label): label is string => typeof label === "string" && label.trim().length > 0) : [];
    const custom = typeof answer.custom === "string" && answer.custom.trim() ? answer.custom.trim() : undefined;
    answers.push({ id: answer.id, selected, ...(custom ? { custom } : {}) });
  }
  return answers;
}

function simulationEdit(message: UIMessage) {
  const metadata = message.metadata;
  return Boolean(metadata && typeof metadata === "object" && "simulationEdit" in metadata && (metadata as { simulationEdit?: unknown }).simulationEdit);
}

function latest(text: string, max: number) {
  if (text.length <= max) return text;
  const tail = text.slice(text.length - max);
  const breakAt = tail.indexOf("\n");
  return breakAt > 0 && breakAt < 400 ? tail.slice(breakAt + 1) : tail;
}
