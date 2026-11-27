/** Compact durations for the one server log line and the chat tool lines. */

export type TimedTool = { name: string; waitMs: number; runMs: number; steps?: number };
export type TimedStep = { ms: number; tools: TimedTool[] };

export function formatLogDuration(ms: number) {
  const safe = Math.max(0, ms);
  if (safe < 10_000) {
    const seconds = Math.round(safe / 100) / 10;
    const text = seconds.toFixed(1);
    return `${text.endsWith(".0") ? text.slice(0, -2) : text}s`;
  }
  const seconds = Math.round(safe / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m${String(rest).padStart(2, "0")}s`;
}

/** Chat lines use a space: "1m 10s". The log does not. */
export function formatChatDuration(ms: number) {
  return formatLogDuration(ms).replace(/m(\d)/, "m $1");
}

export function withDuration(label: string, ms: unknown) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return label;
  return `${label} · ${formatChatDuration(ms)}`;
}

export function inspectionLine(findings: number, ms?: unknown) {
  const count = Math.max(0, findings);
  const text = count === 0 ? "Production check: no problems found" : `Production check: ${count} ${count === 1 ? "point" : "points"} to decide`;
  return withDuration(text, ms);
}

function formatTool(tool: TimedTool) {
  const run = `${formatLogDuration(tool.runMs)}${tool.steps != null ? `/${tool.steps} ${tool.steps === 1 ? "step" : "steps"}` : ""}`;
  const wait = tool.waitMs >= 100 ? `wait ${formatLogDuration(tool.waitMs)}, ` : "";
  return `${tool.name} ${wait}${run}`;
}

export function formatChatLog(input: { totalMs: number; model: string; steps: TimedStep[]; stopped?: boolean; mode?: string }) {
  const tag = input.mode ? `[chat ${input.mode}]` : "[chat]";
  const head = `${tag} ${formatLogDuration(input.totalMs)} · model ${input.model} · steps ${input.steps.length}${input.stopped ? " · stopped" : ""}`;
  if (input.steps.length === 0) return head;
  const body = input.steps
    .map((step, index) => {
      const title = `step ${index + 1} ${formatLogDuration(step.ms)}`;
      return step.tools.length ? `${title} (${step.tools.map(formatTool).join(", ")})` : title;
    })
    .join(" · ");
  return `${head}\n  ${body}`;
}

export function readStepCount(output: unknown) {
  if (!output || typeof output !== "object" || !("steps" in output)) return undefined;
  const steps = (output as { steps: unknown }).steps;
  return typeof steps === "number" && Number.isFinite(steps) ? steps : undefined;
}

/** Collects step and tool times for one reply and prints them once. */
export function createChatLog(now = Date.now, mode?: string) {
  const started = now();
  const steps: TimedStep[] = [];
  let open: { started: number; tools: TimedTool[] } | null = null;
  let printed = false;

  function close() {
    if (!open) return;
    steps.push({ ms: Math.max(0, now() - open.started), tools: open.tools });
    open = null;
  }

  return {
    stepStart() {
      close();
      open = { started: now(), tools: [] };
    },
    stepEnd() {
      close();
    },
    toolStart(name: string) {
      if (!open) open = { started: now(), tools: [] };
      const entry: TimedTool = { name, waitMs: 0, runMs: 0 };
      open.tools.push(entry);
      return {
        finish(update: { waitMs: number; runMs: number; steps?: number }) {
          entry.waitMs = update.waitMs;
          entry.runMs = update.runMs;
          if (update.steps != null) entry.steps = update.steps;
        },
      };
    },
    finish(model: string, stopped = false) {
      if (printed) return;
      printed = true;
      close();
      console.log(formatChatLog({ totalMs: Math.max(0, now() - started), model, steps, stopped, mode }));
    },
  };
}
