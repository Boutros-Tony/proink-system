import { compileDesign, type CompiledModel } from "./modular/compile";
import { validateDesign } from "./modular/validate";
import { produceDesign, type ProductionResult } from "./modular/produce";
import type { DesignDocument } from "./modular/schema";
import type { CatalogItem } from "./catalog";
import type { BoothSystemId } from "./types";

export type BoothSystem = {
  id: "modular_exhibition";
  compile: (document: DesignDocument) => CompiledModel;
  validate: (document: DesignDocument, catalog: CatalogItem[]) => ReturnType<typeof validateDesign>;
  produce: (document: DesignDocument, catalog: CatalogItem[]) => ProductionResult;
};

const modularExhibition: BoothSystem = {
  id: "modular_exhibition",
  compile: compileDesign,
  validate: validateDesign,
  produce: produceDesign,
};

export function getBoothSystem(id: BoothSystemId | string): BoothSystem | null {
  if (id === "modular_exhibition") return modularExhibition;
  return null;
}
