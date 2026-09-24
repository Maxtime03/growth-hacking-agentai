import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";

export const dynamic = "force-dynamic";
export async function GET() {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const ownerEmail = user.email.trim().toLowerCase();
  try {
    const params = new URLSearchParams({ select: "id,provider,email_address,display_name,status,scopes,last_sync_at,created_at", owner_email: `eq.${ownerEmail}`, order: "created_at.desc" });
    const response = await supabaseRest(`email_connections?${params}`);
    if (!response.ok) throw new Error(`Lecture Supabase impossible (${response.status}).`);
    const items = await response.json() as Array<{ scopes?: string[] | null }>;
    return Response.json({ items: items.map((item) => ({ ...item, canRead: item.scopes?.includes("https://www.googleapis.com/auth/gmail.readonly") || false, canSend: item.scopes?.includes("https://www.googleapis.com/auth/gmail.send") || false })) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Connexion email indisponible." }, { status: 503 });
  }
}
