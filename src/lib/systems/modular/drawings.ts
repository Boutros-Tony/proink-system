import type { CompiledModel } from "./compile";
import { bendProfile, bulgeOf, edgeArc, edgeLength, faceAxes, partBounds, partTilt, pathPoints, resolveFront, type ResolvedCorner } from "./geometry";
import { roundSilhouette } from "./round";
import { EDGES, type CornerRadii, type Curve, type DesignDocument, type EdgeId, type Outline, type OutlinePoint, type ShapedFace } from "./schema";

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function planSvg(document: DesignDocument, model: CompiledModel) {
  const pad = 120;
  const { width, depth } = document.envelope;
  const viewWidth = width + pad * 2;
  const viewHeight = depth + pad * 2;
  const posts = model.posts
    .map((post) => {
      const x = pad + post.x - post.size / 2;
      const y = pad + post.z - post.size / 2;
      return `<rect x="${x}" y="${y}" width="${post.size}" height="${post.size}" fill="#5e666c"/>`;
    })
    .join("");
  const panels = model.panels
    .map((panel) => {
      const horizontal = panel.edge === "back" || panel.edge === "front";
      const x = pad + panel.x - (horizontal ? panel.width / 2 : panel.thickness / 2);
      const y = pad + panel.z - (horizontal ? panel.thickness / 2 : panel.width / 2);
      const w = horizontal ? panel.width : panel.thickness;
      const h = horizontal ? panel.thickness : panel.width;
      const fill = panel.kind === "graphic" ? "#c4a574" : panel.kind === "lightbox" ? "#efe6cf" : "#d9d3c7";
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
    })
    .join("");
  const parts = model.parts
    .map((part) => {
      const x = pad + part.x;
      const y = pad + part.z;
      if (part.shape === "cylinder") {
        const radius = part.width / 2;
        return `<circle cx="${x + radius}" cy="${y + part.depth / 2}" r="${radius}" fill="#efeae2" stroke="#1a1814" stroke-width="3"/>`;
      }
      const turn = part.rotation
        ? ` transform="rotate(${-part.rotation} ${x + part.width / 2} ${y + part.depth / 2})"`
        : "";
      return `<rect x="${x}" y="${y}" width="${part.width}" height="${part.depth}" fill="#efeae2" stroke="#1a1814" stroke-width="3"${turn}/>`;
    })
    .join("");
  const frame =
    model.posts.length || model.panels.length
      ? `<rect x="${pad}" y="${pad}" width="${width}" height="${depth}" fill="none" stroke="#1a1814" stroke-width="4"/>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewWidth} ${viewHeight}" width="${viewWidth}" height="${viewHeight}">
  <rect width="100%" height="100%" fill="#f7f4ee"/>
  ${frame}
  ${panels}
  ${parts}
  ${posts}
  <text x="${pad + width / 2}" y="${pad + depth + 70}" text-anchor="middle" font-family="Helvetica" font-size="42" fill="#1a1814">${width} mm</text>
  <text x="${pad - 70}" y="${pad + depth / 2}" text-anchor="middle" font-family="Helvetica" font-size="42" fill="#1a1814" transform="rotate(-90 ${pad - 70} ${pad + depth / 2})">${depth} mm</text>
</svg>`;
}

export function elevationSvg(document: DesignDocument, edge: EdgeId) {
  const length = edgeLength(edge, document.envelope);
  const height = document.envelope.height;
  const pad = 100;
  const wall = document.walls.find((item) => item.edge === edge);
  let cursor = 0;
  const bays = (wall?.bays ?? [])
    .map((bay, index) => {
      const bayWidth = bay.span * document.module;
      const x = pad + cursor;
      cursor += bayWidth;
      const fill = bay.kind === "graphic" ? "#c4a574" : bay.kind === "solid" ? "#d9d3c7" : "#f7f4ee";
      return `<rect x="${x}" y="${pad}" width="${bayWidth}" height="${height}" fill="${fill}" stroke="#1a1814" stroke-width="3"/>
        <text x="${x + bayWidth / 2}" y="${pad + height / 2}" text-anchor="middle" font-family="Helvetica" font-size="36" fill="#1a1814">${escapeXml(bay.kind)} ${index + 1}</text>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${length + pad * 2} ${height + pad * 2}" width="${length + pad * 2}" height="${height + pad * 2}">
  <rect width="100%" height="100%" fill="#f7f4ee"/>
  ${bays}
  <text x="${pad + length / 2}" y="${pad + height + 64}" text-anchor="middle" font-family="Helvetica" font-size="42" fill="#1a1814">${edge} · ${length} × ${height} mm</text>
</svg>`;
}

/** Front, side, and plan with the overall sizes and the piece list. `bare` is the views alone, for a file with its own title and piece list. */
export function technicalSvg(document: DesignDocument, model: CompiledModel, options: { bare?: boolean } = {}) {
  const withSchedule = !options.bare;
  const { width, depth, height } = document.envelope;
  const parts = document.parts ?? [];
  const drawn = parts.length > 0 || model.posts.length > 0 || model.panels.length > 0;
  if (!drawn) {
    return sheetSvg(900, 520, `<text x="450" y="260" text-anchor="middle" font-family="Helvetica" font-size="28" fill="#1c1b18">Nothing has been drawn yet.</text>`);
  }

  const schedule = pieceSchedule(parts);
  const tableTop = 1380;
  const rowH = 32;
  const paperW = 1680;
  const paperH = withSchedule ? tableTop + 88 + Math.max(schedule.length, 1) * rowH : 1300;
  const front = fitBox({ x: 170, y: 190, w: 680, h: 640 }, width, height);
  const side = fitBox({ x: 1060, y: 190, w: 440, h: 640 }, depth, height);
  const plan = fitBox({ x: 170, y: 940, w: 680, h: 280 }, width, depth);

  const paint = [...parts].sort((a, b) => b.width * b.height - a.width * a.height);
  const frontShapes = paint
    .map((part) => {
      const box = partBounds(part);
      const tilt = partTilt(part);
      // Seen from the front a tilt is a plain turn of the drawing around the piece's center.
      const lean = (svg: string) =>
        tilt ? `<g transform="rotate(${-tilt} ${front.ox + (part.x + part.width / 2) * front.scale} ${front.oy + (height - part.y - part.height / 2) * front.scale})">${svg}</g>` : svg;
      if (part.shape === "cylinder" && part.round) return roundSvg(front, part, part.x, height - part.y - part.height);
      if (part.shape === "tube" && (part.face ?? "front") === "front" && !part.rotation) return lean(tubeSvg(front, part, part.x, height - part.y - part.height));
      if (shapedOn(part, "front") && !part.rotation) return lean(outlineSvg(front, part, part.x, height - part.y - part.height));
      if (part.shape === "box" && part.curve?.axis === "depth" && !part.rotation) return lean(curveSvg(front, part, part.curve, height - part.y - part.height));
      if (tilt && !part.rotation && part.shape !== "letters") return lean(shape(front, part.x, height - part.y - part.height, part.width, part.height, false));
      const drawn = shape(front, box.minX, height - box.maxY, box.maxX - box.minX, box.maxY - box.minY, part.shape === "cylinder");
      if (part.shape !== "letters" || !part.label) return drawn;
      const cx = front.ox + ((box.minX + box.maxX) / 2) * front.scale;
      const cy = front.oy + (height - part.y - part.height / 2) * front.scale + Math.max(6, part.height * front.scale * 0.22);
      const fontSize = Math.max(8, part.height * front.scale * 0.55);
      return `${drawn}<text x="${cx}" y="${cy}" text-anchor="middle" font-family="Helvetica" font-size="${fontSize}" fill="#1c1b18">${escapeXml(part.label)}</text>`;
    })
    .join("");
  const sideShapes = paint
    .map((part) => {
      const box = partBounds(part);
      if (part.shape === "cylinder" && part.round) return roundSvg(side, part, part.z, height - part.y - part.height);
      if (shapedOn(part, "side") && !part.rotation && !partTilt(part)) {
        // Seen from the right the front is on the right, while the side face runs from the front, so it is mirrored.
        const mid = side.ox + (part.z + part.depth / 2) * side.scale;
        return `<g transform="translate(${2 * mid} 0) scale(-1 1)">${outlineSvg(side, part, part.z, height - part.y - part.height)}</g>`;
      }
      return shape(side, box.minZ, height - box.maxY, box.maxZ - box.minZ, box.maxY - box.minY, false);
    })
    .join("");
  const planShapes = paint
    .map((part) => {
      if (part.shape === "cylinder") {
        const cx = plan.ox + (part.x + part.width / 2) * plan.scale;
        const cy = plan.oy + (part.z + part.width / 2) * plan.scale;
        const r = (part.width / 2) * plan.scale;
        const sweep = part.round?.sweep;
        if (sweep && sweep < 360) {
          // Built facing the front, which is down the plan, centered on it.
          const at = (degrees: number) => `${cx + r * Math.sin((degrees * Math.PI) / 180)} ${cy + r * Math.cos((degrees * Math.PI) / 180)}`;
          return `<path d="M ${cx} ${cy} L ${at(sweep / 2)} A ${r} ${r} 0 ${sweep > 180 ? 1 : 0} 0 ${at(-sweep / 2)} Z" fill="#f7f4ee" stroke="#1c1b18" stroke-width="2"/>`;
        }
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#f7f4ee" stroke="#1c1b18" stroke-width="2"/>`;
      }
      if (part.shape === "tube" && part.face === "top" && !part.rotation && !partTilt(part)) return tubeSvg(plan, part, part.x, part.z);
      const cx = plan.ox + (part.x + part.width / 2) * plan.scale;
      const cy = plan.oy + (part.z + part.depth / 2) * plan.scale;
      const turn = part.rotation ? ` transform="rotate(${-part.rotation} ${cx} ${cy})"` : "";
      const tilt = partTilt(part);
      if (tilt) {
        // Seen from above a tilted piece is its width as it leans, then turned.
        const radians = (tilt * Math.PI) / 180;
        const across = Math.abs(part.width * Math.cos(radians)) + Math.abs(part.height * Math.sin(radians));
        return shape(plan, part.x + part.width / 2 - across / 2, part.z, across, part.depth, false).replace("/>", `${turn}/>`);
      }
      if (part.shape === "box" && part.curve && part.curve.axis !== "depth") return `<g${turn}>${curveSvg(plan, part, part.curve, part.z)}</g>`;
      if (shapedOn(part, "top")) return `<g${turn}>${outlineSvg(plan, part, part.x, part.z)}</g>`;
      return shape(plan, part.x, part.z, part.width, part.depth, false).replace("/>", `${turn}/>`);
    })
    .join("");

  // One mark per kind of piece, and only where it does not crowd a mark already drawn.
  const placed: [number, number][] = [];
  const marks = schedule
    .flatMap((row) =>
      row.parts.map((part) => {
        const box = partBounds(part);
        const x = (box.minX + box.maxX) / 2;
        const y = height - (box.minY + box.maxY) / 2;
        const [sx, sy] = [front.ox + x * front.scale, front.oy + y * front.scale];
        if (placed.some(([px, py]) => Math.hypot(px - sx, py - sy) < 30)) return "";
        placed.push([sx, sy]);
        return mark(front, x, y, row.mark);
      }),
    )
    .join("");

  const body = [
    withSchedule ? titleBlock(width, depth, height, parts.length) : "",
    viewLabel(front, "FRONT"),
    viewLabel(side, "SIDE"),
    viewLabel(plan, "PLAN"),
    frontShapes || outline(front),
    sideShapes || outline(side),
    planShapes || outline(plan),
    marks,
    horizontalDim(front.ox, front.ox + front.dw, front.oy + front.dh + 46, formatMm(width)),
    verticalDim(front.ox - 58, front.oy, front.oy + front.dh, formatMm(height)),
    horizontalDim(side.ox, side.ox + side.dw, side.oy + side.dh + 46, formatMm(depth)),
    horizontalDim(plan.ox, plan.ox + plan.dw, plan.oy + plan.dh + 40, formatMm(width)),
    verticalDim(plan.ox + plan.dw + 42, plan.oy, plan.oy + plan.dh, formatMm(depth)),
    withSchedule ? partsTable(schedule, tableTop) : "",
  ].join("");

  return sheetSvg(paperW, paperH, body);
}

function sheetSvg(width: number, height: number, body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="16" y="16" width="${width - 32}" height="${height - 32}" fill="none" stroke="#1c1b18" stroke-width="2"/>
  ${body}
</svg>`;
}

function titleBlock(width: number, depth: number, height: number, count: number) {
  return `<text x="48" y="62" font-family="Helvetica" font-size="28" font-weight="700" fill="#1c1b18">TECHNICAL DRAWING</text>
  <text x="48" y="96" font-family="Helvetica" font-size="18" fill="#1c1b18">Overall ${formatMm(width)} × ${formatMm(depth)} × ${formatMm(height)} mm</text>
  <text x="1632" y="78" text-anchor="end" font-family="Helvetica" font-size="16" fill="#726e66">Units mm · ${count} piece${count === 1 ? "" : "s"}</text>`;
}

function viewLabel(box: Fit, label: string) {
  return `<text x="${box.ox}" y="${box.oy - 64}" font-family="Helvetica" font-size="14" fill="#726e66">${label}</text>`;
}

type Fit = { ox: number; oy: number; dw: number; dh: number; scale: number };

function fitBox(box: { x: number; y: number; w: number; h: number }, modelW: number, modelH: number): Fit {
  const scale = Math.min(box.w / Math.max(modelW, 1), box.h / Math.max(modelH, 1));
  const dw = modelW * scale;
  const dh = modelH * scale;
  return { scale, dw, dh, ox: box.x + (box.w - dw) / 2, oy: box.y + (box.h - dh) / 2 };
}

function outline(box: Fit) {
  return `<rect x="${box.ox}" y="${box.oy}" width="${box.dw}" height="${box.dh}" fill="none" stroke="#1c1b18" stroke-width="2"/>`;
}

function rectPath(box: Fit, x: number, y: number, w: number, h: number) {
  const sx = box.ox + x * box.scale;
  const sy = box.oy + y * box.scale;
  const sw = Math.max(w * box.scale, 1);
  const sh = Math.max(h * box.scale, 1);
  return `M ${sx} ${sy} H ${sx + sw} V ${sy + sh} H ${sx} Z`;
}

function frontPath(box: Fit, x: number, y: number, w: number, h: number, corners: CornerRadii | undefined, chamfers: DesignDocument["parts"][number]["chamfers"]) {
  const face = resolveFront(w, h, corners, chamfers);
  if (!face) return "";
  const sx = box.ox + x * box.scale;
  const sy = box.oy + y * box.scale;
  const sw = Math.max(w * box.scale, 1);
  const sh = Math.max(h * box.scale, 1);
  const across = (corner: ResolvedCorner) => ((corner.cutX > 0 ? corner.cutX : corner.radius) * box.scale);
  const down = (corner: ResolvedCorner) => ((corner.cutY > 0 ? corner.cutY : corner.radius) * box.scale);
  const turn = (corner: ResolvedCorner, arc: string, line: string) => (corner.cutX > 0 ? line : corner.radius > 0 ? arc : "");
  return [
    `M ${sx + across(face.topLeft)} ${sy}`,
    `H ${sx + sw - across(face.topRight)}`,
    turn(face.topRight, `A ${across(face.topRight)} ${down(face.topRight)} 0 0 1 ${sx + sw} ${sy + down(face.topRight)}`, `L ${sx + sw} ${sy + face.topRight.cutY * box.scale}`),
    `V ${sy + sh - down(face.bottomRight)}`,
    turn(face.bottomRight, `A ${across(face.bottomRight)} ${down(face.bottomRight)} 0 0 1 ${sx + sw - across(face.bottomRight)} ${sy + sh}`, `L ${sx + sw - face.bottomRight.cutX * box.scale} ${sy + sh}`),
    `H ${sx + across(face.bottomLeft)}`,
    turn(face.bottomLeft, `A ${across(face.bottomLeft)} ${down(face.bottomLeft)} 0 0 1 ${sx} ${sy + sh - down(face.bottomLeft)}`, `L ${sx} ${sy + sh - face.bottomLeft.cutY * box.scale}`),
    `V ${sy + down(face.topLeft)}`,
    turn(face.topLeft, `A ${across(face.topLeft)} ${down(face.topLeft)} 0 0 1 ${sx + across(face.topLeft)} ${sy}`, `L ${sx + face.topLeft.cutX * box.scale} ${sy}`),
    "Z",
  ]
    .filter(Boolean)
    .join(" ");
}

function openingPath(box: Fit, x: number, y: number, w: number, h: number, corners: CornerRadii | undefined) {
  return frontPath(box, x, y, w, h, corners, undefined) || rectPath(box, x, y, w, h);
}

type Part = DesignDocument["parts"][number];

/** Whether a piece's corners, cuts, or openings are drawn on this face. */
function shapedOn(part: Part, face: ShapedFace) {
  return part.shape === "box" && !part.curve && (part.face ?? "front") === face && Boolean(part.outline || part.corners || part.chamfers || part.holes?.length);
}

/**
 * A free outline as a path, face y running up the drawing from the face's bottom edge. Arc edges are true SVG arcs.
 * Face y up is drawing y down, so a counterclockwise arc on the face is clockwise on the drawing.
 */
function polygonPath(box: Fit, x: number, top: number, faceHeight: number, points: Outline) {
  const at = (point: OutlinePoint) => `${box.ox + (x + point[0]) * box.scale} ${box.oy + (top + faceHeight - point[1]) * box.scale}`;
  const edges = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const arc = edgeArc([point[0], point[1]], [next[0], next[1]], bulgeOf(point));
    if (!arc) return `L ${at(next)}`;
    const radius = arc.radius * box.scale;
    return `A ${radius} ${radius} 0 ${Math.abs(arc.sweep) > Math.PI ? 1 : 0} ${arc.sweep > 0 ? 1 : 0} ${at(next)}`;
  });
  return `M ${at(points[0])} ${edges.join(" ")} Z`;
}

/** The shaped face with its openings, its top-left corner at x, top on the drawing. Face y runs up the drawing. */
function outlineSvg(box: Fit, part: Part, x: number, top: number) {
  const axes = faceAxes(part);
  const outer = part.outline
    ? polygonPath(box, x, top, axes.height, part.outline)
    : frontPath(box, x, top, axes.width, axes.height, part.corners, part.chamfers) || rectPath(box, x, top, axes.width, axes.height);
  const holes = (part.holes ?? []).map((hole) => openingPath(box, x + hole.x, top + axes.height - hole.y - hole.height, hole.width, hole.height, hole.corners));
  return `<path d="${[outer, ...holes].join(" ")}" fill="#f7f4ee" stroke="#1c1b18" stroke-width="2" fill-rule="evenodd"/>`;
}

/** A round piece seen from the front or the side: its silhouette and its mirror about the axis. `top` is its top edge on the drawing. */
function roundSvg(box: Fit, part: Part, left: number, top: number) {
  const outline = roundSilhouette(part, 1);
  const axis = left + part.width / 2;
  const at = (r: number, y: number) => `${box.ox + (axis + r) * box.scale} ${box.oy + (top + part.height - y) * box.scale}`;
  const right = outline.map(([r, y]) => at(r, y));
  const mirrored = [...outline].reverse().map(([r, y]) => at(-r, y));
  const body = `<path d="M ${[...right, ...mirrored].join(" L ")} Z" fill="#f7f4ee" stroke="#1c1b18" stroke-width="2"/>`;
  const wall = part.round?.wall;
  if (!wall) return body;
  const inner = outline.map(([r, y]) => [Math.max(0, r - wall), y] as const);
  const hollow = `<path d="M ${[...inner.map(([r, y]) => at(r, y)), ...[...inner].reverse().map(([r, y]) => at(-r, y))].join(" L ")} Z" fill="none" stroke="#1c1b18" stroke-width="1" stroke-dasharray="6 4"/>`;
  return body + hollow;
}

/** A tube along its path, drawn as a stroke its own diameter wide. `top` is its face's top edge on the drawing. */
function tubeSvg(box: Fit, part: Part, x: number, top: number) {
  if (!part.path) return "";
  const axes = faceAxes(part);
  const points = pathPoints(part.path, Boolean(part.closed), 1).map(([u, v]) => `${box.ox + (x + u) * box.scale} ${box.oy + (top + axes.height - v) * box.scale}`);
  const width = Math.max(1.5, axes.thickness * box.scale);
  return `<path d="M ${points.join(" L ")}${part.closed ? " Z" : ""}" fill="none" stroke="#1c1b18" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
}

/** A bent board in the view its curve is seen in: the strip of board along the curve. `top` is the box's top edge on the drawing. */
function curveSvg(box: Fit, part: Part, curve: Curve, top: number) {
  const bend = bendProfile(part, curve);
  const points = bend.points.map(([u, v]) => `${box.ox + (part.x + u) * box.scale} ${box.oy + (top + bend.tall - v) * box.scale}`);
  return `<path d="M ${points.join(" L ")} Z" fill="#f7f4ee" stroke="#1c1b18" stroke-width="2"/>`;
}

function shape(box: Fit, x: number, y: number, w: number, h: number, round: boolean) {
  if (round) {
    return `<rect x="${box.ox + x * box.scale}" y="${box.oy + y * box.scale}" width="${w * box.scale}" height="${h * box.scale}" rx="${(w * box.scale) / 2}" fill="#f7f4ee" stroke="#1c1b18" stroke-width="2"/>`;
  }
  return `<rect x="${box.ox + x * box.scale}" y="${box.oy + y * box.scale}" width="${Math.max(w * box.scale, 1)}" height="${Math.max(h * box.scale, 1)}" fill="#f7f4ee" stroke="#1c1b18" stroke-width="2"/>`;
}

function mark(box: Fit, x: number, y: number, index: number) {
  const cx = box.ox + x * box.scale;
  const cy = box.oy + y * box.scale;
  return `<circle cx="${cx}" cy="${cy}" r="11" fill="#ffffff" stroke="#b4332a" stroke-width="1.5"/>
  <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-family="Helvetica" font-size="12" fill="#b4332a">${index}</text>`;
}

function formatMm(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function horizontalDim(x1: number, x2: number, y: number, label: string) {
  const mid = (x1 + x2) / 2;
  return `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="#b4332a" stroke-width="1.4"/>
  <line x1="${x1}" y1="${y - 7}" x2="${x1}" y2="${y + 7}" stroke="#b4332a" stroke-width="1.4"/>
  <line x1="${x2}" y1="${y - 7}" x2="${x2}" y2="${y + 7}" stroke="#b4332a" stroke-width="1.4"/>
  <text x="${mid}" y="${y - 8}" text-anchor="middle" font-family="Helvetica" font-size="16" fill="#b4332a">${label}</text>`;
}

function verticalDim(x: number, y1: number, y2: number, label: string) {
  const mid = (y1 + y2) / 2;
  return `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#b4332a" stroke-width="1.4"/>
  <line x1="${x - 7}" y1="${y1}" x2="${x + 7}" y2="${y1}" stroke="#b4332a" stroke-width="1.4"/>
  <line x1="${x - 7}" y1="${y2}" x2="${x + 7}" y2="${y2}" stroke="#b4332a" stroke-width="1.4"/>
  <text x="${x - 10}" y="${mid}" text-anchor="middle" font-family="Helvetica" font-size="16" fill="#b4332a" transform="rotate(-90 ${x - 10} ${mid})">${label}</text>`;
}

const MATERIAL_NAME: Record<NonNullable<Part["material"]>, string> = {
  paint: "Painted",
  mdf: "MDF",
  wood: "Wood",
  laminate: "Laminate",
  metal: "Metal",
  glass: "Glass / acrylic",
};

/** A piece's size as the workshop reads it, in millimetres. */
export function pieceSize(part: Part) {
  if (part.shape === "cylinder") return `Ø ${formatMm(part.width)} × ${formatMm(part.height)}`;
  if (part.shape === "tube") return `Ø ${formatMm(faceAxes(part).thickness)} tube in ${formatMm(part.width)} × ${formatMm(part.depth)} × ${formatMm(part.height)}`;
  return `${formatMm(part.width)} × ${formatMm(part.depth)} × ${formatMm(part.height)}`;
}

export function pieceMaterial(part: Part) {
  return MATERIAL_NAME[part.material ?? "paint"];
}

export type ScheduleRow = { mark: number; name: string; material: string; size: string; parts: Part[] };

/** The stand's pieces, the same piece made more than once on one row with its count. Hidden pieces are left out. */
export function pieceSchedule(parts: Part[]): ScheduleRow[] {
  const rows = new Map<string, ScheduleRow>();
  for (const part of parts) {
    if (part.hidden) continue;
    const name = part.name.replace(/\s*(#?\d+|\(\d+\))$/, "").trim() || part.name;
    const size = pieceSize(part);
    const material = pieceMaterial(part);
    const key = [name.toLowerCase(), part.shape, material, size, part.label ?? ""].join("|");
    const row = rows.get(key);
    if (row) row.parts.push(part);
    else rows.set(key, { mark: rows.size + 1, name: part.shape === "letters" && part.label ? `${name} “${part.label}”` : name, material, size, parts: [part] });
  }
  return [...rows.values()];
}

function partsTable(schedule: ScheduleRow[], top: number) {
  const headers = ["No.", "Piece", "Material", "Size W × D × H (mm)", "Qty"];
  const columns = [70, 160, 760, 1040, 1520];
  const header = headers
    .map((label, index) => `<text x="${columns[index]}" y="${top + 28}" font-family="Helvetica" font-size="14" fill="#726e66">${label}</text>`)
    .join("");
  const rows = schedule
    .map((row, index) => {
      const y = top + 64 + index * 32;
      const cells = [String(row.mark), escapeXml(row.name), row.material, row.size, String(row.parts.length)];
      const tone = index % 2 === 0 ? "#f7f5f2" : "#ffffff";
      return `<rect x="48" y="${y - 20}" width="1584" height="32" fill="${tone}"/>
      ${cells.map((cell, cellIndex) => `<text x="${columns[cellIndex]}" y="${y}" font-family="Helvetica" font-size="15" fill="#1c1b18"${cellIndex === 0 ? ' font-weight="700"' : ""}>${cell}</text>`).join("")}`;
    })
    .join("");
  const empty = schedule.length === 0 ? `<text x="70" y="${top + 64}" font-family="Helvetica" font-size="15" fill="#726e66">Modular frame only.</text>` : "";
  return `<text x="48" y="${top}" font-family="Helvetica" font-size="16" fill="#1c1b18">PIECES</text>
  <line x1="48" y1="${top + 36}" x2="1632" y2="${top + 36}" stroke="#e4e1da" stroke-width="1"/>
  ${header}${rows}${empty}`;
}

export function assemblyNotes(document: DesignDocument) {
  const { width, depth, height } = document.envelope;
  const parts = document.parts ?? [];
  const hasBooth = document.walls.some((wall) => wall.bays.length > 0);
  if (!hasBooth) {
    if (parts.length === 0) return "Nothing has been drawn yet.";
    return [`Stand ${formatMm(width)} × ${formatMm(depth)} × ${formatMm(height)} mm. Sizes in millimetres. The numbers are the piece list's.`, "", ...buildOrder(document)].join("\n");
  }
  const walls = EDGES.map((edge) => {
    const wall = document.walls.find((item) => item.edge === edge);
    const summary = wall?.bays.map((bay) => `${bay.span}× ${bay.kind}`).join(", ") ?? "missing";
    return `${edge}: ${summary}`;
  });
  const features = document.features.map((feature) => {
    if (feature.type === "counter") return `counter ${feature.id} on ${feature.edge} bay ${feature.bayIndex + 1}, ${feature.width}×${feature.depth}×${feature.height} mm`;
    if (feature.type === "fascia") return `fascia on ${feature.edge}, ${feature.height} mm high`;
    if (feature.type === "lightbox") return `lightbox ${feature.id} on ${feature.edge} bay ${feature.bayIndex + 1}`;
    if (feature.type === "spotlight") return `${feature.count} spotlights on ${feature.edge} bay ${feature.bayIndex + 1}`;
    return `floor ${feature.materialId}`;
  });
  return [
    `Modular exhibition booth ${width} × ${depth} × ${height} mm, module ${document.module} mm.`,
    "Set out posts on the module grid. Share corner posts between walls. Leave fully open edges without posts.",
    "Install base and head beams on closed bays. Leave the base beam out of door and open bays.",
    "Fit infill panels between posts and beams. Graphic bays are printed faces; confirm artwork before production.",
    ...walls,
    features.length ? `Features: ${features.join("; ")}.` : "No added features.",
    ...(parts.length > 0 ? ["", ...buildOrder(document)] : []),
  ].join("\n");
}

/** Each item's pieces from the floor up, with how high each one sits, the numbers an installer measures. */
function buildOrder(document: DesignDocument) {
  const schedule = pieceSchedule(document.parts);
  const markOf = new Map(schedule.flatMap((row) => row.parts.map((part) => [part.id, row] as const)));
  const items = new Map<string, Part[]>();
  for (const part of document.parts) {
    if (part.hidden) continue;
    const key = part.group ?? "";
    items.set(key, [...(items.get(key) ?? []), part]);
  }
  const ordered = [...items.entries()].sort(([a], [b]) => (a === "" ? 1 : 0) - (b === "" ? 1 : 0));
  return ordered.flatMap(([group, members], index) => {
    const title = group ? (document.groups?.[group] ?? group) : ordered.length > 1 ? "Loose pieces" : "Pieces";
    const rows = new Map<ScheduleRow, number[]>();
    for (const part of [...members].sort((a, b) => a.y - b.y)) {
      const row = markOf.get(part.id);
      if (row) rows.set(row, [...(rows.get(row) ?? []), Math.round(part.y)]);
    }
    const lines = [...rows.entries()].map(([row, levels]) => {
      const heights = [...new Set(levels)];
      const where = heights.length === 1 && heights[0] <= 1 ? "on the floor" : `at ${heights.join(", ")} mm from the floor`;
      return `  ${row.mark}. ${row.name}${levels.length > 1 ? ` × ${levels.length}` : ""} · ${where}`;
    });
    return [`${index + 1}. ${title}`, ...lines];
  });
}
