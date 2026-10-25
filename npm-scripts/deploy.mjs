import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareEnv } from "./env.mjs";

const ADMIN_EMAIL = "matthijs@ischen.nl";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env =
  process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID
    ? process.env
    : cloudflareEnv();
const vars = JSON.parse(readFileSync(join(root, "infra", "access.json"), "utf8"));
const value = (name) => {
  if (!vars[name]) {
    console.error(`infra/access.json has no ${name}; run npm run infra:apply`);
    process.exit(1);
  }
  return vars[name];
};

const wrangler = (...args) => {
  const run = spawnSync("npx", ["wrangler", ...args], { cwd: root, env, stdio: "inherit" });
  if (run.error) throw run.error;
  if (run.status !== 0) process.exit(run.status ?? 1);
};

wrangler("d1", "migrations", "apply", "DB", "--remote");
wrangler(
  "deploy",
  "--var",
  `ACCESS_TEAM_DOMAIN:${value("ACCESS_TEAM_DOMAIN")}`,
  "--var",
  `ACCESS_AUD:${value("ACCESS_AUD")}`,
  "--var",
  `ADMIN_CLIENT_ID:${value("ADMIN_CLIENT_ID")}`,
  "--var",
  `ADMIN_EMAIL:${ADMIN_EMAIL}`,
);
