import { createClient } from "@/lib/supabase/client";
import type { ProviderId } from "../ai/models";
import { DEFAULT_BALANCE_MILLS, readSpend } from "../ai/spend";

/**
 * Credit balances and what this studio has spent.
 * The screen keeps a copy on this device. Each call is also written to studio_ai_runs.
 */

const KEY = "proink-ai-spend";

export type ModelSpend = { id: string; mills: number };

export type ProviderAccount = {
  /** Credits purchased at the provider, such as the $20 added in AI Studio. */
  balanceMills: number;
  /** Spend copied from the provider's billing page. Studio calls are counted separately. */
  billedMills: number;
  /** Spend measured from calls made in this studio since the billing numbers were last entered. */
  spentMills: number;
  models: ModelSpend[];
};

export type AiSpendLedger = {
  accounts: Record<ProviderId, ProviderAccount>;
  seen: string[];
};

function emptyAccount(): ProviderAccount {
  return { balanceMills: DEFAULT_BALANCE_MILLS, billedMills: 0, spentMills: 0, models: [] };
}

export function emptyLedger(): AiSpendLedger {
  return {
    accounts: { openai: emptyAccount(), anthropic: emptyAccount(), google: emptyAccount() },
    seen: [],
  };
}

function readAccount(value: unknown): ProviderAccount {
  const fallback = emptyAccount();
  if (!value || typeof value !== "object") return fallback;
  const { balanceMills, billedMills, spentMills, models } = value as Record<string, unknown>;
  const parsedModels = Array.isArray(models)
    ? models.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const row = item as Record<string, unknown>;
        if (typeof row.id !== "string" || typeof row.mills !== "number" || !Number.isFinite(row.mills) || row.mills <= 0) return [];
        return [{ id: row.id.slice(0, 80), mills: Math.round(row.mills) }];
      })
    : [];
  return {
    balanceMills: typeof balanceMills === "number" && Number.isFinite(balanceMills) && balanceMills >= 0 ? Math.round(balanceMills) : fallback.balanceMills,
    billedMills: typeof billedMills === "number" && Number.isFinite(billedMills) && billedMills >= 0 ? Math.round(billedMills) : 0,
    spentMills: typeof spentMills === "number" && Number.isFinite(spentMills) && spentMills >= 0 ? Math.round(spentMills) : 0,
    models: parsedModels.slice(0, 12),
  };
}

export function readLedger(value: unknown): AiSpendLedger {
  const empty = emptyLedger();
  if (!value || typeof value !== "object") return empty;
  const raw = value as Record<string, unknown>;
  const accounts = raw.accounts;
  const seen = Array.isArray(raw.seen) ? raw.seen.filter((id): id is string => typeof id === "string").slice(-300) : [];
  if (!accounts || typeof accounts !== "object") return { ...empty, seen };
  const stored = accounts as Record<string, unknown>;
  return {
    accounts: {
      openai: readAccount(stored.openai),
      anthropic: readAccount(stored.anthropic),
      google: readAccount(stored.google),
    },
    seen,
  };
}

function rememberModel(models: ModelSpend[], id: string, mills: number): ModelSpend[] {
  const next = models.map((model) => ({ ...model }));
  const found = next.find((model) => model.id === id);
  if (found) found.mills += mills;
  else next.push({ id, mills });
  next.sort((a, b) => b.mills - a.mills);
  if (next.length <= 12) return next;
  const kept = next.slice(0, 11);
  const rest = next.slice(11).reduce((sum, model) => sum + model.mills, 0);
  kept.push({ id: "Other models", mills: rest });
  return kept;
}

const serverLedger = emptyLedger();
let ledger: AiSpendLedger = serverLedger;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const saved = localStorage.getItem(KEY);
  if (saved) {
    try {
      ledger = readLedger(JSON.parse(saved));
    } catch {
      localStorage.removeItem(KEY);
    }
  }
  void pullSpend();
}

const PROVIDERS: ProviderId[] = ["openai", "anthropic", "google"];
let pulling = false;

function writeRun(row: { note_id: string; mode: string; provider: string; model: string; cost_mills: number; counted: boolean }) {
  if (typeof window === "undefined" || pulling) return;
  void createClient().from("studio_ai_runs").upsert(row, { onConflict: "note_id" });
}

function ledgerFromRuns(rows: { note_id: string | null; mode: string; provider: string; model: string; cost_mills: number; counted: boolean }[]) {
  const next = emptyLedger();
  for (const row of rows) {
    if (!PROVIDERS.includes(row.provider as ProviderId)) continue;
    const account = next.accounts[row.provider as ProviderId];
    if (row.mode === "balance") account.balanceMills = row.cost_mills;
    else if (row.mode === "billed") account.billedMills = row.cost_mills;
    else if (row.counted && row.cost_mills > 0) {
      account.spentMills += row.cost_mills;
      account.models = rememberModel(account.models, row.model || "model", row.cost_mills);
      if (row.note_id) next.seen.push(row.note_id);
    }
  }
  next.seen = next.seen.slice(-300);
  return next;
}

async function pullSpend() {
  const supabase = createClient();
  const { data, error } = await supabase.from("studio_ai_runs").select("note_id, mode, provider, model, cost_mills, counted");
  if (error || !data) return;
  if (data.length === 0) {
    for (const provider of PROVIDERS) {
      const account = ledger.accounts[provider];
      if (account.balanceMills !== DEFAULT_BALANCE_MILLS) {
        writeRun({ note_id: `balance:${provider}`, mode: "balance", provider, model: "", cost_mills: account.balanceMills, counted: false });
      }
      if (account.billedMills > 0) {
        writeRun({ note_id: `billed:${provider}`, mode: "billed", provider, model: "", cost_mills: account.billedMills, counted: false });
      }
      for (const model of account.models) {
        writeRun({ note_id: `local:${provider}:${model.id}`, mode: "call", provider, model: model.id, cost_mills: model.mills, counted: true });
      }
    }
    return;
  }
  pulling = true;
  ledger = ledgerFromRuns(data);
  try {
    localStorage.setItem(KEY, JSON.stringify(ledger));
  } catch {
    // The database copy is the one that lasts.
  }
  listeners.forEach((listener) => listener());
  pulling = false;
}

function publish() {
  try {
    localStorage.setItem(KEY, JSON.stringify(ledger));
  } catch {
    // Storage can be full or blocked. The totals stay for this visit.
  }
  listeners.forEach((listener) => listener());
}

export function getAiSpend() {
  hydrate();
  return ledger;
}

export function getServerAiSpend() {
  return serverLedger;
}

export function subscribeAiSpend(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    try {
      ledger = event.newValue ? readLedger(JSON.parse(event.newValue)) : emptyLedger();
    } catch {
      return;
    }
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Add one model call. The same id is ignored, so a finished chat is counted once. */
export function addAiSpend(note: { id: string; provider: ProviderId; model: string; mills: number }) {
  hydrate();
  if (note.mills <= 0 || ledger.seen.includes(note.id)) return;
  const account = ledger.accounts[note.provider];
  const accounts = {
    ...ledger.accounts,
    [note.provider]: {
      ...account,
      spentMills: account.spentMills + note.mills,
      models: rememberModel(account.models, note.model, note.mills),
    },
  };
  ledger = { accounts, seen: [...ledger.seen, note.id].slice(-300) };
  publish();
  writeRun({ note_id: note.id, mode: "call", provider: note.provider, model: note.model, cost_mills: note.mills, counted: true });
}

/** Read a spend note off an API payload or a chat message and add it. */
export function recordSpend(value: unknown) {
  const note = readSpend(value);
  if (note) addAiSpend(note);
}

export function setCreditBalance(provider: ProviderId, balanceMills: number) {
  hydrate();
  const account = ledger.accounts[provider];
  ledger = {
    ...ledger,
    accounts: {
      ...ledger.accounts,
      [provider]: { ...account, balanceMills: Math.max(0, Math.round(balanceMills)) },
    },
  };
  publish();
  writeRun({ note_id: `balance:${provider}`, mode: "balance", provider, model: "", cost_mills: ledger.accounts[provider].balanceMills, counted: false });
}

/**
 * Replace the spend copied from the provider. Studio calls counted since the last
 * entry are cleared, because the new figure already includes them.
 */
export function setReportedSpend(provider: ProviderId, totalMills: number) {
  hydrate();
  const account = ledger.accounts[provider];
  ledger = {
    ...ledger,
    accounts: {
      ...ledger.accounts,
      [provider]: { ...account, billedMills: Math.max(0, Math.round(totalMills)), spentMills: 0, models: [] },
    },
  };
  publish();
  writeRun({ note_id: `billed:${provider}`, mode: "billed", provider, model: "", cost_mills: ledger.accounts[provider].billedMills, counted: false });
  if (typeof window !== "undefined") {
    void createClient().from("studio_ai_runs").update({ counted: false }).eq("provider", provider).eq("mode", "call");
  }
}

export function clearProviderSpend(provider: ProviderId) {
  hydrate();
  const account = ledger.accounts[provider];
  ledger = {
    ...ledger,
    accounts: {
      ...ledger.accounts,
      [provider]: { ...account, billedMills: 0, spentMills: 0, models: [] },
    },
  };
  publish();
  writeRun({ note_id: `billed:${provider}`, mode: "billed", provider, model: "", cost_mills: 0, counted: false });
  if (typeof window !== "undefined") {
    void createClient().from("studio_ai_runs").update({ counted: false }).eq("provider", provider).eq("mode", "call");
  }
}
