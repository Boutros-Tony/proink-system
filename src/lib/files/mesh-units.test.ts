import { describe, expect, it } from "vitest";
import { guessMaterial, millimetersPerUnit, unitLabel } from "./mesh-units";

describe("mesh units", () => {
  it("reads glTF as meters", () => {
    expect(millimetersPerUnit("glb", 4)).toBe(1000);
    expect(millimetersPerUnit("gltf", 4000)).toBe(1000);
  });

  it("guesses meters, centimeters, then millimeters for files without a unit", () => {
    expect(millimetersPerUnit("obj", 6)).toBe(1000);
    expect(millimetersPerUnit("stl", 80)).toBe(10);
    expect(millimetersPerUnit("obj", 4000)).toBe(1);
  });

  it("names the unit it chose", () => {
    expect(unitLabel(1000)).toBe("meters");
    expect(unitLabel(10)).toBe("centimeters");
    expect(unitLabel(1)).toBe("millimeters");
  });
});

describe("material names from a 3D file", () => {
  it("maps known words onto shop materials", () => {
    expect(guessMaterial("Brushed aluminium")).toBe("metal");
    expect(guessMaterial("Oak veneer")).toBe("wood");
    expect(guessMaterial("Clear glass")).toBe("glass");
    expect(guessMaterial("White laminate")).toBe("laminate");
    expect(guessMaterial("18mm MDF")).toBe("mdf");
  });

  it("leaves an unknown name for the estimator", () => {
    expect(guessMaterial("Material.004")).toBeNull();
    expect(guessMaterial(undefined)).toBeNull();
  });
});
