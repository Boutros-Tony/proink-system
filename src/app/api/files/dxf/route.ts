import JSZip from "jszip";
import { readDesignBody } from "@/lib/files/read-design";
import { cuttingDxfFiles } from "@/lib/production/dxf";
import { loadShopPriceBook, requireStudio } from "@/lib/studio/server-data";
import { seedCatalog } from "@/lib/systems/catalog";
import { produceDesign } from "@/lib/systems/modular/produce";
import { hasBlockingIssues } from "@/lib/systems/modular/validate";

export async function POST(request: Request) {
  const body = (await request.json()) as { document?: unknown };
  if (!(await requireStudio())) return Response.json({ error: "Sign in required." }, { status: 401 });
  const design = readDesignBody(body.document);
  if ("error" in design) return Response.json({ error: design.error }, { status: design.status });

  const priceBook = await loadShopPriceBook();
  const production = produceDesign(design.document, seedCatalog(), priceBook);
  if (hasBlockingIssues(production.issues)) {
    return Response.json({ error: "Fix the errors in Checks before exporting cut files." }, { status: 422 });
  }

  const files = cuttingDxfFiles(production.cutting);
  if (files.length === 0) {
    return Response.json({ error: "There is nothing cut from board in this stand." }, { status: 422 });
  }
  if (files.length === 1) {
    return new Response(files[0].text, {
      headers: {
        "Content-Type": "application/dxf",
        "Content-Disposition": `attachment; filename="${files[0].name}"`,
      },
    });
  }

  const zip = new JSZip();
  for (const file of files) zip.file(file.name, file.text);
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="proink-cnc-files.zip"',
    },
  });
}
