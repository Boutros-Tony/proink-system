import { formatThicknessMm, thicknessMismatch } from "../../production/cutting";
import { constraintNumber, findSku, LIMIT_DEFAULTS, SKU, type CatalogItem } from "../catalog";
import { defaultPriceBook, estimateMaterials, type PriceBook } from "../materials";
import type { ValidationIssue } from "../types";
import { compileDesign, counterFootprint } from "./compile";
import { edgeLength, POST_SIZE, rectanglesOverlapArea } from "./geometry";
import { bookForJob } from "./job-materials";
import { EDGES, type DesignDocument, type EdgeId } from "./schema";

function issue(
  severity: ValidationIssue["severity"],
  code: string,
  message: string,
  componentId?: string,
): ValidationIssue {
  return { severity, code, message, componentId };
}

export function validateDesign(document: DesignDocument, catalog: CatalogItem[], book: PriceBook = defaultPriceBook()): ValidationIssue[] {
  const priced = bookForJob(book, document);
  const issues: ValidationIssue[] = [];
  const limits = findSku(catalog, SKU.limits);
  const panel = findSku(catalog, SKU.panel);
  if (!limits) {
    issues.push(issue("warning", "catalog.limits", "SYS-LIMITS is missing. Built-in limits are being used.", "catalog"));
  }
  if (!panel) {
    issues.push(issue("warning", "catalog.panel", "PNL-SHEET is missing. Built-in sheet limits are being used.", "catalog"));
  }

  const minEnvelope = constraintNumber(limits, "minEnvelopeMm", LIMIT_DEFAULTS.minEnvelopeMm);
  const maxEnvelope = constraintNumber(limits, "maxEnvelopeMm", LIMIT_DEFAULTS.maxEnvelopeMm);
  const minHeight = constraintNumber(limits, "minHeightMm", LIMIT_DEFAULTS.minHeightMm);
  const maxHeight = constraintNumber(limits, "maxHeightMm", LIMIT_DEFAULTS.maxHeightMm);
  const minDoor = constraintNumber(limits, "minDoorMm", LIMIT_DEFAULTS.minDoorMm);
  const maxPanelWidth = constraintNumber(panel, "maxWidthMm", LIMIT_DEFAULTS.maxPanelWidthMm);
  const maxPanelHeight = constraintNumber(panel, "maxHeightMm", LIMIT_DEFAULTS.maxPanelHeightMm);
  const { envelope, module } = document;
  const boothBuilt = document.walls.some((wall) => wall.bays.length > 0);
  if (document.parts.length > 0) {
    const estimate = estimateMaterials(document.parts, priced);
    if (estimate.unpriced.length > 0) {
      const names = [...new Set(estimate.unpriced.map((part) => part.material ?? "paint"))].join(", ");
      issues.push(
        issue(
          "warning",
          "parts.unpriced",
          `${estimate.unpriced.length} custom ${estimate.unpriced.length === 1 ? "piece has" : "pieces have"} no material price (${names}). Set one in Settings, Materials.`,
          "parts",
        ),
      );
    }
    const oversize = estimate.usage.flatMap((usage) => usage.oversize.map((name) => ({ name, board: usage.boardSize })));
    if (oversize.length > 0) {
      const shown = oversize.slice(0, 3).map((item) => `${item.name} (board ${item.board})`).join(", ");
      issues.push(
        issue(
          "warning",
          "parts.oversize",
          `${oversize.length} ${oversize.length === 1 ? "piece is" : "pieces are"} bigger than one board and will need joining: ${shown}${oversize.length > 3 ? ` and ${oversize.length - 3} more` : ""}.`,
          "parts",
        ),
      );
    }
    const mismatches = new Map<string, { panelMm: number; boardMm: number; label: string; names: string[] }>();
    for (const part of document.parts) {
      const gap = thicknessMismatch(part, priced.materials);
      if (!gap) continue;
      const key = `${gap.label}:${gap.panelMm}:${gap.boardMm}`;
      const group = mismatches.get(key) ?? { ...gap, names: [] };
      group.names.push(part.name);
      mismatches.set(key, group);
    }
    for (const gap of mismatches.values()) {
      const shown = gap.names.slice(0, 3).join(", ");
      const more = gap.names.length > 3 ? ` and ${gap.names.length - 3} more` : "";
      const noun = gap.names.length === 1 ? "piece is" : "pieces are";
      issues.push(
        issue(
          "warning",
          "parts.thickness",
          `${gap.names.length} ${noun} ${formatThicknessMm(gap.panelMm)} mm thick, but the nearest ${gap.label} board is ${formatThicknessMm(gap.boardMm)} mm: ${shown}${more}.`,
          "parts",
        ),
      );
    }
    const used = new Set(estimate.usage.map((usage) => usage.materialId));
    const estimated = (document.jobMaterials ?? []).filter((material) => material.estimated && used.has(material.id));
    if (estimated.length > 0) {
      const noun = estimated.length === 1 ? "material is" : "materials are";
      issues.push(
        issue(
          "warning",
          "parts.estimated",
          `${estimated.length} ${noun} priced by estimate, not from the price list: ${estimated.map((material) => material.name).join(", ")}. Confirm the price, or add them in Settings, Materials.`,
          "parts",
        ),
      );
    }
  }
  if (!boothBuilt) return issues;

  if (envelope.width < minEnvelope || envelope.width > maxEnvelope) {
    issues.push(
      issue(
        "error",
        "envelope.width",
        `Width ${envelope.width} mm is outside ${minEnvelope}–${maxEnvelope} mm.`,
        "envelope",
      ),
    );
  }
  if (envelope.depth < minEnvelope || envelope.depth > maxEnvelope) {
    issues.push(
      issue(
        "error",
        "envelope.depth",
        `Depth ${envelope.depth} mm is outside ${minEnvelope}–${maxEnvelope} mm.`,
        "envelope",
      ),
    );
  }
  if (envelope.height < minHeight || envelope.height > maxHeight) {
    issues.push(
      issue(
        "error",
        "envelope.height",
        `Height ${envelope.height} mm is outside ${minHeight}–${maxHeight} mm.`,
        "envelope",
      ),
    );
  }

  const fasciaByEdge = new Map<EdgeId, number>();
  for (const feature of document.features) {
    if (feature.type === "fascia") fasciaByEdge.set(feature.edge, feature.height);
  }

  let closedBays = 0;
  for (const edge of EDGES) {
    const wall = document.walls.find((item) => item.edge === edge);
    if (!wall) continue;
    const length = edgeLength(edge, envelope);
    const spanModules = wall.bays.reduce((sum, bay) => sum + bay.span, 0);
    if (length % module !== 0) {
      issues.push(
        issue(
          "error",
          "edge.module",
          `${edge} length ${length} mm is not a multiple of the ${module} mm module.`,
          `wall:${edge}`,
        ),
      );
    }
    if (spanModules * module !== length) {
      issues.push(
        issue(
          "error",
          "edge.span",
          `${edge} bays cover ${spanModules * module} mm, but the edge is ${length} mm.`,
          `wall:${edge}`,
        ),
      );
    }

    const panelHeight = envelope.height - (fasciaByEdge.get(edge) ?? 0) - POST_SIZE * 2;
    wall.bays.forEach((bay, bayIndex) => {
      const componentId = `bay:${edge}:${bayIndex}`;
      const bayWidth = bay.span * module;
      if (bay.kind === "door" && bayWidth < minDoor) {
        issues.push(issue("error", "door.width", `Door on ${edge} bay ${bayIndex + 1} is ${bayWidth} mm. Minimum is ${minDoor} mm.`, componentId));
      }
      if (bay.kind === "graphic" || bay.kind === "solid") {
        closedBays += 1;
        const clearWidth = bayWidth - POST_SIZE;
        if (clearWidth > maxPanelWidth || panelHeight > maxPanelHeight) {
          issues.push(
            issue(
              "error",
              "panel.size",
              `${edge} bay ${bayIndex + 1} panel is ${clearWidth} × ${panelHeight} mm. Sheet limit is ${maxPanelWidth} × ${maxPanelHeight} mm.`,
              `panel:${edge}:${bayIndex}`,
            ),
          );
        }
      }
      if (bay.kind === "graphic" && !bay.finishId) {
        issues.push(issue("error", "graphic.finish", `${edge} bay ${bayIndex + 1} needs a finish.`, componentId));
      }
      if (bay.kind === "graphic" && !bay.graphicAssetId) {
        issues.push(issue("warning", "graphic.artwork", `${edge} bay ${bayIndex + 1} has no artwork file yet.`, componentId));
      }
    });
  }

  if (closedBays === 0) {
    issues.push(issue("error", "structure.missing", "The booth needs at least one solid or graphic bay.", "envelope"));
  }

  const compiled = compileDesign(document);
  for (const feature of document.features) {
    if (feature.type !== "counter") continue;
    const wall = document.walls.find((item) => item.edge === feature.edge);
    if (!wall || feature.bayIndex >= wall.bays.length) {
      issues.push(issue("error", "counter.bay", `Counter ${feature.id} does not sit on a bay.`, feature.id));
      continue;
    }
    const footprint = counterFootprint(feature, document);
    if (!footprint) continue;
    const { width, depth } = envelope;
    if (footprint.minX < -0.01 || footprint.minZ < -0.01 || footprint.maxX > width + 0.01 || footprint.maxZ > depth + 0.01) {
      issues.push(issue("error", "counter.inside", `Counter ${feature.id} extends outside the booth.`, feature.id));
    }
    const hitsPost = compiled.posts.some((post) => {
      const area = rectanglesOverlapArea(footprint, {
        minX: post.x - POST_SIZE / 2,
        maxX: post.x + POST_SIZE / 2,
        minZ: post.z - POST_SIZE / 2,
        maxZ: post.z + POST_SIZE / 2,
      });
      return area > 1;
    });
    if (hitsPost) {
      issues.push(issue("error", "counter.post", `Counter ${feature.id} occupies a structural post.`, feature.id));
    }
  }

  for (const feature of document.features) {
    if (feature.type !== "lightbox" && feature.type !== "spotlight") continue;
    const wall = document.walls.find((item) => item.edge === feature.edge);
    const bay = wall?.bays[feature.bayIndex];
    if (!bay) {
      issues.push(issue("error", "feature.bay", `${feature.type} ${feature.id} does not sit on a bay.`, feature.id));
      continue;
    }
    if (feature.type === "lightbox" && bay.kind !== "graphic" && bay.kind !== "solid") {
      issues.push(issue("error", "lightbox.bay", `Lightbox ${feature.id} needs a graphic or solid bay.`, feature.id));
    }
  }

  return issues;
}

export function hasBlockingIssues(issues: ValidationIssue[]) {
  return issues.some((item) => item.severity === "error");
}
