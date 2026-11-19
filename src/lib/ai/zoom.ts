import type { UIMessage } from "ai";
import sharp from "sharp";

export type AttachedPicture = { number: number; name: string; mediaType: string; width: number; height: number; bytes: Buffer };

const PICTURE_TYPES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]);
const MIN_SIDE = 0.02;
const MIN_PX = 8;
const LONG_SIDE = 1536;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function decodeDataUrl(url: string) {
  if (!url.startsWith("data:") || !url.includes(";base64,")) return null;
  const payload = url.slice(url.indexOf(";base64,") + ";base64,".length);
  if (!payload) return null;
  const bytes = Buffer.from(payload, "base64");
  return bytes.length > 0 ? bytes : null;
}

export async function attachedPictures(messages: UIMessage[]): Promise<AttachedPicture[]> {
  const pictures: AttachedPicture[] = [];
  for (const message of messages) {
    if (message?.role !== "user" || !Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      try {
        if (part.type !== "file") continue;
        const mediaType = part.mediaType.toLowerCase();
        if (!PICTURE_TYPES.has(mediaType)) continue;
        const bytes = decodeDataUrl(part.url);
        if (!bytes) continue;
        const meta = await sharp(bytes).metadata();
        const width = meta.autoOrient?.width ?? meta.width;
        const height = meta.autoOrient?.height ?? meta.height;
        if (!width || !height) continue;
        const number = pictures.length + 1;
        pictures.push({
          number,
          name: part.filename || `picture ${number}`,
          mediaType: part.mediaType,
          width,
          height,
          bytes,
        });
      } catch {
        continue;
      }
    }
  }
  return pictures;
}

export type ZoomRegion = { x: number; y: number; width: number; height: number };

function crop(picture: AttachedPicture, region: ZoomRegion) {
  let x = clamp(region.x, 0, 1);
  let y = clamp(region.y, 0, 1);
  let width = clamp(region.width, 0, 1);
  let height = clamp(region.height, 0, 1);
  if (x >= 1) x = 1 - MIN_SIDE;
  if (y >= 1) y = 1 - MIN_SIDE;
  if (x + width > 1) width = 1 - x;
  if (y + height > 1) height = 1 - y;
  if (width < MIN_SIDE) {
    width = MIN_SIDE;
    if (x + width > 1) x = 1 - width;
  }
  if (height < MIN_SIDE) {
    height = MIN_SIDE;
    if (y + height > 1) y = 1 - height;
  }

  let left = Math.round(x * picture.width);
  let top = Math.round(y * picture.height);
  const boxWidth = Math.min(picture.width, Math.max(MIN_PX, Math.round(width * picture.width)));
  const boxHeight = Math.min(picture.height, Math.max(MIN_PX, Math.round(height * picture.height)));
  left = clamp(left, 0, picture.width - boxWidth);
  top = clamp(top, 0, picture.height - boxHeight);
  return { left, top, width: boxWidth, height: boxHeight };
}

export async function zoomPicture(picture: AttachedPicture, region: ZoomRegion): Promise<{ png: string; width: number; height: number; region: { left: number; top: number; width: number; height: number } }> {
  const box = crop(picture, region);
  const { data, info } = await sharp(picture.bytes)
    .rotate()
    .extract(box)
    .resize({ width: LONG_SIDE, height: LONG_SIDE, fit: "inside", kernel: "lanczos3" })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { png: data.toString("base64"), width: info.width, height: info.height, region: box };
}

export function pictureList(pictures: AttachedPicture[]): string {
  return pictures.map((picture) => `${picture.number}. ${picture.name}, ${picture.width} × ${picture.height} px`).join("\n");
}
