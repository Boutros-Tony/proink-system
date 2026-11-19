import { defaultPriceBook, readPriceBook, type PriceBook } from "../systems/materials";

/**
 * The shop's price book, kept on this device for now. Settings edits it, the studio prices
 * the design from it, and it is sent with every quotation, package, and chat request.
 * When Supabase arrives this file is the only place that changes.
 */

const KEY = "proink-price-book";

const serverBook = defaultPriceBook();
let book: PriceBook = serverBook;
let hydrated = false;
const listeners = new Set<() => void>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const saved = localStorage.getItem(KEY);
  if (!saved) return;
  try {
    book = readPriceBook(JSON.parse(saved));
  } catch {
    localStorage.removeItem(KEY);
  }
}

function publish() {
  try {
    localStorage.setItem(KEY, JSON.stringify(book));
  } catch {
    // Storage can be full or blocked. The prices stay for this visit.
  }
  listeners.forEach((listener) => listener());
}

export function getPriceBook() {
  hydrate();
  return book;
}

export function getServerPriceBook() {
  return serverBook;
}

export function setPriceBook(next: PriceBook) {
  hydrate();
  book = readPriceBook(next);
  publish();
}

export function resetPriceBook() {
  hydrate();
  book = defaultPriceBook();
  publish();
}

export function subscribePriceBook(listener: () => void) {
  listeners.add(listener);
  // Another tab changed the prices: pick them up so both windows agree.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    try {
      book = event.newValue ? readPriceBook(JSON.parse(event.newValue)) : defaultPriceBook();
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
