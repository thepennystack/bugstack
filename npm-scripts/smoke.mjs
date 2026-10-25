import { execFileSync } from "node:child_process";
import { accessHeaders } from "./env.mjs";

const ORIGINS = ["https://bugstack.kattebak.fyi", "https://bugstack.matthijs-f49.workers.dev"];
const commit =
  process.argv[2] ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const token = accessHeaders();
const failures = [];

const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `: ${detail}`}`);
  if (!ok) failures.push(label);
};

for (const origin of ORIGINS) {
  const health = await fetch(`${origin}/v1/health`, { redirect: "manual" });
  const body = health.status === 200 ? await health.json() : {};
  check(
    `${origin}/v1/health serves ${commit} without Access`,
    health.status === 200 &&
      body.commit === commit &&
      health.headers.get("x-bugstack-commit") === commit,
    `${health.status} ${JSON.stringify(body)} header ${health.headers.get("x-bugstack-commit")}`,
  );

  const anonymous = await fetch(`${origin}/`, { redirect: "manual" });
  const location = anonymous.headers.get("location") ?? "";
  check(
    `${origin}/ redirects to Access without a token`,
    anonymous.status === 302 && location.includes("cloudflareaccess.com"),
    `${anonymous.status} ${location}`,
  );

  const signed = await fetch(`${origin}/`, { redirect: "manual", headers: token });
  const page = signed.status === 200 ? await signed.text() : "";
  check(
    `${origin}/ serves the admin page with the service token`,
    signed.status === 200 && page.includes("<title>bugstack</title>"),
    `${signed.status}`,
  );
}

if (failures.length > 0) process.exit(1);
