export type BoothSystemId = "modular_exhibition" | "custom_carpentry";

export type IssueSeverity = "error" | "warning";

export type ValidationIssue = {
  severity: IssueSeverity;
  code: string;
  message: string;
  componentId?: string;
  /** What to change, when the issue comes from the production check. */
  fix?: string;
  /** The production-check finding this issue came from. */
  findingId?: string;
  /** The user let this finding through. The files may go out anyway. */
  accepted?: boolean;
  /** Piece ids the finding is about. */
  pieces?: string[];
};

/** The headings a quotation is sorted under, in the order they print. */
export const QUOTE_GROUPS = [
  "structure",
  "panels",
  "materials",
  "hardware",
  "finishing",
  "graphics",
  "furniture",
  "equipment",
  "lighting",
  "electrical",
  "flooring",
  "labor",
  "logistics",
  "other",
] as const;

export type QuoteGroup = (typeof QUOTE_GROUPS)[number];

export const QUOTE_GROUP_LABEL: Record<QuoteGroup, string> = {
  structure: "Structure",
  panels: "Panels",
  materials: "Boards and sheets",
  hardware: "Hardware and fixings",
  finishing: "Finishing and consumables",
  graphics: "Graphics",
  furniture: "Furniture",
  equipment: "Displays and equipment",
  lighting: "Lighting",
  electrical: "Electrical",
  flooring: "Flooring",
  labor: "Labor",
  logistics: "Transport and packaging",
  other: "Other",
};

export type BomLine = {
  /** Stable id of the line inside one design, so a price edited for this job survives a change in quantity. */
  key: string;
  sku: string;
  group: QuoteGroup;
  description: string;
  quantity: number;
  unit: string;
  unitCostCents: number;
  totalCents: number;
  /** Shop material this board line was cut from, so a shared sheet can be split between items. */
  piece?: string | null;
};

export type CutPiece = {
  part: string;
  lengthMm: number;
  quantity: number;
};

export type PanelScheduleRow = {
  id: string;
  edge: string;
  bayIndex: number;
  kind: string;
  widthMm: number;
  heightMm: number;
  finish: string;
  graphicAssetId: string;
};
