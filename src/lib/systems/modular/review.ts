import type { Inspection } from "../../ai/inspect";
import type { ValidationIssue } from "../types";
import type { DesignDocument, Finding, ProductionReview, ScenePart } from "./schema";

const LOOKED_AT = ["id", "shape", "x", "y", "z", "width", "height", "depth", "rotation", "tilt", "material", "materialId", "kind", "outline", "chamfers", "corners", "holes", "curve", "round", "path"] as const;

/**
 * A short stable hash of the geometry the production check looked at.
 * A new name or a new color does not change it. Hiding a piece does.
 */
export function reviewKey(document: DesignDocument) {
  const parts = document.parts
    .filter((part) => !part.hidden)
    .map((part) => {
      const looked: Record<string, unknown> = {};
      for (const field of LOOKED_AT) looked[field] = part[field as keyof ScenePart];
      return stable(looked);
    })
    .sort((a, b) => String((a as { id?: unknown }).id).localeCompare(String((b as { id?: unknown }).id)));
  return fingerprint(JSON.stringify({ assembled: document.assembled === true, parts }));
}

/** Store the foreman's report on the stand it just looked at. A finding already accepted stays accepted. */
export function setReview(document: DesignDocument, inspection: Inspection, now = new Date()): DesignDocument {
  const accepted = new Set((document.review?.findings ?? []).filter((finding) => finding.accepted).map((finding) => finding.id));
  const findings = inspection.findings.slice(0, 12).map((finding) => (accepted.has(finding.id) ? { ...finding, accepted: true } : finding));
  const review: ProductionReview = {
    key: reviewKey(document),
    at: now.toISOString(),
    summary: inspection.summary,
    findings,
    questions: inspection.questions,
  };
  return { ...document, review };
}

/** Let a finding through, or take that back. The check itself is unchanged. */
export function acceptFinding(document: DesignDocument, id: string, accepted: boolean): DesignDocument {
  if (!document.review) return document;
  const findings = document.review.findings.map((finding) => {
    if (finding.id !== id) return finding;
    if (accepted) return { ...finding, accepted: true };
    const { accepted: _dropped, ...rest } = finding;
    void _dropped;
    return rest;
  });
  return { ...document, review: { ...document.review, findings } };
}

/** The stored check, and whether the stand has changed since it ran. */
export function reviewState(document: DesignDocument): { review: ProductionReview; stale: boolean } | null {
  if (!document.review) return null;
  return { review: document.review, stale: document.review.key !== reviewKey(document) };
}

/**
 * What the Check panel and the export gate see.
 * No pieces: nothing to check. An assembled stand with no check yet is a warning.
 * A serious finding that is still open blocks the production files. An accepted one does not.
 * After the stand changes, the old findings stay on screen as warnings until the check is run again.
 */
export function reviewIssues(document: DesignDocument): ValidationIssue[] {
  if (document.parts.length === 0) return [];
  const state = reviewState(document);
  if (!state) {
    if (!document.assembled) return [];
    return [{ severity: "warning", code: "review.missing", message: "The production check has not been run on this stand yet." }];
  }
  const findings = state.review.findings.map((finding) => findingIssue(finding, state.stale));
  if (!state.stale) return findings;
  return [{ severity: "warning", code: "review.stale", message: "The stand changed after the production check. Run the check again." }, ...findings];
}

function findingIssue(finding: Finding, stale: boolean): ValidationIssue {
  const accepted = finding.accepted === true;
  return {
    severity: !stale && finding.severity === "serious" && !accepted ? "error" : "warning",
    code: `review.${finding.id}`,
    message: finding.problem,
    fix: finding.fix,
    findingId: finding.id,
    pieces: finding.pieces,
    ...(accepted ? { accepted: true } : {}),
  };
}

/** Key order must not change the hash, and a missing field must hash the same as an absent one. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry) => entry[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries.map(([key, item]) => [key, stable(item)]));
}

/** Two FNV-1a passes, so the key is short and the same stand always gets the same one. No Node crypto: the Check panel runs this in the browser. */
function fingerprint(text: string) {
  return fnv(text, 0x811c9dc5) + fnv(text, 0x811c9dc5 ^ text.length);
}

function fnv(text: string, seed: number) {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
