import { createHmac } from "node:crypto";

export const signature = (secret, timestamp, body) =>
  createHmac("sha256", Buffer.from(secret, "utf8")).update(`${timestamp}.${body}`).digest("hex");

export const signedHeaders = (
  clientId,
  secret,
  body,
  timestamp = Math.floor(Date.now() / 1000),
) => ({
  "X-Bugstack-Client": clientId,
  "X-Bugstack-Timestamp": String(timestamp),
  "X-Bugstack-Signature": signature(secret, timestamp, body),
});
