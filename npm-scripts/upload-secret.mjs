import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR, cloudflareEnv, UPLOAD_SECRET } from "./env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const secret = randomBytes(32).toString("hex");

mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
writeFileSync(UPLOAD_SECRET, secret, { mode: 0o600 });
chmodSync(UPLOAD_SECRET, 0o600);

const run = spawnSync("npx", ["wrangler", "secret", "put", "UPLOAD_SIGNING_SECRET"], {
  cwd: root,
  env: cloudflareEnv(),
  input: secret,
  stdio: ["pipe", "inherit", "inherit"],
});
if (run.error) throw run.error;
process.exit(run.status ?? 1);
