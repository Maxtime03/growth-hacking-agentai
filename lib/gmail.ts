import { decryptSecret, supabaseRest } from "@/lib/email-connections";

export type EmailConnection = {
  id: string;
  owner_email: string;
  email_address: string;
  display_name: string | null;
  scopes: string[] | null;
  encrypted_refresh_token: string;
  status: string;
};

export async function getEmailConnection(ownerEmail: string, connectionId?: string) {
  const params = new URLSearchParams({
    select: "id,owner_email,email_address,display_name,scopes,encrypted_refresh_token,status",
    owner_email: `eq.${ownerEmail}`,
    status: "eq.active",
    limit: "1",
  });
  if (connectionId) params.set("id", `eq.${connectionId}`);
  const response = await supabaseRest(`email_connections?${params}`);
  if (!response.ok) throw new Error(`Lecture du compte email impossible (${response.status}).`);
  const rows = await response.json() as EmailConnection[];
  if (!rows[0]) throw new Error("Aucun compte Google connecté. Connectez ou reconnectez un compte.");
  return rows[0];
}

export async function getGoogleAccessToken(connection: EmailConnection) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_OAUTH_CLIENT_ID ou GOOGLE_OAUTH_CLIENT_SECRET manque.");
  const refreshToken = await decryptSecret(connection.encrypted_refresh_token);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
    cache: "no-store",
  });
  const payload = await response.json() as { access_token?: string; error_description?: string };
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || "Google a refusé le renouvellement du jeton. Reconnectez le compte.");
  return payload.access_token;
}

export function getOwnerEmail(userEmail?: string | null) {
  const ownerEmail = userEmail?.trim().toLowerCase() || "";
  if (!ownerEmail) throw new Error("Session utilisateur absente.");
  return ownerEmail;
}

export async function gmailFetch(accessToken: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init.headers || {}) },
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(payload.error?.message || `Gmail API a répondu ${response.status}.`);
  }
  return response;
}

export function encodeBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
