import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ACCESS_ENV, CONFIG_DIR, cloudflareEnv, TOFU_INIT } from "./env.mjs";

const infraDir = join(dirname(fileURLToPath(import.meta.url)), "..", "infra");
const env = cloudflareEnv();

const tofu = (...args) => {
  const run = spawnSync("tofu", args, { cwd: infraDir, env, encoding: "utf8" });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    console.error(`tofu ${args[0]} exited ${run.status}`);
    process.exit(run.status ?? 1);
  }
  return run.stdout.trim();
};

tofu(...TOFU_INIT);
const id = tofu("output", "-raw", "access_client_id");
const secret = tofu("output", "-raw", "access_client_secret");
if (!id || !secret) {
  console.error(
    "tofu has no access_client_id or access_client_secret output; is the state current?",
  );
  process.exit(1);
}

mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
writeFileSync(ACCESS_ENV, `CF_ACCESS_CLIENT_ID=${id}\nCF_ACCESS_CLIENT_SECRET=${secret}\n`, {
  mode: 0o600,
});
chmodSync(ACCESS_ENV, 0o600);
