import { spawnSync } from "node:child_process";

const command = process.platform === "win32" ? "vite.cmd" : "vite";
const result = spawnSync(command, ["build"], {
  stdio: "inherit",
  env: { ...process.env, NITRO_PRESET: process.env.NITRO_PRESET ?? "vercel" },
  shell: process.platform === "win32",
});
process.exit(result.status ?? 1);
