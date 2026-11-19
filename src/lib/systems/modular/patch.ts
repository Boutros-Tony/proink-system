import { EDGES, designDocumentSchema, type Bay, type DesignDocument, type DesignPatch, type EdgeId } from "./schema";
import { edgeLength, unionBounds } from "./geometry";

const DEFAULT_KIND: Record<EdgeId, Bay["kind"]> = {
  back: "graphic",
  left: "solid",
  right: "solid",
  front: "open",
};

export function createInlineBooth(envelope: { width?: number; depth?: number; height?: number } = {}): DesignDocument {
  const document: DesignDocument = {
    schemaVersion: 1,
    system: "modular_exhibition",
    units: "mm",
    envelope: {
      width: envelope.width ?? 3000,
      depth: envelope.depth ?? 3000,
      height: envelope.height ?? 3000,
    },
    module: 1000,
    walls: EDGES.map((edge) => ({ edge, bays: [] })),
    features: [{ id: "floor-1", type: "floor", materialId: "FLR-CARPET" }],
    parts: [],
  };
  return resizeWalls(document);
}

export function createEmptyDesign(): DesignDocument {
  return {
    schemaVersion: 1,
    system: "modular_exhibition",
    units: "mm",
    envelope: { width: 1000, depth: 1000, height: 2400 },
    module: 1000,
    walls: EDGES.map((edge) => ({ edge, bays: [] })),
    features: [],
    parts: [],
  };
}

function expandBays(bays: Bay[]): Bay[] {
  return bays.flatMap((bay) => Array.from({ length: bay.span }, () => ({ ...bay, span: 1 })));
}

function defaultBay(edge: EdgeId): Bay {
  const kind = DEFAULT_KIND[edge];
  return kind === "graphic" ? { span: 1, kind, finishId: "white" } : { span: 1, kind };
}

export function resizeWalls(document: DesignDocument): DesignDocument {
  return {
    ...document,
    walls: EDGES.map((edge) => {
      const existing = document.walls.find((wall) => wall.edge === edge);
      const length = edgeLength(edge, document.envelope);
      const count = length / document.module;
      if (!Number.isInteger(count) || count < 1) {
        return existing ?? { edge, bays: [defaultBay(edge)] };
      }
      const bays = expandBays(existing?.bays ?? []);
      const next = Array.from({ length: count }, (_, index) => bays[index] ?? defaultBay(edge));
      return { edge, bays: next.map((bay) => ({ ...bay, span: 1 })) };
    }),
  };
}

export function applyDesignPatch(document: DesignDocument, patch: DesignPatch): DesignDocument {
  let next: DesignDocument = {
    ...document,
    envelope: { ...document.envelope, ...patch.envelope },
    module: patch.module ?? document.module,
    walls: patch.walls ?? document.walls,
    features: patch.features ?? document.features,
    parts: patch.parts ?? document.parts,
  };
  const hasBooth = next.walls.some((wall) => wall.bays.length > 0);
  if (!patch.walls && hasBooth && (patch.envelope || patch.module)) {
    next = resizeWalls(next);
  }
  if (patch.parts && !hasBooth && patch.parts.length > 0) {
    const bounds = unionBounds(patch.parts);
    if (bounds) {
      next = {
        ...next,
        envelope: {
          width: Math.ceil(Math.max(bounds.maxX, 1)),
          depth: Math.ceil(Math.max(bounds.maxZ, 1)),
          height: Math.ceil(Math.max(bounds.maxY, 1)),
        },
      };
    }
  }
  if (patch.groups) next = { ...next, groups: patch.groups };
  return designDocumentSchema.parse(pruneGroups(next));
}

/** Keep only the group names that still have members. */
function pruneGroups(document: DesignDocument): DesignDocument {
  if (!document.groups) return document;
  const used = new Set(document.parts.flatMap((part) => (part.group ? [part.group] : [])));
  const entries = Object.entries(document.groups).filter(([id]) => used.has(id));
  if (entries.length === 0) {
    const { groups: _removed, ...rest } = document;
    void _removed;
    return rest;
  }
  return { ...document, groups: Object.fromEntries(entries) };
}

export function setBayKind(document: DesignDocument, edge: EdgeId, bayIndex: number, kind: Bay["kind"]): DesignDocument {
  return {
    ...document,
    walls: document.walls.map((wall) => {
      if (wall.edge !== edge) return wall;
      return {
        ...wall,
        bays: wall.bays.map((bay, index) => {
          if (index !== bayIndex) return bay;
          if (kind === "graphic") return { ...bay, kind, finishId: bay.finishId ?? "white" };
          return { span: bay.span, kind };
        }),
      };
    }),
  };
}
