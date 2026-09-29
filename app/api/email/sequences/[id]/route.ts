import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

async function loadSequence(id: string) {
  const response = await supabaseRest(`email_sequences?id=eq.${encodeURIComponent(id)}&select=*,email_sequence_steps(*,email_sequence_step_versions(*))&limit=1`);
  const rows = response.ok ? await response.json() as Array<Record<string, unknown>> : [];
  return rows[0] || null;
}

async function allowed(email: string, workspaceId: string) {
  const response = await supabaseRest(`workspaces?id=eq.${encodeURIComponent(workspaceId)}&select=slug&limit=1`);
  const rows = response.ok ? await response.json() as Array<{ slug: string }> : [];
  return Boolean(rows[0] && canAccessWorkspace({ email, displayName: email, fullName: null }, normalizeWorkspace(rows[0].slug)));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthorizedChatGPTUser(); if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const id = (await context.params).id;
  const sequence = await loadSequence(id);
  if (!sequence || typeof sequence.workspace_id !== "string" || !(await allowed(user.email, sequence.workspace_id))) return Response.json({ error: "Séquence introuvable." }, { status: 404 });
  return Response.json(sequence);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthorizedChatGPTUser(); if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const id = (await context.params).id;
  const sequence = await loadSequence(id);
  if (!sequence || typeof sequence.workspace_id !== "string" || !(await allowed(user.email, sequence.workspace_id))) return Response.json({ error: "Séquence introuvable." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as { status?: string; name?: string; senderEmail?: string; stopReason?: string; steps?: Array<{ id?: string; subject?: string; body?: string; delayDays?: number; scheduledAt?:string; status?:string }> };
  const status = body.status && ["draft", "active", "paused", "cancelled", "completed", "stopped"].includes(body.status) ? body.status : undefined;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), version: Number(sequence.version || 1) + 1 };
  if (status) patch.status = status;
  if (body.name !== undefined) patch.name = String(body.name).slice(0, 200);
  if (body.senderEmail !== undefined) patch.sender_email = String(body.senderEmail).slice(0, 320);
  if (status === "paused") patch.paused_at = new Date().toISOString();
  if (status === "active") patch.resumed_at = new Date().toISOString();
  if (status === "cancelled") { patch.stopped_at = new Date().toISOString(); patch.stop_reason = body.stopReason || "cancelled_by_user"; }
  const update = await supabaseRest(`email_sequences?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) });
  if (!update.ok) return Response.json({ error: "Mise à jour impossible." }, { status: 503 });
  if (status === "paused" || status === "cancelled") await supabaseRest(`outbound_messages?sequence_id=eq.${encodeURIComponent(id)}&status=eq.queued`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "cancelled", stop_reason: status === "paused" ? "sequence_paused" : patch.stop_reason }) });
  if (Array.isArray(body.steps)) for (const step of body.steps) if (step.id) { const current=await supabaseRest(`email_sequence_steps?id=eq.${encodeURIComponent(step.id)}&sequence_id=eq.${encodeURIComponent(id)}&select=*&limit=1`);const rows=current.ok?await current.json() as Array<Record<string,unknown>>:[];if(rows[0])await supabaseRest("email_sequence_step_versions",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({step_id:step.id,version:Number(rows[0].version||1),subject:String(rows[0].subject||""),body:String(rows[0].body||"")})});await supabaseRest(`email_sequence_steps?id=eq.${encodeURIComponent(step.id)}&sequence_id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ subject: String(step.subject || "").slice(0, 240), body: String(step.body || "").slice(0, 12000), delay_days: Math.max(0, Number(step.delayDays || 0)), scheduled_at:step.scheduledAt||null,status:step.status&&["draft","scheduled","skipped","cancelled"].includes(step.status)?step.status:undefined,version:Number(rows[0]?.version||1)+1, updated_at: new Date().toISOString() }) }); }
  return Response.json({ ok: true, status: status || sequence.status });
}
