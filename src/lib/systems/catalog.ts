export const SKU = {
  extrusion: "EXT-ALU-40",
  panel: "PNL-SHEET",
  print: "GFX-PRINT",
  counter: "FUR-COUNTER",
  fascia: "FUR-FASCIA",
  lightbox: "LGT-BOX",
  spotlight: "LGT-SPOT",
  floor: "FLR-CARPET",
  connector: "HW-CONNECTOR",
  labor: "LAB-HOUR",
  limits: "SYS-LIMITS",
} as const;

export type CatalogConstraints = {
  stockLengthMm?: number;
  wasteFactor?: number;
  maxWidthMm?: number;
  maxHeightMm?: number;
  bleedMm?: number;
  baseHours?: number;
  hoursPerSquareMeter?: number;
  hoursPerPanel?: number;
  minEnvelopeMm?: number;
  maxEnvelopeMm?: number;
  minHeightMm?: number;
  minDoorMm?: number;
};

export type CatalogItem = {
  sku: string;
  name: string;
  category: string;
  unit: string;
  unitCostCents: number;
  constraints: CatalogConstraints;
};

export const LIMIT_DEFAULTS = {
  minEnvelopeMm: 1000,
  maxEnvelopeMm: 12000,
  minHeightMm: 2400,
  maxHeightMm: 6000,
  minDoorMm: 900,
  maxPanelWidthMm: 2400,
  maxPanelHeightMm: 3000,
  stockLengthMm: 6000,
  wasteFactor: 0.05,
  bleedMm: 10,
  baseHours: 8,
  hoursPerSquareMeter: 0.5,
  hoursPerPanel: 0.25,
} as const;

export function seedCatalog(): CatalogItem[] {
  return [
    {
      sku: SKU.extrusion,
      name: "Aluminum extrusion 40 mm",
      category: "structure",
      unit: "meter",
      unitCostCents: 1200,
      constraints: { stockLengthMm: 6000, wasteFactor: 0.05 },
    },
    {
      sku: SKU.panel,
      name: "Panel sheet",
      category: "panels",
      unit: "sheet",
      unitCostCents: 4500,
      constraints: { maxWidthMm: 2400, maxHeightMm: 3000 },
    },
    {
      sku: SKU.print,
      name: "Graphic print",
      category: "graphics",
      unit: "m2",
      unitCostCents: 3500,
      constraints: { bleedMm: 10 },
    },
    {
      sku: SKU.counter,
      name: "Reception counter",
      category: "furniture",
      unit: "each",
      unitCostCents: 85000,
      constraints: {},
    },
    {
      sku: SKU.fascia,
      name: "Fascia band",
      category: "furniture",
      unit: "meter",
      unitCostCents: 4200,
      constraints: {},
    },
    {
      sku: SKU.lightbox,
      name: "Lightbox",
      category: "lighting",
      unit: "each",
      unitCostCents: 22000,
      constraints: {},
    },
    {
      sku: SKU.spotlight,
      name: "Spotlight",
      category: "lighting",
      unit: "each",
      unitCostCents: 3500,
      constraints: {},
    },
    {
      sku: SKU.floor,
      name: "Floor covering",
      category: "flooring",
      unit: "m2",
      unitCostCents: 800,
      constraints: {},
    },
    {
      sku: SKU.connector,
      name: "Frame connector",
      category: "structure",
      unit: "each",
      unitCostCents: 150,
      constraints: {},
    },
    {
      sku: SKU.labor,
      name: "Assembly labor",
      category: "labor",
      unit: "hour",
      unitCostCents: 6500,
      constraints: { baseHours: 8, hoursPerSquareMeter: 0.5, hoursPerPanel: 0.25 },
    },
    {
      sku: SKU.limits,
      name: "System limits",
      category: "limits",
      unit: "config",
      unitCostCents: 0,
      constraints: {
        minEnvelopeMm: 1000,
        maxEnvelopeMm: 12000,
        minHeightMm: 2400,
        maxHeightMm: 6000,
        minDoorMm: 900,
      },
    },
  ];
}

export function findSku(catalog: CatalogItem[], sku: string) {
  return catalog.find((item) => item.sku === sku);
}

export function constraintNumber(
  item: CatalogItem | undefined,
  key: keyof CatalogConstraints,
  fallback: number,
) {
  const value = item?.constraints?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function lineCents(quantity: number, unitCostCents: number) {
  return Math.round(quantity * unitCostCents);
}
