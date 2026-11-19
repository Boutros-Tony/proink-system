"use client";

import { Check, ChevronDown, Plus, UserRound } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { addClient, findClientByName, getClients, getServerClients, subscribeClients, type Client } from "@/lib/studio/clients";

export type ChatClient = { id: string | null; name: string };

export const NO_CLIENT: ChatClient = { id: null, name: "" };

/**
 * The client this chat is for. A new chat starts without one. Pick a client from the list, or type a new name:
 * the client is created in the clients table straight away.
 */
export function ClientPicker({ value, onChange }: { value: ChatClient; onChange: (client: ChatClient) => void }) {
  const clients = useSyncExternalStore(subscribeClients, getClients, getServerClients);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const trimmed = query.trim();
  const matches = useMemo(() => {
    const needle = trimmed.toLowerCase();
    return clients.filter((client) => client.name.toLowerCase().includes(needle)).slice(0, 8);
  }, [clients, trimmed]);
  const canCreate = trimmed.length > 0 && !findClientByName(trimmed);
  const optionCount = matches.length + (canCreate ? 1 : 0);
  const activeIndex = Math.min(active, Math.max(optionCount - 1, 0));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) close();
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(client: Client) {
    onChange({ id: client.id, name: client.name });
    close();
  }

  function create() {
    if (!trimmed) return;
    choose(addClient(trimmed));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (optionCount > 0) setActive((activeIndex + (event.key === "ArrowDown" ? 1 : -1) + optionCount) % optionCount);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex < matches.length) choose(matches[activeIndex]);
      else create();
    } else if (event.key === "Escape") {
      close();
      inputRef.current?.blur();
    }
  }

  const label = value.name || "New client";

  return (
    <div ref={rootRef} className="relative min-w-0">
      {open ? (
        <div className="flex items-center gap-1.5 rounded-md border border-line-strong bg-panel px-2 py-1 shadow-soft">
          <UserRound size={13} className="shrink-0 text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-label="Client"
            placeholder="Search or type a new client"
            className="w-56 bg-transparent text-[13px] outline-none placeholder:text-subtle"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Change the client for this chat"
          className="flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-[13px] transition-colors hover:bg-raised"
        >
          <UserRound size={13} className="shrink-0 text-muted" aria-hidden="true" />
          <span className={`truncate font-medium ${value.name ? "text-ink" : "text-muted"}`}>{label}</span>
          <ChevronDown size={13} strokeWidth={2.25} className="shrink-0 text-subtle" aria-hidden="true" />
        </button>
      )}

      {open ? (
        <ul id={listId} role="listbox" className="animate-pop absolute top-full left-0 z-30 mt-1.5 max-h-72 w-72 origin-top overflow-auto rounded-xl border border-line bg-panel p-1 shadow-pop">
          {matches.map((client, index) => (
            <li key={client.id} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(client)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${index === activeIndex ? "bg-raised" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate">{client.name}</span>
                {client.id === value.id ? <Check size={14} strokeWidth={2.5} className="shrink-0 text-accent" aria-hidden="true" /> : null}
              </button>
            </li>
          ))}
          {canCreate ? (
            <li role="option" aria-selected={activeIndex === matches.length}>
              <button
                type="button"
                onMouseEnter={() => setActive(matches.length)}
                onClick={create}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors ${activeIndex === matches.length ? "bg-raised" : ""}`}
              >
                <Plus size={14} strokeWidth={2.25} className="shrink-0 text-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">Add &ldquo;{trimmed}&rdquo; as a new client</span>
              </button>
            </li>
          ) : null}
          {optionCount === 0 ? <li className="px-2.5 py-2 text-xs text-muted">No clients yet. Type a name to add the first one.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
