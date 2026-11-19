export type History<T> = {
  present: T;
  past: T[];
  future: T[];
  lastKey: string | null;
  lastAt: number;
};

export type CommitOptions = {
  /** Edits that share a key within `windowMs` collapse into one undo step, such as repeated arrow-key nudges. */
  key?: string;
  now?: number;
  windowMs?: number;
  limit?: number;
};

export function createHistory<T>(present: T): History<T> {
  return { present, past: [], future: [], lastKey: null, lastAt: 0 };
}

export function commitHistory<T>(history: History<T>, next: T, options: CommitOptions = {}): History<T> {
  if (Object.is(next, history.present)) return history;
  const now = options.now ?? Date.now();
  const limit = options.limit ?? 100;
  const joins =
    options.key !== undefined && options.key === history.lastKey && now - history.lastAt < (options.windowMs ?? 800);
  const past = joins ? history.past : [...history.past, history.present].slice(-limit);
  return { present: next, past, future: [], lastKey: options.key ?? null, lastAt: now };
}

export function undoHistory<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    present: previous,
    past: history.past.slice(0, -1),
    future: [history.present, ...history.future],
    lastKey: null,
    lastAt: 0,
  };
}

export function redoHistory<T>(history: History<T>): History<T> {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return {
    present: next,
    past: [...history.past, history.present],
    future: rest,
    lastKey: null,
    lastAt: 0,
  };
}
