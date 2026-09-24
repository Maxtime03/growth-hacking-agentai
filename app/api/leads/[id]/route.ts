import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const id = (await params).id.trim();
  const response = await supabaseRest(`leads?id=eq.${encodeURIComponent(id)}&select=*`);
  if (!response.ok) return Response.json({ error: "Lecture du lead impossible." }, { status: 503 });
  const rows = await response.json() as Array<Record<string, unknown>>;
  if (!rows[0]) return Response.json({ error: "Lead introuvable." }, { status: 404 });
  const workspaceResponse = await supabaseRest(`workspaces?id=eq.${encodeURIComponent(String(rows[0].workspace_id || ""))}&select=slug&limit=1`);
  const workspaceRows = await workspaceResponse.json() as Array<{ slug: string }>;
  if (!canAccessWorkspace(user, normalizeWorkspace(workspaceRows[0]?.slug))) return Response.json({ error: "Lead introuvable." }, { status: 404 });
  return Response.json({ item: rows[0] });
}
