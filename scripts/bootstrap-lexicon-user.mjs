import fs from "node:fs";

function loadEnv() {
  const file = fs.readFileSync(".env.local", "utf8");
  const values = {};
  for (const line of file.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

const env = { ...loadEnv(), ...process.env };
const email = String(env.ID_SECTION_LEXICON_ETIENNE_DUJARDIN || "").trim().toLowerCase();
const password = String(env.PASSWORD_SECTION_LEXICON_ETIENNE_DUJARDIN || "");
const url = String(env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const key = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");
if (!email || !password || !url || !key) throw new Error("Variables serveur Lexicon/Supabase manquantes.");

const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
async function admin(path, init = {}) {
  const response = await fetch(`${url}/auth/v1/admin/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Supabase Auth admin a refusé la requête (${response.status}).`);
  return body;
}
let user;
const listed = await admin("users?per_page=1000");
user = (listed.users || []).find((item) => String(item.email || "").toLowerCase() === email);
let userState = "trouvé";
if (!user) {
  user = await admin("users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: false, user_metadata: {} }) });
  userState = "créé";
}
if (user.email_confirmed_at == null) await admin(`users/${user.id}`, { method: "PUT", body: JSON.stringify({ email_confirm: true }) });
const workspaces = await fetch(`${url}/rest/v1/workspaces?slug=eq.lexicon&select=id&limit=1`, { headers }).then(async (r) => { if (!r.ok) throw new Error("Espace Lexicon introuvable."); return r.json(); });
if (!workspaces[0]?.id || !user?.id) throw new Error("Utilisateur ou espace Lexicon introuvable.");
const membership = await fetch(`${url}/rest/v1/workspace_members`, { method: "POST", headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify({ workspace_id: workspaces[0].id, user_id: user.id, role: "member", permissions: { email_read: true, email_compose: true, email_send: true, campaign_manage: true } }) });
if (!membership.ok) throw new Error(`Membership Lexicon refusé (${membership.status}).`);
console.log(`Lexicon bootstrap: utilisateur ${userState}; membership créée/existante.`);
