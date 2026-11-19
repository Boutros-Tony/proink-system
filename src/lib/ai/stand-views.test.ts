import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { hookStand } from "../../../evals/cases/hook-stand";
import { createEmptyDesign } from "../systems/modular/patch";
import { standViews } from "./stand-views";

describe("standViews", () => {
  it("renders the assembled stand as a PNG and skips one that is not assembled", async () => {
    const view = await standViews(hookStand());
    expect(view?.mediaType).toBe("image/png");
    const bytes = Buffer.from(view?.base64 ?? "", "base64");
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const meta = await sharp(bytes).metadata();
    expect(meta.width).toBe(1600);
    expect(meta.format).toBe("png");

    expect(await standViews({ ...hookStand(), assembled: false })).toBeNull();
    expect(await standViews({ ...createEmptyDesign(), assembled: true })).toBeNull();
  });
});
