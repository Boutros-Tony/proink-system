import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { jobFileCounts } from "./job-files";

const SIGNATURE_FILE = /^(image|outlook)[-\w]*\.(png|jpe?g|gif)$/i;
const JOB_TYPES = ["build", "print", "installation", "transport", "maintenance", "rental", "mixed", "other"] as const;

export type PastQuoteJobType = (typeof JOB_TYPES)[number];

const STOPWORDS = new Set(["the", "and", "for", "with", "from", "like", "job", "price", "quote", "need", "want", "make", "please", "stand", "cost"]);

export type PastJob = {
  pi: string;
  date: string | null;
  client: string;
  title: string;
  job: string;
  quantity: number | null;
  unitPrice: number | null;
  total: number | null;
  sizes: string[];
  materials: string[];
  transport: string;
  score: number;
  note?: string;
};

const PACKAGE_NOTE = "Package price: this amount also covers other jobs on the same proforma that have no price of their own.";

export type PastQuoteJob = {
  name: string;
  section: string;
  quantity: number | null;
  unitPrice: number | null;
  total: number | null;
  sizes: string[];
  materials: string[];
};

export type PastQuoteEmail = {
  date: string | null;
  from: string;
  to: string;
  subject: string;
  approval: boolean;
};

export type PastQuote = {
  sha1: string;
  pi: string;
  date: string | null;
  client: string;
  attention: string;
  title: string;
  currency: string;
  jobs: PastQuoteJob[];
  shared: string[];
  subtotal: number | null;
  vatPercent: number | null;
  vat: number | null;
  grandTotal: number | null;
  transport: string;
  terms: string;
  notes: string[];
  approval: boolean;
  emails: PastQuoteEmail[];
  files: { filename: string; type: string; bytes: number }[];
  problems: string[];
  text: string;
  fileCount: number;
  jobType?: PastQuoteJobType;
  versionCount?: number;
};

export function pastQuotesAvailable(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return quotesPath() !== null;
}

function quotesPath(): { name: string; full: boolean } | null {
  if (existsSync(path.join(process.cwd(), ".archive", "past-quotes.jsonl"))) return { name: "past-quotes.jsonl", full: true };
  if (existsSync(path.join(process.cwd(), ".archive", "sample-20-low.jsonl"))) return { name: "sample-20-low.jsonl", full: false };
  return null;
}

function tokensOf(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const token of text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").split(" ")) {
    if (token.length < 3 || STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    found.push(token);
  }
  return found;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function tokenPresent(token: string, words: Set<string>): boolean {
  if (words.has(token)) return true;
  if (token.length < 4) return false;
  for (const word of words) {
    if (word.length >= 4 && (word.startsWith(token) || token.startsWith(word))) return true;
  }
  return false;
}

function jobTypeOf(row: Record<string, unknown>): PastQuoteJobType | undefined {
  const value = textOf(row.jobType).toLowerCase();
  return JOB_TYPES.find((jobType) => jobType === value);
}

function pricesLikeBuild(row: Record<string, unknown>): boolean {
  const jobType = jobTypeOf(row);
  return jobType === undefined || jobType === "build" || jobType === "mixed";
}

// Unpriced jobs are skipped, so these two say nothing about the prices that are shown.
const HARMLESS_PROBLEMS = new Set(["a job has no price", "no subtotal"]);

function rowHasProblems(row: Record<string, unknown>): boolean {
  return stringsOf(row.problems).some((problem) => problem.trim().length > 0 && !HARMLESS_PROBLEMS.has(problem.trim()));
}

function recencyBoost(date: string | null): number {
  const year = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;
  if (!Number.isFinite(year)) return 0;
  // Newer proformas rank a little higher. The nudge stays under one matching word.
  return Math.min(Math.max(year - 2023, 0), 3) * 0.25;
}

function byRank(left: PastJob, right: PastJob): number {
  if (right.score !== left.score) return right.score - left.score;
  if (left.date === right.date) return 0;
  if (left.date === null) return 1;
  if (right.date === null) return -1;
  return right.date.localeCompare(left.date);
}

export function scorePastJobs(records: unknown[], query: string, limit = 6): PastJob[] {
  const queryTokens = tokensOf(query);
  if (queryTokens.length === 0) return [];
  const clean: PastJob[] = [];
  const flawed: PastJob[] = [];
  for (const record of records) {
    const row = recordOf(record);
    const parsed = row ? recordOf(row.parsed) : null;
    const jobs = parsed && Array.isArray(parsed.jobs) ? parsed.jobs : null;
    const pi = row && typeof row.pi === "string" ? row.pi : "";
    if (!row || !parsed || !jobs || !pi || !pricesLikeBuild(row) || row.pricing === "none") continue;
    const client = textOf(parsed.client);
    const title = textOf(parsed.title);
    const date = typeof parsed.date === "string" ? parsed.date : null;
    const read = textOf(parsed.transport);
    const transport = row.transportExcluded === true && read !== "excluded" ? "transportation excluded" : read;
    const note = row.pricing === "total" ? PACKAGE_NOTE : undefined;
    const clientTokens = new Set(tokensOf(client));
    const problems = rowHasProblems(row);
    for (const item of jobs) {
      const job = recordOf(item);
      if (!job) continue;
      const unitPrice = numberOrNull(job.unitPrice);
      const total = numberOrNull(job.total);
      if (unitPrice === null && total === null) continue;
      const name = textOf(job.name);
      const section = textOf(job.section);
      const materials = stringsOf(job.materials);
      const sizes = stringsOf(job.sizes);
      const words = new Set(tokensOf([client, title, name, section, materials.join(" "), sizes.join(" ")].join(" ")));
      let score = 0;
      for (const token of queryTokens) if (tokenPresent(token, words)) score += 1;
      // One shared word is noise: "booth" alone would match every job.
      if (score < Math.min(2, queryTokens.length)) continue;
      if (queryTokens.some((token) => clientTokens.has(token))) score += 2;
      score += recencyBoost(date);
      const ranked: PastJob = {
        pi,
        date,
        client,
        title,
        job: name,
        quantity: numberOrNull(job.quantity),
        unitPrice,
        total,
        sizes,
        materials: materials.slice(0, 8).map((material) => material.slice(0, 120)),
        transport,
        score,
        ...(note ? { note } : {}),
      };
      if (problems) flawed.push(ranked);
      else clean.push(ranked);
    }
  }
  const pool = clean.length > 0 ? clean : flawed;
  pool.sort(byRank);
  return pool.slice(0, limit);
}

let recordCache: { file: string; mtimeMs: number; records: unknown[] } | null = null;

function loadRecords(): unknown[] {
  const source = quotesPath();
  if (!source) return [];
  const file = path.join(process.cwd(), ".archive", source.name);
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path.join(process.cwd(), ".archive", source.name)).mtimeMs;
  } catch {
    return [];
  }
  if (recordCache?.file === file && recordCache.mtimeMs === mtimeMs) return recordCache.records;
  let body: string;
  try {
    body = readFileSync(path.join(process.cwd(), ".archive", source.name), "utf8");
  } catch {
    return [];
  }
  const records: unknown[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const row = recordOf(parsed);
      const invoice = row ? recordOf(row.parsed) : null;
      if (!invoice || !Array.isArray(invoice.jobs)) continue;
      records.push(parsed);
    } catch {
      continue;
    }
  }
  recordCache = { file, mtimeMs, records };
  return records;
}

export function searchPastJobs(query: string, limit = 6): PastJob[] {
  return scorePastJobs(loadRecords(), query, limit);
}

function byDateAsc(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

function signatureImage(filename: string, type: string, bytes: number): boolean {
  if (SIGNATURE_FILE.test(filename)) return true;
  return type.toLowerCase().startsWith("image/") && bytes < 40000;
}

function textsFrom(body: string): Map<string, string> {
  const texts = new Map<string, string>();
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = recordOf(JSON.parse(trimmed) as unknown);
      const sha1 = row ? textOf(row.sha1) : "";
      if (sha1) texts.set(sha1, textOf(row?.text));
    } catch {
      continue;
    }
  }
  return texts;
}

function batchTextNames(): string[] {
  let names: string[];
  try {
    names = readdirSync(path.join(process.cwd(), ".archive", "grok", "in"));
  } catch {
    return [];
  }
  return names.filter((name) => /^batch-[^/\\]+\.jsonl$/.test(name)).sort();
}

let textCache: { key: string; texts: Map<string, string> } | null = null;

function loadTexts(): Map<string, string> {
  const source = quotesPath();
  if (!source) return new Map();
  if (!source.full) {
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(path.join(process.cwd(), ".archive", "sample-20-input.jsonl")).mtimeMs;
    } catch {
      return new Map();
    }
    const key = `sample:${mtimeMs}`;
    if (textCache?.key === key) return textCache.texts;
    let body: string;
    try {
      body = readFileSync(path.join(process.cwd(), ".archive", "sample-20-input.jsonl"), "utf8");
    } catch {
      return new Map();
    }
    const texts = textsFrom(body);
    textCache = { key, texts };
    return texts;
  }
  const names = batchTextNames();
  const parts: string[] = [];
  for (const name of names) {
    try {
      parts.push(`${name}:${statSync(path.join(process.cwd(), ".archive", "grok", "in", name)).mtimeMs}`);
    } catch {
      parts.push(`${name}:missing`);
    }
  }
  const key = `full:${parts.join("|")}`;
  if (textCache?.key === key) return textCache.texts;
  const texts = new Map<string, string>();
  for (const name of names) {
    let body: string;
    try {
      body = readFileSync(path.join(process.cwd(), ".archive", "grok", "in", name), "utf8");
    } catch {
      continue;
    }
    for (const [sha1, text] of textsFrom(body)) texts.set(sha1, text);
  }
  textCache = { key, texts };
  return texts;
}

export function pastQuoteText(sha1: string): string {
  if (process.env.NODE_ENV === "production") return "";
  const cleaned = sha1.trim();
  if (!cleaned) return "";
  return loadTexts().get(cleaned) ?? "";
}

export function listPastQuotes(): PastQuote[] {
  const fileCounts = jobFileCounts();
  const quotes: PastQuote[] = [];
  for (const record of loadRecords()) {
    const row = recordOf(record);
    const parsed = row ? recordOf(row.parsed) : null;
    if (!row || !parsed) continue;
    const jobs: PastQuoteJob[] = [];
    for (const item of Array.isArray(parsed.jobs) ? parsed.jobs : []) {
      const job = recordOf(item);
      if (!job) continue;
      jobs.push({
        name: textOf(job.name),
        section: textOf(job.section),
        quantity: numberOrNull(job.quantity),
        unitPrice: numberOrNull(job.unitPrice),
        total: numberOrNull(job.total),
        sizes: stringsOf(job.sizes),
        materials: stringsOf(job.materials),
      });
    }
    const emails: PastQuoteEmail[] = [];
    for (const item of Array.isArray(row.emails) ? row.emails : []) {
      const email = recordOf(item);
      if (!email) continue;
      emails.push({
        date: typeof email.date === "string" ? email.date : null,
        from: textOf(email.from),
        to: textOf(email.to),
        subject: textOf(email.subject),
        approval: email.approval === true,
      });
    }
    emails.sort((left, right) => byDateAsc(left.date, right.date));
    const files: PastQuote["files"] = [];
    for (const item of Array.isArray(row.siblings) ? row.siblings : []) {
      const sibling = recordOf(item);
      if (!sibling) continue;
      const filename = textOf(sibling.filename);
      const type = textOf(sibling.type);
      const bytes = numberOrNull(sibling.bytes) ?? 0;
      if (signatureImage(filename, type, bytes)) continue;
      files.push({ filename, type, bytes });
    }
    const sha1 = textOf(row.sha1);
    const jobType = jobTypeOf(row);
    quotes.push({
      sha1,
      pi: textOf(row.pi),
      date: typeof parsed.date === "string" ? parsed.date : null,
      client: textOf(parsed.client),
      attention: textOf(parsed.attention),
      title: textOf(parsed.title),
      currency: textOf(parsed.currency),
      jobs,
      shared: stringsOf(parsed.shared),
      subtotal: numberOrNull(parsed.subtotal),
      vatPercent: numberOrNull(parsed.vatPercent),
      vat: numberOrNull(parsed.vat),
      grandTotal: numberOrNull(parsed.grandTotal),
      transport: textOf(parsed.transport),
      terms: textOf(parsed.terms),
      notes: stringsOf(parsed.notes),
      approval: row.approval === true,
      emails,
      files,
      problems: stringsOf(row.problems),
      text: "",
      fileCount: fileCounts.get(textOf(row.pi)) ?? 0,
      ...(jobType ? { jobType } : {}),
      ...(Array.isArray(row.versions) ? { versionCount: row.versions.length } : {}),
    });
  }
  quotes.sort((left, right) => (left.date && right.date ? right.date.localeCompare(left.date) : byDateAsc(left.date, right.date)));
  return quotes;
}
