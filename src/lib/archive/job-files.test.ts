import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { jobFilePath, jobFilesAvailable, loadJob, saveDecision } from "./job-files";

const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EMAIL = "<pi@studio.local>";

let root = "";

function file(overrides: Record<string, unknown> = {}) {
  return {
    path: "technical/plan.pdf",
    name: "plan.pdf",
    kind: "technical",
    confidence: "high",
    sha1: SHA,
    bytes: 12,
    mediaType: "application/pdf",
    emails: [EMAIL],
    reasons: ["attached to the proforma"],
    skipped: null,
    ...overrides,
  };
}

function writeJob(folder: string, pi: string, files: Record<string, unknown>[]) {
  const dir = path.join(root, folder);
  mkdirSync(path.join(dir, "technical"), { recursive: true });
  writeFileSync(path.join(dir, "technical", "plan.pdf"), "not a real pdf");
  writeFileSync(path.join(dir, "technical", "extra.pdf"), "extra");
  const manifest = {
    pi,
    client: "Nestle",
    title: "Shelf dressing",
    date: "2024-03-01",
    folder,
    window: ["2024-01-01", "2024-04-01"],
    emails: [
      {
        id: EMAIL,
        mailbox: "INBOX",
        date: "2024-03-01T08:00:00.000Z",
        from: "Buyer <buyer@nestle.test>",
        to: "studio@proink.test",
        subject: pi,
        confidence: "high",
        reasons: ["subject mentions the PI"],
      },
    ],
    files,
  };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "proink-jobs-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("loadJob", () => {
  it("loads the folder whose manifest has that proforma and keeps valid decisions", () => {
    writeJob("broken", "PI0", [file()]);
    writeFileSync(path.join(root, "broken", "manifest.json"), "{");
    const dir = writeJob("nestle-shelf", "PI1", [file()]);
    writeJob("other", "PI2", [file({ sha1: OTHER, path: "technical/plan.pdf" })]);
    writeFileSync(
      path.join(dir, "decisions.json"),
      JSON.stringify({
        files: {
          [SHA]: { verdict: "keep", kind: "artwork", at: "2026-01-02T00:00:00.000Z" },
          nope: { verdict: "maybe" },
        },
      }),
    );

    expect(loadJob("PI9", root)).toBeNull();
    const loaded = loadJob("PI1", root);
    expect(loaded?.manifest.client).toBe("Nestle");
    expect(loaded?.manifest.files).toHaveLength(1);
    expect(loaded?.decisions.files[SHA]).toEqual({ verdict: "keep", kind: "artwork", at: "2026-01-02T00:00:00.000Z" });
    expect(loaded?.decisions.files.nope).toBeUndefined();
    expect(loaded?.decisions.emails).toEqual({});
    expect(loadJob("PI2", root)?.manifest.pi).toBe("PI2");
  });
});

describe("jobFilePath", () => {
  it("rejects absolute paths, parent segments, and anything outside the folder", () => {
    const outside = path.join(root, "secret.txt");
    writeFileSync(outside, "secret");
    const dir = writeJob("nestle-shelf", "PI1", [file(), file({ path: outside, name: "secret.txt", sha1: OTHER }), file({ path: "technical/linked.txt", name: "linked.txt", sha1: "cccccccccccccccccccccccccccccccccccccccc" })]);
    symlinkSync(outside, path.join(dir, "technical", "linked.txt"));

    expect(jobFilePath("PI1", outside, root)).toBeNull();
    expect(jobFilePath("PI1", "../secret.txt", root)).toBeNull();
    expect(jobFilePath("PI1", "technical/../../secret.txt", root)).toBeNull();
    expect(jobFilePath("PI1", "technical\\..\\..\\secret.txt", root)).toBeNull();
    expect(jobFilePath("PI1", "technical/plan.pdf\0.jpg", root)).toBeNull();
    expect(jobFilePath("PI1", "technical/linked.txt", root)).toBeNull();
    const found = jobFilePath("PI1", "technical/./plan.pdf", root);
    expect(found?.path).toBe(path.join(dir, "technical", "plan.pdf"));
    expect(found?.path.startsWith(dir + path.sep)).toBe(true);
  });

  it("rejects a file inside the folder that the manifest does not list", () => {
    writeJob("nestle-shelf", "PI1", [file()]);
    expect(jobFilePath("PI1", "technical/extra.pdf", root)).toBeNull();
    expect(jobFilePath("PI1", "technical/plan.pdf", root)?.name).toBe("plan.pdf");
  });
});

describe("saveDecision", () => {
  it("saves a decision, clears it, and leaves the rest of decisions.json in place", () => {
    const dir = writeJob("nestle-shelf", "PI1", [file()]);
    const kept = saveDecision("PI1", { sha1: SHA, verdict: "keep", kind: "technical" }, root);
    expect(kept.ok).toBe(true);
    const email = saveDecision("PI1", { emailId: EMAIL, verdict: "reject" }, root);
    expect(email.ok).toBe(true);
    if (!email.ok) return;
    expect(email.decisions.files[SHA]?.verdict).toBe("keep");
    expect(email.decisions.emails[EMAIL]?.verdict).toBe("reject");

    const cleared = saveDecision("PI1", { sha1: SHA, verdict: "clear" }, root);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.decisions.files[SHA]).toBeUndefined();
    expect(cleared.decisions.emails[EMAIL]?.verdict).toBe("reject");

    const onDisk = JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8")) as {
      files: Record<string, unknown>;
      emails: Record<string, { verdict: string }>;
    };
    expect(onDisk.files[SHA]).toBeUndefined();
    expect(onDisk.emails[EMAIL]?.verdict).toBe("reject");
    expect(loadJob("PI1", root)?.decisions.emails[EMAIL]?.verdict).toBe("reject");

    expect(saveDecision("PI1", { sha1: "missing", verdict: "keep" }, root)).toEqual({ ok: false, reason: "unknown" });
    expect(saveDecision("PI404", { sha1: SHA, verdict: "keep" }, root)).toEqual({ ok: false, reason: "missing" });
    const afterRefusal = JSON.parse(readFileSync(path.join(dir, "decisions.json"), "utf8")) as { emails: Record<string, { verdict: string }> };
    expect(afterRefusal.emails[EMAIL]?.verdict).toBe("reject");
  });
});

describe("jobFilesAvailable", () => {
  it("is false when the directory is missing and when running in production", () => {
    expect(jobFilesAvailable(path.join(root, "missing"))).toBe(false);
    expect(jobFilesAvailable(root)).toBe(true);
    const env = process.env as { NODE_ENV?: string };
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      expect(jobFilesAvailable(root)).toBe(false);
    } finally {
      env.NODE_ENV = previous;
    }
  });
});
