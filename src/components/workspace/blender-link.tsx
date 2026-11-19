"use client";

import { Download, Loader2, Save } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  BLENDER_MESH_PREFIX,
  blenderLinked,
  clearBlenderNotes,
  getBlender,
  getServerBlender,
  markPulled,
  pullDesign,
  pullWasEmpty,
  pushDesign,
  refreshStatus,
  saveBlend,
  setBlenderOn,
  showBlenderNotes,
  subscribeBlender,
  syncBlenderProject,
  takePulled,
} from "@/lib/blender/client";
import { getActiveProjectId } from "@/lib/studio/cloud";
import { getBooth, subscribeBooth } from "@/lib/studio/local-booth";
import { getMesh } from "@/lib/studio/meshes";
import { designKey } from "@/lib/systems/costing";
import type { DesignDocument } from "@/lib/systems/modular/schema";

function blendName(file: string) {
  const base = file.split(/[/\\]/).pop()?.trim() ?? "";
  return base || "unsaved";
}

function meshMissing(document: DesignDocument) {
  return document.parts.some((part) => part.shape === "mesh" && part.meshId?.startsWith(BLENDER_MESH_PREFIX) && !getMesh(part.meshId));
}

/** One pull per five seconds, and only to store meshes that Blender already sent. */
function pullMissing(document: DesignDocument, lastAt: { current: number }) {
  if (!blenderLinked() || getBlender().busy || !meshMissing(document) || Date.now() - lastAt.current < 5000) return;
  lastAt.current = Date.now();
  void pullDesign(document, true);
}

export function BlenderLink({ document, onDocument }: { document: DesignDocument; onDocument: (next: DesignDocument) => void }) {
  const link = useSyncExternalStore(subscribeBlender, getBlender, getServerBlender);
  const projectId = useSyncExternalStore(subscribeBooth, getActiveProjectId, () => null);
  const seen = useRef(document);
  const meshPullAt = useRef(0);

  useEffect(() => {
    syncBlenderProject();
    if (!projectId || !getBlender().on) return;
    void refreshStatus();
  }, [projectId]);

  useEffect(() => {
    if (!link.on) return;
    const timer = window.setInterval(() => {
      void refreshStatus().then(() => pullMissing(getBooth(), meshPullAt));
    }, 4000);
    return () => window.clearInterval(timer);
  }, [link.on]);

  useEffect(() => {
    if (!link.on || !link.connected) return;
    const current = getBooth();
    seen.current = current;
    if (takePulled(current)) return;
    void pushDesign(current, true);
  }, [link.on, link.connected]);

  useEffect(() => {
    if (!link.on || !link.connected) return;
    if (takePulled(document) || seen.current === document) {
      seen.current = document;
      return;
    }
    seen.current = document;
    const timer = window.setTimeout(() => void pushDesign(document, false), 700);
    return () => window.clearTimeout(timer);
  }, [document, link.on, link.connected]);

  useEffect(() => {
    if (link.on && link.connected) pullMissing(document, meshPullAt);
  }, [document, link.on, link.connected]);

  useEffect(() => {
    if (link.notes.length === 0) return;
    const timer = window.setTimeout(() => clearBlenderNotes(), 8000);
    return () => window.clearTimeout(timer);
  }, [link.notes]);

  async function toggle() {
    const id = getActiveProjectId();
    if (!id) return;
    if (link.on) {
      setBlenderOn(id, false);
      return;
    }
    setBlenderOn(id, true);
    await refreshStatus();
  }

  async function pull() {
    const pulled = await pullDesign(document);
    if (pulled) {
      if (designKey(pulled) !== designKey(getBooth())) {
        markPulled(pulled);
        onDocument(pulled);
      }
      return;
    }
    if (!pullWasEmpty() || getBlender().error) return;
    showBlenderNotes(["Blender was empty, so the stand was sent to it."]);
    await pushDesign(getBooth(), true);
  }

  const dot = !link.on ? "bg-subtle" : link.connected ? "bg-success" : "bg-warn";
  const title = link.error || link.file || undefined;

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-0.5 rounded-lg border border-line bg-panel/90 p-0.5 shadow-soft backdrop-blur-md">
        <button
          type="button"
          aria-pressed={link.on}
          title={title}
          onClick={() => void toggle()}
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${link.on ? "bg-ink text-bg" : "text-muted hover:bg-raised hover:text-ink"}`}
        >
          {link.busy ? <Loader2 size={12} strokeWidth={2} className="animate-spin" aria-hidden="true" /> : <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />}
          Blender
        </button>
        {link.on && link.connected ? (
          <>
            <button type="button" title="Pull from Blender" aria-label="Pull from Blender" disabled={link.busy} onClick={() => void pull()} className="flex items-center rounded-md px-1.5 py-1 text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40">
              <Download size={12} strokeWidth={2} aria-hidden="true" />
            </button>
            <button type="button" title="Save the Blender file" aria-label="Save the Blender file" disabled={link.busy} onClick={() => void saveBlend()} className="flex items-center rounded-md px-1.5 py-1 text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40">
              <Save size={12} strokeWidth={2} aria-hidden="true" />
            </button>
            <span className="max-w-28 truncate px-1.5 text-[11px] text-muted" title={link.file || "unsaved"}>
              {blendName(link.file)}
            </span>
          </>
        ) : null}
      </div>
      {link.notes.length > 0 ? (
        <button type="button" onClick={() => clearBlenderNotes()} className="max-w-56 rounded-lg border border-line bg-panel/90 px-2 py-1.5 text-left text-[11px] leading-4 text-muted shadow-soft backdrop-blur-md">
          <ul>
            {link.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </button>
      ) : null}
    </div>
  );
}
