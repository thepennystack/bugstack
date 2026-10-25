import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { cloudflareEnv } from "./env.mjs";

const { values } = parseArgs({
  options: {
    port: { type: "string", default: "8789" },
    worker: { type: "string", default: "https://bugstack.kattebak.fyi" },
    owner: { type: "string" },
    name: { type: "string", default: "bugstack" },
  },
});

const fail = (message) => {
  console.error(`bootstrap: ${message}`);
  process.exit(1);
};

const port = Number(values.port);
if (!Number.isInteger(port) || port <= 0) fail(`--port must be a positive integer`);
const worker = URL.parse(values.worker);
if (!worker || !["http:", "https:"].includes(worker.protocol)) fail(`--worker must be an origin`);
const origin = worker.origin;
const owner = values.owner;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = cloudflareEnv();
const state = randomBytes(16).toString("hex");
let github;

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const page = (title, body) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root { color-scheme: light dark; }
body { font: 17px/1.5 system-ui, sans-serif; margin: 0 auto; max-width: 36rem; padding: 1rem; }
label { display: block; margin: 1rem 0; font-weight: 600; }
input { display: block; width: 100%; box-sizing: border-box; font: inherit; padding: 0.6rem; margin-top: 0.3rem; }
button, .button { display: inline-block; font: inherit; font-weight: 600; padding: 0.8rem 1.4rem; border: 0; border-radius: 8px; background: #2da44e; color: #fff; text-decoration: none; }
code { overflow-wrap: anywhere; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>
`;

const send = (res, status, html) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
};

const manifestFor = (base) => ({
  name: values.name,
  url: origin,
  redirect_url: `${base}/github/callback`,
  setup_url: `${origin}/api/github/setup`,
  setup_on_update: false,
  public: true,
  default_permissions: { issues: "write", metadata: "read" },
  default_events: [],
});

const githubPage = (base) => {
  const action = owner
    ? `https://github.com/organizations/${encodeURIComponent(owner)}/settings/apps/new?state=${state}`
    : `https://github.com/settings/apps/new?state=${state}`;
  const manifest = manifestFor(base);
  return page(
    "1. Create the GitHub App",
    `<p>bugstack files issues through one public GitHub App owned by ${escapeHtml(owner ?? "your personal account")}. GitHub shows the app form filled in, then sends you back here.</p>
<form id="github" method="post" action="${escapeHtml(action)}">
<label>App name (unique across GitHub)<input id="name" required maxlength="34" value="${escapeHtml(manifest.name)}"></label>
<input type="hidden" id="manifest" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
<button type="submit">Create GitHub App</button>
</form>
<script>
document.getElementById("github").addEventListener("submit", () => {
  const field = document.getElementById("manifest");
  const manifest = JSON.parse(field.value);
  manifest.name = document.getElementById("name").value.trim();
  field.value = JSON.stringify(manifest);
});
</script>`,
  );
};

const slackManifest = {
  display_information: { name: "bugstack", description: "Bug reports filed as GitHub issues" },
  features: { bot_user: { display_name: "bugstack", always_online: false } },
  oauth_config: {
    redirect_urls: [`${origin}/api/slack/oauth/callback`],
    scopes: { bot: ["chat:write"] },
  },
};

const slackPage = () =>
  page(
    "2. Create the Slack app",
    `<p>GitHub App <code>${escapeHtml(github.slug)}</code> is created. Now create the Slack app from its manifest.</p>
<p><a class="button" target="_blank" rel="noopener" href="https://api.slack.com/apps?new_app=1&amp;manifest_json=${escapeHtml(encodeURIComponent(JSON.stringify(slackManifest)))}">Create Slack app</a></p>
<p>Slack shows the client id and client secret on the app's Basic Information page.</p>
<form method="post" action="/slack">
<label>Client ID<input name="clientId" required autocomplete="off"></label>
<label>Client Secret<input name="clientSecret" type="password" required autocomplete="off"></label>
<button type="submit">Store secrets</button>
</form>`,
  );

const convert = async (code) => {
  const response = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", "User-Agent": "bugstack" },
    },
  );
  if (!response.ok) {
    return { ok: false, message: `${response.status} ${(await response.text()).slice(0, 300)}` };
  }
  const app = await response.json();
  return { ok: true, app: { id: String(app.id), slug: app.slug, pem: app.pem } };
};

const putSecret = (name, value) => {
  console.log(`setting ${name}`);
  const run = spawnSync("npx", ["wrangler", "secret", "put", name], {
    cwd: root,
    env,
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (run.error) throw run.error;
  return run.status === 0;
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
};

const finish = (res, status, html, code) => {
  res.on("finish", () => {
    server.closeAllConnections();
    server.close(() => process.exit(code));
  });
  send(res, status, html);
};

const handle = async (req, res) => {
  const base = `http://${req.headers.host ?? `${hostname()}:${port}`}`;
  const url = new URL(req.url ?? "/", base);

  if (req.method === "GET" && url.pathname === "/") {
    if (github) return send(res, 200, slackPage());
    return send(res, 200, githubPage(base));
  }

  if (req.method === "GET" && url.pathname === "/github/callback") {
    if (url.searchParams.get("state") !== state) {
      return send(
        res,
        400,
        page(
          "State mismatch",
          `<p>This callback does not belong to the running bootstrap. <a href="/">Start again</a>.</p>`,
        ),
      );
    }
    const code = url.searchParams.get("code");
    if (!code) {
      return send(
        res,
        400,
        page("No code", `<p>GitHub sent no code. <a href="/">Start again</a>.</p>`),
      );
    }
    const result = await convert(code);
    if (!result.ok) {
      console.error(`bootstrap: GitHub refused the conversion: ${result.message}`);
      return send(
        res,
        502,
        page(
          "GitHub refused",
          `<p>${escapeHtml(result.message)}</p><p>Codes are single use and expire after an hour. <a href="/">Start again</a>.</p>`,
        ),
      );
    }
    github = result.app;
    console.log(`GitHub App ${github.slug} created`);
    return send(res, 200, slackPage());
  }

  if (req.method === "POST" && url.pathname === "/slack") {
    if (!github) {
      return send(
        res,
        409,
        page("GitHub App missing", `<p>Create the GitHub App first. <a href="/">Start</a>.</p>`),
      );
    }
    const form = await readBody(req);
    const clientId = (form.get("clientId") ?? "").trim();
    const clientSecret = (form.get("clientSecret") ?? "").trim();
    if (!clientId || !clientSecret) {
      return send(res, 400, slackPage());
    }
    const secrets = [
      ["GITHUB_APP_ID", github.id],
      ["GITHUB_APP_SLUG", github.slug],
      ["GITHUB_PRIVATE_KEY", github.pem],
      ["SLACK_CLIENT_ID", clientId],
      ["SLACK_CLIENT_SECRET", clientSecret],
    ];
    for (const [name, value] of secrets) {
      if (putSecret(name, value)) continue;
      return finish(
        res,
        500,
        page(
          "Storing secrets failed",
          `<p><code>wrangler secret put ${name}</code> failed; the terminal shows why. Fix it and run <code>npm run bootstrap</code> again.</p>`,
        ),
        1,
      );
    }
    const install = `https://github.com/apps/${github.slug}/installations/new`;
    console.log(`done; install the GitHub App at ${install}`);
    return finish(
      res,
      200,
      page(
        "Done",
        `<p>The five secrets are stored on the Worker.</p>
<p><a class="button" href="${escapeHtml(install)}">Install the GitHub App</a></p>
<p>Install it on each account whose repositories bugstack files into, then open <a href="${escapeHtml(origin)}">bugstack</a> to add it to a Slack workspace and create an app.</p>`,
      ),
      0,
    );
  }

  return send(res, 404, page("Not found", `<p><a href="/">Start</a>.</p>`));
};

const tailnetName = () => {
  const run = spawnSync("tailscale", ["status", "--json"], { encoding: "utf8" });
  if (run.error || run.status !== 0) return undefined;
  const name = JSON.parse(run.stdout)?.Self?.DNSName;
  return typeof name === "string" && name ? name.replace(/\.$/, "") : undefined;
};

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error(`bootstrap: ${error.message}`);
    send(res, 500, page("Failed", `<p>${escapeHtml(error.message)}</p>`));
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Open http://${hostname()}:${port}`);
  const tailnet = tailnetName();
  if (tailnet) console.log(`  or http://${tailnet}:${port}`);
});
