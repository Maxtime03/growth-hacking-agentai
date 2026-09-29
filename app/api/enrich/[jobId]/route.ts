import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const id = (await params).jobId;
  const response = await supabaseRest(`enrichment_runs?id=eq.${encodeURIComponent(id)}&select=id,status,progress,attempts,result,error_message,created_at,completed_at,workspace_id&limit=1`);
  const rows = response.ok ? await response.json() as Array<Record<string, unknown>> : [];
  if (!rows[0]) return Response.json({ error: "Job introuvable." }, { status: 404 });
  const workspaceResponse = await supabaseRest(`workspaces?id=eq.${encodeURIComponent(String(rows[0].workspace_id))}&select=slug&limit=1`);
  const workspaceRows = workspaceResponse.ok ? await workspaceResponse.json() as Array<{ slug: string }> : [];
  if (!canAccessWorkspace(user, normalizeWorkspace(workspaceRows[0]?.slug))) return Response.json({ error: "Job introuvable." }, { status: 404 });
  return Response.json({ job: rows[0] });
}

export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const id = (await params).jobId;
  const action = String((await request.json().catch(() => ({})) as { action?: string }).action || "");
  if (!["cancel", "retry"].includes(action)) return Response.json({ error: "Action invalide." }, { status: 400 });
  const current = await supabaseRest(`enrichment_runs?id=eq.${encodeURIComponent(id)}&select=workspace_id,lead_id&limit=1`);
  const currentRows = current.ok ? await current.json() as Array<{ workspace_id: string; lead_id:string }> : [];
  if (!currentRows[0]) return Response.json({ error: "Job introuvable." }, { status: 404 });
  const workspaceResponse = await supabaseRest(`workspaces?id=eq.${encodeURIComponent(currentRows[0].workspace_id)}&select=slug&limit=1`);
  const workspaceRows = workspaceResponse.ok ? await workspaceResponse.json() as Array<{ slug: string }> : [];
  if (!canAccessWorkspace(user, normalizeWorkspace(workspaceRows[0]?.slug))) return Response.json({ error: "Job introuvable." }, { status: 404 });
  const patch = action === "cancel" ? { status: "cancelled", cancelled_at: new Date().toISOString() } : { status: "queued", progress: 0, error_message: null, next_retry_at: null };
  const response = await supabaseRest(`enrichment_runs?id=eq.${encodeURIComponent(id)}&status=${action === "cancel" ? "in.(queued,running)" : "eq.failed"}`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(patch) });
  if (!response.ok) return Response.json({ error: "Mise à jour du job impossible." }, { status: 503 });
  if (action === "retry") {
    const queueResponse = await supabaseRest(`enrichment_queue?enrichment_run_id=eq.${encodeURIComponent(id)}&select=payload&limit=1`);
    const queueRows = queueResponse.ok ? await queueResponse.json() as Array<{payload:Record<string,unknown>}> : [];
    const requeued = await supabaseRest("rpc/requeue_enrichment_job", { method:"POST", body:JSON.stringify({ p_run_id:id, p_workspace_id:currentRows[0].workspace_id, payload:queueRows[0]?.payload||{} }) });
    if (!requeued.ok) return Response.json({ error:"Le job a été réinitialisé mais sa remise en file a échoué." },{status:503});
    await supabaseRest(`enrichment_queue?enrichment_run_id=eq.${encodeURIComponent(id)}`, { method:"PATCH", headers:{Prefer:"return=minimal"}, body:JSON.stringify({status:"queued",available_at:new Date().toISOString(),last_error:null,locked_at:null,completed_at:null}) });
  }
  return Response.json({ ok: true, status: patch.status });
}
