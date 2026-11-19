import type { Costing } from "@/lib/systems/costing";
import type { DesignDocument } from "@/lib/systems/modular/schema";
import { getActiveProjectId } from "@/lib/studio/cloud";

/** A quotation that was downloaded for the client. Each download is numbered and kept. */
export type IssuedQuote = { id: string; ref: string; revision: number; status: string; title: string; grand_total_cents: number };

export const QUOTE_STATUSES = ["draft", "sent", "won", "lost", "cancelled"] as const;

const listeners = new Set<() => void>();

export function subscribeQuotes(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function listQuotes(projectId: string): Promise<IssuedQuote[]> {
  const response = await fetch(`/api/quotes?projectId=${encodeURIComponent(projectId)}`);
  if (!response.ok) return [];
  const payload = (await response.json().catch(() => null)) as { quotes?: IssuedQuote[] } | null;
  return payload?.quotes ?? [];
}

export async function setQuoteStatus(id: string, status: string) {
  await fetch("/api/quotes", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, status }),
  });
}

/** Number the quotation, keep a copy on the job, and download the PDF. */
export async function issueQuote(input: { document: DesignDocument; costing: Costing; marginPercent: number; jobTitle: string; clientName: string; sourceKind: string }) {
  const projectId = getActiveProjectId();
  if (!projectId) throw new Error("Open a saved job before downloading the quotation.");
  const response = await fetch("/api/quotes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, projectId }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "The quotation could not be prepared.");
  }
  const blob = await response.blob();
  const name = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] || "quotation.pdf";
  const link = window.document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
  listeners.forEach((listener) => listener());
}
