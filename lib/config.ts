/** Central, server-only configuration. Never import this module from a client component. */
export type IntegrationName = "googleOAuth" | "googleMaps" | "apify" | "openAI" | "supabase" | "tokenEncryption" | "openChargeMap";

function read(name: string) {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function getServerConfig() {
  return {
    googleOAuthClientId: read("GOOGLE_OAUTH_CLIENT_ID"),
    googleOAuthClientSecret: read("GOOGLE_OAUTH_CLIENT_SECRET"),
    googleOAuthRedirectUri: read("GOOGLE_OAUTH_REDIRECT_URI"),
    apifyToken: read("APIFY_API_TOKEN"),
    openAIKey: read("OPENAI_API_KEY"),
    openAIModel: read("OPENAI_MODEL") || "gpt-5-mini",
    supabaseUrl: read("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseKey: read("SUPABASE_SECRET_KEY") || read("SUPABASE_SERVICE_ROLE_KEY"),
    tokenEncryptionKey: read("TOKEN_ENCRYPTION_KEY"),
    openChargeMapKey: read("OPEN_CHARGE_MAP_API_KEY"),
  } as const;
}

export function getPublicConfig() {
  return { googleMapsApiKey: read("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY") } as const;
}

export function getIntegrationDiagnostics() {
  const config = getServerConfig();
  const diagnostics = [
    { integration: "Google OAuth", configured: Boolean(config.googleOAuthClientId && config.googleOAuthClientSecret), state: config.googleOAuthClientId && config.googleOAuthClientSecret ? "configured" : "missing", error: config.googleOAuthClientId && config.googleOAuthClientSecret ? null : "GOOGLE_OAUTH_CLIENT_ID/SECRET absent ou vide" },
    { integration: "Google Maps", configured: Boolean(getPublicConfig().googleMapsApiKey), state: getPublicConfig().googleMapsApiKey ? "configured" : "missing", error: getPublicConfig().googleMapsApiKey ? null : "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY absente ou vide" },
    { integration: "Apify", configured: Boolean(config.apifyToken), state: config.apifyToken ? "configured" : "missing", error: config.apifyToken ? null : "APIFY_API_TOKEN absent ou vide" },
    { integration: "OpenAI", configured: Boolean(config.openAIKey), state: config.openAIKey ? "configured" : "missing", error: config.openAIKey ? null : "OPENAI_API_KEY absent ou vide" },
    { integration: "Supabase", configured: Boolean(config.supabaseUrl && config.supabaseKey), state: config.supabaseUrl && config.supabaseKey ? "configured" : "missing", error: config.supabaseUrl && config.supabaseKey ? null : "URL ou clé serveur Supabase absente" },
    { integration: "Chiffrement OAuth", configured: Boolean(config.tokenEncryptionKey), state: config.tokenEncryptionKey ? "configured" : "missing", error: config.tokenEncryptionKey ? null : "TOKEN_ENCRYPTION_KEY absent ou vide" },
    { integration: "Open Charge Map", configured: Boolean(config.openChargeMapKey), state: config.openChargeMapKey ? "configured" : "missing", error: config.openChargeMapKey ? null : "OPEN_CHARGE_MAP_API_KEY absent ou vide" },
  ] as const;
  return diagnostics;
}

export function requireServerConfig() {
  const config = getServerConfig();
  const missing = Object.entries({
    GOOGLE_OAUTH_CLIENT_ID: config.googleOAuthClientId,
    GOOGLE_OAUTH_CLIENT_SECRET: config.googleOAuthClientSecret,
    NEXT_PUBLIC_SUPABASE_URL: config.supabaseUrl,
    SUPABASE_SECRET_KEY: config.supabaseKey,
    TOKEN_ENCRYPTION_KEY: config.tokenEncryptionKey,
  }).filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Configuration serveur incomplète : ${missing.join(", ")}.`);
  return config;
}
