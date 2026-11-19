import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BufferGeometry } from "three";
import { parse } from "opentype.js";
import { buildLetterGeometry } from "@/lib/files/letter-geometry";

const font = parse(readFileSync("public/fonts/Roboto-Regular.ttf").buffer);

function frontCovers(geometry: BufferGeometry, x: number, y: number) {
  geometry.computeBoundingBox();
  const cap = geometry.boundingBox?.max.z ?? 0;
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const at = (cursor: number) => {
    const vertex = index ? index.getX(cursor) : cursor;
    return [position.getX(vertex), position.getY(vertex), position.getZ(vertex)] as const;
  };
  for (let cursor = 0; cursor < count; cursor += 3) {
    const a = at(cursor);
    const b = at(cursor + 1);
    const c = at(cursor + 2);
    if (a[2] < cap - 1e-5 || b[2] < cap - 1e-5 || c[2] < cap - 1e-5) continue;
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(area) < 1e-12) continue;
    const u = ((x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (y - a[1])) / area;
    const v = ((b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1])) / area;
    if (u >= -1e-4 && v >= -1e-4 && u + v <= 1 + 1e-4) return true;
  }
  return false;
}

describe("cut letters", () => {
  it("cuts S, I and C as outlines at the letter height and the sheet thickness", () => {
    const geometry = buildLetterGeometry(font, "S I C", 2000, 400, 10);
    expect(geometry).not.toBeNull();
    geometry!.computeBoundingBox();
    const box = geometry!.boundingBox!;
    expect(box.max.y - box.min.y).toBeCloseTo(0.4, 2);
    expect(box.max.z - box.min.z).toBeCloseTo(0.01, 3);
    expect(box.max.x - box.min.x).toBeLessThan(2);
    expect(geometry!.getAttribute("position").count).toBeGreaterThan(100);
    geometry!.dispose();
  });

  it("keeps the hole in O and the opening of C on the right", () => {
    const ring = buildLetterGeometry(font, "O", 400, 400, 10)!;
    const bar = buildLetterGeometry(font, "I", 400, 400, 10)!;
    const curve = buildLetterGeometry(font, "C", 400, 400, 10)!;
    expect(frontCovers(ring, 0, 0)).toBe(false);
    expect(frontCovers(bar, 0, 0)).toBe(true);
    curve.computeBoundingBox();
    const position = curve.getAttribute("position");
    let sum = 0;
    for (let index = 0; index < position.count; index += 1) sum += position.getX(index);
    expect(sum / position.count).toBeLessThan(0);
    ring.dispose();
    bar.dispose();
    curve.dispose();
  });
});
