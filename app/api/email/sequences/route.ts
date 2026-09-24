import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

async function workspaceAllowed(userEmail: string, workspaceId: string) {
  const response = await supabaseRest(`workspaces?id=eq.${encodeURIComponent(workspaceId)}&select=slug&limit=1`);
  const rows = response.ok ? await response.json() as Array<{ slug: string }> : [];
  return Boolean(rows[0] && canAccessWorkspace({ email: userEmail, displayName: userEmail, fullName: null }, normalizeWorkspace(rows[0].slug)));
}

export async function POST(request: Request) {
  const user = await getAuthorizedChatGPTUser(); if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { workspaceId?: string; name?: string; senderEmail?: string; steps?: Array<{ delayDays?: number; subject?: string; body?: string }> };
  if (!body.workspaceId || !(await workspaceAllowed(user.email, body.workspaceId))) return Response.json({ error: "Espace non autorisé." }, { status: 403 });
  const steps = Array.isArray(body.steps) && body.steps.length === 3 ? body.steps : [1, 2, 3].map(() => ({ delayDays: 2, subject: "", body: "" }));
  const sequenceResponse = await supabaseRest("email_sequences", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify({ workspace_id: body.workspaceId, name: String(body.name || "Séquence Lexicon").slice(0, 200), sender_email: body.senderEmail || null, status: "draft" }) });
  if (!sequenceResponse.ok) return Response.json({ error: "Création de la séquence impossible." }, { status: 503 });
  const sequence = (await sequenceResponse.json() as Array<{ id: string }>)[0];
  for (let index = 0; index < 3; index += 1) await supabaseRest("email_steps", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ workspace_id: body.workspaceId, sequence_id: sequence.id, step_order: index + 1, delay_days: Math.max(0, Number(steps[index].delayDays || 0)), subject_template: String(steps[index].subject || "").slice(0, 240), body_template: String(steps[index].body || "").slice(0, 12000), version: 1 }) });
  return Response.json({ id: sequence.id, status: "draft", steps: 3 }, { status: 201 });
}

export async function GET(request: Request) {
  const user = await getAuthorizedChatGPTUser(); if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const workspaceId = new URL(request.url).searchParams.get("workspaceId") || "";
  if (!(await workspaceAllowed(user.email, workspaceId))) return Response.json({ error: "Espace non autorisé." }, { status: 403 });
  const response = await supabaseRest(`email_sequences?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=*,email_steps(*)&order=created_at.desc`);
  return Response.json({ items: response.ok ? await response.json() : [] });
}
