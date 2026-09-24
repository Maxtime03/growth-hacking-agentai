import { getAuthorizedChatGPTUser } from "@/app/chatgpt-auth";
import { encryptSecret, parseCookie, supabaseRest } from "@/lib/email-connections";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const current = new URL(request.url);
  const origin = current.origin;
  const user = await getAuthorizedChatGPTUser();
  if (!user) return redirect(origin, "email_error=unauthorized");
  const ownerEmail = user.email.trim().toLowerCase();
  if (!current.searchParams.get("code") || current.searchParams.get("state") !== parseCookie(request, "netai_google_oauth_state")) return redirect(origin, "email_error=invalid_state");
  try {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("Identifiants OAuth Google absents.");
    const configuredRedirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
    const redirectUri = origin.includes("127.0.0.1") || origin.includes("localhost")
      ? `${origin}/api/email/google/callback`
      : configuredRedirectUri || `${origin}/api/email/google/callback`;
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: current.searchParams.get("code")!, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const tokens = await tokenResponse.json() as Record<string, unknown>;
    if (!tokenResponse.ok || typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string") throw new Error("Google n'a pas fourni de jeton de reconnexion.");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileResponse.json() as Record<string, unknown>;
    if (!profileResponse.ok || typeof profile.email !== "string") throw new Error("Adresse Google introuvable.");
    const encrypted = await encryptSecret(tokens.refresh_token);
    const saved = await supabaseRest("email_connections?on_conflict=owner_email,provider,email_address", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        owner_email: ownerEmail, provider: "google", email_address: profile.email,
        display_name: typeof profile.name === "string" ? profile.name : null,
        scopes: typeof tokens.scope === "string" ? tokens.scope.split(" ") : [],
        encrypted_refresh_token: encrypted,
        token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
        status: "active", updated_at: new Date().toISOString(),
      }),
    });
    if (!saved.ok) throw new Error(`Supabase a refusé la sauvegarde (${saved.status}).`);
    return redirect(origin, "email_connected=1&view=Campagnes");
  } catch (error) {
    console.error("Google OAuth callback:", error instanceof Error ? error.message : error);
    return redirect(origin, "email_error=connection_failed");
  }
}

function redirect(origin: string, query: string) {
  return new Response(null, { status: 302, headers: { Location: `${origin}/?${query}`, "Set-Cookie": "netai_google_oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" } });
}
