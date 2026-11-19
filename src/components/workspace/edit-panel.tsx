"use client";

import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceBetween,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceBetween,
  ArrowDownToLine,
  Box,
  ChevronDown,
  ChevronRight,
  Copy,
  Cylinder,
  Eye,
  EyeOff,
  Folder,
  GripHorizontal,
  Group,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Lock,
  LockOpen,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Square,
  Type,
  Trash,
  Ungroup,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { addModelFile } from "@/lib/files/add-model";
import { recordSpend } from "@/lib/studio/ai-spend";
import { getStudioSettings } from "@/lib/studio/local-booth";
import { getPriceBook, getServerPriceBook, subscribePriceBook } from "@/lib/studio/price-book";
import { ColorField } from "@/components/workspace/color-field";
import { NumberField } from "@/components/workspace/fields";
import { ImagesEditor } from "@/components/workspace/image-section";
import { bendProfile, faceAxes, flatPiece, outlineRing } from "@/lib/systems/modular/geometry";
import {
  alignParts,
  defaultPart,
  distributeParts,
  dropToFloor,
  duplicateParts,
  groupParts,
  placementFor,
  addParts,
  removeParts,
  renameGroup,
  setPartFlags,
  ungroupParts,
  updateParts,
} from "@/lib/systems/modular/ops";
import { applyDesignPatch } from "@/lib/systems/modular/patch";
import type { AlignEdge } from "@/lib/systems/modular/ops";
import type { Curve, DesignDocument, Hole, Outline, PartChanges, PartMaterial, Round, ScenePart, ShapedFace } from "@/lib/systems/modular/schema";

type Commit = (document: DesignDocument, key?: string) => void;

const MATERIALS: { id: PartMaterial; label: string }[] = [
  { id: "paint", label: "Paint" },
  { id: "mdf", label: "MDF" },
  { id: "wood", label: "Wood" },
  { id: "laminate", label: "Laminate" },
  { id: "metal", label: "Metal" },
  { id: "glass", label: "Glass" },
];

const DEFAULT_COLOR = "#f3efe6";

const SHAPED_FACE_OPTIONS: { face: ShapedFace; label: string; seen: string }[] = [
  { face: "front", label: "Front", seen: "seen from the front" },
  { face: "top", label: "Top", seen: "seen from above" },
  { face: "side", label: "Side", seen: "seen from the right, front on the left" },
];

/** Where each corner of the shaped face really is on the piece. */
const FACE_CORNERS: Record<ShapedFace, Record<"topLeft" | "topRight" | "bottomLeft" | "bottomRight", string>> = {
  front: { topLeft: "Top left", topRight: "Top right", bottomLeft: "Bottom left", bottomRight: "Bottom right" },
  side: { topLeft: "Top front", topRight: "Top back", bottomLeft: "Bottom front", bottomRight: "Bottom back" },
  top: { topLeft: "Back left", topRight: "Back right", bottomLeft: "Front left", bottomRight: "Front right" },
};

const choiceButton = (active: boolean) =>
  `h-[22px] rounded-[4px] px-1 text-[11px] transition-colors ${active ? "bg-accent text-on-accent" : "bg-raised text-ink hover:bg-raised"}`;

function ChoiceRow<T extends string>({ label, options, value, onPick }: { label: string; options: [T, string][]; value: T; onPick: (value: T) => void }) {
  return (
    <>
      <p className="pt-1.5 pb-1 text-[10px] text-subtle">{label}</p>
      <div role="group" aria-label={label} className="grid grid-cols-2 gap-1">
        {options.map(([id, text]) => (
          <button key={id} type="button" aria-pressed={value === id} onClick={() => onPick(id)} className={choiceButton(value === id)}>
            {text}
          </button>
        ))}
      </div>
    </>
  );
}

export function EditPanel({
  document,
  selection,
  onDocument,
  onSelect,
  onOpenTemplates,
}: {
  document: DesignDocument;
  selection: string[];
  onDocument: Commit;
  onSelect: (ids: string[]) => void;
  onOpenTemplates: () => void;
}) {
  const hasBooth = document.walls.some((wall) => wall.bays.length > 0);
  const chosen = new Set(selection);
  const selected = document.parts.filter((part) => chosen.has(part.id));
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const unlabeled = document.parts.filter((part) => part.shape === "mesh" && !part.material);
  if (open && selected.length === 0) setOpen(false);

  function add(shape: "box" | "cylinder" | "letters" | "tube") {
    const added = addParts(document, [
      shape === "tube"
        ? { name: "Tube", shape, y: 0, width: 1000, height: 400, depth: 25, material: "metal", color: "#c5bfb4", ...placementFor(document, 1000, 25) }
        : defaultPart(document, shape),
    ]);
    onDocument(added.document);
    onSelect(added.ids);
  }

  async function importFile(file: File) {
    setImporting(true);
    setImportError(null);
    setImportNote(null);
    try {
      const added = await addModelFile(document, file);
      onDocument(added.document);
      onSelect(added.ids);
      setImportNote(added.note);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "The file could not be imported.");
    } finally {
      setImporting(false);
    }
  }

  async function suggestMaterials() {
    if (unlabeled.length === 0 || suggesting) return;
    setSuggesting(true);
    setImportError(null);
    try {
      const settings = getStudioSettings();
      const response = await fetch("/api/materials/suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: settings.provider,
          model: settings.model,
          pieces: unlabeled.map((part) => ({
            id: part.id,
            name: part.name,
            sourceMaterial: part.sourceMaterial,
            width: part.width,
            height: part.height,
            depth: part.depth,
          })),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string; suggestions?: Array<{ id: string; material: PartMaterial; color: string }> } | null;
      recordSpend(payload);
      if (!response.ok || !payload?.suggestions) throw new Error(payload?.error ?? "Materials could not be suggested.");
      let next = document;
      for (const suggestion of payload.suggestions) {
        next = updateParts(next, [suggestion.id], { material: suggestion.material, color: suggestion.color });
      }
      onDocument(next);
      setImportNote(`Materials suggested for ${payload.suggestions.length} ${payload.suggestions.length === 1 ? "piece" : "pieces"}. Check them before quoting.`);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Materials could not be suggested.");
    } finally {
      setSuggesting(false);
    }
  }

  if (document.parts.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        <p className="px-1.5 pb-2 text-[11px] leading-4 text-muted">
          {hasBooth ? "No custom pieces yet." : "Nothing on the canvas yet."}
        </p>
        <div className="flex flex-col">
          <AddCard label="Box" Icon={Square} onClick={() => add("box")} />
          <AddCard label="Cylinder" Icon={Cylinder} onClick={() => add("cylinder")} />
          <AddCard label="Tube" Icon={Spline} onClick={() => add("tube")} />
          <AddCard label="Letters" Icon={Type} onClick={() => add("letters")} />
          <AddCard label="Template" Icon={LayoutTemplate} onClick={onOpenTemplates} />
        </div>
        <ImportFile busy={importing} onFile={(file) => void importFile(file)} wide />
        <ImportStatus note={importNote} error={importError} />
      </div>
    );
  }

  function openEditor() {
    const rect = rootRef.current?.getBoundingClientRect();
    setPos((current) => current ?? { left: Math.max(8, (rect?.left ?? window.innerWidth - 400) - POPUP_WIDTH - 16), top: 72 });
    setOpen(true);
  }

  const title = selected.length === 1 ? selected[0].name : `${selected.length} pieces`;

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <Layers
        document={document}
        selection={selection}
        selected={selected}
        editing={open}
        onDocument={onDocument}
        onSelect={onSelect}
        onEdit={(ids) => {
          if (ids) onSelect(ids);
          openEditor();
        }}
        onCloseEditor={() => setOpen(false)}
        onAddBox={() => add("box")}
        onAddCylinder={() => add("cylinder")}
        onAddTube={() => add("tube")}
        onAddLetters={() => add("letters")}
        onOpenTemplates={onOpenTemplates}
        importing={importing}
        onImport={(file) => void importFile(file)}
        importNote={importNote}
        importError={importError}
        unlabeled={unlabeled.length}
        suggesting={suggesting}
        onSuggest={() => void suggestMaterials()}
        hasBooth={hasBooth}
        onScale={(axis, size) => onDocument(scaleScene(document, axis, size))}
      />
      {open && pos && selected.length > 0 ? (
        <PropertiesPopup title={title} pos={pos} onMove={setPos} onClose={() => setOpen(false)}>
          {selected.length === 1 ? (
            <PartInspector key={selected[0].id} document={document} part={selected[0]} onDocument={onDocument} onSelect={onSelect} />
          ) : (
            <BulkInspector document={document} selected={selected} onDocument={onDocument} onSelect={onSelect} />
          )}
        </PropertiesPopup>
      ) : null}
    </div>
  );
}

const POPUP_WIDTH = 240;

/** A floating panel over the 3D view. Drag it by the top bar; it stays open while you pick other pieces. */
function PropertiesPopup({
  title,
  pos,
  onMove,
  onClose,
  children,
}: {
  title: string;
  pos: { left: number; top: number };
  onMove: (pos: { left: number; top: number }) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    drag.current = { dx: event.clientX - pos.left, dy: event.clientY - pos.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    onMove({
      left: Math.min(Math.max(8, event.clientX - drag.current.dx), window.innerWidth - POPUP_WIDTH - 8),
      top: Math.min(Math.max(8, event.clientY - drag.current.dy), window.innerHeight - 96),
    });
  }

  return createPortal(
    <div
      role="dialog"
      aria-label="Properties"
      style={{ left: pos.left, top: pos.top, width: POPUP_WIDTH, maxHeight: `calc(100vh - ${pos.top}px - 16px)` }}
      className="animate-pop fixed z-40 flex flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-float"
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          drag.current = null;
        }}
        className="flex h-8 shrink-0 cursor-grab touch-none items-center justify-between border-b border-line bg-raised pr-1 pl-2 select-none active:cursor-grabbing"
      >
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-ink">
          <GripHorizontal size={12} strokeWidth={2} aria-hidden="true" className="shrink-0 text-subtle" />
          <span className="truncate">{title}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close properties"
          title="Close (Esc)"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-colors hover:bg-ink/10 hover:text-ink"
        >
          <X size={13} strokeWidth={2.25} aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-panel">{children}</div>
    </div>,
    document.body,
  );
}

/* ---------------------------------------------------------------------------------------------
 * Shared building blocks
 * ------------------------------------------------------------------------------------------- */

function ImportFile({ busy, onFile, wide = false, compact = false }: { busy: boolean; onFile: (file: File) => void; wide?: boolean; compact?: boolean }) {
  return (
    <label
      className={
        compact
          ? `flex h-6 w-6 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-raised hover:text-accent ${busy ? "pointer-events-none opacity-50" : ""}`
          : `mt-1 flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1.5 text-[12px] text-ink transition-colors hover:bg-raised ${wide ? "w-full" : ""} ${busy ? "pointer-events-none opacity-50" : ""}`
      }
      aria-label="Import a 3D file"
      title="Import a glTF, OBJ, or STL file"
    >
      {busy ? <Loader2 size={compact ? 15 : 16} className="animate-spin" aria-hidden="true" /> : <Upload size={compact ? 15 : 16} strokeWidth={1.9} aria-hidden="true" />}
      {compact ? null : "Import 3D file"}
      <input
        type="file"
        accept=".glb,.gltf,.obj,.stl,model/gltf-binary,model/gltf+json"
        className="sr-only"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </label>
  );
}

function ImportStatus({ note, error }: { note: string | null; error: string | null }) {
  if (!note && !error) return null;
  return <p className={`px-2 pb-1.5 text-[11px] leading-4 ${error ? "text-danger" : "text-muted"}`}>{error ?? note}</p>;
}

function AddCard({ label, Icon, onClick }: { label: string; Icon: LucideIcon; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 w-full items-center gap-2 rounded px-1.5 text-left text-[12px] text-ink transition-colors hover:bg-accent-soft hover:text-accent"
    >
      <Icon size={14} strokeWidth={1.9} aria-hidden="true" className="text-muted" />
      {label}
    </button>
  );
}

/** A collapsible group of related fields, like the sections in Figma's right-hand panel. */
function Section({
  title,
  children,
  defaultOpen = true,
  disabled = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line/80 last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1 px-2 py-1.5 text-left hover:bg-raised/80"
      >
        <ChevronDown size={12} strokeWidth={2.25} aria-hidden="true" className={`shrink-0 text-subtle transition-transform duration-150 ${open ? "" : "-rotate-90"}`} />
        <span className="text-[11px] font-medium text-muted">{title}</span>
      </button>
      {open ? (
        <fieldset disabled={disabled} className={`m-0 min-w-0 border-0 px-2 pt-0.5 pb-2 ${disabled ? "opacity-50" : ""}`}>
          {children}
        </fieldset>
      ) : null}
    </section>
  );
}

function IconButton({
  label,
  Icon,
  onClick,
  disabled,
  flat = false,
}: {
  label: string;
  Icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  /** No border, for use inside a segmented group. */
  flat?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-muted ${flat ? "" : ""}`}
    >
      <Icon size={13} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
}

function Segment({ children }: { children: ReactNode }) {
  return <div className="inline-flex items-center rounded border border-line bg-raised p-px">{children}</div>;
}

function ActionButton({ label, Icon, onClick, danger }: { label: string; Icon: LucideIcon; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium transition-colors ${danger ? "text-danger hover:bg-danger-soft" : "text-ink hover:bg-raised"}`}
    >
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
  );
}

/** The six piece materials, plus the sheets in Materials that are not one of them, such as acrylic. */
function MaterialChips({ value, sheet, onChange }: { value: PartMaterial | null; sheet: string | null; onChange: (changes: PartChanges) => void }) {
  const book = useSyncExternalStore(subscribePriceBook, getPriceBook, getServerPriceBook);
  const sheets = book.materials.filter((material) => !material.piece && material.unit === "board");
  const chip = (active: boolean) => `h-[22px] truncate rounded-[4px] px-1 text-[11px] transition-colors ${active ? "bg-accent text-on-accent" : "bg-raised text-ink hover:bg-raised"}`;
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-3 gap-1">
        {MATERIALS.map((material) => {
          const active = !sheet && value === material.id;
          return (
            <button key={material.id} type="button" aria-pressed={active} onClick={() => onChange({ material: material.id })} className={chip(active)}>
              {material.label}
            </button>
          );
        })}
      </div>
      {sheets.length > 0 ? (
        <div className="grid grid-cols-2 gap-1">
          {sheets.map((material) => {
            const active = sheet === material.id;
            const clear = /acryl|plexi|perspex|polycarb/i.test(material.name);
            return (
              <button
                key={material.id}
                type="button"
                aria-pressed={active}
                title={material.name}
                onClick={() => onChange({ materialId: material.id, material: clear ? "glass" : "paint" })}
                className={chip(active)}
              >
                {material.name}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Layers
 * ------------------------------------------------------------------------------------------- */

function Layers({
  document,
  selection,
  selected,
  editing,
  onDocument,
  onSelect,
  onEdit,
  onCloseEditor,
  onAddBox,
  onAddCylinder,
  onAddTube,
  onAddLetters,
  onOpenTemplates,
  importing,
  onImport,
  importNote,
  importError,
  unlabeled,
  suggesting,
  onSuggest,
  hasBooth,
  onScale,
}: {
  document: DesignDocument;
  selection: string[];
  selected: ScenePart[];
  editing: boolean;
  onDocument: Commit;
  onSelect: (ids: string[]) => void;
  /** Open the properties panel. Pass ids to select them first. */
  onEdit: (ids?: string[]) => void;
  onCloseEditor: () => void;
  onAddBox: () => void;
  onAddCylinder: () => void;
  onAddTube: () => void;
  onAddLetters: () => void;
  onOpenTemplates: () => void;
  importing: boolean;
  onImport: (file: File) => void;
  importNote: string | null;
  importError: string | null;
  unlabeled: number;
  suggesting: boolean;
  onSuggest: () => void;
  hasBooth: boolean;
  onScale: (axis: "width" | "depth" | "height", size: number) => void;
}) {
  const chosen = new Set(selection);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  type Row = { kind: "group"; id: string; parts: ScenePart[] } | { kind: "part"; part: ScenePart };
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const part of document.parts) {
    if (!part.group) {
      rows.push({ kind: "part", part });
    } else if (!seen.has(part.group)) {
      seen.add(part.group);
      rows.push({ kind: "group", id: part.group, parts: document.parts.filter((item) => item.group === part.group) });
    }
  }

  function pick(id: string, event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }) {
    if (event.shiftKey || event.metaKey || event.ctrlKey) {
      onSelect(chosen.has(id) ? selection.filter((item) => item !== id) : [...selection, id]);
    } else {
      onSelect(chosen.has(id) && selection.length === 1 ? [] : [id]);
    }
  }

  function toggleCollapsed(id: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function partRow(part: ScenePart, depth: number) {
    const active = chosen.has(part.id);
    const ShapeIcon = part.shape === "cylinder" ? Cylinder : part.shape === "tube" ? Spline : part.shape === "letters" ? Type : part.shape === "mesh" ? Box : Square;
    const size =
      part.shape === "cylinder"
        ? `Ø ${Math.round(part.width)} × ${Math.round(part.height)} mm`
        : `${Math.round(part.width)} × ${Math.round(part.depth)} × ${Math.round(part.height)} mm`;
    return (
      <div
        key={part.id}
        style={{ paddingLeft: 6 + depth * 14 }}
        className={`group/row relative flex h-7 items-center transition-colors ${active ? "bg-accent-soft" : "hover:bg-raised"}`}
      >
        <button
          type="button"
          title={size}
          aria-pressed={active}
          onClick={(event) => pick(part.id, event)}
          onDoubleClick={() => onEdit([part.id])}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1.5 text-left"
        >
          <ShapeIcon size={12} strokeWidth={1.9} aria-hidden="true" className={`shrink-0 ${active ? "text-accent" : "text-subtle"}`} />
          <span className={`min-w-0 flex-1 truncate text-[12px] leading-none ${active ? "font-medium text-accent" : "text-ink"} ${part.hidden ? "opacity-40" : ""}`}>{part.name}</span>
          {part.images?.length ? <ImageIcon size={11} strokeWidth={2} aria-label="Has an image" className="shrink-0 text-subtle" /> : null}
          <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] border border-black/15" style={{ background: hexColor(part.color) }} aria-hidden="true" />
        </button>
        <div className={`absolute inset-y-0 right-0 flex items-center pr-0.5 ${active ? "bg-accent-soft" : "bg-panel group-hover/row:bg-[#f4f5f8]"} ${active || part.hidden || part.locked ? "" : "pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100"}`}>
          <RowToggle
            label="Edit properties"
            Icon={SlidersHorizontal}
            on={active && editing}
            show={active}
            onClick={() => onEdit([part.id])}
          />
          <RowToggle
            label={part.hidden ? "Show in 3D" : "Hide in 3D"}
            Icon={part.hidden ? EyeOff : Eye}
            on={Boolean(part.hidden)}
            onClick={() => onDocument(setPartFlags(document, [part.id], { hidden: !part.hidden }))}
          />
          <RowToggle
            label={part.locked ? "Unlock" : "Lock"}
            Icon={part.locked ? Lock : LockOpen}
            on={Boolean(part.locked)}
            onClick={() => onDocument(setPartFlags(document, [part.id], { locked: !part.locked }))}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 items-center justify-between border-b border-line px-1.5">
        <p className="pl-1 text-[11px] font-medium text-muted">{document.parts.length} layers</p>
        <div className="flex items-center">
          <AddIcon label="Add box" Icon={Square} onClick={onAddBox} />
          <AddIcon label="Add cylinder" Icon={Cylinder} onClick={onAddCylinder} />
          <AddIcon label="Add tube" Icon={Spline} onClick={onAddTube} />
          <AddIcon label="Add letters" Icon={Type} onClick={onAddLetters} />
          <AddIcon label="Start from a template" Icon={LayoutTemplate} onClick={onOpenTemplates} />
          <ImportFile busy={importing} onFile={onImport} compact />
        </div>
      </div>
      {unlabeled > 0 ? (
        <div className="border-b border-accent-line bg-accent-soft/60 px-2 py-1.5">
          <p className="text-[11px] leading-4 text-accent">{unlabeled} {unlabeled === 1 ? "piece has" : "pieces have"} no material.</p>
          <button type="button" onClick={onSuggest} disabled={suggesting} className="mt-1 flex h-6 items-center gap-1 rounded bg-accent px-2 text-[11px] font-medium text-on-accent disabled:opacity-50">
            {suggesting ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Sparkles size={12} strokeWidth={2.25} aria-hidden="true" />}
            Suggest
          </button>
        </div>
      ) : null}
      <ImportStatus note={importNote} error={importError} />
      <div className="min-h-0 flex-1 overflow-auto py-0.5">
        {rows.map((row) => {
          if (row.kind === "part") return partRow(row.part, 0);
          const ids = row.parts.map((part) => part.id);
          const allSelected = ids.every((id) => chosen.has(id));
          const allHidden = row.parts.every((part) => part.hidden);
          const allLocked = row.parts.every((part) => part.locked);
          const isCollapsed = collapsed.has(row.id);
          return (
            <div key={row.id}>
              <div className={`group/row relative flex h-7 items-center transition-colors ${allSelected ? "bg-accent-soft" : "hover:bg-raised"}`}>
                <button
                  type="button"
                  aria-label={isCollapsed ? "Expand group" : "Collapse group"}
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleCollapsed(row.id)}
                  className="flex h-6 w-5 shrink-0 items-center justify-center text-subtle hover:text-ink"
                >
                  <ChevronRight size={12} strokeWidth={2.25} aria-hidden="true" className={`transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`} />
                </button>
                <button
                  type="button"
                  aria-pressed={allSelected}
                  onClick={() => onSelect(allSelected ? [] : ids)}
                  className="flex h-full min-w-0 flex-1 items-center gap-1.5 pr-1.5 text-left"
                >
                  <Folder size={12} strokeWidth={1.9} aria-hidden="true" className={`shrink-0 ${allSelected ? "text-accent" : "text-subtle"}`} />
                  <span className={`min-w-0 flex-1 truncate text-[12px] font-medium ${allSelected ? "text-accent" : "text-ink"}`}>{document.groups?.[row.id] ?? "Group"}</span>
                  <span className="text-[10px] text-subtle">{row.parts.length}</span>
                </button>
                <div className={`absolute inset-y-0 right-0 flex items-center pr-0.5 ${allSelected ? "bg-accent-soft" : "bg-panel group-hover/row:bg-[#f4f5f8]"} ${allSelected || allHidden || allLocked ? "" : "pointer-events-none opacity-0 group-hover/row:pointer-events-auto group-hover/row:opacity-100"}`}>
                  <RowToggle
                    label="Edit group properties"
                    Icon={SlidersHorizontal}
                    on={allSelected && editing}
                    show={allSelected}
                    onClick={() => onEdit(ids)}
                  />
                  <RowToggle
                    label={allHidden ? "Show group in 3D" : "Hide group in 3D"}
                    Icon={allHidden ? EyeOff : Eye}
                    on={allHidden}
                    onClick={() => onDocument(setPartFlags(document, ids, { hidden: !allHidden }))}
                  />
                  <RowToggle
                    label={allLocked ? "Unlock group" : "Lock group"}
                    Icon={allLocked ? Lock : LockOpen}
                    on={allLocked}
                    onClick={() => onDocument(setPartFlags(document, ids, { locked: !allLocked }))}
                  />
                </div>
              </div>
              {isCollapsed ? null : <div className="ml-3 border-l border-line">{row.parts.map((part) => partRow(part, 0.35))}</div>}
            </div>
          );
        })}
      </div>
      {hasBooth ? null : (
        <div className="shrink-0 border-t border-line px-2 py-2">
          <p className="pb-1.5 text-[11px] font-medium text-muted">Stand size, mm</p>
          <div className="grid grid-cols-3 gap-1">
            <NumberField dense prefix="W" label="Width" value={document.envelope.width} onCommit={(size) => onScale("width", size)} />
            <NumberField dense prefix="D" label="Depth" value={document.envelope.depth} onCommit={(size) => onScale("depth", size)} />
            <NumberField dense prefix="H" label="Height" value={document.envelope.height} onCommit={(size) => onScale("height", size)} />
          </div>
          <p className="pt-1.5 text-[10px] leading-3 text-subtle">Scales every piece.</p>
        </div>
      )}
      {selected.length > 0 ? (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-line bg-raised px-2 py-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-ink">{selected.length === 1 ? selected[0].name : `${selected.length} pieces`}</p>
            <p className="truncate font-mono text-[10px] text-subtle">
              {selected.length === 1
                ? selected[0].shape === "cylinder"
                  ? `Ø ${Math.round(selected[0].width)} × ${Math.round(selected[0].height)}`
                  : `${Math.round(selected[0].width)} × ${Math.round(selected[0].depth)} × ${Math.round(selected[0].height)}`
                : "Shift-click to add"}
            </p>
          </div>
          {editing ? (
            <button type="button" onClick={onCloseEditor} className="flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-muted hover:bg-panel hover:text-ink">
              <X size={12} strokeWidth={2.25} aria-hidden="true" />
              Close
            </button>
          ) : (
            <button type="button" onClick={() => onEdit()} className="flex h-6 items-center gap-1 rounded bg-accent px-2 text-[11px] font-medium text-on-accent">
              <SlidersHorizontal size={12} strokeWidth={2.25} aria-hidden="true" />
              Edit
            </button>
          )}
        </div>
      ) : (
        <p className="shrink-0 border-t border-line px-2 py-2 text-[10px] leading-4 text-subtle">
          Click a layer or the model. Double-click to edit. Shift-click selects more.
        </p>
      )}
    </div>
  );
}

function AddIcon({ label, Icon, onClick }: { label: string; Icon: LucideIcon; onClick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-muted transition-colors hover:bg-raised hover:text-accent"
    >
      <Icon size={15} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
}

function RowToggle({ label, Icon, on, onClick, show = false }: { label: string; Icon: LucideIcon; on: boolean; onClick: () => void; show?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-ink/10 focus-visible:opacity-100 ${on ? "text-accent" : show ? "text-accent" : "text-subtle hover:text-ink"}`}
    >
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Inspector: one piece
 * ------------------------------------------------------------------------------------------- */

function PartInspector({
  document,
  part,
  onDocument,
  onSelect,
}: {
  document: DesignDocument;
  part: ScenePart;
  onDocument: Commit;
  onSelect: (ids: string[]) => void;
}) {
  // Quick repeated edits to the same field, such as holding ↑ in a number box, are one undo step.
  function change(changes: PartChanges, key?: string) {
    onDocument(updateParts(document, [part.id], changes), key ?? `${part.id}:${Object.keys(changes).sort().join(",")}`);
  }
  const color = hexColor(part.color);
  const locked = Boolean(part.locked);
  const cylinder = part.shape === "cylinder";
  const tube = part.shape === "tube";
  const letters = part.shape === "letters";
  const cornerKey = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;
  function setCorner(key: (typeof cornerKey)[number], value: number) {
    const chamfers = { ...part.chamfers };
    if (value > 0) delete chamfers[key];
    change({ corners: { ...part.corners, [key]: value }, chamfers });
  }
  function setCut(key: (typeof cornerKey)[number], axis: "x" | "y", value: number) {
    const next = { ...part.chamfers?.[key], [axis]: value };
    const chamfers = { ...part.chamfers, [key]: next };
    const corners = { ...part.corners };
    if ((next.x ?? 0) > 0 && (next.y ?? 0) > 0) delete corners[key];
    change({ chamfers, corners });
  }
  const openings = part.holes ?? [];
  // holeSchema allows eight openings. A ninth would reject the whole edit.
  const canAdd = openings.length < 8;
  const shaped = faceAxes(part);
  const faceOption = SHAPED_FACE_OPTIONS.find((option) => option.face === shaped.face) ?? SHAPED_FACE_OPTIONS[0];
  const corners = FACE_CORNERS[shaped.face];
  const bend = part.curve ? bendProfile(part, part.curve) : null;
  const blank = part.curve ? flatPiece(part) : null;
  const group = part.group ? (document.groups?.[part.group] ?? "Group") : null;
  const tubePath: Outline = part.path && part.path.length >= 2 ? part.path : [[0, shaped.height / 2], [shaped.width, shaped.height / 2]];
  function commitRound(key: "top" | "wall" | "sweep", value: number) {
    const next: Round = { ...part.round };
    if ((key === "top" && value === part.width) || (key === "wall" && value === 0) || (key === "sweep" && value === 360)) delete next[key];
    else next[key] = value;
    change({ round: Object.keys(next).length > 0 ? next : null });
  }
  function commitProfile(profile: Outline | null) {
    const next: Round = { ...part.round };
    if (profile) next.profile = profile;
    else delete next.profile;
    change({ round: Object.keys(next).length > 0 ? next : null });
  }
  return (
    <div className="animate-rise">
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <div className="min-w-0 flex-1">
          <input
            key={part.name}
            defaultValue={part.name}
            aria-label="Name"
            disabled={locked}
            onBlur={(event) => {
              const name = event.currentTarget.value.trim();
              if (name && name !== part.name) change({ name });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="w-full truncate rounded bg-transparent px-1 py-0.5 text-[12px] font-medium text-ink outline-none hover:bg-raised focus:bg-panel focus:ring-1 focus:ring-accent"
          />
          <p className="truncate px-1 text-[10px] text-subtle">
            {group ? `${group} · ` : ""}
            {cylinder ? "Cylinder" : tube ? "Tube" : letters ? "Letters" : part.shape === "mesh" ? "Imported mesh" : "Box"}
          </p>
        </div>
        <IconButton
          label={locked ? "Unlock" : "Lock"}
          Icon={locked ? Lock : LockOpen}
          onClick={() => onDocument(setPartFlags(document, [part.id], { locked: !locked }))}
        />
        <IconButton
          label="Duplicate"
          Icon={Copy}
          onClick={() => {
            const copy = duplicateParts(document, [part.id]);
            onDocument(copy.document);
            onSelect(copy.ids);
          }}
        />
        <IconButton
          label="Delete"
          Icon={Trash}
          disabled={locked}
          onClick={() => {
            onDocument(removeParts(document, [part.id]));
            onSelect([]);
          }}
        />
      </div>
      {locked ? (
        <p className="flex items-center gap-1.5 border-b border-line bg-raised px-2 py-1.5 text-[11px] text-muted">
          <Lock size={11} aria-hidden="true" className="shrink-0" />
          Locked. Unlock to edit.
        </p>
      ) : null}

      <Section title="Position" disabled={locked}>
        <div className="grid grid-cols-3 gap-1">
          <NumberField dense prefix="X" label="From left" value={part.x} allowZero onCommit={(x) => change({ x })} />
          <NumberField dense prefix="Y" label="From floor" value={part.y} allowZero onCommit={(y) => change({ y })} />
          <NumberField dense prefix="Z" label="From back" value={part.z} allowZero onCommit={(z) => change({ z })} />
        </div>
        {cylinder ? null : (
          <>
            <div className="mt-1 grid grid-cols-3 gap-1">
              <NumberField dense prefix="R" label="Rotation" value={part.rotation ?? 0} allowZero allowNegative suffix="°" onCommit={(rotation) => change({ rotation })} />
              <div className="col-span-2">
                <NumberField dense prefix="Tilt" label="Tilt" value={part.tilt ?? 0} allowZero allowNegative suffix="°" onCommit={(tilt) => change({ tilt })} />
              </div>
            </div>
            <p className="pt-1.5 text-[10px] leading-3 text-subtle">Tilt slopes the piece seen from the front, like a roof board.</p>
          </>
        )}
      </Section>

      {letters ? (
        <Section title="Letters" disabled={locked}>
          <label className="block text-[11px] text-muted">
            Characters
            <input
              key={`${part.id}:${part.label ?? ""}`}
              defaultValue={part.label ?? ""}
              aria-label="Letters"
              className="field mt-1 !h-7 !rounded-md !px-2 !py-1 !text-[12px] !shadow-none font-normal tracking-normal text-ink normal-case"
              onBlur={(event) => {
                const label = event.currentTarget.value.trim();
                if (label && label !== part.label) change({ label });
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </label>
          <p className="pt-1.5 text-[10px] leading-3 text-subtle">Real outlines, holes included. A space keeps letters apart, as in S I C.</p>
        </Section>
      ) : null}

      <Section title="Size, mm" disabled={locked}>
        <div className="grid grid-cols-3 gap-1">
          {cylinder ? (
            <NumberField dense prefix="Ø" label="Diameter" value={part.width} onCommit={(width) => change({ width })} />
          ) : (
            <NumberField dense prefix="W" label={letters ? "Row width" : "Width"} value={part.width} onCommit={(width) => change({ width })} />
          )}
          <NumberField dense prefix="H" label={letters ? "Letter height" : "Height"} value={part.height} onCommit={(height) => change({ height })} />
          {cylinder ? null : <NumberField dense prefix="D" label={letters ? "Thickness" : "Depth"} value={part.depth} onCommit={(depth) => change({ depth })} />}
        </div>
        <p className="pt-1.5 text-[10px] leading-3 text-subtle">↑↓ steps 10. Shift ×100. Alt ×1.</p>
      </Section>

      {cylinder ? (
        <Section title="Round" disabled={locked}>
          <div className="grid grid-cols-3 gap-1">
            <NumberField dense prefix="Ø" label="Top diameter" value={part.round?.top ?? part.width} allowZero onCommit={(top) => commitRound("top", top)} />
            <NumberField dense prefix="Wall" label="Wall thickness" value={part.round?.wall ?? 0} allowZero onCommit={(wall) => commitRound("wall", wall)} />
            <NumberField dense prefix="Sweep" label="Sweep" value={part.round?.sweep ?? 360} suffix="°" onCommit={(sweep) => commitRound("sweep", sweep)} />
          </div>
          <p className="pt-1.5 text-[10px] leading-3 text-subtle">Top Ø 0 is a cone. Equal to the diameter is plain. Wall 0 is solid. Sweep 360 is the whole circle.</p>
          <p className="pt-1.5 pb-1 text-[10px] text-subtle">Profile</p>
          <div role="group" aria-label="Profile" className="grid grid-cols-4 gap-1">
            {roundProfiles(part.width, part.height).map((preset) => {
              const active = outlineKey(part.round?.profile) === outlineKey(preset.profile);
              return (
                <button key={preset.label} type="button" aria-pressed={active} onClick={() => commitProfile(preset.profile)} className={choiceButton(active)}>
                  {preset.label}
                </button>
              );
            })}
          </div>
          {part.round?.profile ? (
            <>
              <div className="mt-1.5 space-y-1">
                {part.round.profile.map((point, index) => (
                  <OutlinePoint
                    key={index}
                    index={index}
                    point={point}
                    canRemove={(part.round?.profile?.length ?? 0) > 2}
                    onX={(x) => {
                      const profile = part.round?.profile;
                      if (!profile) return;
                      commitProfile(profile.map((item, i) => (i === index ? pointAt(item, x, item[1]) : item)));
                    }}
                    onY={(y) => {
                      const profile = part.round?.profile;
                      if (!profile) return;
                      commitProfile(profile.map((item, i) => (i === index ? pointAt(item, item[0], y) : item)));
                    }}
                    onCurve={(bulge) => {
                      const profile = part.round?.profile;
                      if (!profile) return;
                      commitProfile(profile.map((item, i) => (i === index ? pointCurve(item, bulge) : item)));
                    }}
                    onRemove={() => {
                      const profile = part.round?.profile;
                      if (!profile) return;
                      commitProfile(profile.filter((_, i) => i !== index));
                    }}
                  />
                ))}
              </div>
              <div className="pt-1.5">
                <button
                  type="button"
                  disabled={part.round.profile.length >= 48}
                  onClick={() => {
                    const profile = part.round?.profile;
                    if (!profile || profile.length < 2) return;
                    commitProfile([...profile, midwayPoint(profile)]);
                  }}
                  className={addButton}
                >
                  Add point
                </button>
              </div>
              <p className="pt-1.5 text-[10px] leading-3 text-subtle">X is the radius from the axis, Y the height from the bottom. A profile replaces the top diameter.</p>
            </>
          ) : (
            <p className="pt-1.5 text-[10px] leading-3 text-subtle">A turned shape, bottom to top. It replaces the top diameter.</p>
          )}
        </Section>
      ) : null}

      {tube ? (
        <Section title="Path" disabled={locked}>
          <div role="group" aria-label="Path face" className="grid grid-cols-3 gap-1">
            {SHAPED_FACE_OPTIONS.map((option) => (
              <button key={option.face} type="button" aria-pressed={shaped.face === option.face} onClick={() => change({ face: option.face })} className={choiceButton(shaped.face === option.face)}>
                {option.label}
              </button>
            ))}
          </div>
          <p className="pt-1.5 text-[10px] leading-3 text-subtle">
            {faceOption.label}: {Math.round(shaped.width)} × {Math.round(shaped.height)} mm, {faceOption.seen}
          </p>
          <p className="pt-1.5 pb-1 text-[10px] text-subtle">Diameter, mm</p>
          <div className="grid grid-cols-3 gap-1">
            <NumberField
              dense
              prefix="Ø"
              label="Diameter"
              value={shaped.thickness}
              onCommit={(size) => {
                if (shaped.face === "top") change({ height: size });
                else if (shaped.face === "side") change({ width: size });
                else change({ depth: size });
              }}
            />
          </div>
          <label className="mt-1.5 flex h-6 cursor-pointer items-center gap-1.5 text-[11px] text-ink">
            <input type="checkbox" checked={Boolean(part.closed)} onChange={(event) => change({ closed: event.currentTarget.checked })} className="size-3 accent-[var(--color-accent)]" />
            Closed loop
          </label>
          <div role="group" aria-label="Path shape" className="grid grid-cols-4 gap-1 pt-1.5">
            {tubePaths(shaped.width, shaped.height).map((preset) => {
              const active = Boolean(part.closed) === preset.closed && outlineKey(tubePath) === outlineKey(preset.path);
              return (
                <button key={preset.label} type="button" aria-pressed={active} onClick={() => change({ path: preset.path, closed: preset.closed })} className={choiceButton(active)}>
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="pt-1.5">
            <OutlinePreview face={shaped.face} label={faceOption.label} width={shaped.width} height={shaped.height} points={tubePath} />
          </div>
          <div className="mt-1.5 space-y-1">
            {tubePath.map((point, index) => (
              <OutlinePoint
                key={index}
                index={index}
                point={point}
                canRemove={tubePath.length > 2}
                onX={(x) => change({ path: tubePath.map((item, i) => (i === index ? pointAt(item, x, item[1]) : item)) })}
                onY={(y) => change({ path: tubePath.map((item, i) => (i === index ? pointAt(item, item[0], y) : item)) })}
                onCurve={(bulge) => change({ path: tubePath.map((item, i) => (i === index ? pointCurve(item, bulge) : item)) })}
                onRemove={() => change({ path: tubePath.filter((_, i) => i !== index) })}
              />
            ))}
          </div>
          <div className="pt-1.5">
            <button type="button" disabled={tubePath.length >= 48} onClick={() => change({ path: [...tubePath, midwayPoint(tubePath)] })} className={addButton}>
              Add point
            </button>
          </div>
          <p className="pt-1.5 text-[10px] leading-3 text-subtle">From the bottom-left of the {faceOption.label.toLowerCase()} face. Curve bends the run to the next point.</p>
        </Section>
      ) : null}

      {part.shape === "box" ? (
        <Section title="Curve" disabled={locked}>
          <label className="flex h-6 cursor-pointer items-center gap-1.5 text-[11px] text-ink">
            <input
              type="checkbox"
              checked={Boolean(part.curve)}
              onChange={(event) => {
                if (event.currentTarget.checked) {
                  const thickness = part.depth <= 50 ? part.depth : 18;
                  const curve: Curve = { thickness, toward: "front" };
                  change(part.depth <= 50 ? { curve, depth: Math.round(part.width / 4) } : { curve });
                } else if (part.curve) {
                  change({ curve: null, depth: part.curve.thickness });
                }
              }}
              className="size-3 accent-[var(--color-accent)]"
            />
            Bent panel
          </label>
          {part.curve ? (
            <>
              <p className="pt-1.5 pb-1 text-[10px] text-subtle">Thickness, mm</p>
              <div className="grid grid-cols-3 gap-1">
                <NumberField
                  dense
                  prefix="T"
                  label="Thickness, mm"
                  value={part.curve.thickness}
                  onCommit={(thickness) => {
                    if (!part.curve) return;
                    change({ curve: { ...part.curve, thickness } });
                  }}
                />
              </div>
              <ChoiceRow
                label="Curve seen from"
                options={[
                  ["height", "Above"],
                  ["depth", "Front"],
                ]}
                value={part.curve.axis ?? "height"}
                onPick={(axis) => part.curve && change({ curve: { thickness: part.curve.thickness, axis, ...(part.curve.corner ? { corner: part.curve.corner } : {}) } })}
              />
              <ChoiceRow
                label="Shape"
                options={[
                  ["bow", "Bow"],
                  ["corner", "Quarter corner"],
                ]}
                value={part.curve.corner ? "corner" : "bow"}
                onPick={(shape) => {
                  if (!part.curve) return;
                  const { corner: _corner, toward: _toward, ...rest } = part.curve;
                  change({ curve: shape === "corner" ? { ...rest, corner: "topRight" } : rest });
                }}
              />
              {part.curve.corner ? (
                <ChoiceRow
                  label="Rounds the corner at"
                  options={[
                    ["topLeft", "Top left"],
                    ["topRight", "Top right"],
                    ["bottomLeft", "Bottom left"],
                    ["bottomRight", "Bottom right"],
                  ]}
                  value={part.curve.corner}
                  onPick={(corner) => part.curve && change({ curve: { ...part.curve, corner } })}
                />
              ) : (
                <ChoiceRow
                  label="Bows toward"
                  options={
                    part.curve.axis === "depth"
                      ? [
                          ["up", "Up"],
                          ["down", "Down"],
                        ]
                      : [
                          ["front", "Front"],
                          ["back", "Back"],
                        ]
                  }
                  value={part.curve.toward ?? (part.curve.axis === "depth" ? "up" : "front")}
                  onPick={(toward) => part.curve && change({ curve: { ...part.curve, toward } })}
                />
              )}
              {blank && bend ? (
                <p className="pt-1.5 text-[10px] leading-3 text-subtle">
                  Flat blank {blank.width} × {Math.round(blank.height)} × {Math.round(blank.depth)} mm · turns {Math.round(bend.sweep)}°
                </p>
              ) : null}
              <p className="pt-1 text-[10px] leading-3 text-subtle">A bent panel has no corners or openings.</p>
            </>
          ) : null}
        </Section>
      ) : null}

      {part.shape === "box" && !part.curve ? (
        <Section title="Shaped face" disabled={locked}>
          <div role="group" aria-label="Shaped face" className="grid grid-cols-3 gap-1">
            {SHAPED_FACE_OPTIONS.map((option) => (
              <button
                key={option.face}
                type="button"
                aria-pressed={shaped.face === option.face}
                onClick={() => change({ face: option.face })}
                className={choiceButton(shaped.face === option.face)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="pt-1.5 text-[10px] leading-3 text-subtle">
            {faceOption.label}: {Math.round(shaped.width)} × {Math.round(shaped.height)} mm, {faceOption.seen}
          </p>
        </Section>
      ) : null}

      {part.shape === "box" && !part.curve ? (
        <Section title="Outline, mm" disabled={locked}>
          {part.outline ? (
            <>
              <OutlinePreview face={shaped.face} label={faceOption.label} width={shaped.width} height={shaped.height} points={part.outline} />
              <div className="mt-1.5 space-y-1">
                {part.outline.map((point, index) => (
                  <OutlinePoint
                    key={index}
                    index={index}
                    point={point}
                    canRemove={part.outline !== undefined && part.outline.length > 3}
                    onX={(x) => {
                      if (!part.outline) return;
                      change({ outline: part.outline.map((item, i) => (i === index ? pointAt(item, x, item[1]) : item)) });
                    }}
                    onY={(y) => {
                      if (!part.outline) return;
                      change({ outline: part.outline.map((item, i) => (i === index ? pointAt(item, item[0], y) : item)) });
                    }}
                    onCurve={(bulge) => {
                      if (!part.outline) return;
                      change({ outline: part.outline.map((item, i) => (i === index ? pointCurve(item, bulge) : item)) });
                    }}
                    onRemove={() => {
                      if (!part.outline) return;
                      change({ outline: part.outline.filter((_, i) => i !== index) });
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-1 pt-1.5">
                <button
                  type="button"
                  disabled={part.outline.length >= 32}
                  onClick={() => {
                    if (!part.outline) return;
                    change({ outline: addedOutline(part.outline, shaped.width, shaped.height) });
                  }}
                  className={addButton}
                >
                  Add point
                </button>
                <button type="button" onClick={() => change({ outline: null })} className={addButton}>
                  Back to rectangle
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!part.outline) return;
                    change({ outline: roundedOutline(part.outline) });
                  }}
                  className={addButton}
                >
                  Round all
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!part.outline) return;
                    change({ outline: straightOutline(part.outline) });
                  }}
                  className={addButton}
                >
                  Straighten
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] leading-3 text-subtle">Any straight-edged shape on the {faceOption.label.toLowerCase()} face, such as a sloping side with a toe step.</p>
              <div className="pt-1.5">
                <button type="button" onClick={() => change({ outline: starterOutline(shaped.width, shaped.height) })} className={addButton}>
                  Draw outline
                </button>
              </div>
            </>
          )}
        </Section>
      ) : null}

      {part.shape === "box" && !part.curve && part.outline ? (
        <p className="border-b border-line/80 px-2 py-1.5 text-[10px] leading-3 text-subtle">Corners and straight cuts are part of the outline.</p>
      ) : null}

      {part.shape === "box" && !part.curve && !part.outline ? (
        <Section title={`${faceOption.label} corners, mm`} disabled={locked}>
          <div className="grid grid-cols-2 gap-1">
            <NumberField dense prefix="TL" label={`${corners.topLeft} radius`} value={part.corners?.topLeft ?? 0} allowZero onCommit={(topLeft) => setCorner("topLeft", topLeft)} />
            <NumberField dense prefix="TR" label={`${corners.topRight} radius`} value={part.corners?.topRight ?? 0} allowZero onCommit={(topRight) => setCorner("topRight", topRight)} />
            <NumberField dense prefix="BL" label={`${corners.bottomLeft} radius`} value={part.corners?.bottomLeft ?? 0} allowZero onCommit={(bottomLeft) => setCorner("bottomLeft", bottomLeft)} />
            <NumberField dense prefix="BR" label={`${corners.bottomRight} radius`} value={part.corners?.bottomRight ?? 0} allowZero onCommit={(bottomRight) => setCorner("bottomRight", bottomRight)} />
          </div>
          {shaped.face !== "front" ? <p className="pt-1 text-[10px] leading-3 text-subtle">TL {corners.topLeft.toLowerCase()}, TR {corners.topRight.toLowerCase()}, BL {corners.bottomLeft.toLowerCase()}, BR {corners.bottomRight.toLowerCase()}.</p> : null}
          <p className="pt-1.5 text-[10px] leading-3 text-subtle">0 keeps that corner square. A radius is a curve.</p>
        </Section>
      ) : null}

      {part.shape === "box" && !part.curve && !part.outline ? (
        <Section title="Straight cuts, mm" disabled={locked}>
          <div className="space-y-1">
            <CutRow label={corners.topLeft} across={part.chamfers?.topLeft?.x ?? 0} down={part.chamfers?.topLeft?.y ?? 0} onAcross={(x) => setCut("topLeft", "x", x)} onDown={(y) => setCut("topLeft", "y", y)} />
            <CutRow label={corners.topRight} across={part.chamfers?.topRight?.x ?? 0} down={part.chamfers?.topRight?.y ?? 0} onAcross={(x) => setCut("topRight", "x", x)} onDown={(y) => setCut("topRight", "y", y)} />
            <CutRow label={corners.bottomLeft} across={part.chamfers?.bottomLeft?.x ?? 0} down={part.chamfers?.bottomLeft?.y ?? 0} onAcross={(x) => setCut("bottomLeft", "x", x)} onDown={(y) => setCut("bottomLeft", "y", y)} />
            <CutRow label={corners.bottomRight} across={part.chamfers?.bottomRight?.x ?? 0} down={part.chamfers?.bottomRight?.y ?? 0} onAcross={(x) => setCut("bottomRight", "x", x)} onDown={(y) => setCut("bottomRight", "y", y)} />
          </div>
          <p className="pt-1.5 text-[10px] leading-3 text-subtle">A straight line instead of a curve. Across is the top or bottom, down is the side.</p>
        </Section>
      ) : null}

      {part.shape === "box" && !part.curve ? (
        <Section title="Openings, mm" disabled={locked}>
          {openings.length > 0 ? (
            <div className="space-y-1.5">
              {openings.map((hole, index) => (
                <OpeningRow
                  key={index}
                  index={index}
                  hole={hole}
                  onChange={(next) => change({ holes: openings.map((item, i) => (i === index ? next : item)) })}
                  onRemove={() => change({ holes: openings.filter((_, i) => i !== index) })}
                />
              ))}
            </div>
          ) : null}
          <div className={`flex flex-wrap gap-1 ${openings.length > 0 ? "pt-1.5" : ""}`}>
            <button
              type="button"
              onClick={() => {
                const outer = Math.min(shaped.width, shaped.height) / 2;
                change({ corners: { topLeft: outer, topRight: outer, bottomLeft: outer, bottomRight: outer }, chamfers: {}, holes: [ringHole(shaped.width, shaped.height)] });
              }}
              className={addButton}
            >
              Make ring
            </button>
            <button
              type="button"
              onClick={() => change({ corners: { topLeft: shaped.width / 2, topRight: shaped.width / 2 }, chamfers: {}, holes: [archHole(shaped.width, shaped.height)] })}
              className={addButton}
            >
              Make arch
            </button>
            <button type="button" disabled={!canAdd} onClick={() => change({ holes: [...openings, windowHole(shaped.width, shaped.height)] })} className={addButton}>
              Add window
            </button>
          </div>
        </Section>
      ) : null}

      <Section title="Appearance" disabled={locked}>
        <p className="pb-1 text-[10px] text-subtle">Fill</p>
        <ColorField inspector value={color} onChange={(next) => change({ color: next })} />
        <p className="pt-2 pb-1 text-[10px] text-subtle">Material</p>
        <MaterialChips value={part.material ?? "paint"} sheet={part.materialId ?? null} onChange={(changes) => change(changes)} />
      </Section>

      {part.shape === "mesh" ? null : (
        <Section title="Images" disabled={locked}>
          <ImagesEditor part={part} images={part.images ?? []} onChange={(images, key) => change({ images }, key ? `${part.id}:${key}` : undefined)} />
        </Section>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------
 * Inspector: several pieces
 * ------------------------------------------------------------------------------------------- */

function BulkInspector({
  document,
  selected,
  onDocument,
  onSelect,
}: {
  document: DesignDocument;
  selected: ScenePart[];
  onDocument: Commit;
  onSelect: (ids: string[]) => void;
}) {
  const ids = selected.map((part) => part.id);
  const groupIds = new Set(selected.map((part) => part.group));
  const wholeGroup =
    groupIds.size === 1 && selected[0].group && document.parts.filter((part) => part.group === selected[0].group).length === selected.length
      ? selected[0].group
      : null;
  const anyGrouped = selected.some((part) => part.group);
  const unlocked = selected.filter((part) => !part.locked).length;

  const colors = new Set(selected.map((part) => hexColor(part.color)));
  const sharedColor = colors.size === 1 ? [...colors][0] : null;
  const materials = new Set(selected.map((part) => part.material ?? "paint"));
  const sharedMaterial = materials.size === 1 ? [...materials][0] : null;
  const sheets = new Set(selected.map((part) => part.materialId ?? ""));
  const sharedSheet = sheets.size === 1 ? [...sheets][0] || null : null;

  function change(changes: PartChanges, key?: string) {
    onDocument(updateParts(document, ids, changes), key);
  }

  const align = (axis: "x" | "y" | "z", edge: AlignEdge) => () => onDocument(alignParts(document, ids, axis, edge));

  return (
    <div className="animate-rise">
      <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <div className="min-w-0">
          <p className="text-[12px] font-medium text-ink">{selected.length} pieces</p>
          <p className="text-[10px] text-subtle">
            {unlocked < selected.length ? `${selected.length - unlocked} locked, left unchanged.` : "Changes apply to all."}
          </p>
        </div>
      </div>
      {wholeGroup ? (
        <div className="border-b border-line px-2 py-1.5">
          <label className="block text-[11px] text-muted">
            Group name
            <input
              key={wholeGroup + (document.groups?.[wholeGroup] ?? "")}
              defaultValue={document.groups?.[wholeGroup] ?? ""}
              onBlur={(event) => onDocument(renameGroup(document, wholeGroup, event.currentTarget.value))}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
              className="field mt-1 !h-7 !rounded-md !px-2 !py-1 !text-[12px] !shadow-none font-normal tracking-normal text-ink normal-case"
            />
          </label>
        </div>
      ) : null}

      <Section title="Align">
        <div className="flex flex-col gap-1">
          <Segment>
            <IconButton flat label="Align left" Icon={AlignStartVertical} onClick={align("x", "min")} disabled={unlocked < 2} />
            <IconButton flat label="Center across" Icon={AlignCenterVertical} onClick={align("x", "center")} disabled={unlocked < 2} />
            <IconButton flat label="Align right" Icon={AlignEndVertical} onClick={align("x", "max")} disabled={unlocked < 2} />
          </Segment>
          <Segment>
            <IconButton flat label="Align back" Icon={AlignStartHorizontal} onClick={align("z", "min")} disabled={unlocked < 2} />
            <IconButton flat label="Center front to back" Icon={AlignCenterHorizontal} onClick={align("z", "center")} disabled={unlocked < 2} />
            <IconButton flat label="Align front" Icon={AlignEndHorizontal} onClick={align("z", "max")} disabled={unlocked < 2} />
          </Segment>
          <Segment>
            <IconButton flat label="Space evenly left to right" Icon={AlignHorizontalSpaceBetween} onClick={() => onDocument(distributeParts(document, ids, "x"))} disabled={unlocked < 3} />
            <IconButton flat label="Space evenly back to front" Icon={AlignVerticalSpaceBetween} onClick={() => onDocument(distributeParts(document, ids, "z"))} disabled={unlocked < 3} />
            <IconButton flat label="Drop to floor" Icon={ArrowDownToLine} onClick={() => onDocument(dropToFloor(document, ids))} />
          </Segment>
        </div>
      </Section>

      <Section title="Appearance">
        <p className="pb-1 text-[10px] text-subtle">Fill</p>
        <ColorField inspector value={sharedColor} onChange={(next, key) => change({ color: next }, key ? "bulk-color" : undefined)} />
        <p className="pt-2 pb-1 text-[10px] text-subtle">Material</p>
        <MaterialChips value={sheets.size === 1 ? sharedMaterial : null} sheet={sharedSheet} onChange={(changes) => change(changes)} />
      </Section>

      <Section title="Actions">
        <div className="flex flex-wrap gap-1.5">
          <ActionButton
            label="Duplicate"
            Icon={Copy}
            onClick={() => {
              const copy = duplicateParts(document, ids);
              onDocument(copy.document);
              onSelect(copy.ids);
            }}
          />
          {wholeGroup ? null : <ActionButton label="Group" Icon={Group} onClick={() => onDocument(groupParts(document, ids, "Group").document)} />}
          {anyGrouped ? <ActionButton label="Ungroup" Icon={Ungroup} onClick={() => onDocument(ungroupParts(document, ids))} /> : null}
          <ActionButton
            label="Delete"
            Icon={Trash}
            danger
            onClick={() => {
              onDocument(removeParts(document, ids));
              onSelect([]);
            }}
          />
        </div>
      </Section>
    </div>
  );
}

const addButton =
  "flex h-6 items-center rounded px-1.5 text-[11px] font-medium text-ink transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent";

function ringHole(width: number, height: number): Hole {
  const size = Math.max(1, Math.round(Math.min(width, height) * 0.8));
  return {
    x: Math.round((width - size) / 2),
    y: Math.round((height - size) / 2),
    width: size,
    height: size,
    corners: { topLeft: size / 2, topRight: size / 2, bottomLeft: size / 2, bottomRight: size / 2 },
  };
}

function archHole(width: number, height: number): Hole {
  const holeWidth = Math.max(1, Math.round(width * 0.7));
  return {
    x: Math.round((width - holeWidth) / 2),
    y: 0,
    width: holeWidth,
    // Shares its curve's center with the outer top, so the band of board stays the same all round.
    height: Math.max(1, Math.round(height - width * 0.15)),
    corners: { topLeft: holeWidth / 2, topRight: holeWidth / 2 },
  };
}

function windowHole(width: number, height: number): Hole {
  const holeWidth = Math.max(1, Math.round(width * 0.4));
  const holeHeight = Math.max(1, Math.round(height * 0.4));
  return {
    x: Math.round((width - holeWidth) / 2),
    y: Math.round((height - holeHeight) / 2),
    width: holeWidth,
    height: holeHeight,
  };
}

function OpeningRow({ index, hole, onChange, onRemove }: { index: number; hole: Hole; onChange: (hole: Hole) => void; onRemove: () => void }) {
  const n = index + 1;
  return (
    <div className="grid grid-cols-4 items-center gap-1">
      <NumberField dense prefix="X" label={`Opening ${n} left`} value={hole.x} allowZero onCommit={(x) => onChange({ ...hole, x })} />
      <NumberField dense prefix="Y" label={`Opening ${n} bottom`} value={hole.y} allowZero onCommit={(y) => onChange({ ...hole, y })} />
      <NumberField dense prefix="W" label={`Opening ${n} width`} value={hole.width} onCommit={(width) => onChange({ ...hole, width })} />
      <NumberField dense prefix="H" label={`Opening ${n} height`} value={hole.height} onCommit={(height) => onChange({ ...hole, height })} />
      <NumberField
        dense
        prefix="R"
        label={`Opening ${n} corner radius`}
        value={hole.corners?.topLeft ?? 0}
        allowZero
        onCommit={(radius) => {
          if (radius > 0) onChange({ ...hole, corners: { topLeft: radius, topRight: radius, bottomLeft: radius, bottomRight: radius } });
          else {
            const next = { ...hole };
            delete next.corners;
            onChange(next);
          }
        }}
      />
      <div className="col-span-3 flex justify-end">
        <IconButton label={`Remove opening ${n}`} Icon={Trash} onClick={onRemove} />
      </div>
    </div>
  );
}

function starterOutline(width: number, height: number): Outline {
  const w = Math.round(width);
  const h = Math.round(height);
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [Math.round(width * 0.4), h],
    [0, Math.round(height * 0.6)],
  ];
}

/** Halfway along the edge that closes the shape. Set in a little, or the engine drops a point that sits on a straight run. */
function addedOutline(outline: Outline, width: number, height: number): Outline {
  const a = outline[outline.length - 1];
  const b = outline[0];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const inset = Math.max(1, Math.min(8, Math.min(width, height) / 4));
  const x = Math.min(width, Math.max(0, Math.round((a[0] + b[0]) / 2 - (dy / len) * inset)));
  const y = Math.min(height, Math.max(0, Math.round((a[1] + b[1]) / 2 + (dx / len) * inset)));
  return [...outline, [x, y]];
}

/** Keep a point's curve when only its place on the face changes. */
function pointAt(point: Outline[number], x: number, y: number): Outline[number] {
  return point.length === 3 ? [x, y, point[2]] : [x, y];
}

/** 0 is a straight edge and is stored without a third number. */
function pointCurve(point: Outline[number], bulge: number): Outline[number] {
  const next = Math.max(-4, Math.min(4, bulge));
  return Math.abs(next) < 0.001 ? [point[0], point[1]] : [point[0], point[1], Math.round(next * 1000) / 1000];
}

/** A gentle outward bend on every edge that is not the face bottom. */
function roundedOutline(outline: Outline): Outline {
  return outline.map((point, index) => {
    const next = outline[(index + 1) % outline.length];
    return point[1] === 0 && next[1] === 0 ? [point[0], point[1]] : [point[0], point[1], 0.6];
  });
}

function straightOutline(outline: Outline): Outline {
  return outline.map((point) => [point[0], point[1]]);
}

function midwayPoint(points: Outline): Outline[number] {
  const a = points[points.length - 2] ?? points[points.length - 1] ?? [0, 0];
  const b = points[points.length - 1] ?? [0, 0];
  return [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
}

function outlineKey(points: Outline | null | undefined) {
  if (!points?.length) return "";
  return points.map((point) => `${Math.round(point[0] * 10) / 10},${Math.round(point[1] * 10) / 10},${Math.round((point[2] ?? 0) * 1000) / 1000}`).join(" ");
}

function roundProfiles(width: number, height: number): { label: string; profile: Outline | null }[] {
  const w = width;
  const h = height;
  return [
    { label: "None", profile: null },
    { label: "Dome", profile: [[w / 2, 0, 0.414], [0, h]] },
    { label: "Ball", profile: [[0, 0, 1], [0, h]] },
    { label: "Vase", profile: [[w * 0.3, 0], [w / 2, h * 0.4, 0.3], [w * 0.2, h * 0.8, -0.3], [w * 0.3, h]] },
  ];
}

function tubePaths(width: number, height: number): { label: string; closed: boolean; path: Outline }[] {
  const w = width;
  const h = height;
  return [
    { label: "Straight", closed: false, path: [[0, h / 2], [w, h / 2]] },
    { label: "Arch", closed: false, path: [[w, 0, 1], [0, 0]] },
    { label: "Hoop", closed: true, path: [[0, h / 2, 1], [w, h / 2, 1]] },
    {
      label: "Zigzag",
      closed: false,
      path: [
        [0, h * 0.25],
        [w * 0.25, h * 0.75],
        [w * 0.5, h * 0.25],
        [w * 0.75, h * 0.75],
        [w, h * 0.25],
      ],
    },
  ];
}

function OutlinePoint({
  index,
  point,
  canRemove,
  onX,
  onY,
  onCurve,
  onRemove,
}: {
  index: number;
  point: Outline[number];
  canRemove: boolean;
  onX: (value: number) => void;
  onY: (value: number) => void;
  onCurve: (value: number) => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  return (
    <div className="grid grid-cols-[16px_minmax(0,1fr)_minmax(0,1fr)_4.5rem_22px] items-center gap-0.5">
      <span className="text-center text-[10px] leading-3 text-muted">{n}</span>
      <NumberField dense prefix="X" label={`Point ${n} across`} value={point[0]} allowZero onCommit={onX} />
      <NumberField dense prefix="Y" label={`Point ${n} up`} value={point[1]} allowZero onCommit={onY} />
      <NumberField
        dense
        prefix="Curve"
        label="Bends the edge to the next point: 1 half circle, 0.41 quarter, minus cuts inward"
        value={point[2] ?? 0}
        allowZero
        allowNegative
        step={0.05}
        onCommit={onCurve}
      />
      <IconButton label={`Remove point ${n}`} Icon={X} disabled={!canRemove} onClick={onRemove} />
    </div>
  );
}

function OutlinePreview({ face, label, width, height, points }: { face: ShapedFace; label: string; width: number; height: number; points: Outline }) {
  if (!(width > 0) || !(height > 0)) return null;
  const drawH = 120;
  const drawW = (width / height) * drawH;
  const capTop = face === "top" ? 13 : 0;
  const capBottom = face === "front" ? 0 : 13;
  const svgW = drawW;
  const svgH = capTop + drawH + capBottom;
  const sx = (x: number) => (x / width) * drawW;
  const sy = (y: number) => capTop + drawH - (y / height) * drawH;
  const midX = drawW / 2;
  const midY = capTop + drawH / 2;
  const ring = outlineRing(points);
  return (
    <svg viewBox={`0 0 ${svgW} ${svgH}`} width={svgW} height={svgH} role="img" aria-label={`${label} outline`} className="block h-auto max-w-full text-ink">
      <rect x={0} y={capTop} width={drawW} height={drawH} fill="none" stroke="currentColor" strokeWidth={1} strokeDasharray="3 2" className="text-subtle" />
      <polygon points={ring.map(([x, y]) => `${sx(x)},${sy(y)}`).join(" ")} fill="currentColor" fillOpacity={0.16} stroke="currentColor" strokeWidth={1.25} className="text-accent" />
      {points.map(([x, y], index) => {
        const px = sx(x);
        const py = sy(y);
        const dx = midX - px;
        const dy = midY - py;
        const len = Math.hypot(dx, dy) || 1;
        return (
          <text key={index} x={px + (dx / len) * 8} y={py + (dy / len) * 8} fontSize={8} textAnchor="middle" dominantBaseline="central" fill="currentColor">
            {index + 1}
          </text>
        );
      })}
      {face === "side" ? (
        <>
          <text x={0} y={svgH - 2} fontSize={8} fill="currentColor" className="text-subtle">
            front
          </text>
          <text x={drawW} y={svgH - 2} fontSize={8} textAnchor="end" fill="currentColor" className="text-subtle">
            back
          </text>
        </>
      ) : null}
      {face === "top" ? (
        <>
          <text x={drawW / 2} y={9} fontSize={8} textAnchor="middle" fill="currentColor" className="text-subtle">
            back
          </text>
          <text x={drawW / 2} y={svgH - 2} fontSize={8} textAnchor="middle" fill="currentColor" className="text-subtle">
            front
          </text>
        </>
      ) : null}
    </svg>
  );
}

function CutRow({
  label,
  across,
  down,
  onAcross,
  onDown,
}: {
  label: string;
  across: number;
  down: number;
  onAcross: (value: number) => void;
  onDown: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-[52px_1fr_1fr] items-center gap-1">
      <span className="text-[10px] leading-3 text-muted">{label}</span>
      <NumberField dense prefix="X" label={`${label} across`} value={across} allowZero onCommit={onAcross} />
      <NumberField dense prefix="Y" label={`${label} down`} value={down} allowZero onCommit={onDown} />
    </div>
  );
}

function hexColor(color: string | undefined) {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_COLOR;
}

/** Resize the whole stand by scaling every piece on one axis. */
function scaleScene(document: DesignDocument, axis: "width" | "depth" | "height", nextSize: number) {
  const current = document.envelope[axis];
  if (!(current > 0) || !(nextSize > 0)) return document;
  const factor = nextSize / current;
  const parts = document.parts.map((part) => {
    if (axis === "width") {
      const width = Math.max(1, Math.round(part.width * factor));
      if (part.shape === "cylinder") return { ...part, x: Math.round(part.x * factor), width, depth: width };
      return { ...part, x: Math.round(part.x * factor), width };
    }
    if (axis === "depth") {
      if (part.shape === "cylinder") {
        const width = Math.max(1, Math.round(part.width * factor));
        return { ...part, z: Math.round(part.z * factor), width, depth: width };
      }
      return { ...part, z: Math.round(part.z * factor), depth: Math.max(1, Math.round(part.depth * factor)) };
    }
    return { ...part, y: Math.round(part.y * factor), height: Math.max(1, Math.round(part.height * factor)) };
  });
  return applyDesignPatch(document, { parts });
}
