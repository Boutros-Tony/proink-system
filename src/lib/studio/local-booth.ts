import { createEmptyDesign } from "../systems/modular/patch";
import type { DesignDocument } from "../systems/modular/schema";
import { DEFAULT_IMAGE_MODEL, findImageModel, providerById, type Effort, type ProviderId } from "../ai/models";
import { commitHistory, createHistory, redoHistory, undoHistory, type CommitOptions, type History } from "./history";

const serverBooth = createEmptyDesign();
let history: History<DesignDocument> = createHistory(serverBooth);
const boothListeners = new Set<() => void>();

export type HistoryState = { canUndo: boolean; canRedo: boolean };
const serverHistoryState: HistoryState = { canUndo: false, canRedo: false };
let historyState: HistoryState = serverHistoryState;

function publish() {
  const next = { canUndo: history.past.length > 0, canRedo: history.future.length > 0 };
  if (next.canUndo !== historyState.canUndo || next.canRedo !== historyState.canRedo) historyState = next;
  boothListeners.forEach((listener) => listener());
}

export function getBooth() {
  return history.present;
}

export function getServerBooth() {
  return serverBooth;
}

/** Save a new version of the design. Every call is one undo step unless `key` joins it to the previous one. */
export function setBooth(next: DesignDocument, options?: CommitOptions) {
  const updated = commitHistory(history, next, options);
  if (updated === history) return;
  history = updated;
  publish();
}

/** Open a saved design. This replaces the canvas and does not count as an edit, so undo stays inside the job. */
export function replaceBooth(next: DesignDocument) {
  history = createHistory(next);
  historyState = serverHistoryState;
  publish();
}

export function undoBooth() {
  const updated = undoHistory(history);
  if (updated === history) return;
  history = updated;
  publish();
}

export function redoBooth() {
  const updated = redoHistory(history);
  if (updated === history) return;
  history = updated;
  publish();
}

export function getHistoryState() {
  return historyState;
}

export function getServerHistoryState() {
  return serverHistoryState;
}

export function subscribeBooth(listener: () => void) {
  boothListeners.add(listener);
  return () => {
    boothListeners.delete(listener);
  };
}

export type StudioSettings = { provider: ProviderId; model: string; imageModel: string };

const serverSettings: StudioSettings = { provider: "openai", model: "gpt-4o", imageModel: DEFAULT_IMAGE_MODEL };
let settings = serverSettings;
let settingsHydrated = false;
const settingsListeners = new Set<() => void>();

// Retired ids move to the current model. Google 2.5 is gone, and the old Fable/Opus row was Opus 4.1.
function migrateModel(model: string | null) {
  if (!model) return model;
  if (model === "claude-opus-4-1") return "claude-opus-5-5";
  if (model.startsWith("gemini-2.5-pro")) return "gemini-3.5-pro";
  if (model.startsWith("gemini-2.")) return "gemini-3.8-flash";
  return model;
}

function hydrateSettings() {
  if (settingsHydrated || typeof window === "undefined") return;
  settingsHydrated = true;
  const saved = localStorage.getItem("proink-provider");
  const savedModel = localStorage.getItem("proink-model");
  const savedImage = localStorage.getItem("proink-image-model");
  if (saved !== "openai" && saved !== "anthropic" && saved !== "google") {
    settings = { ...settings, imageModel: findImageModel(savedImage ?? "").model };
    return;
  }
  settings = {
    provider: saved,
    model: migrateModel(savedModel) || providerById(saved)?.defaultModel || serverSettings.model,
    imageModel: findImageModel(savedImage ?? "").model,
  };
}

export function getStudioSettings() {
  hydrateSettings();
  return settings;
}

export function getServerSettings() {
  return serverSettings;
}

export function setStudioSettings(next: StudioSettings) {
  settings = { ...next, imageModel: findImageModel(next.imageModel).model };
  localStorage.setItem("proink-provider", settings.provider);
  localStorage.setItem("proink-model", settings.model);
  localStorage.setItem("proink-image-model", settings.imageModel);
  settingsListeners.forEach((listener) => listener());
}

export function subscribeSettings(listener: () => void) {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}

const serverEffort: Effort = "medium";
const effortListeners = new Set<() => void>();

function effortStorageKey(provider: string, model: string) {
  return `proink-effort:${provider}:${model}`;
}

export function getModelEffort(provider: string, model: string): Effort {
  if (typeof window === "undefined") return serverEffort;
  const saved = localStorage.getItem(effortStorageKey(provider, model));
  return saved === "low" || saved === "high" || saved === "medium" ? saved : serverEffort;
}

export function getServerEffort() {
  return serverEffort;
}

export function setModelEffort(provider: string, model: string, effort: Effort) {
  localStorage.setItem(effortStorageKey(provider, model), effort);
  effortListeners.forEach((listener) => listener());
}

export function subscribeEffort(listener: () => void) {
  effortListeners.add(listener);
  return () => {
    effortListeners.delete(listener);
  };
}
