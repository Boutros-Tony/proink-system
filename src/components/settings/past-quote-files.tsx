"use client";

import { Box, FileImage, FileText, Presentation } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AssignableKind, DecisionVerdict, JobDecisions, JobEmail, JobFile, JobManifest } from "@/lib/archive/job-files";

const GROUPS = [
  { id: "check", label: "To check" },
  { id: "technical", label: "Technical" },
  { id: "simulation", label: "Simulations" },
  { id: "artwork", label: "Artwork" },
  { id: "other", label: "Other" },
  { id: "proforma", label: "Proforma" },
] as const;

const KINDS: { value: AssignableKind; label: string }[] = [
  { value: "technical", label: "Technical" },
  { value: "simulation", label: "Simulation" },
  { value: "artwork", label: "Artwork" },
  { value: "other", label: "Other" },
];

const MODEL_EXTENSIONS = new Set(["dwg", "dxf", "step", "stp", "stl", "obj", "blend", "fbx", "3ds", "igs", "iges", "skp", "3dm"]);

type GroupId = (typeof GROUPS)[number]["id"];
type SaveBody = { pi: string; verdict: DecisionVerdict; sha1?: string; emailId?: string; kind?: AssignableKind };

function countLabel(count: number, singular: string, plural: string) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

function formatWhen(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Beirut" });
}

function fileHref(pi: string, relPath: string | null) {
  if (!relPath) return null;
  return `/api/archive/files?pi=${encodeURIComponent(pi)}&path=${encodeURIComponent(relPath)}`;
}

function groupId(file: JobFile): GroupId | "skipped" {
  if (file.skipped) return "skipped";
  if (file.confidence === "medium") return "check";
  return file.kind;
}

function canReview(file: JobFile, group: GroupId) {
  return group === "check" || file.kind !== "proforma";
}

function chosenKind(file: JobFile, decisions: JobDecisions): AssignableKind {
  const stored = decisions.files[file.sha1]?.kind;
  if (stored && stored !== "proforma") return stored;
  if (file.kind !== "proforma") return file.kind;
  return "other";
}

function FileGlyph({ file }: { file: JobFile }) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const type = file.mediaType.toLowerCase();
  const props = { size: 28, strokeWidth: 1.5, className: "text-muted", "aria-hidden": true as const };
  if (extension === "ppt" || extension === "pptx" || extension === "key" || extension === "odp" || type.includes("presentation")) return <Presentation {...props} />;
  if (MODEL_EXTENSIONS.has(extension) || type.startsWith("model/") || type.includes("dwg") || type.includes("autocad")) return <Box {...props} />;
  if (type.startsWith("image/")) return <FileImage {...props} />;
  return <FileText {...props} />;
}

function confidenceClass(value: JobEmail["confidence"]) {
  if (value === "anchor") return "bg-success/10 text-success";
  if (value === "high") return "bg-accent-soft text-accent";
  return "bg-raised text-muted";
}

function confidenceLabel(value: JobEmail["confidence"]) {
  if (value === "anchor") return "Anchor";
  if (value === "high") return "High";
  return "Medium";
}

function verdictClass(on: boolean, tone: "keep" | "reject") {
  if (!on) return "btn btn-ghost px-2 py-1 text-[11px]";
  if (tone === "keep") return "btn bg-accent-soft px-2 py-1 text-[11px] text-accent";
  return "btn bg-danger/10 px-2 py-1 text-[11px] text-danger";
}

function FilePreview({ file, href }: { file: JobFile; href: string | null }) {
  const webImage = href !== null && /^image\/(png|jpeg|gif|webp|svg\+xml|avif)$/i.test(file.mediaType);
  return (
    <span className="flex h-[120px] items-center justify-center overflow-hidden rounded-lg bg-raised">
      {webImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by the archive route for this proforma
        <img src={href} alt="" loading="lazy" className="h-[120px] w-full object-contain" />
      ) : (
        <FileGlyph file={file} />
      )}
    </span>
  );
}

function emptyDecisions(): JobDecisions {
  return { files: {}, emails: {} };
}

export function PastQuoteFiles({ pi }: { pi: string }) {
  const [phase, setPhase] = useState<"loading" | "empty" | "error" | "ready">("loading");
  const [manifest, setManifest] = useState<JobManifest | null>(null);
  const [decisions, setDecisions] = useState<JobDecisions>(emptyDecisions);
  const [emailsOpen, setEmailsOpen] = useState(false);
  const [error, setError] = useState("");
  const decisionsRef = useRef(decisions);
  const saveSeq = useRef(0);

  useEffect(() => {
    decisionsRef.current = decisions;
  }, [decisions]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/archive/files?pi=${encodeURIComponent(pi)}`, { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) {
          setPhase("empty");
          return;
        }
        if (!response.ok) {
          setPhase("error");
          return;
        }
        const body = (await response.json()) as { manifest?: JobManifest; decisions?: JobDecisions };
        if (!body.manifest || !Array.isArray(body.manifest.files) || !Array.isArray(body.manifest.emails) || !body.decisions) {
          setPhase("error");
          return;
        }
        setManifest(body.manifest);
        setDecisions(body.decisions);
        setPhase("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhase("error");
      });
    return () => controller.abort();
  }, [pi]);

  async function save(body: SaveBody, apply: (current: JobDecisions) => JobDecisions) {
    const seq = ++saveSeq.current;
    const previous = decisionsRef.current;
    const next = apply(previous);
    decisionsRef.current = next;
    setDecisions(next);
    setError("");
    try {
      const response = await fetch("/api/archive/files", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as JobDecisions;
      if (!response.ok || !payload?.files || !payload?.emails) throw new Error("save");
      if (seq !== saveSeq.current) return;
      decisionsRef.current = payload;
      setDecisions(payload);
    } catch {
      if (seq !== saveSeq.current) return;
      decisionsRef.current = previous;
      setDecisions(previous);
      setError("Could not save.");
    }
  }

  function reviewFile(file: JobFile, verdict: "keep" | "reject") {
    const current = decisions.files[file.sha1]?.verdict;
    const next: DecisionVerdict = current === verdict ? "clear" : verdict;
    const kind = next === "keep" ? chosenKind(file, decisions) : undefined;
    void save({ pi, sha1: file.sha1, verdict: next, ...(kind ? { kind } : {}) }, (currentDecisions) => {
      const files = { ...currentDecisions.files };
      if (next === "clear") delete files[file.sha1];
      else files[file.sha1] = kind ? { verdict: next, kind, at: new Date().toISOString() } : { verdict: next, at: new Date().toISOString() };
      return { files, emails: currentDecisions.emails };
    });
  }

  function reviewEmail(email: JobEmail, verdict: "keep" | "reject") {
    const current = decisions.emails[email.id]?.verdict;
    const next: DecisionVerdict = current === verdict ? "clear" : verdict;
    void save({ pi, emailId: email.id, verdict: next }, (currentDecisions) => {
      const emails = { ...currentDecisions.emails };
      if (next === "clear") delete emails[email.id];
      else emails[email.id] = { verdict: next, at: new Date().toISOString() };
      return { files: currentDecisions.files, emails };
    });
  }

  function changeKind(file: JobFile, kind: AssignableKind) {
    void save({ pi, sha1: file.sha1, verdict: "keep", kind }, (currentDecisions) => ({
      files: { ...currentDecisions.files, [file.sha1]: { verdict: "keep", kind, at: new Date().toISOString() } },
      emails: currentDecisions.emails,
    }));
  }

  const visible = manifest?.files.filter((file) => !file.skipped) ?? [];
  const skipped = manifest?.files.filter((file) => file.skipped) ?? [];

  return (
    <section className="border-t border-line px-5 py-4" aria-labelledby="linked-job-files">
      <h4 id="linked-job-files" className="text-sm font-semibold">
        Files
      </h4>
      {phase === "loading" ? <p className="mt-2 text-sm text-muted">Loading files…</p> : null}
      {phase === "error" ? <p className="mt-2 text-sm text-muted">Could not load files.</p> : null}
      {phase === "empty" ? <p className="mt-2 text-sm text-muted">No linked files yet.</p> : null}
      {phase === "ready" && manifest ? (
        <>
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {countLabel(manifest.emails.length, "email", "emails")} linked · {countLabel(visible.length, "file", "files")}
            </p>
            {manifest.emails.length > 0 ? (
              <button type="button" aria-expanded={emailsOpen} onClick={() => setEmailsOpen((open) => !open)} className="btn btn-ghost px-2 py-1 text-[11px]">
                {emailsOpen ? "Hide emails" : "Show emails"}
              </button>
            ) : null}
          </div>
          {error ? (
            <p className="mt-2 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          {emailsOpen ? (
            <ul className="mt-3 space-y-3">
              {manifest.emails.map((email, index) => {
                const verdict = decisions.emails[email.id]?.verdict;
                return (
                  <li key={`${email.id}:${index}`}>
                    <div className={verdict === "reject" ? "opacity-45" : undefined}>
                      <p className="text-[11px] text-muted">
                        {formatWhen(email.date)}
                        <span className="text-subtle"> · </span>
                        {email.mailbox}
                      </p>
                      <p className="mt-0.5 truncate text-sm">{email.from || "—"}</p>
                      <p className="flex items-center gap-2 text-sm text-muted">
                        <span className="min-w-0 truncate">{email.subject || "—"}</span>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${confidenceClass(email.confidence)}`}>{confidenceLabel(email.confidence)}</span>
                      </p>
                      {email.reasons.length > 0 ? <p className="text-[11px] leading-4 text-muted">{email.reasons.join(" · ")}</p> : null}
                    </div>
                    <div className="mt-1.5 flex gap-1.5">
                      <button type="button" aria-pressed={verdict === "keep"} aria-label={`Keep email ${email.subject || email.id}`} onClick={() => reviewEmail(email, "keep")} className={verdictClass(verdict === "keep", "keep")}>
                        Keep
                      </button>
                      <button type="button" aria-pressed={verdict === "reject"} aria-label={`Reject email ${email.subject || email.id}`} onClick={() => reviewEmail(email, "reject")} className={verdictClass(verdict === "reject", "reject")}>
                        Reject
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="mt-4 space-y-4">
            {GROUPS.map((group) => {
              const files = manifest.files.filter((file) => groupId(file) === group.id);
              if (files.length === 0) return null;
              return (
                <div key={group.id}>
                  <h5 className="eyebrow">{group.label}</h5>
                  <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {files.map((file, index) => {
                      const href = fileHref(pi, file.path);
                      const verdict = decisions.files[file.sha1]?.verdict;
                      const review = canReview(file, group.id);
                      const body = (
                        <>
                          <FilePreview file={file} href={href} />
                          <p className="mt-2 truncate text-sm" title={file.name}>
                            {file.name || "—"}
                          </p>
                          <p className="text-[11px] text-muted">{formatSize(file.bytes)}</p>
                          {file.reasons.length > 0 ? <p className="text-[11px] leading-4 text-muted">{file.reasons.join(" · ")}</p> : null}
                        </>
                      );
                      return (
                        <li key={`${file.sha1}:${file.path ?? index}`} className="min-w-0 rounded-xl border border-line bg-panel p-2">
                          <div className={verdict === "reject" ? "opacity-40" : undefined}>
                            {href ? (
                              <a href={href} target="_blank" rel="noreferrer" className="block min-w-0">
                                {body}
                              </a>
                            ) : (
                              <div className="min-w-0">{body}</div>
                            )}
                          </div>
                          {review ? (
                            <>
                              <div className="mt-2 flex gap-1.5">
                                <button type="button" aria-pressed={verdict === "keep"} aria-label={`Keep ${file.name}`} onClick={() => reviewFile(file, "keep")} className={verdictClass(verdict === "keep", "keep")}>
                                  Keep
                                </button>
                                <button type="button" aria-pressed={verdict === "reject"} aria-label={`Reject ${file.name}`} onClick={() => reviewFile(file, "reject")} className={verdictClass(verdict === "reject", "reject")}>
                                  Reject
                                </button>
                              </div>
                              {verdict === "keep" ? (
                                <select aria-label={`Kind for ${file.name}`} value={chosenKind(file, decisions)} onChange={(event) => changeKind(file, event.target.value as AssignableKind)} className="field mt-2 w-full py-1 text-[11px]">
                                  {KINDS.map((kind) => (
                                    <option key={kind.value} value={kind.value}>
                                      {kind.label}
                                    </option>
                                  ))}
                                </select>
                              ) : null}
                            </>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
          {skipped.length > 0 ? (
            <ul className="mt-4 space-y-1 text-sm text-muted">
              {skipped.map((file, index) => (
                <li key={`${file.sha1}:skipped:${index}`}>
                  {file.name || "—"}
                  <span className="text-subtle"> — </span>
                  {file.skipped}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
