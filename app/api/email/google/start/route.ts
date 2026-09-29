import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { GMAIL_SCOPES } from "@/lib/email-crm";
import { canAccessWorkspace, normalizeWorkspace } from "@/lib/workspaces";
import { googleRedirectUri, signGoogleOAuthState } from "@/lib/google-oauth-state";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return new Response("Accès non autorisé.", { status: 401 });
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return new Response("GOOGLE_OAUTH_CLIENT_ID manque dans .env.local.", { status: 503 });
  const current=new URL(request.url),origin=current.origin;
  const requested=normalizeWorkspace(current.searchParams.get("workspace")||(user.email.trim().toLowerCase()==="etiennedujardin@hotmail.com"?"lexicon":"net-ai"));
  if(!canAccessWorkspace(user,requested))return new Response("Workspace non autorisé.",{status:403});
  const redirectUri=googleRedirectUri(origin),nonce=crypto.randomUUID();
  const state=await signGoogleOAuthState({nonce,ownerEmail:user.email.trim().toLowerCase(),workspace:requested,returnPath:"/settings/email",redirectUri,issuedAt:Date.now()});
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    scope: GMAIL_SCOPES.join(" "),
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "Set-Cookie": `netai_google_oauth_nonce=${encodeURIComponent(nonce)}; Path=/api/email/google; HttpOnly; SameSite=Lax; Max-Age=600${origin.startsWith("https://") ? "; Secure" : ""}`,
    },
  });
}
