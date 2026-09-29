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
const emailAccountIds = [crypto.randomUUID(), crypto.randomUUID()];
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
  const etienneContacts = await rest(`lead_contacts?workspace_id=eq.${lexicon.id}&select=id,workspace_id&limit=5`, etienneSession.access_token); assert.equal(etienneContacts.ok, true); await etienneContacts.json();
  for (const workspace of [pluq, netai]) { const deniedContacts = await rest(`lead_contacts?workspace_id=eq.${workspace.id}&select=id&limit=1`, etienneSession.access_token); assert.equal(deniedContacts.ok, true); assert.deepEqual(await deniedContacts.json(), []); }
  const deniedInsert = await rest("leads", etienneSession.access_token, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ workspace_id: pluq.id, company_name: "RLS test", source: "test" }) }); assert.equal(deniedInsert.ok, false);
  const seedAccounts = await fetch(`${url}/rest/v1/email_accounts`, { method: "POST", headers: { ...adminHeaders, Prefer: "return=minimal" }, body: JSON.stringify([{ id: emailAccountIds[0], owner_email: "etiennedujardin@hotmail.com", email_address: `rls-lexicon-${suffix}@example.test`, encrypted_refresh_token: "v1.test.test", status: "connected" }, { id: emailAccountIds[1], owner_email: "etiennedujardin@hotmail.com", email_address: `rls-pluq-${suffix}@example.test`, encrypted_refresh_token: "v1.test.test", status: "connected" }]) }); assert.equal(seedAccounts.ok, true, "création comptes email RLS refusée");
  const seedGrants = await fetch(`${url}/rest/v1/email_account_workspaces`, { method: "POST", headers: { ...adminHeaders, Prefer: "return=minimal" }, body: JSON.stringify([{ account_id: emailAccountIds[0], workspace_id: lexicon.id }, { account_id: emailAccountIds[1], workspace_id: pluq.id }]) }); assert.equal(seedGrants.ok, true, "création grants email RLS refusée");
  const etienneAccounts = await rest("email_accounts?select=id,email_address&order=email_address", etienneSession.access_token); assert.equal(etienneAccounts.ok, true); assert.deepEqual((await etienneAccounts.json()).map((item) => item.id), [emailAccountIds[0]]);
  const etienneAccountWorkspaces = await rest("email_account_workspaces?select=account_id,workspace_id", etienneSession.access_token); assert.equal(etienneAccountWorkspaces.ok, true); assert.deepEqual(await etienneAccountWorkspaces.json(), [{ account_id: emailAccountIds[0], workspace_id: lexicon.id }]);
  const adminRead = await rest(`leads?workspace_id=eq.${pluq.id}&select=id&limit=1`, adminSession.access_token); assert.equal(adminRead.ok, true); await adminRead.json();
  const anonymous = await fetch(`${url}/rest/v1/leads?select=id&limit=1`, { headers: anonHeaders }); assert.equal(anonymous.ok, false);
  const anonymousContacts = await fetch(`${url}/rest/v1/lead_contacts?select=id&limit=1`, { headers: anonHeaders }); assert.equal(anonymousContacts.ok, false);
  const anonymousEmail = await fetch(`${url}/rest/v1/email_accounts?select=id&limit=1`, { headers: anonHeaders }); assert.equal(anonymousEmail.ok, false);
  console.log("RLS live: admin=ok; etienne lexicon leads/contacts/email=ok; etienne pluq/net-ai leads/contacts/email=empty; etienne insert=denied; anonymous leads/contacts/email=denied");
} finally {
  for (const id of emailAccountIds) await fetch(`${url}/rest/v1/email_accounts?id=eq.${id}`, { method: "DELETE", headers: adminHeaders });
  if (adminUserId) await fetch(`${url}/auth/v1/admin/users/${adminUserId}`, { method: "DELETE", headers: adminHeaders });
}
