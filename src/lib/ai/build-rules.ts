/**
 * Rules shared by pricing, drawing, and image generation.
 *
 * Add the next rule in BUILD_RULES. One sentence. Put it at the bottom of the list.
 */

export const BUILD_RULES: string[] = [
  "A hook, bracket, or other load hung on a panel is carried on metal. Wood, MDF, or laminate alone is not enough.",
  "A light, lightbox, or spotlight needs a power supply or driver, a cable, and a power point, named with that light.",
  "A shelf that cannot carry its span on its own gets a strip or bearer. The fixings for that strip are named on the shelf.",
  "A freestanding unit much taller than it is deep is unstable. Say so, and correct the depth or add a brace before treating it as finished.",
  "Glass is held in a frame or with glass clips. It is not screwed through the edge like board.",
  "A screen, TV, or monitor is equipment, not board. It needs the screen, a mount, a cable, and something to play from.",
  "A joint made with screws, cams, or brackets gets those fixings named and counted on the pieces they join.",
  "Read the front, the side, and the plan together. Shelves that cross a center spine in the front view run out to both sides of that spine. The side view gives the depth only.",
  "A lip or second line drawn on a shelf edge is a strip. Draw it as its own thin piece on that edge, unless it is a channel for paper price tickets: that is a data strip, bought by the meter, not a cut piece. Do not drop a strip that is on the sheet, and do not add one that is not.",
  "Painted, lacquered, or sprayed MDF is material paint, priced from the painted board. Plain MDF, with no paint, is material mdf.",
  "A handwritten note of width × depth × a count, such as 46.5 × 48.8 × 5, is that many pieces at those exact sizes; copy the numbers as written and do not round them.",
];

/** The <rules> block. Standing rules first, then whatever you added in BUILD_RULES. */
export function rulesSection(): string {
  const added = BUILD_RULES.map((rule) => `- ${rule}`).join("\n");
  return `<rules>
- Read the stand element by element. For each one: what it is, what it is made of, whether that material and size can do the job, and what else must exist because of it.
- A built piece has a size and a material.
- A fixing, such as screws, is named and counted on the piece it belongs to. It is not drawn as a box.
- Labor and transport are not elements.
- If an element is wrong, name the piece, what is wrong, and what it should be. Do not price a replacement until the element is corrected.
${added}
</rules>`;
}
