import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { requireEmailAccount } from "@/lib/email-crm";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const connectionId = new URL(request.url).searchParams.get("connectionId")?.trim();
  if (!connectionId) return Response.json({ error: "Compte Google absent." }, { status: 400 });
  try { await requireEmailAccount(user, connectionId); } catch { return Response.json({ error: "Compte non autorisé." }, { status: 403 }); }
  const response = await supabaseRest(`email_accounts?id=eq.${encodeURIComponent(connectionId)}&owner_email=eq.${encodeURIComponent(user.email.trim().toLowerCase())}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "revoked", updated_at: new Date().toISOString() }) });
  if (!response.ok) return Response.json({ error: "Impossible de déconnecter ce compte." }, { status: 503 });
  return Response.json({ ok: true });
}
