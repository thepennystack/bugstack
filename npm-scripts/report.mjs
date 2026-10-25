import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { parseArgs } from "node:util";
import { signedHeaders } from "./sign.mjs";

const USAGE =
  'usage: npm run report -- <origin> <appId> <clientId> "<title>" [--error <text>] [--body <text>] [--image <path>]...';

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    error: { type: "string" },
    body: { type: "string" },
    image: { type: "string", multiple: true },
  },
});
const [origin, appId, clientId, title] = positionals;
if (!origin || !appId || !clientId || !title || positionals.length !== 4) {
  console.error(USAGE);
  process.exit(2);
}
const secret = process.env.BUGSTACK_CLIENT_SECRET;
if (!secret) {
  console.error("set BUGSTACK_CLIENT_SECRET to the client secret");
  process.exit(2);
}

const base = origin.replace(/\/$/, "");

const signedPost = (path, payload) => {
  const body = JSON.stringify(payload);
  return fetch(`${base}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", ...signedHeaders(clientId, secret, body) },
    body,
  });
};

const fail = async (step, response) => {
  console.error(`${step}: ${response.status} ${await response.text()}`);
  process.exit(1);
};

const contentTypeOf = (path) => {
  const contentType = CONTENT_TYPES[extname(path).toLowerCase()];
  if (!contentType) {
    console.error(`${path}: the extension must be one of ${Object.keys(CONTENT_TYPES).join(", ")}`);
    process.exit(2);
  }
  return contentType;
};

const files = (values.image ?? []).map((path) => ({
  path,
  contentType: contentTypeOf(path),
  bytes: readFileSync(path),
}));

const { image: _paths, ...fields } = values;
const images = files.map(({ contentType, bytes }) => ({ contentType, size: bytes.length }));
const report = images.length > 0 ? { title, ...fields, images } : { title, ...fields };
const response = await signedPost(`/v1/apps/${appId}/reports`, report);
if (response.status !== 202) await fail("report", response);
const accepted = await response.json();
console.log(`202 ${JSON.stringify(accepted)}`);

for (const [index, { path, contentType, bytes }] of files.entries()) {
  const stored = await fetch(accepted.uploads[index].uploadUrl, {
    method: "PUT",
    headers: { "content-type": contentType },
    body: bytes,
  });
  if (stored.status !== 200) await fail(`upload ${path}`, stored);
  console.log(`stored ${path} as ${accepted.uploads[index].imageId}`);
}
