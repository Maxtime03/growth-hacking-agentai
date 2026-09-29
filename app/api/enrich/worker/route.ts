import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { supabaseRest } from "@/lib/email-connections";
import { processEnrichmentJob } from "@/app/api/enrich/route";

export const dynamic = "force-dynamic";

export async function GET(request:Request) {
  if (!await isWorkerAuthorized(request)) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const response = await supabaseRest("enrichment_queue?select=status,attempts,available_at,locked_at,last_error&order=created_at.desc&limit=100");
  return Response.json({ items: response.ok ? await response.json() : [] });
}

export async function POST(request:Request) {
  const user = await getAuthorizedChatGPTUser();
  if (!user && !hasServiceCredential(request)) return Response.json({ error: "Accès non autorisé." }, { status: 401 });
  const claimed = await supabaseRest("rpc/claim_enrichment_job", { method: "POST", body: JSON.stringify({ p_visibility_seconds: 300 }) });
  const rows = claimed.ok ? await claimed.json() as Array<{ msg_id: number; message: { run_id: string; payload: Record<string, unknown> } }> : [];
  if (!rows[0]) return Response.json({ status: "idle", processed: 0 });
  await processEnrichmentJob(rows[0].message.run_id, rows[0].message.payload, user?.email || "hello@net-ia.biz");
  const state = await supabaseRest(`enrichment_runs?id=eq.${encodeURIComponent(rows[0].message.run_id)}&select=status&limit=1`);
  const stateRows = state.ok ? await state.json() as Array<{ status: string }> : [];
  if (["completed", "failed", "cancelled"].includes(stateRows[0]?.status || "")) {
    await supabaseRest("rpc/ack_enrichment_job", { method: "POST", body: JSON.stringify({ p_msg_id: rows[0].msg_id }) });
  }
  return Response.json({ status: stateRows[0]?.status || "running", processed: 1, jobId: rows[0].message.run_id });
}

async function isWorkerAuthorized(request:Request){return Boolean(await getAuthorizedChatGPTUser())||hasServiceCredential(request);}
function hasServiceCredential(request:Request){const expected=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(!expected)return false;const authorization=request.headers.get("authorization")||"";const apiKey=request.headers.get("apikey")||"";return authorization===`Bearer ${expected}`&&apiKey===expected;}
