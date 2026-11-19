import { requestStop } from "@/lib/studio/server-data";

/** The Stop button. The reply runs on the server, so closing the connection alone does not end it. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { chatId?: unknown } | null;
  if (typeof body?.chatId !== "string" || !body.chatId) return Response.json({ error: "Choose a chat." }, { status: 400 });
  if (!(await requestStop(body.chatId))) return Response.json({ error: "Sign in required." }, { status: 401 });
  return Response.json({ ok: true });
}
