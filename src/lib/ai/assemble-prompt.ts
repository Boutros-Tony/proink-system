import { bendProfile } from "../systems/modular/geometry";
import { roundNote } from "../systems/modular/round";
import type { DesignDocument, ScenePart } from "../systems/modular/schema";

/** Assembly only moves and turns priced pieces, so it is the only tool the model gets. */
export const ASSEMBLE_TOOLS = ["arrangeParts", "inspect"] as const;

const mm = (value: number) => Math.round(value);

function bentNote(part: ScenePart) {
  const bend = bendProfile(part, part.curve!);
  const [w, b, l] = [bend.width, bend.tall, bend.length].map(mm);
  const kind = part.curve!.corner ? `a quarter-circle corner, outside at ${part.curve!.corner}` : "a bow";
  return ` · bent board, ${kind}, now seen from ${bend.front ? "the front" : "above"}. Send ${w} × ${b} × ${l} to see the curve from the front, or ${w} × ${l} × ${b} from above${part.curve!.corner ? `, and set corner to topLeft, topRight, bottomLeft, or bottomRight for the corner it rounds` : ""}`;
}

function pieceLines(document: DesignDocument) {
  return document.parts.map((part) => {
    const depth = part.shape === "cylinder" ? part.width : part.depth;
    const size =
      part.shape === "cylinder"
        ? `cylinder Ø ${mm(part.width)} × ${mm(part.height)} tall${part.round ? `, ${roundNote(part)}` : ""}${part.round?.sweep ? ", its round side faces the front" : ""}`
        : part.shape === "tube"
          ? `tube Ø ${mm(part.depth)} along a path in a ${mm(part.width)} × ${mm(part.height)} space`
          : `${mm(part.width)} × ${mm(part.height)} × ${mm(depth)}`;
    const item = part.group ? ` · item ${document.groups?.[part.group] ?? part.group}` : "";
    const fixed = part.shape === "box" ? "" : " · keep this size and orientation";
    return `- ${part.id} · ${part.name} · ${size} · ${part.material ?? "no material"}${item}${part.locked ? " · locked, leave it" : ""}${fixed}${part.tilt ? ` · tilted ${mm(part.tilt)}°` : ""}${part.curve ? bentNote(part) : ""}${part.outline ? ` · cut to a shape on its ${part.face ?? "front"} face${part.face === "side" ? ", its left edge the front" : ""}; keep its sizes in this order so the shape stays the right way round` : ""}`;
  });
}

/** `inspect` adds the production check after the pieces are placed, for the Assemble button. */
export function assemblePrompt(document: DesignDocument, options: { inspect?: boolean } = {}) {
  return `You assemble a stand from pieces that are already cut and priced. You decide where each piece goes and which way it faces. You never add, remove, or resize a piece, and you never mention a price.

<axes>
Millimeters. The origin is the back-left floor corner. +X is to the right, +Y is up, +Z is toward the viewer. x, y, z is the piece's minimum corner. width runs along X, height along Y, depth along Z.
</axes>

<turning-a-piece>
To turn a box, send its same three sizes in a different order. The board it is cut from stays the same.
- A shelf listed as 464 × 488 × 18 lies flat as width 464, height 18, depth 488.
- A side panel listed as 488 × 1600 × 18 runs front to back as width 18, height 1600, depth 488.
- A back panel listed as 500 × 1600 × 18 faces the viewer as width 500, height 1600, depth 18.
- A sloping piece, such as a roof board along a pitch or an angled panel, keeps its true sizes and sets tilt: degrees about its front-to-back axis, counterclockwise as seen from the front, so tilt 30 lifts its right end. It turns around its own center, so x, y, z is still the corner before tilting: put the center where the middle of the board belongs. A roof board 600 wide on a 30° pitch runs along X as width 600, height 18, with tilt 30 on the left slope and -30 on the right. Never stand in a larger box or a chamfered box for a sloping board.
- A bent board keeps its width across the curve; its line says the two ways to send it. The rounded corners of a frame are copies of one quarter corner: give each copy its own corner. In a frame seen from the front, the top-left corner piece sits where the left side meets the top rail and has corner topLeft.
</turning-a-piece>

<how-a-display-goes-together>
- Side panels stand on the floor at both ends and run front to back.
- The back stands at z = 0, between the sides or behind them.
- Shelves lie flat between the sides, at the heights on the sheet. When no height is written, space them evenly.
- A lip or front strip stands on the front edge of its shelf.
- A plinth or kick board stands at the bottom front, between the sides and under the bottom shelf, flush with the front. On a counter it is set back 50 to 75 mm for the toes.
- A header or top sits on top of the sides.
- Pieces touch where they join. Nothing passes through another piece, and nothing floats.
- When the pieces belong to different items, build each item on its own and stand them side by side with a 500 mm gap.
</how-a-display-goes-together>

<pieces>
${pieceLines(document).join("\n")}
</pieces>

<the-ask>
1. Read the attached sheet and the user's messages for the heights, the spacing, and which piece goes where. Use a height that is written instead of guessing.
2. Call arrangeParts once with every piece.
3. The result lists pieces that pass through each other or float. Fix only those, with one more call that sends just the pieces to move.
${
    options.inspect
      ? `4. Then call inspect once. The workshop foreman checks the assembled stand and returns findings. Do not move pieces because of a finding: a finding is for the user.
5. Reply with one short line on what you assembled and anything you could not place. Then the line "Check:" and one line per finding, starting with a dash, serious ones first, at most six: what is wrong, where, with the numbers, and the fix. When there are none, the single line "Check: no problems found." When there are findings, end with the line "Tell me which fixes to apply."`
      : "4. Reply in one short line: what you assembled, and anything you could not place."
  }
</the-ask>`;
}
