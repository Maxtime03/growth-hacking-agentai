import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const fileEnvironment = loadEnv(mode, process.cwd(), "");
  const localDevelopmentEnabled =
    command === "serve" &&
    (process.env.LOCAL_DEV_MODE ?? fileEnvironment.LOCAL_DEV_MODE) === "true";

  return {
    // Vinext executes server components in a Worker isolate where arbitrary
    // process variables are not inherited. Inline this one non-secret flag,
    // and always disable it in production builds.
    define: {
      "process.env.LOCAL_DEV_MODE": JSON.stringify(localDevelopmentEnabled ? "true" : "false"),
      // Server-only values are inlined into the isolated server bundle. They
      // are never imported by client modules; only the explicitly public Maps
      // key is referenced by the browser component.
      ...Object.fromEntries([
        "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REDIRECT_URI",
        "APIFY_API_TOKEN", "OPENAI_API_KEY", "OPENAI_MODEL", "NEXT_PUBLIC_SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY",
        "TOKEN_ENCRYPTION_KEY", "OPEN_CHARGE_MAP_API_KEY", "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
      ].map((name) => [`process.env.${name}`, JSON.stringify(process.env[name] ?? fileEnvironment[name] ?? "")])),
    },
    server: {
      host: "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
