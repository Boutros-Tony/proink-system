import { createEmptyDesign } from "../../src/lib/systems/modular/patch";
import type { DesignDocument, Outline, ScenePart } from "../../src/lib/systems/modular/schema";

export const HOOK_BRIEF =
  "Hook stand for a pharmacy. It carries blister packs about 100 mm wide, 180 mm high and 20 mm thick, hung on the hooks, about 8 packs per hook.";

const GROUP = "hook-stand";

/** Full depth up to 900, then the front slopes back so the top is only 200 deep. Face x 0 is the front edge. */
const SIDE_OUTLINE: Outline = [
  [0, 0],
  [400, 0],
  [400, 1600],
  [200, 1600],
  [0, 900],
];

const ROWS = [1450, 1250, 1050, 850, 650];
const HOOK_X = [80, 215, 350, 485];
const LETTERS = ["a", "b", "c", "d"];

/**
 * The pharmacy hook stand used by the measurement tests and the eval cases.
 * Rows 1 and 2 take `topHookDepth`; the lower rows stay at 300 mm, where the side is still full depth.
 */
export function hookStand(options: { topHookDepth?: number; sloped?: boolean } = {}): DesignDocument {
  const topHookDepth = options.topHookDepth ?? 300;
  const sloped = options.sloped !== false;
  const side = (id: string, name: string, x: number): ScenePart => ({
    id,
    name,
    shape: "box",
    x,
    y: 0,
    z: 0,
    width: 17,
    height: 1600,
    depth: 400,
    material: "paint",
    group: GROUP,
    ...(sloped ? { face: "side" as const, outline: SIDE_OUTLINE } : {}),
  });

  const parts: ScenePart[] = [
    side("left", "Left side", 0),
    side("right", "Right side", 583),
    { id: "back", name: "Back panel", shape: "box", x: 17, y: 0, z: 0, width: 566, height: 1600, depth: 17, material: "paint", group: GROUP },
    { id: "base", name: "Base shelf", shape: "box", x: 17, y: 100, z: 17, width: 566, height: 17, depth: 383, material: "paint", group: GROUP },
    { id: "plinth", name: "Plinth", shape: "box", x: 17, y: 0, z: 383, width: 566, height: 100, depth: 17, material: "paint", group: GROUP },
  ];

  ROWS.forEach((y, rowIndex) => {
    const row = rowIndex + 1;
    const depth = row <= 2 ? topHookDepth : 300;
    const cm = Math.round(depth / 10);
    HOOK_X.forEach((x, index) => {
      const letter = LETTERS[index] ?? "a";
      parts.push({
        id: `hook-${row}${letter}`,
        name: `Hook ${cm} cm row ${row} ${letter}`,
        shape: "box",
        kind: "equipment",
        material: "metal",
        x,
        y,
        z: 17,
        width: 6,
        height: 40,
        depth,
        group: GROUP,
      });
    });
  });

  return {
    ...createEmptyDesign(),
    envelope: { width: 600, depth: 400, height: 1600 },
    assembled: true,
    groups: { [GROUP]: "Hook stand" },
    parts,
  };
}
