import type { UIMessage } from "ai";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { attachedPictures, pictureList, zoomPicture } from "./zoom";

async function sheet() {
  const mark = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#ff0000" } }).png().toBuffer();
  return sharp({ create: { width: 400, height: 200, channels: 3, background: "#ffffff" } })
    .composite([{ input: mark, left: 300, top: 100 }])
    .png()
    .toBuffer();
}

describe("attached pictures", () => {
  it("numbers user pictures and skips everything else", async () => {
    const bytes = await sheet();
    const b64 = bytes.toString("base64");
    const messages: UIMessage[] = [
      {
        id: "m1",
        role: "user",
        parts: [
          { type: "text", text: "count the shelves" },
          { type: "file", mediaType: "image/png", filename: "sheet.png", url: `data:image/png;base64,${b64}` },
          { type: "file", mediaType: "image/png", filename: "raw.png", url: "data:image/png,not-base64" },
          { type: "file", mediaType: "image/png", filename: "junk.png", url: "data:image/png;base64,@@@not-a-picture@@@" },
        ],
      },
      {
        id: "m2",
        role: "assistant",
        parts: [{ type: "file", mediaType: "image/png", filename: "reply.png", url: `data:image/png;base64,${b64}` }],
      },
    ];

    const pictures = await attachedPictures(messages);
    expect(pictures).toHaveLength(1);
    expect(pictures[0]?.number).toBe(1);
    expect(pictures[0]?.name).toBe("sheet.png");
    expect(pictures[0]?.width).toBe(400);
    expect(pictures[0]?.height).toBe(200);
    expect(pictureList(pictures)).toBe("1. sheet.png, 400 × 200 px");
    expect(pictureList([])).toBe("");

    const zoomed = await zoomPicture(pictures[0]!, { x: 0.7, y: 0.45, width: 0.1, height: 0.15 });
    expect(zoomed.region).toEqual({ left: 280, top: 90, width: 40, height: 30 });
    expect(Math.max(zoomed.width, zoomed.height)).toBe(1536);
    expect(zoomed.png.startsWith("data:")).toBe(false);

    const { data, info } = await sharp(Buffer.from(zoomed.png, "base64")).raw().toBuffer({ resolveWithObject: true });
    const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    expect(data[center]).toBeGreaterThan(200);
    // Lanczos blends the left edge of the red square, which is the crop center. The middle of the square is solid red.
    const mark = (Math.round((info.height * 2) / 3) * info.width + Math.round((info.width * 3) / 4)) * info.channels;
    expect(data[mark]).toBeGreaterThan(200);
    expect(data[mark + 1]).toBeLessThan(80);

    const clamped = await zoomPicture(pictures[0]!, { x: 0.95, y: 0.95, width: 0.5, height: 0.5 });
    expect(clamped.region.left + clamped.region.width).toBeLessThanOrEqual(400);
    expect(clamped.region.top + clamped.region.height).toBeLessThanOrEqual(200);
    expect(clamped.region.left).toBeGreaterThanOrEqual(0);
    expect(clamped.region.top).toBeGreaterThanOrEqual(0);
  });
});
