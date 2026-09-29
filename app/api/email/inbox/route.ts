import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { requireEmailAccount } from "@/lib/email-crm";
import { supabaseRest } from "@/lib/email-connections";

export const dynamic = "force-dynamic";

type GmailMessage = { id: string; threadId: string; snippet?: string; internalDate?: string; labelIds?: string[]; payload?: { headers?: Array<{ name: string; value: string }> } };

export async function GET(request: Request) {
  try {
    const user = await getAuthorizedChatGPTUser();
    if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
    const url = new URL(request.url);
    const accountId=url.searchParams.get("connectionId")||"";
    const {account,workspaceIds}=await requireEmailAccount(user,accountId);
    const threadId = url.searchParams.get("threadId")?.trim();
    if(threadId){const thread=await supabaseRest(`email_threads?account_id=eq.${account.id}&gmail_thread_id=eq.${encodeURIComponent(threadId)}&workspace_id=in.(${workspaceIds.join(",")})&select=*,leads(id,company_name,legal_name,email)&limit=1`);const threads=thread.ok?await thread.json() as Array<Record<string,unknown>>:[];if(!threads[0])return Response.json({error:"Conversation introuvable."},{status:404});const messages=await supabaseRest(`email_messages?email_thread_id=eq.${threads[0].id}&select=*,email_attachments(*)&order=sent_at.asc`);return Response.json({thread:threads[0],items:messages.ok?await messages.json():[]});}
    const filter=url.searchParams.get("filter")||"all";const before=url.searchParams.get("before");const clauses=[`account_id=eq.${account.id}`,`workspace_id=in.(${workspaceIds.join(",")})`];if(before)clauses.push(`last_message_at=lt.${encodeURIComponent(before)}`);if(filter==="unread")clauses.push("unread=eq.true");else if(filter==="unmatched")clauses.push("needs_association=eq.true");else if(filter!=="all")clauses.push(`classification=eq.${encodeURIComponent(filter)}`);const response=await supabaseRest(`email_threads?${clauses.join("&")}&select=*,leads(id,company_name,legal_name,email)&order=last_message_at.desc&limit=30`);if(!response.ok)throw new Error(`Lecture CRM impossible (${response.status}).`);const items=await response.json() as Array<Record<string,unknown>>;return Response.json({connection:{id:account.id,email:account.email_address,displayName:account.display_name},items,nextCursor:items.length===30?items[29].last_message_at:null});
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Boîte Gmail indisponible." }, { status: 503 });
  }
}

async function handleInbound(connectionId: string, item: ReturnType<typeof normalizeMessages>[number]) {
  const workspaceResponse = await supabaseRest("email_connections?id=eq." + encodeURIComponent(connectionId) + "&select=owner_email");
  if (!workspaceResponse.ok) return;
  await supabaseRest("email_messages", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ connection_id: connectionId, provider_message_id: item.id, thread_id: item.threadId, direction: "inbound", classification: item.classification, subject: item.subject, snippet: item.snippet, has_attachments: item.hasAttachments }) });
  const queued = await supabaseRest(`outbound_messages?metadata->>threadId=eq.${encodeURIComponent(item.threadId)}&status=eq.queued&select=id,workspace_id,recipient`);
  const rows = queued.ok ? await queued.json() as Array<{ id: string; workspace_id: string; recipient: string }> : [];
  for (const row of rows) await supabaseRest(`outbound_messages?id=eq.${encodeURIComponent(row.id)}&status=eq.queued`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "cancelled", stop_reason: `Réponse entrante: ${item.classification}`, triggered_by_message_id: item.id }) });
  if (item.classification === "negative" && rows[0]?.recipient) await supabaseRest("suppression_list", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ workspace_id: rows[0].workspace_id, email: rows[0].recipient, reason: "Réponse négative ou désinscription" }) });
}

function flattenThread(value: { messages?: Array<Record<string, unknown>>; payload?: unknown }) {
  return Array.isArray(value.messages) ? value.messages as GmailMessage[] : [];
}

function normalizeMessages(messages: GmailMessage[], ownerEmail: string) {
  return messages.map((message) => {
    const headers = Object.fromEntries((message.payload?.headers || []).map((item) => [item.name.toLowerCase(), item.value]));
    const inbound = !String(headers.from || "").toLowerCase().includes(ownerEmail.toLowerCase());
    const classification = inbound ? classifyReply(`${headers.subject || ""} ${message.snippet || ""}`) : "sent";
    return {
      id: message.id, threadId: message.threadId, from: headers.from || "", to: headers.to || "",
      subject: headers.subject || "(sans objet)", date: headers.date || message.internalDate || "",
      snippet: message.snippet || "", unread: message.labelIds?.includes("UNREAD") || false,
      hasAttachments: hasAttachments(message.payload), direction: inbound ? "inbound" : "outbound",
      classification, nextAction: inbound ? nextAction(classification) : "Attendre ou programmer une relance",
    };
  });
}

function hasAttachments(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const item = value as { filename?: unknown; body?: { attachmentId?: unknown }; parts?: unknown[] };
  if (typeof item.filename === "string" && item.filename.length > 0 && item.body?.attachmentId) return true;
  return Array.isArray(item.parts) && item.parts.some(hasAttachments);
}

function classifyReply(value: string) {
  const text = value.toLowerCase();
  if (/désolé|pas intéress|non merci|refus|retirez|unsubscribe|désabonn/.test(text)) return "negative";
  if (/oui|intéress|rendez-vous|disponible|appel|rencontr|calendrier|merci pour/.test(text)) return "positive";
  if (/\?|pouvez-vous|combien|quel prix|information|précis/.test(text)) return "question";
  return "neutral";
}
function nextAction(classification: string) {
  if (classification === "positive") return "Répondre aujourd'hui et proposer deux créneaux";
  if (classification === "negative") return "Clôturer proprement et noter la raison";
  if (classification === "question") return "Répondre avec une preuve concise puis proposer un échange";
  return "Lire la réponse et qualifier manuellement";
}
