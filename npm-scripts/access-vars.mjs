import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const infraDir = join(dirname(fileURLToPath(import.meta.url)), "..", "infra");
export const ACCESS_VARS = join(infraDir, "access.json");

export const writeAccessVars = (env) => {
  const run = spawnSync("tofu", ["output", "-json"], { cwd: infraDir, env, encoding: "utf8" });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    console.error(`tofu output exited ${run.status}`);
    process.exit(run.status ?? 1);
  }
  const outputs = JSON.parse(run.stdout);
  const vars = {
    ACCESS_TEAM_DOMAIN: outputs.access_team_domain?.value,
    ACCESS_AUD: outputs.access_aud?.value,
    ADMIN_CLIENT_ID: outputs.access_client_id?.value,
  };
  const missing = Object.entries(vars).filter(([, value]) => !value);
  if (missing.length > 0) {
    console.error(`tofu has no output for ${missing.map(([name]) => name).join(", ")}`);
    process.exit(1);
  }
  writeFileSync(ACCESS_VARS, `${JSON.stringify(vars, null, 2)}\n`);
};
