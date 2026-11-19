"use client";

import { AlertTriangle, Plus, RotateCcw, Trash, Undo2 } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { SelectField } from "@/components/workspace/fields";
import { CUTTERS, cutterGap, defaultCutter, defaultEdgeMargin, defaultGrain } from "@/lib/production/cutting";
import { formatCents, formatQuantity } from "@/lib/format";
import { getBooth, getServerBooth, subscribeBooth } from "@/lib/studio/local-booth";
import { getPriceBook, getServerPriceBook, resetPriceBook, setPriceBook, subscribePriceBook } from "@/lib/studio/price-book";
import {
  boardAreaM2,
  DEFAULT_BOARD,
  defaultShopRules,
  estimateMaterials,
  PIECE_MATERIALS,
  pricePerM2Cents,
  systemPriceItems,
  THIN_PIECE_MM,
  type PriceItem,
  type PricedMaterial,
  type ShopRules,
} from "@/lib/systems/materials";
import { bookForJob } from "@/lib/systems/modular/job-materials";
import { QUOTE_GROUP_LABEL, QUOTE_GROUPS } from "@/lib/systems/types";
import type { PartMaterial } from "@/lib/systems/modular/schema";

const SYSTEM_ITEMS = systemPriceItems();

function unitLabel(unit: string) {
  if (unit === "m2") return "m²";
  if (unit === "each") return "each";
  return unit;
}

export function MaterialsSettings() {
  const book = useSyncExternalStore(subscribePriceBook, getPriceBook, getServerPriceBook);
  const design = useSyncExternalStore(subscribeBooth, getBooth, getServerBooth);
  const estimate = useMemo(() => estimateMaterials(design.parts, bookForJob(book, design)), [design, book]);
  const [confirmReset, setConfirmReset] = useState(false);

  function saveMaterials(materials: PricedMaterial[]) {
    setPriceBook({ ...book, materials });
  }

  function change(id: string, changes: Partial<PricedMaterial>) {
    saveMaterials(book.materials.map((material) => (material.id === id ? { ...material, ...changes } : material)));
  }

  function setPiece(id: string, piece: PartMaterial | null) {
    saveMaterials(book.materials.map((material) => (material.id === id ? { ...material, piece } : material)));
  }

  function add() {
    saveMaterials([
      ...book.materials,
      {
        id: `custom-${Date.now().toString(36)}`,
        name: "New material",
        piece: null,
        unit: "board",
        priceCents: 5000,
        boardWidthMm: DEFAULT_BOARD.width,
        boardHeightMm: DEFAULT_BOARD.height,
        wastePercent: 10,
      },
    ]);
  }

  function saveItems(items: PriceItem[]) {
    setPriceBook({ ...book, items });
  }

  function changeItem(id: string, changes: Partial<PriceItem>) {
    saveItems(book.items.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }

  function addItem() {
    saveItems([...book.items, { id: `item-${Date.now().toString(36)}`, name: "New item", group: "other", unit: "each", priceCents: 0 }]);
  }

  function saveRules(changes: Partial<ShopRules>) {
    setPriceBook({ ...book, rules: { ...book.rules, ...changes } });
  }

  function setSystemPrice(sku: string, cents: number, defaultCents: number) {
    const catalog = { ...book.catalog };
    if (cents === defaultCents) delete catalog[sku];
    else catalog[sku] = cents;
    setPriceBook({ ...book, catalog });
  }

  const usedTotal = estimate.usage.reduce((sum, usage) => sum + usage.totalCents, 0);

  return (
    <div className="mx-auto max-w-3xl px-8 pt-10 pb-20">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Materials</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
          What you pay for the materials you build with. Every cost, board count, and quotation in the studio is worked out from these prices. Change them whenever your supplier changes.
        </p>
      </header>

      <section aria-labelledby="usage-title" className="mt-8 overflow-hidden rounded-2xl border border-line bg-panel shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h3 id="usage-title" className="text-sm font-semibold">
              Your current design
            </h3>
            <p className="mt-1 text-xs leading-5 text-muted">Boards and sheets the custom pieces need at today&apos;s prices, offcuts included.</p>
          </div>
          {estimate.usage.length > 0 ? <p className="font-mono text-lg font-medium text-accent">{formatCents(usedTotal)}</p> : null}
        </div>
        {estimate.usage.length === 0 && estimate.unpriced.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">Nothing drawn yet. Add pieces in the studio and the boards they need will show up here.</p>
        ) : (
          <ul className="divide-y divide-line">
            {estimate.usage.map((usage) => (
              <li key={usage.materialId} className="flex items-center gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{usage.name}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {usage.pieces} {usage.pieces === 1 ? "piece" : "pieces"} · {usage.areaM2.toFixed(2)} m² of material, {usage.buyM2.toFixed(2)} m² to buy
                  </p>
                  {usage.oversize.length > 0 ? (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-danger">
                      <AlertTriangle size={12} aria-hidden="true" />
                      {usage.oversize.length === 1 ? `${usage.oversize[0]} is` : `${usage.oversize.length} pieces are`} bigger than a {usage.boardSize} board and will need joining.
                    </p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="font-mono text-[13px] font-medium">
                    {formatQuantity(usage.quantity)} {usage.unit === "board" ? (usage.quantity === 1 ? "board" : "boards") : "m²"}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted">{formatCents(usage.totalCents)}</p>
                </div>
              </li>
            ))}
            {estimate.unpriced.length > 0 ? (
              <li className="flex items-start gap-2.5 bg-raised/60 px-5 py-3 text-xs leading-5 text-muted">
                <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
                {estimate.unpriced.length} {estimate.unpriced.length === 1 ? "piece uses" : "pieces use"} a material with no price, so {estimate.unpriced.length === 1 ? "it is" : "they are"} not in this total. Pick the piece material under “Used for” on a material below.
              </li>
            ) : null}
          </ul>
        )}
      </section>

      <section aria-labelledby="boards-title" className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 id="boards-title" className="text-sm font-semibold">
              Boards and sheets
            </h3>
            <p className="mt-1 max-w-lg text-xs leading-5 text-muted">
              Add one row per sheet size. Two rows can be the same material — a 1 × 1 m paint board and a 2 × 2 m paint board. The cutting plan fills the largest sheet first, and uses a smaller sheet only for the leftover that fits on it. A piece up to {THIN_PIECE_MM} mm thick counts as one flat panel. A thicker piece is built as a hollow box, so every face counts. The offcut % is used when you buy by the square meter.
            </p>
          </div>
          <button type="button" onClick={add} className="btn btn-secondary shrink-0 px-3 py-2 text-xs">
            <Plus size={14} strokeWidth={2.25} aria-hidden="true" />
            Add material
          </button>
        </div>

        <ul className="mt-4 space-y-3">
          {book.materials.map((material) => (
            <li key={material.id} className="rounded-2xl border border-line bg-panel p-4 shadow-soft">
              <div className="flex items-end gap-3">
                <label className="min-w-0 flex-1">
                  <span className="eyebrow">Name</span>
                  <input
                    key={`${material.id}:${material.name}`}
                    defaultValue={material.name}
                    maxLength={80}
                    onBlur={(event) => {
                      const name = event.currentTarget.value.trim();
                      if (name && name !== material.name) change(material.id, { name });
                      else event.currentTarget.value = material.name;
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    className="field mt-1.5 font-medium"
                  />
                </label>
                <label className="block w-44 shrink-0">
                  <span className="eyebrow">Used for pieces made of</span>
                  <div className="mt-1.5">
                    <SelectField
                      aria-label={`Piece material priced by ${material.name}`}
                      value={material.piece ?? ""}
                      onChange={(event) => setPiece(material.id, (event.target.value || null) as PartMaterial | null)}
                    >
                      <option value="">Not used yet</option>
                      {PIECE_MATERIALS.map((piece) => (
                        <option key={piece.id} value={piece.id}>
                          {piece.label}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                </label>
                <button
                  type="button"
                  title={`Delete ${material.name}`}
                  aria-label={`Delete ${material.name}`}
                  onClick={() => saveMaterials(book.materials.filter((item) => item.id !== material.id))}
                  className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-danger-soft hover:text-danger"
                >
                  <Trash size={15} strokeWidth={1.9} aria-hidden="true" />
                </button>
              </div>

              <div className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-[auto_1fr_1fr_1fr_1fr_1fr]">
                <div>
                  <span className="eyebrow">Sold by</span>
                  <div role="group" aria-label="Sold by" className="mt-1.5 inline-flex h-[38px] rounded-[10px] border border-line bg-panel p-0.5 shadow-soft">
                    {(["board", "m2"] as const).map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        aria-pressed={material.unit === unit}
                        onClick={() => change(material.id, { unit })}
                        className={`rounded-lg px-3 text-xs font-semibold transition-colors ${material.unit === unit ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}
                      >
                        {unit === "board" ? "Board" : "m²"}
                      </button>
                    ))}
                  </div>
                </div>
                {material.unit === "board" ? (
                  <>
                    <Num label="Width" suffix="mm" value={material.boardWidthMm ?? DEFAULT_BOARD.width} decimals={0} allowZero={false} onCommit={(boardWidthMm) => change(material.id, { boardWidthMm })} />
                    <Num label="Height" suffix="mm" value={material.boardHeightMm ?? DEFAULT_BOARD.height} decimals={0} allowZero={false} onCommit={(boardHeightMm) => change(material.id, { boardHeightMm })} />
                  </>
                ) : (
                  <div className="col-span-2 hidden self-end pb-2.5 text-xs text-muted sm:block">Bought by the square meter, so there is no board size.</div>
                )}
                <Num label="Thickness" suffix="mm" value={material.thicknessMm ?? 0} decimals={1} onCommit={(thicknessMm) => change(material.id, thicknessMm > 0 ? { thicknessMm } : { thicknessMm: undefined })} />
                <Num
                  label={material.unit === "board" ? "Price per board" : "Price per m²"}
                  prefix="$"
                  value={material.priceCents / 100}
                  step={1}
                  onCommit={(price) => change(material.id, { priceCents: Math.round(price * 100) })}
                />
                <Num label="Offcuts" suffix="%" value={material.wastePercent} decimals={1} onCommit={(wastePercent) => change(material.id, { wastePercent: Math.min(100, wastePercent) })} />
              </div>

              {material.unit === "board" ? (
                <div className="mt-3 flex items-center gap-2">
                  <span className="eyebrow">Cut by</span>
                  <div role="group" aria-label="Cut by" className="inline-flex h-[30px] rounded-[10px] border border-line bg-panel p-0.5 shadow-soft">
                    {CUTTERS.map((cutter) => {
                      const active = (material.cutter ?? defaultCutter(material)) === cutter;
                      return (
                        <button
                          key={cutter}
                          type="button"
                          aria-pressed={active}
                          onClick={() => change(material.id, { cutter })}
                          className={`rounded-lg px-3 text-xs font-semibold transition-colors ${active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}
                        >
                          {cutter === "saw" ? "Saw" : cutter === "laser" ? "Laser" : "CNC"}
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-[11px] text-subtle">{(material.cutter ?? defaultCutter(material)) === "saw"
                      ? "Pieces sit a blade apart."
                      : `Pieces sit ${cutterGap(material.cutter ?? defaultCutter(material), material.piece ?? "paint", material.thicknessMm ?? 3, 0)} mm apart.`}</span>
                </div>
              ) : null}
              {material.unit === "board" ? (
                <div className="mt-3 flex flex-wrap items-end gap-4">
                  <div className="w-36">
                    <Num
                      label="Edge margin"
                      suffix="mm"
                      value={material.edgeMarginMm ?? defaultEdgeMargin(material.cutter ?? defaultCutter(material))}
                      decimals={0}
                      onCommit={(edgeMarginMm) => change(material.id, { edgeMarginMm: Math.min(100, edgeMarginMm) })}
                    />
                  </div>
                  <div className="flex items-center gap-2 pb-1.5">
                    <span className="eyebrow">Grain</span>
                    <div role="group" aria-label="Grain" className="inline-flex h-[30px] rounded-[10px] border border-line bg-panel p-0.5 shadow-soft">
                      {[false, true].map((grain) => {
                        const active = (material.grain ?? defaultGrain(material)) === grain;
                        return (
                          <button
                            key={String(grain)}
                            type="button"
                            aria-pressed={active}
                            onClick={() => change(material.id, { grain })}
                            className={`rounded-lg px-3 text-xs font-semibold transition-colors ${active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}
                          >
                            {grain ? "One way" : "None"}
                          </button>
                        );
                      })}
                    </div>
                    <span className="text-[11px] text-subtle">
                      {(material.grain ?? defaultGrain(material)) ? "Pieces keep the sheet's grain along their width and only turn half a turn." : "Pieces may turn any way to fit."}
                    </span>
                  </div>
                </div>
              ) : null}

              <p className="mt-3 font-mono text-[11px] text-subtle">
                {formatCents(pricePerM2Cents(material))} per m²
                {material.unit === "board" ? ` · ${boardAreaM2(material).toFixed(2)} m² per board` : ""}
              </p>
            </li>
          ))}
          {book.materials.length === 0 ? (
            <li className="rounded-2xl border border-dashed border-line-strong px-6 py-8 text-center text-sm text-muted">No materials yet. Add one, or reset to the starting list.</li>
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="system-title" className="mt-12">
        <h3 id="system-title" className="text-sm font-semibold">
          Stand system items
        </h3>
        <p className="mt-1 max-w-lg text-xs leading-5 text-muted">Frame, panels, print, flooring, lighting, and labor for modular booths. Quantities come from the design. You only set the price.</p>
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel shadow-soft">
          {SYSTEM_ITEMS.map((item) => {
            const edited = book.catalog[item.sku] !== undefined;
            const cents = book.catalog[item.sku] ?? item.unitCostCents;
            return (
              <li key={item.sku} className="flex items-center gap-4 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{item.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted">
                    {item.sku} · per {unitLabel(item.unit)}
                  </p>
                </div>
                {edited ? (
                  <button
                    type="button"
                    title={`Back to ${formatCents(item.unitCostCents)}`}
                    aria-label={`Use the starting price for ${item.name}`}
                    onClick={() => setSystemPrice(item.sku, item.unitCostCents, item.unitCostCents)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-raised hover:text-ink"
                  >
                    <Undo2 size={14} strokeWidth={2} aria-hidden="true" />
                  </button>
                ) : null}
                <div className="w-36 shrink-0">
                  <Num label={`${item.name} price`} hideLabel prefix="$" suffix={`/ ${unitLabel(item.unit)}`} value={cents / 100} onCommit={(price) => setSystemPrice(item.sku, Math.round(price * 100), item.unitCostCents)} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="items-title" className="mt-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 id="items-title" className="text-sm font-semibold">
              Other items
            </h3>
            <p className="mt-1 max-w-lg text-xs leading-5 text-muted">
              Screws, glue, paint, cable, labor hours, transport: the small things every job buys. The cost check in the studio uses these first, and suggests new ones when something is missing. Items you save from a job show up here.
            </p>
          </div>
          <button type="button" onClick={addItem} className="btn btn-secondary shrink-0 px-3 py-2 text-xs">
            <Plus size={14} strokeWidth={2.25} aria-hidden="true" />
            Add item
          </button>
        </div>
        <ul className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel shadow-soft">
          {book.items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-4 py-3">
              <input
                key={`${item.id}:${item.name}`}
                aria-label="Item name"
                defaultValue={item.name}
                maxLength={100}
                onBlur={(event) => {
                  const name = event.currentTarget.value.trim();
                  if (name && name !== item.name) changeItem(item.id, { name });
                  else event.currentTarget.value = item.name;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="field min-w-0 flex-1 py-2 text-[13px] font-medium"
              />
              <div className="w-40 shrink-0">
                <SelectField compact aria-label={`Group for ${item.name}`} value={item.group} onChange={(event) => changeItem(item.id, { group: event.target.value as PriceItem["group"] })}>
                  {QUOTE_GROUPS.map((group) => (
                    <option key={group} value={group}>
                      {QUOTE_GROUP_LABEL[group]}
                    </option>
                  ))}
                </SelectField>
              </div>
              <input
                key={`${item.id}:unit:${item.unit}`}
                aria-label={`Unit for ${item.name}`}
                defaultValue={item.unit}
                maxLength={20}
                onBlur={(event) => {
                  const unit = event.currentTarget.value.trim();
                  if (unit && unit !== item.unit) changeItem(item.id, { unit });
                  else event.currentTarget.value = item.unit;
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                className="field w-20 shrink-0 py-2 text-xs"
              />
              <div className="w-28 shrink-0">
                <Num label={`${item.name} price`} hideLabel prefix="$" value={item.priceCents / 100} onCommit={(price) => changeItem(item.id, { priceCents: Math.round(price * 100) })} />
              </div>
              <button
                type="button"
                title={`Delete ${item.name}`}
                aria-label={`Delete ${item.name}`}
                onClick={() => saveItems(book.items.filter((other) => other.id !== item.id))}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-subtle transition-colors hover:bg-danger-soft hover:text-danger"
              >
                <Trash size={15} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </li>
          ))}
          {book.items.length === 0 ? <li className="px-6 py-8 text-center text-sm text-muted">No items yet. Add one, or let the cost check suggest them.</li> : null}
        </ul>
      </section>

      <section aria-labelledby="rules-title" className="mt-12">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h3 id="rules-title" className="text-sm font-semibold">
              Finishing rules
            </h3>
            <p className="mt-1 max-w-lg text-xs leading-5 text-muted">
              How the workshop finishes what it builds. The cost counts edge banding, filler, primer, and paint from the pieces using these.
            </p>
          </div>
          <button type="button" onClick={() => setPriceBook({ ...book, rules: defaultShopRules() })} className="btn btn-ghost shrink-0 px-3 py-2 text-xs">
            Reset to defaults
          </button>
        </div>

        <div className="mt-4 space-y-5 rounded-2xl border border-line bg-panel p-4 shadow-soft">
          <div>
            <Segmented
              label="Painted MDF, straight edges"
              value={book.rules.paintedEdges}
              options={[
                { value: "banding", label: "Edge banding" },
                { value: "filler", label: "Fill and seal" },
              ]}
              onChange={(paintedEdges) => saveRules({ paintedEdges })}
            />
            <p className="mt-1.5 text-xs leading-5 text-muted">Curved and routed edges are always filled.</p>
          </div>
          <Segmented
            label="Raw MDF, plywood, and laminate edges"
            value={book.rules.rawEdges}
            options={[
              { value: "banding", label: "Edge banding" },
              { value: "none", label: "Left raw" },
            ]}
            onChange={(rawEdges) => saveRules({ rawEdges })}
          />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Num
              label="Banding allowance per edge end"
              suffix="mm"
              value={book.rules.edgeAllowanceMm}
              decimals={0}
              onCommit={(edgeAllowanceMm) => saveRules({ edgeAllowanceMm: Math.min(500, Math.round(edgeAllowanceMm)) })}
            />
            <Num
              label="Banding waste"
              suffix="%"
              value={book.rules.edgeWastePercent}
              decimals={1}
              onCommit={(edgeWastePercent) => saveRules({ edgeWastePercent: Math.min(100, edgeWastePercent) })}
            />
            <Num label="Primer coats" value={book.rules.primerCoats} decimals={0} onCommit={(primerCoats) => saveRules({ primerCoats: Math.min(6, Math.round(primerCoats)) })} />
            <Num label="Paint coats" value={book.rules.topCoats} decimals={0} onCommit={(topCoats) => saveRules({ topCoats: Math.min(6, Math.round(topCoats)) })} />
            <Num
              label="Coverage, m² per liter per coat"
              value={book.rules.coverageM2PerLiter}
              allowZero={false}
              decimals={1}
              onCommit={(coverageM2PerLiter) => saveRules({ coverageM2PerLiter: Math.min(100, coverageM2PerLiter) })}
            />
            <Num
              label="Spray loss"
              suffix="%"
              value={book.rules.sprayWastePercent}
              decimals={1}
              onCommit={(sprayWastePercent) => saveRules({ sprayWastePercent: Math.min(200, sprayWastePercent) })}
            />
          </div>
        </div>
      </section>

      <footer className="mt-12 flex items-center justify-between gap-4 border-t border-line pt-6">
        <p className="max-w-sm text-xs leading-5 text-muted">Prices are placeholders until you enter yours. They are used straight away in the studio, the quotation, and the manufacturing package.</p>
        {confirmReset ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary px-3 py-2 text-xs"
              onClick={() => setConfirmReset(false)}
            >
              Keep my prices
            </button>
            <button
              type="button"
              className="btn border border-danger/25 bg-danger-soft px-3 py-2 text-xs text-danger hover:bg-danger/10"
              onClick={() => {
                resetPriceBook();
                setConfirmReset(false);
              }}
            >
              Reset everything
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost px-3 py-2 text-xs" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={13} strokeWidth={2.25} aria-hidden="true" />
            Reset to starting prices
          </button>
        )}
      </footer>
    </div>
  );
}

/** Two-way choice, styled like the “Sold by” switch on a board. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <span className="eyebrow">{label}</span>
      <div role="group" aria-label={label} className="mt-1.5 inline-flex h-[38px] rounded-[10px] border border-line bg-panel p-0.5 shadow-soft">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-lg px-3 text-xs font-semibold transition-colors ${value === option.value ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A number box that saves on Enter or blur. ↑ and ↓ nudge it. Esc puts the old value back. */
function Num({
  label,
  value,
  onCommit,
  prefix,
  suffix,
  decimals = 2,
  step = 1,
  allowZero = true,
  hideLabel = false,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  step?: number;
  allowZero?: boolean;
  hideLabel?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const factor = 10 ** decimals;
  const shown = draft ?? String(Math.round(value * factor) / factor);

  function accepts(next: number) {
    return Number.isFinite(next) && (allowZero ? next >= 0 : next > 0);
  }

  function commit(raw: string) {
    setDraft(null);
    const next = Number(raw);
    if (accepts(next) && next !== value) onCommit(next);
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
      if (accepts(next)) onCommit(Math.round(next * factor) / factor);
    }
  }

  return (
    <label className="block">
      <span className={hideLabel ? "sr-only" : "eyebrow"}>{label}</span>
      <span className={`relative block ${hideLabel ? "" : "mt-1.5"}`}>
        {prefix ? <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs font-semibold text-subtle">{prefix}</span> : null}
        <input
          value={shown}
          inputMode="decimal"
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => {
            if (draft !== null) commit(event.currentTarget.value);
          }}
          onKeyDown={onKeyDown}
          className={`field py-2 font-mono text-[13px] ${prefix ? "pl-6" : "pl-2.5"} ${suffix ? (suffix.length > 3 ? "pr-12" : "pr-8") : "pr-2.5"}`}
        />
        {suffix ? <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-subtle">{suffix}</span> : null}
      </span>
    </label>
  );
}
