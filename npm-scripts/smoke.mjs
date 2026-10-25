import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { accessHeaders, CONFIG_DIR, cloudflareEnv } from "./env.mjs";
import { signedHeaders } from "./sign.mjs";

const WORKERS_DEV = "bugstack.matthijs-f49.workers.dev";
const ORIGINS = ["https://bugstack.kattebak.fyi", `https://${WORKERS_DEV}`];
const SMOKE_APP = {
  name: "bugstack-smoke",
  description: "Created by npm run smoke",
  installationId: 0,
  githubRepo: "thepennystack/bugstack",
};
const SMOKE_CLIENT = "agent";
const SIGNER = "smoke-signer";
const SIGNER_FILE = join(CONFIG_DIR, "smoke-client");
const REVOKE_CLIENT = "smoke-revoke";
const OTHER_APP = { ...SMOKE_APP, name: "bugstack-smoke-other" };
const MAX_BODY = 60 * 1024;
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

const findOrCreateApp = async (origin, wanted) => {
  const list = await api(origin, "GET", "/api/apps");
  check(
    `${origin} GET /api/apps lists apps`,
    list.status === 200 && Array.isArray(list.body),
    `${list.status} ${JSON.stringify(list.body)}`,
  );
  const existing = Array.isArray(list.body)
    ? list.body.find((app) => app.name === wanted.name)
    : undefined;
  if (existing) return existing;
  const created = await api(origin, "POST", "/api/apps", wanted);
  check(
    `${origin} POST /api/apps creates ${wanted.name}`,
    created.status === 201 &&
      created.body.appId?.length === 25 &&
      created.body.githubRepo === wanted.githubRepo,
    `${created.status} ${JSON.stringify(created.body)}`,
  );
  return created.body;
};

const smokeApi = async (origin) => {
  const app = await findOrCreateApp(origin, SMOKE_APP);
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

  const revokedClient = await smokeRevoked(origin, app.appId, clients);
  const signer = await smokeSigner(origin, app.appId, clients);
  const other = await findOrCreateApp(origin, OTHER_APP);
  smoked.reportTitle = await smokeReports(origin, app.appId, other.appId, signer, revokedClient);

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

const smokeRevoked = async (origin, appId, clients) => {
  const existing = clients.find(
    (client) => client.name === REVOKE_CLIENT && client.status === "Revoked",
  );
  if (existing) return existing.clientId;
  const throwaway = await api(origin, "POST", `/api/apps/${appId}/clients`, {
    name: REVOKE_CLIENT,
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
  return throwaway.body.clientId;
};

const readSigner = () => {
  if (!existsSync(SIGNER_FILE)) return undefined;
  return JSON.parse(readFileSync(SIGNER_FILE, "utf8"));
};

const smokeSigner = async (origin, appId, clients) => {
  const saved = readSigner();
  const active = clients.some(
    (client) => client.clientId === saved?.clientId && client.status === "Active",
  );
  if (saved?.appId === appId && active) return saved;
  const created = await api(origin, "POST", `/api/apps/${appId}/clients`, { name: SIGNER });
  check(
    `${origin} POST /api/apps/${appId}/clients creates ${SIGNER}`,
    created.status === 201 && typeof created.body.secret === "string",
    `${created.status} ${created.body.reason ?? ""}`,
  );
  const signer = { appId, clientId: created.body.clientId, secret: created.body.secret };
  writeFileSync(SIGNER_FILE, JSON.stringify(signer), { mode: 0o600 });
  chmodSync(SIGNER_FILE, 0o600);
  return signer;
};

const postReport = async (origin, appId, body, headers) => {
  const response = await fetch(`${origin}/v1/apps/${appId}/reports`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
  return { status: response.status, body: await json(response) };
};

const smokeReports = async (origin, appId, otherAppId, signer, revokedClientId) => {
  const title = `Smoke report ${commit.slice(0, 7)} ${new Date().toISOString()}`;
  const body = JSON.stringify({ title, error: "Error: smoke\n    at smoke.mjs", extra: 1 });
  const sign = (text, timestamp) => signedHeaders(signer.clientId, signer.secret, text, timestamp);

  const accepted = await postReport(origin, appId, body, sign(body));
  check(
    `${origin} a signed report answers 202 with a reportId`,
    accepted.status === 202 && accepted.body.reportId?.length === 25,
    `${accepted.status} ${JSON.stringify(accepted.body)}`,
  );
  const reports = await api(origin, "GET", `/api/apps/${appId}/reports`);
  const row = Array.isArray(reports.body)
    ? reports.body.find((report) => report.reportId === accepted.body.reportId)
    : undefined;
  check(
    `${origin} GET /api/apps/${appId}/reports lists the report as Pending`,
    reports.status === 200 &&
      reports.body.length <= 100 &&
      row?.title === title &&
      row.status === "Pending" &&
      row.attempts === 0 &&
      row.clientName === SIGNER &&
      row.issueUrl === null &&
      row.slackPosted === false &&
      row.lastFailure === null,
    `${reports.status} ${JSON.stringify(row ?? reports.body).slice(0, 300)}`,
  );

  const now = Math.floor(Date.now() / 1000);
  const large = JSON.stringify({ title, body: "x".repeat(61 * 1024) });
  for (const [label, target, text, headers, status, reason] of [
    ["an unsigned request", appId, body, {}, 401, "MissingSignature"],
    ["a 301 s old timestamp", appId, body, sign(body, now - 301), 401, "StaleTimestamp"],
    [
      "a bad signature",
      appId,
      body,
      signedHeaders(signer.clientId, "not-the-secret", body),
      401,
      "BadSignature",
    ],
    [
      "a revoked client",
      appId,
      body,
      signedHeaders(revokedClientId, "not-the-secret", body),
      401,
      "UnknownClient",
    ],
    ["a client of another app", otherAppId, body, sign(body), 401, "UnknownClient"],
    [`a ${large.length} byte body`, appId, large, sign(large), 413, "TooLarge"],
    [
      "a missing title",
      appId,
      JSON.stringify({ error: "no title" }),
      sign(JSON.stringify({ error: "no title" })),
      400,
      "InvalidReport",
    ],
  ]) {
    const refused = await postReport(origin, target, text, headers);
    check(
      `${origin} POST /v1/apps/{appId}/reports refuses ${label} with ${status} ${reason}`,
      refused.status === status && refused.body.reason === reason,
      `${refused.status} ${JSON.stringify(refused.body)}`,
    );
  }
  check(`the large body exceeds ${MAX_BODY} bytes`, large.length > MAX_BODY, large.length);
  return title;
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
  await visit("the app page with its reports", `/apps/${smoked.appId}`, smoked.reportTitle);
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
