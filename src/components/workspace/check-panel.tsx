"use client";

import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { recordSpend } from "@/lib/studio/ai-spend";
import { getModelEffort, getStudioSettings } from "@/lib/studio/local-booth";
import { acceptFinding, reviewState } from "@/lib/systems/modular/review";
import { productionReviewSchema, type DesignDocument } from "@/lib/systems/modular/schema";
import type { ValidationIssue } from "@/lib/systems/types";

const NO_ISSUES = "No issues.";

/** Translations already fetched, so toggling back and forth never calls the model twice. */
const remembered: Record<string, string> = {};

/** The cedar of Lebanon: flat tiers on a straight trunk. */
export function CedarIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <ellipse cx="12" cy="4.9" rx="4" ry="2.2" />
      <ellipse cx="12" cy="9.5" rx="7" ry="2.2" />
      <ellipse cx="12" cy="14.1" rx="10" ry="2.2" />
      <rect x="10.8" y="15.8" width="2.4" height="6.4" rx="0.6" />
    </svg>
  );
}

/**
 * The checks, one message at a time. Each message has its own cedar button that rewrites just that
 * message in Lebanese Arabic with English letters, so only the messages you ask for are translated.
 */
export function CheckPanel({
  issues,
  document,
  brief,
  sourceKind,
  modelReady,
  onDocument,
  onSelect,
}: {
  issues: ValidationIssue[];
  document: DesignDocument;
  brief: string;
  sourceKind: string;
  modelReady: boolean;
  onDocument: (document: DesignDocument) => void;
  onSelect: (ids: string[]) => void;
}) {
  // Messages currently shown in Lebanese, a message being translated, and any failure, all keyed by the English text.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [, setVersion] = useState(0);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const latest = useRef(document);
  latest.current = document;
  const checked = reviewState(document);
  const noPieces = document.parts.length === 0;
  const blockedReason = noPieces ? "There are no pieces to check yet." : !modelReady ? "Add a model key to run the check." : "";

  function change(set: ReadonlySet<string>, text: string, on: boolean) {
    const next = new Set(set);
    if (on) next.add(text);
    else next.delete(text);
    return next;
  }

  async function translate(text: string) {
    setFailed(({ [text]: _removed, ...rest }) => {
      void _removed;
      return rest;
    });
    if (remembered[text]) {
      setOpen((current) => change(current, text, true));
      return;
    }
    setBusy((current) => change(current, text, true));
    try {
      const settings = getStudioSettings();
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ texts: [text], provider: settings.provider, model: settings.model }),
      });
      const payload = (await response.json().catch(() => null)) as { translations?: string[]; error?: string } | null;
      recordSpend(payload);
      const result = payload?.translations?.[0];
      if (!response.ok || !result) throw new Error(payload?.error ?? "The translation failed.");
      remembered[text] = result;
      setOpen((current) => change(current, text, true));
      setVersion((value) => value + 1);
    } catch (failure) {
      setFailed((current) => ({ ...current, [text]: failure instanceof Error ? failure.message : "The translation failed." }));
    } finally {
      setBusy((current) => change(current, text, false));
    }
  }

  function toggle(text: string) {
    if (open.has(text)) setOpen((current) => change(current, text, false));
    else if (!busy.has(text)) void translate(text);
  }

  function CedarButton({ text }: { text: string }) {
    const on = open.has(text);
    const loading = busy.has(text);
    return (
      <button
        type="button"
        onClick={() => toggle(text)}
        disabled={loading}
        aria-pressed={on}
        aria-label={on ? "Show in English" : "Translate to Lebanese"}
        title={on ? "Show in English" : "Translate to Lebanese, written in English letters"}
        className={`mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors ${
          on ? "border-success/30 bg-success-soft text-success" : "border-line bg-panel text-subtle hover:border-success/30 hover:bg-success-soft hover:text-success"
        }`}
      >
        {loading ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <CedarIcon size={14} />}
      </button>
    );
  }

  const show = (text: string) => (open.has(text) ? remembered[text] : undefined);

  async function runCheck() {
    if (running || blockedReason) return;
    setRunError(null);
    setRunning(true);
    try {
      const settings = getStudioSettings();
      const response = await fetch("/api/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          document,
          provider: settings.provider,
          model: settings.model,
          effort: getModelEffort(settings.provider, settings.model),
          brief,
          sourceKind,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { review?: unknown; error?: string } | null;
      recordSpend(payload);
      if (!response.ok || !payload) throw new Error(payload?.error ?? "The production check failed.");
      const review = productionReviewSchema.safeParse(payload.review);
      if (!review.success) throw new Error(payload.error ?? "The production check returned something unreadable. Try again.");
      onDocument({ ...latest.current, review: review.data });
    } catch (failure) {
      setRunError(failure instanceof Error ? failure.message : "The production check failed.");
    } finally {
      setRunning(false);
    }
  }

  const checkedAt = checked ? writtenAt(checked.review.at) : "";

  return (
    <div>
      <div className="border-b border-line px-4 py-4">
        <button type="button" onClick={() => void runCheck()} disabled={running || blockedReason !== ""} className="btn btn-secondary w-full py-2 text-xs">
          {running ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
          Run production check
        </button>
        {blockedReason && !running ? <p className="mt-2 text-xs text-muted">{blockedReason}</p> : null}
        {checked ? (
          <div className="mt-3 space-y-1 text-xs leading-5 text-muted">
            <p>{[checkedAt, checked.review.summary].filter(Boolean).join(" · ")}</p>
            {checked.stale ? <p>The stand changed after the production check. Run the check again.</p> : null}
          </div>
        ) : null}
        {runError ? (
          <p role="alert" className="mt-2 text-xs text-danger">
            {runError}
          </p>
        ) : null}
      </div>
      <ul className="space-y-2.5 px-4 py-4">
      {issues.length === 0 ? (
        <li className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line-strong px-6 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle2 size={22} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="flex items-center gap-2 text-sm text-muted">
            {show(NO_ISSUES) ?? NO_ISSUES}
            <CedarButton text={NO_ISSUES} />
          </span>
          {failed[NO_ISSUES] ? <span className="text-xs text-danger">{failed[NO_ISSUES]}</span> : null}
        </li>
      ) : null}
      {issues.map((issue, index) => {
        const isError = issue.severity === "error";
        const local = show(issue.message);
        return (
          <li
            key={`${issue.code}-${index}`}
            className={`flex gap-3 rounded-xl border px-3.5 py-3 text-sm leading-5 ${isError ? "border-danger/20 bg-danger-soft" : "border-line bg-raised/60"}`}
          >
            <span className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${isError ? "bg-danger/15 text-danger" : "bg-accent-soft text-accent"}`}>
              <TriangleAlert size={12} strokeWidth={2.5} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={`block ${isError ? "text-danger" : "text-muted"}`}>{local ?? issue.message}</span>
              {local ? <span className="mt-1 block text-[11px] leading-4 text-subtle">{issue.message}</span> : null}
              {issue.findingId && issue.fix ? <span className="mt-1 block text-[12px] leading-4 text-muted">Fix: {issue.fix}</span> : null}
              {issue.findingId && issue.pieces && issue.pieces.length > 0 ? (
                <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                  {issue.pieces.map((id) => {
                    const name = document.parts.find((part) => part.id === id)?.name ?? id;
                    return (
                      <button key={id} type="button" onClick={() => onSelect(issue.pieces ?? [])} className="text-[11px] font-medium text-accent hover:underline">
                        {name}
                      </button>
                    );
                  })}
                </span>
              ) : null}
              {issue.findingId && isError && !issue.accepted ? (
                <button
                  type="button"
                  onClick={() => onDocument(acceptFinding(document, issue.findingId!, true))}
                  className="mt-2 rounded-lg border border-line bg-panel px-2 py-1 text-[11px] font-medium text-muted hover:text-ink"
                >
                  Accept anyway
                </button>
              ) : null}
              {issue.findingId && issue.accepted ? (
                <span className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                  Accepted
                  <button type="button" onClick={() => onDocument(acceptFinding(document, issue.findingId!, false))} className="font-medium text-accent hover:underline">
                    Undo
                  </button>
                </span>
              ) : null}
              {failed[issue.message] ? (
                <span role="alert" className="mt-1.5 block text-xs leading-4 text-danger">
                  {failed[issue.message]}
                </span>
              ) : null}
            </span>
            <CedarButton text={issue.message} />
          </li>
        );
      })}
    </ul>
    </div>
  );
}

function writtenAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(date);
}
