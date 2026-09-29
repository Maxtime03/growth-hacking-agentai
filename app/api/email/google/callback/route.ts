import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { encryptSecret, parseCookie, supabaseRest } from "@/lib/email-connections";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";
import { googleRedirectUri, verifyGoogleOAuthState } from "@/lib/google-oauth-state";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const current = new URL(request.url);
  const origin = current.origin;
  const user = await getAuthorizedChatGPTUser();
  if (!user) return redirect(origin, "email_error=unauthorized");
  const ownerEmail = user.email.trim().toLowerCase();
  const state=await verifyGoogleOAuthState(current.searchParams.get("state"));
  if (!current.searchParams.get("code") || !state || state.nonce!==parseCookie(request,"netai_google_oauth_nonce") || state.ownerEmail!==ownerEmail || !canAccessWorkspace(user,normalizeWorkspace(state.workspace))) return redirect(origin, "email_error=invalid_state");
  try {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Identifiants OAuth Google absents.");
    const redirectUri=googleRedirectUri(origin);
    if(redirectUri!==state.redirectUri)throw new Error("redirect_uri incohérente.");
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: current.searchParams.get("code")!, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const tokens = await tokenResponse.json() as Record<string, unknown>;
    if (!tokenResponse.ok || typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string") throw new Error("Google n'a pas fourni de jeton de reconnexion.");
    const grantedScopes=typeof tokens.scope==="string"?tokens.scope.split(" ").filter(Boolean):[];
    for(const required of ["https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/gmail.compose"])if(!grantedScopes.includes(required))throw new Error("Scopes Gmail requis non accordés.");
    if(grantedScopes.includes("https://mail.google.com/"))throw new Error("Scope Gmail global refusé.");
    const gmailProfileResponse = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const gmailProfile = await gmailProfileResponse.json() as Record<string, unknown>;
    if (!gmailProfileResponse.ok || typeof gmailProfile.emailAddress !== "string" || typeof gmailProfile.historyId !== "string") throw new Error("users.getProfile a refusé la connexion Gmail.");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileResponse.json() as Record<string, unknown>;
    const encrypted = await encryptSecret(tokens.refresh_token);
    const saved = await supabaseRest("email_accounts?on_conflict=owner_email,provider,email_address", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        owner_email: ownerEmail, provider: "google", email_address: gmailProfile.emailAddress,
        display_name: typeof profile.name === "string" ? profile.name : null,
        scopes: grantedScopes,
        encrypted_refresh_token: encrypted,
        token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
        gmail_history_id: gmailProfile.historyId, status: "connected", status_detail: null, last_verified_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }),
    });
    if (!saved.ok) throw new Error(`Supabase a refusé la sauvegarde (${saved.status}).`);
    const account=(await saved.json() as Array<{id:string}>)[0];
    const workspacesResponse=await supabaseRest("workspaces?select=id,slug");
    const workspaces=workspacesResponse.ok?await workspacesResponse.json() as Array<{id:string;slug:string}>:[];
    const allowed=workspaces.filter(workspace=>workspace.slug===state.workspace&&canAccessWorkspace(user,normalizeWorkspace(workspace.slug))).map(workspace=>({account_id:account.id,workspace_id:workspace.id}));
    if(!allowed.length)throw new Error("Aucun workspace autorisé.");
    const grants=await supabaseRest("email_account_workspaces?on_conflict=account_id,workspace_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(allowed)});
    if(!grants.ok)throw new Error("Affectation du compte aux workspaces impossible.");
    await supabaseRest("email_sync_state?on_conflict=account_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({account_id:account.id,history_id:null,updated_at:new Date().toISOString()})});
    return redirect(origin, "connected=1");
  } catch (error) {
    console.error("Google OAuth callback:", error instanceof Error ? error.message : error);
    return redirect(origin, "email_error=connection_failed");
  }
}

function redirect(origin: string, query: string) {
  return new Response(null, { status: 302, headers: { Location: `${origin}/settings/email?${query}`, "Set-Cookie": "netai_google_oauth_nonce=; Path=/api/email/google; HttpOnly; SameSite=Lax; Max-Age=0" } });
}
