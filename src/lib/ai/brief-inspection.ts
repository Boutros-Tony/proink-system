const ASK_LINE = "Ask the user about these with askUser, one question per finding with id finding:<id>; do not change pieces for a finding before they answer.";

function textList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function findingLine(raw: unknown) {
  if (!raw || typeof raw !== "object") return "";
  const finding = raw as { id?: unknown; severity?: unknown; pieces?: unknown; problem?: unknown; fix?: unknown };
  const id = typeof finding.id === "string" ? finding.id : "";
  const severity = finding.severity === "serious" ? "serious" : "check";
  const pieces = textList(finding.pieces);
  const problem = typeof finding.problem === "string" ? finding.problem : "";
  const fix = typeof finding.fix === "string" ? finding.fix : "";
  if (!id && !problem && !fix && pieces.length === 0) return "";
  return `${id} [${severity}] pieces: ${pieces.join(", ")} — ${problem} — Fix: ${fix}`.trim();
}

/**
 * What the model keeps from a production check.
 * `ask` is off for the Assemble button: that mode has no askUser tool, and its prompt lists the findings in the reply.
 */
export function briefInspection(output: unknown, options: { ask?: boolean } = {}) {
  if (!output || typeof output !== "object") return "The production check failed.";
  const record = output as { error?: unknown; inspection?: unknown };
  if (typeof record.error === "string" && record.error) return record.error;
  const inspection = record.inspection;
  if (!inspection || typeof inspection !== "object") return "The production check failed.";
  const body = inspection as { findings?: unknown; questions?: unknown };
  const findings = (Array.isArray(body.findings) ? body.findings : []).map(findingLine).filter(Boolean);
  const questions = textList(body.questions);
  if (findings.length === 0 && questions.length === 0) return "No problems found and no questions.";
  const lines = [...findings];
  if (questions.length > 0) lines.push("Questions:", ...questions);
  if (options.ask !== false) lines.push(ASK_LINE);
  return lines.join("\n");
}
