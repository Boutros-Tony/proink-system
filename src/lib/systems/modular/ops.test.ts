import { describe, expect, it } from "vitest";
import { seedCatalog } from "../catalog";
import { applyTemplate, defaultValues, getTemplate, resolveValues, TEMPLATES } from "../templates";
import { commitHistory, createHistory, redoHistory, undoHistory } from "../../studio/history";
import { compileDesign } from "./compile";
import { planSvg, technicalSvg } from "./drawings";
import { partBounds, snapMove, unionBounds } from "./geometry";
import {
  addParts,
  alignParts,
  defaultPart,
  distributeParts,
  duplicateParts,
  expandToGroups,
  groupParts,
  moveParts,
  removeParts,
  rotateParts,
  scaleParts,
  setPartFlags,
  transformParts,
  ungroupParts,
  updateParts,
} from "./ops";
import { createEmptyDesign } from "./patch";
import { produceDesign } from "./produce";
import { openDesignDocument, type PartDraft } from "./schema";
import { hasBlockingIssues, validateDesign } from "./validate";

const catalog = seedCatalog();

function box(name: string, x: number, z: number, width = 100, depth = 100, height = 100): PartDraft {
  return { name, shape: "box", x, y: 0, z, width, height, depth };
}

function scene(...drafts: PartDraft[]) {
  return addParts(createEmptyDesign(), drafts);
}

describe("part operations", () => {
  it("adds pieces with unique ids and fits the envelope", () => {
    const { document, ids } = scene(box("Shelf", 0, 0), box("Shelf", 200, 0));
    expect(ids).toEqual(["shelf", "shelf-2"]);
    expect(document.envelope).toEqual({ width: 300, depth: 100, height: 100 });
  });

  it("moves pieces and never lets them leave the back-left floor corner", () => {
    const { document, ids } = scene(box("A", 100, 100));
    const moved = moveParts(document, ids, { x: -500, y: -50, z: 20 });
    expect(moved.parts[0]).toMatchObject({ x: 0, y: 0, z: 120 });
  });

  it("keeps the relative layout of a selection when it is clamped", () => {
    const { document, ids } = scene(box("A", 100, 0), box("B", 300, 0));
    const moved = moveParts(document, ids, { x: -250 });
    expect(moved.parts.map((part) => part.x)).toEqual([0, 200]);
  });

  it("skips locked pieces for moves, edits, and deletes", () => {
    const { document, ids } = scene(box("A", 0, 0), box("B", 200, 0));
    const locked = setPartFlags(document, [ids[0]], { locked: true });
    const moved = moveParts(locked, ids, { x: 50 });
    expect(moved.parts.map((part) => part.x)).toEqual([0, 250]);
    expect(updateParts(locked, ids, { height: 999 }).parts.map((part) => part.height)).toEqual([100, 999]);
    expect(removeParts(locked, ids).parts.map((part) => part.id)).toEqual([ids[0]]);
    const open = setPartFlags(locked, [ids[0]], { locked: false });
    expect(open.parts[0].locked).toBeUndefined();
  });

  it("rounds the front corners of a box and drops a radius that does not fit", () => {
    const { document, ids } = scene(box("Strip", 0, 0, 1000, 18, 40));
    const rounded = updateParts(document, [ids[0]], { corners: { topLeft: 10, topRight: 10 } });
    expect(rounded.parts[0].corners).toEqual({ topLeft: 10, topRight: 10 });
    const cleared = updateParts(rounded, [ids[0]], { corners: { topLeft: 0, topRight: 0 } });
    expect(cleared.parts[0].corners).toBeUndefined();
    const huge = updateParts(document, [ids[0]], { corners: { topLeft: 100, topRight: 100 } });
    expect(huge.parts[0].corners?.topLeft).toBeCloseTo(40);
    expect(huge.parts[0].corners?.topRight).toBeCloseTo(40);
  });

  it("slopes a panel with a straight cut and drops the radius on that corner", () => {
    const { document, ids } = scene(box("Side", 0, 0, 400, 18, 1200));
    const cut = updateParts(document, [ids[0]], { corners: { topRight: 40 }, chamfers: { topRight: { x: 400, y: 300 } } });
    expect(cut.parts[0].chamfers?.topRight).toEqual({ x: 400, y: 300 });
    expect(cut.parts[0].corners).toBeUndefined();
  });

  it("rotates a single piece about its own center", () => {
    const { document, ids } = scene(box("Panel", 0, 0, 400, 100));
    const turned = rotateParts(document, ids, 90);
    const part = turned.parts[0];
    expect(part.rotation).toBe(90);
    const bounds = partBounds(part);
    expect(bounds.maxX - bounds.minX).toBeCloseTo(100, 6);
    expect(bounds.maxZ - bounds.minZ).toBeCloseTo(400, 6);
    expect(bounds.minX).toBeGreaterThanOrEqual(-1e-9);
    expect(bounds.minZ).toBeGreaterThanOrEqual(-1e-9);
  });

  it("rotates a selection about its shared center", () => {
    const { document, ids } = scene(box("A", 0, 0), box("B", 300, 0));
    const turned = rotateParts(document, ids, 90);
    const bounds = unionBounds(turned.parts);
    expect(bounds && bounds.maxX - bounds.minX).toBeCloseTo(100, 6);
    expect(bounds && bounds.maxZ - bounds.minZ).toBeCloseTo(400, 6);
    expect(turned.parts.every((part) => part.rotation === 90)).toBe(true);
  });

  it("scales a piece about its center and keeps it on the floor", () => {
    const { document, ids } = scene(box("A", 100, 100, 200, 200, 200));
    const bigger = scaleParts(document, ids, { x: 2, y: 0.5, z: 1 });
    expect(bigger.parts[0]).toMatchObject({ x: 0, y: 0, z: 100, width: 400, depth: 200, height: 100 });
  });

  it("keeps a cylinder round when it is resized", () => {
    const { document, ids } = scene({ name: "Pole", shape: "cylinder", x: 0, y: 0, z: 0, width: 100, height: 500, depth: 100 });
    const wider = updateParts(document, ids, { width: 250 });
    expect(wider.parts[0]).toMatchObject({ width: 250, depth: 250 });
    const scaled = scaleParts(wider, ids, { x: 2, y: 1, z: 5 });
    expect(scaled.parts[0]).toMatchObject({ width: 500, depth: 500 });
  });

  it("previews a drag with the same function that commits it", () => {
    const { document, ids } = scene(box("A", 100, 100));
    const preview = transformParts(document.parts, ids, { kind: "move", x: 30, y: 0, z: 0 });
    const committed = moveParts(document, ids, { x: 30 });
    expect(preview[0].x).toBe(committed.parts[0].x);
  });

  it("duplicates pieces with new ids and a new group", () => {
    const first = scene(box("A", 0, 0), box("B", 200, 0));
    const grouped = groupParts(first.document, first.ids, "Pair");
    expect(grouped.group).toBe("pair");
    const copy = duplicateParts(grouped.document, first.ids);
    expect(copy.document.parts).toHaveLength(4);
    expect(copy.ids).toEqual(["a-2", "b-2"]);
    const groups = new Set(copy.document.parts.map((part) => part.group));
    expect(groups.size).toBe(2);
    expect(Object.keys(copy.document.groups ?? {})).toHaveLength(2);
  });

  it("selects the whole group when one member is picked, and ungroups it", () => {
    const first = scene(box("A", 0, 0), box("B", 200, 0), box("C", 400, 0));
    const { document } = groupParts(first.document, [first.ids[0], first.ids[1]]);
    expect(expandToGroups(document, [first.ids[0]])).toEqual([first.ids[0], first.ids[1]]);
    const loose = ungroupParts(document, [first.ids[0]]);
    expect(loose.parts.every((part) => part.group === undefined)).toBe(true);
    expect(loose.groups).toBeUndefined();
  });

  it("aligns and distributes pieces", () => {
    const first = scene(box("A", 0, 0, 100, 100), box("B", 250, 40, 100, 100), box("C", 500, 90, 100, 100));
    const aligned = alignParts(first.document, first.ids, "z", "min");
    expect(aligned.parts.map((part) => part.z)).toEqual([0, 0, 0]);
    const even = distributeParts(first.document, first.ids, "x");
    expect(even.parts.map((part) => part.x)).toEqual([0, 250, 500]);
    const uneven = scene(box("A", 0, 0), box("B", 100, 0), box("C", 600, 0));
    expect(distributeParts(uneven.document, uneven.ids, "x").parts.map((part) => part.x)).toEqual([0, 300, 600]);
  });

  it("places a new piece beside what is already drawn", () => {
    const { document } = scene(box("A", 0, 0, 500, 500));
    const next = defaultPart(document, "box");
    expect(next.x).toBe(800);
  });

  it("drops groups that no longer have members", () => {
    const first = scene(box("A", 0, 0), box("B", 200, 0));
    const { document } = groupParts(first.document, first.ids);
    const emptied = removeParts(document, first.ids);
    expect(emptied.groups).toBeUndefined();
  });

  it("accepts documents saved before rotation and groups existed", () => {
    const old = {
      schemaVersion: 1,
      system: "modular_exhibition",
      units: "mm",
      envelope: { width: 1200, depth: 1200, height: 750 },
      module: 1000,
      walls: ["back", "left", "right", "front"].map((edge) => ({ edge, bays: [] })),
      features: [],
      parts: [{ id: "top", name: "Top", shape: "cylinder", x: 0, y: 720, z: 0, width: 1200, height: 30, depth: 1200 }],
    };
    expect(openDesignDocument(old).status).toBe("ready");
  });
});

describe("snapping", () => {
  const moving = { minX: 0, maxX: 100, minY: 0, maxY: 100, minZ: 0, maxZ: 100 };
  const neighbour = { minX: 300, maxX: 500, minY: 0, maxY: 100, minZ: 0, maxZ: 100 };

  it("snaps to the grid by the leading face", () => {
    const delta = snapMove(moving, { x: 123, y: 0, z: 17 }, [], { grid: 50, magnet: 0 });
    expect(delta).toEqual({ x: 100, y: 0, z: 0 });
  });

  it("sticks to the face of a nearby piece", () => {
    const delta = snapMove(moving, { x: 192, y: 0, z: 0 }, [neighbour], { grid: 50, magnet: 20 });
    expect(delta.x).toBe(200);
  });

  it("ignores faces that are out of reach and falls back to the grid", () => {
    const delta = snapMove(moving, { x: 140, y: 0, z: 0 }, [neighbour], { grid: 50, magnet: 20 });
    expect(delta.x).toBe(150);
  });

  it("does nothing when both snaps are off", () => {
    expect(snapMove(moving, { x: 12.3, y: 0, z: 4.5 }, [neighbour], { grid: 0, magnet: 0 })).toEqual({ x: 12.3, y: 0, z: 4.5 });
  });
});

describe("history", () => {
  it("undoes and redoes", () => {
    let history = createHistory("a");
    history = commitHistory(history, "b");
    history = commitHistory(history, "c");
    history = undoHistory(history);
    expect(history.present).toBe("b");
    history = undoHistory(history);
    history = undoHistory(history);
    expect(history.present).toBe("a");
    history = redoHistory(history);
    expect(history.present).toBe("b");
  });

  it("drops the redo stack on a new edit and ignores unchanged documents", () => {
    let history = createHistory("a");
    history = commitHistory(history, "b");
    history = undoHistory(history);
    const same = commitHistory(history, "a");
    expect(same).toBe(history);
    history = commitHistory(history, "x");
    expect(history.future).toEqual([]);
  });

  it("joins quick edits that share a key into one undo step", () => {
    let history = createHistory(0);
    history = commitHistory(history, 1, { key: "nudge", now: 1000 });
    history = commitHistory(history, 2, { key: "nudge", now: 1200 });
    history = commitHistory(history, 3, { key: "nudge", now: 1300 });
    expect(history.past).toEqual([0]);
    history = commitHistory(history, 4, { key: "nudge", now: 5000 });
    expect(history.past).toEqual([0, 3]);
  });
});

describe("templates", () => {
  it("every template builds with its defaults", () => {
    for (const template of TEMPLATES) {
      const { document } = applyTemplate(createEmptyDesign(), template, defaultValues(template));
      expect(openDesignDocument(document).status, template.id).toBe("ready");
      const production = produceDesign(document, catalog);
      expect(hasBlockingIssues(production.issues), `${template.id}: ${production.issues.map((issue) => issue.message).join("; ")}`).toBe(false);
      expect(() => compileDesign(document)).not.toThrow();
      expect(planSvg(document, compileDesign(document))).toContain("<svg");
      expect(technicalSvg(document, compileDesign(document))).toContain("<svg");
    }
  });

  it("clamps and snaps typed values to each parameter", () => {
    const counter = getTemplate("reception-counter");
    if (!counter) throw new Error("missing template");
    const values = resolveValues(counter, { width: 99999, depth: 612, height: -5, plinth: "x" as unknown as number });
    expect(values).toEqual({ width: 4000, depth: 610, height: 700, plinth: 80 });
  });

  it("builds a counter as separate panels inside its size", () => {
    const counter = getTemplate("reception-counter");
    if (!counter) throw new Error("missing template");
    const { document } = applyTemplate(createEmptyDesign(), counter, { width: 1500, depth: 600, height: 1050 });
    expect(document.parts).toHaveLength(6);
    expect(document.envelope).toEqual({ width: 1500, depth: 600, height: 1050 });
    expect(new Set(document.parts.map((part) => part.group)).size).toBe(1);
    expect(Object.values(document.groups ?? {})).toEqual(["Reception counter"]);
  });

  it("spaces the shelves evenly", () => {
    const shelving = getTemplate("shelving-unit");
    if (!shelving) throw new Error("missing template");
    const { document } = applyTemplate(createEmptyDesign(), shelving, { width: 900, height: 1800, depth: 350, shelves: 3 });
    const shelves = document.parts.filter((part) => part.name.startsWith("Shelf"));
    expect(shelves).toHaveLength(3);
    const gaps = shelves.map((shelf, index) => shelf.y - (index === 0 ? 18 : shelves[index - 1].y + 18));
    expect(gaps[0]).toBeCloseTo(gaps[1], 6);
    expect(gaps[1]).toBeCloseTo(gaps[2], 6);
    expect(document.envelope.height).toBe(1800);
  });

  it("adds a piece template next to existing pieces as a movable group", () => {
    const table = getTemplate("round-table");
    const plinth = getTemplate("display-plinth");
    if (!table || !plinth) throw new Error("missing template");
    const first = applyTemplate(createEmptyDesign(), table, { diameter: 1000 });
    const second = applyTemplate(first.document, plinth, { width: 400, depth: 400, height: 500 }, "add");
    expect(second.document.parts).toHaveLength(4);
    const added = second.document.parts.find((part) => part.id === second.ids[0]);
    expect(added?.x).toBe(1300);
    expect(expandToGroups(second.document, [first.ids[0]])).toEqual(first.ids);
  });

  it("replaces the canvas when asked, and keeps booth templates valid", () => {
    const booth = getTemplate("corner-booth");
    const table = getTemplate("round-table");
    if (!booth || !table) throw new Error("missing template");
    const built = applyTemplate(createEmptyDesign(), booth, { width: 4000, depth: 3000, fascia: 1, counter: 1, spots: 1 });
    expect(hasBlockingIssues(validateDesign(built.document, catalog))).toBe(false);
    expect(built.document.walls.find((wall) => wall.edge === "right")?.bays.every((bay) => bay.kind === "open")).toBe(true);
    const replaced = applyTemplate(built.document, table, {}, "replace");
    expect(replaced.document.walls.every((wall) => wall.bays.length === 0)).toBe(true);
    expect(replaced.document.parts).toHaveLength(3);
  });

  it("lets custom pieces sit inside a booth", () => {
    const booth = getTemplate("inline-booth");
    const shelving = getTemplate("shelving-unit");
    if (!booth || !shelving) throw new Error("missing template");
    const built = applyTemplate(createEmptyDesign(), booth, defaultValues(booth)).document;
    const { document } = applyTemplate(built, shelving, {}, "add");
    const part = document.parts[0];
    expect(part.x).toBeGreaterThan(0);
    expect(document.envelope).toEqual(built.envelope);
    const issues = validateDesign(document, catalog);
    // Every piece material has a price in the starting book, so nothing is left unpriced.
    expect(issues.some((issue) => issue.code === "parts.unpriced")).toBe(false);
    expect(hasBlockingIssues(issues)).toBe(false);
  });
});
