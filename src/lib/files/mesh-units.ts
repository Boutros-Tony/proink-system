import type { PartMaterial } from "@/lib/systems/modular/schema";

/**
 * How many millimeters one unit of the file represents.
 * glTF is meters by spec. OBJ and STL have no unit, so a small model is treated as meters
 * and a mid-size one as centimeters. Exhibition files exported in millimeters stay as they are.
 */
export function millimetersPerUnit(extension: string, largestExtent: number) {
  const ext = extension.toLowerCase();
  if (ext === "glb" || ext === "gltf") return 1000;
  if (!(largestExtent > 0)) return 1;
  if (largestExtent <= 30) return 1000;
  if (largestExtent <= 300) return 10;
  return 1;
}

export function unitLabel(millimeters: number) {
  if (millimeters === 1000) return "meters";
  if (millimeters === 10) return "centimeters";
  return "millimeters";
}

/** Match a material name from a 3D file to a shop material. Returns null when nothing fits. */
export function guessMaterial(name: string | undefined): PartMaterial | null {
  if (!name) return null;
  const text = name.toLowerCase();
  if (/glass|glaz|acrylic/.test(text)) return "glass";
  if (/aluminium|aluminum|steel|metal|chrome|iron|brass|copper|inox/.test(text)) return "metal";
  if (/laminate|formica|hpl/.test(text)) return "laminate";
  if (/\bmdf\b|chipboard|particle/.test(text)) return "mdf";
  if (/wood|oak|walnut|timber|veneer|plywood|birch/.test(text)) return "wood";
  if (/paint|plastic|fabric|leather|powder/.test(text)) return "paint";
  return null;
}
