import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { getEmailConnection, getGoogleAccessToken, getOwnerEmail, gmailFetch } from "@/lib/gmail";
import { supabaseRest } from "@/lib/email-connections";

export const dynamic = "force-dynamic";

type GmailMessage = { id: string; threadId: string; snippet?: string; internalDate?: string; labelIds?: string[]; payload?: { headers?: Array<{ name: string; value: string }> } };

export async function GET(request: Request) {
  try {
    const user = await getAuthorizedChatGPTUser();
    if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
    const ownerEmail = getOwnerEmail(user.email);
    const url = new URL(request.url);
    const connection = await getEmailConnection(ownerEmail, url.searchParams.get("connectionId") || undefined);
    if (!connection.scopes?.includes("https://www.googleapis.com/auth/gmail.readonly")) {
      return Response.json({ error: "Ce compte a été connecté avant l'activation de la lecture Gmail. Reconnectez-le une fois." }, { status: 409 });
    }
    const token = await getGoogleAccessToken(connection);
    const threadId = url.searchParams.get("threadId")?.trim();
    const query = url.searchParams.get("q")?.trim() || "newer_than:60d";
    const pageToken = url.searchParams.get("pageToken")?.trim();
    const listResponse = threadId
      ? await gmailFetch(token, `threads/${encodeURIComponent(threadId)}?format=full`)
      : await gmailFetch(token, `messages?maxResults=30&q=${encodeURIComponent(query)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    const list = await listResponse.json() as { messages?: Array<{ id: string }>; nextPageToken?: string; threadId?: string; payload?: unknown };
    if (threadId) {
      const messages = flattenThread(list);
      return Response.json({ connection: { id: connection.id, email: connection.email_address, displayName: connection.display_name }, items: normalizeMessages(messages, connection.email_address), nextPageToken: null });
    }
    const messages = await Promise.all((list.messages || []).map(async ({ id }) => {
      const response = await gmailFetch(token, `messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`);
      return await response.json() as GmailMessage;
    }));
    const normalized = normalizeMessages(messages, connection.email_address);
    await supabaseRest(`email_connections?id=eq.${encodeURIComponent(connection.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_sync_at: new Date().toISOString(), updated_at: new Date().toISOString() }) });
    return Response.json({ connection: { id: connection.id, email: connection.email_address, displayName: connection.display_name }, items: normalized, nextPageToken: list.nextPageToken || null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Boîte Gmail indisponible." }, { status: 503 });
  }
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
