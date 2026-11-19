import { describe, expect, it } from "vitest";
import { EARLIER_STEP_FAILED, createToolGate, runGated } from "./tool-gate";

const quiet = { onTime() {} };

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("tool gate", () => {
  it("runs a later call only after an earlier sync call has finished", async () => {
    const gate = createToolGate();
    const order: string[] = [];
    const [first, second] = await Promise.all([
      runGated({
        gate,
        mode: "plain",
        ...quiet,
        run: () => {
          order.push("sync");
          return { ids: ["a"] };
        },
      }),
      runGated({
        gate,
        mode: "block",
        ...quiet,
        run: () => {
          order.push("inspect");
          return { ok: true };
        },
      }),
    ]);
    expect(order).toEqual(["sync", "inspect"]);
    expect(first).toEqual({ ids: ["a"] });
    expect(second).toEqual({ ok: true });
  });

  it("does not deadlock when two waiting calls start together", async () => {
    const gate = createToolGate();
    const order: string[] = [];
    const done = Promise.all([
      runGated({
        gate,
        mode: "block",
        ...quiet,
        run: async () => {
          order.push("assemble");
          await delay(20);
          return { placed: 1 };
        },
      }),
      runGated({
        gate,
        mode: "block",
        ...quiet,
        run: () => {
          order.push("inspect");
          return { findings: 0 };
        },
      }),
    ]);
    const result = await Promise.race([done, delay(400).then(() => "stuck" as const)]);
    expect(result).not.toBe("stuck");
    expect(order).toEqual(["assemble", "inspect"]);
  });

  it("skips assemble and inspect when an earlier call failed, and still runs arrangeParts", async () => {
    const gate = createToolGate();
    let assembled = false;
    let arranged = false;
    const [added, assembledOut, arrangedOut] = await Promise.all([
      runGated({ gate, mode: "plain", ...quiet, run: () => ({ error: "Missing size." }) }),
      runGated({
        gate,
        mode: "block",
        ...quiet,
        run: () => {
          assembled = true;
          return { placed: 1 };
        },
      }),
      runGated({
        gate,
        mode: "wait",
        ...quiet,
        run: () => {
          arranged = true;
          return { placed: 2 };
        },
      }),
    ]);
    expect(added).toEqual({ error: "Missing size." });
    expect(assembledOut).toEqual({ error: EARLIER_STEP_FAILED });
    expect(assembled).toBe(false);
    expect(arranged).toBe(true);
    expect(arrangedOut).toEqual({ placed: 2 });
  });

  it("treats a thrown call as a failed earlier call", async () => {
    const gate = createToolGate();
    const [first, second] = await Promise.allSettled([
      runGated({
        gate,
        mode: "plain",
        ...quiet,
        run: () => {
          throw new Error("boom");
        },
      }),
      runGated({ gate, mode: "block", ...quiet, run: () => ({ ok: true }) }),
    ]);
    expect(first.status).toBe("rejected");
    expect(second).toEqual({ status: "fulfilled", value: { error: EARLIER_STEP_FAILED } });
  });

  it("does not wait for a call that starts after the snapshot", async () => {
    const gate = createToolGate();
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let thirdFinished = false;
    const first = runGated({
      gate,
      mode: "plain",
      ...quiet,
      run: () => firstHeld.then(() => ({ ok: 1 })),
    });
    const second = runGated({ gate, mode: "block", ...quiet, run: () => ({ ok: 2 }) });
    await Promise.resolve();
    const third = runGated({
      gate,
      mode: "plain",
      ...quiet,
      run: () =>
        delay(30).then(() => {
          thirdFinished = true;
          return { late: true };
        }),
    });
    releaseFirst();
    const both = await Promise.all([first, second]);
    expect(both).toEqual([{ ok: 1 }, { ok: 2 }]);
    expect(thirdFinished).toBe(false);
    await third;
    expect(thirdFinished).toBe(true);
  });

  it("reports the wait separately from the run", async () => {
    const gate = createToolGate();
    let waited = 0;
    let ran = 0;
    await Promise.all([
      runGated({
        gate,
        mode: "plain",
        ...quiet,
        run: async () => {
          await delay(30);
          return { ok: 1 };
        },
      }),
      runGated({
        gate,
        mode: "wait",
        run: async () => {
          await delay(15);
          return { ok: 2 };
        },
        onTime: (time) => {
          waited = time.waitMs;
          ran = time.runMs;
        },
      }),
    ]);
    expect(waited).toBeGreaterThanOrEqual(20);
    expect(ran).toBeGreaterThanOrEqual(10);
  });
  it("does not block a new step because of a failure in an earlier step", async () => {
    const gate = createToolGate();
    await runGated({ gate, mode: "plain", ...quiet, run: () => ({ error: "bad size" }) });
    gate.reset();
    const output = await runGated({ gate, mode: "block", ...quiet, run: () => ({ ok: true }) });
    expect(output).toEqual({ ok: true });
  });
});
