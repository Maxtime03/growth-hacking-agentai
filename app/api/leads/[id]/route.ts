import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";
export { getLeadDetail as GET } from "@/lib/get-lead-detail";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const id = (await params).id.trim();
  const current = await supabaseRest(`leads?id=eq.${encodeURIComponent(id)}&select=id,workspace_id,company_name&limit=1`);
  const currentRows = current.ok ? await current.json() as Array<{ id: string; workspace_id: string; company_name: string }> : [];
  if (!currentRows[0]) return Response.json({ error: "Lead introuvable." }, { status: 404 });
  const workspaceResponse = await supabaseRest(`workspaces?id=eq.${encodeURIComponent(currentRows[0].workspace_id)}&select=slug&limit=1`);
  const workspaceRows = workspaceResponse.ok ? await workspaceResponse.json() as Array<{ slug: string }> : [];
  if (!canAccessWorkspace(user, normalizeWorkspace(workspaceRows[0]?.slug))) return Response.json({ error: "Lead introuvable." }, { status: 404 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const allowed: Record<string, string> = { company:"company_name", email:"email", phone:"phone", website:"website", linkedinUrl:"linkedin_url", address:"address", industry:"industry", region:"region", countryCode:"country_code", notes:"notes", consentStatus:"consent_status", legalEntity:"legal_entity", officeScope:"office_scope" };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [input, column] of Object.entries(allowed)) if (input in body) patch[column] = text(body[input], input === "notes" ? 4000 : 500);
  if ("valueMin" in body) patch.opportunity_value_min = number(body.valueMin);
  if ("valueMax" in body) patch.opportunity_value_max = number(body.valueMax);
  if ("dealStatus" in body && ["new","qualified","contacted","replied","meeting","negotiation","won","lost"].includes(String(body.dealStatus))) patch.deal_status = String(body.dealStatus);
  if ("nextAction" in body) patch.next_action = text(body.nextAction,500);
  if ("nextActionAt" in body) patch.next_action_at = text(body.nextActionAt,80);
  if ("opportunityValue" in body) patch.opportunity_value = number(body.opportunityValue);
  if ("taxIncluded" in body) patch.tax_included = body.taxIncluded === true;
  const response = await supabaseRest(`leads?id=eq.${encodeURIComponent(id)}`, { method:"PATCH", headers:{ Prefer:"return=representation" }, body:JSON.stringify(patch) });
  if (!response.ok) return Response.json({ error: "Modification impossible." }, { status: 503 });
  await supabaseRest("lead_activities", { method:"POST", headers:{ Prefer:"return=minimal" }, body:JSON.stringify({ workspace_id:currentRows[0].workspace_id, lead_id:id, activity_type:"lead_updated", title:"Fiche modifiée", description:"Modification manuelle enregistrée", metadata:{ fields:Object.keys(patch).filter(key=>key!=="updated_at") } }) });
  return Response.json({ ok:true, item:(await response.json() as unknown[])[0] });
}

function text(value: unknown, max: number) { return typeof value === "string" ? value.replace(/[<>\r\n]/g, " ").trim().slice(0, max) || null : null; }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) && parsed >= 0 ? parsed : null; }

async function legacyGET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
