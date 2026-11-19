import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOOK_BRIEF, hookStand } from "./hook-stand";

/** Rewrites evals/cases/<name>/job.json and expected.json from hook-stand.ts. Run from the project root. */

const root = join(process.cwd(), "evals/cases");

const cases = [
  {
    name: "hooks-sloped-side",
    job: { document: hookStand(), brief: HOOK_BRIEF, sourceKind: "description" as const },
    expected: {
      mustFind: [
        "The hooks on the top rows (rows 1 and 2) are too long for how deep the stand is at that height, so they stick out past the front of the side panels; those rows need a shorter hook.",
      ],
      mustNotFind: [] as string[],
    },
  },
  {
    name: "hooks-fit",
    job: { document: hookStand({ topHookDepth: 150 }), brief: HOOK_BRIEF, sourceKind: "description" as const },
    expected: {
      mustFind: [] as string[],
      mustNotFind: ["Hooks stick out past the front of the stand."],
    },
  },
];

for (const item of cases) {
  const dir = join(root, item.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "job.json"), `${JSON.stringify(item.job, null, 2)}\n`);
  writeFileSync(join(dir, "expected.json"), `${JSON.stringify(item.expected, null, 2)}\n`);
}

console.log(`Wrote ${cases.length} cases to ${root}`);
