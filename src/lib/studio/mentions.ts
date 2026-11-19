import type { DesignDocument } from "../systems/modular/schema";

/**
 * A mention is something in the scene the user is talking about in the chat.
 * The selection is the single source of truth: chips in the chat, the Edit panel,
 * and the 3D view all show the same selection, and a sent message remembers
 * which pieces it meant.
 */
export type Mention = {
  /** Stable key for the chip. */
  id: string;
  kind: "piece" | "group" | "bay";
  label: string;
  /** Selection ids this mention stands for. A group stands for all of its pieces. */
  ids: string[];
  color?: string;
};

const EDGE_NAME: Record<string, string> = { back: "Back", left: "Left", right: "Right", front: "Front" };

/** Piece names can repeat (two "Shelf" pieces), so repeated names carry their id to stay unambiguous. */
function pieceLabels(document: DesignDocument) {
  const counts = new Map<string, number>();
  for (const part of document.parts) counts.set(part.name, (counts.get(part.name) ?? 0) + 1);
  return new Map(
    document.parts.map((part) => [part.id, (counts.get(part.name) ?? 0) > 1 ? `${part.name} (${part.id})` : part.name] as const),
  );
}

/** The chips for a selection. A fully selected group is one chip. */
export function describeSelection(document: DesignDocument, selection: string[]): Mention[] {
  const chosen = new Set(selection);
  const labels = pieceLabels(document);
  const mentions: Mention[] = [];
  const doneGroups = new Set<string>();
  for (const part of document.parts) {
    if (!chosen.has(part.id)) continue;
    if (part.group) {
      if (doneGroups.has(part.group)) continue;
      const members = document.parts.filter((item) => item.group === part.group);
      if (members.every((member) => chosen.has(member.id))) {
        doneGroups.add(part.group);
        mentions.push({
          id: `group:${part.group}`,
          kind: "group",
          label: document.groups?.[part.group] ?? "Group",
          ids: members.map((member) => member.id),
        });
        continue;
      }
    }
    mentions.push({ id: part.id, kind: "piece", label: labels.get(part.id) ?? part.name, ids: [part.id], color: part.color });
  }
  for (const id of selection) {
    const match = id.match(/^panel:(back|left|right|front):(\d+)$/);
    if (match) {
      mentions.push({ id, kind: "bay", label: `${EDGE_NAME[match[1]]} wall, bay ${Number(match[2]) + 1}`, ids: [id] });
    }
  }
  return mentions;
}

export type MentionOption = Mention & { detail: string };

/** What the @ picker offers: groups first, then pieces, filtered by what was typed after the @. */
export function mentionOptions(document: DesignDocument, query: string, limit = 8): MentionOption[] {
  const needle = query.trim().toLowerCase();
  const labels = pieceLabels(document);
  const options: MentionOption[] = [];
  const seen = new Set<string>();
  for (const part of document.parts) {
    if (!part.group || seen.has(part.group)) continue;
    seen.add(part.group);
    const members = document.parts.filter((item) => item.group === part.group);
    options.push({
      id: `group:${part.group}`,
      kind: "group",
      label: document.groups?.[part.group] ?? "Group",
      ids: members.map((member) => member.id),
      detail: `${members.length} pieces`,
    });
  }
  for (const part of document.parts) {
    const size =
      part.shape === "cylinder"
        ? `Ø ${Math.round(part.width)}`
        : `${Math.round(part.width)} × ${Math.round(part.depth)} × ${Math.round(part.height)}`;
    options.push({
      id: part.id,
      kind: "piece",
      label: labels.get(part.id) ?? part.name,
      ids: [part.id],
      color: part.color,
      detail: size,
    });
  }
  const matches = needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  // Names that start with the typed text come first.
  matches.sort((a, b) => Number(b.label.toLowerCase().startsWith(needle)) - Number(a.label.toLowerCase().startsWith(needle)));
  return matches.slice(0, limit);
}

/** Read the mentions stored on a sent message. Anything malformed is ignored. */
export function readMentions(metadata: unknown): Mention[] {
  if (!metadata || typeof metadata !== "object" || !("mentions" in metadata)) return [];
  const raw = (metadata as { mentions: unknown }).mentions;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { id, kind, label, ids, color } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof label !== "string" || !Array.isArray(ids)) return [];
    if (kind !== "piece" && kind !== "group" && kind !== "bay") return [];
    return [
      {
        id,
        kind,
        label,
        ids: ids.filter((value): value is string => typeof value === "string"),
        ...(typeof color === "string" ? { color } : {}),
      },
    ];
  });
}

/** One line for the model, so each message keeps pointing at the pieces it meant even after the selection changes. */
export function mentionNote(mentions: Mention[]) {
  if (mentions.length === 0) return "";
  const items = mentions.map((mention) =>
    mention.kind === "group"
      ? `group "${mention.label}" (piece ids: ${mention.ids.join(", ")})`
      : `"${mention.label}" (id: ${mention.ids.join(", ")})`,
  );
  return `[Pieces this message refers to: ${items.join("; ")}]`;
}
