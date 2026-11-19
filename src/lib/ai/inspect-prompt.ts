import type { PriceBook } from "../systems/materials";
import { partBounds } from "../systems/modular/geometry";
import type { DesignDocument, ScenePart } from "../systems/modular/schema";

/**
 * The production check: a second look at the finished job by someone whose only task is to find what will
 * go wrong when it is built, loaded, and used. It is given no list of trade rules on purpose. It gets the
 * facts (pieces, positions, measurements, pictures, what the stand carries) and is expected to know the rest.
 */

export const INSPECT_PROMPT = `You are the workshop foreman at a stand-building shop. A stand has been drawn and priced, and it is about to be cut. You are the last person to look at it. A mistake you find now costs nothing. A mistake found on site has cost this shop real money before: hooks that reached past the front of the stand, a shelf light hidden behind the product, a sign that did not fit where it was drawn. Your only job is to find what will go wrong.

You are given the job brief, every piece with its size and where it sits, measurements the studio took from the drawing, pictures of the assembled stand when it is assembled, and the client's file when there is one. Lines under MEASURED are computed from the drawing: trust them, and use them.

<how-to-look>
Nobody hands you a checklist. You know how stands are built, how product hangs and sits, how light falls, how people shop, and how a stand travels. Use all of it. Go through the stand four times, each time as a different person:
1. The carpenter builds it. Piece by piece: can it be cut from its board, joined to its neighbours, and will it stand and carry its load? Is the material and thickness right for the span and the weight?
2. The merchandiser loads it. Put the product on every shelf and every hook, row by row. Does it fit in height, in depth, and in width? Does the product, or the fitting that carries it, reach past the stand anywhere? A stand is rarely the same at every level: a sloped or stepped side, a header, a light, or the shelf above changes the room at each row, so one hook length, one shelf depth, or one spacing is not automatically right for every row. Check each row on its own numbers.
3. The shopper uses it. Can they see and reach the product, the price, and the sign? Does anything block a light, a sign, a screen, or a door? Is anything sharp, loose, or easy to tip?
4. The crew moves and installs it. Does it go through a door and into a truck, can it be packed, and does power reach what needs it?
Then compare the pieces with the client's file. Where they differ in a count, a size, a shape, or a piece that is missing or extra, that is a finding.
</how-to-look>

<evidence>
- Every finding names the pieces by id and gives the numbers that show it, in mm: "the hooks on rows 1 and 2 are 300 long, the side panel is 220 deep at that height, so they reach 80 past the front".
- Report only what the data shows. When you would need a fact you were not given to judge something that matters (the product's size or weight, how a piece is fixed), put it in "questions" instead of guessing. Do not turn a guess into a finding.
- One finding per problem, listing every piece it affects. Do not repeat it piece by piece.
- Do not comment on prices, labor, or transport cost.
- Do not pad. If the stand is sound, say so and return no findings.
- A point the user already decided in the job brief is settled. When they answered a question about it, such as choosing to keep something as drawn, do not report it again.
- When the pieces are not assembled, their positions mean nothing: judge from sizes, counts, and the file, and do not report where pieces sit.
</evidence>

<findings>
"severity":
- "serious": built as drawn it fails, does not fit, is unsafe, or has to be remade.
- "check": it may be fine, but someone should confirm before cutting.
"source":
- "build": you can point to the client's file or to the user's own words, and the pieces contradict them: a count, a size, a shape, a missing or extra piece, or a piece put in the wrong place. The studio can correct this itself.
- "design": everything else. The pieces are what was asked, or nothing says otherwise, and the stand will still not work as it is. The user has to decide. When there is no file and no words to compare with, it is "design".
"fix": the change you would make, with sizes, such as "use the 15 cm hook on rows 1 and 2 and keep the 25 cm hook on rows 3 to 5". Prefer what the shop stocks, listed under SHOP STOCK.
</findings>

Reply with only one JSON object, no code fences and no other text:
{
  "summary": "one or two plain sentences: is it ready to cut, and what matters most",
  "findings": [ { "severity": "serious" | "check", "source": "build" | "design", "pieces": ["piece id", "..."], "problem": "what is wrong, where, with the numbers", "fix": "what to change, with sizes" } ],
  "questions": [ "a fact you need and were not given, as one short question" ]
}`;

const mm = (value: number) => Math.round(value);

function boardName(part: ScenePart, book: PriceBook) {
  const sheet = part.materialId ? book.materials.find((material) => material.id === part.materialId) : undefined;
  return sheet ? sheet.name : (part.material ?? "no material");
}

function shapeNote(part: ScenePart) {
  const notes: string[] = [];
  if (part.outline) notes.push(`cut to this outline on its ${part.face ?? "front"} face, [x, y] in mm from the face's bottom-left${part.face === "side" ? ", x 0 is the front edge" : ""}, a third number is an arc: ${JSON.stringify(part.outline)}`);
  if (part.chamfers) notes.push(`corner cuts on its ${part.face ?? "front"} face: ${JSON.stringify(part.chamfers)}`);
  if (part.corners) notes.push(`rounded corners on its ${part.face ?? "front"} face: ${JSON.stringify(part.corners)}`);
  if (part.holes?.length) notes.push(`${part.holes.length} ${part.holes.length === 1 ? "opening" : "openings"}: ${JSON.stringify(part.holes)}`);
  if (part.curve) notes.push(`bent board ${mm(part.curve.thickness)} mm thick`);
  if (part.tilt) notes.push(`tilted ${mm(part.tilt)}°`);
  if (part.rotation) notes.push(`turned ${mm(part.rotation)}° about the vertical`);
  if (part.shape === "letters" && part.label) notes.push(`cut letters "${part.label}"`);
  return notes.length ? ` · ${notes.join("; ")}` : "";
}

function pieceLine(part: ScenePart, document: DesignDocument, book: PriceBook, assembled: boolean) {
  const depth = part.shape === "cylinder" ? part.width : part.depth;
  const size = part.shape === "cylinder" ? `Ø ${mm(part.width)} × ${mm(part.height)} high` : `${mm(part.width)} wide × ${mm(part.height)} high × ${mm(depth)} deep`;
  const kind = part.kind && part.kind !== "built" ? ` · ${part.kind === "equipment" ? "bought-in, not cut" : part.kind}` : "";
  const item = part.group ? ` · item ${document.groups?.[part.group] ?? part.group}` : "";
  const box = partBounds(part);
  const where = assembled ? ` · left ${mm(box.minX)} to right ${mm(box.maxX)}, bottom ${mm(box.minY)} to top ${mm(box.maxY)}, back ${mm(box.minZ)} to front ${mm(box.maxZ)}` : "";
  return `- ${part.id} · ${part.name}${kind} · ${part.shape} ${size} · ${boardName(part, book)}${item}${where}${shapeNote(part)}`;
}

const SOURCE = {
  simulation: "The client's file is a simulation or render. It has no scale: sizes were taken from its proportions and from what the user gave.",
  technical: "The client's file is a technical sheet. The sizes written on it are what the client asked for.",
  "3d_file": "The client's file is views of a 3D model, scaled from the overall size the user gave.",
  description: "The job was described in words. There may be no file.",
} as const;

/** The finished job written out for the foreman. `measured` comes from the studio's own geometry, not from a model. */
export function inspectBrief(input: {
  document: DesignDocument;
  book: PriceBook;
  /** What the user wrote and answered in this chat: what the stand is for and what goes on it. */
  brief: string;
  sourceKind?: keyof typeof SOURCE;
  measured: string[];
  /** Pictures of the assembled stand are attached after this text. */
  views: boolean;
  /** The client's file is attached after this text. */
  file: boolean;
}) {
  const { document, book } = input;
  const assembled = document.assembled === true;
  const parts = document.parts.filter((part) => !part.hidden);
  const shown = parts.slice(0, 160);
  const stock = book.items.filter((item) => item.group === "hardware" || item.group === "lighting" || item.group === "electrical").map((item) => `- ${item.name}`);
  const boards = [...new Set(book.materials.map((material) => material.name))];
  const booth = document.walls.some((wall) => wall.bays.length > 0);

  return [
    "JOB BRIEF (the user's own words and answers)",
    input.brief.trim() || "Nothing was said about what the stand carries or where it goes.",
    "",
    SOURCE[input.sourceKind ?? "description"],
    input.file ? "The client's file is attached below." : "No client file is attached.",
    "",
    assembled
      ? "THE STAND IS ASSEMBLED. Millimeters. The origin is the back-left floor corner: left to right is across the front, bottom to top is height, back to front is depth toward the shopper."
      : "THE PIECES ARE NOT ASSEMBLED YET. They are laid out side by side, so positions mean nothing.",
    booth ? `It stands in a modular booth frame ${mm(document.envelope.width)} wide × ${mm(document.envelope.depth)} deep × ${mm(document.envelope.height)} high.` : "",
    "",
    `PIECES (${parts.length})`,
    ...shown.map((part) => pieceLine(part, document, book, assembled)),
    parts.length > shown.length ? `…and ${parts.length - shown.length} more pieces.` : "",
    "",
    "MEASURED (computed by the studio from the drawing)",
    ...(input.measured.length ? input.measured.map((line) => `- ${line}`) : ["- Nothing was measured."]),
    "",
    input.views ? "Pictures of the assembled stand follow: front, side seen from the right, and plan seen from above." : "",
    "",
    "SHOP STOCK (fittings the shop keeps; prefer these in a fix)",
    ...(stock.length ? stock : ["- none listed"]),
    "",
    `Boards and sheets the shop keeps: ${boards.join(", ") || "none listed"}.`,
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");
}
