import { unionBounds } from "./modular/geometry";
import { addParts, placementFor, uniqueId } from "./modular/ops";
import { createEmptyDesign, createInlineBooth } from "./modular/patch";
import type { DesignDocument, PartDraft } from "./modular/schema";

/**
 * A template is a function from a few named sizes to a stand. Builders are plain
 * code, so templates are versioned with the app and can be stored later as data
 * without changing how the editor or the AI uses them.
 */

export type TemplateParam = {
  key: string;
  label: string;
  unit: "mm" | "count" | "";
  min: number;
  max: number;
  step: number;
  value: number;
  /** Rendered as an on/off switch. The value is 0 or 1. */
  toggle?: boolean;
};

export type TemplateCategory = "Booths" | "Furniture" | "Display" | "Signage" | "Stands";

type Built = { kind: "scene"; document: DesignDocument } | { kind: "parts"; parts: PartDraft[] };

export type Template = {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  /** Scene templates replace the whole canvas. Piece templates can also be added to it. */
  kind: "scene" | "parts";
  params: TemplateParam[];
  build: (values: Record<string, number>) => Built;
};

export type TemplateValues = Record<string, number>;

const PANEL = 18;
const WHITE = "#f4f1ea";
const INK = "#1c1b18";
const ACCENT = "#5b5bf0";
const NAVY = "#2f4d6f";
const GREY = "#c5bfb4";

function number(key: string, label: string, value: number, min: number, max: number, step: number, unit: TemplateParam["unit"] = "mm"): TemplateParam {
  return { key, label, unit, min, max, step, value };
}

function toggle(key: string, label: string, value: 0 | 1): TemplateParam {
  return { key, label, unit: "", min: 0, max: 1, step: 1, value, toggle: true };
}

function box(name: string, x: number, y: number, z: number, width: number, height: number, depth: number, extra: Partial<PartDraft> = {}): PartDraft {
  return { name, shape: "box", x, y, z, width, height, depth, material: "mdf", color: WHITE, ...extra };
}

function shifted(parts: PartDraft[], dx: number, dy: number, dz: number): PartDraft[] {
  return parts.map((part) => ({ ...part, x: part.x + dx, y: part.y + dy, z: part.z + dz }));
}

function counterParts(v: TemplateValues): PartDraft[] {
  const { width, depth, height, plinth } = v;
  const t = PANEL;
  const bodyTop = height - 30;
  const body = bodyTop - plinth;
  return [
    box("Plinth", 30, 0, 30, width - 60, plinth, depth - 60, { material: "paint", color: INK }),
    box("Left side", 0, plinth, 0, t, body, depth),
    box("Right side", width - t, plinth, 0, t, body, depth),
    box("Back panel", t, plinth, 0, width - 2 * t, body, t),
    box("Front panel", t, plinth, depth - t, width - 2 * t, body, t, { material: "paint", color: NAVY, label: "Graphic" }),
    box("Top", 0, bodyTop, 0, width, 30, depth, { material: "laminate" }),
  ];
}

function shelvingParts(v: TemplateValues): PartDraft[] {
  const { width, height, depth } = v;
  const shelves = Math.round(v.shelves);
  const t = PANEL;
  const back = 6;
  const inner = width - 2 * t;
  const space = (height - 2 * t - shelves * t) / (shelves + 1);
  const parts: PartDraft[] = [
    box("Left side", 0, 0, 0, t, height, depth),
    box("Right side", width - t, 0, 0, t, height, depth),
    box("Back panel", t, t, 0, inner, height - 2 * t, back, { color: GREY }),
    box("Bottom shelf", t, 0, back, inner, t, depth - back),
    box("Top shelf", t, height - t, back, inner, t, depth - back),
  ];
  for (let index = 1; index <= shelves; index += 1) {
    parts.push(box(`Shelf ${index}`, t, t + index * space + (index - 1) * t, back, inner, t, depth - back));
  }
  return parts;
}

function tableParts(v: TemplateValues): PartDraft[] {
  const { diameter, height } = v;
  const leg = 60;
  const base = Math.max(300, Math.round(diameter * 0.35));
  return [
    {
      name: "Table top",
      shape: "cylinder",
      x: 0,
      y: height - 30,
      z: 0,
      width: diameter,
      height: 30,
      depth: diameter,
      material: "laminate",
      color: WHITE,
    },
    {
      name: "Table leg",
      shape: "cylinder",
      x: (diameter - leg) / 2,
      y: 20,
      z: (diameter - leg) / 2,
      width: leg,
      height: height - 50,
      depth: leg,
      material: "metal",
      color: GREY,
    },
    {
      name: "Table base",
      shape: "cylinder",
      x: (diameter - base) / 2,
      y: 0,
      z: (diameter - base) / 2,
      width: base,
      height: 20,
      depth: base,
      material: "metal",
      color: GREY,
    },
  ];
}

function plinthParts(v: TemplateValues): PartDraft[] {
  const round = v.round >= 1;
  return [
    round
      ? { name: "Plinth", shape: "cylinder", x: 0, y: 0, z: 0, width: v.width, height: v.height, depth: v.width, material: "laminate", color: WHITE }
      : box("Plinth", 0, 0, 0, v.width, v.height, v.depth, { material: "laminate" }),
  ];
}

function headerParts(v: TemplateValues): PartDraft[] {
  return [box("Header sign", 0, v.hang, 0, v.width, v.height, v.thickness, { material: "paint", color: INK, label: "Logo" })];
}

function platformParts(v: TemplateValues): PartDraft[] {
  return [box("Platform", 0, 0, 0, v.width, v.height, v.depth, { material: "laminate", color: "#c3c8da" })];
}

function totemParts(v: TemplateValues): PartDraft[] {
  const { width, depth, height } = v;
  return [
    box("Totem base", 0, 0, 0, width, 100, depth, { material: "paint", color: INK }),
    box("Totem body", 50, 100, 50, width - 100, height - 140, depth - 100, { material: "paint", color: ACCENT, label: "Graphic" }),
    box("Totem cap", 0, height - 40, 0, width, 40, depth, { material: "paint", color: INK }),
  ];
}

function shopStandParts(v: TemplateValues): PartDraft[] {
  const { width, depth, height } = v;
  const deck = 100;
  const header = 300;
  const parts: PartDraft[] = [
    box("Platform", 0, 0, 0, width, deck, depth, { material: "laminate", color: "#c3c8da" }),
    box("Back wall", 0, deck, 0, width, height - deck - header, 40, { material: "paint", color: WHITE, label: "Graphic" }),
    box("Header sign", 0, height - header, 0, width, header, 60, { material: "paint", color: INK, label: "Logo" }),
  ];
  if (v.counter >= 1) {
    const counter = counterParts({ width: 1200, depth: 500, height: 1000, plinth: 60 });
    parts.push(...shifted(counter, (width - 1200) / 2, deck, depth - 500 - 200));
  }
  if (v.shelving >= 1) {
    const unit = shelvingParts({ width: 900, height: Math.min(1800, height - deck - header - 100), depth: 300, shelves: 3 });
    parts.push(...shifted(unit, 200, deck, 40));
    parts.push(...shifted(unit, width - 200 - 900, deck, 40));
  }
  return parts;
}

function boothDocument(v: TemplateValues, corner: boolean): DesignDocument {
  const document = createInlineBooth({ width: v.width, depth: v.depth, height: v.height });
  const walls = document.walls.map((wall) =>
    corner && wall.edge === "right" ? { ...wall, bays: wall.bays.map((bay) => ({ span: bay.span, kind: "open" as const })) } : wall,
  );
  const back = walls.find((wall) => wall.edge === "back");
  const middle = Math.floor((back?.bays.length ?? 1) / 2);
  const features: DesignDocument["features"] = [...document.features];
  if (v.fascia >= 1) features.push({ id: "fascia-back", type: "fascia", edge: "back", height: 400 });
  if (v.counter >= 1) {
    features.push({ id: "counter-back", type: "counter", edge: "back", bayIndex: middle, width: 960, depth: 600, height: 1100 });
  }
  if (v.spots >= 1) features.push({ id: "spots-back", type: "spotlight", edge: "back", bayIndex: middle, count: 2 });
  return { ...document, walls, features };
}

export const TEMPLATES: Template[] = [
  {
    id: "inline-booth",
    name: "Inline booth",
    description: "Modular frame open on the front. Graphic back wall, solid sides.",
    category: "Booths",
    kind: "scene",
    params: [
      number("width", "Width", 3000, 2000, 9000, 1000),
      number("depth", "Depth", 3000, 2000, 6000, 1000),
      number("height", "Height", 3000, 2400, 3400, 100),
      toggle("fascia", "Fascia on back", 0),
      toggle("counter", "Reception counter", 1),
      toggle("spots", "Spotlights", 0),
    ],
    build: (v) => ({ kind: "scene", document: boothDocument(v, false) }),
  },
  {
    id: "corner-booth",
    name: "Corner booth",
    description: "Modular frame open on the front and one side.",
    category: "Booths",
    kind: "scene",
    params: [
      number("width", "Width", 3000, 2000, 9000, 1000),
      number("depth", "Depth", 3000, 2000, 6000, 1000),
      number("height", "Height", 3000, 2400, 3400, 100),
      toggle("fascia", "Fascia on back", 0),
      toggle("counter", "Reception counter", 1),
      toggle("spots", "Spotlights", 0),
    ],
    build: (v) => ({ kind: "scene", document: boothDocument(v, true) }),
  },
  {
    id: "shop-stand",
    name: "Shop stand",
    description: "Raised platform, back wall with header, counter, and two shelving units. Made of separate pieces.",
    category: "Stands",
    kind: "parts",
    params: [
      number("width", "Width", 4000, 3000, 8000, 500),
      number("depth", "Depth", 3000, 2000, 6000, 500),
      number("height", "Height", 2800, 2400, 4000, 100),
      toggle("counter", "Reception counter", 1),
      toggle("shelving", "Shelving units", 1),
    ],
    build: (v) => ({ kind: "parts", parts: shopStandParts(v) }),
  },
  {
    id: "reception-counter",
    name: "Reception counter",
    description: "Panelled counter with plinth, graphic front, and laminate top.",
    category: "Furniture",
    kind: "parts",
    params: [
      number("width", "Width", 1500, 600, 4000, 50),
      number("depth", "Depth", 600, 400, 1200, 10),
      number("height", "Height", 1050, 700, 1200, 10),
      number("plinth", "Plinth height", 80, 0, 200, 10),
    ],
    build: (v) => ({ kind: "parts", parts: counterParts(v) }),
  },
  {
    id: "shelving-unit",
    name: "Shelving unit",
    description: "Open shelving with sides, back, and evenly spaced shelves.",
    category: "Display",
    kind: "parts",
    params: [
      number("width", "Width", 900, 400, 2000, 50),
      number("height", "Height", 1800, 600, 2800, 50),
      number("depth", "Depth", 350, 200, 800, 10),
      number("shelves", "Middle shelves", 3, 0, 10, 1, "count"),
    ],
    build: (v) => ({ kind: "parts", parts: shelvingParts(v) }),
  },
  {
    id: "display-plinth",
    name: "Display plinth",
    description: "Single plinth for a product. Square or round.",
    category: "Display",
    kind: "parts",
    params: [
      number("width", "Width", 600, 200, 1500, 10),
      number("depth", "Depth", 600, 200, 1500, 10),
      number("height", "Height", 450, 100, 1200, 10),
      toggle("round", "Round", 0),
    ],
    build: (v) => ({ kind: "parts", parts: plinthParts(v) }),
  },
  {
    id: "round-table",
    name: "Round table",
    description: "Round top on a single leg and base.",
    category: "Furniture",
    kind: "parts",
    params: [number("diameter", "Diameter", 1200, 600, 2000, 50), number("height", "Height", 750, 400, 1100, 10)],
    build: (v) => ({ kind: "parts", parts: tableParts(v) }),
  },
  {
    id: "header-sign",
    name: "Header sign",
    description: "Flat sign panel hung at a set height.",
    category: "Signage",
    kind: "parts",
    params: [
      number("width", "Width", 3000, 500, 9000, 100),
      number("height", "Height", 400, 150, 1200, 50),
      number("thickness", "Thickness", 50, 18, 200, 2),
      number("hang", "Height from floor", 2400, 1000, 5000, 50),
    ],
    build: (v) => ({ kind: "parts", parts: headerParts(v) }),
  },
  {
    id: "totem",
    name: "Totem",
    description: "Free-standing sign tower with base and cap.",
    category: "Signage",
    kind: "parts",
    params: [
      number("width", "Width", 600, 300, 1500, 50),
      number("depth", "Depth", 400, 200, 1000, 50),
      number("height", "Height", 2400, 1200, 4000, 100),
    ],
    build: (v) => ({ kind: "parts", parts: totemParts(v) }),
  },
  {
    id: "platform",
    name: "Platform",
    description: "Raised floor deck.",
    category: "Stands",
    kind: "parts",
    params: [
      number("width", "Width", 3000, 1000, 9000, 100),
      number("depth", "Depth", 2000, 1000, 6000, 100),
      number("height", "Height", 100, 20, 500, 10),
    ],
    build: (v) => ({ kind: "parts", parts: platformParts(v) }),
  },
];

export function getTemplate(id: string) {
  return TEMPLATES.find((template) => template.id === id) ?? null;
}

export function defaultValues(template: Template): TemplateValues {
  return Object.fromEntries(template.params.map((param) => [param.key, param.value]));
}

/** Clamp and snap whatever was typed, or sent by the AI, to each parameter's range. */
export function resolveValues(template: Template, input: Record<string, number> = {}): TemplateValues {
  return Object.fromEntries(
    template.params.map((param) => {
      const raw = input[param.key];
      if (typeof raw !== "number" || !Number.isFinite(raw)) return [param.key, param.value];
      const stepped = Math.round((raw - param.min) / param.step) * param.step + param.min;
      const clamped = Math.min(param.max, Math.max(param.min, stepped));
      return [param.key, Math.round(clamped * 1000) / 1000];
    }),
  );
}

export type TemplateMode = "replace" | "add";

export type TemplateResult = { document: DesignDocument; ids: string[] };

/**
 * Put a template on the canvas. A scene template, or "replace", starts a fresh canvas.
 * "add" places a group of pieces next to what is already there.
 */
export function applyTemplate(
  document: DesignDocument,
  template: Template,
  input: Record<string, number> = {},
  mode: TemplateMode = "replace",
): TemplateResult {
  const built = template.build(resolveValues(template, input));
  if (built.kind === "scene") return { document: built.document, ids: [] };

  const base = mode === "add" ? document : createEmptyDesign();
  const bounds = unionBounds(built.parts);
  const place = bounds ? placementFor(base, bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) : { x: 0, z: 0 };
  const parts = shifted(built.parts, place.x, 0, place.z);
  if (parts.length < 2) return addParts(base, parts);
  const taken = new Set(Object.keys(base.groups ?? {}));
  return addParts(base, parts, { id: uniqueId(taken, template.id), name: template.name });
}

/** A short description of every template for the AI prompt. */
export function templateCatalog() {
  return TEMPLATES.map((template) => ({
    id: template.id,
    name: template.name,
    kind: template.kind,
    params: template.params.map((param) => ({
      key: param.key,
      label: param.label,
      min: param.min,
      max: param.max,
      step: param.step,
      default: param.value,
    })),
  }));
}
