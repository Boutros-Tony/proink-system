import { z } from "zod";

export const edgeIdSchema = z.enum(["back", "left", "right", "front"]);
export type EdgeId = z.infer<typeof edgeIdSchema>;

export const EDGES: EdgeId[] = ["back", "left", "right", "front"];

export const baySchema = z.object({
  span: z.number().int().positive(),
  kind: z.enum(["graphic", "solid", "open", "door"]),
  finishId: z.string().min(1).optional(),
  graphicAssetId: z.string().min(1).optional(),
});
export type Bay = z.infer<typeof baySchema>;

export const wallSchema = z.object({
  edge: edgeIdSchema,
  bays: z.array(baySchema),
});
export type Wall = z.infer<typeof wallSchema>;

export const featureSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("counter"),
    edge: edgeIdSchema,
    bayIndex: z.number().int().nonnegative(),
    width: z.number().positive(),
    depth: z.number().positive(),
    height: z.number().positive(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("fascia"),
    edge: edgeIdSchema,
    height: z.number().positive(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("lightbox"),
    edge: edgeIdSchema,
    bayIndex: z.number().int().nonnegative(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("spotlight"),
    edge: edgeIdSchema,
    bayIndex: z.number().int().nonnegative(),
    count: z.number().int().positive(),
  }),
  z.object({
    id: z.string().min(1),
    type: z.literal("floor"),
    materialId: z.string().min(1),
  }),
]);
export type BoothFeature = z.infer<typeof featureSchema>;

export const partMaterialSchema = z.enum(["paint", "mdf", "wood", "laminate", "metal", "glass"]);
export type PartMaterial = z.infer<typeof partMaterialSchema>;

/**
 * A board or sheet the shop buys. Defined here so a job can keep its own estimated materials
 * on the design document without an import cycle through the price book.
 */
export const pricedMaterialSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  /** Pieces drawn in this material are priced from this entry. Null keeps the entry on file without using it. */
  piece: partMaterialSchema.nullable(),
  /** `board`: bought by the sheet, counted in whole boards. `m2`: bought by the square meter. */
  unit: z.enum(["board", "m2"]),
  /** Price of one board, or of one square meter, in cents. */
  priceCents: z.number().int().min(0).max(100_000_000),
  boardWidthMm: z.number().positive().max(20_000).optional(),
  boardHeightMm: z.number().positive().max(20_000).optional(),
  thicknessMm: z.number().positive().max(500).optional(),
  /** Extra material to buy for cutting offcuts, as a percentage of what the pieces need. */
  wastePercent: z.number().min(0).max(100),
  /** How the shop cuts this sheet: saw, laser, or CNC router. Left out, acrylic and thin metal are laser cut. */
  cutter: z.enum(["saw", "laser", "cnc"]).optional(),
  /** The face has a grain or decor direction, so pieces only turn half a turn on the sheet. */
  grain: z.boolean().optional(),
  /** Kept clear around the sheet: chipped factory edges, clamps, the cutter's lead-in. */
  edgeMarginMm: z.number().min(0).max(100).optional(),
  /** The price was estimated for this job. It is not the shop's price list. */
  estimated: z.boolean().optional(),
});
export type PricedMaterial = z.infer<typeof pricedMaterialSchema>;

/** Millimeters. Rounded corners of a box's front face, the face toward the viewer before rotation. */
export const cornerRadiiSchema = z.object({
  topLeft: z.number().min(0).max(10_000).optional(),
  topRight: z.number().min(0).max(10_000).optional(),
  bottomLeft: z.number().min(0).max(10_000).optional(),
  bottomRight: z.number().min(0).max(10_000).optional(),
});
export type CornerRadii = z.infer<typeof cornerRadiiSchema>;

/**
 * A straight cut across one corner of a box's front face, in millimeters.
 * `x` runs along the top or bottom. `y` runs along the side. The corner is the
 * straight line between those two points, so a cut across the whole width is a sloping edge.
 */
export const cornerCutSchema = z.object({
  x: z.number().min(0).max(20_000).optional(),
  y: z.number().min(0).max(20_000).optional(),
});
export const chamferSchema = z.object({
  topLeft: cornerCutSchema.optional(),
  topRight: cornerCutSchema.optional(),
  bottomLeft: cornerCutSchema.optional(),
  bottomRight: cornerCutSchema.optional(),
});
export type Chamfers = z.infer<typeof chamferSchema>;

/**
 * An opening cut right through a box, drawn on its front face, in millimeters.
 * `x` and `y` place the opening's bottom-left corner from the box's bottom-left corner.
 * An opening at `y` 0 is open at the bottom, like an arch or a doorway.
 */
export const holeSchema = z.object({
  x: z.number().min(0).max(20_000),
  y: z.number().min(0).max(20_000),
  width: z.number().positive().max(20_000),
  height: z.number().positive().max(20_000),
  corners: cornerRadiiSchema.optional(),
});
export type Hole = z.infer<typeof holeSchema>;

/**
 * Any shape cut on the shaped face: its points in order, in millimeters from the face's bottom-left corner,
 * x across and y up. A side panel with a sloping front and a toe step is one outline, and so is a cloud.
 * A third number bends the edge from that point to the next into a circular arc, the DXF bulge: 0 straight,
 * 1 a half circle, 0.414 a quarter circle, above 1 more than a half circle. Positive bulges outward on a
 * counterclockwise outline, negative cuts in. It replaces the face's rounded corners and straight cuts;
 * openings are still cut through it.
 */
// Gemini rejects tuple schemas, so each point is checked as an array of two or three numbers and typed as a tuple.
export const outlineSchema = z
  .array(z.array(z.number().min(-50_000).max(50_000)).min(2).max(3))
  .min(3)
  .max(48) as unknown as z.ZodArray<z.ZodUnion<[z.ZodTuple<[z.ZodNumber, z.ZodNumber], null>, z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber], null>]>>;
export type OutlinePoint = [number, number] | [number, number, number];
export type Outline = OutlinePoint[];

/** Points with arc edges, as on an outline, that need not close: a tube's path or a turned piece's profile. */
export const pathSchema = z
  .array(z.array(z.number().min(-50_000).max(50_000)).min(2).max(3))
  .min(2)
  .max(48) as unknown as typeof outlineSchema;

/**
 * A round piece that is not a plain solid cylinder. Only a cylinder uses this. Width is the diameter at the
 * bottom and height the height, as for any cylinder.
 */
export const roundSchema = z.object({
  /** Diameter at the top, mm, up to the width: a cone at 0, a tapered podium in between. For wider at the top, use a profile. */
  top: z.number().min(0).max(20_000).optional(),
  /** Wall thickness, mm: a hollow tube, pipe, or ring with open ends. Left out, the piece is solid. */
  wall: z.number().positive().max(10_000).optional(),
  /** Degrees of the circle that is built, 10 to 360. 180 is a half cylinder with its flat side toward the back. */
  sweep: z.number().min(10).max(360).optional(),
  /**
   * A turned piece, as on a lathe: its outside seen from the side, [radius, height] in mm from the axis at the
   * bottom, bottom to top, with arc bulges as on an outline. A dome is [[600,0,0.414],[0,600]], a ball 600 across
   * is [[0,0,1],[0,600]], a vase or a column with a capital is any run of points. Wins over top.
   */
  profile: pathSchema.optional(),
});
export type Round = z.infer<typeof roundSchema>;

/**
 * The face of a box that carries its rounded corners, cuts, and openings. `front` faces the viewer
 * (width × height). `top` is seen from above (width × depth), its bottom edge toward the viewer.
 * `side` is seen from the right (depth × height), its left edge toward the viewer.
 */
export const SHAPED_FACES = ["front", "side", "top"] as const;

export const PART_SHAPES = ["box", "cylinder", "mesh", "letters", "tube"] as const;
export type PartShape = (typeof PART_SHAPES)[number];
export type ShapedFace = (typeof SHAPED_FACES)[number];

export const CORNER_NAMES = ["topLeft", "topRight", "bottomLeft", "bottomRight"] as const;

/**
 * A kerf-bent board. The box is the space the curved board takes up, and the flat board it is cut from is
 * worked out from the curve. The curve is seen from above (`axis` height, the default: a curved counter front
 * or wall) or from the front (`axis` depth: an arched header, the rounded corner of a frame).
 * Without `corner` it is a bow across the width: it bulges by the box's depth (seen from above) or height (seen
 * from the front). With `corner` it is a quarter circle filling its box, its outside at that corner, as a
 * frame's rounded corner is. Seen from above, top is the back and bottom is toward the viewer.
 */
export const curveSchema = z.object({
  /** Board thickness, in mm. */
  thickness: z.number().positive().max(100),
  axis: z.enum(["height", "depth"]).optional(),
  /** Which way a bow bulges: front or back seen from above, up or down seen from the front. */
  toward: z.enum(["front", "back", "up", "down"]).optional(),
  corner: z.enum(CORNER_NAMES).optional(),
});
export type Curve = z.infer<typeof curveSchema>;

export const IMAGE_FACES = ["front", "back", "left", "right", "top"] as const;
export type ImageFace = (typeof IMAGE_FACES)[number];

/**
 * A picture or logo printed on one face of a piece. The file itself lives in the local
 * asset library, so the design stays small and can be sent to the AI.
 */
export const partImageSchema = z.object({
  assetId: z.string().min(1),
  /** Which face carries the picture. A cylinder wraps it around the side. Defaults to front. */
  face: z.enum(IMAGE_FACES).optional(),
  /** `contain` keeps the whole picture visible (logos). `cover` fills the face and crops the edges (photos). Defaults to contain. */
  fit: z.enum(["contain", "cover"]).optional(),
  /** Size of a `contain` picture relative to the largest size that fits the face. 1 is full size. */
  scale: z.number().min(0.05).max(1).optional(),
  /** Shift a `contain` picture across the face, as a fraction of the face width (-0.5 to 0.5). */
  x: z.number().min(-0.5).max(0.5).optional(),
  /** Shift a `contain` picture up the face, as a fraction of the face height (-0.5 to 0.5). */
  y: z.number().min(-0.5).max(0.5).optional(),
});
export type PartImage = z.infer<typeof partImageSchema>;

export const partSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  shape: z.enum(PART_SHAPES),
  /** Geometry kept in the browser mesh library. Present when `shape` is `mesh`. */
  meshId: z.string().min(1).optional(),
  /** File this piece was imported from, such as `counter.glb`. */
  sourceFile: z.string().min(1).optional(),
  /** Material name from the 3D file, kept even when it does not match a shop material. */
  sourceMaterial: z.string().min(1).optional(),
  x: z.number(),
  y: z.number(),
  z: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  depth: z.number().positive(),
  material: partMaterialSchema.optional(),
  /** The Materials entry this piece is cut from, such as an acrylic or foam sheet. Without it, `material` picks the entry. */
  materialId: z.string().min(1).max(60).optional(),
  color: z.string().min(1).optional(),
  /** The characters of a cut-letter piece (`shape` letters), such as `S I C`. Also a note on any other piece. */
  label: z.string().min(1).optional(),
  /** Degrees about the vertical axis, around the part's center. Matches three.js rotation.y. */
  rotation: z.number().optional(),
  /**
   * Degrees about the piece's own front-to-back axis, around its center, before `rotation`: a board sloping
   * along a roof pitch. Positive is counterclockwise seen from the front. Matches three.js rotation.z, order YXZ.
   */
  tilt: z.number().optional(),
  /** Rounded corners of the front face. Only a box uses this. */
  corners: cornerRadiiSchema.optional(),
  /** Straight cuts across the front corners. Only a box uses this. A cut wins over a radius on the same corner. */
  chamfers: chamferSchema.optional(),
  /** Openings cut through the front face, such as the inside of a ring or an arch. Only a box uses this. */
  holes: z.array(holeSchema).max(8).optional(),
  /** A free shape for the shaped face. Only a box uses this, and it wins over corners and chamfers. */
  outline: outlineSchema.optional(),
  /** Which face the corners, cuts, and openings are on. Defaults to front. */
  face: z.enum(SHAPED_FACES).optional(),
  /** A bent panel. Only a box uses this, and a bent panel has no corners, cuts, or openings. */
  curve: curveSchema.optional(),
  /** A cone, hollow, part-circle, or turned cylinder. Only a cylinder uses this. */
  round: roundSchema.optional(),
  /**
   * The center line of a tube (`shape` tube) on its face, in mm from the face's bottom-left, with arc bulges as
   * on an outline. The tube's diameter is the face's thickness. LED neon, a pipe, a rail, or a ring.
   */
  path: pathSchema.optional(),
  /** The tube's path closes back to its first point: a ring or a neon border all the way round. */
  closed: z.boolean().optional(),
  /** Pieces that share a group id move, rotate, and duplicate together. */
  group: z.string().min(1).optional(),
  /** A locked piece cannot be moved, resized, or deleted until it is unlocked. */
  locked: z.boolean().optional(),
  /** Hidden pieces are not drawn in the 3D view. They stay in the document and in production files. */
  hidden: z.boolean().optional(),
  /** `equipment` and `rental` are bought in. They are not cut from board. */
  kind: z.enum(["built", "letters", "equipment", "rental"]).optional(),
  /** Pictures and logos on the faces of this piece. */
  images: z.array(partImageSchema).max(6).optional(),
});
export type ScenePart = z.infer<typeof partSchema>;

export const partDraftSchema = partSchema.extend({ id: z.string().min(1).optional() });
export type PartDraft = z.infer<typeof partDraftSchema>;

export const partChangesSchema = z
  .object({
    name: z.string().min(1),
    shape: z.enum(PART_SHAPES),
    x: z.number(),
    y: z.number(),
    z: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
    depth: z.number().positive(),
    material: partMaterialSchema,
    /** Null goes back to the entry for `material`. Changing `material` alone also goes back. */
    materialId: z.string().min(1).max(60).nullable(),
    color: z.string().min(1),
    label: z.string().min(1),
    rotation: z.number(),
    tilt: z.number(),
    corners: cornerRadiiSchema,
    chamfers: chamferSchema,
    holes: z.array(holeSchema).max(8),
    /** Null goes back to a plain rectangle. */
    outline: outlineSchema.nullable(),
    face: z.enum(SHAPED_FACES),
    /** Null makes the panel flat again. */
    curve: curveSchema.nullable(),
    /** Null makes a plain solid cylinder again. */
    round: roundSchema.nullable(),
    path: pathSchema,
    closed: z.boolean(),
    images: z.array(partImageSchema).max(6),
  })
  .partial();
export type PartChanges = z.infer<typeof partChangesSchema>;

/** One problem from the production check. The same problem keeps the same id. */
export const findingSchema = z.object({
  id: z.string().min(1).max(40),
  severity: z.enum(["serious", "check"]),
  source: z.enum(["build", "design"]),
  pieces: z.array(z.string().min(1).max(120)).max(40),
  problem: z.string().min(1).max(600),
  fix: z.string().max(600),
  /** The user let this finding through. A later check keeps that choice when the problem returns. */
  accepted: z.boolean().optional(),
});
export type Finding = z.infer<typeof findingSchema>;

/** The workshop foreman's last look at this stand, and the stand it looked at. */
export const productionReviewSchema = z.object({
  key: z.string().min(1).max(64),
  /** ISO time. */
  at: z.string().min(1).max(40),
  summary: z.string().max(600),
  findings: z.array(findingSchema).max(12),
  questions: z.array(z.string().max(400)).max(8),
});
export type ProductionReview = z.infer<typeof productionReviewSchema>;

export const envelopeSchema = z.object({
  width: z.number().positive(),
  depth: z.number().positive(),
  height: z.number().positive(),
});
export type Envelope = z.infer<typeof envelopeSchema>;

export const designDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    system: z.literal("modular_exhibition"),
    units: z.literal("mm"),
    envelope: envelopeSchema,
    module: z.number().int().positive(),
    walls: z.array(wallSchema).length(4),
    features: z.array(featureSchema),
    parts: z.array(partSchema).default([]),
    /** Group id to display name. */
    groups: z.record(z.string(), z.string()).optional(),
    /** The priced pieces have been put together into the stand. New pieces clear it. */
    assembled: z.boolean().optional(),
    /** Boards estimated for this job only, when the price list has no sheet that fits. */
    jobMaterials: z.array(pricedMaterialSchema).max(20).optional(),
    /** The last production check. Absent on jobs saved before the check existed. */
    review: productionReviewSchema.optional(),
  })
  .superRefine((document, ctx) => {
    for (const edge of EDGES) {
      const count = document.walls.filter((wall) => wall.edge === edge).length;
      if (count !== 1) {
        ctx.addIssue({
          code: "custom",
          path: ["walls"],
          message: `Wall "${edge}" must appear once.`,
        });
      }
    }
  });

export type DesignDocument = z.infer<typeof designDocumentSchema>;

export const designPatchSchema = z.object({
  envelope: envelopeSchema.partial().optional(),
  module: z.number().int().positive().optional(),
  walls: z.array(wallSchema).length(4).optional(),
  features: z.array(featureSchema).optional(),
  parts: z.array(partSchema).optional(),
  groups: z.record(z.string(), z.string()).optional(),
});
export type DesignPatch = z.infer<typeof designPatchSchema>;

const systemProbeSchema = z.object({
  system: z.enum(["modular_exhibition", "custom_carpentry"]).optional(),
});

export type OpenedDesign =
  | { status: "ready"; document: DesignDocument }
  | { status: "unavailable"; system: "custom_carpentry" }
  | { status: "invalid"; message: string };

export function openDesignDocument(input: unknown): OpenedDesign {
  const probe = systemProbeSchema.safeParse(input);
  if (probe.success && probe.data.system === "custom_carpentry") {
    return { status: "unavailable", system: "custom_carpentry" };
  }
  const parsed = designDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "invalid", message: parsed.error.issues[0]?.message ?? "Invalid design document." };
  }
  return { status: "ready", document: parsed.data };
}
