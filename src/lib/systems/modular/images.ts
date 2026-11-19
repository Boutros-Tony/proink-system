import { partFootprint } from "./geometry";
import type { ImageFace, PartImage, PartShape } from "./schema";

type PartSize = { shape: PartShape; width: number; height: number; depth: number };

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/** Size in mm of one face of a piece. A cylinder has one wrapped face: circumference by height. */
export function faceSize(part: PartSize, face: ImageFace) {
  if (part.shape === "cylinder") return { width: Math.PI * part.width, height: part.height };
  const footprint = partFootprint(part);
  if (face === "left" || face === "right") return { width: footprint.depth, height: part.height };
  if (face === "top") return { width: footprint.width, height: footprint.depth };
  return { width: footprint.width, height: part.height };
}

export type ImageLayout = {
  face: ImageFace;
  fit: "contain" | "cover";
  /** The area the picture may use, in mm. */
  area: { width: number; height: number };
  /** Printed size of the picture on the piece, in mm. */
  width: number;
  height: number;
  /** Shift from the center of the area, in mm. */
  offsetX: number;
  offsetY: number;
  /** Which part of the picture file is shown. 0 to 1 on each axis. */
  uv: { u0: number; u1: number; v0: number; v1: number };
};

/**
 * Work out where a picture sits on its face and how big it prints.
 * The 3D view, the artwork schedule, and the Edit panel all use this so they agree.
 */
export function imageLayout(part: PartSize, image: PartImage, aspect: number): ImageLayout {
  const face = image.face ?? "front";
  const fit = image.fit ?? "contain";
  const ratio = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  const full = faceSize(part, face);
  // A logo on a cylinder should sit on the visible front half, not wrap all the way round.
  const area = part.shape === "cylinder" && fit === "contain" ? { width: full.width / 2, height: full.height } : full;

  if (fit === "cover") {
    const faceRatio = area.width / area.height;
    const uv =
      ratio > faceRatio
        ? { u0: (1 - faceRatio / ratio) / 2, u1: 1 - (1 - faceRatio / ratio) / 2, v0: 0, v1: 1 }
        : { u0: 0, u1: 1, v0: (1 - ratio / faceRatio) / 2, v1: 1 - (1 - ratio / faceRatio) / 2 };
    return { face, fit, area, width: area.width, height: area.height, offsetX: 0, offsetY: 0, uv };
  }

  const widest = Math.min(area.width, area.height * ratio);
  const scale = clamp(image.scale ?? 1, 0.05, 1);
  const width = widest * scale;
  const height = width / ratio;
  const roomX = Math.max(0, (area.width - width) / 2);
  const roomY = Math.max(0, (area.height - height) / 2);
  return {
    face,
    fit,
    area,
    width,
    height,
    offsetX: clamp((image.x ?? 0) * area.width, -roomX, roomX),
    offsetY: clamp((image.y ?? 0) * area.height, -roomY, roomY),
    uv: { u0: 0, u1: 1, v0: 0, v1: 1 },
  };
}

/** Replace the picture on a face, or add one. A piece holds one picture per face. */
export function withImage(images: PartImage[] | undefined, next: PartImage): PartImage[] {
  const face = next.face ?? "front";
  return [...(images ?? []).filter((image) => (image.face ?? "front") !== face), next];
}

/** The first face that does not yet carry a picture, so "Add image" never overwrites one. */
export function freeFace(images: PartImage[] | undefined, faces: readonly ImageFace[]): ImageFace {
  const used = new Set((images ?? []).map((image) => image.face ?? "front"));
  return faces.find((face) => !used.has(face)) ?? faces[0];
}
