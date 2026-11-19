"use client";

import { X, Check, Download, Image as ImageIcon, ImagePlus, Loader2 } from "lucide-react";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { ImageRegion } from "@/lib/ai/image-edit";
import { Menu, useCloseMenu } from "@/components/workspace/menu";
import { formatCents } from "@/lib/format";
import { constraintNumber, findSku, LIMIT_DEFAULTS, seedCatalog, SKU } from "@/lib/systems/catalog";
import type { CostLine } from "@/lib/systems/costing";
import { QUOTATION_FOOTER, clientSections, quotationTerms, quoteTotals, sectionMark, sectionSizeText, type QuoteMeta, type QuoteSection } from "@/lib/systems/sections";
import type { CompiledModel } from "@/lib/systems/modular/compile";
import { assemblyNotes, planSvg, technicalSvg } from "@/lib/systems/modular/drawings";
import type { ProductionResult } from "@/lib/systems/modular/produce";
import type { DesignDocument } from "@/lib/systems/modular/schema";

export type DrawingSheet = "technical" | "notes" | "plan" | "panels" | "cuts" | "graphics";

const SHEETS: { id: DrawingSheet; label: string; booth?: boolean }[] = [
  { id: "technical", label: "Technical drawing" },
  { id: "notes", label: "Assembly" },
  { id: "plan", label: "Booth plan", booth: true },
  { id: "panels", label: "Booth panels", booth: true },
  { id: "cuts", label: "Frame profiles", booth: true },
  { id: "graphics", label: "Booth graphics", booth: true },
];

export function QuotePreview({
  title,
  clientName,
  document,
  sections,
  lines,
  quote,
  marginPercent,
  pending,
  onDownload,
  onClose,
}: {
  title: string;
  clientName: string;
  document: DesignDocument;
  sections: QuoteSection[];
  lines: CostLine[];
  quote: QuoteMeta;
  marginPercent: number;
  pending: boolean;
  onDownload: () => void;
  onClose: () => void;
}) {
  const priced = clientSections(document, lines, marginPercent, quote, sections);
  const totals = quoteTotals(priced, quote.vatPercent);
  const heading = quote.title.trim() || title;
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PreviewBar title="Quotation" detail={heading} onClose={onClose}>
        <button type="button" disabled={pending || priced.length === 0} onClick={onDownload} className="btn btn-primary px-3.5 py-2 text-xs">
          {pending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} strokeWidth={2.25} aria-hidden="true" />}
          {pending ? "Preparing PDF…" : "Download PDF"}
        </button>
      </PreviewBar>
      <div className="min-h-0 flex-1 overflow-auto bg-[#e7e5e0] p-6">
        <article className="mx-auto min-h-[900px] max-w-[780px] bg-white px-10 py-8 text-[#1a1814] shadow-float">
          <header className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="relative h-10 w-10" aria-hidden="true">
                <span className="absolute left-0 top-1 h-4 w-4 rounded-full bg-[#2f6fed]" />
                <span className="absolute left-3.5 top-0 h-3.5 w-3.5 rounded-full bg-[#f5a524]" />
                <span className="absolute bottom-0 left-1 h-4 w-4 rounded-full bg-[#1e4b9c]" />
                <span className="absolute right-0 bottom-1 h-3.5 w-3.5 rounded-full bg-[#e10600]" />
              </span>
              <span>
                <span className="block text-2xl font-semibold tracking-tight text-[#2c3a4a]">Proink</span>
                <span className="block text-[10px] tracking-wide text-[#8aa0b8]">Your Partner For Growth</span>
              </span>
            </div>
            <dl className="text-right text-xs">
              <div className="flex justify-end gap-4">
                <dt>Date:</dt>
                <dd>{new Date().toLocaleDateString("en-GB")}</dd>
              </div>
              <div className="mt-1 flex justify-end gap-4">
                <dt>Ref :</dt>
                <dd className="text-[#8a857c]">Given on download</dd>
              </div>
            </dl>
          </header>
          <h2 className="mt-6 text-center text-sm font-bold tracking-wide">QUOTATION</h2>
          <table className="mt-3 w-full border border-[#1a1814] text-sm">
            <tbody>
              <tr>
                <th className="w-28 px-2 py-1 text-left font-normal">Client Name</th>
                <td className="px-2 py-1 font-semibold">{clientName || "—"}</td>
              </tr>
              <tr>
                <th className="px-2 py-1 text-left font-normal">Attention</th>
                <td className="px-2 py-1 font-semibold">{quote.attention || "—"}</td>
              </tr>
              <tr>
                <th className="px-2 py-1 text-left font-normal">Title</th>
                <td className="px-2 py-1 font-semibold">{heading}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4 text-right text-xs font-medium text-[#e10600]">Selling Price</p>
          {priced.length === 0 ? (
            <p className="mt-8 text-sm text-muted">Build the quotation in Price first.</p>
          ) : (
            <div className="mt-6 space-y-5">
              {priced.map((section, index) => {
                const mark = sectionMark(priced, index);
                const size = section.jobWide ? "" : sectionSizeText(document, section.partIds);
                return (
                  <div key={section.id} className="grid grid-cols-[4.5rem_1fr_auto] items-baseline gap-3 text-sm">
                    <p className="font-semibold text-[#e10600]">{mark ? `ITEM ${mark}` : ""}</p>
                    <div>
                      <p>{section.title}</p>
                      {size ? <p className="mt-0.5 text-xs text-[#6b6560]">{size}</p> : null}
                    </div>
                    <p className="font-semibold">{formatCents(section.sellCents)}</p>
                  </div>
                );
              })}
            </div>
          )}
          {quote.notes ? <p className="mt-6 pl-24 text-sm">{quote.notes}</p> : null}
          <p className="mt-4 pl-24 text-sm font-semibold">Production Time frame {quote.productionDays} working days upon quotation approval</p>
          <div className="mt-8 grid grid-cols-[1fr_auto] gap-6 border border-[#1a1814] p-3 text-xs">
            <div>
              <p className="font-semibold">Terms & Conditions:</p>
              {quotationTerms(quote).map((line) => (
                <p key={line} className="mt-1">
                  {line}
                </p>
              ))}
            </div>
            <div className="space-y-1 text-right text-sm">
              <p>
                <span className="font-semibold text-[#e10600]">Total HTC in USD :</span> {formatCents(totals.sellCents)}
              </p>
              <p>
                <span className="font-semibold">VAT {quote.vatPercent}%</span> {formatCents(totals.vatCents)}
              </p>
              <p>
                <span className="font-semibold text-[#e10600]">Grand Total TTC in USD :</span> {formatCents(totals.grandTotalCents)}
              </p>
            </div>
          </div>
          <p className="mt-10 text-center text-[9px] text-[#6b6560]">{QUOTATION_FOOTER}</p>
        </article>
      </div>
    </div>
  );
}

type SimulationReference = { id: string; name: string; url: string };

export function SimulationPreview({
  image,
  pending,
  error,
  onDownload,
  onClose,
  onEdit,
  notice,
}: {
  image: string | null;
  pending: boolean;
  error: string | null;
  onDownload: () => void;
  onClose: () => void;
  /** Sends the selection and any uploaded artwork to the image model. */
  onEdit?: (edit: { instruction: string; region: ImageRegion; baseImage: string; references: { name: string; url: string }[] }) => Promise<void>;
  /** Shown when a simulation cannot be generated or edited, such as a missing image key. */
  notice?: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [region, setRegion] = useState<ImageRegion | null>(null);
  const [references, setReferences] = useState<SimulationReference[]>([]);
  const [instruction, setInstruction] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);

  function point(event: ReactPointerEvent) {
    const node = imgRef.current;
    if (!node) return null;
    const box = node.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (pending || !image) return;
    const start = point(event);
    if (!start) return;
    drag.current = start;
    event.currentTarget.setPointerCapture(event.pointerId);
    setRegion({ x: start.x, y: start.y, width: 0, height: 0 });
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = drag.current;
    const current = point(event);
    if (!start || !current) return;
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    setRegion({ x, y, width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y) });
  }

  function onPointerUp() {
    const start = drag.current;
    drag.current = null;
    if (!start) return;
    setRegion((current) => (current && current.width >= 0.03 && current.height >= 0.03 ? current : null));
  }

  function addReferences(files: File[]) {
    setUploadError(null);
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      setUploadError("Choose a PNG, JPG, or WebP picture.");
      return;
    }
    void Promise.all(
      images.slice(0, 4 - references.length).map(
        (file) =>
          new Promise<SimulationReference>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, url: String(reader.result) });
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          }),
      ),
    )
      .then((added) => setReferences((current) => [...current, ...added].slice(0, 4)))
      .catch(() => setUploadError("That picture could not be read."));
  }

  async function apply() {
    if (!onEdit || !image || !region || pending) return;
    await onEdit({ instruction, region, baseImage: image, references });
    setRegion(null);
    setReferences([]);
    setInstruction("");
  }

  const canApply = Boolean(onEdit && image && region && !pending && (instruction.trim() || references.length > 0));

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PreviewBar title="Simulation" detail={pending ? "Generating" : region ? "Area selected" : image ? "Drag to select an area" : "No picture yet"} onClose={onClose}>
        <button type="button" disabled={!image || pending} onClick={onDownload} className="btn btn-primary px-3.5 py-2 text-xs">
          <Download size={14} strokeWidth={2.25} aria-hidden="true" />
          Download image
        </button>
      </PreviewBar>
      <div className="flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_1px_1px,#d5d9e8_1px,transparent_0)] bg-[length:20px_20px] bg-raised">
        <div className="flex min-h-0 flex-1 items-center justify-center p-5">
          {pending ? (
            <div className="flex max-w-xs flex-col items-center gap-3 rounded-2xl border border-line bg-panel px-6 py-8 text-center shadow-float">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Loader2 size={20} className="animate-spin" aria-hidden="true" />
              </span>
              <p className="text-sm text-muted">Generating the simulation…</p>
            </div>
          ) : image ? (
            <div
              className="relative inline-block max-w-full overflow-hidden rounded-xl border border-line shadow-float"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {/* The picture is a data URL from this chat, which next/image does not serve. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={imgRef} src={image} alt="Photoreal simulation of the stand" draggable={false} className="block max-h-[calc(100dvh-16rem)] max-w-full cursor-crosshair bg-[#e4e1db] select-none" />
              {region && region.width > 0 && region.height > 0 ? (
                <div
                  className="pointer-events-none absolute border-2 border-accent"
                  style={{
                    left: `${region.x * 100}%`,
                    top: `${region.y * 100}%`,
                    width: `${region.width * 100}%`,
                    height: `${region.height * 100}%`,
                    boxShadow: "0 0 0 9999px rgba(20, 16, 12, 0.45)",
                  }}
                />
              ) : null}
            </div>
          ) : (
            <div className="flex max-w-xs flex-col items-center gap-3 rounded-2xl border border-line bg-panel px-6 py-8 text-center shadow-float">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <ImageIcon size={20} aria-hidden="true" />
              </span>
              <p className="text-sm text-muted">{error ?? "Describe the stand in the chat. The simulation will appear here."}</p>
            </div>
          )}
        </div>
        {image && !pending ? (
          <form
            className="shrink-0 border-t border-line bg-panel px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              void apply();
            }}
          >
            <div className="flex items-center gap-2">
              <button type="button" title="Upload artwork for the selected area" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-muted hover:bg-raised hover:text-ink" onClick={() => fileRef.current?.click()}>
                <ImagePlus size={15} strokeWidth={2} aria-hidden="true" />
                <span className="sr-only">Upload artwork</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="sr-only"
                onChange={(event) => {
                  addReferences(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
              <input
                value={instruction}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder={region ? "Say what the AI should change in the selection" : "Drag on the picture to select an area"}
                disabled={!region}
                className="field min-w-0 flex-1 py-1.5 text-xs disabled:cursor-not-allowed"
              />
              <button type="submit" disabled={!canApply} className="btn btn-primary px-3 py-1.5 text-xs">
                Edit
              </button>
            </div>
            {references.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {references.map((file) => (
                  <li key={file.id} className="flex max-w-48 items-center gap-1.5 rounded-lg border border-line bg-raised px-2 py-1 text-xs text-ink">
                    <span className="truncate">{file.name}</span>
                    <button type="button" aria-label={`Remove ${file.name}`} className="shrink-0 text-muted hover:text-ink" onClick={() => setReferences((current) => current.filter((item) => item.id !== file.id))}>
                      <X size={12} strokeWidth={2.25} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {uploadError ? <p className="mt-2 text-xs text-danger">{uploadError}</p> : null}
            {region ? (
              <button type="button" className="mt-2 text-xs text-muted hover:text-ink" onClick={() => setRegion(null)}>
                Clear selection
              </button>
            ) : (
              <p className="mt-2 text-xs text-muted">Drag a box on the header, a panel, or any part. Upload a picture to print there. The AI edits only that area of this same simulation.</p>
            )}
            {notice ? <p className="mt-2 text-xs text-muted">{notice}</p> : null}
          </form>
        ) : null}
        {!image && notice ? <p className="shrink-0 border-t border-line bg-panel px-4 py-3 text-xs text-muted">{notice}</p> : null}
      </div>
    </div>
  );
}

export function DrawingsPreview({
  document,
  model,
  production,
  sheet,
  onSheet,
  pending,
  onDownload,
  onDownloadDxf,
  onOpenCutting,
  onClose,
}: {
  document: DesignDocument;
  model: CompiledModel;
  production: ProductionResult;
  sheet: DrawingSheet;
  onSheet: (sheet: DrawingSheet) => void;
  pending: "pdf" | "dxf" | null;
  onDownload: () => void;
  onDownloadDxf: () => void;
  onOpenCutting: () => void;
  onClose: () => void;
}) {
  const hasBooth = document.walls.some((wall) => wall.bays.length > 0);
  const sheets = SHEETS.filter((item) => !item.booth || hasBooth);
  const current = sheets.find((item) => item.id === sheet) ?? sheets[0];
  const shown = current.id;
  const hasBoards = production.cutting.groups.some((group) => group.boards.length > 0);
  const bleed = constraintNumber(findSku(seedCatalog(), SKU.print), "bleedMm", LIMIT_DEFAULTS.bleedMm);
  const graphics = production.panels.filter((panel) => panel.kind === "graphic" || panel.kind === "lightbox");
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <PreviewBar
        title="Technical file"
        detail={
          document.parts.length > 0 || document.walls.some((wall) => wall.bays.length > 0)
            ? `${Math.round(document.envelope.width)} × ${Math.round(document.envelope.depth)} × ${Math.round(document.envelope.height)} mm`
            : "Empty"
        }
        onClose={onClose}
      >
        <Menu label={current.label} width="w-52" variant="outline" align="right">
          <SheetMenu sheets={sheets} sheet={shown} onSheet={onSheet} onOpenCutting={onOpenCutting} />
        </Menu>
        <button
          type="button"
          disabled={pending !== null || !hasBoards}
          onClick={onDownloadDxf}
          title={hasBoards ? "Cut files for the CNC or laser, one per material" : "Nothing in this stand is cut from board"}
          className="btn btn-secondary px-3 py-2 text-xs"
        >
          {pending === "dxf" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} strokeWidth={2.25} aria-hidden="true" />}
          CNC files (DXF)
        </button>
        <button type="button" disabled={pending !== null} onClick={onDownload} className="btn btn-primary px-3.5 py-2 text-xs">
          {pending === "pdf" ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Download size={14} strokeWidth={2.25} aria-hidden="true" />}
          {pending === "pdf" ? "Preparing PDF…" : "Download PDF"}
        </button>
      </PreviewBar>
      <div className="min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_1px_1px,#d5d9e8_1px,transparent_0)] bg-[length:20px_20px] bg-raised p-6">
        {shown === "technical" ? <SvgSheet markup={technicalSvg(document, model)} /> : null}
        {shown === "plan" ? <SvgSheet markup={planSvg(document, model)} /> : null}
        {shown === "panels" ? (
          <DataSheet>
            <table className="w-full text-left text-sm">
              <thead className="eyebrow text-left">
                <tr>
                  <th className="pb-2.5 font-semibold">Bay</th>
                  <th className="pb-2.5 font-semibold">Kind</th>
                  <th className="pb-2.5 font-semibold">Size</th>
                  <th className="pb-2.5 font-semibold">Finish</th>
                </tr>
              </thead>
              <tbody>
                {production.panels.map((panel) => (
                  <tr key={panel.id} className="border-t border-line transition-colors hover:bg-raised/60">
                    <td className="py-2.5 capitalize">{panel.edge} {panel.bayIndex + 1}</td>
                    <td className="py-2.5 capitalize">{panel.kind}</td>
                    <td className="py-2.5 font-mono text-xs">{panel.widthMm} × {panel.heightMm}</td>
                    <td className="py-2.5 text-muted">{panel.finish || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataSheet>
        ) : null}
        {shown === "cuts" ? (
          <DataSheet>
            <p className="mb-4 rounded-lg bg-raised px-3 py-2 text-xs text-muted">{production.bars} bars of {production.stockLengthMm} mm</p>
            <table className="w-full text-left text-sm">
              <thead className="eyebrow text-left">
                <tr>
                  <th className="pb-2.5 font-semibold">Part</th>
                  <th className="pb-2.5 font-semibold">Length</th>
                  <th className="pb-2.5 font-semibold">Qty</th>
                </tr>
              </thead>
              <tbody>
                {production.cuts.map((cut) => (
                  <tr key={`${cut.part}-${cut.lengthMm}`} className="border-t border-line transition-colors hover:bg-raised/60">
                    <td className="py-2.5">{cut.part}</td>
                    <td className="py-2.5 font-mono text-xs">{cut.lengthMm} mm</td>
                    <td className="py-2.5 font-mono text-xs">{cut.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataSheet>
        ) : null}
        {shown === "graphics" ? (
          <DataSheet>
            <p className="mb-4 rounded-lg bg-raised px-3 py-2 text-xs text-muted">Finished size includes {bleed} mm bleed on each edge.</p>
            <table className="w-full text-left text-sm">
              <thead className="eyebrow text-left">
                <tr>
                  <th className="pb-2.5 font-semibold">Bay</th>
                  <th className="pb-2.5 font-semibold">Finished size</th>
                  <th className="pb-2.5 font-semibold">Artwork</th>
                </tr>
              </thead>
              <tbody>
                {graphics.length === 0 ? (
                  <tr className="border-t border-line transition-colors hover:bg-raised/60">
                    <td className="py-2.5 text-muted" colSpan={3}>No printed faces.</td>
                  </tr>
                ) : null}
                {graphics.map((panel) => (
                  <tr key={panel.id} className="border-t border-line transition-colors hover:bg-raised/60">
                    <td className="py-2.5 capitalize">{panel.edge} {panel.bayIndex + 1}</td>
                    <td className="py-2.5 font-mono text-xs">{panel.widthMm + bleed * 2} × {panel.heightMm + bleed * 2}</td>
                    <td className="py-2.5 text-muted">{panel.graphicAssetId || "Missing"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataSheet>
        ) : null}
        {shown === "notes" ? (
          <DataSheet>
            <pre className="font-sans text-sm leading-6 whitespace-pre-wrap">{assemblyNotes(document)}</pre>
          </DataSheet>
        ) : null}
      </div>
    </div>
  );
}

function SheetMenu({
  sheets,
  sheet,
  onSheet,
  onOpenCutting,
}: {
  sheets: typeof SHEETS;
  sheet: DrawingSheet;
  onSheet: (sheet: DrawingSheet) => void;
  onOpenCutting: () => void;
}) {
  const close = useCloseMenu();
  return (
    <div className="p-1.5">
      {sheets.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => {
            onSheet(item.id);
            close();
          }}
          className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${sheet === item.id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-raised hover:text-ink"}`}
        >
          {item.label}
          {sheet === item.id ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : null}
        </button>
      ))}
      <div className="my-1 h-px bg-line" />
      <button
        type="button"
        onClick={() => {
          onOpenCutting();
          close();
        }}
        className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
      >
        Board sheets
      </button>
    </div>
  );
}

export function PreviewBar({
  title,
  detail,
  onClose,
  children,
}: {
  title: string;
  detail: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-panel px-4">
      <div className="flex min-w-0 items-center gap-3">
        <button type="button" onClick={onClose} className="btn btn-secondary px-2.5 py-1.5 text-xs">
          <X size={14} strokeWidth={2.25} aria-hidden="true" />
          Close
        </button>
        <span className="h-6 w-px bg-line" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm leading-none font-semibold tracking-tight">{title}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-muted">{detail}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children}
      </div>
    </div>
  );
}

function SvgSheet({ markup }: { markup: string }) {
  const svg = markup.replace(/^<\?xml[^>]*>\s*/, "");
  return (
    <div className="mx-auto flex h-full max-w-5xl items-center justify-center rounded-2xl border border-line paper p-6 shadow-float [&_svg]:h-auto [&_svg]:max-h-[68vh] [&_svg]:w-full">
      <div className="w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </div>
  );
}

function DataSheet({ children }: { children: ReactNode }) {
  return <div className="animate-rise mx-auto max-w-3xl rounded-2xl border border-line paper p-7 shadow-float">{children}</div>;
}
