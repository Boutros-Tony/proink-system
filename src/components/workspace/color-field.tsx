"use client";

import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export const SWATCHES = [
  "#ffffff",
  "#f4f1ea",
  "#c5bfb4",
  "#8b93ad",
  "#1c1b18",
  "#6e4b34",
  "#9d4036",
  "#e20000",
  "#f0a43a",
  "#148f6d",
  "#2f4d6f",
  "#0c2785",
];

const POPOVER_WIDTH = 248;
const POPOVER_HEIGHT = 250;

function normalizeHex(raw: string) {
  const text = raw.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(text)) {
    return `#${text.split("").map((char) => char + char).join("").toLowerCase()}`;
  }
  return /^[0-9a-fA-F]{6}$/.test(text) ? `#${text.toLowerCase()}` : null;
}

/**
 * A Figma-style fill row: a color chip and a hex box. Clicking the chip opens a popover
 * with swatches and a custom picker. `value` is null when several pieces have different colors.
 */
export function ColorField({
  value,
  onChange,
  compact = false,
  inspector = false,
}: {
  value: string | null;
  onChange: (color: string, key?: string) => void;
  /** Only the color chip, for tight toolbars. The popover is unchanged. */
  compact?: boolean;
  /** Flat row for the narrow properties panel. */
  inspector?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);
  const chipRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
  const mixed = value === null;
  const shown = (value ?? "").replace(/^#/, "").toUpperCase();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || chipRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = chipRef.current?.getBoundingClientRect();
    if (rect) {
      // Open beside the panel, like Figma. Fall back to below the chip if there is no room on the left.
      const room = rect.left - POPOVER_WIDTH - 16;
      const left = room >= 8 ? room : Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - 8));
      const top = Math.max(8, Math.min(rect.top - 8, window.innerHeight - POPOVER_HEIGHT - 8));
      setAnchor({ left, top });
    }
    setOpen(true);
  }

  function commitDraft(raw: string) {
    setDraft(null);
    const hex = normalizeHex(raw);
    if (hex && hex !== value) onChange(hex);
  }

  return (
    <div className="flex items-center gap-2">
      <div className={compact ? "flex" : inspector ? "flex h-[22px] items-center gap-1.5 rounded-[4px] border border-line bg-panel px-1" : "field flex items-center gap-2 py-1.5 pr-2.5 pl-1.5"}>
        <button
          ref={chipRef}
          type="button"
          aria-label="Choose color"
          title={mixed ? "Mixed colors" : (value ?? "").toUpperCase()}
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          onClick={toggle}
          className={`shrink-0 rounded-[3px] border border-black/10 ${compact ? "h-7 w-7" : inspector ? "h-3.5 w-3.5" : "h-6 w-6 rounded-md shadow-[inset_0_0_0_1px_rgb(255_255_255/0.5)] transition-transform hover:scale-105"}`}
          style={
            mixed
              ? { background: "conic-gradient(#e20000, #f0a43a, #148f6d, #0c2785, #e20000)" }
              : { background: value ?? undefined }
          }
        />
        {compact ? null : <span className={`font-mono text-subtle select-none ${inspector ? "text-[10px]" : "text-xs"}`}>#</span>}
        {compact ? null : <input
          aria-label="Hex color"
          value={draft ?? (mixed ? "" : shown)}
          placeholder={mixed ? "Mixed" : "RRGGBB"}
          maxLength={7}
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => {
            if (draft !== null) commitDraft(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setDraft(null);
              event.currentTarget.blur();
            }
          }}
          className={`min-w-0 flex-1 bg-transparent font-mono text-ink uppercase outline-none placeholder:text-subtle placeholder:normal-case ${inspector ? "text-[11px]" : "text-[13px] tracking-wide"}`}
        />}
      </div>
      {open && anchor
        ? createPortal(
            <div
              id={popoverId}
              ref={popoverRef}
              role="dialog"
              aria-label="Color"
              style={{ left: anchor.left, top: anchor.top, width: POPOVER_WIDTH }}
              className="animate-pop fixed z-50 rounded-2xl border border-line bg-panel p-3.5 shadow-pop"
            >
              <p className="eyebrow pb-2.5">Swatches</p>
              <div className="grid grid-cols-6 gap-2">
                {SWATCHES.map((swatch) => {
                  const active = value?.toLowerCase() === swatch;
                  return (
                    <button
                      key={swatch}
                      type="button"
                      aria-label={swatch}
                      title={swatch.toUpperCase()}
                      onClick={() => onChange(swatch)}
                      className={`flex h-8 w-8 items-center justify-center rounded-lg border transition-transform hover:scale-110 ${active ? "border-accent ring-2 ring-accent/30" : "border-black/10"}`}
                      style={{ background: swatch }}
                    >
                      {active ? <Check size={14} strokeWidth={3} className={swatch === "#ffffff" || swatch === "#f4f1ea" || swatch === "#c5bfb4" || swatch === "#f0a43a" ? "text-ink" : "text-white"} aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
              <p className="eyebrow pt-4 pb-2.5">Custom</p>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-line-strong bg-panel px-2.5 py-2 text-xs font-medium text-muted shadow-soft transition-colors hover:bg-raised hover:text-ink">
                <input
                  type="color"
                  aria-label="Custom color"
                  value={value ?? "#f3efe6"}
                  onChange={(event) => onChange(event.target.value, "color-picker")}
                  className="h-7 w-10 cursor-pointer rounded-md border border-line bg-transparent p-0"
                />
                Pick any color
              </label>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
