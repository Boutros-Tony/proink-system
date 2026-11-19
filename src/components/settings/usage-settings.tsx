"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { formatCents } from "@/lib/format";
import { PROVIDERS, type ProviderId } from "@/lib/ai/models";
import { MILLS_PER_DOLLAR, dollarsToMills, usageReading } from "@/lib/ai/spend";
import { clearProviderSpend, getAiSpend, getServerAiSpend, setCreditBalance, setReportedSpend, subscribeAiSpend } from "@/lib/studio/ai-spend";

const BILLING: Record<ProviderId, { href: string; label: string }> = {
  openai: { href: "https://platform.openai.com/settings/organization/billing/overview", label: "OpenAI billing" },
  anthropic: { href: "https://console.anthropic.com/settings/billing", label: "Claude billing" },
  google: { href: "https://aistudio.google.com/billing", label: "AI Studio billing" },
};

function formatMills(mills: number) {
  return formatCents(mills / 1000);
}

function MoneyField({ label, ariaLabel, mills, onCommit }: { label: string; ariaLabel: string; mills: number; onCommit: (mills: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (mills / MILLS_PER_DOLLAR).toFixed(2);

  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      {label}
      <span className="relative">
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" aria-hidden="true">
          $
        </span>
        <input
          className="field w-28 py-1.5 pr-2.5 pl-6 font-mono text-xs"
          inputMode="decimal"
          aria-label={ariaLabel}
          value={shown}
          onChange={(event) => setText(event.target.value)}
          onBlur={(event) => {
            const raw = (text ?? event.currentTarget.value).replace(/[^0-9.]/g, "");
            const next = dollarsToMills(Number(raw));
            if (next !== mills) onCommit(next);
            setText(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </span>
    </label>
  );
}

export function UsageSettings() {
  const ledger = useSyncExternalStore(subscribeAiSpend, getAiSpend, getServerAiSpend);
  const [available, setAvailable] = useState<Record<string, boolean> | null>(null);

  useEffect(() => {
    void fetch("/api/providers")
      .then((response) => response.json())
      .then((payload: { available?: Record<string, boolean> }) => setAvailable(payload.available ?? {}))
      .catch(() => setAvailable({}));
  }, []);

  const totals = PROVIDERS.reduce(
    (sum, provider) => {
      const account = ledger.accounts[provider.id];
      const spentMills = account.billedMills + account.spentMills;
      const reading = usageReading(account.balanceMills, spentMills);
      return { spent: sum.spent + spentMills, left: sum.left + reading.leftMills };
    },
    { spent: 0, left: 0 },
  );

  return (
    <div className="mx-auto max-w-3xl px-8 pt-10 pb-20">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Usage</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
          Copy the credits you bought and what you have already spent from each provider&apos;s billing page. The model key can run the model, and it cannot read that balance. $20 in credits with $0.39 spent shows 2% usage and $19.61 left. Calls from this studio are added until you update Spent.
        </p>
      </header>

      <p className="mt-6 text-sm text-muted">
        <span className="font-medium text-ink">{formatMills(totals.left)}</span> left across OpenAI, Anthropic, and Google
        <span className="text-subtle"> · </span>
        {formatMills(totals.spent)} spent
      </p>

      <div className="mt-4 space-y-4">
        {PROVIDERS.map((provider) => {
          const account = ledger.accounts[provider.id];
          const spentMills = account.billedMills + account.spentMills;
          const reading = usageReading(account.balanceMills, spentMills);
          const ready = available?.[provider.id] === true;
          const fill = reading.percent >= 90 ? "bg-danger" : "bg-accent";
          return (
            <section key={provider.id} aria-labelledby={`${provider.id}-usage`} className="overflow-hidden rounded-2xl border border-line bg-panel shadow-soft">
              <div className="flex items-start justify-between gap-4 px-5 pt-5">
                <div className="min-w-0">
                  <h3 id={`${provider.id}-usage`} className="text-sm font-semibold">
                    {provider.label}
                  </h3>
                  <p className="mt-1 truncate font-mono text-[11px] text-muted">
                    {provider.defaultModel}
                    <span className="text-subtle"> · </span>
                    <span className={ready ? "text-success" : ""}>{available === null ? "Checking the key" : ready ? "Model key ready" : "No model key"}</span>
                  </p>
                </div>
                <p className="text-right">
                  <span className="block font-mono text-3xl leading-none font-medium tracking-tight">{reading.percent}%</span>
                  <span className="mt-1 block text-[11px] font-medium tracking-wide text-subtle uppercase">usage</span>
                </p>
              </div>

              <div className="px-5 pt-4">
                <div
                  className="h-1.5 overflow-hidden rounded-full bg-raised"
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={reading.percent}
                  aria-label={`${provider.label} usage`}
                >
                  <div className={`h-full rounded-full ${fill}`} style={{ width: `${reading.percent}%` }} />
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-3 text-xs">
                  <span className="text-muted">{formatMills(reading.spentMills)} spent</span>
                  <span className="font-medium text-ink">{formatMills(reading.leftMills)} left</span>
                </div>
                {reading.overMills > 0 ? <p className="mt-2 text-xs text-danger">{formatMills(reading.overMills)} past the balance</p> : null}
              </div>

              {account.models.length > 0 ? (
                <ul className="mt-4 divide-y divide-line border-t border-line">
                  {account.models.map((model) => (
                    <li key={model.id} className="flex items-center justify-between gap-4 px-5 py-2.5">
                      <span className="truncate font-mono text-[11px] text-muted">{model.id}</span>
                      <span className="shrink-0 font-mono text-xs">{formatMills(model.mills)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
                <div className="flex flex-wrap items-center gap-4">
                  <MoneyField label="Credits" ariaLabel={`${provider.label} credits`} mills={account.balanceMills} onCommit={(mills) => setCreditBalance(provider.id, mills)} />
                  <MoneyField label="Spent" ariaLabel={`${provider.label} spent`} mills={spentMills} onCommit={(mills) => setReportedSpend(provider.id, mills)} />
                </div>
                <div className="flex items-center gap-1">
                  <a href={BILLING[provider.id].href} target="_blank" rel="noreferrer" className="btn btn-ghost px-2 text-xs">
                    {BILLING[provider.id].label}
                  </a>
                  <button type="button" className="btn btn-ghost px-2 text-xs" onClick={() => clearProviderSpend(provider.id)} disabled={spentMills === 0}>
                    Reset usage
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
