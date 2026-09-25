import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";

export const dynamic = "force-dynamic";

export async function GET() {
  const response = await supabaseRest("enrichment_queue?select=status,attempts,available_at,locked_at,last_error&order=created_at.desc&limit=100");
  return Response.json({ items: response.ok ? await response.json() : [] });
}

export async function POST() {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const queued = await supabaseRest("enrichment_queue?status=eq.queued&available_at=lte.now()&select=id,enrichment_run_id,payload&order=created_at.asc&limit=1");
  const rows = queued.ok ? await queued.json() as Array<{ id: string; enrichment_run_id: string; payload: Record<string, unknown> }> : [];
  if (!rows[0]) return Response.json({ status: "idle", processed: 0 });
  return Response.json({ status: "queued", processed: 0, jobId: rows[0].enrichment_run_id, message: "Job durable disponible pour le worker Edge." }, { status: 202 });
}
