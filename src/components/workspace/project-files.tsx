"use client";

import { Download, FolderOpen, Loader2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { buildExportScene, exportGlb } from "@/lib/files/export-glb";
import { loadLetterFont } from "@/lib/files/letter-geometry";
import { buildProjectZip, openDesignFile, openProjectArchive, projectKind, type OpenedProject } from "@/lib/files/project-file";
import { getAssets } from "@/lib/studio/assets";
import { getMesh } from "@/lib/studio/meshes";
import type { Costing } from "@/lib/systems/costing";
import type { CompiledModel } from "@/lib/systems/modular/compile";
import type { DesignDocument } from "@/lib/systems/modular/schema";

/** Save the stand as one folder, open a saved folder, or add a 3D file. */
export function ProjectFiles({
  document,
  model,
  costing,
  jobTitle,
  onOpenProject,
  onAddModel,
}: {
  document: DesignDocument;
  model: CompiledModel;
  costing: Costing;
  jobTitle: string;
  /** Replace the whole stand with a saved one. */
  onOpenProject: (project: OpenedProject) => Promise<void>;
  /** Add a 3D file's pieces to the stand. Resolves to a sentence about what was added. */
  onAddModel: (file: File) => Promise<string>;
}) {
  const [busy, setBusy] = useState<"export" | "open" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<OpenedProject | null>(null);

  async function exportFolder() {
    setBusy("export");
    setError(null);
    setNote(null);
    try {
      let letterFont = null;
      try {
        letterFont = await loadLetterFont();
      } catch {
        letterFont = null;
      }
      const built = buildExportScene(model, document.envelope, getMesh, letterFont);
      let glb: ArrayBuffer | null = null;
      let modelFailed = false;
      try {
        glb = await exportGlb(built);
      } catch {
        modelFailed = true;
      }
      const result = await buildProjectZip({ title: jobTitle, document, costing, glb, assets: getAssets(), findMesh: getMesh });
      const url = URL.createObjectURL(new Blob([result.bytes as BlobPart], { type: "application/zip" }));
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${result.folder}.zip`;
      link.click();
      URL.revokeObjectURL(url);
      const parts = [`Saved ${result.folder}.zip.`];
      if (result.pictures > 0) parts.push(`${result.pictures} ${result.pictures === 1 ? "picture" : "pictures"} inside.`);
      if (result.meshes > 0) parts.push(`${result.meshes} imported 3D ${result.meshes === 1 ? "piece" : "pieces"} inside.`);
      if (modelFailed) parts.push("The 3D model file could not be written, but the design can still be opened again.");
      if (result.missing > 0) parts.push(`${result.missing} ${result.missing === 1 ? "item was" : "items were"} not found and left out.`);
      setNote(parts.join(" "));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The folder could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function openFile(file: File) {
    setBusy("open");
    setError(null);
    setNote(null);
    setWaiting(null);
    try {
      const kind = projectKind(file.name);
      if (kind === "other") {
        setNote(await onAddModel(file));
        return;
      }
      const opened = kind === "zip" ? await openProjectArchive(file) : await openDesignFile(file);
      setWaiting(opened);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The file could not be opened.");
    } finally {
      setBusy(null);
    }
  }

  async function confirmOpen() {
    if (!waiting) return;
    setBusy("open");
    try {
      await onOpenProject(waiting);
      setNote([`Opened ${waiting.name}.`, ...waiting.warnings].join(" "));
      setWaiting(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The file could not be opened.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-2 border-t border-line pt-4">
      <p className="eyebrow">Stand file</p>
      <button type="button" disabled={busy !== null} onClick={() => void exportFolder()} className="btn btn-secondary w-full py-2.5">
        {busy === "export" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Download size={15} strokeWidth={2.25} aria-hidden="true" />}
        {busy === "export" ? "Saving" : "Save stand (.zip)"}
      </button>
      <label
        className={`btn btn-secondary w-full cursor-pointer py-2.5 ${busy !== null ? "pointer-events-none opacity-50" : ""}`}
        title="Open a saved folder (.zip), a design file (.json), or add a 3D file"
      >
        {busy === "open" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <FolderOpen size={15} strokeWidth={2.25} aria-hidden="true" />}
        Open file
        <input
          type="file"
          accept=".zip,.json,.glb,.gltf,.obj,.stl"
          className="sr-only"
          disabled={busy !== null}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void openFile(file);
          }}
        />
      </label>
      <p className="text-xs leading-5 text-muted">
        Saves one zip with the design, its pictures, imported pieces, and a 3D model (.glb) for Blender or Rhino. Open it here later to get the same stand back. A .glb, OBJ, or STL file is added to the stand.
      </p>
      {waiting ? (
        <div className="rounded-xl border border-accent-line bg-accent-soft px-3 py-3 text-xs leading-5 text-ink">
          <p className="font-medium">Open {waiting.name}?</p>
          <p className="mt-0.5 text-muted">
            This replaces the stand on the canvas. Undo brings the design back. Prices for this job are replaced too.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button type="button" disabled={busy !== null} onClick={() => void confirmOpen()} className="btn btn-primary flex-1 py-2">
              Open
            </button>
            <button type="button" onClick={() => setWaiting(null)} className="btn btn-ghost flex-1 py-2">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      {note ? <p className="rounded-xl border border-line bg-raised px-3 py-2.5 text-xs leading-5 text-muted">{note}</p> : null}
      {error ? (
        <p className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-soft px-3 py-2.5 text-xs leading-5 text-danger">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
    </section>
  );
}
