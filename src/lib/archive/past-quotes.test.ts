import { describe, expect, it } from "vitest";
import { scorePastJobs } from "./past-quotes";

function record(pi: string, client: string, title: string, job: string, materials: string[], date: string | null) {
  return {
    pi,
    parsed: {
      ref: pi,
      date,
      client,
      title,
      transport: "included",
      jobs: [{ name: job, section: null, quantity: null, unitPrice: null, total: 100, sizes: [], materials }],
    },
  };
}

const nestle = record("PI1", "Nestle", "Aisle display", "Shelf dressing", ["printed vinyl", "display board"], "2024-03-01");
const ocp = record("PI2", "OCP", "Spinneys pillar", "3 sides visual", ["Plexi black", "display board"], "2024-12-10");
const treegroup = record("PI3", "Treegroup", "Hall delivery", "Transport run", ["truck", "display board"], "2025-06-12");
const records = [nestle, ocp, treegroup];

describe("scorePastJobs", () => {
  it("ranks a Nestle shelf dressing job first for a shelf query", () => {
    const found = scorePastJobs(records, "Nestle shelves dressing");
    expect(found[0]).toMatchObject({ client: "Nestle", job: "Shelf dressing" });
  });

  it("returns the OCP pillar job first for plexi pillar", () => {
    const found = scorePastJobs(records, "plexi pillar");
    expect(found[0]).toMatchObject({ client: "OCP", pi: "PI2" });
  });

  it("returns nothing when the query matches no job", () => {
    expect(scorePastJobs(records, "zzzz qq")).toEqual([]);
  });

  it("respects the limit", () => {
    expect(scorePastJobs(records, "display").length).toBeGreaterThan(1);
    expect(scorePastJobs(records, "display", 1)).toHaveLength(1);
  });

  it("skips records with a bad shape", () => {
    const mixed = [null, 1, "x", {}, { parsed: null }, { parsed: { jobs: null } }, { pi: "PI9", parsed: { jobs: [null, { total: 1 }] } }, nestle];
    expect(() => scorePastJobs(mixed, "Nestle shelves dressing")).not.toThrow();
    expect(scorePastJobs(mixed, "Nestle shelves dressing")).toHaveLength(1);
    expect(scorePastJobs(mixed, "Nestle shelves dressing")[0]?.client).toBe("Nestle");
  });

  it("prices build and mixed jobs, and treats a missing job type as build", () => {
    const build = { ...record("PI-build", "Acme", "Aisle display", "Shelf dressing", ["printed vinyl"], "2025-01-01"), jobType: "build" };
    const mixed = { ...record("PI-mixed", "Acme", "Aisle display", "Shelf dressing", ["printed vinyl"], "2025-02-01"), jobType: "mixed" };
    const bare = record("PI-bare", "Acme", "Aisle display", "Shelf dressing", ["printed vinyl"], "2025-03-01");
    const excluded = ["print", "installation", "transport", "maintenance", "rental", "other"].map((jobType) => ({
      ...record(`PI-${jobType}`, "Acme", "Aisle display", "Shelf dressing", ["printed vinyl"], "2026-01-01"),
      jobType,
    }));
    const found = scorePastJobs([bare, ...excluded, build, mixed], "Acme shelf dressing");
    expect(found.map((job) => job.pi).sort()).toEqual(["PI-bare", "PI-build", "PI-mixed"]);
  });

  it("ranks a newer proforma above an older one with the same words", () => {
    const older = record("PI2024", "Acme", "Shelf dressing", "Shelf dressing", ["printed vinyl"], "2024-05-01");
    const middle = record("PI2025", "Acme", "Shelf dressing", "Shelf dressing", ["printed vinyl"], "2025-05-01");
    const newer = record("PI2026", "Acme", "Shelf dressing", "Shelf dressing", ["printed vinyl"], "2026-05-01");
    const found = scorePastJobs([older, newer, middle], "Acme shelf dressing");
    expect(found.map((job) => job.pi)).toEqual(["PI2026", "PI2025", "PI2024"]);
    expect(found[0]?.score).toBeGreaterThan(found[1]?.score ?? 0);
    expect(found[1]?.score).toBeGreaterThan(found[2]?.score ?? 0);
  });

  it("keeps a stronger text match ahead of a newer weaker one", () => {
    const older = record("PI-old", "Acme", "Plexi pillar", "Plexi pillar", ["plexi", "vinyl"], "2024-01-01");
    const newer = record("PI-new", "Acme", "Shelf dressing", "Shelf dressing", ["vinyl"], "2026-06-01");
    const found = scorePastJobs([newer, older], "Acme plexi vinyl");
    expect(found[0]?.pi).toBe("PI-old");
  });

  it("skips problem rows when a clean row matches and ranks them when nothing else does", () => {
    const clean = record("PI-clean", "Acme", "Shelf dressing", "Shelf dressing", ["vinyl"], "2024-02-01");
    const bad = { ...record("PI-bad", "Acme", "Shelf dressing", "Shelf dressing", ["vinyl", "plexi"], "2026-08-01"), problems: ["does not add up"] };
    const oldBad = { ...record("PI-old-bad", "Acme", "Shelf dressing", "Shelf dressing", ["vinyl"], "2024-02-01"), problems: ["does not add up"] };
    expect(scorePastJobs([bad, clean], "Acme shelf vinyl").map((job) => job.pi)).toEqual(["PI-clean"]);
    expect(scorePastJobs([oldBad, bad], "Acme shelf vinyl").map((job) => job.pi)).toEqual(["PI-bad", "PI-old-bad"]);
  });

  it("skips rows that are not prices and jobs with no price", () => {
    const gift = { ...record("PI-gift", "Acme", "Shelf dressing", "Shelf dressing", ["vinyl"], "2025-01-01"), pricing: "none" };
    const base = record("PI-pkg", "Acme", "Shelf dressing", "Shelf dressing", ["vinyl"], "2025-01-01");
    const unpriced = { name: "Shelf dressing extra", section: null, quantity: null, unitPrice: null, total: null, sizes: [], materials: ["vinyl"] };
    const pkg = { ...base, pricing: "total", problems: ["a job has no price"], parsed: { ...base.parsed, jobs: [...base.parsed.jobs, unpriced] } };
    const found = scorePastJobs([gift, pkg], "Acme shelf dressing");
    expect(found.map((job) => job.job)).toEqual(["Shelf dressing"]);
    expect(found[0]?.note).toMatch(/package price/i);
  });

  it("says transportation is excluded when the proforma text says so", () => {
    const row = { ...record("PI-t", "Acme", "Shelf dressing", "Shelf dressing", ["vinyl"], "2025-01-01"), transportExcluded: true };
    expect(scorePastJobs([row], "Acme shelf dressing")[0]?.transport).toBe("transportation excluded");
  });
});
