/**
 * Tool calls in one model step start together, after the model finishes, in call order.
 * assemble, inspect, and arrangeParts wait for calls that already started. The list is copied
 * at the start, so a call cannot wait for one that starts later and the two cannot deadlock.
 */

export const EARLIER_STEP_FAILED = "An earlier call in this step failed. Fix it, then call this again.";

export type GateMode = "plain" | "wait" | "block";

type Settled = { threw: false; output: unknown } | { threw: true };

type Tracked = {
  promise: Promise<Settled>;
  settle: (result: Settled) => void;
};

export function createToolGate() {
  const calls: Tracked[] = [];

  function begin() {
    let settle!: (result: Settled) => void;
    const promise = new Promise<Settled>((resolve) => {
      settle = resolve;
    });
    // Copy now. Calls that register while we wait are not in this list.
    const earlier = calls.map((call) => call.promise);
    calls.push({ promise, settle });
    return { earlier, settle };
  }

  /** A new model step starts clean, so a failure in an earlier step does not block this one. */
  function reset() {
    calls.length = 0;
  }

  return { begin, reset };
}

export type ToolGate = ReturnType<typeof createToolGate>;

export function outputFailed(output: unknown) {
  if (!output || typeof output !== "object") return false;
  const error = (output as { error?: unknown }).error;
  return typeof error === "string" ? error.length > 0 : Boolean(error);
}

function earlierFailed(results: Settled[]) {
  return results.some((result) => result.threw || (result.threw === false && outputFailed(result.output)));
}

export type GateTime = { waitMs: number; runMs: number };

/**
 * Register this call, then run it. `wait` and `block` settle every call that started before this one.
 * `block` does not run when one of those returned an error or threw.
 * A sync `run` still registers: its promise is settled before this function yields to the next call.
 */
export async function runGated<T>(options: {
  gate: ToolGate;
  mode: GateMode;
  run: () => T | Promise<T>;
  onTime?: (time: GateTime) => void;
  now?: () => number;
}): Promise<T | { error: string }> {
  const now = options.now ?? Date.now;
  const call = options.gate.begin();
  const started = now();
  let waitMs = 0;
  let runMs = 0;
  try {
    if (options.mode !== "plain") {
      const settled = await Promise.all(call.earlier);
      waitMs = now() - started;
      if (options.mode === "block" && earlierFailed(settled)) {
        const output = { error: EARLIER_STEP_FAILED };
        call.settle({ threw: false, output });
        return output;
      }
    }
    const runStarted = now();
    try {
      const output = await options.run();
      runMs = now() - runStarted;
      call.settle({ threw: false, output });
      return output;
    } catch (error) {
      runMs = now() - runStarted;
      call.settle({ threw: true });
      throw error;
    }
  } finally {
    options.onTime?.({ waitMs, runMs });
  }
}
