import { z } from "zod";
import { unionBounds } from "./geometry";
import { addParts } from "./ops";
import { applyDesignPatch } from "./patch";
import { equipmentKind } from "../equipment";
import { chamferSchema, cornerRadiiSchema, curveSchema, holeSchema, outlineSchema, partMaterialSchema, pathSchema, roundSchema, SHAPED_FACES, type DesignDocument, type PartDraft } from "./schema";

/**
 * Elements read from a technical sheet, a simulation, or a conversation. Quote mode has no drawing step,
 * so the chat only says what each element is, how big, and what it is made of. The studio lays them out
 * itself, in tidy rows, and they appear in the Edit panel and are costed like any other piece.
 */

export const elementDraftSchema = z.object({
  name: z.string().min(1).max(80),
  shape: z.enum(["box", "cylinder", "tube"]).optional(),
  /** Millimeters. A cylinder's width is its diameter. */
  width: z.number().positive().max(50_000),
  height: z.number().positive().max(50_000),
  /** Millimeters. Ignored for a cylinder. A tube's depth is its diameter. */
  depth: z.number().positive().max(50_000).optional(),
  /** A cone, hollow, part-circle, or turned cylinder. */
  round: roundSchema.optional(),
  /** A tube's centerline on its face, and whether it closes into a loop. */
  path: pathSchema.optional(),
  closed: z.boolean().optional(),
  material: partMaterialSchema,
  /** The shop material id when the piece is cut from a sheet that is not one of the materials above, such as acrylic. */
  materialId: z.string().min(1).max(60).optional(),
  color: z.string().min(1).max(20).optional(),
  /** The characters of a cut-letter sign, spaces included. One element for the whole word, never one box per letter. */
  text: z.string().min(1).max(40).optional(),
  /** How many identical elements. Each becomes its own piece, numbered. */
  quantity: z.number().int().min(1).max(50).optional(),
  /** The size or material was not on the sheet and was assumed, so the name says so. */
  estimated: z.boolean().optional(),
  /** `equipment` is a screen or device. `rental` is furniture or a plant. Anything built from board is `built`. */
  kind: z.enum(["built", "letters", "equipment", "rental"]).optional(),
  /** The unit this piece belongs to, such as "Retail display". Leave it out when the job is one unit. */
  item: z.string().min(1).max(80).optional(),
  /** A bent panel: width is the straight distance between its ends and depth how far it bows. */
  curve: curveSchema.optional(),
  /** Rounded corners, straight cuts, and openings on a box, on the face set by face. */
  corners: cornerRadiiSchema.optional(),
  chamfers: chamferSchema.optional(),
  holes: z.array(holeSchema).max(8).optional(),
  outline: outlineSchema.optional(),
  face: z.enum(SHAPED_FACES).optional(),
});
export type ElementDraft = z.infer<typeof elementDraftSchema>;

/** Stable id for a named unit. The same name always returns the same id. */
export function itemSlug(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
  return `item-${slug || "item"}`;
}

/** An item id already on the job, or the id its name would use. */
export function resolveItemId(document: DesignDocument, value: string) {
  const trimmed = value.trim();
  if (document.groups?.[trimmed]) return trimmed;
  const named = Object.entries(document.groups ?? {}).find(([, label]) => label.toLowerCase() === trimmed.toLowerCase());
  if (named) return named[0];
  return itemSlug(trimmed);
}

const GAP_MM = 300;
const ROW_LIMIT_MM = 6000;
const DEFAULT_DEPTH_MM = 500;
const DEFAULT_TUBE_MM = 25;

/** Turn element descriptions into pieces, one per unit, and lay them out in rows clear of what is already there. */
export function placeElements(document: DesignDocument, elements: ElementDraft[]) {
  const booth = document.walls.some((wall) => wall.bays.length > 0);
  const bounds = unionBounds(document.parts);
  const startX = booth ? document.envelope.width + GAP_MM * 2 : 0;
  let cursorZ = bounds ? Math.ceil(bounds.maxZ + GAP_MM) : 0;
  let cursorX = startX;
  let rowDepth = 0;

  const drafts: PartDraft[] = [];
  const names: Record<string, string> = {};
  for (const element of elements) {
    const letters = element.text?.trim();
    const itemName = element.item?.trim();
    const item = itemName ? itemSlug(itemName) : undefined;
    if (item && itemName) names[item] = itemName;
    const shape = letters ? "letters" : (element.shape ?? "box");
    const kind = letters ? "letters" : element.kind ?? (equipmentKind(element.name) ? "equipment" : "built");
    const count = element.quantity ?? 1;
    const depth = shape === "cylinder" ? element.width : letters ? (element.depth ?? 10) : shape === "tube" ? (element.depth ?? DEFAULT_TUBE_MM) : (element.depth ?? DEFAULT_DEPTH_MM);
    for (let index = 1; index <= count; index += 1) {
      if (cursorX > startX && cursorX - startX + element.width > ROW_LIMIT_MM) {
        cursorZ += rowDepth + GAP_MM;
        cursorX = startX;
        rowDepth = 0;
      }
      const numbered = count > 1 ? `${element.name} ${index}` : element.name;
      drafts.push({
        name: element.estimated ? `${numbered} (est.)` : numbered,
        shape,
        x: cursorX,
        y: 0,
        z: cursorZ,
        width: element.width,
        height: element.height,
        depth,
        material: element.material,
        ...(element.materialId ? { materialId: element.materialId } : {}),
        ...(element.color ? { color: element.color } : {}),
        ...(letters ? { label: letters } : {}),
        ...(item ? { group: item } : {}),
        ...(shape === "box" ? { curve: element.curve, corners: element.corners, chamfers: element.chamfers, holes: element.holes, outline: element.outline, face: element.face } : {}),
        ...(shape === "cylinder" && element.round ? { round: element.round } : {}),
        ...(shape === "tube" ? { path: element.path, closed: element.closed, face: element.face } : {}),
        kind,
      });
      cursorX += element.width + GAP_MM;
      rowDepth = Math.max(rowDepth, depth);
    }
  }
  const added = addParts(document, drafts);
  const next: DesignDocument = Object.keys(names).length > 0 ? applyDesignPatch(added.document, { groups: { ...added.document.groups, ...names } }) : { ...added.document };
  delete next.assembled;
  return { document: next, ids: added.ids };
}
