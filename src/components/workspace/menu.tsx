"use client";

import { ChevronDown } from "lucide-react";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";

const CloseMenuContext = createContext<() => void>(() => {});

export function useCloseMenu() {
  return useContext(CloseMenuContext);
}

export function Menu({
  label,
  children,
  align = "left",
  side = "bottom",
  width = "w-72",
  variant = "ghost",
}: {
  label: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  side?: "top" | "bottom";
  width?: string;
  variant?: "ghost" | "outline";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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

  const base = "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors";
  const tone =
    variant === "outline"
      ? `border shadow-soft ${open ? "border-accent-line bg-accent-soft text-accent" : "border-line-strong bg-panel text-ink hover:bg-raised"}`
      : open
        ? "bg-raised text-ink"
        : "text-muted hover:bg-raised hover:text-ink";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className={`${base} ${tone}`}
      >
        {label}
        <ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" className={`text-subtle transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <CloseMenuContext.Provider value={() => setOpen(false)}>
          <div
            id={menuId}
            className={`animate-pop absolute z-30 overflow-auto rounded-xl border border-line bg-panel shadow-pop ${side === "top" ? "bottom-full mb-2 origin-bottom" : "top-full mt-2 origin-top"} ${align === "right" ? "right-0" : "left-0"} ${width} max-h-[min(70vh,560px)]`}
          >
            {children}
          </div>
        </CloseMenuContext.Provider>
      ) : null}
    </div>
  );
}
