import { emptyCosting, readCosting, type Costing } from "../systems/costing";

/**
 * The cost of the job on screen: prices and quantities changed for this job only, lines added by the
 * cost review or by hand, and the review itself. Kept on this device like the design. The standing
 * prices live in the price book and are never changed from here.
 */

const KEY = "proink-job-costing";

const serverCosting = emptyCosting();
let costing: Costing = serverCosting;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const saved = localStorage.getItem(KEY);
  if (!saved) return;
  try {
    costing = readCosting(JSON.parse(saved));
  } catch {
    localStorage.removeItem(KEY);
  }
}

function publish() {
  try {
    localStorage.setItem(KEY, JSON.stringify(costing));
  } catch {
    // Storage can be full or blocked. The job's costing stays for this visit.
  }
  listeners.forEach((listener) => listener());
}

export function getCosting() {
  hydrate();
  return costing;
}

export function getServerCosting() {
  return serverCosting;
}

export function setCosting(next: Costing) {
  hydrate();
  costing = next;
  publish();
}

/** Start the job over: no edits, no added lines, no review. */
export function resetCosting() {
  hydrate();
  costing = emptyCosting();
  publish();
}

export function subscribeCosting(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
