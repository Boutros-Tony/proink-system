import { pastQuoteText, pastQuotesAvailable } from "@/lib/archive/past-quotes";
import { requireStudio } from "@/lib/studio/server-data";

export async function GET(request: Request) {
  if (!(await requireStudio())) return Response.json({ error: "Sign in required." }, { status: 401 });
  if (!pastQuotesAvailable()) return Response.json({ error: "Not found." }, { status: 404 });
  const sha1 = new URL(request.url).searchParams.get("sha1")?.trim() ?? "";
  if (!sha1 || sha1.length > 128) return Response.json({ error: "Choose a proforma." }, { status: 400 });
  return Response.json({ text: pastQuoteText(sha1) });
}
