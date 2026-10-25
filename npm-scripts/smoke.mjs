import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { chromium } from "playwright-core";
import { accessHeaders, CONFIG_DIR, cloudflareEnv, UPLOAD_SECRET } from "./env.mjs";
import { signedHeaders } from "./sign.mjs";

const WORKERS_DEV = "bugstack.matthijs-f49.workers.dev";
const ORIGINS = ["https://bugstack.kattebak.fyi", `https://${WORKERS_DEV}`];
const SMOKE_REPO = "thepennystack/bugstack";
const SMOKE_APP = {
  name: "bugstack-smoke",
  description: "Created by npm run smoke",
  installationId: 0,
  githubRepo: SMOKE_REPO,
};
const UNKNOWN_ID = "0000000000000000000000000";
const DELIVERY_WAIT_MS = 20000;
const SMOKE_CLIENT = "agent";
const SIGNER = "smoke-signer";
const SIGNER_FILE = join(CONFIG_DIR, "smoke-client");
const OTHER_SIGNER_FILE = join(CONFIG_DIR, "smoke-other-client");
const REVOKE_CLIENT = "smoke-revoke";
const OTHER_APP = { ...SMOKE_APP, name: "bugstack-smoke-other" };
const MAX_BODY = 60 * 1024;
const SLACK_CHANNEL = process.env.BUGSTACK_SMOKE_SLACK_CHANNEL ?? "";
const SLACK_OUTSIDE = process.env.BUGSTACK_SMOKE_SLACK_OUTSIDE ?? "general";
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

const githubState = async (origin) => {
  const installations = await api(origin, "GET", "/api/github/installations");
  check(
    `${origin} GET /api/github/installations answers 503 SecretMissing or the list`,
    (installations.status === 503 &&
      installations.body.reason === "SecretMissing" &&
      installations.body.message.includes("GITHUB_APP_")) ||
      (installations.status === 200 && Array.isArray(installations.body)),
    `${installations.status} ${JSON.stringify(installations.body)}`,
  );
  if (installations.status !== 200 || !Array.isArray(installations.body)) return undefined;
  const owner = SMOKE_REPO.split("/")[0];
  const installation = installations.body.find((each) => each.account === owner);
  check(
    `${origin} the GitHub App is installed on ${owner}`,
    installation !== undefined,
    JSON.stringify(installations.body),
  );
  return installation?.installationId;
};

const smokeApi = async (origin) => {
  const installationId = await githubState(origin);
  const appInput = { ...SMOKE_APP, installationId: installationId ?? 0 };
  const app = await findOrCreateApp(origin, appInput);
  const listed = await api(origin, "GET", "/api/apps");
  check(
    `${origin} GET /api/apps returns ${app.appId}`,
    listed.status === 200 && listed.body.some((each) => each.appId === app.appId),
    `${listed.status} ${JSON.stringify(listed.body)}`,
  );

  const put = await api(origin, "PUT", `/api/apps/${app.appId}`, appInput);
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
  smoked.reportTitle = await smokeReports(
    origin,
    app.appId,
    other.appId,
    signer,
    revokedClient,
    installationId !== undefined,
  );

  await smokeUploads(origin, app.appId, other.appId, signer, installationId !== undefined);
  await smokeSlack(origin, app.appId, other.appId, signer, installationId !== undefined);

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
    ["POST", `/api/reports/${UNKNOWN_ID}/retry`, {}],
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

const readSigner = (file) => {
  if (!existsSync(file)) return undefined;
  return JSON.parse(readFileSync(file, "utf8"));
};

const smokeSigner = async (origin, appId, clients, file = SIGNER_FILE) => {
  const saved = readSigner(file);
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
  writeFileSync(file, JSON.stringify(signer), { mode: 0o600 });
  chmodSync(file, 0o600);
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

const findReport = async (origin, appId, reportId) => {
  const reports = await api(origin, "GET", `/api/apps/${appId}/reports`);
  const row = Array.isArray(reports.body)
    ? reports.body.find((report) => report.reportId === reportId)
    : undefined;
  return { status: reports.status, length: reports.body.length, row };
};

const delivered = async (origin, appId, reportId) => {
  const deadline = Date.now() + DELIVERY_WAIT_MS;
  for (;;) {
    const found = await findReport(origin, appId, reportId);
    const done = found.row && (found.row.status !== "Pending" || found.row.lastFailure !== null);
    if (done || Date.now() > deadline) return found;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

const closeIssue = (url) => {
  try {
    execFileSync("gh", ["issue", "close", url, "--comment", "Closed by npm run smoke"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return "";
  } catch (error) {
    return String(error).split("\n")[0];
  }
};

const checkFailurePath = (origin, row) => {
  const failure = row?.lastFailure;
  const wait = Date.parse(row?.nextAttemptAt ?? "") - Date.parse(failure?.failedAt ?? "");
  check(
    `${origin} delivery without the GitHub secrets records SecretMissing and backs off a minute`,
    row?.status === "Pending" &&
      row.attempts === 1 &&
      row.issueUrl === null &&
      failure?.step === "GitHub" &&
      failure.message === "SecretMissing GITHUB_APP_ID" &&
      wait > 55000 &&
      wait < 65000,
    JSON.stringify(row),
  );
};

const ISSUE_URL = new RegExp(`^https://github\\.com/${SMOKE_REPO}/issues/\\d+$`);

const checkHappyPath = (origin, row) => {
  check(
    `${origin} delivery files the report as an issue on ${SMOKE_REPO}`,
    row?.status === "Filed" && row.attempts === 1 && ISSUE_URL.test(row.issueUrl ?? ""),
    JSON.stringify(row),
  );
  if (typeof row?.issueUrl !== "string") return;
  const closed = closeIssue(row.issueUrl);
  check(`gh closes ${row.issueUrl}`, closed === "", closed);
};

const smokeReports = async (origin, appId, otherAppId, signer, revokedClientId, github) => {
  const title = `Smoke report ${commit.slice(0, 7)} ${new Date().toISOString()}`;
  const body = JSON.stringify({ title, error: "Error: smoke\n    at smoke.mjs", extra: 1 });
  const sign = (text, timestamp) => signedHeaders(signer.clientId, signer.secret, text, timestamp);

  const accepted = await postReport(origin, appId, body, sign(body));
  check(
    `${origin} a signed report answers 202 with a reportId`,
    accepted.status === 202 && accepted.body.reportId?.length === 25,
    `${accepted.status} ${JSON.stringify(accepted.body)}`,
  );
  const reports = await delivered(origin, appId, accepted.body.reportId);
  const row = reports.row;
  check(
    `${origin} GET /api/apps/${appId}/reports lists the report`,
    reports.status === 200 &&
      reports.length <= 100 &&
      row?.title === title &&
      row.clientName === SIGNER &&
      row.slackPosted === false,
    `${reports.status} ${JSON.stringify(row).slice(0, 300)}`,
  );
  if (github) checkHappyPath(origin, row);
  else checkFailurePath(origin, row);

  const retried = await api(origin, "POST", `/api/reports/${accepted.body.reportId}/retry`, {});
  check(
    `${origin} POST /api/reports/{reportId}/retry refuses a ${row?.status} report with 409 NotFailed`,
    retried.status === 409 && retried.body.reason === "NotFailed",
    `${retried.status} ${JSON.stringify(retried.body)}`,
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

const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
};

const tinyPng = () => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const pixel = Buffer.from([0, 0xd9, 0x4f, 0x2b, 0xff]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixel)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
};

const signedPost = async (origin, path, signer, payload) => {
  const body = JSON.stringify(payload);
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      ...signedHeaders(signer.clientId, signer.secret, body),
    },
    body,
  });
  return { status: response.status, body: await json(response) };
};

const reserve = (origin, signer, payload) =>
  signedPost(origin, `/v1/apps/${signer.appId}/uploads`, signer, payload);

const putImage = async (url, contentType, bytes) => {
  const response = await fetch(url, {
    method: "PUT",
    redirect: "manual",
    headers: { "content-type": contentType },
    body: bytes,
  });
  return {
    status: response.status,
    cors: response.headers.get("access-control-allow-origin"),
    body: await json(response),
  };
};

const storedImage = async (origin, signer, png) => {
  const reserved = await reserve(origin, signer, { contentType: "image/png", size: png.length });
  const stored = await putImage(reserved.body.uploadUrl, "image/png", png);
  return { reserved, stored, imageId: reserved.body.imageId };
};

const uploadUrl = (origin, imageId, exp) => {
  const secret = readFileSync(UPLOAD_SECRET, "utf8").trim();
  const sig = createHmac("sha256", secret).update(`${imageId}.${exp}`).digest("hex");
  return `${origin}/v1/uploads/${imageId}?exp=${exp}&sig=${sig}`;
};

const smokeUploads = async (origin, appId, otherAppId, signer, github) => {
  const png = tinyPng();
  const reserved = await reserve(origin, signer, { contentType: "image/png", size: png.length });
  const { imageId, uploadUrl: url } = reserved.body;
  check(
    `${origin} a signed upload reservation answers 201 with a signed upload URL`,
    reserved.status === 201 &&
      imageId?.length === 25 &&
      url?.startsWith(`${origin}/v1/uploads/${imageId}?exp=`) &&
      url.includes("&sig=") &&
      Date.parse(reserved.body.expiresAt) > Date.now(),
    `${reserved.status} ${JSON.stringify(reserved.body)}`,
  );

  for (const [label, payload] of [
    ["a text/plain content type", { contentType: "text/plain", size: 10 }],
    ["a zero size", { contentType: "image/png", size: 0 }],
    ["a size over 5 MiB", { contentType: "image/png", size: 5 * 1024 * 1024 + 1 }],
  ]) {
    const refused = await reserve(origin, signer, payload);
    check(
      `${origin} POST /v1/apps/{appId}/uploads refuses ${label} with 400 InvalidUpload`,
      refused.status === 400 && refused.body.reason === "InvalidUpload",
      `${refused.status} ${JSON.stringify(refused.body)}`,
    );
  }
  const unsigned = await fetch(`${origin}/v1/apps/${appId}/uploads`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contentType: "image/png", size: 1 }),
  });
  const unsignedBody = await json(unsigned);
  check(
    `${origin} an unsigned upload reservation answers 401 MissingSignature`,
    unsigned.status === 401 && unsignedBody.reason === "MissingSignature",
    `${unsigned.status} ${JSON.stringify(unsignedBody)}`,
  );

  const preflight = await fetch(url, {
    method: "OPTIONS",
    redirect: "manual",
    headers: {
      Origin: "https://app.example",
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  check(
    `${origin} OPTIONS on the upload URL answers with the CORS headers`,
    preflight.status === 204 &&
      preflight.headers.get("access-control-allow-origin") === "*" &&
      preflight.headers.get("access-control-allow-methods") === "PUT" &&
      preflight.headers.get("access-control-allow-headers") === "content-type",
    `${preflight.status} ${JSON.stringify(Object.fromEntries(preflight.headers))}`,
  );

  const tampered = url.replace(/sig=([0-9a-f])/, (_, first) => `sig=${first === "0" ? "1" : "0"}`);
  const exp = Math.floor(Date.now() / 1000);
  for (const [label, target, contentType, status, reason] of [
    ["a tampered sig", tampered, "image/png", 401, "BadSignature"],
    ["an exp in the past", uploadUrl(origin, imageId, exp - 10), "image/png", 410, "UploadExpired"],
    ["the wrong content type", url, "image/jpeg", 415, "WrongContentType"],
  ]) {
    const refused = await putImage(target, contentType, png);
    check(
      `${origin} PUT /v1/uploads/{imageId} refuses ${label} with ${status} ${reason}`,
      refused.status === status && refused.body.reason === reason && refused.cors === "*",
      `${refused.status} ${refused.cors} ${JSON.stringify(refused.body)}`,
    );
  }
  const tooLarge = await putImage(url, "image/png", Buffer.concat([png, Buffer.alloc(1)]));
  check(
    `${origin} PUT /v1/uploads/{imageId} refuses a body over the reserved size with 413 TooLarge`,
    tooLarge.status === 413 && tooLarge.body.reason === "TooLarge",
    `${tooLarge.status} ${JSON.stringify(tooLarge.body)}`,
  );

  const reservedImage = await fetch(`${origin}/v1/images/${imageId}`, { redirect: "manual" });
  await reservedImage.arrayBuffer();
  check(
    `${origin} GET /v1/images/{imageId} answers 404 before the bytes arrive`,
    reservedImage.status === 404,
    `${reservedImage.status}`,
  );

  const stored = await putImage(url, "image/png", png);
  check(
    `${origin} PUT /v1/uploads/{imageId} stores the image with 200`,
    stored.status === 200 && stored.body.imageId === imageId && stored.cors === "*",
    `${stored.status} ${stored.cors} ${JSON.stringify(stored.body)}`,
  );
  const again = await putImage(url, "image/png", png);
  check(
    `${origin} a second PUT answers 409 AlreadyStored`,
    again.status === 409 && again.body.reason === "AlreadyStored",
    `${again.status} ${JSON.stringify(again.body)}`,
  );

  const image = await fetch(`${origin}/v1/images/${imageId}`, { redirect: "manual" });
  const served = Buffer.from(await image.arrayBuffer());
  check(
    `${origin} GET /v1/images/{imageId} returns the same bytes and content type`,
    image.status === 200 &&
      image.headers.get("content-type") === "image/png" &&
      image.headers.get("cache-control") === "public, max-age=31536000, immutable" &&
      served.equals(png),
    `${image.status} ${image.headers.get("content-type")} ${served.length} bytes`,
  );

  const pending = await reserve(origin, signer, { contentType: "image/png", size: png.length });
  const otherDetail = await api(origin, "GET", `/api/apps/${otherAppId}`);
  const otherSigner = await smokeSigner(
    origin,
    otherAppId,
    Array.isArray(otherDetail.body.clients) ? otherDetail.body.clients : [],
    OTHER_SIGNER_FILE,
  );
  const foreign = await storedImage(origin, otherSigner, png);
  check(
    `${origin} another app stores its own image`,
    foreign.stored.status === 200,
    `${foreign.reserved.status} ${foreign.stored.status} ${JSON.stringify(foreign.stored.body)}`,
  );

  const title = `Smoke screenshot ${commit.slice(0, 7)} ${new Date().toISOString()}`;
  const reportPath = `/v1/apps/${appId}/reports`;
  const accepted = await signedPost(origin, reportPath, signer, {
    title,
    body: "Sent by npm run smoke",
    images: [imageId],
  });
  check(
    `${origin} a report naming a stored image answers 202`,
    accepted.status === 202 && accepted.body.reportId?.length === 25,
    `${accepted.status} ${JSON.stringify(accepted.body)}`,
  );
  const found = await delivered(origin, appId, accepted.body.reportId);
  check(
    `${origin} GET /api/apps/{appId}/reports lists the image under images`,
    JSON.stringify(found.row?.images) === JSON.stringify([imageId]),
    JSON.stringify(found.row),
  );
  if (github) closeRowIssue(found.row);

  for (const [label, id] of [
    ["a Reserved image", pending.body.imageId],
    ["another app's image", foreign.imageId],
    ["an image of another report", imageId],
    ["an unknown image", UNKNOWN_ID],
  ]) {
    const refused = await signedPost(origin, reportPath, signer, { title, images: [id] });
    check(
      `${origin} a report naming ${label} answers 400 InvalidReport with the id`,
      refused.status === 400 &&
        refused.body.reason === "InvalidReport" &&
        refused.body.message?.includes(id),
      `${refused.status} ${JSON.stringify(refused.body)}`,
    );
  }
};

const SLACK_POSTED = "slackPosted is true and the report is Filed";

const slackReport = async (origin, appId, signer, label) => {
  const title = `Smoke Slack ${label} ${commit.slice(0, 7)} ${new Date().toISOString()}`;
  const body = JSON.stringify({ title, body: "Sent by npm run smoke" });
  const accepted = await postReport(
    origin,
    appId,
    body,
    signedHeaders(signer.clientId, signer.secret, body),
  );
  if (accepted.status !== 202) return { accepted };
  const found = await delivered(origin, appId, accepted.body.reportId);
  return { accepted, row: found.row };
};

const closeRowIssue = (row) => {
  if (typeof row?.issueUrl !== "string") return;
  const closed = closeIssue(row.issueUrl);
  check(`gh closes ${row.issueUrl}`, closed === "", closed);
};

const smokeSlackHappyPath = async (origin, appId, signer, workspace) => {
  const slackPath = `/api/apps/${appId}/slack`;
  const linked = await api(origin, "PUT", slackPath, {
    workspaceId: workspace.workspaceId,
    channel: SLACK_CHANNEL,
  });
  check(
    `${origin} PUT ${slackPath} links #${SLACK_CHANNEL} with 204`,
    linked.status === 204,
    `${linked.status} ${JSON.stringify(linked.body)}`,
  );
  const inUse = await api(origin, "DELETE", `/api/slack/workspaces/${workspace.workspaceId}`);
  check(
    `${origin} DELETE a linked Slack workspace answers 409 InUse`,
    inUse.status === 409 && inUse.body.reason === "InUse",
    `${inUse.status} ${JSON.stringify(inUse.body)}`,
  );

  const posted = await slackReport(origin, appId, signer, "post");
  check(
    `${origin} a report to #${SLACK_CHANNEL} posts to Slack: ${SLACK_POSTED}`,
    posted.row?.status === "Filed" && posted.row.slackPosted === true,
    JSON.stringify(posted.row ?? posted.accepted),
  );
  closeRowIssue(posted.row);

  await api(origin, "PUT", slackPath, {
    workspaceId: workspace.workspaceId,
    channel: SLACK_OUTSIDE,
  });
  const outside = await slackReport(origin, appId, signer, "outside");
  const failure = outside.row?.lastFailure;
  check(
    `${origin} a report to #${SLACK_OUTSIDE} without the bot records not_in_channel`,
    outside.row?.status === "Pending" &&
      outside.row.slackPosted === false &&
      typeof outside.row.issueUrl === "string" &&
      failure?.step === "Slack" &&
      failure.message.includes("not_in_channel"),
    JSON.stringify(outside.row ?? outside.accepted),
  );
  closeRowIssue(outside.row);

  const unlinked = await api(origin, "DELETE", slackPath);
  check(
    `${origin} DELETE ${slackPath} unlinks Slack with 204`,
    unlinked.status === 204,
    `${unlinked.status} ${JSON.stringify(unlinked.body)}`,
  );
};

const smokeSlack = async (origin, appId, otherAppId, signer, github) => {
  const workspaces = await api(origin, "GET", "/api/slack/workspaces");
  check(
    `${origin} GET /api/slack/workspaces lists workspaces without a bot token`,
    workspaces.status === 200 &&
      Array.isArray(workspaces.body) &&
      workspaces.body.every((each) => !("botToken" in each) && !("bot_token" in each)),
    `${workspaces.status} ${JSON.stringify(workspaces.body)}`,
  );

  const bogus = await api(origin, "POST", "/api/slack/workspaces", {
    name: "bugstack-smoke-bogus",
    botToken: ["xoxb", "smoke", "bogus"].join("-"),
  });
  check(
    `${origin} POST /api/slack/workspaces refuses a bogus token with 400 and the auth.test error`,
    bogus.status === 400 &&
      bogus.body.reason === "Invalid" &&
      /^Slack auth\.test refused the token: [a-z_]+$/.test(bogus.body.message ?? ""),
    `${bogus.status} ${JSON.stringify(bogus.body)}`,
  );
  console.log(`     auth.test said: ${bogus.body.message}`);

  for (const [label, body] of [
    ["an empty name", { name: " ", botToken: "xoxb-1" }],
    ["a token that is not a bot token", { name: "bugstack-smoke-bogus", botToken: "xoxp-1" }],
  ]) {
    const refused = await api(origin, "POST", "/api/slack/workspaces", body);
    check(
      `${origin} POST /api/slack/workspaces refuses ${label} with 400`,
      refused.status === 400 && refused.body.reason === "Invalid",
      `${refused.status} ${JSON.stringify(refused.body)}`,
    );
  }

  for (const [method, path, body] of [
    ["PUT", `/api/apps/${appId}/slack`, { workspaceId: UNKNOWN_ID, channel: "bugs" }],
    ["PUT", `/api/apps/${UNKNOWN_ID}/slack`, { workspaceId: UNKNOWN_ID, channel: "bugs" }],
    ["DELETE", `/api/apps/${UNKNOWN_ID}/slack`, undefined],
    ["DELETE", `/api/slack/workspaces/${UNKNOWN_ID}`, undefined],
  ]) {
    const missing = await api(origin, method, path, body);
    check(
      `${origin} ${method} ${path} answers 404 NotFound`,
      missing.status === 404 && missing.body.reason === "NotFound",
      `${missing.status} ${JSON.stringify(missing.body)}`,
    );
  }

  const blank = await api(origin, "PUT", `/api/apps/${appId}/slack`, {
    workspaceId: UNKNOWN_ID,
    channel: "   ",
  });
  check(
    `${origin} PUT /api/apps/{appId}/slack refuses a blank channel with 400`,
    blank.status === 400 && blank.body.reason === "Invalid",
    `${blank.status} ${JSON.stringify(blank.body)}`,
  );

  const unlinked = await api(origin, "DELETE", `/api/apps/${otherAppId}/slack`);
  check(
    `${origin} DELETE /api/apps/{appId}/slack on an app without Slack answers 204`,
    unlinked.status === 204,
    `${unlinked.status} ${JSON.stringify(unlinked.body)}`,
  );

  const workspace = Array.isArray(workspaces.body) ? workspaces.body[0] : undefined;
  const missing = [
    workspace === undefined && "no Slack workspace exists",
    SLACK_CHANNEL === "" && "BUGSTACK_SMOKE_SLACK_CHANNEL is not set",
    !github && "the GitHub App secrets are not set",
  ].filter(Boolean);
  if (missing.length > 0) {
    console.log(`skip the Slack happy path: ${missing.join(", ")}`);
    return;
  }
  await smokeSlackHappyPath(origin, appId, signer, workspace);
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
  await visit("the Slack workspaces page", "/slack", "Add a workspace");
  await visit(
    "the app page with its Slack section",
    `/apps/${smoked.appId}`,
    /Reports from this app go to GitHub only|No Slack workspaces yet/,
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
