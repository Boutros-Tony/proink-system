import { createHash } from "node:crypto";
import type { SharedV4ProviderOptions } from "@ai-sdk/provider";
import { generateText, type FilePart, type LanguageModel, type LanguageModelUsage, type TextPart } from "ai";
import type { PriceBook } from "../systems/materials";
import { measureStand } from "../systems/modular/measure";
import type { DesignDocument, Finding } from "../systems/modular/schema";
import { INSPECT_PROMPT, inspectBrief } from "./inspect-prompt";
import { standViews } from "./stand-views";

export type { Finding };

export type Inspection = {
  summary: string;
  findings: Finding[];
  questions: string[];
};

const MAX_FINDINGS = 12;
const MAX_QUESTIONS = 6;
const MAX_FILES = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

type ClientFile = { mediaType: string; data: string; filename?: string };

function failureMessage(error: unknown) {
  if (!(error instanceof Error)) return "The inspection failed.";
  const statusCode = "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : undefined;
  const message = error.message.trim() || "The inspection failed.";
  return statusCode ? `${message} (HTTP ${statusCode})` : message;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function findingId(severity: string, problem: string) {
  return createHash("sha256").update(`${severity}\n${problem}`).digest("hex").slice(0, 8);
}

/**
 * Read the foreman's reply. A finding that cannot be used is dropped on its own, the way a bad cost
 * line is dropped, instead of failing the whole inspection. The same problem keeps the same id.
 */
export function readInspection(reply: string, document: DesignDocument): Inspection | null {
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const body = parsed as { summary?: unknown; findings?: unknown; questions?: unknown };
  const known = new Set(document.parts.map((part) => part.id));

  const findings: Finding[] = [];
  for (const raw of Array.isArray(body.findings) ? body.findings : []) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const problem = text(item.problem, 600);
    if (!problem) continue;
    const severity = item.severity === "serious" ? "serious" : "check";
    const source = item.source === "build" ? "build" : "design";
    const pieces = Array.isArray(item.pieces)
      ? item.pieces.flatMap((piece) => {
          if (typeof piece !== "string") return [];
          const id = piece.trim();
          return known.has(id) ? [id] : [];
        })
      : [];
    findings.push({
      id: findingId(severity, problem),
      severity,
      source,
      pieces: [...new Set(pieces)],
      problem,
      fix: text(item.fix, 600),
    });
  }
  findings.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === "serious" ? -1 : 1;
  });
  findings.splice(MAX_FINDINGS);

  const questions: string[] = [];
  for (const raw of Array.isArray(body.questions) ? body.questions : []) {
    if (questions.length >= MAX_QUESTIONS) break;
    const question = text(raw, 300);
    if (question) questions.push(question);
  }

  return { summary: text(body.summary, 600), findings, questions };
}

function decodeFile(data: string) {
  let payload = data.trim();
  if (payload.startsWith("data:")) {
    const marker = ";base64,";
    const at = payload.indexOf(marker);
    if (at === -1) return null;
    payload = payload.slice(at + marker.length);
  }
  payload = payload.replace(/\s/g, "");
  if (!payload || payload.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)) return null;
  const bytes = Buffer.from(payload, "base64");
  return bytes.length > 0 ? bytes : null;
}

function clientFiles(files: ClientFile[]): FilePart[] {
  const parts: FilePart[] = [];
  for (const file of files) {
    if (parts.length >= MAX_FILES) break;
    const mediaType = file.mediaType?.trim();
    if (!mediaType) continue;
    const bytes = decodeFile(file.data);
    if (!bytes || bytes.length > MAX_FILE_BYTES) continue;
    parts.push({ type: "file", mediaType, data: bytes.toString("base64"), ...(file.filename ? { filename: file.filename } : {}) });
  }
  return parts;
}

/**
 * Ask the foreman what will go wrong with a finished job. Returns a readable error instead of throwing
 * when the model fails or the reply cannot be read.
 */
export async function inspectStand(input: {
  document: DesignDocument;
  book: PriceBook;
  brief: string;
  sourceKind?: "simulation" | "technical" | "3d_file" | "description";
  model: LanguageModel;
  providerOptions?: SharedV4ProviderOptions;
  files?: ClientFile[];
  abortSignal?: AbortSignal;
}): Promise<{ inspection: Inspection; usage: LanguageModelUsage } | { error: string }> {
  try {
    const views = await standViews(input.document);
    const files = clientFiles(input.files ?? []);
    const text = inspectBrief({
      document: input.document,
      book: input.book,
      brief: input.brief,
      sourceKind: input.sourceKind,
      measured: measureStand(input.document),
      views: views !== null,
      file: files.length > 0,
    });
    const content: Array<TextPart | FilePart> = [{ type: "text", text }];
    if (views) content.push({ type: "file", mediaType: views.mediaType, data: views.base64, filename: "stand.png" });
    content.push(...files);

    const result = await generateText({
      model: input.model,
      system: INSPECT_PROMPT,
      temperature: 0,
      messages: [{ role: "user", content }],
      abortSignal: input.abortSignal,
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    });
    const inspection = readInspection(result.text, input.document);
    if (!inspection) return { error: "The foreman did not return a usable report." };
    return { inspection, usage: result.usage };
  } catch (error) {
    return { error: failureMessage(error) };
  }
}
