import { bayRanges, edgeLength, inward, pointAlong, POST_SIZE } from "./geometry";
import type { Bay, BoothFeature, Chamfers, CornerRadii, Curve, DesignDocument, EdgeId, Hole, Outline, PartImage, PartShape, Round, ShapedFace, Wall } from "./schema";

export type CompiledPost = {
  id: string;
  x: number;
  z: number;
  height: number;
  size: number;
};

export type CompiledBeam = {
  id: string;
  edge: EdgeId;
  bayIndex: number;
  level: "base" | "head";
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  y: number;
  length: number;
  profile: number;
};

export type CompiledPanel = {
  id: string;
  edge: EdgeId;
  bayIndex: number;
  kind: "graphic" | "solid" | "lightbox";
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  thickness: number;
  finishId?: string;
  graphicAssetId?: string;
};

export type CompiledOpening = {
  id: string;
  edge: EdgeId;
  bayIndex: number;
  kind: "open" | "door";
  x: number;
  z: number;
  width: number;
  height: number;
};

export type CompiledCounter = {
  id: string;
  edge: EdgeId;
  bayIndex: number;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
};

export type CompiledFascia = {
  id: string;
  edge: EdgeId;
  x: number;
  y: number;
  z: number;
  length: number;
  height: number;
  thickness: number;
};

export type CompiledPart = {
  id: string;
  name: string;
  shape: PartShape;
  meshId?: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  material?: "paint" | "mdf" | "wood" | "laminate" | "metal" | "glass";
  color?: string;
  label?: string;
  rotation?: number;
  tilt?: number;
  corners?: CornerRadii;
  chamfers?: Chamfers;
  holes?: Hole[];
  outline?: Outline;
  face?: ShapedFace;
  curve?: Curve;
  round?: Round;
  path?: Outline;
  closed?: boolean;
  group?: string;
  locked?: boolean;
  hidden?: boolean;
  images?: PartImage[];
};

export type CompiledSpot = {
  id: string;
  edge: EdgeId;
  bayIndex: number;
  x: number;
  y: number;
  z: number;
};

export type CompiledModel = {
  posts: CompiledPost[];
  beams: CompiledBeam[];
  panels: CompiledPanel[];
  openings: CompiledOpening[];
  counters: CompiledCounter[];
  fascias: CompiledFascia[];
  spots: CompiledSpot[];
  floor: { materialId: string } | null;
  parts: CompiledPart[];
};

function wallByEdge(document: DesignDocument, edge: EdgeId) {
  const wall = document.walls.find((item) => item.edge === edge);
  if (!wall) throw new Error(`Missing wall ${edge}`);
  return wall;
}

function featuresFor(document: DesignDocument, edge: EdgeId) {
  return document.features.filter((feature) => "edge" in feature && feature.edge === edge);
}

function wallIsStructural(wall: Wall, features: BoothFeature[]) {
  if (wall.bays.some((bay) => bay.kind !== "open")) return true;
  return features.some((feature) => feature.type === "fascia" || feature.type === "spotlight");
}

function fasciaHeight(features: BoothFeature[]) {
  const fascia = features.find((feature) => feature.type === "fascia");
  return fascia && fascia.type === "fascia" ? fascia.height : 0;
}

function lightboxOnBay(features: BoothFeature[], bayIndex: number) {
  return features.some((feature) => feature.type === "lightbox" && feature.bayIndex === bayIndex);
}

export function counterFootprint(
  feature: Extract<BoothFeature, { type: "counter" }>,
  document: DesignDocument,
) {
  const wall = wallByEdge(document, feature.edge);
  const ranges = bayRanges(
    wall.bays.map((bay) => bay.span),
    document.module,
  );
  const range = ranges[feature.bayIndex];
  if (!range) return null;
  const center = (range.start + range.end) / 2;
  const along0 = center - feature.width / 2;
  const along1 = center + feature.width / 2;
  const { width, depth } = document.envelope;
  if (feature.edge === "back") {
    return { minX: along0, maxX: along1, minZ: 0, maxZ: feature.depth, center, range };
  }
  if (feature.edge === "front") {
    return { minX: along0, maxX: along1, minZ: depth - feature.depth, maxZ: depth, center, range };
  }
  if (feature.edge === "left") {
    return { minX: 0, maxX: feature.depth, minZ: along0, maxZ: along1, center, range };
  }
  return { minX: width - feature.depth, maxX: width, minZ: along0, maxZ: along1, center, range };
}

function panelCenter(edge: EdgeId, along: number, y: number, envelope: DesignDocument["envelope"]) {
  const point = pointAlong(edge, along, envelope);
  return { x: point.x, y, z: point.z };
}

export function compileDesign(document: DesignDocument): CompiledModel {
  const posts = new Map<string, CompiledPost>();
  const beams: CompiledBeam[] = [];
  const panels: CompiledPanel[] = [];
  const openings: CompiledOpening[] = [];
  const counters: CompiledCounter[] = [];
  const fascias: CompiledFascia[] = [];
  const spots: CompiledSpot[] = [];
  const { envelope, module } = document;
  const panelTopFor = (height: number) => envelope.height - height;

  for (const edge of ["back", "left", "right", "front"] as EdgeId[]) {
    const wall = wallByEdge(document, edge);
    const features = featuresFor(document, edge);
    if (!wallIsStructural(wall, features)) {
      wall.bays.forEach((bay, bayIndex) => {
        if (bay.kind === "open" || bay.kind === "door") {
          const ranges = bayRanges(wall.bays.map((item) => item.span), module);
          const range = ranges[bayIndex];
          if (!range) return;
          const point = pointAlong(edge, (range.start + range.end) / 2, envelope);
          openings.push({
            id: `opening:${edge}:${bayIndex}`,
            edge,
            bayIndex,
            kind: bay.kind,
            x: point.x,
            z: point.z,
            width: range.length,
            height: envelope.height,
          });
        }
      });
      continue;
    }

    const ranges = bayRanges(wall.bays.map((bay) => bay.span), module);
    const top = panelTopFor(fasciaHeight(features));
    ranges.forEach((range) => {
      for (const distance of [range.start, range.end]) {
        const point = pointAlong(edge, distance, envelope);
        const id = `post:${Math.round(point.x)}:${Math.round(point.z)}`;
        if (!posts.has(id)) {
          posts.set(id, { id, x: point.x, z: point.z, height: envelope.height, size: POST_SIZE });
        }
      }
    });

    wall.bays.forEach((bay, bayIndex) => {
      const range = ranges[bayIndex];
      if (!range) return;
      addBay({
        document,
        edge,
        bay,
        bayIndex,
        range,
        features,
        top,
        beams,
        panels,
        openings,
      });
    });

    const fascia = features.find((feature) => feature.type === "fascia");
    if (fascia && fascia.type === "fascia") {
      const length = edgeLength(edge, envelope);
      const mid = pointAlong(edge, length / 2, envelope);
      fascias.push({
        id: fascia.id,
        edge,
        x: mid.x,
        y: top + fascia.height / 2,
        z: mid.z,
        length,
        height: fascia.height,
        thickness: POST_SIZE,
      });
    }

    for (const feature of features) {
      if (feature.type !== "spotlight") continue;
      const range = ranges[feature.bayIndex];
      if (!range) continue;
      for (let index = 0; index < feature.count; index += 1) {
        const along = range.start + (range.length * (index + 1)) / (feature.count + 1);
        const normal = inward(edge);
        const point = pointAlong(edge, along, envelope);
        spots.push({
          id: `${feature.id}:${index}`,
          edge,
          bayIndex: feature.bayIndex,
          x: point.x + normal.x * 150,
          y: envelope.height - 80,
          z: point.z + normal.z * 150,
        });
      }
    }
  }

  for (const feature of document.features) {
    if (feature.type !== "counter") continue;
    const footprint = counterFootprint(feature, document);
    if (!footprint) continue;
    const centerX = (footprint.minX + footprint.maxX) / 2;
    const centerZ = (footprint.minZ + footprint.maxZ) / 2;
    counters.push({
      id: feature.id,
      edge: feature.edge,
      bayIndex: feature.bayIndex,
      x: centerX,
      y: feature.height / 2,
      z: centerZ,
      width: feature.edge === "left" || feature.edge === "right" ? feature.depth : feature.width,
      depth: feature.edge === "left" || feature.edge === "right" ? feature.width : feature.depth,
      height: feature.height,
      minX: footprint.minX,
      maxX: footprint.maxX,
      minZ: footprint.minZ,
      maxZ: footprint.maxZ,
    });
  }

  const floor = document.features.find((feature) => feature.type === "floor");
  return {
    posts: [...posts.values()],
    beams,
    panels,
    openings,
    counters,
    fascias,
    spots,
    floor: floor && floor.type === "floor" ? { materialId: floor.materialId } : null,
    parts: (document.parts ?? []).map((part) => ({
      id: part.id,
      name: part.name,
      shape: part.shape,
      meshId: part.meshId,
      x: part.x,
      y: part.y,
      z: part.z,
      width: part.width,
      height: part.height,
      depth: part.depth,
      material: part.material,
      color: part.color,
      label: part.label,
      rotation: part.rotation,
      tilt: part.tilt,
      corners: part.corners,
      chamfers: part.chamfers,
      holes: part.holes,
      outline: part.outline,
      face: part.face,
      curve: part.curve,
      round: part.round,
      path: part.path,
      closed: part.closed,
      group: part.group,
      locked: part.locked,
      hidden: part.hidden,
      images: part.images,
    })),
  };
}

function addBay(input: {
  document: DesignDocument;
  edge: EdgeId;
  bay: Bay;
  bayIndex: number;
  range: { start: number; end: number; length: number };
  features: BoothFeature[];
  top: number;
  beams: CompiledBeam[];
  panels: CompiledPanel[];
  openings: CompiledOpening[];
}) {
  const { document, edge, bay, bayIndex, range, features, top } = input;
  const clear = range.length - POST_SIZE;
  if (clear > 0) {
    const start = pointAlong(edge, range.start + POST_SIZE / 2, document.envelope);
    const end = pointAlong(edge, range.end - POST_SIZE / 2, document.envelope);
    const levels: Array<"base" | "head"> = bay.kind === "open" || bay.kind === "door" ? ["head"] : ["base", "head"];
    for (const level of levels) {
      input.beams.push({
        id: `beam:${edge}:${bayIndex}:${level}`,
        edge,
        bayIndex,
        level,
        x1: start.x,
        z1: start.z,
        x2: end.x,
        z2: end.z,
        y: level === "base" ? POST_SIZE / 2 : top - POST_SIZE / 2,
        length: clear,
        profile: POST_SIZE,
      });
    }
  }

  const along = (range.start + range.end) / 2;
  const panelHeight = top - POST_SIZE * 2;
  if (bay.kind === "graphic" || bay.kind === "solid") {
    const lightbox = lightboxOnBay(features, bayIndex);
    const center = panelCenter(edge, along, POST_SIZE + panelHeight / 2, document.envelope);
    input.panels.push({
      id: `panel:${edge}:${bayIndex}`,
      edge,
      bayIndex,
      kind: lightbox ? "lightbox" : bay.kind,
      ...center,
      width: clear,
      height: panelHeight,
      thickness: lightbox ? 120 : 18,
      finishId: bay.finishId,
      graphicAssetId: bay.graphicAssetId,
    });
    return;
  }

  const point = pointAlong(edge, along, document.envelope);
  input.openings.push({
    id: `opening:${edge}:${bayIndex}`,
    edge,
    bayIndex,
    kind: bay.kind,
    x: point.x,
    z: point.z,
    width: range.length,
    height: top,
  });
}
