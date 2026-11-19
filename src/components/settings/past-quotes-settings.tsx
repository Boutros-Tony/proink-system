"use client";

import { useEffect, useMemo, useState } from "react";
import { PastQuoteFiles } from "@/components/settings/past-quote-files";
import { formatCents } from "@/lib/format";
import type { PastQuote, PastQuoteJobType } from "@/lib/archive/past-quotes";

const PAGE_SIZE = 200;

const JOB_FILTERS = [
  { id: "all", label: "All" },
  { id: "build", label: "Build" },
  { id: "print", label: "Print" },
  { id: "installation", label: "Installation" },
  { id: "transport", label: "Transport" },
  { id: "maintenance", label: "Maintenance" },
  { id: "other", label: "Other" },
] as const;

type JobFilter = (typeof JOB_FILTERS)[number]["id"];

function fold(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function money(value: number | null) {
  return value === null ? "—" : formatCents(Math.round(value * 100));
}

function formatDay(value: string | null) {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatEmailWhen(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Beirut" });
}

function transportLine(value: string) {
  const folded = value.trim().toLowerCase();
  if (folded === "included") return "Transport included";
  if (folded === "excluded") return "Transport excluded";
  return null;
}

function sizeInKb(bytes: number) {
  const kb = bytes / 1024;
  return `${kb >= 10 ? Math.round(kb) : kb.toFixed(1)} KB`;
}

function jobGroup(jobType: PastQuoteJobType | undefined): Exclude<JobFilter, "all"> {
  if (jobType === "print" || jobType === "installation" || jobType === "transport" || jobType === "maintenance") return jobType;
  if (jobType === "rental" || jobType === "mixed" || jobType === "other") return "other";
  return "build";
}

function jobTypeLabel(jobType: PastQuoteJobType): string {
  if (jobType === "print") return "Print";
  if (jobType === "installation") return "Installation";
  if (jobType === "transport") return "Transport";
  if (jobType === "maintenance") return "Maintenance";
  if (jobType === "rental") return "Rental";
  if (jobType === "mixed") return "Mixed";
  if (jobType === "other") return "Other";
  return "Build";
}

function OriginalPdfText({ sha1 }: { sha1: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!open || !sha1) return;
    const controller = new AbortController();
    fetch(`/api/archive/past-quote-text?sha1=${encodeURIComponent(sha1)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("text");
        const body = (await response.json()) as { text?: unknown };
        if (controller.signal.aborted) return;
        setText(typeof body.text === "string" ? body.text : "");
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [open, sha1]);

  return (
    <details
      open={open}
      className="border-t border-line px-5 py-4"
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next) {
          setFailed(false);
          setText(null);
        }
        setOpen(next);
      }}
    >
      <summary className="cursor-pointer text-sm font-medium">Original PDF text</summary>
      {open ? (
        !sha1 ? (
          <p className="mt-2 text-sm text-muted">No text saved.</p>
        ) : failed ? (
          <p className="mt-2 text-sm text-muted">Could not load the text.</p>
        ) : text === null ? (
          <p className="mt-2 text-sm text-muted">Loading text…</p>
        ) : text ? (
          <pre className="mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-muted">{text}</pre>
        ) : (
          <p className="mt-2 text-sm text-muted">No text saved.</p>
        )
      ) : null}
    </details>
  );
}

export function PastQuotesSettings({ quotes, showFiles = false }: { quotes: PastQuote[] | null; showFiles?: boolean }) {
  const [search, setSearch] = useState("");
  const [jobFilter, setJobFilter] = useState<JobFilter>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const shown = useMemo(() => {
    if (!quotes) return [];
    const needle = fold(search.trim());
    return quotes.filter((quote) => {
      if (jobFilter !== "all" && jobGroup(quote.jobType) !== jobFilter) return false;
      if (!needle) return true;
      return [quote.pi, quote.client, quote.title, ...quote.jobs.map((job) => job.name)].some((value) => fold(value).includes(needle));
    });
  }, [quotes, search, jobFilter]);
  const visible = shown.slice(0, visibleCount);

  const selected = shown.find((quote) => quote.sha1 === selectedId) ?? shown[0] ?? null;
  const transport = selected ? transportLine(selected.transport) : null;

  return (
    <div className="mx-auto max-w-5xl px-8 pt-10 pb-20">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Past quotes</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted">Proformas read from the mailbox. The AI compares new quotes with these. They live on this computer only.</p>
      </header>

      {quotes === null ? (
        <p className="mt-6 text-sm text-muted">Past quotes are only on the studio computer for now.</p>
      ) : (
        <>
          <div className="mt-6 flex items-center gap-3">
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setVisibleCount(PAGE_SIZE);
              }}
              placeholder="Search PI, client, title, or job"
              aria-label="Search past quotes"
              className="field min-w-0 flex-1 py-2 text-[13px]"
            />
            <p className="shrink-0 text-sm text-muted">
              {shown.length} proformas
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Job type">
            {JOB_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                aria-pressed={jobFilter === filter.id}
                title={filter.id === "other" ? "Rental, mixed, and other" : undefined}
                onClick={() => {
                  setJobFilter(filter.id);
                  setVisibleCount(PAGE_SIZE);
                }}
                className={`rounded-full px-2.5 py-1 text-[11px] ${jobFilter === filter.id ? "bg-accent-soft text-accent" : "bg-raised text-muted hover:text-ink"}`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid items-start gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
            <div>
              <ul className="max-h-[calc(100dvh-16rem)] space-y-0.5 overflow-y-auto" aria-label="Past quotes">
              {visible.map((quote) => {
                const active = selected?.sha1 === quote.sha1;
                return (
                  <li key={quote.sha1 || quote.pi}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(quote.sha1)}
                      aria-current={active ? "true" : undefined}
                      className={`flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${active ? "bg-accent-soft text-accent" : "text-ink hover:bg-raised"}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-xs">{quote.pi || "—"}</span>
                        <span className={`mt-0.5 block text-[11px] ${active ? "text-accent/80" : "text-muted"}`}>{formatDay(quote.date)}</span>
                        <span className={`mt-0.5 block text-[11px] ${active ? "text-accent/80" : "text-muted"}`}>{jobTypeLabel(quote.jobType ?? "build")}</span>
                        {(quote.versionCount ?? 0) > 1 ? <span className={`mt-0.5 block text-[11px] ${active ? "text-accent/80" : "text-muted"}`}>{quote.versionCount} versions</span> : null}
                        {quote.fileCount > 0 ? <span className={`mt-0.5 block text-[11px] ${active ? "text-accent/80" : "text-muted"}`}>{quote.fileCount === 1 ? "1 file" : `${quote.fileCount} files`}</span> : null}
                        <span className="mt-1 block truncate text-[13px] font-medium">{quote.client || "—"}</span>
                        <span className={`block truncate text-[11px] ${active ? "text-accent/80" : "text-muted"}`}>{quote.title}</span>
                      </span>
                      <span className="shrink-0 font-mono text-xs">{money(quote.grandTotal)}</span>
                    </button>
                  </li>
                );
                })}
              </ul>
              {shown.length > visible.length ? (
                <button type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="mt-2 w-full rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-muted hover:bg-raised hover:text-ink">
                  Show more
                </button>
              ) : null}
            </div>

            {selected ? (
              <article className="rounded-2xl border border-line bg-panel shadow-soft">
                <div className="px-5 pt-5 pb-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-mono text-sm">{selected.pi || "—"}</p>
                      <p className="mt-1 text-xs text-muted">{formatDay(selected.date)}</p>
                      <h3 className="mt-3 text-sm font-semibold">{selected.client || "—"}</h3>
                      {selected.attention ? <p className="mt-0.5 text-xs text-muted">{selected.attention}</p> : null}
                      {selected.title ? <p className="mt-1 text-sm">{selected.title}</p> : null}
                    </div>
                    {selected.approval ? <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">Approval email</span> : null}
                  </div>

                  <ul className="mt-4 divide-y divide-line border-t border-line">
                    {selected.jobs.map((job, index) => (
                      <li key={`${job.name}:${index}`} className="flex items-start justify-between gap-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{job.name || "—"}</p>
                          {job.section ? <p className="text-xs text-muted">{job.section}</p> : null}
                          {job.sizes.length > 0 ? <p className="mt-1 text-[11px] leading-4 text-muted">{job.sizes.join(" · ")}</p> : null}
                          {job.materials.length > 0 ? <p className="text-[11px] leading-4 text-muted">{job.materials.join(" · ")}</p> : null}
                        </div>
                        <div className="shrink-0 text-right">
                          {job.quantity !== null && job.unitPrice !== null ? (
                            <p className="text-xs text-muted">
                              {job.quantity} × {money(job.unitPrice)}
                            </p>
                          ) : null}
                          <p className="font-mono text-sm">{money(job.total)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>

                  <dl className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="text-muted">Subtotal</dt>
                      <dd className="font-mono">{money(selected.subtotal)}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="text-muted">VAT{selected.vatPercent === null ? "" : ` (${selected.vatPercent}%)`}</dt>
                      <dd className="font-mono">{money(selected.vat)}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-4 font-medium">
                      <dt>Total</dt>
                      <dd className="font-mono">{money(selected.grandTotal)}</dd>
                    </div>
                  </dl>
                  {transport ? <p className="mt-3 text-sm text-muted">{transport}</p> : null}
                  {selected.terms ? <p className="mt-2 text-sm leading-6">{selected.terms}</p> : null}
                  {selected.notes.length > 0 ? (
                    <ul className="mt-2 space-y-1 text-sm leading-6 text-muted">
                      {selected.notes.map((note, index) => (
                        <li key={index}>{note}</li>
                      ))}
                    </ul>
                  ) : null}
                  {selected.shared.length > 0 ? (
                    <div className="mt-3">
                      <h4 className="text-xs font-medium text-muted">Shared</h4>
                      <ul className="mt-1 space-y-1 text-sm leading-6">
                        {selected.shared.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {selected.problems.length > 0 ? (
                    <div className="mt-4 text-danger">
                      <h4 className="text-sm font-semibold">Did not add up</h4>
                      <ul className="mt-1 space-y-1 text-sm leading-6">
                        {selected.problems.map((problem, index) => (
                          <li key={index}>{problem}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <section className="border-t border-line px-5 py-4" aria-labelledby="past-quote-emails">
                  <h4 id="past-quote-emails" className="text-sm font-semibold">
                    Emails
                  </h4>
                  {selected.emails.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">No emails.</p>
                  ) : (
                    <ul className="mt-3 space-y-3">
                      {selected.emails.map((email, index) => (
                        <li key={`${email.date ?? "none"}:${index}`}>
                          <p className="text-[11px] text-muted">{formatEmailWhen(email.date)}</p>
                          <p className="mt-0.5 text-sm">{email.from || "—"}</p>
                          <p className="text-sm text-muted">
                            {email.subject || "—"}
                            {email.approval ? <span className="ml-2 text-[11px] font-medium text-success">approval</span> : null}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="border-t border-line px-5 py-4" aria-labelledby="past-quote-files">
                  <h4 id="past-quote-files" className="text-sm font-semibold">
                    Files in the emails
                  </h4>
                  {selected.files.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">No other files.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {selected.files.map((file, index) => (
                        <li key={`${file.filename}:${index}`} className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">{file.filename || "—"}</span>
                          <span className="shrink-0 text-xs text-muted">
                            {file.type || "file"}
                            <span className="text-subtle"> · </span>
                            {sizeInKb(file.bytes)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                {showFiles && selected.pi && selected.fileCount > 0 ? <PastQuoteFiles key={`files:${selected.sha1 || selected.pi}`} pi={selected.pi} /> : null}

                <OriginalPdfText key={`text:${selected.sha1 || selected.pi}`} sha1={selected.sha1} />
              </article>
            ) : (
              <p className="rounded-2xl border border-line bg-panel px-5 py-10 text-center text-sm text-muted shadow-soft">No proforma matches.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
