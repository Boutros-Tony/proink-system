"use client";

import { getToolName, isToolUIPart, type UIMessage } from "ai";
import { useRef, useState, type KeyboardEvent } from "react";

/** Sent when the user types a normal message instead of using the card. The model sees this; the card does not. */
export const ASK_USER_CHAT_NOTE = "The user replied in the chat instead.";

export type AskUserAnswer = {
  id: string;
  /** Labels of the chosen options, as the tool sent them. */
  selected: string[];
  custom?: string;
};

export type AskUserOutput = {
  answers: AskUserAnswer[];
  skipped?: boolean;
  note?: string;
};

type AskQuestion = {
  id: string;
  prompt: string;
  options: { id: string; label: string }[];
  allowMultiple: boolean;
};

type QuestionPart = {
  toolCallId: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

const RECOMMENDED_SUFFIX = /\s*\(recommended\)\s*$/;

/** Tool calls waiting for the user. The reply stays paused until each one has an output. */
export function openAskUserCallIds(messages: UIMessage[]) {
  const ids: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (isToolUIPart(part) && getToolName(part) === "askUser" && part.state === "input-available") ids.push(part.toolCallId);
    }
  }
  return ids;
}

function parseQuestions(input: unknown): AskQuestion[] {
  if (!input || typeof input !== "object") return [];
  const raw = (input as { questions?: unknown }).questions;
  if (!Array.isArray(raw)) return [];
  const questions: AskQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const question = item as { id?: unknown; prompt?: unknown; options?: unknown; allowMultiple?: unknown };
    if (typeof question.id !== "string" || typeof question.prompt !== "string" || !Array.isArray(question.options)) continue;
    const options: { id: string; label: string }[] = [];
    for (const option of question.options) {
      if (!option || typeof option !== "object") continue;
      const choice = option as { id?: unknown; label?: unknown };
      if (typeof choice.id !== "string" || typeof choice.label !== "string" || !choice.label.trim()) continue;
      options.push({ id: choice.id, label: choice.label });
    }
    if (options.length === 0) continue;
    questions.push({ id: question.id, prompt: question.prompt, options, allowMultiple: question.allowMultiple === true });
  }
  return questions;
}

function shownLabel(label: string) {
  const stripped = label.replace(RECOMMENDED_SUFFIX, "").trim();
  return stripped || label.trim();
}

function isRecommended(label: string) {
  return RECOMMENDED_SUFFIX.test(label);
}

function readOutput(output: unknown): AskUserOutput {
  if (!output || typeof output !== "object") return { answers: [] };
  const value = output as { answers?: unknown; skipped?: unknown; note?: unknown };
  const answers: AskUserAnswer[] = [];
  if (Array.isArray(value.answers)) {
    for (const item of value.answers) {
      if (!item || typeof item !== "object") continue;
      const answer = item as { id?: unknown; selected?: unknown; custom?: unknown };
      if (typeof answer.id !== "string") continue;
      const selected = Array.isArray(answer.selected) ? answer.selected.filter((label): label is string => typeof label === "string" && label.trim().length > 0) : [];
      const custom = typeof answer.custom === "string" && answer.custom.trim() ? answer.custom.trim() : undefined;
      answers.push({ id: answer.id, selected, ...(custom ? { custom } : {}) });
    }
  }
  return {
    answers,
    ...(value.skipped === true ? { skipped: true } : {}),
    ...(typeof value.note === "string" ? { note: value.note } : {}),
  };
}

type Draft = { selected: string[]; customOpen: boolean; custom: string };

function QuestionSummary({ input, output }: { input: unknown; output: unknown }) {
  const result = readOutput(output);
  if (result.note === ASK_USER_CHAT_NOTE) return <p className="text-[13px] leading-5 text-muted">Answered in the chat</p>;
  if (result.skipped && result.answers.length === 0) return <p className="text-[13px] leading-5 text-muted">Skipped</p>;
  const questions = parseQuestions(input);
  const lines = result.answers
    .map((answer) => {
      const prompt = questions.find((question) => question.id === answer.id)?.prompt;
      const chosen = [...answer.selected.map(shownLabel), answer.custom].filter((item): item is string => Boolean(item && item.trim()));
      if (!prompt || chosen.length === 0) return null;
      return { id: answer.id, prompt, answer: chosen.join(", ") };
    })
    .filter((line): line is { id: string; prompt: string; answer: string } => line !== null);
  if (lines.length === 0) return <p className="text-[13px] leading-5 text-muted">Skipped</p>;
  return (
    <div className="space-y-1">
      {lines.map((line) => (
        <p key={line.id} className="text-[13px] leading-5 text-muted">
          Q: {line.prompt} — A: {line.answer}
        </p>
      ))}
    </div>
  );
}

/**
 * The askUser tool has no server execute, so the reply pauses on this card.
 * Sending the answers (or skipping) is what lets the conversation continue.
 */
export function QuestionCard({ part, onAnswer }: { part: QuestionPart; onAnswer: (output: AskUserOutput) => void | Promise<void> }) {
  const questions = part.state === "input-available" ? parseQuestions(part.input) : [];
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [sending, setSending] = useState(false);
  const sent = useRef(false);

  if (part.state === "output-available") return <QuestionSummary input={part.input} output={part.output} />;
  if (part.state === "output-error") return <p className="text-[13px] leading-5 text-danger">{part.errorText || "This question failed."}</p>;
  if (part.state === "input-streaming") return <p className="text-[13px] leading-5 text-muted">Preparing a question…</p>;
  if (part.state !== "input-available") return null;

  function draftFor(id: string): Draft {
    return drafts[id] ?? { selected: [], customOpen: false, custom: "" };
  }

  function answered(question: AskQuestion) {
    const draft = draftFor(question.id);
    return draft.selected.length > 0 || (draft.customOpen && draft.custom.trim().length > 0);
  }

  const complete = questions.length > 0 && questions.every(answered);

  function choose(question: AskQuestion, optionId: string) {
    setDrafts((current) => {
      const draft = current[question.id] ?? { selected: [], customOpen: false, custom: "" };
      const on = draft.selected.includes(optionId);
      const selected = question.allowMultiple ? (on ? draft.selected.filter((id) => id !== optionId) : [...draft.selected, optionId]) : on ? draft.selected : [optionId];
      return { ...current, [question.id]: { ...draft, selected } };
    });
  }

  function patch(id: string, next: Partial<Draft>) {
    setDrafts((current) => {
      const draft = current[id] ?? { selected: [], customOpen: false, custom: "" };
      return { ...current, [id]: { ...draft, ...next } };
    });
  }

  function send(output: AskUserOutput) {
    if (sent.current) return;
    sent.current = true;
    setSending(true);
    void Promise.resolve(onAnswer(output)).catch(() => {
      sent.current = false;
      setSending(false);
    });
  }

  function submitAnswers() {
    if (!complete || sending) return;
    send({
      answers: questions.map((question) => {
        const draft = draftFor(question.id);
        const selected = question.options.filter((option) => draft.selected.includes(option.id)).map((option) => option.label);
        const custom = draft.customOpen ? draft.custom.trim() : "";
        return { id: question.id, selected, ...(custom ? { custom } : {}) };
      }),
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    if (!complete || sending) return;
    event.preventDefault();
    submitAnswers();
  }

  return (
    <div className="rounded-2xl border border-line bg-panel px-4 py-3.5" onKeyDown={onKeyDown}>
      {questions.length === 0 ? (
        <p className="text-[13px] leading-5 text-muted">These questions could not be read.</p>
      ) : (
        <div className="space-y-4">
          {questions.map((question) => {
            const draft = draftFor(question.id);
            return (
              <fieldset key={question.id} className="m-0 min-w-0 space-y-2 border-0 p-0">
                <legend className="text-[15px] leading-6 font-medium text-ink">{question.prompt}</legend>
                <div role={question.allowMultiple ? "group" : "radiogroup"} aria-label={question.prompt} className="flex flex-col gap-1.5">
                  {question.options.map((option) => {
                    const on = draft.selected.includes(option.id);
                    const recommended = isRecommended(option.label);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        role={question.allowMultiple ? "checkbox" : "radio"}
                        aria-checked={on}
                        disabled={sending}
                        onClick={() => choose(question, option.id)}
                        className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-[13px] leading-5 transition-colors disabled:opacity-60 ${
                          on ? "border-line-strong bg-raised text-ink" : "border-line text-ink hover:bg-raised"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${question.allowMultiple ? "rounded-[4px]" : "rounded-full"} ${on ? "border-ink bg-ink" : "border-line-strong"}`}
                        >
                          {on ? <span className={`${question.allowMultiple ? "h-1.5 w-1.5 rounded-[1px]" : "h-1.5 w-1.5 rounded-full"} bg-bg`} /> : null}
                        </span>
                        <span className="min-w-0 flex-1">{shownLabel(option.label)}</span>
                        {recommended ? <span className="shrink-0 text-[12px] text-muted">Recommended</span> : null}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    aria-pressed={draft.customOpen}
                    disabled={sending}
                    onClick={() => patch(question.id, { customOpen: !draft.customOpen, custom: draft.customOpen ? "" : draft.custom })}
                    className={`flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-[13px] leading-5 transition-colors disabled:opacity-60 ${
                      draft.customOpen ? "border-line-strong bg-raised text-ink" : "border-line text-muted hover:bg-raised hover:text-ink"
                    }`}
                  >
                    Other…
                  </button>
                </div>
                {draft.customOpen ? (
                  <input
                    value={draft.custom}
                    disabled={sending}
                    onChange={(event) => patch(question.id, { custom: event.target.value })}
                    placeholder="Type your answer"
                    aria-label={`Other answer for ${question.prompt}`}
                    className="w-full rounded-xl border border-line bg-panel px-3 py-2 text-[15px] leading-6 text-ink outline-none placeholder:text-subtle focus:border-line-strong"
                  />
                ) : null}
              </fieldset>
            );
          })}
        </div>
      )}
      <div className="mt-3.5 flex items-center gap-3">
        <button
          type="button"
          onClick={submitAnswers}
          disabled={!complete || sending}
          className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-bg transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Send answers
        </button>
        <button
          type="button"
          disabled={sending}
          onClick={() => send({ answers: [], skipped: true })}
          className="text-[13px] text-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  );
}
