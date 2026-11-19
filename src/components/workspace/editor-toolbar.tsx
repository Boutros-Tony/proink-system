"use client";

import { Check, Copy, Group, Magnet, Move3d, Rotate3d, Scale3d, Trash, Ungroup, type LucideIcon } from "lucide-react";
import { ColorField } from "@/components/workspace/color-field";
import { GRID_STEPS, type GizmoMode, type SnapSetting } from "@/components/workspace/editor-types";
import { NumberField } from "@/components/workspace/fields";
import { Menu } from "@/components/workspace/menu";
import type { PartChanges, PartMaterial, ScenePart } from "@/lib/systems/modular/schema";

const MODES: Array<{ id: GizmoMode; label: string; key: string; Icon: LucideIcon }> = [
  { id: "move", label: "Move", key: "W", Icon: Move3d },
  { id: "rotate", label: "Rotate", key: "E", Icon: Rotate3d },
  { id: "scale", label: "Resize", key: "R", Icon: Scale3d },
];

const MATERIALS: { id: PartMaterial; label: string }[] = [
  { id: "paint", label: "Paint" },
  { id: "mdf", label: "MDF" },
  { id: "wood", label: "Wood" },
  { id: "laminate", label: "Laminate" },
  { id: "metal", label: "Metal" },
  { id: "glass", label: "Glass" },
];

const FALLBACK_COLOR = "#f3efe6";

function ToolButton({
  label,
  shortcut,
  Icon,
  active = false,
  disabled = false,
  danger = false,
  onClick,
}: {
  label: string;
  shortcut?: string;
  Icon: LucideIcon;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-all disabled:cursor-not-allowed disabled:opacity-35 ${
        active
          ? "bg-accent text-on-accent shadow-brand"
          : danger
            ? "text-muted hover:bg-danger-soft hover:text-danger"
            : "text-muted hover:bg-raised hover:text-ink"
      }`}
    >
      <Icon size={16} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />;
}

function hexColor(color: string | undefined) {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : FALLBACK_COLOR;
}

/**
 * The bar at the bottom of the 3D view. It only shows while something is selected and holds the
 * edits people make most: color, material, name and size. Undo, redo and the rest stay on the keyboard.
 */
export function EditorToolbar({
  mode,
  onMode,
  snap,
  onSnap,
  parts,
  groupName,
  disabled,
  onChange,
  onRename,
  canResize,
  canGroup,
  canUngroup,
  onDuplicate,
  onDelete,
  onGroup,
  onUngroup,
}: {
  mode: GizmoMode;
  onMode: (mode: GizmoMode) => void;
  snap: SnapSetting;
  onSnap: (snap: SnapSetting) => void;
  parts: ScenePart[];
  /** Set when the selection is exactly one whole group. */
  groupName: string | null;
  /** Every selected piece is locked, so nothing here can change it. */
  disabled: boolean;
  onChange: (changes: PartChanges, key?: string) => void;
  onRename: (name: string) => void;
  canResize: boolean;
  canGroup: boolean;
  canUngroup: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onGroup: () => void;
  onUngroup: () => void;
}) {
  if (parts.length === 0) return null;

  const single = parts.length === 1 ? parts[0] : null;
  const colors = new Set(parts.map((part) => hexColor(part.color)));
  const sharedColor = colors.size === 1 ? [...colors][0] : null;
  const materials = new Set(parts.map((part) => part.material ?? "paint"));
  const sharedMaterial = materials.size === 1 ? [...materials][0] : null;
  const snapLabel = snap.grid > 0 ? `${snap.grid} mm` : "Free";

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
      <div className="animate-rise pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border border-line bg-panel/95 p-1.5 shadow-float backdrop-blur-md">
        {MODES.map(({ id, label, key, Icon }) => (
          <ToolButton
            key={id}
            label={label}
            shortcut={key}
            Icon={Icon}
            active={mode === id}
            disabled={id === "scale" && !canResize}
            onClick={() => onMode(id)}
          />
        ))}
        <Menu
          side="top"
          width="w-56"
          label={<Magnet size={15} strokeWidth={2} aria-hidden="true" className={snap.magnet || snap.grid > 0 ? "text-accent" : ""} />}
        >
          <div className="p-2">
            <p className="eyebrow px-2 py-1.5">Grid</p>
            {GRID_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => onSnap({ ...snap, grid: step })}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${snap.grid === step ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-raised hover:text-ink"}`}
              >
                {step === 0 ? "Free" : `${step} mm`}
                {snap.grid === step ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : null}
              </button>
            ))}
            <p className="eyebrow mt-2 px-2 py-1.5">Edges</p>
            <button
              type="button"
              onClick={() => onSnap({ ...snap, magnet: !snap.magnet })}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${snap.magnet ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-raised hover:text-ink"}`}
            >
              Stick to other pieces
              {snap.magnet ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : null}
            </button>
            <p className="px-2 pt-2 text-[11px] text-subtle">Snapping: {snapLabel}{snap.magnet ? ", edges on" : ""}</p>
          </div>
        </Menu>

        <Divider />

        <fieldset disabled={disabled} className={`m-0 flex min-w-0 items-center gap-1.5 border-0 p-0 ${disabled ? "opacity-50" : ""}`}>
          <ColorField compact value={sharedColor} onChange={(color, key) => onChange({ color }, key ?? "quick-color")} />
          <MaterialMenu value={sharedMaterial} onChange={(material) => onChange({ material })} />
          {single || groupName !== null ? (
            <NameField key={(groupName ?? single?.name ?? "") + parts.length} value={groupName ?? single?.name ?? ""} label={groupName !== null ? "Group name" : "Name"} onCommit={onRename} />
          ) : (
            <span className="px-1 text-xs font-medium text-muted">{parts.length} pieces</span>
          )}
          {single ? (
            <>
              <span className="mx-0.5 h-5 w-px bg-line" aria-hidden="true" />
              {single.shape === "cylinder" ? (
                <span className="w-20"><NumberField prefix="Ø" label="Diameter" value={single.width} onCommit={(width) => onChange({ width })} /></span>
              ) : (
                <span className="w-20"><NumberField prefix="W" label="Width" value={single.width} onCommit={(width) => onChange({ width })} /></span>
              )}
              <span className="w-20"><NumberField prefix="H" label="Height" value={single.height} onCommit={(height) => onChange({ height })} /></span>
              {single.shape === "cylinder" ? null : (
                <span className="w-20"><NumberField prefix="D" label="Depth" value={single.depth} onCommit={(depth) => onChange({ depth })} /></span>
              )}
            </>
          ) : (
            <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] font-semibold text-muted">{parts.length} pieces</span>
          )}
        </fieldset>

        <Divider />

        <ToolButton label="Duplicate" shortcut="Ctrl D" Icon={Copy} onClick={onDuplicate} />
        {canUngroup ? <ToolButton label="Ungroup" shortcut="Ctrl Shift G" Icon={Ungroup} onClick={onUngroup} /> : null}
        {canGroup ? <ToolButton label="Group" shortcut="Ctrl G" Icon={Group} onClick={onGroup} /> : null}
        <ToolButton label="Delete" shortcut="Del" Icon={Trash} danger disabled={disabled} onClick={onDelete} />
      </div>
    </div>
  );
}

function MaterialMenu({ value, onChange }: { value: PartMaterial | null; onChange: (material: PartMaterial) => void }) {
  const current = MATERIALS.find((material) => material.id === value);
  return (
    <Menu side="top" width="w-44" label={<span className="text-xs font-medium">{current ? current.label : "Mixed"}</span>}>
      <div className="p-1.5">
        {MATERIALS.map((material) => (
          <button
            key={material.id}
            type="button"
            onClick={() => onChange(material.id)}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${value === material.id ? "bg-accent-soft font-medium text-accent" : "text-muted hover:bg-raised hover:text-ink"}`}
          >
            {material.label}
            {value === material.id ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
    </Menu>
  );
}

function NameField({ value, label, onCommit }: { value: string; label: string; onCommit: (name: string) => void }) {
  return (
    <input
      aria-label={label}
      title={label}
      defaultValue={value}
      onBlur={(event) => {
        const name = event.currentTarget.value.trim();
        if (name && name !== value) onCommit(name);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className="w-36 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-ink outline-none hover:border-line focus:border-accent focus:bg-panel"
    />
  );
}
