import { describe, expect, it } from "vitest";
import { BUILD_RULES } from "./build-rules";
import { editFromMessages, readImageRegion } from "./image-edit";
import { imagePrompt, simulationPrompt } from "./image-prompt";
import { DEFAULT_IMAGE_MODEL, findImageModel, IMAGE_MODEL_CATALOG } from "./models";
import { createEmptyDesign } from "../systems/modular/patch";

describe("imagePrompt", () => {
  const prompt = imagePrompt(createEmptyDesign());

  it("wraps the simulation look in user context", () => {
    expect(prompt).toContain("<user-context>");
    expect(prompt).toContain("</user-context>");
    expect(prompt).toContain("<simulation>");
    expect(prompt).toContain("#e4e1db");
  });

  it("uses the same build rules as pricing and drawing", () => {
    expect(prompt).toContain("<rules>");
    for (const rule of BUILD_RULES) expect(prompt).toContain(rule);
  });

  it("does not price or edit the model", () => {
    expect(prompt).toContain("IMAGE MODE");
    expect(prompt).toContain("do not price");
    expect(prompt).toContain("do not edit the 3D model");
  });
});

describe("image models", () => {
  it("offers Google's best image models and defaults to the highest quality", () => {
    expect(IMAGE_MODEL_CATALOG.map((item) => item.model)).toEqual(["gemini-3-pro-image", "gemini-nano-banana-2.1"]);
    expect(DEFAULT_IMAGE_MODEL).toBe("gemini-3-pro-image");
    expect(findImageModel("unknown").model).toBe("gemini-3-pro-image");
  });
});

describe("simulation edit", () => {
  it("keeps an edit on the same picture and inside the selection", () => {
    const prompt = simulationPrompt("Print the logo on the header.", { region: { x: 0.1, y: 0.05, width: 0.4, height: 0.15 }, referenceCount: 1 });
    expect(prompt).toContain("Edit that same picture");
    expect(prompt).toContain("10% from the left");
    expect(prompt).toContain("artwork to print");
  });

  it("reads the selection and the uploaded pictures off the latest message", () => {
    expect(readImageRegion({ x: 0.2, y: 0.1, width: 0.3, height: 0.2 })).toEqual({ x: 0.2, y: 0.1, width: 0.3, height: 0.2 });
    const edit = editFromMessages([
      {
        role: "user",
        metadata: { simulationEdit: { region: { x: 0.2, y: 0.1, width: 0.3, height: 0.2 } } },
        parts: [
          { type: "file", mediaType: "image/png", url: "data:image/png;base64,abc" },
          { type: "file", mediaType: "image/jpeg", url: "data:image/jpeg;base64,logo" },
        ],
      },
    ]);
    expect(edit?.base).toBe("data:image/png;base64,abc");
    expect(edit?.references).toEqual(["data:image/jpeg;base64,logo"]);
    expect(edit?.region?.width).toBe(0.3);
  });
});

describe("simulationPrompt", () => {
  it("sends the studio look with the stand description", () => {
    const prompt = simulationPrompt("A white laminate counter, 2000 mm wide.");
    expect(prompt.startsWith("Photoreal exhibition-stand simulation")).toBe(true);
    expect(prompt).toContain("A white laminate counter, 2000 mm wide.");
  });
});
