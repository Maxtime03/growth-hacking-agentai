import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) { const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line); if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, ""); }
const url = env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "");
const adminKey = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const etiennePassword = env.PASSWORD_SECTION_LEXICON_ETIENNE_DUJARDIN;
assert.ok(url && adminKey && anonKey && etiennePassword, "configuration Supabase de test absente");
const adminHeaders = { apikey: adminKey, Authorization: `Bearer ${adminKey}`, "Content-Type": "application/json" };
const anonHeaders = { apikey: anonKey, "Content-Type": "application/json" };
async function authLogin(email, password) { const response = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: anonKey, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }); assert.equal(response.ok, true, `connexion ${email} refusée`); return response.json(); }
async function rest(path, token, init = {}) { return fetch(`${url}/rest/v1/${path}`, { ...init, headers: { apikey: anonKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers || {}) } }); }
const suffix = crypto.randomUUID().slice(0, 8);
const adminEmail = `rls-admin-${suffix}@example.test`;
const adminPassword = `Rls-${crypto.randomBytes(18).toString("base64url")}a1!`;
let adminUserId;
try {
  const create = await fetch(`${url}/auth/v1/admin/users`, { method: "POST", headers: adminHeaders, body: JSON.stringify({ email: adminEmail, password: adminPassword, email_confirm: true }) });
  assert.equal(create.ok, true, "création utilisateur admin de test refusée"); adminUserId = (await create.json()).id;
  const workspaces = await fetch(`${url}/rest/v1/workspaces?select=id,slug`, { headers: adminHeaders }).then((r) => r.json());
  const membership = await fetch(`${url}/rest/v1/workspace_members`, { method: "POST", headers: { ...adminHeaders, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(workspaces.map((item) => ({ workspace_id: item.id, user_id: adminUserId, role: "owner", permissions: { email_read: true, email_compose: true, email_send: true, campaign_manage: true } }))) });
  assert.equal(membership.ok, true, "membership admin de test refusée");
  const adminSession = await authLogin(adminEmail, adminPassword);
  const etienneSession = await authLogin("etiennedujardin@hotmail.com", etiennePassword);
  const lexicon = workspaces.find((item) => item.slug === "lexicon"); const pluq = workspaces.find((item) => item.slug === "pluq"); const netai = workspaces.find((item) => item.slug === "net-ai");
  const etLexicon = await rest(`leads?workspace_id=eq.${lexicon.id}&select=id&limit=1`, etienneSession.access_token); assert.equal(etLexicon.ok, true); assert.ok((await etLexicon.json()).length >= 1);
  for (const workspace of [pluq, netai]) { const denied = await rest(`leads?workspace_id=eq.${workspace.id}&select=id&limit=1`, etienneSession.access_token); assert.equal(denied.ok, true); assert.deepEqual(await denied.json(), []); }
  const deniedInsert = await rest("leads", etienneSession.access_token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ workspace_id: pluq.id, company_name: "RLS test", source: "test" }) }); assert.equal(deniedInsert.ok, false);
  const adminRead = await rest(`leads?workspace_id=eq.${pluq.id}&select=id&limit=1`, adminSession.access_token); assert.equal(adminRead.ok, true); await adminRead.json();
  const anonymous = await fetch(`${url}/rest/v1/leads?select=id&limit=1`, { headers: anonHeaders }); assert.equal(anonymous.ok, false);
  console.log("RLS live: admin=ok; etienne lexicon=ok; etienne pluq/net-ai=empty; etienne insert=denied; anonymous=denied");
} finally {
  if (adminUserId) await fetch(`${url}/auth/v1/admin/users/${adminUserId}`, { method: "DELETE", headers: adminHeaders });
}
