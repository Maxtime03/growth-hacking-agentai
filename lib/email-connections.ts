const encoder = new TextEncoder();

export function requireSupabaseServerConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SECRET_KEY (ou SUPABASE_SERVICE_ROLE_KEY)"].filter(Boolean);
  if (missing.length) throw new Error(`Configuration Supabase serveur incomplète : ${missing.join(", ")}.`);
  return { url: url!.replace(/\/$/, ""), key: key! };
}

export function requireEmailStorageConfig() {
  const supabase = requireSupabaseServerConfig();
  const encryptionSecret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encryptionSecret) throw new Error("Configuration email incomplète : TOKEN_ENCRYPTION_KEY manque dans .env.local.");
  return { ...supabase, encryptionSecret };
}

export async function encryptSecret(value: string) {
  const { encryptionSecret } = requireEmailStorageConfig();
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(encryptionSecret));
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value)));
  return `v1.${toBase64(iv)}.${toBase64(encrypted)}`;
}

export async function decryptSecret(value: string) {
  const { encryptionSecret } = requireEmailStorageConfig();
  const [version, ivPart, encryptedPart] = value.split(".");
  if (version !== "v1" || !ivPart || !encryptedPart) throw new Error("Jeton OAuth chiffré invalide.");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(encryptionSecret));
  const key = await crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(ivPart) }, key, fromBase64(encryptedPart));
  return new TextDecoder().decode(decrypted);
}

export async function supabaseRest(path: string, init: RequestInit = {}) {
  const { url, key } = requireSupabaseServerConfig();
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
}

export function parseCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}


function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
