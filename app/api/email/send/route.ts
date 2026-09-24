import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { encodeBase64Url, getEmailConnection, getGoogleAccessToken, getOwnerEmail, gmailFetch } from "@/lib/gmail";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const user = await getAuthorizedChatGPTUser();
    if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
    const ownerEmail = getOwnerEmail(user.email);
    const body = await request.json() as Record<string, unknown>;
    const connection = await getEmailConnection(ownerEmail, text(body.connectionId, 80) || undefined);
    if (!connection.scopes?.includes("https://www.googleapis.com/auth/gmail.send")) return Response.json({ error: "Autorisation d'envoi absente. Reconnectez le compte Google." }, { status: 409 });
    const recipient = text(body.to, 320);
    const subject = text(body.subject, 240);
    const messageBody = textMultiline(body.body, 12000);
    if (!recipient || !/^\S+@\S+\.\S+$/.test(recipient)) return Response.json({ error: "Destinataire invalide." }, { status: 400 });
    if (!subject || !messageBody) return Response.json({ error: "L'objet et le message sont obligatoires." }, { status: 400 });
    const token = await getGoogleAccessToken(connection);
    const raw = [
      `From: ${connection.display_name ? `${connection.display_name} <${connection.email_address}>` : connection.email_address}`,
      `To: ${recipient}`,
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
      "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", messageBody,
    ].join("\r\n");
    const response = await gmailFetch(token, "messages/send", { method: "POST", body: JSON.stringify({ raw: encodeBase64Url(raw), threadId: text(body.threadId, 100) || undefined }) });
    const sent = await response.json() as { id?: string; threadId?: string };
    const lead = await findLead(text(body.leadId, 240));
    const workspaceId = lead?.workspace_id || await getDefaultWorkspace();
    const workspaceResponse = await supabaseRest(`workspaces?id=eq.${encodeURIComponent(workspaceId)}&select=slug&limit=1`);
    const workspaceRows = await workspaceResponse.json() as Array<{ slug: string }>;
    if (!canAccessWorkspace(user, normalizeWorkspace(workspaceRows[0]?.slug))) return Response.json({ error: "Espace non autorisé." }, { status: 403 });
    const suppression = await supabaseRest(`suppression_list?workspace_id=eq.${encodeURIComponent(workspaceId)}&email=ilike.${encodeURIComponent(recipient)}&select=id&limit=1`);
    if (suppression.ok && ((await suppression.json()) as unknown[]).length) return Response.json({ error: "Destinataire présent dans la liste d'opposition." }, { status: 409 });
    const tracking = await supabaseRest("outbound_messages", {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ workspace_id: workspaceId, lead_id: lead?.id || null, channel: "email", provider: "gmail", provider_message_id: sent.id || null, recipient, subject, body: messageBody, status: "sent", sent_at: new Date().toISOString(), metadata: { threadId: sent.threadId || null, sender: connection.email_address } }),
    });
    return Response.json({ ok: true, messageId: sent.id, threadId: sent.threadId, tracked: tracking.ok });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Envoi Gmail impossible." }, { status: 503 });
  }
}

async function findLead(externalId: string | null) {
  if (!externalId) return null;
  const params = new URLSearchParams({ select: "id,workspace_id", external_id: `eq.${externalId}`, limit: "1" });
  const response = await supabaseRest(`leads?${params}`);
  if (!response.ok) return null;
  return ((await response.json()) as Array<{ id: string; workspace_id: string }>)[0] || null;
}
async function getDefaultWorkspace() {
  const response = await supabaseRest("workspaces?slug=eq.net-ai&select=id&limit=1");
  const rows = response.ok ? await response.json() as Array<{ id: string }> : [];
  if (!rows[0]?.id) throw new Error("Espace Net.AI introuvable dans Supabase.");
  return rows[0].id;
}
function text(value: unknown, max: number) { return typeof value === "string" ? value.replace(/[\r\n<>]/g, " ").trim().slice(0, max) : null; }
function textMultiline(value: unknown, max: number) { return typeof value === "string" ? value.replace(/[<>]/g, "").trim().slice(0, max) : null; }
