"use client";

import { ArrowLeft, Boxes, FileClock, Gauge, HardDrive, Loader2, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { loadShop, startCloudSync } from "@/lib/studio/cloud";

type Section = { href: string; label: string; detail: string; Icon: LucideIcon };

/** Settings sections. Add the next screen here and it appears in the list. */
const SECTIONS: Section[] = [
  { href: "/settings/usage", label: "Usage", detail: "Credits left on each model", Icon: Gauge },
  { href: "/settings/materials", label: "Materials", detail: "Boards, sheets, and prices", Icon: Boxes },
  { href: "/settings/clients", label: "Clients", detail: "Who you build stands for", Icon: Users },
  { href: "/settings/past-quotes", label: "Past quotes", detail: "Proformas from the mailbox", Icon: FileClock },
];

export function SettingsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  useEffect(() => {
    startCloudSync();
    void loadShop().finally(() => setReady(true));
  }, []);
  return (
    <div className="flex h-dvh bg-bg text-ink">
      <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel">
        <div className="px-3 pt-4 pb-2">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <ArrowLeft size={15} strokeWidth={2} aria-hidden="true" />
            Back to studio
          </Link>
        </div>
        <div className="px-5 pt-3 pb-2">
          <h1 className="text-[17px] font-semibold tracking-tight">Settings</h1>
        </div>
        <nav aria-label="Settings sections" className="flex-1 space-y-0.5 px-3 pt-1">
          {SECTIONS.map(({ href, label, detail, Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-2.5 py-2 transition-colors ${active ? "bg-accent-soft text-accent" : "text-ink hover:bg-raised"}`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${active ? "bg-panel text-accent shadow-soft" : "bg-raised text-muted"}`}>
                  <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] leading-4 font-semibold">{label}</span>
                  <span className={`mt-0.5 block truncate text-[11px] leading-4 ${active ? "text-accent/80" : "text-muted"}`}>{detail}</span>
                </span>
              </Link>
            );
          })}
        </nav>
        <p className="flex items-start gap-2 border-t border-line px-5 py-4 text-[11px] leading-4 text-muted">
          <HardDrive size={13} strokeWidth={1.9} aria-hidden="true" className="mt-px shrink-0" />
          Prices and clients are saved for the whole shop.
        </p>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        {ready ? (
          children
        ) : (
          <div className="flex h-full items-center justify-center gap-3 text-sm text-muted" aria-busy="true">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            Loading…
          </div>
        )}
      </main>
    </div>
  );
}
