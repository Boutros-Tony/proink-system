import { roundNote, tubeLength } from "../systems/modular/round";
import type { DesignDocument } from "../systems/modular/schema";
import { rulesSection } from "./build-rules";
import { regionLine, type ImageRegion } from "./image-edit";

/** The only tool image mode may use. It does not price the job and it does not edit the 3D model. */
export const IMAGE_TOOLS = ["generateStandImage"] as const;

/**
 * Camera, light, and hall that the studio Render view uses.
 * The image model only sees the tool prompt, so this look is sent with every picture.
 */
export const SIMULATION_LOOK = [
  "Photoreal exhibition-stand simulation, the same picture as a studio product render.",
  "Three-quarter view of the open front, camera a little above eye height, about a 32mm lens, the stand filling the frame with a little floor in front.",
  "Soft studio light, brighter from the front-right, a faint fill from the left, gentle contact shadows.",
  "Empty exhibition hall. Floor is warm pale stone, about #e4e1db. Background is a quiet warm gray.",
  "The stand is built from separate pieces with visible edges: painted MDF and laminate with a soft sheen, timber with grain, satin metal, clear glass held in a frame, acrylic letters with real thickness.",
  "No people, no grid, no neighboring stands, no dimension lines, no prices, no captions, no watermark, no software interface.",
].join(" ");

export function simulationPrompt(
  description: string,
  edit?: { region: ImageRegion | null; referenceCount: number },
) {
  const change = description.trim();
  if (!edit) return `${SIMULATION_LOOK}\n\nStand to photograph:\n${change}`;
  const area = edit.region
    ? regionLine(edit.region)
    : "This is an edit of the current picture, not a new stand. Keep the camera, the stand, and the hall. Change only what the instruction names.";
  const artwork =
    edit.referenceCount > 0
      ? "The images after the first are artwork to print on the stand, such as a logo or a photo. Use that artwork itself. Do not redraw the stand from those images."
      : "";
  return [
    "The first image is the current simulation. Edit that same picture.",
    area,
    artwork,
    "Keep the same camera, light, floor, and every part of the stand that was not asked to change.",
    "",
    `Edit:\n${change}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function jobLines(document: DesignDocument) {
  const parts = document.parts.filter((part) => !part.hidden);
  const lines = parts.map((part) => {
    const size =
      part.shape === "cylinder"
        ? `Ø ${Math.round(part.width)} × ${Math.round(part.height)} mm${part.round ? `, ${roundNote(part)}` : ""}`
        : part.shape === "tube"
          ? `Ø ${Math.round(part.depth)} mm, ${(tubeLength(part) / 1000).toFixed(1)} m long${part.closed ? ", a closed loop" : ""}`
          : `${Math.round(part.width)} × ${Math.round(part.height)} × ${Math.round(part.depth)} mm`;
    const letters = part.shape === "letters" && part.label ? ` · letters "${part.label}"` : "";
    const color = part.color ? ` · ${part.color}` : "";
    return `- ${part.name} · ${part.shape} ${size} · ${part.material ?? "unassigned"}${color}${letters}`;
  });
  const booth = document.walls.some((wall) => wall.bays.length > 0)
    ? `Modular booth frame, ${Math.round(document.envelope.width)} × ${Math.round(document.envelope.depth)} × ${Math.round(document.envelope.height)} mm.`
    : "";
  if (!lines.length && !booth) return "Nothing is drawn yet.";
  return [booth, ...lines].filter(Boolean).join("\n");
}

export function imagePrompt(document: DesignDocument) {
  return `<task-context>
You are the visualization designer at a stand-building workshop, working in IMAGE MODE. You produce one photoreal simulation of the stand, the same kind of picture the studio Render view makes. You do not price the job and you do not edit the 3D model.
</task-context>

<tone-context>
Write two or three short plain sentences. No headings, no bullet lists, no prices, no emoji. The picture is the answer. Do not paste the image prompt into the reply.
</tone-context>

<user-context>
Picture the stand the way this workshop shows it to a client: a real photograph of a built stand, not a sketch, not a diagram, and not a CAD screenshot.
<simulation>
- Camera: three-quarter view of the open front, a little above eye height, about a 32mm lens, the stand filling the frame with a little floor in front.
- Light: soft studio light, a brighter key from the front-right, a faint fill from the left, gentle contact shadows.
- Place: an empty exhibition hall. Floor is warm pale stone, about #e4e1db. Background is a quiet warm gray. No grid, no people, no neighboring stands.
- Materials: painted MDF and laminate are smooth panels with a soft sheen, timber shows grain, metal is satin, glass is clear and held in a frame, acrylic letters have thickness and real outlines.
- Construction: sides, back, shelves, counter, plinth, and header are separate pieces with visible edges. A hook, screen, or load on a panel is carried on metal. A light is a real fitting. Nothing is one solid blob, and nothing floats.
- Finish: clean and commercial. No dimension lines, no prices, no captions, no watermark, no software interface.
</simulation>
The generateStandImage tool already applies this camera, light, and hall. Describe the stand itself: the pieces, their materials and colors, the graphics, and whatever a build rule forces into the picture.
</user-context>

<background-data>
Pieces already in this job. When this list is not empty, the picture is of these pieces, not a different stand.
<job>
${jobLines(document)}
</job>
</background-data>

${rulesSection()}

<the-ask>
Call generateStandImage once with a description of the finished stand.
Apply every rule in <rules> inside the picture. If a panel carries a hook or a screen, the metal that carries it is visible. Glass sits in a frame or on clips. A light is a fitting, not a glow with nothing holding it. A tall freestanding unit is deep enough to stand, or it has a brace. Do not draw screws as little boxes.
If the user attached a reference, match its layout, colors, and graphics, and still obey the rules and the simulation look.
If nothing is drawn yet, build the stand from what the user asked for. When they gave no size, use a common inline stand about 3000 × 3000 × 2500 mm and say that size in the reply.
If the user selected an area of the current simulation, or uploaded artwork to place on it, this is an edit of that same picture, not a new stand. Call generateStandImage once. Describe only the change inside the selection, and say that nothing outside it may change. When they uploaded a picture, say to print that artwork in the selection. The studio already sends the current picture and the uploads to the image model.
If they ask to change a picture you already made without a selection, call the tool again with the full stand, including the change.
</the-ask>

<thinking-instructions>
Think before the tool call. Walk the stand piece by piece: role, material, size, then what the rules force into the picture. Do not put that thinking in the reply the user reads.
</thinking-instructions>

<output-formatting>
Do the work with the tool. The reply the user reads is plain text: what the picture shows, and the overall size when you had to assume one. If the tool returns an error, say what failed in one sentence.
</output-formatting>`;
}
