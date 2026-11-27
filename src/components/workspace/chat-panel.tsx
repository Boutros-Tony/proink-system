"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import {
  AlertCircle,
  ArrowUp,
  Box,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleSlash,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Square,
  X,
} from "lucide-react";
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { providerById, type ProviderId } from "@/lib/ai/models";
import { ASK_USER_CHAT_NOTE, QuestionCard, openAskUserCallIds, type AskUserOutput } from "@/components/workspace/question-card";
import { Menu, useCloseMenu } from "@/components/workspace/menu";
import { EffortControl, ModelPicker } from "@/components/workspace/model-picker";
import { describeAssets, getAssets } from "@/lib/studio/assets";
import { formatCents } from "@/lib/format";
import { getCosting, setCosting } from "@/lib/studio/costing";
import { sectionSchema } from "@/lib/systems/sections";
import {
  attachmentPaths,
  cancelScheduled,
  createJob,
  deleteJob,
  flushCloud,
  getActiveChatId,
  getActiveProjectId,
  getCloudError,
  loadChatState,
  openStudio,
  reloadJobWork,
  scheduleChatMeta,
  setActiveJob,
  showJob,
  startCloudSync,
  stopChatRun,
  subscribeCloudError,
  uploadAttachment,
  type SavedJob,
} from "@/lib/studio/cloud";
import { getJob, setJob } from "@/lib/studio/job";
import { NO_CLIENT } from "@/components/workspace/client-picker";
import { setSimulation } from "@/lib/studio/simulation";
import { regionLine, type ImageRegion } from "@/lib/ai/image-edit";
import { inspectionLine, withDuration } from "@/lib/ai/chat-timing";
import { findingIdsToAccept } from "@/lib/ai/kept-findings";
import { recordSpend } from "@/lib/studio/ai-spend";
import { blenderLinked, markPulled, pullDesign } from "@/lib/blender/client";
import { getBooth, getModelEffort, getServerBooth, getServerSettings, getStudioSettings, subscribeBooth, subscribeSettings } from "@/lib/studio/local-booth";
import { describeSelection, mentionOptions, readMentions, type Mention, type MentionOption } from "@/lib/studio/mentions";
import { getSelection, getServerSelection, setSelection, subscribeSelection } from "@/lib/studio/selection";
import { addExtras, applyCostEdits, costEditSchema, designKey, emptyCosting, extraLineSchema, replaceCutExtras, type Costing } from "@/lib/systems/costing";
import { createEmptyDesign } from "@/lib/systems/modular/patch";
import { acceptFinding } from "@/lib/systems/modular/review";
import { openDesignDocument, type DesignDocument } from "@/lib/systems/modular/schema";

type ToolOutput = {
  document?: unknown;
  error?: string;
  issues?: Array<{ severity: string; message: string }>;
  ids?: string[];
  suggestions?: unknown;
  boards?: { name: string; boards: number; unit: string; size: string | null; totalCents: number }[];
  sections?: unknown;
  estimated?: number;
  totalCents?: number;
  missing?: string[];
  locked?: string[];
  image?: string;
  placed?: number;
  rejected?: { id: string; reason: string }[];
  waiting?: string[];
  check?: { overlaps?: string[]; floating?: string[] };
  edits?: unknown;
  done?: string[];
  inspection?: { findings?: { severity?: string }[] };
  ms?: number;
};

type Thread = { id: string; projectId: string; title: string; mode: ChatMode };

/**
 * Stored chat mode. "quote" is Pricing. "design" is Engineering.
 * "image" is an old stored value. The UI treats it as Engineering and never sets it.
 */
export type ChatMode = "design" | "quote" | "image";

/** The mode the composer shows. A stored "image" thread is Engineering. */
function threadMode(mode: ChatMode): "quote" | "design" {
  return mode === "quote" ? "quote" : "design";
}

/** What the server receives. Pricing sends "price". Engineering keeps today's "quote". */
function sentMode(mode: "quote" | "design"): "price" | "quote" {
  return mode === "design" ? "quote" : "price";
}

/** A stored Pricing chat that already has drawn pieces is Engineering. The next meta save writes "design". */
function drawnWork(document: DesignDocument) {
  return document.parts.length > 0 || document.walls.some((wall) => wall.bays.length > 0);
}

/** Latest request mode for automatic resends. Never "image": an edit overrides one request only. */
let requestMode: "price" | "quote" = "price";

function lastAssistantStep(messages: UIMessage[]) {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return [];
  const start = last.parts.reduce((index, part, partIndex) => (part.type === "step-start" ? partIndex : index), -1);
  return last.parts.slice(start + 1);
}

/** True once askUser in the current step has an answer. Server tools finishing a step do not count. */
function lastStepResolvedAskUser(messages: UIMessage[]) {
  return lastAssistantStep(messages).some((part) => isToolUIPart(part) && getToolName(part) === "askUser" && part.state === "output-available");
}

/** The composer already sent the user's words, so the paused question must not start a second request. */
function userRepliedInChat(messages: UIMessage[]) {
  return lastAssistantStep(messages).some((part) => {
    if (!isToolUIPart(part) || getToolName(part) !== "askUser" || part.state !== "output-available") return false;
    const output = part.output as { note?: unknown } | undefined;
    return output?.note === ASK_USER_CHAT_NOTE;
  });
}

/** Panels the chat can point to after it fills them in. */
export type ChatPanel = "edit" | "cost" | "simulation" | "checks";

type Attachment = { id: string; file: File };

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const ACCEPT = "image/*,application/pdf";

/** Tools that return the changed document. Each one is one undo step in the editor. */
const DOCUMENT_TOOLS: Record<string, { working: string; done: string; panel?: ChatPanel }> = {
  addElements: { working: "Listing elements…", done: "Elements added", panel: "edit" },
  applyDesignPatch: { working: "Drawing…", done: "Drawing updated" },
  addParts: { working: "Adding pieces…", done: "Pieces added" },
  updateParts: { working: "Updating pieces…", done: "Pieces updated" },
  moveParts: { working: "Moving pieces…", done: "Pieces moved" },
  arrangeParts: { working: "Assembling the stand…", done: "Stand assembled" },
  assemble: { working: "Assembling the stand…", done: "Stand assembled" },
  removeParts: { working: "Removing pieces…", done: "Pieces removed" },
  applyTemplate: { working: "Applying template…", done: "Template applied" },
  blenderPython: { working: "Drawing in Blender…", done: "Drawn in Blender" },
  blenderLook: { working: "Looking at the drawing…", done: "Checked the drawing" },
  inspect: { working: "Running the production check…", done: "Production check" },
  addJobMaterial: { working: "Adding a material…", done: "Material added" },
};

/** What the user sees in the chat when they press Assemble stand. The instructions are in the system prompt. */
const ASSEMBLE_MESSAGE = "Assemble the stand from the priced pieces.";
/** How often a chat whose reply runs on the server checks for the next stored step. */
const BACKGROUND_POLL_MS = 2000;

type ChatContextValue = {
  threads: Thread[];
  activeId: string;
  activeTitle: string;
  messages: UIMessage[];
  text: string;
  setText: (value: string) => void;
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;
  attachments: Attachment[];
  attachError: string | null;
  addFiles: (files: File[]) => void;
  removeFile: (id: string) => void;
  openPanel: (panel: ChatPanel) => void;
  busy: boolean;
  /** Stop the reply in progress. Changes already applied stay. */
  stop: () => void;
  /** The last reply was stopped by the user. */
  stopped: boolean;
  /** Assemble stand is running. */
  assembling: boolean;
  /** An askUser card is on screen, including while the last chunks of the reply are still arriving. */
  questionOpen: boolean;
  /** This tab is streaming a reply. Background work on the server is `busy` without this. */
  replying: boolean;
  ready: boolean;
  opening: boolean;
  error: Error | undefined;
  providerReady: boolean;
  /** The Google image key is set, so a simulation can be generated or edited. */
  imageReady: boolean;
  /** Providers have been checked and the Google image key is missing. */
  imageKeyMissing: boolean;
  provider: ProviderId;
  model: string;
  openThread: (id: string) => void;
  newChat: () => void;
  sceneEmpty: boolean;
  deleteChat: (id: string) => void;
  submit: (event?: FormEvent) => Promise<void>;
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Ask the image model to change the current simulation, optionally only inside a selected area. */
  requestSimulationEdit: (edit: { instruction: string; region: ImageRegion; baseImage: string; references: { name: string; url: string }[] }) => Promise<void>;
  /** Arrange the priced pieces into a stand. This is the only step that spends a drawing request. */
  assembleStand: () => Promise<void>;
  /** Record the user's answer to a paused askUser question. The chat continues on its own. */
  answerQuestion: (toolCallId: string, output: AskUserOutput) => Promise<void>;
};

const ChatContext = createContext<ChatContextValue | null>(null);

/** The latest stand simulation in this chat, and whether one is still being made. */
export function readSimulation(messages: UIMessage[]) {
  let image: string | null = null;
  let error: string | null = null;
  let pending = false;
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part) || getToolName(part) !== "generateStandImage") continue;
      if (part.state !== "output-available") {
        pending = true;
        continue;
      }
      pending = false;
      const output = part.output as ToolOutput;
      const picture = typeof output.image === "string" ? output.image : "";
      const usable = picture.startsWith("data:") || picture.startsWith("http://") || picture.startsWith("https://");
      if (usable) {
        image = picture;
        error = null;
      } else if (output.error) {
        image = null;
        error = output.error;
      }
    }
  }
  return { image, error, pending };
}

export function useChatStudio() {
  const value = useContext(ChatContext);
  if (!value) throw new Error("Chat panels must render inside ChatProvider.");
  return value;
}

export function ChatProvider({
  children,
  onDocument,
  onFocus,
  onOpenPanel,
  onNewChat,
  sceneEmpty,
}: {
  children: ReactNode;
  onDocument: (document: DesignDocument) => void;
  onFocus: () => void;
  onOpenPanel: (panel: ChatPanel) => void;
  onNewChat?: () => void;
  sceneEmpty: boolean;
}) {
  const settings = useSyncExternalStore(subscribeSettings, getStudioSettings, getServerSettings);
  const [available, setAvailable] = useState<Record<string, boolean>>({});
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeId, setActiveId] = useState("");
  const [ready, setReady] = useState(false);
  const [opening, setOpening] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [assembling, setAssembling] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const savedError = useSyncExternalStore(subscribeCloudError, getCloudError, () => null);
  const applied = useRef(new Set<string>());
  const jobs = useRef<SavedJob[]>([]);
  const loadedFor = useRef(null as string | null);
  /** Set while the tab lets go of a reply to open another chat, so that is not shown as a stop. */
  const detaching = useRef(false);
  const readyRef = useRef(false);
  const modeRef = useRef<"quote" | "design">("quote");
  const { provider, model } = settings;
  const mode = threadMode(threads.find((thread) => thread.id === activeId)?.mode ?? "quote");

  const transport = useMemo(
    () =>
      new DefaultChatTransport<UIMessage>({
        api: "/api/chat",
        body: () => {
          const current = getStudioSettings();
          return {
            document: getBooth(),
            blender: blenderLinked(),
            selection: getSelection(),
            assets: describeAssets(getAssets()),
            costing: getCosting(),
            marginPercent: getJob().margin,
            projectId: getActiveProjectId(),
            chatId: getActiveChatId(),
            files: attachmentPaths(),
            sourceKind: getJob().sourceKind,
            provider: current.provider,
            model: current.model,
            effort: getModelEffort(current.provider, current.model),
            // Sent on Build requests too. The server uses it when the user asks for a simulation.
            imageModel: current.imageModel,
            // Pricing sends "price". Engineering sends "quote", which is what Build sent.
            // An image edit sends "image" for that one request and does not write this.
            mode: requestMode,
          };
        },
      }),
    [],
  );

  const { messages, sendMessage, status, error, setMessages, clearError, stop, addToolOutput } = useChat({
    transport,
    // Continues only after the user answers askUser. A finished server tool step does not start another request,
    // and a message typed into the composer is sent by submit() instead of this automatic resend.
    sendAutomaticallyWhen: ({ messages: history }) =>
      lastAssistantMessageIsCompleteWithToolCalls({ messages: history }) && lastStepResolvedAskUser(history) && !userRepliedInChat(history),
    // The server stores the turn as it streams, so nothing is saved from here.
    onFinish: ({ message, isAbort }) => {
      recordSpend(message.metadata);
      setAssembling(false);
      if (isAbort && !detaching.current) setStopped(true);
      detaching.current = false;
    },
  });
  useLayoutEffect(() => {
    readyRef.current = ready;
    // An image edit does not write requestMode, so the next resend stays on the open mode.
    modeRef.current = mode;
    requestMode = sentMode(mode);
  });

  function markApplied(history: UIMessage[]) {
    for (const message of history) {
      for (const part of message.parts) {
        if (isToolUIPart(part) && part.state === "output-available") applied.current.add(part.toolCallId);
      }
    }
  }

  const providerReady = available[provider] === true;
  const providersLoaded = "google" in available;
  const imageReady = available.google === true;
  const imageKeyMissing = providersLoaded && !imageReady;
  /** The open chat has a reply running on the server that this tab is not streaming: after a reload, or after Stop until the server ends. */
  const [background, setBackground] = useState(false);
  const busy = status === "submitted" || status === "streaming" || background;

  // Follow a reply running on the server: show each stored step, and the drawing and costs it saved.
  useEffect(() => {
    if (!background || !activeId) return;
    const id = activeId;
    let live = true;
    let seen = "";
    const poll = async () => {
      const state = await loadChatState(id);
      if (!live || !state) return;
      const stamp = `${state.messages.length}:${JSON.stringify(state.messages.at(-1) ?? null).length}`;
      if (stamp !== seen) {
        seen = stamp;
        for (const message of state.messages) {
          for (const part of message.parts) {
            if (isToolUIPart(part) && part.state === "output-available") applied.current.add(part.toolCallId);
          }
        }
        setMessages(state.messages);
        void reloadJobWork();
      }
      if (!state.running) {
        setBackground(false);
        void reloadJobWork();
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), BACKGROUND_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [background, activeId, setMessages]);

  useEffect(() => {
    void fetch("/api/providers")
      .then((response) => response.json())
      .then((payload: { available?: Record<string, boolean> }) => setAvailable(payload.available ?? {}))
      .catch(() => setAvailable({}));
  }, []);

  useEffect(() => {
    startCloudSync();
    let cancel = false;
    void openStudio()
      .then((loaded) => {
        if (cancel) return;
        jobs.current = loaded;
        const first = loaded[0];
        showJob(first);
        markApplied(first.messages);
        loadedFor.current = first.chatId;
        setThreads(loaded.map(threadFrom));
        setActiveId(first.chatId);
        setMessages(first.messages);
        setBackground(first.running);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!cancel) {
          setCloudError(error instanceof Error ? error.message : "The jobs could not be loaded.");
          setReady(true);
        }
      });
    return () => {
      cancel = true;
    };
  }, [setMessages]);

  useEffect(() => {
    const saveNow = () => {
      if (readyRef.current) void flushCloud();
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") saveNow();
    };
    window.addEventListener("pagehide", saveNow);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", saveNow);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  useEffect(() => {
    if (!ready || loadedFor.current === activeId) {
      if (loadedFor.current === activeId) loadedFor.current = null;
      return;
    }
    jobs.current = jobs.current.map((job) => (job.chatId === activeId ? { ...job, messages, document: getBooth(), costing: getCosting() } : job));
  }, [messages, activeId, ready]);

  const activeThread = threads.find((thread) => thread.id === activeId);
  const activeTitle = activeThread?.title;
  useEffect(() => {
    if (!ready || !activeId || !activeTitle) return;
    scheduleChatMeta(activeId, { title: activeTitle, mode });
  }, [ready, activeId, activeTitle, mode]);

  useEffect(() => {
    let next: DesignDocument | null = null;
    // The Price panel opens for a priced change only. Drawing and assembly keep the 3D view in front.
    let repriced = false;
    const costChanges: Array<(costing: Costing) => Costing> = [];
    for (const message of messages) {
      for (const part of message.parts) {
        if (!isToolUIPart(part) || part.state !== "output-available") continue;
        const name = getToolName(part);
        if (name === "generateStandImage") {
          if (applied.current.has(part.toolCallId)) continue;
          applied.current.add(part.toolCallId);
          const output = part.output as ToolOutput;
          if (typeof output.image === "string" && output.image.startsWith("data:")) {
            setSimulation(output.image);
          }
          recordSpend(output);
          continue;
        }
        if (name !== "suggestCosts" && name !== "editCosts" && name !== "groupSections" && name !== "priceBoards" && name !== "nameItems" && !(name in DOCUMENT_TOOLS)) continue;
        if (applied.current.has(part.toolCallId)) continue;
        applied.current.add(part.toolCallId);
        const output = part.output as ToolOutput;
        if (name === "groupSections" || name === "nameItems") {
          const grouped = sectionSchema.array().safeParse(output.sections);
          if (grouped.success) setCosting({ ...getCosting(), sections: grouped.data });
          const moved = openDesignDocument(output.document);
          if (moved.status === "ready") next = moved.document;
          continue;
        }
        if (name === "priceBoards") {
          const lines = extraLineSchema.array().safeParse(output.suggestions);
          if (lines.success) costChanges.push((costing) => replaceCutExtras(costing, lines.data));
          const moved = openDesignDocument(output.document);
          if (moved.status === "ready") next = moved.document;
          continue;
        }
        if (name === "suggestCosts") {
          const lines = extraLineSchema.array().safeParse(output.suggestions);
          if (lines.success && lines.data.length > 0) costChanges.push((costing) => addExtras(costing, lines.data));
          const moved = openDesignDocument(output.document);
          if (moved.status === "ready") next = moved.document;
          continue;
        }
        if (name === "editCosts") {
          const edits = costEditSchema.array().safeParse(output.edits);
          if (edits.success && edits.data.length > 0) costChanges.push((costing) => applyCostEdits(costing, edits.data));
          continue;
        }
        const opened = openDesignDocument(output.document);
        if (opened.status === "ready") {
          next = opened.document;
          const edits = costEditSchema.array().safeParse(output.edits);
          if (edits.success && edits.data.length > 0) costChanges.push((costing) => applyCostEdits(costing, edits.data));
          if (name === "inspect" || name === "assemble") recordSpend(output);
          else if (name === "addJobMaterial" || (modeRef.current === "design" && name !== "arrangeParts" && name !== "assemble")) repriced = true;
        }
      }
    }
    if (next) {
      onDocument(next);
      const id = getActiveChatId();
      jobs.current = jobs.current.map((job) => (job.chatId === id ? { ...job, document: next } : job));
      if (repriced) onOpenPanel("cost");
    }
    if (costChanges.length > 0) {
      setCosting(costChanges.reduce((costing, change) => change(costing), getCosting()));
      onOpenPanel("cost");
    }
  }, [messages, onDocument]);

  function rememberCurrent() {
    jobs.current = jobs.current.map((job) =>
      job.chatId === activeId ? { ...job, messages, document: getBooth(), costing: getCosting(), title: threads.find((thread) => thread.id === activeId)?.title ?? job.title, mode } : job,
    );
  }

  /** Leave the open chat. A reply still running keeps going on the server and shows again when the chat is reopened. */
  async function leaveCurrent() {
    setBackground(false);
    if (status === "submitted" || status === "streaming") {
      detaching.current = true;
      await stop();
    }
    rememberCurrent();
    await flushCloud();
  }

  async function openThread(id: string) {
    onFocus();
    if (!ready || opening || id === activeId) return;
    setOpening(true);
    await leaveCurrent();
    const cached = jobs.current.find((job) => job.chatId === id);
    if (!cached) {
      setOpening(false);
      return;
    }
    // The stored chat is the truth. The copy in memory is only used when the database cannot be reached.
    const state = await loadChatState(id);
    const next = state ? { ...cached, messages: state.messages } : cached;
    jobs.current = jobs.current.map((job) => (job.chatId === id ? next : job));
    markApplied(next.messages);
    loadedFor.current = id;
    setActiveId(id);
    showJob(next);
    setMessages(next.messages);
    setStopped(false);
    // The database holds the assembled design. The copy kept while another chat was open can be older.
    void reloadJobWork().then(() => {
      if (getActiveChatId() !== id) return;
      jobs.current = jobs.current.map((job) => (job.chatId === id ? { ...job, document: getBooth(), costing: getCosting() } : job));
    });
    if (state?.running) setBackground(true);
    setOpening(false);
  }

  async function newChat() {
    if (!ready || opening) return;
    await leaveCurrent();
    setStopped(false);
    const created = await createJob({
      title: "New chat",
      mode: "quote",
      document: createEmptyDesign(),
      costing: emptyCosting(),
      client: NO_CLIENT,
      margin: 20,
      sourceKind: "description",
    });
    jobs.current = [created, ...jobs.current];
    const thread = threadFrom(created);
    loadedFor.current = thread.id;
    setThreads((currentThreads) => [thread, ...currentThreads]);
    setActiveId(thread.id);
    showJob(created);
    setMessages([]);
    setText("");
    setAttachments([]);
    setAttachError(null);
    clearError();
    onNewChat?.();
    onFocus();
  }

  async function deleteChat(id: string) {
    const target = threads.find((thread) => thread.id === id);
    if (!target || (busy && id === activeId)) return;
    if (!window.confirm(`Delete “${target.title}”? Its quote, files, and drawing are removed too.`)) return;
    cancelScheduled(`chat:${id}`);
    if (id === activeId) {
      cancelScheduled("design");
      cancelScheduled("costing");
      cancelScheduled("job");
    }
    try {
      await deleteJob(target.projectId);
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : "The chat could not be deleted.");
      return;
    }
    jobs.current = jobs.current.filter((job) => job.chatId !== id);
    const remaining = threads.filter((thread) => thread.id !== id);
    if (remaining.length === 0) {
      const created = await createJob({
        title: "New chat",
        mode: "quote",
        document: createEmptyDesign(),
        costing: emptyCosting(),
        client: NO_CLIENT,
        margin: 20,
        sourceKind: "description",
      });
      jobs.current = [created];
      loadedFor.current = created.chatId;
      setThreads([threadFrom(created)]);
      setActiveId(created.chatId);
      showJob(created);
      setMessages([]);
      onNewChat?.();
      return;
    }
    setThreads(remaining);
    if (id === activeId) {
      const next = jobs.current.find((job) => job.chatId === remaining[0].id) ?? jobs.current[0];
      markApplied(next.messages);
      loadedFor.current = next.chatId;
      setActiveId(next.chatId);
      showJob(next);
      setMessages(next.messages);
    }
  }

  async function ensureJob() {
    const thread = threads.find((item) => item.id === activeId);
    if (thread?.projectId) {
      if (getActiveProjectId() !== thread.projectId) setActiveJob({ projectId: thread.projectId, chatId: thread.id });
      return;
    }
    const loaded = await openStudio();
    const job = loaded.find((item) => item.chatId === activeId) ?? loaded[0];
    if (!job) throw new Error("The job could not be opened.");
    if (getActiveProjectId() !== job.projectId) {
      jobs.current = loaded;
      setThreads(loaded.map(threadFrom));
      showJob(job);
      setReady(true);
      if (job.chatId !== activeId) {
        markApplied(job.messages);
        loadedFor.current = job.chatId;
        setActiveId(job.chatId);
        setMessages(job.messages);
      }
    }
  }

  /** Every request starts here. The server saves the turn to the chat that is open when it is sent. */
  async function send(message: Parameters<typeof sendMessage>[0], options: Parameters<typeof sendMessage>[1]) {
    setStopped(false);
    if (blenderLinked()) {
      const pulled = await pullDesign(getBooth());
      if (pulled && designKey(pulled) !== designKey(getBooth())) {
        markPulled(pulled);
        onDocument(pulled);
        const id = getActiveChatId();
        jobs.current = jobs.current.map((job) => (job.chatId === id ? { ...job, document: pulled } : job));
      }
    }
    await sendMessage(message, options);
  }

  /** Stop ends the reply on the server. The chat follows it until the server has stored where it stopped. */
  function stopReply() {
    if (!busy || !activeId) return;
    void stopChatRun(activeId);
    if (status === "submitted" || status === "streaming") void stop();
    else setStopped(true);
    setBackground(true);
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const trimmed = text.trim();
    const streamingNow = status === "submitted" || status === "streaming";
    const pendingQuestions = openAskUserCallIds(messages);
    if ((!trimmed && attachments.length === 0) || streamingNow || !providerReady) return;
    if (busy && pendingQuestions.length === 0) return;
    clearError();
    if (attachments.length > 0) {
      try {
        await ensureJob();
      } catch (error) {
        setAttachError(error instanceof Error ? error.message : "The job could not be opened.");
        return;
      }
    }
    if (trimmed) {
      setThreads((current) =>
        current.map((thread) =>
          thread.id === activeId && thread.title === "New chat" ? { ...thread, title: trimmed.slice(0, 48) } : thread,
        ),
      );
    }
    let files: { type: "file"; mediaType: string; filename: string; url: string }[] | undefined;
    if (attachments.length > 0) {
      try {
        files = await Promise.all(
          attachments.map(async ({ file }) => {
            await uploadAttachment(file);
            return { type: "file" as const, mediaType: file.type || "image/png", filename: file.name, url: await readFile(file) };
          }),
        );
      } catch (error) {
        setAttachError(error instanceof Error ? error.message : "The file could not be saved.");
        return;
      }
    }
    const mentions = describeSelection(getBooth(), getSelection());
    // A typed message has to close the paused question first. The note tells the model this was not a Skip click.
    if (pendingQuestions.length > 0) {
      setStopped(false);
      setBackground(false);
      for (const toolCallId of pendingQuestions) {
        await addToolOutput({
          tool: "askUser",
          toolCallId,
          output: { answers: [], skipped: true, note: ASK_USER_CHAT_NOTE },
        });
      }
    }
    await send(
      {
        text: trimmed || (modeRef.current === "design" ? "Read the attached file. List the elements with their sizes and materials, and price the job." : "Read the attached file and price the job. Ask if a size or a material is missing."),
        files,
        ...(mentions.length > 0 ? { metadata: { mentions } } : {}),
      },
      { body: { mode: requestMode } },
    );
    setText("");
    setAttachments([]);
    setAttachError(null);
  }

  function addFiles(incoming: File[]) {
    setAttachError(null);
    const accepted: Attachment[] = [];
    let problem: string | null = null;
    for (const file of incoming) {
      const readable = file.type.startsWith("image/") || file.type === "application/pdf";
      if (!readable) problem = `${file.name} is not an image or a PDF.`;
      else if (file.size > MAX_ATTACHMENT_BYTES) problem = `${file.name} is over ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`;
      else accepted.push({ id: createId(), file });
    }
    if (attachments.length + accepted.length > MAX_ATTACHMENTS) problem = `Attach up to ${MAX_ATTACHMENTS} files per message.`;
    setAttachments((current) => [...current, ...accepted].slice(0, MAX_ATTACHMENTS));
    if (problem) setAttachError(problem);
  }

  async function requestSimulationEdit(edit: { instruction: string; region: ImageRegion; baseImage: string; references: { name: string; url: string }[] }) {
    if (busy || !providerReady || !imageReady) return;
    clearError();
    // This request is an image edit. The thread mode stays Engineering, and requestMode is not set to "image".
    // send() merges { mode: "image" } over the transport body for this call only. An automatic resend
    // reads requestMode, which the layout effect keeps on the open mode.
    const placed = edit.references.length > 0 ? "Print the uploaded artwork in that area, fitted to the surface and lit like the rest of the stand." : "";
    const instruction = edit.instruction.trim();
    const text = [regionLine(edit.region), placed, instruction || "Apply the change in that area only."].filter(Boolean).join("\n\n");
    setThreads((current) =>
      current.map((thread) =>
        thread.id === activeId && thread.title === "New chat" ? { ...thread, title: (instruction || "Edit the simulation").slice(0, 48) } : thread,
      ),
    );
    try {
      await ensureJob();
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : "The job could not be opened.");
      return;
    }
    const files = [
      { type: "file" as const, mediaType: "image/png", filename: `simulation-${createId()}.png`, url: edit.baseImage },
      ...edit.references.slice(0, 4).map((file) => ({
        type: "file" as const,
        mediaType: file.url.match(/^data:(image\/[a-z0-9.+-]+);/i)?.[1] || "image/png",
        filename: file.name,
        url: file.url,
      })),
    ];
    for (const part of files) {
      const blob = await fetch(part.url).then((response) => response.blob());
      await uploadAttachment(new File([blob], part.filename, { type: part.mediaType }));
      part.url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }
    await send(
      {
        text,
        files,
        metadata: { simulationEdit: { region: edit.region } },
      },
      { body: { mode: "image" } },
    );
  }

  async function assembleStand() {
    if (busy || !providerReady || getBooth().parts.length === 0) return;
    clearError();
    setAssembling(true);
    try {
      await send({ text: ASSEMBLE_MESSAGE }, { body: { mode: "quote", assemble: true } });
    } finally {
      setAssembling(false);
    }
  }

  async function answerQuestion(toolCallId: string, output: AskUserOutput) {
    const asked = messages.flatMap((message) => message.parts).find((part) => isToolUIPart(part) && part.toolCallId === toolCallId);
    const kept = findingIdsToAccept(asked && isToolUIPart(asked) ? asked.input : undefined, output);
    // The next request reads getBooth() into its body. Accept before that send, or the production-file gate still blocks.
    if (kept.length > 0) {
      const next = kept.reduce((document, id) => acceptFinding(document, id, true), getBooth());
      onDocument(next);
      jobs.current = jobs.current.map((job) => (job.chatId === activeId ? { ...job, document: next } : job));
    }
    setStopped(false);
    setBackground(false);
    await addToolOutput({
      tool: "askUser",
      toolCallId,
      output,
      options: { body: { mode: requestMode } },
    });
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape" && busy) {
      event.preventDefault();
      stopReply();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  const value: ChatContextValue = {
    threads,
    activeId,
    activeTitle: threads.find((thread) => thread.id === activeId)?.title ?? "Chat",
    messages,
    text,
    setText,
    mode,
    setMode: (next) => {
      if (next === "image") return;
      setThreads((current) => current.map((thread) => (thread.id === activeId ? { ...thread, mode: next } : thread)));
    },
    attachments,
    attachError,
    addFiles,
    removeFile: (id) => {
      setAttachError(null);
      setAttachments((current) => current.filter((item) => item.id !== id));
    },
    openPanel: onOpenPanel,
    busy,
    stop: stopReply,
    stopped,
    assembling,
    questionOpen: openAskUserCallIds(messages).length > 0,
    replying: status === "submitted" || status === "streaming",
    ready,
    opening,
    error: error ?? (cloudError || savedError ? new Error(cloudError || savedError || "") : undefined),
    providerReady,
    imageReady,
    imageKeyMissing,
    provider,
    model,
    openThread,
    newChat,
    sceneEmpty,
    deleteChat,
    submit,
    onComposerKeyDown,
    requestSimulationEdit,
    assembleStand,
    answerQuestion,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function ChatList() {
  const { threads, activeId, openThread, deleteChat, busy, ready } = useChatStudio();
  if (!ready) {
    return (
      <ul className="min-h-0 flex-1 space-y-2 overflow-auto px-3 pt-1 pb-3" aria-busy="true" aria-label="Loading chats">
        {[0, 1, 2].map((row) => (
          <li key={row} className="h-7 animate-pulse rounded-lg bg-sidebar-raised" />
        ))}
      </ul>
    );
  }
  return (
    <ul className="min-h-0 flex-1 space-y-px overflow-auto px-2 pb-3">
      {threads.map((thread) => {
        const active = thread.id === activeId;
        return (
          <li key={thread.id} className="group relative flex items-center">
            <button
              type="button"
              onClick={() => openThread(thread.id)}
              className={`flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 py-1.5 pr-8 text-left text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${active ? "bg-sidebar-raised text-ink" : "text-muted hover:bg-sidebar-raised/60 hover:text-ink"}`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${active && busy ? "animate-dot bg-accent" : active ? "bg-accent" : "bg-subtle/60"}`}
              />
              <span className="truncate">{thread.title}</span>
            </button>
            <button
              type="button"
              aria-label={`Delete ${thread.title}`}
              onClick={() => deleteChat(thread.id)}
              className="absolute right-1.5 rounded-md p-1 text-subtle opacity-0 transition-opacity group-hover:opacity-100 hover:bg-ink/10 hover:text-ink focus-visible:opacity-100"
            >
              <X size={12} strokeWidth={2.25} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Ready-made first messages. Each one tells the AI what kind of file it is looking at and what to do with it,
 * and ends on a line the user finishes. They run in Pricing, which prices the job and does not draw it.
 */
const STARTERS: { id: string; label: string; hint: string; Icon: typeof FileText; prompt: string }[] = [
  {
    id: "simulation",
    label: "Simulation",
    hint: "A render or AI image of the stand",
    Icon: ImageIcon,
    prompt:
      "The attached image is a simulation (a render) of the stand. List every element the workshop builds from it, with a size and a material for each, then price the job. There is no scale in a render, so use the reference size below and do not invent other sizes. If I gave none, ask me for one first.\n\nReference size (for example the stand width, or the counter height): ",
  },
  {
    id: "technical",
    label: "Technical file",
    hint: "A drawing, sheet or PDF with dimensions",
    Icon: FileText,
    prompt:
      "The attached file is the technical sheet. Read every dimension, material note, quantity and bill of materials exactly as written, list the elements, then price the job. Sizes written on the sheet are final, so do not change them. If something is unclear or missing, ask me.\n\nExtra details (finish, quantity, anything not on the sheet): ",
  },
  {
    id: "3d",
    label: "3D file",
    hint: "Views or an export of a 3D model",
    Icon: Box,
    prompt:
      "The attached files are views or an export of a 3D model of the stand. Use the views to list every element the workshop builds, with a size and a material for each, then price the job. Use the overall size below to scale the model.\n\nOverall size (width × depth × height) and materials: ",
  },
];

function ModeChoices({ mode, onChange }: { mode: "quote" | "design"; onChange: (mode: "quote" | "design") => void }) {
  const close = useCloseMenu();
  const options = [
    { id: "quote" as const, label: "Pricing", detail: "Price the job. No drawing." },
    { id: "design" as const, label: "Engineering", detail: "Draw the stand and check it." },
  ];
  return (
    <div className="p-1.5">
      {options.map((option) => {
        const selected = mode === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => {
              onChange(option.id);
              close();
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${selected ? "bg-accent-soft font-semibold text-accent" : "text-ink hover:bg-raised"}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block">{option.label}</span>
              <span className="block text-[10px] font-normal text-muted">{option.detail}</span>
            </span>
            {selected ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function ModeMenu({ mode, onChange }: { mode: "quote" | "design"; onChange: (mode: "quote" | "design") => void }) {
  return (
    <Menu label={<span className="text-xs font-medium">{mode === "design" ? "Engineering" : "Pricing"}</span>} side="top" align="left" width="w-56" variant="outline">
      <ModeChoices mode={mode} onChange={onChange} />
    </Menu>
  );
}

function threadFrom(job: SavedJob): Thread {
  const stored = threadMode(job.mode);
  // Old chats were Build but most are stored as quote. Drawn work means this one is Engineering.
  const mode = stored === "quote" && drawnWork(job.document) ? "design" : stored;
  return { id: job.chatId, projectId: job.projectId, title: job.title, mode };
}

function PromptStarters({ onPick }: { onPick: (id: string, prompt: string) => void }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Start from a file type">
      <span className="mr-0.5 text-xs text-subtle">Price from a</span>
      {STARTERS.map(({ id, label, hint, Icon, prompt }) => (
        <button
          key={id}
          type="button"
          title={hint}
          onClick={() => onPick(id, prompt)}
          className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted transition-colors hover:border-line-strong hover:bg-raised hover:text-ink"
        >
          <Icon size={12} strokeWidth={2} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * The conversation, laid out like the Cursor agent window. A new chat is only the composer in the middle
 * of the screen. Once it starts, messages sit in a centered column with the composer docked underneath.
 */
export function ChatConversation({ above }: { above?: ReactNode }) {
  const chat = useChatStudio();
  const empty = chat.messages.length === 0 && !chat.opening;
  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight });
  }, [chat.messages, chat.busy]);
  const design = useSyncExternalStore(subscribeBooth, getBooth, getServerBooth);
  const selection = useSyncExternalStore(subscribeSelection, getSelection, getServerSelection);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);

  const mentions = useMemo(() => describeSelection(design, selection), [design, selection]);

  const trigger = useMemo(() => {
    const before = chat.text.slice(0, caret);
    const match = /(^|\s)@([^\s@]*)$/.exec(before);
    return match ? { start: before.length - match[2].length - 1, query: match[2] } : null;
  }, [chat.text, caret]);
  const options = useMemo(() => (trigger ? mentionOptions(design, trigger.query) : []), [design, trigger]);
  const pickerOpen = trigger !== null && dismissed !== trigger.start && options.length > 0;
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));

  function removeMention(mention: Mention) {
    setSelection(selection.filter((id) => !mention.ids.includes(id)));
  }

  function chooseOption(option: MentionOption) {
    if (!trigger) return;
    const before = chat.text.slice(0, trigger.start);
    const after = chat.text.slice(caret);
    const inserted = `@${option.label} `;
    chat.setText(before + inserted + after);
    setSelection([...selection, ...option.ids]);
    const position = before.length + inserted.length;
    requestAnimationFrame(() => {
      const field = textareaRef.current;
      if (!field) return;
      field.focus();
      field.setSelectionRange(position, position);
      setCaret(position);
    });
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (pickerOpen && trigger) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setActive((activeIndex + step + options.length) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        chooseOption(options[activeIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(trigger.start);
        return;
      }
    }
    chat.onComposerKeyDown(event);
  }

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Put the ready-made message in the box (above anything already typed), switch to pricing, and ask for the file if none is attached yet.
  function useStarter(id: string, prompt: string) {
    chat.setMode("quote");
    setJob({ sourceKind: id === "3d" ? "3d_file" : id === "simulation" || id === "technical" ? id : "description" });
    const current = chat.text.trim();
    const alreadyThere = STARTERS.some((item) => current.startsWith(item.prompt.slice(0, 40)));
    chat.setText(current && !alreadyThere ? `${prompt}\n\n${current}` : prompt);
    requestAnimationFrame(() => {
      const field = textareaRef.current;
      if (field) {
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
        field.scrollTop = field.scrollHeight;
      }
      if (chat.attachments.length === 0) fileInputRef.current?.click();
    });
  }

  const canSend = chat.providerReady && (!chat.busy || (chat.questionOpen && !chat.replying)) && (chat.text.trim().length > 0 || chat.attachments.length > 0);

  const composer = (
    <form onSubmit={chat.submit} className="relative">
      {pickerOpen ? (
        <ul
          role="listbox"
          aria-label="Mention a piece"
          className="animate-pop absolute right-0 bottom-full left-0 z-20 mb-2 max-h-64 origin-bottom overflow-auto rounded-xl border border-line bg-panel p-1.5 shadow-pop"
        >
          <li className="eyebrow px-2.5 pt-1 pb-1.5">Mention a piece</li>
          {options.map((option, index) => (
            <li key={option.id} role="option" aria-selected={index === activeIndex}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => chooseOption(option)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${index === activeIndex ? "bg-raised text-ink" : "text-ink hover:bg-raised"}`}
              >
                <span
                  className={`h-3 w-3 shrink-0 rounded-full border border-line ${option.kind === "group" ? "ring-2 ring-accent/30" : ""}`}
                  style={{ background: option.color ?? "#c5d2f6" }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                <span className="font-mono text-[11px] text-muted">{option.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="rounded-2xl border border-line-strong bg-panel shadow-soft transition-[border-color] focus-within:border-subtle">
        {chat.attachments.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 px-3 pt-3">
            {chat.attachments.map(({ id, file }) => {
              const Icon = file.type === "application/pdf" ? FileText : ImageIcon;
              return (
                <li key={id} className="flex max-w-56 items-center gap-1.5 rounded-lg border border-line bg-raised px-2 py-1 text-xs text-ink">
                  <Icon size={13} className="shrink-0 text-muted" aria-hidden="true" />
                  <span className="truncate">{file.name}</span>
                  <button type="button" aria-label={`Remove ${file.name}`} className="shrink-0 rounded p-0.5 text-muted hover:text-ink" onClick={() => chat.removeFile(id)}>
                    <X size={12} strokeWidth={2.25} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {mentions.length > 0 ? (
          <div className="px-3 pt-3">
            <MentionChips mentions={mentions} onRemove={removeMention} />
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          value={chat.text}
          onChange={(event) => {
            chat.setText(event.target.value);
            setCaret(event.target.selectionStart);
            setActive(0);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onComposerKeyDown}
          rows={empty ? (chat.text.length > 160 ? 7 : 3) : 2}
          placeholder={
            chat.mode === "quote"
              ? empty
                ? "Describe the job or attach a file, and Pricing will ask what is missing."
                : "Add a detail, or say what to change in the price."
              : empty
                ? "Describe the job, attach a sheet, or ask for a simulation picture. @ to mention a piece"
                : mentions.length > 0
                  ? "Say what to change on the selected piece"
                  : "Ask for a change, a simulation picture, or more details"
          }
          aria-describedby="composer-hint"
          className="w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] leading-6 text-ink outline-none placeholder:text-subtle"
        />
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 px-2.5 pb-2.5">
          <div className="flex min-w-0 items-center gap-1">
            <label
              title="Attach a technical sheet, PDF or image"
              className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-line-strong text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              <Plus size={15} strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">Attach a file</span>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                multiple
                className="sr-only"
                onChange={(event) => {
                  chat.addFiles(Array.from(event.target.files ?? []));
                  event.target.value = "";
                }}
              />
            </label>
            <ModeMenu mode={chat.mode === "design" ? "design" : "quote"} onChange={chat.setMode} />
          </div>
          <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
            <EffortControl />
            <ModelPicker side="top" align="right" />
            {chat.busy && !(chat.questionOpen && !chat.replying) ? (
              <button
                type="button"
                aria-label="Stop"
                title="Stop (Esc)"
                onClick={chat.stop}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-bg transition-opacity hover:opacity-85"
              >
                <Square size={10} fill="currentColor" strokeWidth={0} aria-hidden="true" />
              </button>
            ) : (
              <button
                type="submit"
                aria-label="Send"
                disabled={!canSend}
                className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-bg transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ArrowUp size={15} strokeWidth={2.5} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
      <p id="composer-hint" className="mt-2 px-1 text-xs text-muted">
        Enter to send · Shift+Enter for a new line
      </p>
      {chat.attachError ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-danger">
          <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          {chat.attachError}
        </p>
      ) : null}
      {!chat.providerReady ? (
        <p className="mt-2 px-1 text-xs text-muted">The selected model has no key yet. Pick another model, or add its key to .env.local.</p>
      ) : null}
      {chat.imageKeyMissing && chat.mode !== "quote" ? (
        <p className="mt-2 px-1 text-xs text-muted">
          Add <span className="font-mono">{providerById("google")?.env ?? "GOOGLE_GENERATIVE_AI_API_KEY"}</span> to .env.local and restart to generate or edit a simulation picture.
        </p>
      ) : null}
    </form>
  );

  if (!chat.ready || chat.opening) {
    return (
      <section className="flex h-full min-h-0 flex-col items-center justify-center gap-3" aria-busy="true">
        <Loader2 size={18} className="animate-spin text-muted" aria-hidden="true" />
        <p className="text-sm text-muted">{chat.opening ? "Opening the chat…" : "Loading chats…"}</p>
      </section>
    );
  }

  if (empty) {
    return (
      <section className="flex h-full min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6">
          <div className="w-full max-w-[640px]">
            {above ? <div className="mb-2.5 flex flex-wrap items-center gap-1.5">{above}</div> : null}
            <PromptStarters onPick={useStarter} />
            {composer}
            {chat.error ? (
              <p className="mt-3 flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-danger">
                <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                {chat.error.message}
              </p>
            ) : null}
          </div>
        </div>
        <p className="shrink-0 px-6 pb-6 text-center text-xs text-subtle">
          {chat.mode === "quote"
            ? "Pricing reads the file or the chat, asks what is missing, and builds the quotation."
            : "Engineering prices the job, draws the stand, assembles it, and runs the production check."}
        </p>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div ref={scrollerRef} className="min-h-0 flex-1 overflow-auto px-5">
        <div className="mx-auto w-full max-w-3xl space-y-5 py-6">
          {chat.messages.map((message) =>
            message.role === "user" ? (
              <article key={message.id} className="animate-rise ml-auto w-fit max-w-[85%] space-y-2 rounded-2xl bg-raised px-4 py-2.5 text-[15px] leading-6 break-words text-ink">
                <MentionChips mentions={readMentions(message.metadata)} />
                {message.parts.map((part, index) => {
                  if (part.type === "text") return <p key={index} className="whitespace-pre-wrap">{part.text}</p>;
                  if (part.type === "file") {
                    const pdf = part.mediaType === "application/pdf";
                    const Icon = pdf ? FileText : ImageIcon;
                    return (
                      <p key={index} className="flex items-center gap-1.5 text-xs text-muted">
                        <Icon size={13} className="shrink-0" aria-hidden="true" />
                        <span className="truncate">{part.filename ?? (pdf ? "PDF" : "Reference image")}</span>
                      </p>
                    );
                  }
                  return null;
                })}
              </article>
            ) : (
              <AssistantMessage key={message.id} message={message} live={chat.busy && !chat.questionOpen && message === chat.messages.at(-1)} openPanel={chat.openPanel} onAnswer={chat.answerQuestion} pricing={chat.mode === "quote"} />
            ),
          )}
          {chat.busy && !chat.questionOpen ? (
            <WorkingBar activity={currentActivity(chat.messages)} pulse={progressPulse(chat.messages)} onStop={chat.stop} />
          ) : chat.stopped ? (
            <p className="flex items-center gap-2 px-1 text-[13px] text-muted">
              <CircleSlash size={13} className="shrink-0" aria-hidden="true" />
              Stopped. Changes made before you stopped are kept.
            </p>
          ) : null}
          {chat.error ? (
            <p className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-soft px-3 py-2.5 text-sm text-danger">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              {chat.error.message}
            </p>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 px-5 pb-4">
        <div className="mx-auto w-full max-w-3xl">{composer}</div>
      </div>
    </section>
  );
}

/** Tools the user does not need a line for, named only while they run. */
const QUIET_TOOLS: Record<string, string> = {
  getDesign: "Reading the design…",
  listCatalog: "Checking the catalog…",
  listTemplates: "Checking the templates…",
};

const WORKING_LABEL: Record<string, string> = {
  ...QUIET_TOOLS,
  ...Object.fromEntries(Object.entries(DOCUMENT_TOOLS).map(([name, labels]) => [name, labels.working])),
  suggestCosts: "Pricing the job…",
  priceBoards: "Pricing the boards…",
  editCosts: "Changing the cost…",
  groupSections: "Building the quotation…",
  nameItems: "Renaming items…",
  generateStandImage: "Generating the simulation…",
};

/** If nothing new arrives for this long, the user is reminded they can stop. */
const QUIET_MS = 20_000;

type StepState = "working" | "done" | "failed" | "stopped";
type Step = { label: string; state: StepState; action?: { label: string; onClick: () => void } };
type MessagePart = UIMessage["parts"][number];

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/** One finished or running tool call, as a line the user can read. */
function describeStep(part: MessagePart, live: boolean, openPanel: (panel: ChatPanel) => void, pricing = false): Step | null {
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part);
  if (name === "askUser" || name in QUIET_TOOLS) return null;
  if (part.state === "output-error") return { label: part.errorText || "This step failed.", state: "failed" };
  if (part.state !== "output-available") {
    const label = WORKING_LABEL[name] ?? "Working…";
    return live ? { label, state: "working" } : { label: `${label.replace(/…$/, "")}, stopped`, state: "stopped" };
  }
  const output = (part.output ?? {}) as ToolOutput;
  if (output.error) return { label: output.error, state: "failed" };
  const viewPrice = { label: "View price", onClick: () => openPanel("cost") };

  if (name === "generateStandImage") return { label: "Simulation ready", state: "done", ...(pricing ? {} : { action: { label: "View simulation", onClick: () => openPanel("simulation") } }) };
  if (name === "priceBoards") {
    return { label: `Boards priced · ${formatCents(output.totalCents ?? 0)}`, state: "done", action: viewPrice };
  }
  if (name === "nameItems") {
    return { label: "Items renamed", state: "done", action: viewPrice };
  }
  if (name === "suggestCosts") {
    const count = Array.isArray(output.suggestions) ? output.suggestions.length : 0;
    if (count === 0) return { label: "Nothing new to price", state: "done" };
    const estimated = output.estimated ? ` · ${output.estimated} estimated` : "";
    return { label: `${plural(count, "cost line")} priced · ${formatCents(output.totalCents ?? 0)}${estimated}`, state: "done", action: viewPrice };
  }
  if (name === "editCosts") {
    const count = output.done?.length ?? 0;
    return count > 0 ? { label: `${plural(count, "cost line")} changed`, state: "done", action: viewPrice } : { label: "No cost line changed", state: "failed" };
  }
  if (name === "groupSections") {
    const rows = Array.isArray(output.sections) ? output.sections.length : 0;
    return { label: `Quotation built · ${plural(rows, "row")}`, state: "done", action: viewPrice };
  }
  if (name === "arrangeParts" || name === "assemble") {
    const problems = (output.check?.overlaps?.length ?? 0) + (output.check?.floating?.length ?? 0);
    const rejected = output.rejected?.length ?? 0;
    const placed = output.placed ?? 0;
    const notes = [`${plural(placed, "piece")} placed`, rejected ? `${rejected} not placed` : "", problems ? `${plural(problems, "fix", "fixes")} needed` : ""].filter(Boolean);
    const label = `${placed > 0 ? "Stand assembled" : "Nothing placed"} · ${notes.join(" · ")}`;
    return { label: name === "assemble" ? withDuration(label, output.ms) : label, state: placed > 0 ? "done" : "failed" };
  }
  if (name === "inspect") {
    const findings = output.inspection?.findings?.length ?? 0;
    return { label: inspectionLine(findings, output.ms), state: "done", ...(pricing ? {} : { action: { label: "View checks", onClick: () => openPanel("checks") } }) };
  }
  if (name === "addJobMaterial") {
    const input = part.input as { name?: unknown } | undefined;
    const material = typeof input?.name === "string" && input.name.trim() ? input.name.trim() : "new sheet";
    return { label: `Material added by estimate · ${material}`, state: "done" };
  }
  const labels = DOCUMENT_TOOLS[name];
  if (!labels) return null;
  const errors = output.issues?.filter((issue) => issue.severity === "error").length ?? 0;
  const skipped = (output.locked?.length ?? 0) + (output.missing?.length ?? 0);
  const boards = output.boards?.length
    ? output.boards.map((board) => `${board.unit === "board" ? plural(board.boards, "board") : `${board.boards} m²`} ${formatCents(board.totalCents)}`).join(", ")
    : "";
  const notes = [output.ids && labels.panel ? String(output.ids.length) : "", boards, errors ? plural(errors, "error") : "", skipped ? `${skipped} skipped` : ""].filter(Boolean);
  return {
    label: [labels.done, ...notes].join(" · "),
    state: errors > 0 ? "failed" : "done",
    action: labels.panel ? { label: "View elements", onClick: () => openPanel(labels.panel!) } : viewPrice,
  };
}

type Segment =
  | { kind: "text"; key: string; text: string }
  | { kind: "steps"; key: string; steps: Step[] }
  | { kind: "thinking"; key: string; text: string; live: boolean }
  | { kind: "question"; key: string; part: MessagePart };

/** A reply: its text, with each run of tool calls folded into one group. Questions stay as their own card. */
function AssistantMessage({
  message,
  live,
  openPanel,
  onAnswer,
  pricing,
}: {
  message: UIMessage;
  live: boolean;
  openPanel: (panel: ChatPanel) => void;
  onAnswer: (toolCallId: string, output: AskUserOutput) => Promise<void>;
  pricing: boolean;
}) {
  const segments: Segment[] = [];
  message.parts.forEach((part, index) => {
    if (part.type === "text") {
      if (part.text.trim()) segments.push({ kind: "text", key: `text-${index}`, text: part.text });
      return;
    }
    if (part.type === "reasoning") {
      if (part.text.trim()) segments.push({ kind: "thinking", key: `thinking-${index}`, text: part.text.trim(), live: live && part.state === "streaming" });
      return;
    }
    if (isToolUIPart(part) && getToolName(part) === "askUser") {
      segments.push({ kind: "question", key: part.toolCallId, part });
      return;
    }
    const step = describeStep(part, live, openPanel, pricing);
    if (!step) return;
    const last = segments.at(-1);
    if (last?.kind === "steps") last.steps.push(step);
    else segments.push({ kind: "steps", key: `steps-${index}`, steps: [step] });
  });
  if (segments.length === 0) return null;
  return (
    <article className="animate-rise space-y-2 px-1 text-[15px] leading-7 text-ink">
      {segments.map((segment) => {
        if (segment.kind === "text") return <ReplyText key={segment.key} text={segment.text} />;
        if (segment.kind === "thinking") return <Thinking key={segment.key} text={segment.text} live={segment.live} />;
        if (segment.kind === "question" && isToolUIPart(segment.part)) {
          const toolCallId = segment.part.toolCallId;
          return <QuestionCard key={segment.key} part={segment.part} onAnswer={(output) => onAnswer(toolCallId, output)} />;
        }
        if (segment.kind === "steps") return <StepGroup key={segment.key} steps={segment.steps} />;
        return null;
      })}
    </article>
  );
}

/** Assistant text, with list lines given a little more room than the paragraphs around them. */
function ReplyText({ text }: { text: string }) {
  const blocks: Array<{ kind: "text"; text: string } | { kind: "list"; ordered: boolean; items: string[] }> = [];
  let prose: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushProse = () => {
    if (prose.some((line) => line.trim())) blocks.push({ kind: "text", text: prose.join("\n") });
    prose = [];
  };
  const flushList = () => {
    if (list && list.items.length > 0) blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  for (const line of text.split("\n")) {
    const bullet = /^\s*[-*•]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const item = bullet ? { ordered: false, text: bullet[1] } : numbered ? { ordered: true, text: numbered[1] } : null;
    if (item) {
      flushProse();
      if (list && list.ordered !== item.ordered) flushList();
      list = list ?? { ordered: item.ordered, items: [] };
      list.items.push(item.text);
      continue;
    }
    flushList();
    prose.push(line);
  }
  flushList();
  flushProse();
  return (
    <div>
      {blocks.map((block, index) =>
        block.kind === "text" ? (
          <p key={index} className="whitespace-pre-wrap">
            {block.text}
          </p>
        ) : block.ordered ? (
          <ol key={index} className="my-1.5 list-decimal space-y-1.5 pl-5 marker:text-muted">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="whitespace-pre-wrap">
                {item}
              </li>
            ))}
          </ol>
        ) : (
          <ul key={index} className="my-1.5 list-disc space-y-1.5 pl-5 marker:text-muted">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} className="whitespace-pre-wrap">
                {item}
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

/** The model's summarized thinking. The latest line shows while it thinks; open it to read all of it. */
function Thinking({ text, live }: { text: string; live: boolean }) {
  const latest = text.split("\n").findLast((line) => line.trim())?.trim() ?? "";
  return (
    <details className="group/thinking">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] leading-5 text-muted marker:hidden [&::-webkit-details-marker]:hidden">
        {live ? <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden="true" /> : <Brain size={13} className="shrink-0" aria-hidden="true" />}
        <span className="shrink-0">{live ? "Thinking" : "Thought"}</span>
        <span className="min-w-0 truncate text-subtle group-open/thinking:hidden">{latest}</span>
        <ChevronRight size={12} className="shrink-0 text-subtle transition-transform group-open/thinking:rotate-90" aria-hidden="true" />
      </summary>
      <p className="mt-1.5 ml-1.5 max-h-72 overflow-y-auto border-l border-line pl-3.5 text-[13px] leading-5 whitespace-pre-wrap text-muted">{text}</p>
    </details>
  );
}

/** Several steps in a row show as one line: what is happening now, or how it ended. Open it to see each step. */
function StepGroup({ steps }: { steps: Step[] }) {
  if (steps.length === 1) return <StepLine step={steps[0]} />;
  const headline = steps.findLast((step) => step.state === "working") ?? steps.find((step) => step.state === "failed") ?? steps.at(-1)!;
  const action = steps.findLast((step) => step.action)?.action;
  return (
    <details className="group/steps">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-5 text-muted marker:hidden [&::-webkit-details-marker]:hidden">
        <StepIcon state={headline.state} />
        <span className={headline.state === "failed" ? "text-danger" : ""}>{headline.label}</span>
        <span className="flex items-center gap-0.5 text-subtle">
          {plural(steps.length, "step")}
          <ChevronRight size={12} className="transition-transform group-open/steps:rotate-90" aria-hidden="true" />
        </span>
        {action ? (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              action.onClick();
            }}
            className="font-medium text-accent hover:underline"
          >
            {action.label}
          </button>
        ) : null}
      </summary>
      <div className="mt-1.5 ml-1.5 space-y-1 border-l border-line pl-3.5">
        {steps.map((step, index) => (
          <StepLine key={index} step={{ ...step, action: undefined }} />
        ))}
      </div>
    </details>
  );
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "working") return <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden="true" />;
  if (state === "failed") return <AlertCircle size={13} className="shrink-0 text-danger" aria-hidden="true" />;
  if (state === "stopped") return <CircleSlash size={13} className="shrink-0" aria-hidden="true" />;
  return <CheckCircle2 size={13} className="shrink-0 text-success" aria-hidden="true" />;
}

/** One line for something the assistant did: what happened, and a link to see it. */
function StepLine({ step }: { step: Step }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] leading-5 text-muted">
      <StepIcon state={step.state} />
      <span className={step.state === "failed" ? "text-danger" : ""}>{step.label}</span>
      {step.action ? (
        <button type="button" onClick={step.action.onClick} className="font-medium text-accent hover:underline">
          {step.action.label}
        </button>
      ) : null}
    </p>
  );
}

/** What the assistant is doing right now, in words. */
function currentActivity(messages: UIMessage[]) {
  const last = messages.at(-1);
  if (!last || last.role !== "assistant") return "Reading your message…";
  const part = last.parts.findLast((item) => item.type === "text" || item.type === "reasoning" || isToolUIPart(item));
  if (!part) return "Thinking…";
  if (part.type === "reasoning") return "Thinking…";
  if (part.type === "text") return "Writing the reply…";
  if (isToolUIPart(part) && part.state !== "output-available" && part.state !== "output-error") return WORKING_LABEL[getToolName(part)] ?? "Working…";
  return "Deciding the next step…";
}

/** Changes whenever the reply moves forward, so a quiet stretch can be noticed. */
function progressPulse(messages: UIMessage[]) {
  const last = messages.at(-1);
  if (!last) return "0";
  const tail = last.parts.at(-1);
  const progress = !tail ? "" : tail.type === "text" || tail.type === "reasoning" ? tail.text.length : isToolUIPart(tail) ? tail.state : tail.type;
  return `${messages.length}:${last.parts.length}:${progress}`;
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Shown while a reply runs: what is happening, for how long, and a way to stop it. */
function WorkingBar({ activity, pulse, onStop }: { activity: string; pulse: string; onStop: () => void }) {
  const now = useNow();
  const [started] = useState(now);
  const [seen, setSeen] = useState({ pulse, at: now });
  if (seen.pulse !== pulse) setSeen({ pulse, at: now });
  const quiet = now - seen.at > QUIET_MS;
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1 text-[13px] text-muted">
      <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden="true" />
      <span role="status" className="text-ink">
        {activity}
      </span>
      <span className="font-mono text-[12px] text-subtle tabular-nums">{clock(Math.max(0, Math.floor((now - started) / 1000)))}</span>
      {quiet ? <span className="text-subtle">Still working. You can stop at any time.</span> : null}
      <button type="button" onClick={onStop} className="ml-auto flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-xs text-muted transition-colors hover:bg-raised hover:text-ink">
        <Square size={8} fill="currentColor" strokeWidth={0} aria-hidden="true" />
        Stop
      </button>
    </div>
  );
}

function MentionChips({
  mentions,
  onRemove,
  onAccent = false,
}: {
  mentions: Mention[];
  onRemove?: (mention: Mention) => void;
  onAccent?: boolean;
}) {
  if (mentions.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {mentions.map((mention) => (
        <li
          key={mention.id}
          title={mention.kind === "group" ? `${mention.ids.length} pieces` : mention.label}
          className={`flex max-w-full items-center gap-1.5 rounded-full py-0.5 pr-1 pl-2 text-xs font-medium ${
            onAccent ? "bg-white/20 text-white" : "border border-accent-line bg-accent-soft text-accent"
          } ${onRemove ? "" : "pr-2"}`}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${mention.kind === "group" ? "ring-2 ring-current/30" : ""}`}
            style={{ background: mention.color ?? "currentColor" }}
            aria-hidden="true"
          />
          <span className="truncate">{mention.label}</span>
          {mention.kind === "group" ? <span className="shrink-0 opacity-70">· {mention.ids.length}</span> : null}
          {onRemove ? (
            <button
              type="button"
              aria-label={`Stop talking about ${mention.label}`}
              onClick={() => onRemove(mention)}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent/15"
            >
              <X size={11} strokeWidth={2.5} aria-hidden="true" />
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function createId() {
  return crypto.randomUUID();
}

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
