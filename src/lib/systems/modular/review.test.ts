import { describe, expect, it } from "vitest";
import type { Inspection } from "../../ai/inspect";
import { seedCatalog } from "../catalog";
import { addParts, moveParts, setPartFlags, updateParts } from "./ops";
import { applyDesignPatch, createEmptyDesign } from "./patch";
import { produceDesign } from "./produce";
import { acceptFinding, reviewIssues, reviewKey, reviewState, setReview } from "./review";
import { openDesignDocument } from "./schema";
import { hasBlockingIssues } from "./validate";

const catalog = seedCatalog();
const when = new Date("2026-11-18T12:00:00.000Z");

const inspection: Inspection = {
  summary: "The top hooks stick out.",
  findings: [
    {
      id: "hooklong",
      severity: "serious",
      source: "design",
      pieces: ["hook"],
      problem: "The hook is longer than the stand is deep.",
      fix: "Use a shorter hook.",
    },
    {
      id: "shelfgap",
      severity: "check",
      source: "build",
      pieces: ["shelf"],
      problem: "The shelf spacing is tight.",
      fix: "Check the product height.",
    },
  ],
  questions: ["How heavy is one pack?"],
};

function stand() {
  return addParts(createEmptyDesign(), [
    { id: "shelf", name: "Shelf", shape: "box", x: 0, y: 800, z: 0, width: 400, height: 18, depth: 300, material: "mdf", color: "#dddddd" },
    { id: "hook", name: "Hook", shape: "box", kind: "equipment", x: 40, y: 900, z: 0, width: 6, height: 40, depth: 200, material: "metal" },
  ]).document;
}

describe("review key", () => {
  it("stays the same when a piece is renamed or recolored, and changes when the stand changes", () => {
    const document = stand();
    const key = reviewKey(document);
    const renamed = updateParts(document, ["shelf"], { name: "Top shelf", color: "#112233" });
    expect(reviewKey(renamed)).toBe(key);
    expect(reviewKey({ ...document, assembled: true })).not.toBe(key);
    expect(reviewKey(moveParts(document, ["hook"], { z: 20 }))).not.toBe(key);
    const hidden = setPartFlags(document, ["hook"], { hidden: true });
    expect(reviewKey(hidden)).not.toBe(key);
    expect(reviewKey(hidden)).toBe(reviewKey({ ...document, parts: document.parts.filter((part) => part.id !== "hook") }));
  });
});

describe("stored review", () => {
  it("keeps an accepted finding when the check is run again", () => {
    const first = setReview(stand(), inspection, when);
    const accepted = acceptFinding(first, "hooklong", true);
    expect(accepted.review?.findings.find((finding) => finding.id === "hooklong")?.accepted).toBe(true);
    const again = setReview(accepted, inspection, when);
    expect(again.review?.findings.find((finding) => finding.id === "hooklong")?.accepted).toBe(true);
    expect(again.review?.findings.find((finding) => finding.id === "shelfgap")?.accepted).toBeUndefined();
    expect(acceptFinding(accepted, "hooklong", false).review?.findings[0].accepted).toBeUndefined();
  });

  it("marks the check stale after the stand moves, and keeps it through a patch", () => {
    const reviewed = setReview(stand(), inspection, when);
    expect(reviewState(reviewed)).toEqual({ review: reviewed.review, stale: false });
    const patched = applyDesignPatch(reviewed, { envelope: { width: 2000 } });
    expect(patched.review).toEqual(reviewed.review);
    expect(reviewState(patched)?.stale).toBe(false);
    const moved = moveParts(reviewed, ["hook"], { x: 80 });
    expect(moved.review).toEqual(reviewed.review);
    expect(reviewState(moved)?.stale).toBe(true);
    expect(reviewState(createEmptyDesign())).toBeNull();
  });

  it("opens a job saved before the check existed", () => {
    const old = createEmptyDesign();
    expect(openDesignDocument(old).status).toBe("ready");
    const stored = JSON.parse(JSON.stringify(old)) as Record<string, unknown>;
    delete stored.review;
    expect(openDesignDocument(stored).status).toBe("ready");
    const reviewed = setReview(stand(), inspection, when);
    const opened = openDesignDocument(JSON.parse(JSON.stringify(reviewed)));
    expect(opened.status).toBe("ready");
    if (opened.status === "ready") expect(opened.document.review?.at).toBe(when.toISOString());
  });
});

describe("review issues", () => {
  it("maps findings to errors and warnings, and warns when an assembled stand was never checked", () => {
    const document = stand();
    expect(reviewIssues(document)).toEqual([]);
    expect(reviewIssues(setReview(createEmptyDesign(), inspection, when))).toEqual([]);
    expect(reviewIssues({ ...document, assembled: true })).toEqual([
      { severity: "warning", code: "review.missing", message: "The production check has not been run on this stand yet." },
    ]);
    expect(reviewIssues(setReview(document, { summary: "Fine.", findings: [], questions: [] }, when))).toEqual([]);

    const issues = reviewIssues(setReview(document, inspection, when));
    expect(issues.map((issue) => issue.severity)).toEqual(["error", "warning"]);
    expect(issues[0]).toMatchObject({
      code: "review.hooklong",
      message: "The hook is longer than the stand is deep.",
      fix: "Use a shorter hook.",
      findingId: "hooklong",
      pieces: ["hook"],
    });
    expect(issues[0].accepted).toBeUndefined();
    const accepted = reviewIssues(acceptFinding(setReview(document, inspection, when), "hooklong", true));
    expect(accepted[0]).toMatchObject({ severity: "warning", accepted: true, findingId: "hooklong" });
  });

  it("keeps a stale check as warnings", () => {
    const reviewed = setReview(stand(), inspection, when);
    const issues = reviewIssues(moveParts(reviewed, ["hook"], { x: 80 }));
    expect(issues[0]).toEqual({ severity: "warning", code: "review.stale", message: "The stand changed after the production check. Run the check again." });
    expect(issues.slice(1).every((issue) => issue.severity === "warning")).toBe(true);
    expect(issues.map((issue) => issue.code)).toEqual(["review.stale", "review.hooklong", "review.shelfgap"]);
  });

  it("blocks production files on an open serious finding and lets them through once it is accepted", () => {
    const reviewed = setReview({ ...stand(), assembled: true }, inspection, when);
    expect(hasBlockingIssues(produceDesign(reviewed, catalog).issues)).toBe(true);
    const accepted = acceptFinding(reviewed, "hooklong", true);
    expect(hasBlockingIssues(produceDesign(accepted, catalog).issues)).toBe(false);
    expect(produceDesign(stand(), catalog).issues.some((issue) => issue.code.startsWith("review."))).toBe(false);
  });
});
