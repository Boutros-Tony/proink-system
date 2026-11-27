"use client";

import { ChevronDown } from "lucide-react";
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const CloseMenuContext = createContext<() => void>(() => {});

export function useCloseMenu() {
  return useContext(CloseMenuContext);
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;
const MAX_MENU_HEIGHT = 560;

/** Keep a popover inside the viewport, anchored to its trigger, so the first row stays reachable. */
function placeMenu(anchor: HTMLElement, panel: HTMLElement, side: "top" | "bottom", align: "left" | "right") {
  const rect = anchor.getBoundingClientRect();
  const above = Math.max(0, Math.floor(rect.top - ANCHOR_GAP - VIEWPORT_MARGIN));
  const below = Math.max(0, Math.floor(window.innerHeight - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN));
  const useUp = side === "top" ? above >= below || above >= 220 : below < 160 && above > below;
  const maxWidth = Math.max(160, window.innerWidth - VIEWPORT_MARGIN * 2);

  panel.style.maxWidth = `${maxWidth}px`;
  panel.style.maxHeight = `${Math.min(MAX_MENU_HEIGHT, useUp ? above : below)}px`;

  const usedWidth = panel.getBoundingClientRect().width;
  const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - usedWidth - VIEWPORT_MARGIN);
  const preferred = align === "right" ? rect.right - usedWidth : rect.left;
  const left = Math.min(Math.max(VIEWPORT_MARGIN, preferred), maxLeft);
  panel.style.left = `${left}px`;
  panel.style.right = "auto";
  panel.style.transformOrigin = useUp ? "bottom" : "top";
  if (useUp) {
    panel.style.top = "auto";
    panel.style.bottom = `${Math.ceil(window.innerHeight - rect.top + ANCHOR_GAP)}px`;
  } else {
    panel.style.bottom = "auto";
    panel.style.top = `${Math.floor(rect.bottom + ANCHOR_GAP)}px`;
  }
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
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
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

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = buttonRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    function place() {
      if (!anchor || !panel) return;
      placeMenu(anchor, panel, side, align);
    }
    function onScroll(event: Event) {
      if (!panel) return;
      if (event.target instanceof Node && panel.contains(event.target)) return;
      place();
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, side, align, width]);

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
        ref={buttonRef}
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
            ref={panelRef}
            id={menuId}
            onWheel={(event) => event.stopPropagation()}
            className={`animate-pop fixed z-40 overflow-y-auto overscroll-contain rounded-xl border border-line bg-panel shadow-pop ${width}`}
          >
            {children}
          </div>
        </CloseMenuContext.Provider>
      ) : null}
    </div>
  );
}
