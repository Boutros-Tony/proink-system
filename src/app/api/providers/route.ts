import { PROVIDERS } from "@/lib/ai/models";
import { requireStudio } from "@/lib/studio/server-data";

export async function GET() {
  if (!(await requireStudio())) return Response.json({ error: "Sign in required." }, { status: 401 });
  return Response.json({
    available: Object.fromEntries(PROVIDERS.map((provider) => [provider.id, Boolean(process.env[provider.env])])),
  });
}
