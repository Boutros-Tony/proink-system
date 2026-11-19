import { readDesignBody } from "@/lib/files/read-design";
import { buildTechnicalPdf, type ArtworkFile } from "@/lib/production/technical-pdf";
import { seedCatalog } from "@/lib/systems/catalog";
import { loadShopPriceBook, requireStudio } from "@/lib/studio/server-data";
import { produceDesign } from "@/lib/systems/modular/produce";
import { hasBlockingIssues } from "@/lib/systems/modular/validate";

export async function POST(request: Request) {
  const body = (await request.json()) as { document?: unknown; artwork?: unknown; jobTitle?: unknown; clientName?: unknown };
  if (!(await requireStudio())) return Response.json({ error: "Sign in required." }, { status: 401 });
  const design = readDesignBody(body.document);
  if ("error" in design) return Response.json({ error: design.error }, { status: design.status });

  const production = produceDesign(design.document, seedCatalog(), await loadShopPriceBook());
  if (hasBlockingIssues(production.issues)) {
    return Response.json({ error: "Fix the errors in Checks before downloading the technical file.", issues: production.issues }, { status: 422 });
  }

  // Pictures come from the browser's library. Keep only well-formed PNG or JPEG data URLs.
  const artwork = (Array.isArray(body.artwork) ? body.artwork : []).flatMap((item): ArtworkFile[] => {
    const file = item as Partial<ArtworkFile> | null;
    if (!file || typeof file.id !== "string" || typeof file.name !== "string" || typeof file.dataUrl !== "string") return [];
    if (!/^data:image\/(png|jpeg);base64,/.test(file.dataUrl)) return [];
    return [{ id: file.id, name: file.name, dataUrl: file.dataUrl, width: Number(file.width) || 0, height: Number(file.height) || 0 }];
  });

  const jobTitle = typeof body.jobTitle === "string" && body.jobTitle.trim() ? body.jobTitle.trim().slice(0, 120) : "Exhibition booth";
  const clientName = typeof body.clientName === "string" ? body.clientName.trim().slice(0, 120) : "";
  const pdf = await buildTechnicalPdf({ document: design.document, production, jobTitle, clientName, artwork });
  const slug = jobTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "stand";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="proink-technical-${slug}.pdf"`,
    },
  });
}
