/**
 * What is selected in the 3D view. A tiny external store so the toolbar, the
 * outliner, the viewport, and the chat all read the same selection.
 */

const EMPTY: string[] = [];
let selection: string[] = EMPTY;
const listeners = new Set<() => void>();

function same(a: string[], b: string[]) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function getSelection() {
  return selection;
}

export function getServerSelection() {
  return EMPTY;
}

export function setSelection(next: string[]) {
  const unique = [...new Set(next)];
  if (same(unique, selection)) return;
  selection = unique.length === 0 ? EMPTY : unique;
  listeners.forEach((listener) => listener());
}

export function subscribeSelection(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
