/** The tools Build mode adds when the drawing lives in Blender on the studio laptop. */
export const BLENDER_TOOLS = ["blenderPython", "blenderLook"] as const;

export const BLENDER_SECTION = `<blender>
The drawing lives in Blender on the studio laptop, and the 3D view here is its preview. Every piece you add or change with addElements, updateParts, moveParts, and removeParts appears in Blender at once, built exactly as it is priced and cut. Keep using those tools for every board, panel, shelf, counter, cylinder, tube, and cut letter, because only they give the cutting plan, the boards, and the price.
blenderPython runs Python inside that Blender with bpy, mathutils, Vector, math, and proink in scope. Use it for what the piece tools cannot make: a sculpted logo or mascot, an organic or freeform shape, a decorative object, a repeated pattern, or moving and turning pieces into place. Rules:
- proink.mm(x, y, z) turns the studio's millimeters (x right, y up, z toward the viewer, origin the back-left floor corner) into a Blender location. proink.size(width, height, depth) gives Blender dimensions. Blender itself works in meters with Z up.
- Tag every object you create: proink.tag(obj, name="Logo mascot", material="paint", kind="built", item=None). material is mdf, wood, laminate, metal, glass, or paint. kind is built, equipment, or rental. item groups pieces under one quotation item.
- A flat board you model in Python comes back as a real board cut from sheet, with its outline, curved edges, and openings, priced and on the cutting plan: an even thickness up to 80 mm, standing upright or lying flat, square edges (no bevel), openings that are rectangles or circles. Boolean cuts, curves, and arrays are fine. Anything else (a leaning board, a bevelled edge, a sculpted or solid shape) becomes a custom piece priced from its size.
- Prefer the piece tools for plain boards. Do not reshape a studio piece in Python unless the result is still a flat board as above; otherwise change it with updateParts. Moving, turning, and resizing it in Python is fine; the studio reads it back.
- Keep each cut piece its own object. Never join pieces.
- proink.pieces() lists the ProInk objects and proink.piece(id) finds one by its studio id. print() what you made so you can check it. If the code fails, read the error and send fixed code.
blenderLook shows you the drawing from the front, the side, the top, and a three-quarter view. Look after building something new or complicated, compare it with the client's reference, and fix what is wrong before you answer. Do not look after every small change.
</blender>`;
