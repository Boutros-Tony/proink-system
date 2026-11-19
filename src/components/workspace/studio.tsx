"use client";

import {
  Aperture,
  Box,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileClock,
  FileText,
  FolderOpen,
  Gauge,
  Grid2x2,
  Eraser,
  Lamp,
  Layers,
  LayoutTemplate,
  Lightbulb,
  ListChecks,
  Loader2,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Receipt,
  RectangleHorizontal,
  Ruler,
  Scissors,
  SlidersHorizontal,
  SquarePen,
  Table2,
  TriangleAlert,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { BlenderLink } from "@/components/workspace/blender-link";
import { CheckPanel } from "@/components/workspace/check-panel";
import { CostPanel } from "@/components/workspace/cost-panel";
import { ChatConversation, ChatList, ChatProvider, readSimulation, useChatStudio, type ChatPanel } from "@/components/workspace/chat-panel";
import { EditPanel } from "@/components/workspace/edit-panel";
import { EditorToolbar } from "@/components/workspace/editor-toolbar";
import { DEFAULT_SNAP, type GizmoMode, type PickModifiers, type SnapSetting } from "@/components/workspace/editor-types";
import { SelectField, NumberField } from "@/components/workspace/fields";
import { CuttingPreview } from "@/components/workspace/cutting-preview";
import { DrawingsPreview, QuotePreview, SimulationPreview, type DrawingSheet } from "@/components/workspace/preview";
import { ProjectFiles } from "@/components/workspace/project-files";
import { TemplatesPanel } from "@/components/workspace/templates-panel";
import { ThemeToggle } from "@/components/workspace/theme-toggle";
import {
  getBooth,
  getServerBooth,
  redoBooth,
  setBooth,
  subscribeBooth,
  undoBooth,
} from "@/lib/studio/local-booth";
import { getAssets, restoreAssets } from "@/lib/studio/assets";
import { getCosting, getServerCosting, setCosting, subscribeCosting } from "@/lib/studio/costing";
import { saveMeshes } from "@/lib/studio/meshes";
import { issueQuote } from "@/lib/studio/quotes";
import { getJob, getServerJob, setJob, subscribeJob } from "@/lib/studio/job";
import { createClient } from "@/lib/supabase/client";
import { getServerSimulation, getSimulation, subscribeSimulation } from "@/lib/studio/simulation";
import { ClientPicker, NO_CLIENT, type ChatClient } from "@/components/workspace/client-picker";
import { addModelFile } from "@/lib/files/add-model";
import type { OpenedProject } from "@/lib/files/project-file";
import { providerById } from "@/lib/ai/models";
import { jobBrief } from "@/lib/ai/job-brief";
import { formatCents } from "@/lib/format";
import { getPriceBook, getServerPriceBook, subscribePriceBook } from "@/lib/studio/price-book";
import { getSelection, getServerSelection, setSelection, subscribeSelection } from "@/lib/studio/selection";
import { seedCatalog } from "@/lib/systems/catalog";
import { applyCosting } from "@/lib/systems/costing";
import { compileDesign } from "@/lib/systems/modular/compile";
import {
  applyTransform,
  duplicateParts,
  editableIds,
  expandToGroups,
  groupParts,
  moveParts,
  removeParts,
  renameGroup,
  ungroupParts,
  updateParts,
  type Transform,
} from "@/lib/systems/modular/ops";
import { applyDesignPatch, createEmptyDesign, setBayKind } from "@/lib/systems/modular/patch";
import { produceDesign } from "@/lib/systems/modular/produce";
import { EDGES, type Bay, type DesignDocument, type EdgeId } from "@/lib/systems/modular/schema";
import { hasBlockingIssues } from "@/lib/systems/modular/validate";
import { clientSections, quoteTotals } from "@/lib/systems/sections";
import type { Template, TemplateResult } from "@/lib/systems/templates";

const Viewport = dynamic(() => import("@/components/workspace/viewport"), {
  ssr: false,
  loading: () => <div className="h-full bg-raised" />,
});

type ViewMode = "perspective" | "plan" | "front" | "render";
/** What can open beside the chat. Nothing opens by itself: the user picks it from the job list. */
type Pane = "price" | "quote" | "boards" | "drawings" | "model" | "checks" | "files" | "simulation";
type DrawerTool = "edit" | "templates" | "booth";

const VIEW_LABEL: Record<ViewMode, string> = {
  perspective: "3D",
  plan: "Top",
  front: "Front",
  render: "Render",
};

const VIEW_ICON: Record<ViewMode, LucideIcon> = {
  perspective: Box,
  plan: Grid2x2,
  front: RectangleHorizontal,
  render: Aperture,
};

const DRAWER_TABS: { id: DrawerTool; label: string; Icon: LucideIcon }[] = [
  { id: "edit", label: "Elements", Icon: SlidersHorizontal },
  { id: "templates", label: "Templates", Icon: LayoutTemplate },
  { id: "booth", label: "Frame", Icon: Box },
];

const BAY_DOT: Record<Bay["kind"], string> = {
  graphic: "bg-accent",
  solid: "bg-subtle",
  open: "border border-line-strong bg-panel",
  door: "bg-[#f0a43a]",
};

const EMPTY_IDS: string[] = [];

const drawerListeners = new Set<() => void>();

function subscribeDrawer(listener: () => void) {
  drawerListeners.add(listener);
  return () => {
    drawerListeners.delete(listener);
  };
}

function readDrawerOpen() {
  if (typeof window === "undefined") return true;
  return window.localStorage.getItem("proink.drawerOpen") !== "false";
}

function writeDrawerOpen(open: boolean) {
  window.localStorage.setItem("proink.drawerOpen", String(open));
  drawerListeners.forEach((listener) => listener());
}

function subscribeFullscreenSupport() {
  return () => {};
}

function fullscreenSupported() {
  return typeof HTMLElement !== "undefined" && typeof HTMLElement.prototype.requestFullscreen === "function";
}

function commit(next: DesignDocument, key?: string) {
  setBooth(next, key ? { key } : undefined);
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

type Actions = { openPanel: (panel: ChatPanel) => void; newChat: () => void };

export default function Studio() {
  const document = useSyncExternalStore(subscribeBooth, getBooth, getServerBooth);
  // The chat lives above the workspace, so the workspace hands its handlers up through this ref.
  const actions = useRef<Actions>({ openPanel: () => {}, newChat: () => {} });
  return (
    <ChatProvider
      onDocument={setBooth}
      onFocus={() => {}}
      onNewChat={() => actions.current.newChat()}
      onOpenPanel={(panel) => actions.current.openPanel(panel)}
      sceneEmpty={document.parts.length === 0 && document.walls.every((wall) => wall.bays.length === 0)}
    >
      <Workspace actionsRef={actions} />
    </ChatProvider>
  );
}

function Workspace({ actionsRef }: { actionsRef: RefObject<Actions> }) {
  const chat = useChatStudio();
  const document = useSyncExternalStore(subscribeBooth, getBooth, getServerBooth);
  const rawSelection = useSyncExternalStore(subscribeSelection, getSelection, getServerSelection);
  const priceBook = useSyncExternalStore(subscribePriceBook, getPriceBook, getServerPriceBook);
  const costing = useSyncExternalStore(subscribeCosting, getCosting, getServerCosting);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [railPinned, setRailPinned] = useState(false);
  const [pane, setPane] = useState<Pane | null>(null);
  const [drawerTool, setDrawerTool] = useState<DrawerTool>("edit");
  const drawerOpen = useSyncExternalStore(subscribeDrawer, readDrawerOpen, () => true);
  const viewportBox = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const canFullscreen = useSyncExternalStore(subscribeFullscreenSupport, fullscreenSupported, () => false);

  const [view, setView] = useState<ViewMode>("perspective");
  const [mode, setMode] = useState<GizmoMode>("move");
  const [snap, setSnap] = useState<SnapSetting>(DEFAULT_SNAP);
  const [explode, setExplode] = useState(0);

  const job = useSyncExternalStore(subscribeJob, getJob, getServerJob);
  const client = job.client;
  const margin = job.margin;
  const setClient = (next: ChatClient) => setJob({ client: next });
  const setMargin = (next: number) => setJob({ margin: next });
  const jobTitle = client.name || "Exhibition booth";
  const [fileError, setFileError] = useState<string | null>(null);
  const [filePending, setFilePending] = useState<"quote" | "pdf" | "dxf" | null>(null);
  const [sheet, setSheet] = useState<DrawingSheet>("technical");

  const partIdSet = useMemo(() => new Set(document.parts.map((part) => part.id)), [document.parts]);
  const selection = useMemo(
    () => rawSelection.filter((id) => partIdSet.has(id) || id.startsWith("panel:")),
    [rawSelection, partIdSet],
  );
  useEffect(() => {
    if (selection.length !== rawSelection.length) setSelection(selection);
  }, [selection, rawSelection]);

  useEffect(() => {
    const root = window.document;
    function onFullscreenChange() {
      setFullscreen(root.fullscreenElement === viewportBox.current);
    }
    root.addEventListener("fullscreenchange", onFullscreenChange);
    return () => root.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const model = useMemo(() => compileDesign(document), [document]);
  const production = useMemo(() => produceDesign(document, seedCatalog(), priceBook), [document, priceBook]);
  const blocked = hasBlockingIssues(production.issues);
  const blockedHint = "Fix the errors in Checks first. The production check blocks these files until a serious finding is fixed or accepted.";
  const errorCount = production.issues.filter((issue) => issue.severity === "error").length;
  const costed = useMemo(() => applyCosting(production.lines, costing), [production.lines, costing]);

  const hasSuggestedCosts = (costing.review?.suggestions.length ?? 0) > 0;
  const isPriced = costed.lines.length > 0 || hasSuggestedCosts;
  // A new chat is only the composer. The job panel appears once the conversation starts, or something is opened.
  const started = chat.messages.length > 0 || pane !== null;
  const railShown = railOpen && (started || railPinned);

  const totalCents = useMemo(
    () => quoteTotals(clientSections(document, costed.lines, margin, costing.quote, costing.sections), 0).sellCents,
    [document, costed.lines, margin, costing.quote, costing.sections],
  );
  const totalBoards = useMemo(
    () => production.cutting.groups.reduce((sum, group) => sum + group.boards.length, 0),
    [production.cutting.groups],
  );

  const selectedParts = useMemo(() => document.parts.filter((part) => selection.includes(part.id)), [document.parts, selection]);
  const selectedPartIds = useMemo(() => selectedParts.map((part) => part.id), [selectedParts]);
  const editableCount = selectedParts.filter((part) => !part.locked).length;
  const wholeGroup =
    selectedParts.length > 1 &&
    selectedParts[0].group !== undefined &&
    selectedParts.every((part) => part.group === selectedParts[0].group) &&
    document.parts.filter((part) => part.group === selectedParts[0].group).length === selectedParts.length;
  const selectedBay = selection.length === 1 && selection[0].startsWith("panel:") ? selection[0] : null;

  useEffect(() => {
    actionsRef.current = {
      openPanel: (panel) => {
        if (panel === "cost") setPane("price");
        else if (panel === "simulation") setPane("simulation");
        else if (panel === "checks") setPane("checks");
        else {
          setPane("model");
          showDrawer("edit");
        }
      },
      newChat: () => {
        setJob({ client: NO_CLIENT, margin: 20, sourceKind: "description" });
        setPane(null);
        setFileError(null);
      },
    };
  });

  function openQuote() {
    setFileError(null);
    if (blocked) {
      setFileError(blockedHint);
      return;
    }
    setPane("quote");
  }

  function openDrawings() {
    setFileError(null);
    if (blocked) return;
    setSheet("technical");
    setPane("drawings");
  }

  function openCutting() {
    setFileError(null);
    if (blocked) return;
    setPane("boards");
  }

  function usedArtwork() {
    const used = new Set(document.parts.flatMap((part) => (part.images ?? []).map((image) => image.assetId)));
    return getAssets()
      .filter((asset) => used.has(asset.id))
      .map(({ id, name, dataUrl, width, height }) => ({ id, name, dataUrl, width, height }));
  }

  async function openProject(project: OpenedProject) {
    await restoreAssets(project.assets);
    await saveMeshes(project.meshes);
    setCosting(project.costing);
    commit(project.document);
    setSelection(EMPTY_IDS);
  }

  async function addModel(file: File) {
    const added = await addModelFile(document, file);
    commit(added.document);
    setSelection(added.ids);
    return added.note;
  }

  async function download(kind: "quote" | "pdf" | "dxf") {
    setFileError(null);
    setFilePending(kind);
    try {
      if (kind === "quote") {
        await issueQuote({ document, costing, marginPercent: margin, jobTitle, clientName: client.name, sourceKind: job.sourceKind });
        return;
      }
      const response = await fetch(kind === "pdf" ? "/api/files/technical" : "/api/files/dxf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "pdf" ? { document, jobTitle, clientName: client.name, artwork: usedArtwork() } : { document }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "The file could not be generated.");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      const named = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/);
      link.download = named?.[1] || (kind === "pdf" ? "proink-technical.pdf" : "proink-cnc-files.zip");
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "The file could not be generated.");
    } finally {
      setFilePending(null);
    }
  }

  // --- Editing in the 3D pane ----------------------------------------------------------------

  function showDrawer(tool: DrawerTool) {
    setDrawerTool(tool);
    writeDrawerOpen(true);
  }

  function chooseDrawer(id: DrawerTool) {
    if (drawerOpen && drawerTool === id) {
      writeDrawerOpen(false);
      return;
    }
    setDrawerTool(id);
    if (!drawerOpen) writeDrawerOpen(true);
  }

  function toggleFullscreen() {
    const box = viewportBox.current;
    if (!box || typeof box.requestFullscreen !== "function") return;
    if (window.document.fullscreenElement === box) void window.document.exitFullscreen();
    else void box.requestFullscreen();
  }

  function pick(id: string | null, modifiers: PickModifiers) {
    if (id === null) {
      setSelection(EMPTY_IDS);
      return;
    }
    const isPart = partIdSet.has(id);
    let ids = isPart && !modifiers.alt ? expandToGroups(document, [id]) : [id];
    if (isPart && !modifiers.alt && !modifiers.shift && ids.length > 1) {
      const whole = ids.length === selection.length && ids.every((item) => selection.includes(item));
      const group = document.parts.find((part) => part.id === id)?.group;
      const inside = selection.length === 1 && document.parts.find((part) => part.id === selection[0])?.group === group;
      if (whole || inside) ids = [id];
    }
    if (modifiers.shift) {
      const current = new Set(selection);
      const allIn = ids.every((item) => current.has(item));
      setSelection(allIn ? selection.filter((item) => !ids.includes(item)) : [...selection.filter((item) => item.startsWith("panel:") === id.startsWith("panel:")), ...ids]);
    } else {
      setSelection(ids);
    }
    if (isPart) showDrawer("edit");
    else if (id.startsWith("panel:")) showDrawer("booth");
  }

  function transform(ids: string[], change: Transform) {
    commit(applyTransform(document, ids, change));
  }

  function duplicateSelection() {
    if (selectedPartIds.length === 0) return;
    const copy = duplicateParts(document, selectedPartIds);
    commit(copy.document);
    setSelection(copy.ids);
  }

  function deleteSelection() {
    if (selectedPartIds.length === 0) return;
    const removable = new Set(editableIds(document, selectedPartIds));
    if (removable.size === 0) return;
    commit(removeParts(document, selectedPartIds));
    setSelection(selectedPartIds.filter((id) => !removable.has(id)));
  }

  function groupSelection() {
    if (selectedPartIds.length < 2 || wholeGroup) return;
    commit(groupParts(document, selectedPartIds, "Group").document);
  }

  function ungroupSelection() {
    if (!selectedParts.some((part) => part.group)) return;
    commit(ungroupParts(document, selectedPartIds));
  }

  function applyTemplateResult(result: TemplateResult, template: Template) {
    commit(result.document);
    setSelection(result.ids);
    setPane("model");
    showDrawer(template.kind === "scene" ? "booth" : "edit");
  }

  useEffect(() => {
    if (pane !== "model") return;
    function onKeyDown(event: KeyboardEvent) {
      if (isTyping(event.target)) return;
      if (explode > 0) return;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redoBooth();
        else undoBooth();
        return;
      }
      if (command && key === "y") {
        event.preventDefault();
        redoBooth();
        return;
      }
      if (command && key === "d") {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (command && key === "g") {
        event.preventDefault();
        if (event.shiftKey) ungroupSelection();
        else groupSelection();
        return;
      }
      if (command && key === "a") {
        event.preventDefault();
        setSelection(document.parts.filter((part) => !part.hidden).map((part) => part.id));
        return;
      }
      if (command) return;

      if (event.key === "Delete" || event.key === "Backspace") {
        if (selectedPartIds.length === 0) return;
        event.preventDefault();
        deleteSelection();
      } else if (event.key === "Escape") {
        setSelection(EMPTY_IDS);
      } else if (key === "w") {
        setMode("move");
      } else if (key === "e") {
        setMode("rotate");
      } else if (key === "r" && selectedParts.length === 1) {
        setMode("scale");
      } else if (event.key.startsWith("Arrow") && editableCount > 0) {
        event.preventDefault();
        const step = event.shiftKey ? 100 : snap.grid > 0 ? snap.grid : 10;
        const delta = { x: 0, y: 0, z: 0 };
        if (event.altKey) {
          if (event.key === "ArrowUp") delta.y = step;
          if (event.key === "ArrowDown") delta.y = -step;
        } else {
          if (event.key === "ArrowLeft") delta.x = -step;
          if (event.key === "ArrowRight") delta.x = step;
          if (event.key === "ArrowUp") delta.z = -step;
          if (event.key === "ArrowDown") delta.z = step;
        }
        commit(moveParts(document, selectedPartIds, delta), "nudge");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const liveSimulation = useMemo(() => readSimulation(chat.messages), [chat.messages]);
  const savedSimulation = useSyncExternalStore(subscribeSimulation, getSimulation, getServerSimulation);
  const simulation = { ...liveSimulation, image: liveSimulation.image ?? savedSimulation };
  const generating = simulation.pending;
  const wasGenerating = useRef(false);
  useEffect(() => {
    if (generating && !wasGenerating.current) {
      setRailOpen(true);
      setPane("simulation");
    }
    wasGenerating.current = generating;
  }, [generating]);

  function downloadSimulation() {
    if (!simulation.image) return;
    const link = window.document.createElement("a");
    link.href = simulation.image;
    link.download = "proink-simulation.png";
    link.click();
  }

  const closePane = () => setPane(null);

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-ink">
      {/* Left: new chat, shortcuts, and the list of jobs, like the Cursor agent window. */}
      <aside className={`flex shrink-0 flex-col overflow-hidden border-r border-sidebar-line bg-sidebar transition-[width] duration-200 ease-out ${sidebarOpen ? "w-60" : "w-14"}`}>
        <div className={`flex h-11 shrink-0 items-center ${sidebarOpen ? "justify-between px-3" : "justify-center"}`}>
          {sidebarOpen ? (
            <span className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-ink text-bg">
                <Layers size={14} strokeWidth={2.25} aria-hidden="true" />
              </span>
              ProInk
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-sidebar-raised hover:text-ink"
          >
            {sidebarOpen ? <PanelLeftClose size={15} strokeWidth={2} aria-hidden="true" /> : <PanelLeftOpen size={15} strokeWidth={2} aria-hidden="true" />}
          </button>
        </div>

        <nav className={`flex flex-col gap-px px-2 pb-2 ${sidebarOpen ? "" : "items-center"}`}>
          <SideItem icon={SquarePen} label="New chat" open={sidebarOpen} onClick={chat.newChat} />
          <SideItem icon={Boxes} label="Price book" open={sidebarOpen} href="/settings/materials" />
          <SideItem icon={Users} label="Clients" open={sidebarOpen} href="/settings/clients" />
          <SideItem icon={Gauge} label="AI usage" open={sidebarOpen} href="/settings/usage" />
          <SideItem icon={FileClock} label="Past quotes" open={sidebarOpen} href="/settings/past-quotes" />
        </nav>

        {sidebarOpen ? (
          <>
            <p className="px-4 pt-3 pb-1.5 text-xs text-subtle">Jobs</p>
            <ChatList />
          </>
        ) : (
          <div className="flex-1" />
        )}

        <div className={`flex shrink-0 items-center border-t border-sidebar-line p-3 ${sidebarOpen ? "justify-between" : "flex-col gap-2"}`}>
          {sidebarOpen ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sidebar-raised text-[11px] font-semibold">P</span>
              <span className="truncate text-[13px]">ProInk Studio</span>
            <button
              type="button"
              onClick={() => {
                void createClient().auth.signOut().then(() => {
                  window.location.href = "/login";
                });
              }}
              className="rounded-md px-1.5 py-0.5 text-[11px] text-subtle hover:bg-sidebar-raised hover:text-ink"
            >
              Sign out
            </button>
            </span>
          ) : null}
          <ThemeToggle />
        </div>
      </aside>

      {/* Center: the chat, and whatever the user opens next to it. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 shrink-0 items-center justify-between gap-3 px-4">
          <ClientPicker value={client} onChange={setClient} />
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => {
                setRailOpen(!railShown);
                setRailPinned(!railShown);
              }}
              aria-label={railShown ? "Hide job panel" : "Show job panel"}
              title={railShown ? "Hide job panel" : "Show job panel"}
              aria-pressed={railShown}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-raised hover:text-ink ${railShown ? "text-ink" : "text-muted"}`}
            >
              <PanelRight size={15} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <div className={`flex min-w-0 flex-1 flex-col ${pane ? "min-w-[340px]" : ""}`}>
            <ChatConversation
            />
          </div>

          {pane ? (
            <section className="animate-slide-in flex min-w-0 flex-[1.5] flex-col border-l border-line bg-panel">
              {fileError ? (
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-danger/25 bg-danger-soft px-4 py-2 text-xs text-danger">
                  <span className="flex items-center gap-2">
                    <TriangleAlert size={14} className="shrink-0" aria-hidden="true" />
                    {fileError}
                  </span>
                  <button type="button" onClick={() => setFileError(null)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-danger/10">
                    <X size={13} aria-hidden="true" />
                  </button>
                </div>
              ) : null}

              {pane === "price" ? (
                <>
                  <PaneHeader title="Price" detail={isPriced ? `${costed.lines.length} items` : "Nothing priced yet"} onClose={closePane} />
                  <div className="min-h-0 flex-1 overflow-auto">
                    <div className="mx-auto max-w-3xl">
                      <CostPanel
                        document={document}
                        costed={costed}
                        costing={costing}
                        priceBook={priceBook}
                        marginPercent={margin}
                        onMargin={setMargin}
                        jobTitle={jobTitle}
                        onPreview={openQuote}
                        onDownload={() => void download("quote")}
                        downloading={filePending === "quote"}
                      />
                    </div>
                  </div>
                </>
              ) : null}

              {pane === "quote" ? (
                <QuotePreview
                  title={jobTitle}
                  clientName={client.name}
                  document={document}
                  sections={costing.sections}
                  lines={costed.lines}
                  quote={costing.quote}
                  marginPercent={margin}
                  pending={filePending === "quote"}
                  onDownload={() => void download("quote")}
                  onClose={closePane}
                />
              ) : null}

              {pane === "simulation" ? (
                <SimulationPreview
                  image={simulation.image}
                  pending={generating}
                  error={simulation.error}
                  onDownload={downloadSimulation}
                  onClose={closePane}
                  onEdit={chat.providerReady && chat.imageReady ? chat.requestSimulationEdit : undefined}
                  notice={chat.imageKeyMissing ? `Add ${providerById("google")?.env ?? "GOOGLE_GENERATIVE_AI_API_KEY"} to .env.local and restart to generate or edit a simulation.` : undefined}
                />
              ) : null}

              {pane === "boards" ? <CuttingPreview plan={production.cutting} onClose={closePane} /> : null}

              {pane === "drawings" ? (
                <DrawingsPreview
                  document={document}
                  model={model}
                  production={production}
                  sheet={sheet}
                  onSheet={setSheet}
                  pending={filePending === "pdf" || filePending === "dxf" ? filePending : null}
                  onDownload={() => void download("pdf")}
                  onDownloadDxf={() => void download("dxf")}
                  onOpenCutting={openCutting}
                  onClose={closePane}
                />
              ) : null}

              {pane === "checks" ? (
                <>
                  <PaneHeader title="Checks" detail={errorCount > 0 ? `${errorCount} to fix before quoting` : "Nothing to fix"} onClose={closePane} />
                  <div className="min-h-0 flex-1 overflow-auto">
                    <CheckPanel
                      issues={production.issues}
                      document={document}
                      brief={jobBrief(chat.messages)}
                      sourceKind={job.sourceKind}
                      modelReady={chat.providerReady}
                      onDocument={commit}
                      onSelect={setSelection}
                    />
                  </div>
                </>
              ) : null}

              {pane === "files" ? (
                <>
                  <PaneHeader title="Files" detail="Save the stand, open a saved one, or add a 3D file" onClose={closePane} />
                  <div className="min-h-0 flex-1 overflow-auto">
                    <div className="mx-auto max-w-md px-4 pb-6">
                      <ProjectFiles document={document} model={model} costing={costing} jobTitle={jobTitle} onOpenProject={openProject} onAddModel={addModel} />
                    </div>
                  </div>
                </>
              ) : null}

              {pane === "model" ? (
                <>
                  <PaneHeader title="3D and draw" detail="Click a piece in the model or the list to edit it" onClose={closePane} />
                  <div
                    ref={viewportBox}
                    className={`relative border-b border-line bg-raised [&:fullscreen]:h-screen [&:fullscreen]:w-screen ${fullscreen ? "h-screen w-screen" : drawerOpen ? "h-[46%] min-h-[240px] shrink-0" : "min-h-0 flex-1"}`}
                  >
                    <Viewport
                      document={document}
                      model={model}
                      view={view}
                      selection={selection}
                      mode={mode}
                      snap={snap}
                      explode={explode}
                      onPick={pick}
                      onTransform={transform}
                    />
                    <div className="absolute top-3 left-3 flex gap-0.5 rounded-lg border border-line bg-panel/90 p-0.5 shadow-soft backdrop-blur-md">
                      {(["perspective", "plan", "front", "render"] as const).map((item) => {
                        const Icon = VIEW_ICON[item];
                        const active = view === item;
                        return (
                          <button
                            key={item}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setView(item)}
                            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${active ? "bg-ink text-bg" : "text-muted hover:bg-raised hover:text-ink"}`}
                          >
                            <Icon size={12} strokeWidth={2} aria-hidden="true" />
                            {VIEW_LABEL[item]}
                          </button>
                        );
                      })}
                    </div>
                    {chat.assembling ? (
                      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-panel/95 px-3 py-2 shadow-float backdrop-blur-md">
                        <p className="flex items-center gap-2 text-[11px] text-muted">
                          <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                          Assembling {document.parts.length} pieces…
                        </p>
                        <button type="button" onClick={chat.stop} className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-muted hover:bg-raised hover:text-ink">
                          Stop
                        </button>
                      </div>
                    ) : document.parts.length > 0 && !document.assembled ? (
                      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-line bg-panel/95 px-3 py-2 shadow-float backdrop-blur-md">
                        <p className="text-[11px] text-muted">{document.parts.length} pieces priced, not assembled</p>
                        <button
                          type="button"
                          disabled={chat.busy || !chat.providerReady}
                          onClick={() => void chat.assembleStand()}
                          className="rounded-lg bg-ink px-2.5 py-1.5 text-[11px] font-medium text-bg disabled:opacity-40"
                        >
                          Assemble stand
                        </button>
                      </div>
                    ) : null}
                    <div className="absolute top-3 right-3 flex flex-col items-end gap-1.5">
                      <BlenderLink document={document} onDocument={commit} />
                      <div className="flex gap-0.5 rounded-lg border border-line bg-panel/90 p-0.5 shadow-soft backdrop-blur-md">
                      <button
                        type="button"
                        disabled={document.parts.length === 0}
                        onClick={() => {
                          if (window.confirm("Clear the canvas? This removes every piece from the model.")) {
                            commit(createEmptyDesign());
                            setSelection(EMPTY_IDS);
                          }
                        }}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
                      >
                        <Eraser size={12} strokeWidth={2} aria-hidden="true" />
                        Clear
                      </button>
                      <button
                        type="button"
                        aria-pressed={explode > 0}
                        onClick={() => setExplode(explode > 0 ? 0 : 0.7)}
                        className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${explode > 0 ? "bg-ink text-bg" : "text-muted hover:bg-raised hover:text-ink"}`}
                      >
                        <Boxes size={12} strokeWidth={2} aria-hidden="true" />
                        {explode > 0 ? "Assemble" : "Explode"}
                      </button>
                      {canFullscreen ? (
                        <button
                          type="button"
                          aria-pressed={fullscreen}
                          onClick={toggleFullscreen}
                          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${fullscreen ? "bg-ink text-bg" : "text-muted hover:bg-raised hover:text-ink"}`}
                        >
                          {fullscreen ? <Minimize2 size={12} strokeWidth={2} aria-hidden="true" /> : <Maximize2 size={12} strokeWidth={2} aria-hidden="true" />}
                          {fullscreen ? "Exit full screen" : "Full screen"}
                        </button>
                      ) : null}
                      </div>
                    </div>
                    {view !== "render" ? (
                      <EditorToolbar
                        mode={mode}
                        onMode={setMode}
                        snap={snap}
                        onSnap={setSnap}
                        parts={selectedParts}
                        groupName={wholeGroup && selectedParts[0].group ? (document.groups?.[selectedParts[0].group] ?? "Group") : null}
                        disabled={selectedParts.length > 0 && editableCount === 0}
                        onChange={(changes, key) => commit(updateParts(document, selectedPartIds, changes), key)}
                        onRename={(name) => {
                          const group = wholeGroup ? selectedParts[0].group : undefined;
                          commit(group ? renameGroup(document, group, name) : updateParts(document, selectedPartIds, { name }));
                        }}
                        canResize={selectedParts.length === 1}
                        canGroup={selectedPartIds.length > 1 && !wholeGroup}
                        canUngroup={selectedParts.some((part) => part.group)}
                        onDuplicate={duplicateSelection}
                        onDelete={deleteSelection}
                        onGroup={groupSelection}
                        onUngroup={ungroupSelection}
                      />
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1 border-b border-line px-3 py-1.5">
                    {DRAWER_TABS.map(({ id, label, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => chooseDrawer(id)}
                        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${drawerTool === id ? "bg-raised text-ink" : "text-muted hover:bg-raised hover:text-ink"}`}
                      >
                        <Icon size={13} strokeWidth={2} aria-hidden="true" />
                        {label}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-label={drawerOpen ? "Hide panel" : "Show panel"}
                      aria-expanded={drawerOpen}
                      onClick={() => writeDrawerOpen(!drawerOpen)}
                      className="ml-auto flex items-center rounded-md px-2 py-1.5 text-muted transition-colors hover:bg-raised hover:text-ink"
                    >
                      {drawerOpen ? <ChevronDown size={14} strokeWidth={2} aria-hidden="true" /> : <ChevronUp size={14} strokeWidth={2} aria-hidden="true" />}
                    </button>
                  </div>
                  {drawerOpen ? (
                    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                      {drawerTool === "edit" ? (
                        <EditPanel document={document} selection={selection} onDocument={commit} onSelect={setSelection} onOpenTemplates={() => showDrawer("templates")} />
                      ) : null}
                      {drawerTool === "templates" ? <TemplatesPanel document={document} onApply={applyTemplateResult} /> : null}
                      {drawerTool === "booth" ? (
                        <div>
                          {selectedBay ? <SelectedBay document={document} selected={selectedBay} onDocument={commit} /> : null}
                          <BoothMenu document={document} selected={selectedBay} onDocument={commit} onSelect={(id) => setSelection(id ? [id] : EMPTY_IDS)} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </section>
          ) : null}

          {/* Right: this job at a glance. Quotation and board sheets show up once there is a price. */}
          {railShown ? (
            <aside className="animate-slide-in flex w-60 shrink-0 flex-col overflow-auto border-l border-line bg-bg">
              <div className="px-4 pt-3 pb-4">
                <p className={`truncate text-[13px] font-medium ${client.name ? "" : "text-muted"}`}>{client.name || "No client yet"}</p>
                {isPriced ? (
                  <p className="mt-1 font-mono text-[22px] leading-tight font-medium tracking-tight">{formatCents(totalCents)}</p>
                ) : (
                  <p className="mt-1 text-xs text-muted">Not priced yet. Describe the job in the chat.</p>
                )}
              </div>

              <RailGroup title="Price and files">
                <RailRow icon={Receipt} label="Price" value={isPriced ? `${costed.lines.length} lines` : undefined} active={pane === "price"} onClick={() => setPane("price")} />
                {isPriced ? (
                  <>
                    <RailRow
                      icon={filePending === "quote" ? Loader2 : FileText}
                      spin={filePending === "quote"}
                      label="Quotation"
                      value={blocked ? "Fix errors" : "PDF"}
                      active={pane === "quote"}
                      disabled={blocked}
                      title={blocked ? blockedHint : undefined}
                      onClick={() => void openQuote()}
                    />
                    <RailRow
                      icon={Scissors}
                      label="Board sheets"
                      value={blocked ? "Fix errors" : `${totalBoards} ${totalBoards === 1 ? "board" : "boards"}`}
                      active={pane === "boards"}
                      disabled={blocked}
                      title={blocked ? blockedHint : undefined}
                      onClick={openCutting}
                    />
                    <RailRow icon={Ruler} label="Technical sheets" active={pane === "drawings"} disabled={blocked} title={blocked ? blockedHint : undefined} onClick={openDrawings} />
                  </>
                ) : null}
                <RailRow icon={FolderOpen} label="Files" active={pane === "files"} onClick={() => setPane("files")} />
              </RailGroup>

              <RailGroup title="Design">
                {simulation.image || simulation.pending || simulation.error ? (
                  <RailRow
                    icon={generating ? Loader2 : Aperture}
                    spin={generating}
                    label="Simulation"
                    value={generating ? "Generating" : simulation.image ? "Ready" : undefined}
                    active={pane === "simulation"}
                    onClick={() => setPane("simulation")}
                  />
                ) : null}
                <RailRow
                  icon={Box}
                  label="3D and draw"
                  value={document.parts.length > 0 ? `${document.parts.length} ${document.parts.length === 1 ? "piece" : "pieces"}` : undefined}
                  active={pane === "model"}
                  onClick={() => setPane("model")}
                />
                <RailRow
                  icon={ListChecks}
                  label="Checks"
                  value={errorCount > 0 ? `${errorCount} to fix` : undefined}
                  tone={errorCount > 0 ? "danger" : undefined}
                  active={pane === "checks"}
                  onClick={() => setPane("checks")}
                />
              </RailGroup>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SideItem({
  icon: Icon,
  label,
  open,
  onClick,
  href,
}: {
  icon: LucideIcon;
  label: string;
  open: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const className = `flex items-center rounded-lg text-[13px] text-ink transition-colors hover:bg-sidebar-raised ${open ? "w-full gap-2.5 px-2.5 py-1.5" : "h-8 w-8 justify-center"}`;
  const content = (
    <>
      <Icon size={15} strokeWidth={1.9} aria-hidden="true" className="shrink-0 text-muted" />
      {open ? label : null}
    </>
  );
  if (href) {
    return (
      <Link href={href} title={label} aria-label={label} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className={`${className} text-left`}>
      {content}
    </button>
  );
}

function RailGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-2 pb-3">
      <p className="px-2 pb-1 text-xs text-subtle">{title}</p>
      <div className="flex flex-col gap-px">{children}</div>
    </section>
  );
}

function RailRow({
  icon: Icon,
  label,
  value,
  active = false,
  disabled = false,
  spin = false,
  tone,
  title,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value?: string;
  active?: boolean;
  disabled?: boolean;
  spin?: boolean;
  tone?: "danger";
  title?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${active ? "bg-raised text-ink" : "text-ink hover:bg-raised"}`}
    >
      <Icon size={15} strokeWidth={1.9} aria-hidden="true" className={`shrink-0 text-muted ${spin ? "animate-spin" : ""}`} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {value ? <span className={`shrink-0 text-xs ${tone === "danger" ? "text-danger" : "text-muted"}`}>{value}</span> : null}
    </button>
  );
}

function PaneHeader({ title, detail, onClose, children }: { title: string; detail?: string; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
      <div className="min-w-0">
        <p className="text-sm leading-none font-semibold tracking-tight">{title}</p>
        {detail ? <p className="mt-1 truncate text-[11px] leading-none text-muted">{detail}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {children}
        <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-raised hover:text-ink">
          <X size={15} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

type Commit = (document: DesignDocument, key?: string) => void;

function BoothMenu({
  document,
  selected,
  onDocument,
  onSelect,
}: {
  document: DesignDocument;
  selected: string | null;
  onDocument: Commit;
  onSelect: (id: string | null) => void;
}) {
  const hasFrame = document.walls.some((wall) => wall.bays.length > 0);
  const floorOn = document.features.some((feature) => feature.type === "floor");
  if (!hasFrame) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="text-sm leading-6 text-muted">No modular frame on this job. Start from a booth template, or use Elements to edit custom pieces.</p>
      </div>
    );
  }
  return (
    <div className="pb-4">
      <p className="eyebrow px-4 pt-4 pb-2">Envelope</p>
      <div className="grid grid-cols-3 gap-2.5 px-4 pb-3">
        <NumberField label="Width" value={document.envelope.width} onCommit={(width) => onDocument(applyDesignPatch(document, { envelope: { width } }))} />
        <NumberField label="Depth" value={document.envelope.depth} onCommit={(depth) => onDocument(applyDesignPatch(document, { envelope: { depth } }))} />
        <NumberField label="Height" value={document.envelope.height} onCommit={(height) => onDocument(applyDesignPatch(document, { envelope: { height } }))} />
      </div>
      <div className="px-4 pb-4">
        <NumberField label="Module" value={document.module} onCommit={(moduleSize) => onDocument(applyDesignPatch(document, { module: moduleSize }))} />
      </div>
      <p className="eyebrow border-t border-line px-4 pt-4 pb-2">Floor</p>
      <div className="px-4 pb-4">
        <SelectField
          value={floorOn ? "carpet" : "none"}
          onChange={(event) => {
            const features = event.target.value === "carpet"
              ? [...document.features.filter((feature) => feature.type !== "floor"), { id: "floor-1", type: "floor" as const, materialId: "FLR-CARPET" }]
              : document.features.filter((feature) => feature.type !== "floor");
            onDocument(applyDesignPatch(document, { features }));
          }}
        >
          <option value="carpet">Carpet</option>
          <option value="none">None</option>
        </SelectField>
      </div>
      <p className="eyebrow border-t border-line px-4 pt-4 pb-2">Walls</p>
      <div className="space-y-2 px-4">
        {EDGES.map((edge) => {
          const wall = document.walls.find((item) => item.edge === edge);
          const fascia = document.features.some((feature) => feature.type === "fascia" && feature.edge === edge);
          return (
            <details key={edge} className="group overflow-hidden rounded-xl border border-line bg-panel shadow-soft open:border-line-strong open:shadow-float">
              <summary className="flex items-center justify-between px-3.5 py-3 text-sm font-medium capitalize transition-colors hover:bg-raised/60">
                <span className="flex items-center gap-2">
                  <ChevronRight size={14} strokeWidth={2.25} aria-hidden="true" className="chev text-subtle transition-transform duration-200" />
                  {edge}
                </span>
                <span className="rounded-full bg-raised px-2 py-0.5 text-[11px] font-medium text-muted normal-case">{wall?.bays.length ?? 0} bays</span>
              </summary>
              <div className="space-y-2 border-t border-line bg-raised/30 px-3.5 py-3">
                <label className="flex items-center justify-between gap-3 pb-1 text-xs font-medium text-muted">
                  Fascia
                  <div className="w-24">
                    <SelectField compact value={fascia ? "on" : "off"} onChange={() => toggleFascia(document, edge, onDocument)}>
                      <option value="off">Off</option>
                      <option value="on">On</option>
                    </SelectField>
                  </div>
                </label>
                {wall?.bays.map((bay, index) => {
                  const id = `panel:${edge}:${index}`;
                  const isSelected = selected === id;
                  return (
                    <div
                      key={id}
                      className={`flex items-center gap-2.5 rounded-lg border bg-panel px-2.5 py-1.5 transition-all ${isSelected ? "border-accent shadow-[0_0_0_3px_rgb(110_161_255/0.25)]" : "border-line hover:border-line-strong"}`}
                    >
                      <button
                        type="button"
                        aria-label={`Select bay ${index + 1}`}
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold transition-colors ${isSelected ? "bg-accent text-white" : "bg-raised text-muted hover:text-ink"}`}
                        onClick={() => onSelect(isSelected ? null : id)}
                      >
                        {index + 1}
                      </button>
                      <span className={`h-2 w-2 shrink-0 rounded-full ${BAY_DOT[bay.kind]}`} aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <SelectField
                          compact
                          value={bay.kind}
                          onChange={(event) => {
                            onSelect(id);
                            onDocument(setBayKind(document, edge, index, event.target.value as Bay["kind"]));
                          }}
                        >
                          <option value="graphic">Graphic</option>
                          <option value="solid">Solid</option>
                          <option value="open">Open</option>
                          <option value="door">Door</option>
                        </SelectField>
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function SelectedBay({
  document,
  selected,
  onDocument,
}: {
  document: DesignDocument;
  selected: string;
  onDocument: Commit;
}) {
  const match = selected.match(/^panel:(back|left|right|front):(\d+)$/);
  if (!match) return null;
  const edge = match[1] as EdgeId;
  const bayIndex = Number(match[2]);
  const actions = [
    { label: "Counter", Icon: Table2, run: () => addCounter(document, edge, bayIndex, onDocument) },
    { label: "Lightbox", Icon: Lightbulb, run: () => addLightbox(document, edge, bayIndex, onDocument) },
    { label: "Spots", Icon: Lamp, run: () => addSpots(document, edge, bayIndex, onDocument) },
  ];
  return (
    <div className="animate-rise border-b border-accent-line bg-accent-soft/60 px-4 py-3.5">
      <p className="flex items-center gap-2 text-xs font-semibold text-accent capitalize">
        <Check size={13} strokeWidth={2.75} aria-hidden="true" />
        {edge} · bay {bayIndex + 1}
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {actions.map(({ label, Icon, run }) => (
          <button
            key={label}
            type="button"
            className="flex flex-col items-center gap-1.5 rounded-xl border border-accent-line bg-panel px-1 py-2.5 text-[11px] font-medium text-ink shadow-soft transition-all hover:-translate-y-px hover:border-accent hover:text-accent hover:shadow-float"
            onClick={run}
          >
            <Icon size={17} strokeWidth={1.9} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function toggleFascia(document: DesignDocument, edge: EdgeId, onDocument: Commit) {
  const existing = document.features.some((feature) => feature.type === "fascia" && feature.edge === edge);
  const features = existing
    ? document.features.filter((feature) => !(feature.type === "fascia" && feature.edge === edge))
    : [...document.features, { id: `fascia-${edge}`, type: "fascia" as const, edge, height: 400 }];
  onDocument(applyDesignPatch(document, { features }));
}

function addCounter(document: DesignDocument, edge: EdgeId, bayIndex: number, onDocument: Commit) {
  const id = `counter-${edge}-${bayIndex}`;
  const features = document.features.filter((feature) => feature.id !== id);
  onDocument(applyDesignPatch(document, {
    features: [...features, { id, type: "counter", edge, bayIndex, width: Math.max(document.module - 40, 100), depth: 600, height: 1100 }],
  }));
}

function addLightbox(document: DesignDocument, edge: EdgeId, bayIndex: number, onDocument: Commit) {
  const withBay = setBayKind(document, edge, bayIndex, "graphic");
  const id = `lightbox-${edge}-${bayIndex}`;
  const features = withBay.features.filter((feature) => feature.id !== id);
  onDocument(applyDesignPatch(withBay, { features: [...features, { id, type: "lightbox", edge, bayIndex }] }));
}

function addSpots(document: DesignDocument, edge: EdgeId, bayIndex: number, onDocument: Commit) {
  const id = `spots-${edge}-${bayIndex}`;
  const features = document.features.filter((feature) => feature.id !== id);
  onDocument(applyDesignPatch(document, { features: [...features, { id, type: "spotlight", edge, bayIndex, count: 2 }] }));
}
