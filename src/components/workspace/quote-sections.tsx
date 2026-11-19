"use client";

import { ChevronRight, Download, Eye, Loader2, Undo2 } from "lucide-react";
import { useEffect, useState, type KeyboardEvent } from "react";
import { formatCents } from "@/lib/format";
import { getActiveProjectId } from "@/lib/studio/cloud";
import { getCosting, setCosting } from "@/lib/studio/costing";
import { listQuotes, QUOTE_STATUSES, setQuoteStatus, subscribeQuotes, type IssuedQuote } from "@/lib/studio/quotes";
import type { CostLine } from "@/lib/systems/costing";
import type { DesignDocument } from "@/lib/systems/modular/schema";
import { editSection, quoteTotals, sectionCostCents, sectionMark, sectionSizeText, type QuoteMeta, type QuoteSection } from "@/lib/systems/sections";

function blurOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.currentTarget.blur();
}

/** The client's price for one row. Typing a price keeps it through later changes until it is reset. */
function PriceInput({ label, cents, onCommit }: { label: string; cents: number; onCommit: (cents: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(Math.round(cents) / 100);

  function commit(raw: string) {
    setDraft(null);
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value < 0) return;
    const next = Math.round(value * 100);
    if (next !== cents) onCommit(next);
  }

  return (
    <span className="relative shrink-0">
      <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[11px] text-subtle">$</span>
      <input
        aria-label={label}
        value={shown}
        inputMode="decimal"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          if (draft !== null) commit(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(null);
            event.currentTarget.blur();
          } else blurOnEnter(event);
        }}
        className="w-28 rounded-md border border-transparent bg-transparent py-1 pr-2 pl-5 text-right font-mono text-[13px] font-medium transition-colors outline-none hover:border-line focus:border-line-strong focus:bg-bg"
      />
    </span>
  );
}

function Row({ rows, index, document, lines }: { rows: QuoteSection[]; index: number; document: DesignDocument; lines: CostLine[] }) {
  const [open, setOpen] = useState(false);
  const row = rows[index];
  const mark = sectionMark(rows, index);
  const size = row.jobWide ? "" : sectionSizeText(document, row.partIds);
  const pieces = document.parts.filter((part) => row.partIds.includes(part.id));
  const owned = row.jobWide ? lines.filter((line) => row.lineKeys.includes(line.key) && !line.excluded) : [];
  const count = row.jobWide ? owned.length : pieces.length;
  const noun = row.jobWide ? (count === 1 ? "cost" : "costs") : count === 1 ? "piece" : "pieces";
  const name = mark ? `Item ${mark}` : row.title;

  function save(change: Parameters<typeof editSection>[2]) {
    const current = getCosting();
    setCosting({ ...current, sections: editSection(rows, row.id, change) });
  }

  return (
    <li className="py-2">
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-[10px] font-semibold tracking-wide text-subtle">{mark ? `ITEM ${mark}` : ""}</span>
        <input
          key={row.title}
          aria-label={`${name} name`}
          defaultValue={row.title}
          maxLength={120}
          onBlur={(event) => {
            const title = event.currentTarget.value.trim();
            if (title && title !== row.title) save({ title, titleEdited: true });
            else event.currentTarget.value = row.title;
          }}
          onKeyDown={blurOnEnter}
          className="-ml-1.5 min-w-0 flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[13px] font-medium transition-colors outline-none hover:border-line focus:border-line-strong focus:bg-bg"
        />
        <PriceInput label={`${name} price`} cents={row.sellCents} onCommit={(sellCents) => save({ sellCents, sellEdited: true })} />
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 pl-14 text-[11px] leading-4 text-muted">
        {size ? <span>{size}</span> : null}
        {size && count > 0 ? <span aria-hidden="true">·</span> : null}
        {count > 0 ? (
          <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex items-center gap-0.5 hover:text-ink">
            {count} {noun}
            <ChevronRight size={11} strokeWidth={2.25} aria-hidden="true" className={`transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
        ) : null}
        <span className="ml-auto text-subtle">Cost {formatCents(sectionCostCents(row, lines))}</span>
      </div>
      {row.sellEdited ? (
        <div className="mt-0.5 flex items-center gap-1.5 pl-14 text-[11px] text-accent">
          Your price
          <button type="button" onClick={() => save({ sellEdited: false })} className="flex items-center gap-1 text-muted hover:text-ink">
            <Undo2 size={11} strokeWidth={2.25} aria-hidden="true" />
            Back to cost + margin
          </button>
        </div>
      ) : null}
      {open ? (
        <ul className="mt-1.5 space-y-0.5 pl-14 text-[11px] leading-4 text-muted">
          {row.jobWide
            ? owned.map((line) => (
                <li key={line.key} className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate">{line.description}</span>
                  <span className="font-mono">{formatCents(line.totalCents)}</span>
                </li>
              ))
            : pieces.map((part) => (
                <li key={part.id} className="flex gap-2">
                  <span className="min-w-0 flex-1 truncate">{part.name}</span>
                  <span className="font-mono text-subtle">
                    {Math.round(part.width)}×{Math.round(part.height)}×{Math.round(part.shape === "cylinder" ? part.width : part.depth)}
                  </span>
                </li>
              ))}
        </ul>
      ) : null}
    </li>
  );
}

function saveQuote(change: Partial<QuoteMeta>) {
  const current = getCosting();
  setCosting({ ...current, quote: { ...current.quote, ...change } });
}

/** What the client receives: one row per item, one installation row, and the two actions on it. */
export function QuoteSections({
  rows,
  document,
  lines,
  quote,
  jobTitle,
  onPreview,
  onDownload,
  downloading,
}: {
  rows: QuoteSection[];
  document: DesignDocument;
  lines: CostLine[];
  quote: QuoteMeta;
  jobTitle: string;
  onPreview: () => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  const [issued, setIssued] = useState<IssuedQuote[]>([]);
  const projectId = getActiveProjectId();
  const totals = quoteTotals(rows, quote.vatPercent);
  const ready = rows.some((row) => row.sellCents > 0);

  useEffect(() => {
    if (!projectId) return;
    let live = true;
    const load = () => void listQuotes(projectId).then((quotes) => live && setIssued(quotes));
    load();
    const stop = subscribeQuotes(load);
    return () => {
      live = false;
      stop();
    };
  }, [projectId]);

  async function changeStatus(id: string, status: string) {
    setIssued((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
    await setQuoteStatus(id, status);
  }

  return (
    <section aria-labelledby="quotation-title" className="border-b border-line px-5 pt-4 pb-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="quotation-title" className="text-[13px] font-medium">Quotation</h3>
        <span className="text-[11px] text-subtle">What the client sees</span>
      </div>

      <ul className="mt-2 divide-y divide-line border-y border-line">
        {rows.map((row, index) => (
          <Row key={row.id} rows={rows} index={index} document={document} lines={lines} />
        ))}
      </ul>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" onClick={onPreview} disabled={!ready} className="btn btn-secondary py-2 text-xs">
          <Eye size={13} strokeWidth={2.25} aria-hidden="true" />
          Preview
        </button>
        <button type="button" onClick={onDownload} disabled={!ready || downloading} className="btn btn-primary py-2 text-xs">
          {downloading ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Download size={13} strokeWidth={2.25} aria-hidden="true" />}
          {downloading ? "Preparing…" : "Download PDF"}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-subtle">
        {quote.vatPercent > 0 ? `Client pays ${formatCents(totals.grandTotalCents)} with ${quote.vatPercent}% VAT. ` : ""}
        {issued.length > 0 ? `Downloading again saves ${issued[0].ref} rev ${issued[0].revision + 1}.` : "The download gets the next quotation number and is kept on this job."}
      </p>
      <details className="group mt-3">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] text-muted hover:text-ink">
          <ChevronRight size={12} strokeWidth={2.25} aria-hidden="true" className="transition-transform group-open:rotate-90" />
          Title, attention, VAT, notes
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="col-span-2 text-[11px] text-muted">
            Title
            <input value={quote.title} onChange={(event) => saveQuote({ title: event.target.value })} placeholder={jobTitle} className="field mt-1 py-1.5 text-[13px]" />
          </label>
          <label className="text-[11px] text-muted">
            Attention
            <input value={quote.attention} onChange={(event) => saveQuote({ attention: event.target.value })} className="field mt-1 py-1.5 text-[13px]" />
          </label>
          <label className="text-[11px] text-muted">
            VAT %
            <input type="number" min={0} max={100} value={quote.vatPercent} onChange={(event) => saveQuote({ vatPercent: Number(event.target.value) })} className="field mt-1 py-1.5 text-[13px]" />
          </label>
          <label className="col-span-2 text-[11px] text-muted">
            Notes
            <textarea value={quote.notes} onChange={(event) => saveQuote({ notes: event.target.value })} rows={2} className="field mt-1 py-1.5 text-[13px]" />
          </label>
        </div>
      </details>

      {issued.length > 0 ? (
        <div className="mt-4">
          <p className="text-[11px] text-subtle">Sent quotations</p>
          <ul className="mt-1 space-y-1">
            {issued.map((item) => (
              <li key={item.id} className="flex items-center gap-2 text-[12px]">
                <span className="font-mono">
                  {item.ref}
                  {item.revision > 1 ? ` rev ${item.revision}` : ""}
                </span>
                <span className="text-muted">{formatCents(item.grand_total_cents)}</span>
                <select
                  aria-label={`Status of ${item.ref}`}
                  value={item.status}
                  onChange={(event) => void changeStatus(item.id, event.target.value)}
                  className="ml-auto rounded-md border border-line bg-bg px-1.5 py-0.5 text-[11px] capitalize"
                >
                  {QUOTE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
