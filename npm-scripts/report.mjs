import { parseArgs } from "node:util";
import { signedHeaders } from "./sign.mjs";

const USAGE =
  'usage: npm run report -- <origin> <appId> <clientId> "<title>" [--error <text>] [--body <text>]';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { error: { type: "string" }, body: { type: "string" } },
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

const report = { title, ...values };
const body = JSON.stringify(report);
const response = await fetch(`${origin.replace(/\/$/, "")}/v1/apps/${appId}/reports`, {
  method: "POST",
  redirect: "manual",
  headers: { "content-type": "application/json", ...signedHeaders(clientId, secret, body) },
  body,
});
console.log(`${response.status} ${await response.text()}`);
if (!response.ok) process.exit(1);
