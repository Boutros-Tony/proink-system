"use client";

import {
  BookmarkPlus,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { SelectField } from "@/components/workspace/fields";
import { dataRefs } from "@/lib/ai/cost-review";
import { formatCents, formatQuantity } from "@/lib/format";
import { recordSpend } from "@/lib/studio/ai-spend";
import { getCosting, setCosting } from "@/lib/studio/costing";
import { getStudioSettings } from "@/lib/studio/local-booth";
import { setPriceBook } from "@/lib/studio/price-book";
import { seedCatalog } from "@/lib/systems/catalog";
import {
  addExtras,
  designKey,
  extraKey,
  newExtraId,
  removeExtra,
  reviewSchema,
  setOverride,
  type CostLine,
  type CostedJob,
  type Costing,
  type ExtraLine,
  type LineOverride,
} from "@/lib/systems/costing";
import { applyPriceBook, type PriceBook } from "@/lib/systems/materials";
import type { DesignDocument } from "@/lib/systems/modular/schema";
import { clientSections, quoteTotals } from "@/lib/systems/sections";
import { QUOTE_GROUP_LABEL, type QuoteGroup } from "@/lib/systems/types";
import { QuoteSections } from "@/components/workspace/quote-sections";

function unitLabel(unit: string) {
  return unit === "m2" ? "m²" : unit;
}

function patch(change: (costing: Costing) => Costing) {
  setCosting(change(getCosting()));
}

/** A number box that saves on Enter or blur. Esc puts the old value back, and ↑ ↓ step it. */
function Cell({
  label,
  value,
  onCommit,
  prefix,
  suffix,
  decimals = 2,
  step = 1,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const factor = 10 ** decimals;
  const rounded = (input: number) => Math.round(input * factor) / factor;
  const shown = draft ?? String(rounded(value));

  function commit(raw: string) {
    setDraft(null);
    const next = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(next) || next < 0) return;
    if (rounded(next) !== rounded(value)) onCommit(rounded(next));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      setDraft(null);
      event.currentTarget.blur();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const size = event.shiftKey ? step * 10 : step;
      const next = Number(event.currentTarget.value) + (event.key === "ArrowUp" ? size : -size);
      setDraft(null);
      if (next >= 0) onCommit(rounded(next));
    }
  }

  return (
    <span className="relative block">
      {prefix ? <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-xs font-semibold text-subtle">{prefix}</span> : null}
      <input
        aria-label={label}
        value={shown}
        inputMode="decimal"
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => {
          if (draft !== null) commit(event.currentTarget.value);
        }}
        onKeyDown={onKeyDown}
        className={`field py-2 font-mono text-[13px] ${prefix ? "pl-6" : "pl-3"} ${suffix ? "pr-12" : "pr-3"}`}
      />
      {suffix ? <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 max-w-10 -translate-y-1/2 truncate text-[11px] text-subtle">{suffix}</span> : null}
    </span>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function QuantityAndPrice({
  name,
  quantity,
  unit,
  unitCents,
  onQuantity,
  onPrice,
}: {
  name: string;
  quantity: number;
  unit: string;
  unitCents: number;
  onQuantity: (value: number) => void;
  onPrice: (cents: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      <Field label="Quantity">
        <Cell label={`${name}, quantity`} value={quantity} onCommit={onQuantity} suffix={unitLabel(unit)} />
      </Field>
      <Field label={`Price per ${unitLabel(unit)}`}>
        <Cell label={`${name}, price per ${unitLabel(unit)}`} value={unitCents / 100} prefix="$" onCommit={(value) => onPrice(Math.round(value * 100))} />
      </Field>
    </div>
  );
}

type Tag = { text: string; tone: "accent" | "amber" | "red" | "green" | "plain" };

const TAG_TONE: Record<Tag["tone"], string> = {
  accent: "text-accent",
  amber: "text-warn",
  red: "text-danger",
  green: "text-success",
  plain: "text-subtle",
};

function extraTag(line: Pick<ExtraLine, "source" | "unitCents" | "reason">): Tag | null {
  if (line.unitCents === 0) return { text: "Set a price", tone: "red" };
  if (line.source === "new") return { text: "AI estimate", tone: "amber" };
  if (line.source === "manual") return { text: "Added by hand", tone: "plain" };
  if (line.reason) return { text: "Suggested", tone: "plain" };
  return null;
}

function Meta({ quantity, unit, unitCents, tags }: { quantity: number; unit: string; unitCents: number; tags: Tag[] }) {
  return (
    <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] leading-4 text-muted">
      <span className="font-mono">
        {formatQuantity(quantity)} {unitLabel(unit)} × {formatCents(unitCents)}
      </span>
      {tags.map((tag) => (
        <span key={tag.text} className={`font-medium ${TAG_TONE[tag.tone]}`}>
          · {tag.text}
        </span>
      ))}
    </span>
  );
}

function TextAction({ icon, label, onClick, tone = "plain", disabled = false, title }: { icon: ReactNode; label: string; onClick: () => void; tone?: "plain" | "danger" | "accent"; disabled?: boolean; title?: string }) {
  const color = tone === "danger" ? "text-danger hover:bg-danger-soft" : tone === "accent" ? "text-accent hover:bg-accent-soft" : "text-muted hover:bg-raised hover:text-ink";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${color}`}
    >
      {icon}
      {label}
    </button>
  );
}

export function CostPanel({
  document,
  costed,
  costing,
  priceBook,
  marginPercent,
  onMargin,
  jobTitle,
  onPreview,
  onDownload,
  downloading,
}: {
  document: DesignDocument;
  costed: CostedJob;
  costing: Costing;
  priceBook: PriceBook;
  marginPercent: number;
  onMargin: (value: number) => void;
  jobTitle: string;
  onPreview: () => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ ids: string[]; cents: number } | null>(null);
  // One row is open for editing at a time.
  const [open, setOpen] = useState<string | null>(null);

  const refs = useMemo(() => dataRefs(priceBook, applyPriceBook(seedCatalog(), priceBook)), [priceBook]);
  const rows = useMemo(() => clientSections(document, costed.lines, marginPercent, costing.quote, costing.sections), [document, costed.lines, marginPercent, costing.quote, costing.sections]);
  const review = costing.review;
  const currentKey = useMemo(() => designKey(document), [document]);
  const stale = review !== null && review.designKey !== currentKey;
  const empty = document.parts.length === 0 && document.walls.every((wall) => wall.bays.length === 0);
  const edits = Object.keys(costing.overrides).length;
  const clientCents = quoteTotals(rows, costing.quote.vatPercent).sellCents;
  const marginCents = clientCents - costed.subtotalCents;
  const leftOver = review?.suggestions ?? [];

  function toggle(key: string) {
    setOpen((current) => (current === key ? null : key));
  }

  /** Ask the AI what the job is missing. What it finds goes straight into the costs, with one Undo. */
  async function runReview() {
    setError(null);
    setAdded(null);
    setReviewing(true);
    try {
      const settings = getStudioSettings();
      const response = await fetch("/api/cost-review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document, priceBook, costing, provider: settings.provider, model: settings.model }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      recordSpend(payload);
      if (!response.ok || !payload) throw new Error(payload?.error ?? "The check failed.");
      const next = reviewSchema.safeParse({ ...payload, designKey: currentKey, at: Date.now(), model: settings.model });
      if (!next.success) throw new Error("The estimator returned something unreadable. Try again.");
      const before = getCosting();
      const after = addExtras({ ...before, review: { ...next.data, suggestions: [] } }, next.data.suggestions);
      const taken = after.extras.filter((extra) => !before.extras.some((item) => item.id === extra.id));
      setCosting(after);
      setAdded({ ids: taken.map((extra) => extra.id), cents: taken.reduce((sum, extra) => sum + Math.round(extra.quantity * extra.unitCents), 0) });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The check failed.");
    } finally {
      setReviewing(false);
    }
  }

  function undoAdded() {
    if (!added) return;
    const ids = new Set(added.ids);
    patch((current) => ({ ...current, extras: current.extras.filter((extra) => !ids.has(extra.id)) }));
    setAdded(null);
  }

  function takeLeftOver(add: boolean) {
    patch((current) => {
      if (!current.review) return current;
      const cleared = { ...current, review: { ...current.review, suggestions: [] } };
      return add ? addExtras(cleared, current.review.suggestions) : cleared;
    });
  }

  // --- Lines the design produces ---------------------------------------------------------------
  function editLine(line: CostLine, change: LineOverride) {
    patch((current) => setOverride(current, line, change));
  }

  function resetLine(line: CostLine) {
    patch((current) => {
      const overrides = { ...current.overrides };
      delete overrides[line.key];
      return { ...current, overrides };
    });
  }

  // --- Lines added to this job ---------------------------------------------------------------
  function updateExtra(id: string, change: Partial<ExtraLine>) {
    patch((current) => ({ ...current, extras: current.extras.map((extra) => (extra.id === id ? { ...extra, ...change } : extra)) }));
  }

  function dropExtra(id: string) {
    setOpen(null);
    patch((current) => removeExtra(current, id));
  }

  /** Keep a new item in the shop's prices, so the next job finds it there. */
  function saveToPrices(extra: ExtraLine) {
    const id = `item-${extra.id}`;
    setPriceBook({ ...priceBook, items: [...priceBook.items, { id, name: extra.description, group: extra.group, unit: extra.unit, priceCents: extra.unitCents }] });
    updateExtra(extra.id, { source: "data", ref: `item:${id}` });
  }

  function addBlank() {
    const id = newExtraId();
    patch((current) => ({
      ...current,
      extras: [...current.extras, { id, description: "New line", group: "other", quantity: 1, unit: "each", unitCents: 0, source: "manual" }],
    }));
    setOpen(extraKey(id));
  }

  function addFromPrices(ref: string) {
    const item = refs.find((candidate) => candidate.ref === ref);
    if (!item) return;
    const id = newExtraId();
    patch((current) => ({
      ...current,
      extras: [...current.extras, { id, description: item.name, group: item.group, quantity: 1, unit: item.unit, unitCents: item.unitCents, source: "data", ref: item.ref }],
    }));
    setOpen(extraKey(id));
  }

  // Group the lines under their headings. They arrive sorted by group.
  const groups: { group: QuoteGroup; lines: CostLine[] }[] = [];
  for (const line of costed.lines) {
    const last = groups[groups.length - 1];
    if (last && last.group === line.group) last.lines.push(line);
    else groups.push({ group: line.group, lines: [line] });
  }

  return (
    <div className="pb-10">
      {/* The client's price, with the cost and margin only the studio sees. */}
      <div className="sticky top-0 z-10 border-b border-line bg-panel/95 px-5 py-4 backdrop-blur">
        <p className="text-[11px] text-muted">Client price</p>
        <p className="mt-0.5 font-mono text-[28px] leading-tight font-medium tracking-tight">{formatCents(clientCents)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
          <span>
            Cost <span className="font-mono text-ink">{formatCents(costed.subtotalCents)}</span>
          </span>
          <label className="flex items-center gap-1" title="Added on top of the cost. It is not shown on the quotation.">
            Margin
            <input
              type="number"
              min={0}
              max={100}
              value={marginPercent}
              onChange={(event) => onMargin(Number(event.target.value))}
              aria-label="Margin percent"
              className="w-10 rounded-md border border-line bg-bg px-1 py-0.5 text-right font-mono text-ink outline-none focus:border-subtle"
            />
            %
            <span className="font-mono text-ink">{formatCents(marginCents)}</span>
          </label>
          <span className="text-subtle">Only you see these</span>
        </div>
      </div>

      <QuoteSections
        rows={rows}
        document={document}
        lines={costed.lines}
        quote={costing.quote}
        jobTitle={jobTitle}
        onPreview={onPreview}
        onDownload={onDownload}
        downloading={downloading}
      />

      <section aria-labelledby="costs-title" className="px-5 pt-5">
        <div className="flex items-center justify-between gap-2">
          <h3 id="costs-title" className="text-[13px] font-medium">Costs</h3>
          {edits > 0 ? (
            <TextAction icon={<Undo2 size={12} strokeWidth={2.25} aria-hidden="true" />} label={`Undo ${edits} ${edits === 1 ? "change" : "changes"}`} onClick={() => patch((current) => ({ ...current, overrides: {} }))} />
          ) : (
            <span className="text-[11px] text-subtle">Tap a line to change it</span>
          )}
        </div>

        {costed.lines.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-line-strong px-4 py-7 text-center text-[13px] text-muted">Nothing priced yet. Describe the job in the chat, or add a line below.</p>
        ) : (
          <div className="mt-2 space-y-4">
            {groups.map(({ group, lines }) => (
              <div key={group}>
                <div className="flex items-center justify-between py-1">
                  <p className="text-[11px] text-subtle">{QUOTE_GROUP_LABEL[group]}</p>
                  <p className="font-mono text-[11px] text-subtle">{formatCents(lines.reduce((sum, line) => sum + (line.excluded ? 0 : line.totalCents), 0))}</p>
                </div>
                <ul className="divide-y divide-line border-y border-line">
                  {lines.map((line) => {
                    const extra = line.origin === "extra" ? costing.extras.find((item) => extraKey(item.id) === line.key) : undefined;
                    const editing = open === line.key;
                    const tags: Tag[] = [];
                    if (line.excluded) tags.push({ text: "Left out", tone: "plain" });
                    if (line.priceEdited || line.quantityEdited) tags.push({ text: "Changed", tone: "accent" });
                    const tag = extra ? extraTag(extra) : null;
                    if (tag) tags.push(tag);
                    return (
                      <li key={line.key} className={editing ? "bg-raised/40" : ""}>
                        <div className="group flex items-start">
                          <button
                            type="button"
                            aria-expanded={editing}
                            onClick={() => toggle(line.key)}
                            className="flex min-w-0 flex-1 items-start gap-3 px-1 py-2.5 text-left transition-colors hover:bg-raised/50"
                          >
                            <span className="min-w-0 flex-1">
                              <span className={`block text-[13px] leading-5 ${line.excluded ? "text-subtle line-through" : "text-ink"}`}>{line.description}</span>
                              <Meta quantity={line.quantity} unit={line.unit} unitCents={line.unitCostCents} tags={tags} />
                            </span>
                            <span className={`font-mono text-[13px] ${line.excluded ? "text-subtle line-through" : "text-ink"}`}>{formatCents(line.totalCents)}</span>
                          </button>
                          {extra ? (
                            <button
                              type="button"
                              onClick={() => dropExtra(extra.id)}
                              aria-label={`Remove ${extra.description}`}
                              title="Remove"
                              className="mt-2 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle opacity-60 transition hover:bg-danger-soft hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
                            >
                              <X size={14} strokeWidth={2} aria-hidden="true" />
                            </button>
                          ) : null}
                        </div>
                        {editing ? (
                          <div className="space-y-3 px-1 pb-3">
                            {extra && extra.source !== "data" ? (
                              <Field label="Name">
                                <input
                                  key={`${extra.id}:${extra.description}`}
                                  defaultValue={extra.description}
                                  aria-label="Line name"
                                  maxLength={160}
                                  onBlur={(event) => {
                                    const description = event.currentTarget.value.trim();
                                    if (description && description !== extra.description) updateExtra(extra.id, { description });
                                    else event.currentTarget.value = extra.description;
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") event.currentTarget.blur();
                                  }}
                                  className="field py-2 text-[13px]"
                                />
                              </Field>
                            ) : null}
                            <QuantityAndPrice
                              name={line.description}
                              quantity={line.quantity}
                              unit={line.unit}
                              unitCents={line.unitCostCents}
                              onQuantity={(quantity) => (extra ? updateExtra(extra.id, { quantity }) : editLine(line, { quantity }))}
                              onPrice={(unitCents) => (extra ? updateExtra(extra.id, { unitCents }) : editLine(line, { unitCents }))}
                            />
                            {extra?.reason ? <p className="text-xs leading-5 text-muted">{extra.reason}</p> : null}
                            {line.priceEdited || line.quantityEdited ? (
                              <p className="text-[11px] leading-4 text-subtle">
                                Standard: {formatQuantity(line.baseQuantity)} {unitLabel(line.unit)} × {formatCents(line.baseUnitCents)}
                              </p>
                            ) : null}
                            <div className="-ml-2 flex flex-wrap items-center gap-x-0.5">
                              {line.priceEdited || line.quantityEdited ? (
                                <TextAction icon={<Undo2 size={13} strokeWidth={2} aria-hidden="true" />} label="Back to standard" onClick={() => resetLine(line)} />
                              ) : null}
                              {!extra ? (
                                <TextAction
                                  icon={line.excluded ? <Eye size={13} strokeWidth={2} aria-hidden="true" /> : <EyeOff size={13} strokeWidth={2} aria-hidden="true" />}
                                  label={line.excluded ? "Include" : "Leave out"}
                                  onClick={() => editLine(line, { excluded: !line.excluded })}
                                />
                              ) : null}
                              {extra && extra.source !== "data" ? (
                                <TextAction
                                  icon={<BookmarkPlus size={13} strokeWidth={2} aria-hidden="true" />}
                                  label="Save to my prices"
                                  tone="accent"
                                  disabled={extra.unitCents === 0}
                                  title={extra.unitCents === 0 ? "Set a price first" : "Keep this item and price in Settings so the next job finds it"}
                                  onClick={() => saveToPrices(extra)}
                                />
                              ) : null}
                              {extra ? <TextAction icon={<Trash2 size={13} strokeWidth={2} aria-hidden="true" />} label="Remove" tone="danger" onClick={() => dropExtra(extra.id)} /> : null}
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {costed.excludedCents > 0 ? <p className="mt-2 text-[11px] text-subtle">{formatCents(costed.excludedCents)} left out of this job</p> : null}

        {leftOver.length > 0 ? (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs">
            <span className="min-w-0 flex-1 text-muted">
              {leftOver.length} suggested {leftOver.length === 1 ? "cost" : "costs"} from an earlier check
            </span>
            <TextAction icon={<X size={12} strokeWidth={2.5} aria-hidden="true" />} label="Dismiss" onClick={() => takeLeftOver(false)} />
            <TextAction icon={<Plus size={12} strokeWidth={2.5} aria-hidden="true" />} label="Add" tone="accent" onClick={() => takeLeftOver(true)} />
          </div>
        ) : null}

        <div className="mt-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SelectField
              compact
              aria-label="Add a line from your prices"
              value=""
              onChange={(event) => {
                addFromPrices(event.target.value);
              }}
            >
              <option value="">Add from my prices…</option>
              <optgroup label="Stand system">
                {refs.filter((item) => item.ref.startsWith("catalog:")).map((item) => (
                  <option key={item.ref} value={item.ref}>{item.name}</option>
                ))}
              </optgroup>
              <optgroup label="Boards and sheets">
                {refs.filter((item) => item.ref.startsWith("material:")).map((item) => (
                  <option key={item.ref} value={item.ref}>{item.name}</option>
                ))}
              </optgroup>
              <optgroup label="Other items">
                {refs.filter((item) => item.ref.startsWith("item:")).map((item) => (
                  <option key={item.ref} value={item.ref}>{item.name}</option>
                ))}
              </optgroup>
            </SelectField>
          </div>
          <button type="button" onClick={addBlank} className="btn btn-secondary shrink-0 px-3 py-1.5 text-xs">
            <Plus size={13} strokeWidth={2.5} aria-hidden="true" />
            Blank
          </button>
        </div>

        <button type="button" disabled={reviewing || empty} onClick={() => void runReview()} className="btn btn-secondary mt-2 w-full py-2 text-xs">
          {reviewing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Sparkles size={13} strokeWidth={2.25} aria-hidden="true" />}
          {reviewing ? "Checking the job…" : "Check for missing costs"}
        </button>
        {added ? (
          <p role="status" className="mt-2 flex items-center gap-2 text-[11px] text-muted">
            {added.ids.length > 0 ? (
              <>
                <span className="flex-1">
                  Added {added.ids.length} {added.ids.length === 1 ? "cost" : "costs"} · {formatCents(added.cents)}
                </span>
                <button type="button" onClick={undoAdded} className="flex items-center gap-1 font-medium text-ink hover:underline">
                  <Undo2 size={11} strokeWidth={2.25} aria-hidden="true" />
                  Undo
                </button>
              </>
            ) : (
              "Nothing missing."
            )}
          </p>
        ) : stale ? (
          <p className="mt-2 text-[11px] leading-4 text-warn">The job changed since the last check.</p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-2.5 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-xs leading-5 text-danger">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : null}
      </section>

      <p className="px-5 pt-6 text-[11px] leading-4 text-subtle">
        Changes are for this job only. Standing prices are in{" "}
        <Link href="/settings" className="font-medium text-accent hover:underline">Settings</Link>.
      </p>
    </div>
  );
}
