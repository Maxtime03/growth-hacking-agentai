import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getAuthorizedChatGPTUser();
  if (!user) return new Response("Accès non autorisé.", { status: 401 });
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return new Response("GOOGLE_OAUTH_CLIENT_ID manque dans .env.local.", { status: 503 });
  const origin = new URL(request.url).origin;
  const configuredRedirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const redirectUri = origin.includes("127.0.0.1") || origin.includes("localhost")
    ? `${origin}/api/email/google/callback`
    : configuredRedirectUri || `${origin}/api/email/google/callback`;
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    scope: "openid email profile https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
    state,
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "Set-Cookie": `netai_google_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${origin.startsWith("https://") ? "; Secure" : ""}`,
    },
  });
}
