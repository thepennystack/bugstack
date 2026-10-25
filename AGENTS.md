# bugstack

bugstack takes signed bug reports from app backends and files each as a GitHub issue, with an optional Slack post. One Rust Cloudflare Worker in `crates/server` serves `/v1/*` (public), `/api/*` (admin) and the Preact admin app in `apps/admin`. D1 is the only store.

## Rules

- Rust and TypeScript only. No Python.
- Commit to `main` in small conventional commits. No CI workflow; no tests except the HMAC check.
- No code comments. Fail fast, return early, no `any`.
- Run `npm run fix`, `lint`, `lint:rust` and `typecheck` before every push.
- Scripts read `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from `~/.config/bugstack/cf-env`. Never read or print that file or the tofu state.

## Scripts

| Script                               | Does                                                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `npm run fix`                        | Biome and `cargo fmt` rewrite files                                                                       |
| `npm run lint` / `lint:rust`         | Biome check / `cargo fmt --check` and `clippy -D warnings`                                                |
| `npm run typecheck`                  | `tsc` over `apps/*`                                                                                       |
| `npm run build` / `build:worker`     | Vite build of `apps/admin` / wasm bundle in `crates/server/build`                                         |
| `npm run deploy`                     | Apply D1 migrations, then `wrangler deploy` with the vars from `infra/access.json`                        |
| `npm run infra:plan` / `infra:apply` | OpenTofu in `infra/`, state at `~/.config/bugstack/terraform.tfstate`; apply rewrites `infra/access.json` |
| `npm run access:env`                 | Write the service token to `~/.config/bugstack/access-env` (mode 600)                                     |
| `npm run access:lookup`              | Print the PIN provider id and team domain                                                                 |
| `npm run secret -- <NAME>`           | Pipe stdin to `wrangler secret put`                                                                       |
| `npm run smoke [-- <sha>]`           | Check health, Access, the admin API and report ingest, then render the pages in headless Chromium         |
| `npm run report -- …`                | Sign and POST one report (see Report ingest)                                                              |
| `npm run test:rust`                  | `cargo test`: the HMAC check in `sign.rs`                                                                 |

## Admin API

Every `/api/*` request verifies the Access JWT (`Cf-Access-Jwt-Assertion`, else the `CF_Authorization` cookie) in `crates/server/src/auth.rs`, then admits only `ADMIN_EMAIL` or the service token whose `common_name` is `ADMIN_CLIENT_ID`; anything else is 401 `Unauthorized`. POST and PUT, and DELETE with a body, need `content-type: application/json`, else 415; an empty body reads as `{}`. Empty `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` disable the check for `wrangler dev`. `preview_urls` is off in `wrangler.jsonc`: version preview hostnames sit outside Access, and smoke checks they no longer reach the Worker.

Routes live in `crates/server/src/routes.rs`, D1 queries in `store.rs`, GitHub App calls in `github.rs`:

- `GET /api/github/installations`, `GET /api/github/installations/{id}/repos`
- `GET`/`POST /api/apps`, `GET`/`PUT /api/apps/{appId}`
- `POST /api/apps/{appId}/clients` returns the secret once; `POST /api/clients/{clientId}/revoke`
- `GET /api/apps/{appId}/reports` returns the newest 100 reports
- `POST /api/reports/{reportId}/retry` resets a `Failed` report and delivers it; any other status is 409 `NotFailed`

Bad input is 400 `Invalid`, an unknown id 404 `NotFound`. A missing GitHub secret is 503 `SecretMissing`; set both from the GitHub App settings with `echo <app id> | npm run secret -- GITHUB_APP_ID` and `openssl pkcs8 -topk8 -nocrypt -in <key>.pem | npm run secret -- GITHUB_APP_PRIVATE_KEY`. `migrations/0001_init.sql` holds the whole schema. Smoke reuses the app `bugstack-smoke` and its client `agent`; seed only through the API.

The admin app keeps its response types by hand in `apps/admin/src/api.ts`. A 401 renders the signed-out notice; any other failure renders a notice with a prefilled issue link.

## Report ingest

`POST /v1/apps/{appId}/reports` (`ingest.rs`) takes a JSON object of at most 60 KiB with a `title` of 1 to 200 characters; every other key stays in `payload`. The client signs it with `X-Bugstack-Client` (client id), `X-Bugstack-Timestamp` (Unix seconds, within 300 s) and `X-Bugstack-Signature`: lower-case hex HMAC-SHA256 over `"{timestamp}.{raw body}"`, keyed with the UTF-8 bytes of the client secret. `sign.rs` holds the check and its test. Refusals in order: 413 `TooLarge`; 401 `MissingSignature`, `StaleTimestamp`, `UnknownClient` (unknown, revoked or another app's), `BadSignature`; 400 `InvalidReport`. Success is 202 `{reportId}` and a `Pending` row, delivered at once under `ctx.wait_until`.

`BUGSTACK_CLIENT_SECRET=… npm run report -- <origin> <appId> <clientId> "<title>" [--error <text>] [--body <text>]` signs one report with `npm-scripts/sign.mjs` and prints the response. Smoke keeps its signing client `smoke-signer` in `~/.config/bugstack/smoke-client` (mode 600), and reuses the revoked `smoke-revoke` and the app `bugstack-smoke-other`.

## Delivery

`deliver.rs` claims a due `Pending` row (attempts plus one, a 5 minute lease), mints an installation token, opens the issue with `POST /repos/{repo}/issues`, records `github_issue` and sets `Filed`. Slack slots in between the issue and `Filed`. A GitHub non-2xx, network error or missing secret writes a `failure` row (`"{status} {first 500 chars}"`, `SecretMissing {name}`) and moves `next_attempt_at` by 1, 5, 30, 120, 720 minutes; the sixth failed attempt sets `Failed`. A D1 error propagates and the lease expiry hands the row to cron. The cron trigger (`* * * * *`) delivers up to 10 due rows, oldest first. Retry sets `Pending`, attempts 0 and runs `deliver` in the background. Smoke checks the `SecretMissing` path until the GitHub secrets are set, then files and closes a real issue with `gh`.

## Infra

`infra/` owns the D1 database, the policies `bugstack-admin`, `bugstack-automation` and `bugstack-public`, the service token, and the applications `bugstack-admin` (both hosts) and `bugstack-reports` (`<host>/v1`, bypass). stallion's state owns the Zero Trust organization and the PIN provider. After an apply, encrypt the state and `cf-env` into dotfiles with `dotfiles-key encrypt bugstack-tfstate` and `bugstack-cf-env`.

## Devbox

`cargo install worker-build` needs OpenSSL headers the devbox lacks: unpack `libssl-dev` with `apt-get download` and `dpkg-deb -x`, then set `OPENSSL_STATIC=1`, `OPENSSL_LIB_DIR` and `OPENSSL_INCLUDE_DIR`.
