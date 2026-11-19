import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { z } from "zod";
import { jobFilePath, jobFilesAvailable, loadJob, saveDecision } from "@/lib/archive/job-files";
import { requireStudio } from "@/lib/studio/server-data";

const filePostSchema = z.object({
  pi: z.string().min(1),
  sha1: z.string().min(1),
  verdict: z.enum(["keep", "reject", "clear"]),
  kind: z.enum(["technical", "simulation", "artwork", "other"]).optional(),
});

const emailPostSchema = z.object({
  pi: z.string().min(1),
  emailId: z.string().min(1),
  verdict: z.enum(["keep", "reject", "clear"]),
});

const postSchema = z.union([filePostSchema, emailPostSchema]);

function rfc5987(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => {
    const char = String.fromCharCode(byte);
    return /[A-Za-z0-9!#$&+\-.^_`|~]/.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }).join("");
}

// Mail attachments are untrusted: only pictures and PDFs open in the browser, so an HTML or SVG file never runs on the studio's origin.
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);
const BY_EXTENSION: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", pdf: "application/pdf" };

function contentDisposition(name: string, mediaType: string): string {
  const cleaned = name.replace(/[\r\n"]/g, "").trim() || "file";
  const ascii = cleaned.replace(/[^\x20-\x7E]/g, "_").replace(/\\/g, "_");
  return `${INLINE_TYPES.has(mediaType) ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${rfc5987(cleaned)}`;
}

function mediaTypeOf(value: string): string {
  const cleaned = value.split(";", 1)[0]?.trim() ?? "";
  return /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(cleaned) ? cleaned : "application/octet-stream";
}

export async function GET(request: Request) {
  if (!(await requireStudio())) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!jobFilesAvailable()) return Response.json({ error: "Not found." }, { status: 404 });
  const params = new URL(request.url).searchParams;
  const pi = params.get("pi") ?? "";
  if (!pi) return Response.json({ error: "Choose a proforma." }, { status: 400 });
  const relPath = params.get("path");
  if (relPath === null) {
    const job = loadJob(pi);
    if (!job) return Response.json({ error: "No linked files." }, { status: 404 });
    return Response.json(job);
  }
  const located = jobFilePath(pi, relPath);
  if (!located) return Response.json({ error: "Not found." }, { status: 404 });
  let size = 0;
  try {
    const info = statSync(located.path);
    if (!info.isFile()) return Response.json({ error: "Not found." }, { status: 404 });
    size = info.size;
  } catch {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  const stream = Readable.toWeb(createReadStream(located.path)) as ReadableStream<Uint8Array>;
  const mediaType = BY_EXTENSION[located.name.toLowerCase().split(".").pop() ?? ""] ?? mediaTypeOf(located.mediaType).toLowerCase();
  return new Response(stream, {
    headers: {
      "Content-Type": INLINE_TYPES.has(mediaType) ? mediaType : "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": contentDisposition(located.name, mediaType),
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(request: Request) {
  if (!(await requireStudio())) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!jobFilesAvailable()) return Response.json({ error: "Not found." }, { status: 404 });
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Send a decision." }, { status: 400 });
  }
  const parsed = postSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: "Send a decision." }, { status: 400 });
  const input = "sha1" in parsed.data ? { sha1: parsed.data.sha1, verdict: parsed.data.verdict, kind: parsed.data.kind } : { emailId: parsed.data.emailId, verdict: parsed.data.verdict };
  let result;
  try {
    result = saveDecision(parsed.data.pi, input);
  } catch {
    return Response.json({ error: "Could not save." }, { status: 500 });
  }
  if (!result.ok) {
    const status = result.reason === "missing" ? 404 : 400;
    const error = result.reason === "missing" ? "No linked files." : "That item is not in this proforma.";
    return Response.json({ error }, { status });
  }
  return Response.json(result.decisions);
}
