import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";

export const dynamic = "force-dynamic";
const STATUSES = new Set(["new","qualified","contacted","negotiation","won","lost"]);

export async function GET(request: Request) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const url = new URL(request.url);
  const requestedWorkspace = normalizeWorkspace(url.searchParams.get("workspace") || (user.email.trim().toLowerCase() === "etiennedujardin@hotmail.com" ? "lexicon" : "net-ai"));
  if (!canAccessWorkspace(user, requestedWorkspace)) return Response.json({ error: "Espace non autorisé." }, { status: 403 });
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize") || 50)));
  const query = url.searchParams.get("q")?.trim();
  const status = url.searchParams.get("status")?.trim();
  const params = new URLSearchParams({
    select: "id,external_id,company_name,industry,address,region,country_code,phone,email,website,linkedin_url,score,confidence,status,deal_status,opportunity_value,next_action,next_action_at,raw_data,created_at,updated_at",
    order: "score.desc,updated_at.desc",
    limit: String(pageSize),
    offset: String((page - 1) * pageSize),
  });
  const workspaceResponse = await supabaseRest(`workspaces?slug=eq.${requestedWorkspace}&select=id&limit=1`);
  const workspaceRows = await workspaceResponse.json() as Array<{ id: string }>;
  if (!workspaceRows[0]?.id) return Response.json({ error: "Espace introuvable." }, { status: 404 });
  params.set("workspace_id", `eq.${workspaceRows[0].id}`);
  if (status && STATUSES.has(status)) params.set("deal_status", `eq.${status}`);
  if (query) params.set("or", `(company_name.ilike.*${encodeURIComponent(query)}*,email.ilike.*${encodeURIComponent(query)}*,address.ilike.*${encodeURIComponent(query)}*)`);
  try {
    const response = await supabaseRest(`leads?${params}`, { headers: { Prefer: "count=exact" } });
    if (!response.ok) throw new Error(`Lecture des leads impossible (${response.status}).`);
    const rows = await response.json() as Array<Record<string, unknown>>;
    const range = response.headers.get("content-range");
    const total = range && /\/(\d+)$/.exec(range)?.[1] ? Number(/\/(\d+)$/.exec(range)![1]) : rows.length;
    return Response.json({ items: rows.map(normalizeLead), page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lecture des leads impossible." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  try {
    const body = await request.json() as Record<string,unknown>;
    const externalId = clean(body.externalId,240);
    const dealStatus = clean(body.dealStatus,40);
    const opportunityValue = Number(body.opportunityValue || 0);
    const nextAction = clean(body.nextAction,500);
    const nextActionAt = clean(body.nextActionAt,80);
    if (!externalId) return Response.json({ error: "Identifiant du lead absent." }, { status:400 });
    if (!dealStatus || !STATUSES.has(dealStatus)) return Response.json({ error: "Étape commerciale invalide." }, { status:400 });
    if (!Number.isFinite(opportunityValue) || opportunityValue < 0 || opportunityValue > 100000000) return Response.json({ error: "Montant invalide." }, { status:400 });
    const existingResponse = await supabaseRest(`leads?external_id=eq.${encodeURIComponent(externalId)}&select=workspace_id&limit=1`);
    const existingRows = await existingResponse.json() as Array<{ workspace_id: string }>;
    if (!existingRows[0]) return Response.json({ error: "Lead introuvable dans Supabase." }, { status:404 });
    const workspaceResponse = await supabaseRest(`workspaces?id=eq.${encodeURIComponent(existingRows[0].workspace_id)}&select=slug&limit=1`);
    const workspaceRows = await workspaceResponse.json() as Array<{ slug: string }>;
    if (!canAccessWorkspace(user, normalizeWorkspace(workspaceRows[0]?.slug))) return Response.json({ error: "Espace non autorisé." }, { status: 403 });
    const response = await supabaseRest(`leads?external_id=eq.${encodeURIComponent(externalId)}`, { method:"PATCH", headers:{Prefer:"return=representation"}, body:JSON.stringify({ deal_status:dealStatus, opportunity_value:opportunityValue||null, next_action:nextAction||null, next_action_at:nextActionAt||null, updated_at:new Date().toISOString() }) });
    if (!response.ok) throw new Error(`Supabase a refusé la mise à jour (${response.status}).`);
    const rows = await response.json() as unknown[];
    if (!rows.length) return Response.json({ error:"Lead introuvable dans Supabase." },{status:404});
    return Response.json({ok:true});
  } catch(error) { return Response.json({error:error instanceof Error?error.message:"Mise à jour impossible."},{status:503}); }
}
function clean(value:unknown,max:number){return typeof value==="string"?value.replace(/[<>\r\n]/g," ").trim().slice(0,max):null;}

function normalizeLead(row: Record<string, unknown>) {
  const raw = row.raw_data && typeof row.raw_data === "object" ? redactSecrets(row.raw_data) : {};
  return {
    id: row.id, externalId: row.external_id, company: row.company_name || (raw as Record<string, unknown>).company || "Entreprise inconnue",
    category: row.industry, location: row.address, region: row.region, country: row.country_code,
    phone: row.phone, email: row.email, website: row.website, linkedinUrl: row.linkedin_url,
    score: Number(row.score || 0), confidence: Number(row.confidence || 0), status: row.status, dealStatus: row.deal_status,
    opportunityValue: Number(row.opportunity_value || 0), nextAction: row.next_action, nextActionAt: row.next_action_at,
    createdAt: row.created_at, updatedAt: row.updated_at, rawData: raw,
  };
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !/(token|secret|password|api[_-]?key|service[_-]?role)/i.test(key)).map(([key, item]) => [key, redactSecrets(item)]));
}
