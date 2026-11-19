"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const listeners = new Set<() => void>();

function stored(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const value = localStorage.getItem("proink-theme");
  return value === "light" || value === "dark" ? value : "system";
}

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

function setTheme(choice: ThemeChoice) {
  localStorage.setItem("proink-theme", choice);
  apply(choice);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const OPTIONS: { id: ThemeChoice; label: string; Icon: LucideIcon }[] = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "system", label: "Match system", Icon: Monitor },
];

/** Light, dark, or follow the computer, like the Cursor window. */
export function ThemeToggle() {
  const choice = useSyncExternalStore(subscribe, stored, () => "system" as ThemeChoice);
  return (
    <div role="group" aria-label="Theme" className="flex items-center gap-0.5 rounded-lg bg-sidebar-raised/70 p-0.5">
      {OPTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={choice === id}
          onClick={() => setTheme(id)}
          className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${choice === id ? "bg-panel text-ink shadow-soft" : "text-muted hover:text-ink"}`}
        >
          <Icon size={13} strokeWidth={2} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
