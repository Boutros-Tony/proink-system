/**
 * Bought-in equipment drawn on the stand as a plain box: a TV, a projector, a speaker. It is not cut from
 * board, so it must not be counted as board, and it needs things a board does not: a mount, cables, power.
 * The piece's name is the only thing that says what it is, so this reads the name.
 */

const SCREEN = /\b(tvs?|televisions?|monitors?|lcd|oled|led (?:screen|display|wall)|tv screen|video wall|touch ?screen)\b/i;
const DEVICE = /\b(projectors?|speakers?|ipads?|tablets?|laptops?)\b/i;

export type EquipmentKind = "screen" | "device";

function kindFromName(name: string): EquipmentKind | null {
  if (SCREEN.test(name)) return "screen";
  if (DEVICE.test(name)) return "device";
  return null;
}

/** A name, or a piece. A stored kind wins, so a screen is not priced as board because of its name. */
export function equipmentKind(input: string | { name: string; kind?: string | null }): EquipmentKind | null {
  if (typeof input === "string") return kindFromName(input);
  if (input.kind === "equipment" || input.kind === "rental") return kindFromName(input.name) ?? "device";
  return kindFromName(input.name);
}
