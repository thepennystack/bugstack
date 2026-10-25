import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareEnv } from "./env.mjs";

const name = process.argv[2];
if (!name) {
  console.error("usage: <value on stdin> | npm run secret -- <NAME>");
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = process.env.WORKERS_CI ? process.env : cloudflareEnv();
const run = spawnSync("npx", ["wrangler", "secret", "put", name], {
  cwd: root,
  env,
  stdio: ["inherit", "inherit", "inherit"],
});
if (run.error) throw run.error;
process.exit(run.status ?? 1);
