/** A rectangle on the simulation, as fractions of the picture from the top-left. */
export type ImageRegion = { x: number; y: number; width: number; height: number };

export type SimulationEdit = {
  /** The current simulation. The image model edits this picture instead of starting over. */
  base: string;
  /** Artwork to place, such as a logo for the header. */
  references: string[];
  region: ImageRegion | null;
};

const MIN_SPAN = 0.02;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function readImageRegion(value: unknown): ImageRegion | null {
  if (!value || typeof value !== "object") return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (![x, y, width, height].every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  const box = {
    x: clamp(x as number, 0, 1),
    y: clamp(y as number, 0, 1),
    width: clamp(width as number, 0, 1),
    height: clamp(height as number, 0, 1),
  };
  if (box.x + box.width > 1) box.width = 1 - box.x;
  if (box.y + box.height > 1) box.height = 1 - box.y;
  if (box.width < MIN_SPAN || box.height < MIN_SPAN) return null;
  return box;
}

function readEditFlag(metadata: unknown): { present: boolean; region: ImageRegion | null } {
  if (!metadata || typeof metadata !== "object" || !("simulationEdit" in metadata)) return { present: false, region: null };
  const edit = (metadata as { simulationEdit: unknown }).simulationEdit;
  if (!edit || typeof edit !== "object") return { present: false, region: null };
  const region = "region" in edit ? readImageRegion((edit as { region: unknown }).region) : null;
  return { present: true, region };
}

type EditMessage = {
  role: string;
  metadata?: unknown;
  parts: { type: string; mediaType?: string; url?: string }[];
};

/** The pictures and selection on the latest edit request. Null when this turn is a new picture. */
export function editFromMessages(messages: EditMessage[]): SimulationEdit | null {
  const message = [...messages].reverse().find((item) => item.role === "user");
  if (!message) return null;
  const flag = readEditFlag(message.metadata);
  if (!flag.present) return null;
  const images = message.parts.flatMap((part) =>
    part.type === "file" && part.mediaType?.startsWith("image/") && typeof part.url === "string" && part.url.startsWith("data:image/") ? [part.url] : [],
  );
  if (images.length === 0) return null;
  return { base: images[0], references: images.slice(1, 5), region: flag.region };
}

const percent = (value: number) => Math.round(value * 100);

/** A sentence the image model can follow without seeing the selection box. */
export function regionLine(region: ImageRegion) {
  return `Change only the rectangle that starts ${percent(region.x)}% from the left and ${percent(region.y)}% from the top, and covers ${percent(region.width)}% of the width and ${percent(region.height)}% of the height. Every pixel outside that rectangle stays identical.`;
}
