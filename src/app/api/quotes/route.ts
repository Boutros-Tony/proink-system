import { buildQuotationPdf } from "@/lib/production/pdf";
import { quotationFigures } from "@/lib/production/quotation";
import { readDesignBody } from "@/lib/files/read-design";
import { loadShopPriceBook, requireStudio } from "@/lib/studio/server-data";
import { readCosting } from "@/lib/systems/costing";
import { sectionCostCents, sectionMark } from "@/lib/systems/sections";
import type { SupabaseClient } from "@supabase/supabase-js";

const STATUSES = new Set(["draft", "sent", "won", "lost", "cancelled"]);

export async function GET(request: Request) {
  const gate = await requireStudio();
  if (!gate) return Response.json({ error: "Sign in required." }, { status: 401 });
  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return Response.json({ error: "Choose a job first." }, { status: 400 });
  const { data, error } = await gate.supabase
    .from("studio_quotations")
    .select("id, ref, revision, status, title, grand_total_cents, issued_at")
    .eq("project_id", projectId)
    .order("issued_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ quotes: data ?? [] });
}

export async function PATCH(request: Request) {
  const gate = await requireStudio();
  if (!gate) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = (await request.json()) as { id?: string; status?: string };
  if (!body.id || !body.status || !STATUSES.has(body.status)) {
    return Response.json({ error: "Choose a status." }, { status: 400 });
  }
  const { error } = await gate.supabase.from("studio_quotations").update({ status: body.status }).eq("id", body.id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const gate = await requireStudio();
  if (!gate) return Response.json({ error: "Sign in required." }, { status: 401 });
  const body = (await request.json()) as {
    document?: unknown;
    marginPercent?: number;
    jobTitle?: string;
    clientName?: string;
    projectId?: string;
    costing?: unknown;
    sourceKind?: string;
  };
  const design = readDesignBody(body.document);
  if ("error" in design) return Response.json({ error: design.error }, { status: design.status });
  if (!body.projectId) return Response.json({ error: "Open a saved job before issuing a quotation." }, { status: 400 });

  const book = await loadShopPriceBook();
  const margin = clampMargin(body.marginPercent);
  const figures = quotationFigures(design.document, body.costing, book, margin);
  if (figures.sections.length === 0) {
    return Response.json({ error: "Add the stand or its costs before issuing a quotation." }, { status: 422 });
  }

  const costing = readCosting(body.costing);
  const previous = await gate.supabase
    .from("studio_quotations")
    .select("ref, revision")
    .eq("project_id", body.projectId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ref = previous.data?.ref || (await nextRef(gate.supabase as SupabaseClient));
  const revision = (previous.data?.revision ?? 0) + 1;
  const issuedAt = new Date();
  const title = costing.quote.title.trim() || body.jobTitle?.trim() || "Exhibition stand";

  const { data: quotation, error } = await gate.supabase
    .from("studio_quotations")
    .insert({
      project_id: body.projectId,
      ref,
      revision,
      status: "draft",
      origin: "studio",
      source_kind: body.sourceKind || "description",
      title,
      client_name: body.clientName?.trim() || "",
      attention: costing.quote.attention,
      currency: "USD",
      vat_percent: costing.quote.vatPercent,
      cost_cents: figures.costCents,
      sell_cents: figures.sellCents,
      vat_cents: figures.vatCents,
      grand_total_cents: figures.grandTotalCents,
      validity_days: costing.quote.validityDays,
      payment_terms: costing.quote.paymentTerms,
      production_days: costing.quote.productionDays,
      notes: costing.quote.notes,
      margin_percent: margin,
      design: design.document,
      price_book: book,
      issued_at: issuedAt.toISOString(),
    })
    .select("id")
    .single();
  if (error || !quotation) return Response.json({ error: error?.message ?? "The quotation could not be saved." }, { status: 400 });

  const sectionRows = figures.sections.map((section, index) => ({
    quotation_id: quotation.id,
    seq: index + 1,
    code: sectionMark(figures.sections, index),
    kind: section.kind,
    title: section.title,
    measure_qty: section.measureQty,
    measure_unit: section.measureUnit,
    specs: section.specs,
    includes: section.includes,
    excludes: section.excludes,
    sell_cents: section.sellCents,
    cost_cents: sectionCostCents(section, figures.lines),
  }));
  const inserted = await gate.supabase.from("studio_quotation_sections").insert(sectionRows).select("id, seq");
  if (inserted.error || !inserted.data) return Response.json({ error: inserted.error?.message ?? "The sections could not be saved." }, { status: 400 });
  const sectionId = new Map(inserted.data.map((row) => [row.seq as number, row.id as string]));

  const elements = figures.sections.flatMap((section, index) =>
    design.document.parts
      .filter((part) => section.partIds.includes(part.id))
      .map((part) => ({
        quotation_id: quotation.id,
        section_id: sectionId.get(index + 1),
        name: part.name,
        kind: part.kind ?? "built",
        shape: part.shape,
        width_mm: part.width,
        height_mm: part.height,
        depth_mm: part.depth,
        quantity: 1,
        material: part.material ?? null,
        finish: part.color ?? null,
        letters_text: part.label ?? null,
        estimated: false,
      })),
  );
  if (elements.length > 0) {
    const elementInsert = await gate.supabase.from("studio_quotation_elements").insert(elements);
    if (elementInsert.error) return Response.json({ error: elementInsert.error.message }, { status: 400 });
  }

  // A board shared by two items is stored once per item, at that item's share, so totals are not counted twice.
  const lineRows = figures.sections.flatMap((section, index) => {
    const share = new Map(section.allocations.map((row) => [row.key, row.cents]));
    return figures.lines
      .filter((line) => section.lineKeys.includes(line.key) && !line.excluded)
      .map((line) => {
        const cents = share.get(line.key) ?? line.totalCents;
        const part = line.totalCents > 0 ? cents / line.totalCents : 1;
        return {
          quotation_id: quotation.id,
          section_id: sectionId.get(index + 1),
          group: line.group,
          description: line.description,
          quantity: Math.round(line.quantity * part * 1000) / 1000,
          unit: line.unit,
          unit_cost_cents: line.unitCostCents,
          total_cost_cents: cents,
          source: line.source,
          ref: line.ref ?? null,
          reason: line.reason ?? null,
        };
      });
  });
  if (lineRows.length > 0) {
    const lineInsert = await gate.supabase.from("studio_quotation_lines").insert(lineRows);
    if (lineInsert.error) return Response.json({ error: lineInsert.error.message }, { status: 400 });
  }

  const pdf = await buildQuotationPdf({
    ref: revision > 1 ? `${ref} rev ${revision}` : ref,
    issuedAt,
    jobTitle: title,
    clientName: body.clientName?.trim() || "Client",
    document: design.document,
    quote: costing.quote,
    sections: figures.sections,
    sellCents: figures.sellCents,
    vatCents: figures.vatCents,
    grandTotalCents: figures.grandTotalCents,
  });
  const path = `${body.projectId}/${ref}-r${revision}.pdf`;
  const uploaded = await gate.supabase.storage.from("studio-quotations").upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (!uploaded.error) {
    await gate.supabase.from("studio_quotations").update({ pdf_path: path }).eq("id", quotation.id);
  }

  const filename = `${ref}${revision > 1 ? `-r${revision}` : ""}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Quote-Ref": ref,
    },
  });
}

async function nextRef(supabase: SupabaseClient) {
  const { data } = await supabase.from("studio_quotations").select("ref").like("ref", "PI%");
  let highest = 117326;
  for (const row of data ?? []) {
    const value = Number(String(row.ref).replace(/^PI/, ""));
    if (Number.isFinite(value) && value > highest) highest = value;
  }
  return `PI${highest + 1}`;
}

function clampMargin(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 20;
  return Math.min(100, Math.max(0, value));
}
