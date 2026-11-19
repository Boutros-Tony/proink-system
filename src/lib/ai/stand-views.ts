import sharp from "sharp";
import { compileDesign } from "../systems/modular/compile";
import { technicalSvg } from "../systems/modular/drawings";
import type { DesignDocument } from "../systems/modular/schema";

const VIEW_WIDTH = 1600;

/**
 * Front, side, and plan of an assembled stand, as one PNG for the production check.
 * Nothing to draw when the pieces are still parked side by side, or when there are none.
 */
export async function standViews(document: DesignDocument): Promise<{ mediaType: "image/png"; base64: string } | null> {
  if (document.assembled !== true || document.parts.length === 0) return null;
  const svg = technicalSvg(document, compileDesign(document), { bare: true });
  const png = await sharp(Buffer.from(svg)).resize({ width: VIEW_WIDTH }).png().toBuffer();
  return { mediaType: "image/png", base64: png.toString("base64") };
}
