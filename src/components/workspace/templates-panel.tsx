"use client";

import { ArrowLeft, Armchair, Frame, LayoutTemplate, Plus, Store, Tent, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { DesignDocument } from "@/lib/systems/modular/schema";
import {
  applyTemplate,
  defaultValues,
  resolveValues,
  TEMPLATES,
  type Template,
  type TemplateCategory,
  type TemplateMode,
  type TemplateResult,
  type TemplateValues,
} from "@/lib/systems/templates";

const CATEGORY_ICON: Record<TemplateCategory, LucideIcon> = {
  Booths: Tent,
  Stands: Store,
  Furniture: Armchair,
  Display: Frame,
  Signage: LayoutTemplate,
};

const CATEGORY_ORDER: TemplateCategory[] = ["Booths", "Stands", "Furniture", "Display", "Signage"];

export function TemplatesPanel({
  document,
  onApply,
}: {
  document: DesignDocument;
  onApply: (result: TemplateResult, template: Template) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = TEMPLATES.find((template) => template.id === activeId) ?? null;
  if (active) {
    return <TemplateForm key={active.id} template={active} document={document} onBack={() => setActiveId(null)} onApply={onApply} />;
  }
  return (
    <div className="pb-6">
      <p className="px-4 pt-4 pb-1 text-xs leading-5 text-muted">
        Start from a template, then change anything by hand or in the chat. Every step can be undone.
      </p>
      {CATEGORY_ORDER.map((category) => {
        const items = TEMPLATES.filter((template) => template.category === category);
        if (items.length === 0) return null;
        const Icon = CATEGORY_ICON[category];
        return (
          <section key={category}>
            <p className="eyebrow px-4 pt-4 pb-2">{category}</p>
            <div className="space-y-2 px-4">
              {items.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setActiveId(template.id)}
                  className="group flex w-full items-start gap-3 rounded-xl border border-line bg-panel px-3.5 py-3 text-left shadow-soft transition-all hover:-translate-y-px hover:border-accent-line hover:bg-accent-soft/40 hover:shadow-float"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <Icon size={16} strokeWidth={2} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{template.name}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted">{template.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TemplateForm({
  template,
  document,
  onBack,
  onApply,
}: {
  template: Template;
  document: DesignDocument;
  onBack: () => void;
  onApply: (result: TemplateResult, template: Template) => void;
}) {
  const [values, setValues] = useState<TemplateValues>(() => defaultValues(template));
  const hasContent = document.parts.length > 0 || document.walls.some((wall) => wall.bays.length > 0);
  const canAdd = template.kind === "parts" && hasContent;

  function apply(mode: TemplateMode) {
    onApply(applyTemplate(document, template, resolveValues(template, values), mode), template);
  }

  return (
    <div className="pb-6">
      <button type="button" onClick={onBack} className="btn btn-ghost mx-3 mt-3 gap-1.5 px-2.5 py-1.5 text-xs">
        <ArrowLeft size={14} strokeWidth={2.25} aria-hidden="true" />
        All templates
      </button>
      <div className="px-4 pt-3">
        <p className="text-[15px] font-semibold tracking-tight">{template.name}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{template.description}</p>
      </div>
      <div className="mt-4 space-y-4 px-4">
        {template.params.map((param) =>
          param.toggle ? (
            <label key={param.key} className="flex cursor-pointer items-center justify-between gap-3">
              <span className="eyebrow">{param.label}</span>
              <button
                type="button"
                role="switch"
                aria-checked={values[param.key] >= 1}
                onClick={() => setValues((current) => ({ ...current, [param.key]: current[param.key] >= 1 ? 0 : 1 }))}
                className={`relative h-6 w-10 rounded-full transition-colors ${values[param.key] >= 1 ? "bg-accent" : "bg-line-strong"}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-soft transition-transform ${values[param.key] >= 1 ? "translate-x-4" : ""}`}
                />
              </button>
            </label>
          ) : (
            <label key={param.key} className="block">
              <span className="flex items-baseline justify-between">
                <span className="eyebrow">{param.label}</span>
                <span className="font-mono text-[12px] text-ink">
                  {values[param.key]}
                  {param.unit ? ` ${param.unit === "count" ? "" : param.unit}` : ""}
                </span>
              </span>
              <input
                type="range"
                min={param.min}
                max={param.max}
                step={param.step}
                value={values[param.key]}
                onChange={(event) => setValues((current) => ({ ...current, [param.key]: Number(event.target.value) }))}
                className="mt-2 w-full accent-[var(--color-accent)]"
              />
            </label>
          ),
        )}
      </div>
      <div className="mt-6 space-y-2 px-4">
        <button type="button" onClick={() => apply("replace")} className="btn btn-primary w-full py-2.5">
          <LayoutTemplate size={15} strokeWidth={2.25} aria-hidden="true" />
          {hasContent ? "Replace canvas" : "Start from this"}
        </button>
        {template.kind === "parts" ? (
          <button type="button" disabled={!canAdd} onClick={() => apply("add")} className="btn btn-secondary w-full py-2.5">
            <Plus size={15} strokeWidth={2.25} aria-hidden="true" />
            Add to canvas
          </button>
        ) : (
          <p className="text-xs leading-5 text-muted">Booth templates always start a new canvas. Custom pieces can be added to the booth afterwards.</p>
        )}
        {hasContent ? <p className="text-xs leading-5 text-muted">Replace canvas clears what is drawn. Undo brings it back.</p> : null}
      </div>
    </div>
  );
}
