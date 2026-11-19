type Option = { id: string; label: string };
type Question = { id: string; options: Option[] };
type Answer = { id: string; selected: string[]; custom?: string };

function questionsOf(input: unknown): Question[] {
  if (!input || typeof input !== "object" || !Array.isArray((input as { questions?: unknown }).questions)) return [];
  const questions: Question[] = [];
  for (const raw of (input as { questions: unknown[] }).questions) {
    if (!raw || typeof raw !== "object") continue;
    const question = raw as { id?: unknown; options?: unknown };
    if (typeof question.id !== "string" || !Array.isArray(question.options)) continue;
    const options: Option[] = [];
    for (const item of question.options) {
      if (!item || typeof item !== "object") continue;
      const option = item as { id?: unknown; label?: unknown };
      if (typeof option.id !== "string" || typeof option.label !== "string") continue;
      options.push({ id: option.id, label: option.label });
    }
    questions.push({ id: question.id, options });
  }
  return questions;
}

function answersOf(output: unknown): { skipped: boolean; answers: Answer[] } {
  if (!output || typeof output !== "object") return { skipped: false, answers: [] };
  const body = output as { skipped?: unknown; answers?: unknown };
  const answers: Answer[] = [];
  if (Array.isArray(body.answers)) {
    for (const raw of body.answers) {
      if (!raw || typeof raw !== "object") continue;
      const answer = raw as { id?: unknown; selected?: unknown; custom?: unknown };
      if (typeof answer.id !== "string") continue;
      const selected = Array.isArray(answer.selected) ? answer.selected.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
      const custom = typeof answer.custom === "string" && answer.custom.trim() ? answer.custom.trim() : undefined;
      answers.push({ id: answer.id, selected, ...(custom ? { custom } : {}) });
    }
  }
  return { skipped: body.skipped === true, answers };
}

/** Map a stored choice (an option id or its label) back to the option id. */
function optionId(question: Question, value: string) {
  return question.options.find((option) => option.id === value || option.label === value)?.id;
}

/**
 * Finding questions the user chose to keep as drawn.
 * The card stores option labels; the option id on the question input is what decides.
 */
export function findingIdsToAccept(input: unknown, output: unknown): string[] {
  const parsed = answersOf(output);
  if (parsed.skipped) return [];
  const questions = questionsOf(input);
  const ids: string[] = [];
  for (const answer of parsed.answers) {
    if (!answer.id.startsWith("finding:") || answer.custom) continue;
    const findingId = answer.id.slice("finding:".length);
    if (!findingId) continue;
    const question = questions.find((item) => item.id === answer.id);
    if (!question) continue;
    const chosen = answer.selected.map((value) => optionId(question, value)).filter((id): id is string => Boolean(id));
    if (chosen.length === 1 && chosen[0] === "keep") ids.push(findingId);
  }
  return ids;
}
