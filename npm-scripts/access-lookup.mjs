import { cloudflareEnv } from "./env.mjs";

const env = cloudflareEnv();
const api = async (path) => {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}${path}`,
    { headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } },
  );
  const body = await response.json();
  if (!body.success) {
    console.error(`GET ${path} answered ${response.status}: ${JSON.stringify(body.errors)}`);
    process.exit(1);
  }
  return body.result;
};

const providers = await api("/access/identity_providers");
const organization = await api("/access/organizations");
const pin = providers.find((provider) => provider.type === "onetimepin");
if (!pin) {
  console.error("the account has no one-time PIN identity provider");
  process.exit(1);
}
console.log(JSON.stringify({ otp_idp_id: pin.id, team_domain: organization.auth_domain }));
