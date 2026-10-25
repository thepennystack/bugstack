import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";
import { accessHeaders, cloudflareEnv } from "./env.mjs";

const WORKERS_DEV = "bugstack.matthijs-f49.workers.dev";
const ORIGINS = ["https://bugstack.kattebak.fyi", `https://${WORKERS_DEV}`];
const SMOKE_APP = {
  name: "bugstack-smoke",
  description: "Created by npm run smoke",
  installationId: 0,
  githubRepo: "thepennystack/bugstack",
};
const SMOKE_CLIENT = "agent";
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

const api = async (origin, method, path, body) => {
  const response = await fetch(`${origin}${path}`, {
    method,
    redirect: "manual",
    headers: { ...token, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await json(response) };
};

const smokeApp = async (origin) => {
  const list = await api(origin, "GET", "/api/apps");
  check(
    `${origin} GET /api/apps lists apps`,
    list.status === 200 && Array.isArray(list.body),
    `${list.status} ${JSON.stringify(list.body)}`,
  );
  const existing = Array.isArray(list.body)
    ? list.body.find((app) => app.name === SMOKE_APP.name)
    : undefined;
  if (existing) return existing;
  const created = await api(origin, "POST", "/api/apps", SMOKE_APP);
  check(
    `${origin} POST /api/apps creates ${SMOKE_APP.name}`,
    created.status === 201 &&
      created.body.appId?.length === 25 &&
      created.body.githubRepo === SMOKE_APP.githubRepo,
    `${created.status} ${JSON.stringify(created.body)}`,
  );
  return created.body;
};

const smokeApi = async (origin) => {
  const app = await smokeApp(origin);
  const listed = await api(origin, "GET", "/api/apps");
  check(
    `${origin} GET /api/apps returns ${app.appId}`,
    listed.status === 200 && listed.body.some((each) => each.appId === app.appId),
    `${listed.status} ${JSON.stringify(listed.body)}`,
  );

  const put = await api(origin, "PUT", `/api/apps/${app.appId}`, SMOKE_APP);
  check(
    `${origin} PUT /api/apps/${app.appId} saves the app`,
    put.status === 200 && put.body.appId === app.appId && put.body.name === SMOKE_APP.name,
    `${put.status} ${JSON.stringify(put.body)}`,
  );

  const detail = await api(origin, "GET", `/api/apps/${app.appId}`);
  check(
    `${origin} GET /api/apps/${app.appId} returns the app and its clients`,
    detail.status === 200 &&
      detail.body.app?.appId === app.appId &&
      Array.isArray(detail.body.clients),
    `${detail.status} ${JSON.stringify(detail.body)}`,
  );
  const clients = Array.isArray(detail.body.clients) ? detail.body.clients : [];
  check(
    `${origin} GET /api/apps/${app.appId} never returns a secret`,
    clients.every((client) => !("secret" in client)),
    "a client carries a secret",
  );

  let agent = clients.find((client) => client.name === SMOKE_CLIENT && client.status === "Active");
  if (!agent) {
    const created = await api(origin, "POST", `/api/apps/${app.appId}/clients`, {
      name: SMOKE_CLIENT,
    });
    check(
      `${origin} POST /api/apps/${app.appId}/clients creates ${SMOKE_CLIENT} with a secret`,
      created.status === 201 &&
        created.body.status === "Active" &&
        /^[A-Za-z0-9_-]{43}$/.test(created.body.secret ?? ""),
      `${created.status} ${created.body.reason ?? ""}`,
    );
    agent = created.body;
  }

  const throwaway = await api(origin, "POST", `/api/apps/${app.appId}/clients`, {
    name: "smoke-revoke",
  });
  const revoked = await api(origin, "POST", `/api/clients/${throwaway.body.clientId}/revoke`, {});
  check(
    `${origin} POST /api/clients/{clientId}/revoke flips the status`,
    throwaway.status === 201 &&
      throwaway.body.status === "Active" &&
      revoked.status === 200 &&
      revoked.body.status === "Revoked" &&
      !("secret" in revoked.body),
    `${throwaway.status} ${revoked.status} ${JSON.stringify(revoked.body)}`,
  );

  const installations = await api(origin, "GET", "/api/github/installations");
  check(
    `${origin} GET /api/github/installations answers 503 SecretMissing or the list`,
    (installations.status === 503 &&
      installations.body.reason === "SecretMissing" &&
      installations.body.message.includes("GITHUB_APP_")) ||
      (installations.status === 200 && Array.isArray(installations.body)),
    `${installations.status} ${JSON.stringify(installations.body)}`,
  );

  for (const [label, body] of [
    ["an empty name", { ...SMOKE_APP, name: "  " }],
    ["a bare repo", { ...SMOKE_APP, githubRepo: "bugstack" }],
    ["a negative installationId", { ...SMOKE_APP, installationId: -1 }],
    ["a long description", { ...SMOKE_APP, description: "x".repeat(501) }],
  ]) {
    const refused = await api(origin, "POST", "/api/apps", body);
    check(
      `${origin} POST /api/apps refuses ${label} with 400`,
      refused.status === 400 && refused.body.reason === "Invalid",
      `${refused.status} ${JSON.stringify(refused.body)}`,
    );
  }

  for (const [method, path, body] of [
    ["GET", "/api/apps/0000000000000000000000000", undefined],
    ["PUT", "/api/apps/0000000000000000000000000", SMOKE_APP],
    ["POST", "/api/apps/0000000000000000000000000/clients", { name: SMOKE_CLIENT }],
    ["POST", "/api/clients/0000000000000000000000000/revoke", {}],
  ]) {
    const missing = await api(origin, method, path, body);
    check(
      `${origin} ${method} ${path} answers 404`,
      missing.status === 404 && missing.body.reason === "NotFound",
      `${missing.status} ${JSON.stringify(missing.body)}`,
    );
  }

  smoked.appId = app.appId;
  smoked.clientId = agent.clientId;
  console.log(`smoke app ${app.appId}, client ${SMOKE_CLIENT} ${agent.clientId}`);
};

const smokePages = async (origin) => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ extraHTTPHeaders: token });
  const page = await context.newPage();
  const visit = async (label, path, text) => {
    const shown = await page
      .goto(`${origin}${path}`)
      .then(() => page.getByText(text).first().waitFor({ timeout: 15000 }))
      .then(() => page.locator("[role=alert] h2").count())
      .then((alerts) => (alerts === 0 ? "" : "an error notice rendered"))
      .catch((error) => String(error).split("\n")[0]);
    check(`${origin}${path} renders ${label}`, shown === "", shown);
  };
  await visit("the app list", "/", SMOKE_APP.name);
  await visit("the app page with its clients", `/apps/${smoked.appId}`, smoked.clientId);
  await visit(
    "the app form with the GitHub notice or picker",
    "/apps/new",
    /GitHub App secrets are missing|GitHub installation/,
  );
  await visit("the edit form", `/apps/${smoked.appId}/edit`, `Edit ${SMOKE_APP.name}`);
  await browser.close();
};

const smoked = {};

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
const previewed = await fetch(`${preview}/api/me`, { redirect: "manual" });
check(
  `${preview} does not reach the Worker`,
  previewed.status === 404 && previewed.headers.get("x-bugstack-commit") === null,
  `${previewed.status} header ${previewed.headers.get("x-bugstack-commit")}`,
);

await smokeApi(ORIGINS[0]);
await smokePages(ORIGINS[0]);

if (failures.length > 0) process.exit(1);
