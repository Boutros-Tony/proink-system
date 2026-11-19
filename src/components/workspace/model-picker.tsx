"use client";

import { Check, Sparkles, Zap } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Menu, useCloseMenu } from "@/components/workspace/menu";
import {
  EFFORTS,
  findImageModel,
  findModelOption,
  IMAGE_MODEL_CATALOG,
  MODEL_CATALOG,
  providerById,
  supportsEffort,
  type ModelOption,
  type ProviderId,
} from "@/lib/ai/models";
import { getModelEffort, getServerEffort, getServerSettings, getStudioSettings, setModelEffort, setStudioSettings, subscribeEffort, subscribeSettings } from "@/lib/studio/local-booth";

/**
 * Choose the AI model from two curated tiers: Premium and Fast & Economical.
 * The chat, the cost check, and every other AI feature share this selection.
 */
export function EffortControl() {
  const settings = useSyncExternalStore(subscribeSettings, getStudioSettings, getServerSettings);
  const effort = useSyncExternalStore(subscribeEffort, () => getModelEffort(settings.provider, settings.model), getServerEffort);
  if (!supportsEffort(settings.provider, settings.model)) return null;
  return (
    <div role="group" aria-label="Reasoning effort" title="Higher thinks longer and costs more" className="inline-flex h-[30px] rounded-[10px] border border-line bg-panel p-0.5 shadow-soft">
      {EFFORTS.map((item) => {
        const active = effort === item;
        const label = item === "low" ? "Low" : item === "medium" ? "Medium" : "High";
        return (
          <button
            key={item}
            type="button"
            aria-pressed={active}
            onClick={() => setModelEffort(settings.provider, settings.model, item)}
            className={`rounded-lg px-3 text-xs font-semibold transition-colors ${active ? "bg-accent-soft text-accent" : "text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export function ModelPicker({
  side = "bottom",
  align = "left",
  variant = "ghost",
  purpose = "chat",
}: {
  side?: "top" | "bottom";
  align?: "left" | "right";
  variant?: "ghost" | "outline";
  /** "image" lists Google's image models. The default lists the language models. */
  purpose?: "chat" | "image";
}) {
  const settings = useSyncExternalStore(subscribeSettings, getStudioSettings, getServerSettings);
  const activeOption = purpose === "image" ? findImageModel(settings.imageModel) : findModelOption(settings.provider, settings.model);

  return (
    <Menu
      label={
        <span className="flex max-w-44 items-center gap-1.5 truncate text-xs font-medium">
          <span className="truncate">{activeOption.label}</span>
        </span>
      }
      side={side}
      align={align}
      width="w-72"
      variant={variant}
    >
      {purpose === "image" ? (
        <ImageModelMenu model={settings.imageModel} />
      ) : (
        <ModelMenu provider={settings.provider} model={settings.model} imageModel={settings.imageModel} />
      )}
    </Menu>
  );
}

function ModelMenu({ provider, model, imageModel }: { provider: ProviderId; model: string; imageModel: string }) {
  const close = useCloseMenu();
  const [available, setAvailable] = useState<Record<string, boolean> | null>(null);
  const selectedProvider = providerById(provider);

  useEffect(() => {
    void fetch("/api/providers")
      .then((response) => response.json())
      .then((payload: { available?: Record<string, boolean> }) => setAvailable(payload.available ?? {}))
      .catch(() => setAvailable({}));
  }, []);

  const premiumModels = MODEL_CATALOG.filter((item) => item.tier === "premium");
  const standardModels = MODEL_CATALOG.filter((item) => item.tier === "standard");

  function choose(option: ModelOption) {
    setStudioSettings({ provider: option.provider, model: option.model, imageModel });
    close();
  }

  return (
    <div className="p-2">
      <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-1.5">
        <Sparkles size={12} className="text-muted" aria-hidden="true" />
        <p className="eyebrow text-ink">Premium</p>
        <span className="ml-auto text-[10px] text-muted">High accuracy</span>
      </div>
      <div className="space-y-0.5">
        {premiumModels.map((item) => {
          const isSelected = provider === item.provider && model === item.model;
          const ready = available === null || available[item.provider] === true;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => choose(item)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                isSelected ? "bg-accent-soft font-semibold text-accent" : "text-ink hover:bg-raised"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.label}</span>
                <span className="block text-[10px] text-muted">
                  {item.providerLabel}
                  {!ready ? " · Key missing" : ""}
                </span>
              </span>
              {isSelected ? <Check size={14} strokeWidth={2.5} className="shrink-0 text-accent" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      <div className="my-2 h-px bg-line" />

      <div className="flex items-center gap-1.5 px-2.5 pt-0.5 pb-1.5">
        <Zap size={12} className="text-muted" aria-hidden="true" />
        <p className="eyebrow text-ink">Fast & Economical</p>
        <span className="ml-auto text-[10px] text-muted">Normal use</span>
      </div>
      <div className="space-y-0.5">
        {standardModels.map((item) => {
          const isSelected = provider === item.provider && model === item.model;
          const ready = available === null || available[item.provider] === true;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => choose(item)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                isSelected ? "bg-accent-soft font-semibold text-accent" : "text-ink hover:bg-raised"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.label}</span>
                <span className="block text-[10px] text-muted">
                  {item.providerLabel}
                  {!ready ? " · Key missing" : ""}
                </span>
              </span>
              {isSelected ? <Check size={14} strokeWidth={2.5} className="shrink-0 text-accent" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>

      {selectedProvider && available !== null && available[provider] !== true ? (
        <p className="mx-1 mt-2.5 rounded-lg bg-raised px-2.5 py-2 text-[11px] leading-4 text-muted">
          Add <span className="font-mono">{selectedProvider.env}</span> to .env.local and restart to run {selectedProvider.label}.
        </p>
      ) : null}
    </div>
  );
}

const IMAGE_NOTES: Record<string, string> = {
  "gemini-3-pro-image": "Highest quality",
  "gemini-nano-banana-2.1": "Best everyday",
};

function ImageModelMenu({ model }: { model: string }) {
  const close = useCloseMenu();
  const settings = useSyncExternalStore(subscribeSettings, getStudioSettings, getServerSettings);
  const [available, setAvailable] = useState<Record<string, boolean> | null>(null);
  const google = providerById("google");

  useEffect(() => {
    void fetch("/api/providers")
      .then((response) => response.json())
      .then((payload: { available?: Record<string, boolean> }) => setAvailable(payload.available ?? {}))
      .catch(() => setAvailable({}));
  }, []);

  const ready = available === null || available.google === true;

  function choose(option: ModelOption) {
    setStudioSettings({ provider: settings.provider, model: settings.model, imageModel: option.model });
    close();
  }

  return (
    <div className="p-2">
      <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-1.5">
        <Sparkles size={12} className="text-muted" aria-hidden="true" />
        <p className="eyebrow text-ink">Google image</p>
      </div>
      <div className="space-y-0.5">
        {IMAGE_MODEL_CATALOG.map((item) => {
          const isSelected = model === item.model;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => choose(item)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                isSelected ? "bg-accent-soft font-semibold text-accent" : "text-ink hover:bg-raised"
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{item.label}</span>
                <span className="block text-[10px] text-muted">
                  {IMAGE_NOTES[item.model]}
                  {!ready ? " · Key missing" : ""}
                </span>
              </span>
              {isSelected ? <Check size={14} strokeWidth={2.5} className="shrink-0 text-accent" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      {google && available !== null && available.google !== true ? (
        <p className="mx-1 mt-2.5 rounded-lg bg-raised px-2.5 py-2 text-[11px] leading-4 text-muted">
          Add <span className="font-mono">{google.env}</span> to .env.local and restart to generate images.
        </p>
      ) : null}
    </div>
  );
}
