import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const certificatePath = "/run/secrets/npm_ca_cert";
const environment = { ...process.env };

if (environment.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
  throw new Error("Disabling Node TLS verification is forbidden.");
}

if (existsSync(certificatePath)) {
  environment.NODE_EXTRA_CA_CERTS = certificatePath;
} else {
  delete environment.NODE_EXTRA_CA_CERTS;
}

const strictSsl = spawnSync("npm", ["config", "get", "strict-ssl"], {
  env: environment,
  encoding: "utf8",
});
if (strictSsl.status !== 0 || strictSsl.stdout.trim() !== "true") {
  throw new Error("npm strict-ssl must remain enabled.");
}

const registry = spawnSync("npm", ["config", "get", "registry"], {
  env: environment,
  encoding: "utf8",
});
if (registry.status !== 0 || !registry.stdout.trim().startsWith("https://")) {
  throw new Error("npm must use an HTTPS registry.");
}

const result = spawnSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
  env: environment,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
