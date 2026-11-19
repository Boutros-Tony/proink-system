import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DevToolsTelemetry } from "@ai-sdk/devtools";
import { registerTelemetry } from "ai";

const globalForDevtools = globalThis as typeof globalThis & {
  __proinkDevtools?: boolean;
};

const LOG_FILE = path.join(process.cwd(), ".devtools", "generations.json");
/** DevTools rewrites the whole log after every step, so a long history slows every request down. */
const KEEP_RUNS = 50;
const UNFINISHED = "Never finished: stopped, timed out, or the dev server restarted";

type LogStep = { run_id: string; duration_ms: number | null; error: string | null };
type Log = { runs: { id: string }[]; steps: LogStep[] };

/** Keep the latest runs, and close steps that were left open so the viewer stops showing them as running. */
function tidyLog() {
  if (!existsSync(LOG_FILE)) return;
  try {
    const log = JSON.parse(readFileSync(LOG_FILE, "utf8")) as Log;
    const runs = log.runs.slice(-KEEP_RUNS);
    const kept = new Set(runs.map((run) => run.id));
    const steps = log.steps
      .filter((step) => kept.has(step.run_id))
      .map((step) => (step.duration_ms === null && !step.error ? { ...step, duration_ms: 0, error: UNFINISHED } : step));
    writeFileSync(LOG_FILE, JSON.stringify({ runs, steps }, null, 2));
  } catch (error) {
    console.error("The AI DevTools log could not be tidied", error);
  }
}

export function enableDevtools() {
  if (process.env.NODE_ENV !== "development" || globalForDevtools.__proinkDevtools) return;
  globalForDevtools.__proinkDevtools = true;
  tidyLog();
  const devtools = DevToolsTelemetry();
  registerTelemetry({
    ...devtools,
    // DevTools closes a step on success or error only. Stop and the time limit end the call with an abort.
    onAbort: (event) => devtools.onError?.({ callId: event.callId, error: new Error(event.reason ? `Stopped: ${String(event.reason)}` : "Stopped") }),
  });
}
