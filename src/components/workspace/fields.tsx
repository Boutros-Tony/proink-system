"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type SelectHTMLAttributes } from "react";

export function SelectField({
  children,
  compact = false,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { compact?: boolean }) {
  return (
    <div className="relative">
      <select {...props} className={`field appearance-none ${compact ? "py-1.5 pr-8 pl-2.5 text-xs" : "pr-9"}`}>
        {children}
      </select>
      <ChevronDown size={14} strokeWidth={2.25} aria-hidden="true" className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-subtle" />
    </div>
  );
}

function display(value: number) {
  return String(Math.round(value * 100) / 100);
}

/**
 * A number box that applies on Enter or blur. ↑ and ↓ step the value (Shift ×100, Alt ×1, default ×10)
 * and keep focus so you can keep stepping.
 */
export function NumberField({
  label,
  value,
  onCommit,
  allowZero = false,
  allowNegative = false,
  suffix,
  prefix,
  dense = false,
  step,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  allowZero?: boolean;
  allowNegative?: boolean;
  suffix?: string;
  /** Short tag shown inside the box, like "X" or "W". The label then becomes a tooltip. */
  prefix?: string;
  /** Shorter box for a narrow inspector. */
  dense?: boolean;
  /** Arrow-key increment. Omitted keeps ×10, Alt ×1, Shift ×100. */
  step?: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function valid(next: number) {
    return Number.isFinite(next) && (allowNegative ? true : allowZero ? next >= 0 : next > 0);
  }

  function commit(raw: string) {
    const next = Number(raw);
    setDraft(null);
    if (valid(next) && next !== value) onCommit(next);
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
      const increment = step !== undefined ? (event.shiftKey ? step * 10 : event.altKey ? step / 5 : step) : event.shiftKey ? 100 : event.altKey ? 1 : 10;
      const next = Number(event.currentTarget.value) + (event.key === "ArrowUp" ? increment : -increment);
      setDraft(null);
      if (valid(next)) onCommit(Math.round(next * 100) / 100);
    }
  }

  const inputProps = {
    value: draft ?? display(value),
    inputMode: "decimal" as const,
    onFocus: (event: FocusEvent<HTMLInputElement>) => event.currentTarget.select(),
    onChange: (event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    onBlur: (event: FocusEvent<HTMLInputElement>) => {
      if (draft !== null) commit(event.currentTarget.value);
    },
    onKeyDown,
  };
  const suffixTag = suffix ? (
    <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] font-normal tracking-normal text-subtle normal-case">{suffix}</span>
  ) : null;

  if (prefix) {
    const widePrefix = prefix.length > 2;
    const longPrefix = prefix.length > 4;
    return (
      <label title={label} className="relative block min-w-0">
        <span className="sr-only">{label}</span>
        <span aria-hidden="true" className={`pointer-events-none absolute top-1/2 -translate-y-1/2 font-semibold text-subtle ${dense ? "left-1.5 text-[10px]" : "left-2.5 text-[11px]"}`}>
          {prefix}
        </span>
        <input
          {...inputProps}
          className={
            dense
              ? `field !h-[22px] !rounded-[4px] !py-0 font-mono !text-[11px] !shadow-none ${suffix ? "!pr-4" : "!pr-1"} ${longPrefix ? "!pl-[2.35rem]" : widePrefix ? "!pl-8" : "!pl-[18px]"}`
              : `field py-1.5 font-mono text-[13px] ${suffix ? "pr-7" : "pr-2"} ${longPrefix ? "pl-14" : widePrefix ? "pl-11" : "pl-7"}`
          }
        />
        {suffixTag}
      </label>
    );
  }

  return (
    <label className="eyebrow block">
      {label}
      <span className="relative mt-1.5 block">
        <input
          {...inputProps}
          className={`field px-2.5 py-2 font-mono text-[13px] font-normal tracking-normal text-ink normal-case ${suffix ? "pr-7" : ""}`}
        />
        {suffixTag}
      </span>
    </label>
  );
}
