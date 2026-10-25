import { execFileSync } from "node:child_process";
import { accessHeaders, cloudflareEnv } from "./env.mjs";

const WORKERS_DEV = "bugstack.matthijs-f49.workers.dev";
const ORIGINS = ["https://bugstack.kattebak.fyi", `https://${WORKERS_DEV}`];
const FORGED =
  "eyJhbGciOiJSUzI1NiIsImtpZCI6ImZvcmdlZCJ9.eyJlbWFpbCI6Im1hdHRoaWpzQGlzY2hlbi5ubCJ9.Zm9yZ2Vk";
const commit =
  process.argv[2] ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const token = accessHeaders();
const clientId = token["CF-Access-Client-Id"];
const failures = [];

const check = (label, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `: ${detail}`}`);
  if (!ok) failures.push(label);
};

const json = async (response) => {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, 200) };
  }
};

const previewOrigin = () => {
  const status = JSON.parse(
    execFileSync("npx", ["wrangler", "deployments", "status", "--json"], {
      env: cloudflareEnv(),
      encoding: "utf8",
    }),
  );
  const versionId = status.versions?.[0]?.version_id;
  if (!versionId)
    throw new Error(`wrangler deployments status has no version: ${JSON.stringify(status)}`);
  return `https://${versionId.slice(0, 8)}-${WORKERS_DEV}`;
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
  const script = page.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  const bundle = script
    ? await fetch(new URL(script, origin), { redirect: "manual", headers: token })
    : undefined;
  const code = bundle?.status === 200 ? await bundle.text() : "";
  check(
    `${origin}/ serves the admin shell with the service token`,
    signed.status === 200 &&
      page.includes("<title>bugstack</title>") &&
      page.includes('<div id="app">') &&
      code.includes("Sign in again") &&
      code.includes("/api/me"),
    `${signed.status} script ${script} ${bundle?.status}`,
  );

  const me = await fetch(`${origin}/api/me`, { redirect: "manual", headers: token });
  const identity = await json(me);
  check(
    `${origin}/api/me answers the service token client id`,
    me.status === 200 && identity.email === clientId,
    `${me.status} ${JSON.stringify(identity)}`,
  );

  const meAnonymous = await fetch(`${origin}/api/me`, { redirect: "manual" });
  check(
    `${origin}/api/me redirects to Access without a token`,
    meAnonymous.status === 302,
    `${meAnonymous.status}`,
  );

  const plain = await fetch(`${origin}/api/me`, {
    method: "POST",
    redirect: "manual",
    headers: { ...token, "content-type": "text/plain" },
    body: "{}",
  });
  const refused = await json(plain);
  check(
    `${origin}/api/me refuses a text/plain POST with 415`,
    plain.status === 415 && refused.reason === "UnsupportedMediaType",
    `${plain.status} ${JSON.stringify(refused)}`,
  );
}

const preview = previewOrigin();
const forged = await fetch(`${preview}/api/me`, {
  redirect: "manual",
  headers: { "Cf-Access-Jwt-Assertion": FORGED },
});
const denied = await json(forged);
check(
  `${preview}/api/me refuses a forged Cf-Access-Jwt-Assertion with 401`,
  forged.status === 401 && denied.reason === "Unauthorized",
  `${forged.status} ${JSON.stringify(denied)}`,
);

if (failures.length > 0) process.exit(1);
