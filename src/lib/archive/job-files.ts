import { readdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const FILE_KINDS = ["proforma", "technical", "simulation", "artwork", "other"] as const;
const ASSIGNABLE_KINDS = ["technical", "simulation", "artwork", "other"] as const;
const CONFIDENCE = ["anchor", "high", "medium"] as const;

const jobFileSchema = z.object({
  path: z.string().nullable(),
  name: z.string(),
  kind: z.enum(FILE_KINDS),
  confidence: z.enum(CONFIDENCE),
  sha1: z.string(),
  bytes: z.number().finite().nonnegative(),
  mediaType: z.string(),
  emails: z.array(z.string()),
  reasons: z.array(z.string()),
  skipped: z.string().nullable(),
});

const jobEmailSchema = z.object({
  id: z.string(),
  mailbox: z.enum(["INBOX", "Sent Items"]),
  date: z.string(),
  from: z.string(),
  to: z.string(),
  subject: z.string(),
  confidence: z.enum(CONFIDENCE),
  reasons: z.array(z.string()),
});

const manifestSchema = z.object({
  pi: z.string(),
  client: z.string().nullable(),
  title: z.string().nullable(),
  date: z.string().nullable(),
  folder: z.string(),
  window: z.tuple([z.string(), z.string()]),
  emails: z.array(jobEmailSchema),
  files: z.array(jobFileSchema),
});

const storedFileDecisionSchema = z.object({
  verdict: z.enum(["keep", "reject"]),
  kind: z.enum(FILE_KINDS).nullish(),
  at: z.string().min(1),
});

const storedEmailDecisionSchema = z.object({
  verdict: z.enum(["keep", "reject"]),
  at: z.string().min(1),
});

export type JobFileKind = z.infer<typeof jobFileSchema>["kind"];
export type AssignableKind = (typeof ASSIGNABLE_KINDS)[number];
export type JobFile = z.infer<typeof jobFileSchema>;
export type JobEmail = z.infer<typeof jobEmailSchema>;
export type JobManifest = z.infer<typeof manifestSchema>;
export type JobDecisions = {
  files: Record<string, { verdict: "keep" | "reject"; kind?: JobFileKind; at: string }>;
  emails: Record<string, { verdict: "keep" | "reject"; at: string }>;
};
export type LoadedJob = { manifest: JobManifest; decisions: JobDecisions };
export type DecisionVerdict = "keep" | "reject" | "clear";
export type DecisionInput = { sha1: string; verdict: DecisionVerdict; kind?: AssignableKind } | { emailId: string; verdict: DecisionVerdict };
export type SaveDecisionResult = { ok: true; decisions: JobDecisions } | { ok: false; reason: "missing" | "unknown" };
export type JobFileLocation = { path: string; name: string; mediaType: string };

function jobsRoot(root?: string): string {
  if (root) return root;
  const fromEnv = process.env.ARCHIVE_JOBS_DIR;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv;
  return path.join(process.cwd(), ".archive/jobs");
}

export function jobFilesAvailable(root?: string): boolean {
  if (process.env.NODE_ENV === "production") return false;
  try {
    return statSync(jobsRoot(root)).isDirectory();
  } catch {
    return false;
  }
}

const manifestCache = new Map<string, { mtimeMs: number; manifest: JobManifest | null }>();

function readManifest(dir: string): JobManifest | null {
  const file = path.join(dir, "manifest.json");
  try {
    const { mtimeMs } = statSync(file);
    const cached = manifestCache.get(file);
    if (cached?.mtimeMs === mtimeMs) return cached.manifest;
    const parsed = manifestSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    const manifest = parsed.success ? parsed.data : null;
    manifestCache.set(file, { mtimeMs, manifest });
    return manifest;
  } catch {
    manifestCache.delete(file);
    return null;
  }
}

function listJobs(root: string): { dir: string; manifest: JobManifest }[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const jobs: { dir: string; manifest: JobManifest }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    const manifest = readManifest(dir);
    if (manifest) jobs.push({ dir, manifest });
  }
  return jobs;
}

function findJob(pi: string, root: string): { dir: string; manifest: JobManifest } | null {
  if (!pi) return null;
  for (const job of listJobs(root)) {
    if (job.manifest.pi === pi) return job;
  }
  return null;
}

function entriesOf(value: unknown): [string, unknown][] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value);
}

function readDecisions(file: string): JobDecisions {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return { files: {}, emails: {} };
  }
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { files?: unknown; emails?: unknown }) : null;
  if (!body) return { files: {}, emails: {} };
  const files: JobDecisions["files"] = {};
  for (const [sha1, value] of entriesOf(body.files)) {
    const parsed = storedFileDecisionSchema.safeParse(value);
    if (!parsed.success || !sha1) continue;
    files[sha1] = parsed.data.kind ? { verdict: parsed.data.verdict, kind: parsed.data.kind, at: parsed.data.at } : { verdict: parsed.data.verdict, at: parsed.data.at };
  }
  const emails: JobDecisions["emails"] = {};
  for (const [emailId, value] of entriesOf(body.emails)) {
    const parsed = storedEmailDecisionSchema.safeParse(value);
    if (!parsed.success || !emailId) continue;
    emails[emailId] = parsed.data;
  }
  return { files, emails };
}

function writeDecisions(dir: string, decisions: JobDecisions) {
  const temp = path.join(dir, `.decisions-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`);
  const target = path.join(dir, "decisions.json");
  writeFileSync(temp, `${JSON.stringify({ files: decisions.files, emails: decisions.emails }, null, 2)}\n`);
  try {
    renameSync(temp, target);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // The temp file is already gone.
    }
    throw error;
  }
}

export function loadJob(pi: string, root?: string): LoadedJob | null {
  const found = findJob(pi, jobsRoot(root));
  if (!found) return null;
  return { manifest: found.manifest, decisions: readDecisions(path.join(found.dir, "decisions.json")) };
}

export function jobFileCounts(root?: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (!jobFilesAvailable(root)) return counts;
  for (const job of listJobs(jobsRoot(root))) {
    if (counts.has(job.manifest.pi)) continue;
    counts.set(
      job.manifest.pi,
      job.manifest.files.filter((file) => file.skipped === null).length,
    );
  }
  return counts;
}

function normalizeRel(value: string): string | null {
  if (!value || value.includes("\0") || path.isAbsolute(value)) return null;
  const parts = value.replace(/\\/g, "/").split("/");
  if (parts.some((part) => part === "..")) return null;
  const clean = parts.filter((part) => part !== "" && part !== ".").join("/");
  return clean || null;
}

function insideFolder(folder: string, relative: string): string | null {
  const root = path.resolve(folder);
  const resolved = path.resolve(root, relative);
  if (!resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

function staysInFolder(folder: string, absolute: string): boolean {
  try {
    const root = realpathSync(folder);
    const file = realpathSync(absolute);
    return file === root || file.startsWith(root + path.sep);
  } catch {
    return false;
  }
}

export function jobFilePath(pi: string, relPath: string, root?: string): JobFileLocation | null {
  const found = findJob(pi, jobsRoot(root));
  if (!found) return null;
  const requested = normalizeRel(relPath);
  if (!requested) return null;
  const file = found.manifest.files.find((item) => item.path !== null && normalizeRel(item.path) === requested);
  if (!file?.path) return null;
  const listed = normalizeRel(file.path);
  if (!listed) return null;
  const absolute = insideFolder(found.dir, listed);
  if (!absolute || !staysInFolder(found.dir, absolute)) return null;
  return { path: absolute, name: file.name, mediaType: file.mediaType };
}

function isFileDecision(input: DecisionInput): input is { sha1: string; verdict: DecisionVerdict; kind?: AssignableKind } {
  return "sha1" in input;
}

export function saveDecision(pi: string, input: DecisionInput, root?: string): SaveDecisionResult {
  const verdict = input.verdict;
  if (verdict !== "keep" && verdict !== "reject" && verdict !== "clear") return { ok: false, reason: "unknown" };
  const found = findJob(pi, jobsRoot(root));
  if (!found) return { ok: false, reason: "missing" };
  const current = readDecisions(path.join(found.dir, "decisions.json"));
  const at = new Date().toISOString();
  if (isFileDecision(input)) {
    if (!input.sha1 || !found.manifest.files.some((file) => file.sha1 === input.sha1)) return { ok: false, reason: "unknown" };
    if (input.kind !== undefined && !ASSIGNABLE_KINDS.includes(input.kind)) return { ok: false, reason: "unknown" };
    if (verdict === "clear") delete current.files[input.sha1];
    else if (verdict === "keep" && input.kind) current.files[input.sha1] = { verdict, kind: input.kind, at };
    else current.files[input.sha1] = { verdict, at };
  } else {
    if (!input.emailId || !found.manifest.emails.some((email) => email.id === input.emailId)) return { ok: false, reason: "unknown" };
    if (verdict === "clear") delete current.emails[input.emailId];
    else current.emails[input.emailId] = { verdict, at };
  }
  writeDecisions(found.dir, current);
  return { ok: true, decisions: current };
}
