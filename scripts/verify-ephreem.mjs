import fs from "node:fs/promises";

const env = Object.fromEntries(
  (await fs.readFile(".env.local", "utf8"))
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1).replace(/^['\"]|['\"]$/g, "")];
    }),
);
const baseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const serviceKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
if (!baseUrl || !serviceKey) throw new Error("Configuration Supabase indisponible.");

const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
async function read(path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, { headers });
  const body = await response.text();
  if (!response.ok) throw new Error(`Lecture Supabase refusée (${response.status}).`);
  return body ? JSON.parse(body) : [];
}

const normalizedPhone = "32472818934";
const leads = await read(
  `leads?or=(phone.eq.%2B32%20472%2081%2089%2034,external_id.eq.manual-ephreem-${normalizedPhone})&select=id,workspace_id,company_name,phone,status,pipeline_stage,deal_status,temperature,opportunity_value_min,opportunity_value_max,next_action,raw_data&limit=10`,
);
const lead = leads.find((row) => row.raw_data?.contact_name === "Ephréem Kalonji") || leads[0];
if (!lead) throw new Error("Ephréem Kalonji introuvable.");
const [workspace, contacts, history] = await Promise.all([
  read(`workspaces?id=eq.${lead.workspace_id}&select=slug,name&limit=1`),
  read(`lead_contacts?lead_id=eq.${lead.id}&select=id,full_name,phone,email&limit=10`),
  read(`lead_activities?lead_id=eq.${lead.id}&select=id,activity_type,body,metadata,created_at&order=created_at.desc&limit=5`),
]);

console.log(
  JSON.stringify({
    ok: true,
    id: lead.id,
    duplicateCount: leads.length,
    workspace: workspace[0]?.slug || null,
    lead: {
      companyName: lead.company_name,
      contactName: lead.raw_data?.contact_name || null,
      phone: lead.phone,
      status: lead.status,
      pipelineStage: lead.pipeline_stage,
      temperature: lead.temperature,
      dealStatus: lead.deal_status,
      valueMin: lead.opportunity_value_min,
      valueMax: lead.opportunity_value_max,
      nextAction: lead.next_action,
      commercialUpdate: lead.raw_data?.commercial_update || null,
      commercialUpdateDate: lead.raw_data?.commercial_update_date || null,
    },
    contacts: contacts.map(({ id, full_name, phone, email }) => ({ id, full_name, phone, hasEmail: Boolean(email) })),
    historyCount: history.length,
    hasSourcedHistory: history.some((row) => row.metadata?.source === "user"),
    hasToVerifyHistory: history.some((row) => Array.isArray(row.metadata?.to_verify)),
  }),
);
