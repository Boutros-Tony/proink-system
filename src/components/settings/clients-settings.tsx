"use client";

import { Check, ChevronRight, Copy, MapPin, Plus, Search, Trash2, UserRound } from "lucide-react";
import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import {
  addClient,
  findClientByName,
  getClients,
  getServerClients,
  newId,
  removeClient,
  renameClient,
  subscribeClients,
  updateClient,
  type Client,
  type ClientContact,
  type ClientLocation,
} from "@/lib/studio/clients";

// --- What the copy buttons put on the clipboard ----------------------------------------------

function sizeText(location: ClientLocation) {
  const { widthMm, heightMm, depthMm } = location;
  if (!widthMm && !heightMm && !depthMm) return "";
  return `Width ${widthMm} × Height ${heightMm} × Depth ${depthMm} mm`;
}

function locationText(location: ClientLocation) {
  const head = [location.place, location.spot].filter(Boolean).join(" · ");
  return [head, sizeText(location)].filter(Boolean).join("\n");
}

function CopyButton({ text, label, compact = false }: { text: string; label: string; compact?: boolean }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
    } catch {
      // The browser blocked the clipboard. Nothing to do.
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      disabled={!text.trim()}
      title={label}
      aria-label={label}
      className={`flex items-center gap-1.5 rounded-md text-xs transition-colors hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40 ${done ? "text-success" : "text-muted"} ${compact ? "h-7 w-7 justify-center" : "px-2 py-1.5"}`}
    >
      {done ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {compact ? null : done ? "Copied" : label}
    </button>
  );
}

// --- Small inputs ------------------------------------------------------------------------------

const CELL = "w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-[13px] outline-none transition-colors placeholder:text-subtle hover:bg-raised focus:border-line-strong focus:bg-raised";

function TextCell({ value, onCommit, label, placeholder, type = "text", copy = false }: { value: string; onCommit: (value: string) => void; label: string; placeholder: string; type?: string; copy?: boolean }) {
  return (
    <span className="relative block min-w-0">
      <input
        key={value}
        type={type}
        defaultValue={value}
        aria-label={label}
        placeholder={placeholder}
        maxLength={160}
        onBlur={(event) => {
          if (event.currentTarget.value !== value) onCommit(event.currentTarget.value.trim());
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className={`${CELL} ${copy ? "pr-8" : ""}`}
      />
      {copy ? (
        <span className="absolute top-1/2 right-0.5 -translate-y-1/2">
          <CopyButton compact text={value} label={`Copy ${label.toLowerCase()}`} />
        </span>
      ) : null}
    </span>
  );
}

function SizeCell({ value, onCommit, label }: { value: number; onCommit: (value: number) => void; label: string }) {
  return (
    <input
      key={value}
      defaultValue={value ? String(value) : ""}
      inputMode="numeric"
      aria-label={label}
      placeholder={label}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={(event) => {
        const next = Math.round(Number(event.currentTarget.value));
        if (Number.isFinite(next) && next >= 0 && next !== value) onCommit(next);
        else event.currentTarget.value = value ? String(value) : "";
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={`${CELL} text-right font-mono`}
    />
  );
}

// --- One client, opened ----------------------------------------------------------------------

function ClientDetail({ client }: { client: Client }) {
  function change(next: (current: Client) => Client) {
    updateClient(client.id, next);
  }

  function editContact(id: string, patch: Partial<ClientContact>) {
    change((current) => ({ ...current, contacts: current.contacts.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
  }

  function editLocation(id: string, patch: Partial<ClientLocation>) {
    change((current) => ({ ...current, locations: current.locations.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
  }

  return (
    <div className="space-y-6 border-t border-line bg-raised/30 px-5 py-5">
      <section aria-label="Contacts">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-[13px] font-medium">
            <UserRound size={14} className="text-muted" aria-hidden="true" />
            Contacts
          </h4>
          <button
            type="button"
            onClick={() => change((current) => ({ ...current, contacts: [...current.contacts, { id: newId("contact"), name: "", role: "", phone: "", email: "" }] }))}
            className="btn btn-secondary px-2.5 py-1 text-xs"
          >
            <Plus size={13} strokeWidth={2.5} aria-hidden="true" />
            Add contact
          </button>
        </div>
        {client.contacts.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No contacts yet. Add the people you deal with, such as a general manager.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-lg border border-line bg-panel">
            <div className="grid grid-cols-[1fr_1fr_1fr_1.4fr_2rem] gap-1 border-b border-line bg-raised/50 px-2 py-1.5 text-[11px] text-subtle">
              <span className="px-2">Name</span>
              <span className="px-2">Role</span>
              <span className="px-2">Phone</span>
              <span className="px-2">Email</span>
              <span />
            </div>
            <ul className="divide-y divide-line">
              {client.contacts.map((contact) => (
                <li key={contact.id} className="grid grid-cols-[1fr_1fr_1fr_1.4fr_2rem] items-center gap-1 px-2 py-1">
                  <TextCell value={contact.name} label="Name" copy placeholder="Samir" onCommit={(name) => editContact(contact.id, { name })} />
                  <TextCell value={contact.role} label="Role" copy placeholder="General manager" onCommit={(role) => editContact(contact.id, { role })} />
                  <TextCell value={contact.phone} label="Phone" copy placeholder="Phone number" type="tel" onCommit={(phone) => editContact(contact.id, { phone })} />
                  <TextCell value={contact.email} label="Email" copy placeholder="name@company.com" type="email" onCommit={(email) => editContact(contact.id, { email })} />
                  <span className="flex items-center justify-end">
                    <button
                      type="button"
                      onClick={() => change((current) => ({ ...current, contacts: current.contacts.filter((item) => item.id !== contact.id) }))}
                      aria-label="Remove this contact"
                      title="Remove"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-label="Locations">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 text-[13px] font-medium">
            <MapPin size={14} className="text-muted" aria-hidden="true" />
            Locations and sizes
          </h4>
          <button
            type="button"
            onClick={() => change((current) => ({ ...current, locations: [...current.locations, { id: newId("location"), place: "", spot: "", widthMm: 0, heightMm: 0, depthMm: 0 }] }))}
            className="btn btn-secondary px-2.5 py-1 text-xs"
          >
            <Plus size={13} strokeWidth={2.5} aria-hidden="true" />
            Add location
          </button>
        </div>
        {client.locations.length === 0 ? (
          <p className="mt-2 text-xs text-muted">No locations yet. Add each place a stand goes, and how much room there is.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-lg border border-line bg-panel">
            <div className="grid grid-cols-[1.3fr_1.2fr_4.5rem_4.5rem_4.5rem_4.5rem] gap-1 border-b border-line bg-raised/50 px-2 py-1.5 text-[11px] text-subtle">
              <span className="px-2">Place</span>
              <span className="px-2">Where inside</span>
              <span className="px-2 text-right">Width mm</span>
              <span className="px-2 text-right">Height mm</span>
              <span className="px-2 text-right">Depth mm</span>
              <span />
            </div>
            <ul className="divide-y divide-line">
              {client.locations.map((location) => (
                <li key={location.id} className="grid grid-cols-[1.3fr_1.2fr_4.5rem_4.5rem_4.5rem_4.5rem] items-center gap-1 px-2 py-1">
                  <TextCell value={location.place} label="Place" placeholder="Dbayeh" onCommit={(place) => editLocation(location.id, { place })} />
                  <TextCell value={location.spot} label="Where inside" placeholder="Next to the entrance" onCommit={(spot) => editLocation(location.id, { spot })} />
                  <SizeCell value={location.widthMm} label="Width" onCommit={(widthMm) => editLocation(location.id, { widthMm })} />
                  <SizeCell value={location.heightMm} label="Height" onCommit={(heightMm) => editLocation(location.id, { heightMm })} />
                  <SizeCell value={location.depthMm} label="Depth" onCommit={(depthMm) => editLocation(location.id, { depthMm })} />
                  <span className="flex items-center justify-end">
                    <CopyButton compact text={locationText(location)} label="Copy this location" />
                    <button
                      type="button"
                      onClick={() => change((current) => ({ ...current, locations: current.locations.filter((item) => item.id !== location.id) }))}
                      aria-label="Remove this location"
                      title="Remove"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

// --- The page ----------------------------------------------------------------------------------

export function ClientsSettings() {
  const clients = useSyncExternalStore(subscribeClients, getClients, getServerClients);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const sorted = [...clients].sort((a, b) => a.name.localeCompare(b.name));
    if (!needle) return sorted;
    // Search finds a client by name, contact, phone, email, or place.
    return sorted.filter((client) =>
      [client.name, ...client.contacts.flatMap((item) => [item.name, item.phone, item.email]), ...client.locations.map((item) => item.place)].some((value) => value.toLowerCase().includes(needle)),
    );
  }, [clients, search]);

  const duplicate = name.trim() !== "" && findClientByName(name) !== undefined;

  function add(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || duplicate) return;
    const client = addClient(name);
    setName("");
    setSearch("");
    setOpenId(client.id);
  }

  return (
    <div className="mx-auto max-w-4xl px-8 pt-10 pb-20">
      <header>
        <h2 className="text-2xl font-semibold tracking-tight">Clients</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
          The companies you build stands for, with their contacts and the places their stands go. Every new chat is for a client: pick one here, or type a new name in the chat and it is added to this list.
        </p>
      </header>

      <form onSubmit={add} className="mt-8 flex items-center gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New client name"
          aria-label="New client name"
          maxLength={120}
          className="field flex-1 py-2 text-[13px]"
        />
        <button type="submit" disabled={!name.trim() || duplicate} className="btn btn-primary shrink-0 px-3.5 py-2 text-xs">
          <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
          Add client
        </button>
      </form>
      {duplicate ? <p className="mt-1.5 text-xs text-danger">This client is already in the list.</p> : null}

      <section aria-labelledby="clients-title" className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel shadow-soft">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
          <h3 id="clients-title" className="text-sm font-semibold">
            All clients <span className="ml-1 font-normal text-muted">{clients.length}</span>
          </h3>
          <label className="relative block w-64">
            <Search size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, contact or place"
              aria-label="Search clients"
              className="field py-1.5 pl-8 text-[13px]"
            />
          </label>
        </div>

        {clients.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">No clients yet. Add one above, or type a name in a new chat.</p>
        ) : shown.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">No client matches &ldquo;{search}&rdquo;.</p>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((client) => {
              const open = openId === client.id;
              return (
                <li key={client.id}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : client.id)}
                      aria-expanded={open}
                      aria-label={open ? `Close ${client.name}` : `Open ${client.name}`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle transition-colors hover:bg-raised hover:text-ink"
                    >
                      <ChevronRight size={15} strokeWidth={2.25} aria-hidden="true" className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
                    </button>
                    <input
                      key={`${client.id}:${client.name}`}
                      defaultValue={client.name}
                      aria-label={`Name of ${client.name}`}
                      maxLength={120}
                      onBlur={(event) => {
                        const next = event.currentTarget.value.trim();
                        const clash = findClientByName(next);
                        if (next && (!clash || clash.id === client.id)) renameClient(client.id, next);
                        else event.currentTarget.value = client.name;
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") event.currentTarget.blur();
                      }}
                      className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1.5 text-[13px] font-medium outline-none transition-colors hover:bg-raised focus:bg-raised"
                    />
                    <span className="shrink-0 text-xs text-subtle">
                      {client.contacts.length} {client.contacts.length === 1 ? "contact" : "contacts"} · {client.locations.length} {client.locations.length === 1 ? "location" : "locations"}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Remove ${client.name} with its contacts and locations? Jobs already made for them are not affected.`)) removeClient(client.id);
                      }}
                      aria-label={`Remove ${client.name}`}
                      title="Remove"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                  {open ? <ClientDetail client={client} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
