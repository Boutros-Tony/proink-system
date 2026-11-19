import { ExtrudeGeometry, ShapePath, type BufferGeometry } from "three";

/**
 * Cut letters, the outlines of a real font rather than blocks.
 * The face is Roboto Regular, Copyright 2015 Google Inc., Apache License 2.0.
 * The file and its license live in public/fonts.
 */

type GlyphCommand = {
  type: string;
  x: number;
  y: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

export type LetterFont = {
  getPath: (text: string, x: number, y: number, fontSize: number) => { commands: GlyphCommand[] };
};

const FONT_URL = "/fonts/Roboto-Regular.ttf";
const DRAW_SIZE = 100;

let font: LetterFont | null = null;
let pending: Promise<LetterFont> | null = null;
const listeners = new Set<() => void>();

export function getLetterFont() {
  return font;
}

export function subscribeLetterFont(listener: () => void) {
  listeners.add(listener);
  if (typeof window !== "undefined" && !font) void loadLetterFont().catch(() => undefined);
  return () => listeners.delete(listener);
}

/** Load the font once. Safe to call again; later calls share the first. */
export function loadLetterFont() {
  if (font) return Promise.resolve(font);
  if (!pending) {
    pending = fetch(FONT_URL)
      .then((response) => {
        if (!response.ok) throw new Error("The letter font could not be loaded.");
        return response.arrayBuffer();
      })
      .then(async (buffer) => {
        const opentype = await import("opentype.js");
        const parsed = opentype.parse(buffer);
        font = parsed;
        listeners.forEach((listener) => listener());
        return parsed;
      })
      .catch((error: unknown) => {
        pending = null;
        throw error;
      });
  }
  return pending;
}

/**
 * Letters centered on the origin, in meters, fitting inside the given box.
 * Height is the letter height. Width is only a limit, so a wide box does not stretch the letters.
 * Depth is the sheet thickness.
 */
export function buildLetterGeometry(source: LetterFont, text: string, widthMm: number, heightMm: number, depthMm: number): BufferGeometry | null {
  const drawn = text.trim();
  if (!drawn || !(widthMm > 0) || !(heightMm > 0) || !(depthMm > 0)) return null;

  const outline = source.getPath(drawn, 0, 0, DRAW_SIZE);
  const shapePath = new ShapePath();
  for (const command of outline.commands) {
    if (command.type === "M") shapePath.moveTo(command.x, -command.y);
    else if (command.type === "L" && shapePath.currentPath) shapePath.lineTo(command.x, -command.y);
    else if (command.type === "C" && shapePath.currentPath) shapePath.bezierCurveTo(command.x1, -command.y1, command.x2, -command.y2, command.x, -command.y);
    else if (command.type === "Q" && shapePath.currentPath) shapePath.quadraticCurveTo(command.x1, -command.y1, command.x, -command.y);
    else if (command.type === "Z") shapePath.currentPath?.closePath();
  }

  const shapes = shapePath.toShapes();
  if (shapes.length === 0) return null;
  const geometry = new ExtrudeGeometry(shapes, { depth: DRAW_SIZE, bevelEnabled: false, curveSegments: 10 });
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box) {
    geometry.dispose();
    return null;
  }
  const spanX = box.max.x - box.min.x;
  const spanY = box.max.y - box.min.y;
  const spanZ = box.max.z - box.min.z;
  if (!(spanX > 0) || !(spanY > 0) || !(spanZ > 0)) {
    geometry.dispose();
    return null;
  }

  geometry.translate(-(box.min.x + box.max.x) / 2, -(box.min.y + box.max.y) / 2, -(box.min.z + box.max.z) / 2);
  // Match the requested height, and only shrink when the row would be wider than the piece.
  let scale = heightMm / 1000 / spanY;
  if (spanX * scale > widthMm / 1000) scale = widthMm / 1000 / spanX;
  geometry.scale(scale, scale, depthMm / 1000 / spanZ);
  return geometry;
}
