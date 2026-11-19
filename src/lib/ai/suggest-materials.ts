import { z } from "zod";
import { partMaterialSchema, type PartMaterial } from "@/lib/systems/modular/schema";

export const SUGGEST_MATERIALS_PROMPT = `You assign shop materials to pieces imported from a 3D file for an exhibition stand.
Choose one material for each piece: paint, mdf, wood, laminate, metal, glass.
Use the piece name and the material name from the file when they say what it is. When they do not, choose the most likely material for that kind of piece and a sensible hex color.
Reply with JSON only, an array of {"id": string, "material": string, "color": "#rrggbb"}. Include every id you were given and no others.`;

const suggestionSchema = z.object({
  id: z.string(),
  material: partMaterialSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export type MaterialSuggestion = {
  id: string;
  material: PartMaterial;
  color: string;
};

export function readSuggestions(text: string, allowed: Set<string>): MaterialSuggestion[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = z.array(suggestionSchema).safeParse(JSON.parse(text.slice(start, end + 1)));
    if (!parsed.success) return null;
    const seen = new Set<string>();
    const suggestions = parsed.data.filter((item) => allowed.has(item.id) && !seen.has(item.id) && seen.add(item.id));
    return suggestions.length > 0 ? suggestions : null;
  } catch {
    return null;
  }
}
