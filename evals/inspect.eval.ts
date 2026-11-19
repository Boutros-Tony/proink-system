import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { generateText } from "ai";
import { describe, expect, it } from "vitest";
import type { Inspection } from "@/lib/ai/inspect";
import { inspectStand } from "@/lib/ai/inspect";
import { providerById, type Effort } from "@/lib/ai/models";
import { resolveLanguageModel } from "@/lib/ai/resolve-model";
import { defaultPriceBook } from "@/lib/systems/materials";
import { designDocumentSchema, type DesignDocument } from "@/lib/systems/modular/schema";

function loadEnv(name: string) {
  const path = resolve(name);
  if (existsSync(path)) process.loadEnvFile(path);
}

loadEnv(".env.local");
loadEnv(".env");

const providerId = process.env.EVAL_PROVIDER?.trim() || "openai";
const provider = providerById(providerId);
const modelId = process.env.EVAL_MODEL?.trim() || provider?.defaultModel || "gpt-4o";
const effortRaw = process.env.EVAL_EFFORT?.trim();
const effort: Effort | undefined = effortRaw === "low" || effortRaw === "medium" || effortRaw === "high" ? effortRaw : undefined;
const hasKey = Boolean(provider && process.env[provider.env]);

if (!provider) {
  throw new Error(`EVAL_PROVIDER must be openai, anthropic, or google. Got "${providerId}".`);
}
if (!hasKey) {
  console.log(
    `Skipping inspection evals. No ${provider.env} is set for ${provider.label}. Add it to .env.local, or set EVAL_PROVIDER to a provider that has a key.`,
  );
}

const resolved = hasKey ? resolveLanguageModel(provider.id, modelId, effort) : null;
if (resolved && "error" in resolved) throw new Error(resolved.error);

const casesRoot = resolve("evals/cases");
const caseNames = readdirSync(casesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(join(casesRoot, entry.name, "job.json")) && existsSync(join(casesRoot, entry.name, "expected.json")))
  .map((entry) => entry.name)
  .sort();

if (caseNames.length === 0) throw new Error("No eval cases in evals/cases.");

const SOURCE_KINDS = ["simulation", "technical", "3d_file", "description"] as const;

function sourceKind(value: unknown) {
  return SOURCE_KINDS.find((kind) => kind === value);
}

function clientFile(dir: string) {
  const names = [
    ["file.png", "image/png"],
    ["file.jpg", "image/jpeg"],
    ["file.pdf", "application/pdf"],
  ] as const;
  for (const [name, mediaType] of names) {
    const path = join(dir, name);
    if (!existsSync(path)) continue;
    return [{ mediaType, data: readFileSync(path).toString("base64"), filename: name }];
  }
  return [];
}

function printCase(name: string, inspection: Inspection) {
  console.log(`\n${name}`);
  console.log(inspection.summary || "(no summary)");
  if (inspection.findings.length === 0) console.log("- no findings");
  for (const finding of inspection.findings) {
    const pieces = finding.pieces.length ? ` [${finding.pieces.join(", ")}]` : "";
    console.log(`- ${finding.severity}/${finding.source}${pieces}: ${finding.problem}`);
  }
  for (const question of inspection.questions) console.log(`? ${question}`);
}

type Grade = { found: boolean[]; reported: boolean[]; why: string[] };

function readGrade(reply: string, mustFind: number, mustNot: number): Grade | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const body = JSON.parse(reply.slice(start, end + 1)) as { found?: unknown; reported?: unknown; why?: unknown };
    if (!Array.isArray(body.found) || body.found.length !== mustFind || !body.found.every((item) => typeof item === "boolean")) return null;
    if (!Array.isArray(body.reported) || body.reported.length !== mustNot || !body.reported.every((item) => typeof item === "boolean")) return null;
    const why = Array.isArray(body.why) ? body.why.map((item) => (typeof item === "string" ? item : "")) : [];
    return { found: body.found as boolean[], reported: body.reported as boolean[], why };
  } catch {
    return null;
  }
}

function gradePrompt(inspection: Inspection, mustFind: string[], mustNotFind: string[]) {
  const foundSlots = mustFind.map(() => "true or false").join(", ");
  const reportedSlots = mustNotFind.map(() => "true or false").join(", ");
  return [
    "You grade a workshop inspection. A sentence counts as the same problem when the finding describes it, even in different words.",
    "",
    "FINDINGS",
    JSON.stringify(
      inspection.findings.map((finding) => ({ severity: finding.severity, pieces: finding.pieces, problem: finding.problem, fix: finding.fix })),
      null,
      2,
    ),
    "",
    "MUST FIND (the inspection should report each of these)",
    mustFind.length ? mustFind.map((line, index) => `${index + 1}. ${line}`).join("\n") : "(none)",
    "",
    "MUST NOT FIND (the inspection should not report any of these)",
    mustNotFind.length ? mustNotFind.map((line, index) => `${index + 1}. ${line}`).join("\n") : "(none)",
    "",
    `Reply with only this JSON. "found" has ${mustFind.length} booleans, in order. "reported" has ${mustNotFind.length} booleans, in order. "why" has one short reason per mustFind sentence, then one per mustNotFind sentence.`,
    `{ "found": [${foundSlots}], "reported": [${reportedSlots}], "why": [] }`,
  ].join("\n");
}

describe.skipIf(!hasKey)("foreman eval", () => {
  const book = defaultPriceBook();

  for (const name of caseNames) {
    it(name, async () => {
      if (!resolved || "error" in resolved) throw new Error("No model.");
      const dir = join(casesRoot, name);
      const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8")) as { document?: unknown; brief?: unknown; sourceKind?: unknown };
      const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as { mustFind?: unknown; mustNotFind?: unknown };
      const parsed = designDocumentSchema.safeParse(job.document);
      if (!parsed.success) throw new Error(`${name}: job.json is not a design document (${parsed.error.issues[0]?.message ?? "invalid"}).`);
      const mustFind = Array.isArray(expected.mustFind) ? expected.mustFind.filter((line): line is string => typeof line === "string") : [];
      const mustNotFind = Array.isArray(expected.mustNotFind) ? expected.mustNotFind.filter((line): line is string => typeof line === "string") : [];
      const document: DesignDocument = parsed.data;
      const providerOptions = "providerOptions" in resolved ? resolved.providerOptions : undefined;

      const outcome = await inspectStand({
        document,
        book,
        brief: typeof job.brief === "string" ? job.brief : "",
        sourceKind: sourceKind(job.sourceKind),
        model: resolved.model,
        providerOptions,
        files: clientFile(dir),
      });
      if ("error" in outcome) {
        console.log(`\n${name}\nInspection failed: ${outcome.error}`);
        throw new Error(outcome.error);
      }
      printCase(name, outcome.inspection);

      const graded = await generateText({
        model: resolved.model,
        temperature: 0,
        ...(providerOptions ? { providerOptions } : {}),
        system: "You compare an inspection with expected problems. Reply with only one JSON object, no code fences.",
        prompt: gradePrompt(outcome.inspection, mustFind, mustNotFind),
      });
      const grade = readGrade(graded.text, mustFind.length, mustNotFind.length);
      if (!grade) throw new Error(`The grader did not return usable JSON:\n${graded.text.slice(0, 800)}`);

      mustFind.forEach((line, index) => {
        const why = grade.why[index] ?? "";
        console.log(`${grade.found[index] ? "PASS" : "FAIL"} must find: ${line}${why ? ` — ${why}` : ""}`);
        expect(grade.found[index], line).toBe(true);
      });
      mustNotFind.forEach((line, index) => {
        const why = grade.why[mustFind.length + index] ?? "";
        console.log(`${grade.reported[index] ? "FAIL" : "PASS"} must not find: ${line}${why ? ` — ${why}` : ""}`);
        expect(grade.reported[index], line).toBe(false);
      });
    });
  }
});
