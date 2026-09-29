import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";
export { listLeads as GET } from "@/lib/list-leads";

export const dynamic = "force-dynamic";
const STATUSES = new Set(["new","qualified","contacted","negotiation","won","lost"]);

export async function POST(request: Request) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const workspace = normalizeWorkspace(body.workspace);
  if (!canAccessWorkspace(user, workspace)) return Response.json({ error: "Espace non autorisé." }, { status: 403 });
  const company = clean(body.company, 240);
  const email = clean(body.email, 320)?.toLowerCase() || null;
  const phone = clean(body.phone, 80);
  if (!company) return Response.json({ error: "Le nom de l’entreprise est requis." }, { status: 400 });
  const workspaceResponse = await supabaseRest(`workspaces?slug=eq.${encodeURIComponent(workspace)}&select=id&limit=1`);
  const workspaceRows = workspaceResponse.ok ? await workspaceResponse.json() as Array<{ id: string }> : [];
  if (!workspaceRows[0]) return Response.json({ error: "Espace introuvable." }, { status: 404 });
  const duplicateTerms = [`company_name.ilike.${encodeURIComponent(company)}`];
  if (email) duplicateTerms.push(`email.eq.${encodeURIComponent(email)}`);
  if (phone) duplicateTerms.push(`phone.eq.${encodeURIComponent(phone)}`);
  const duplicateResponse = await supabaseRest(`leads?workspace_id=eq.${workspaceRows[0].id}&or=(${duplicateTerms.join(",")})&select=id,external_id,company_name,email,phone,legal_entity&limit=10`);
  const duplicates = duplicateResponse.ok ? await duplicateResponse.json() as unknown[] : [];
  if (duplicates.length && body.confirmDuplicate !== true) return Response.json({ error: "Doublon potentiel détecté.", duplicates }, { status: 409 });
  const now = new Date().toISOString();
  const externalId = `manual-${crypto.randomUUID()}`;
  const insert = {
    workspace_id: workspaceRows[0].id, external_id: externalId, company_name: company,
    email, phone, website: clean(body.website, 500), linkedin_url: clean(body.linkedinUrl, 500),
    address: clean(body.address, 500), industry: clean(body.industry, 180), region: clean(body.region, 180),
    country_code: clean(body.countryCode, 8)?.toUpperCase() || "BE", deal_status: "new", status: "manual",
    opportunity_value_min: finite(body.valueMin), opportunity_value_max: finite(body.valueMax),
    opportunity_value: finite(body.valueMax) || finite(body.valueMin), currency: clean(body.currency, 3)?.toUpperCase() || "EUR",
    tax_included: body.taxIncluded === true, notes: clean(body.notes, 4000), consent_status: clean(body.consentStatus, 80) || "unknown",
    source_detail: clean(body.source, 240) || "Saisie manuelle", legal_entity: clean(body.legalEntity, 240),
    office_scope: clean(body.officeScope, 240), raw_data: { contact_name: clean(body.contactName, 240), title: clean(body.title, 240), source: clean(body.source, 240) || "Saisie manuelle" },
    created_at: now, updated_at: now,
  };
  const response = await supabaseRest("leads", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(insert) });
  if (!response.ok) return Response.json({ error: "Création du lead impossible." }, { status: 503 });
  const rows = await response.json() as Array<{ id: string; external_id: string }>;
  return Response.json({ ok: true, item: rows[0] }, { status: 201 });
}

async function legacyGET(request: Request) {
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
function finite(value: unknown) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }

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
