# bugstack

bugstack takes signed bug reports from app backends and files each as a GitHub issue, with an optional Slack post. One Rust Cloudflare Worker in `crates/server` serves `/v1/*` (public), `/api/*` (admin) and the Preact admin app in `apps/admin`. D1 is the only store.

## Rules

- Rust and TypeScript only. No Python.
- Commit to `main` in small conventional commits. No CI workflow; no tests except the HMAC check.
- No code comments. Fail fast, return early, no `any`.
- Run `npm run fix`, `lint`, `lint:rust` and `typecheck` before every push.
- Scripts read `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from `~/.config/bugstack/cf-env`. Never read or print that file or the tofu state.

## Scripts

| Script                                 | Does                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `npm run fix`                          | Biome and `cargo fmt` rewrite files                                                                                       |
| `npm run lint` / `lint:rust`           | Biome check / `cargo fmt --check` and `clippy -D warnings`                                                                |
| `npm run typecheck`                    | `tsc` over `apps/*`                                                                                                       |
| `npm run build` / `build:worker`       | Vite build of `apps/admin` / wasm bundle in `crates/server/build`                                                         |
| `npm run deploy`                       | Refuses locally; Workers Builds runs it: D1 migrations, then `wrangler deploy` with the vars from `infra/access.json`     |
| `npm run infra:plan` / `infra:apply`   | OpenTofu in `infra/`, state at `~/.config/bugstack/terraform.tfstate`; apply rewrites `infra/access.json`                 |
| `npm run access:env`                   | Write the service token to `~/.config/bugstack/access-env` (mode 600)                                                     |
| `npm run access:lookup`                | Print the PIN provider id and team domain                                                                                 |
| `npm run secret -- <NAME>`             | Pipe stdin to `wrangler secret put`                                                                                       |
| `npm run bootstrap [-- --owner <org>]` | Once per instance: a page on port 8789 creates the GitHub App and Slack app and sets their Worker secrets (see Bootstrap) |
| `npm run upload-secret`                | Rotate `UPLOAD_SIGNING_SECRET`, keeping a copy in `~/.config/bugstack/upload-secret` (mode 600) for smoke                 |
| `npm run smoke [-- <sha>]`             | Check health, Access, the admin API and report ingest, then render the pages in headless Chromium                         |
| `npm run report -- …`                  | Sign and POST one report (see Report ingest)                                                                              |
| `npm run test:rust`                    | `cargo test`: the HMAC check in `sign.rs`                                                                                 |

## Bootstrap

`npm run bootstrap` serves on `0.0.0.0:8789` (`--port`, `--worker <origin>`, `--owner <org>`, `--name`). Page 1 runs the GitHub manifest flow for a public app with Issues write and Metadata read; page 2 links to Slack's create-from-manifest dialog and takes the client id and secret. It then pipes `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_PRIVATE_KEY`, `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` to `wrangler secret put` and exits. A rerun replaces them. Nothing is printed or written to disk.

## Deploy

Workers Builds is connected to the repo and deploys every push to `main`. `npm run deploy` refuses unless `WORKERS_CI` is set. GitHub holds no Cloudflare token.

First-time connect on a fresh account: under the Worker's Settings, Builds, set root `/`, build `npm run build && npm run build:worker` and deploy `npm run deploy`, turn non-production builds off, and give the build token D1 Edit.

## Admin API

Every `/api/*` request verifies the Access JWT (`Cf-Access-Jwt-Assertion`, else the `CF_Authorization` cookie) in `crates/server/src/auth.rs`, then admits only `ADMIN_EMAIL` or the service token whose `common_name` is `ADMIN_CLIENT_ID`; anything else is 401 `Unauthorized`. POST and PUT, and DELETE with a body, need `content-type: application/json`, else 415; an empty body reads as `{}`. Empty `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` disable the check for `wrangler dev`. `preview_urls` is off in `wrangler.jsonc`: version preview hostnames sit outside Access, and smoke checks they no longer reach the Worker.

Routes live in `crates/server/src/routes.rs` and the Slack ones in `slack_routes.rs`, D1 queries in `store.rs` and `slack_store.rs`, GitHub App calls in `github.rs`, Slack calls in `slack.rs`, the instance secrets in `fixtures.rs`:

- `GET /api/github/app` answers `{slug, installUrl}`
- `GET /api/github/installations` lists the GitHub App's installations `[{installationId, account}]`; `GET /api/github/installations/{id}/repos` lists one installation's repositories
- `GET`/`POST /api/apps`, `GET`/`PUT /api/apps/{appId}`; `DELETE /api/apps/{appId}` is 204 and removes the app with its clients, reports, images, issue and Slack records and failures in one D1 batch, then its R2 objects (a failed R2 delete is logged); filed GitHub issues stay
- `POST /api/apps/{appId}/clients` returns the secret once; `POST /api/clients/{clientId}/revoke`; `DELETE /api/clients/{clientId}` is 204 for a `Revoked` client, else 409 `NotRevoked`; its reports keep the id and list the client as `deleted client`
- `GET /api/apps/{appId}/reports` returns the newest 100 reports
- `POST /api/reports/{reportId}/retry` resets a `Failed` report and delivers it; any other status is 409 `NotFailed`
- `GET /api/slack/install` and `GET /api/slack/oauth/callback?code&state` run the OAuth install (see Slack)
- `GET /api/slack/workspaces` lists `[{workspaceId, teamId, teamName, createdAt}]`; `DELETE /api/slack/workspaces/{workspaceId}` is 204, or 409 `InUse` while an app posts to it
- `PUT /api/apps/{appId}/slack` `{workspaceId, channel}` and `DELETE /api/apps/{appId}/slack`, both 204; an unknown workspace is 404

An app carries `installationId`, 0 until one is picked. It also carries `counts: {clients, pending, filed, failed}`: its active clients and its reports by status. The API never returns a bot token or a secret.

Bad input is 400 `Invalid`, an unknown id 404 `NotFound`. A GitHub key that does not import is 500 `KeyInvalid`. A missing instance secret is 503 `NotBootstrapped`, naming the secret. `migrations/` holds the schema. Smoke reuses the oldest app named `bugstack-smoke` and its client `agent`, deletes any younger duplicates, and deletes its revoked clients at the end; seed only through the API.

The admin app keeps its response types by hand in `apps/admin/src/api.ts`. A 401 renders the signed-out notice; any other failure renders a notice with a prefilled issue link.

## GitHub and Slack apps

One GitHub App and one Slack app serve the whole instance. `npm run bootstrap` creates both and stores five Worker secrets: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_PRIVATE_KEY` (the PKCS#1 PEM GitHub hands out; `github.rs` wraps it as PKCS#8 when it signs the app JWT), `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`. Rotating a key means rerunning bootstrap. Any route that needs a missing secret answers 503 `NotBootstrapped`, and the admin pages show a notice to run `npm run bootstrap`.

The admin GitHub page links to `https://github.com/apps/{slug}/installations/new` and lists the installations (`GET /app/installations` signed with the app JWT). The app form picks an installation by account, which sets `installationId`.

## Report ingest

`POST /v1/apps/{appId}/reports` (`ingest.rs`) takes a JSON object of at most 60 KiB with a `title` of 1 to 200 characters; every other key stays in `payload`. The client signs it with `X-Bugstack-Client` (client id), `X-Bugstack-Timestamp` (Unix seconds, within 300 s) and `X-Bugstack-Signature`: lower-case hex HMAC-SHA256 over `"{timestamp}.{raw body}"`, keyed with the UTF-8 bytes of the client secret. `sign.rs` holds the check and its test. Refusals in order: 413 `TooLarge`; 401 `MissingSignature`, `StaleTimestamp`, `UnknownClient` (unknown, revoked or another app's), `BadSignature`; 400 `InvalidReport`. Success is 202 `{reportId}` and a `Pending` row, delivered at once under `ctx.wait_until`.

`images` optionally declares up to 10 screenshots as `[{contentType, size}]`: PNG, JPEG, WebP or GIF, 1 byte to 5 MiB, else 400 `InvalidReport`. Each becomes a `Reserved` `image` row with its `position`, and the 202 answer adds `uploads: [{imageId, uploadUrl, expiresAt}]` in the same order.

`BUGSTACK_CLIENT_SECRET=… npm run report -- <origin> <appId> <clientId> "<title>" [--error <text>] [--body <text>] [--image <path>]…` signs one report declaring each image, then PUTs each file to its upload URL, with `npm-scripts/sign.mjs` and prints the response. Smoke keeps its signing client `smoke-signer` in `~/.config/bugstack/smoke-client` (mode 600), and reuses the revoked `smoke-revoke` and the app `bugstack-smoke-other`.

## Uploads

`uploads.rs` serves two routes; R2 bucket `bugstack-images` (binding `IMAGES`) holds the bytes at key `imageId`, the `image` table the state.

- `PUT /v1/uploads/{imageId}?exp&sig` stores the bytes and answers 200 `{imageId}`. `sig` is hex HMAC-SHA256 over `"{imageId}.{exp}"` keyed with the Worker secret `UPLOAD_SIGNING_SECRET`; `exp` is 900 s after the report. Refusals in order: 401 `BadSignature`, 410 `UploadExpired`, 404 `NotFound`, 409 `AlreadyStored`, 415 `WrongContentType`, 413 `TooLarge`. This route and its `OPTIONS` preflight are the only ones with CORS (any origin). A stored image sets a `Filed` report back to `Pending` and delivers it again; a `Pending` or `Failed` report picks the image up on its own next attempt.
- `GET /v1/images/{imageId}` streams a `Stored` image, cached as immutable for a year; anything else is 404. The unguessable id is the access control.

The issue body embeds each `Stored` image in `position` order as `![screenshot {n}](https://bugstack.kattebak.fyi/v1/images/{imageId})`, after `body`; a `Reserved` image is never mentioned. `github_issue.image_count` records how many the body held at its last write; when more are stored, delivery PATCHes the issue body, and a failure there is a `GitHub` failure with the usual backoff. `ReportRow.images` lists stored ids only.

## Delivery

`deliver.rs` claims a due `Pending` row (attempts plus one, a 5 minute lease), mints an installation token with the instance GitHub App key, opens the issue with `POST /repos/{repo}/issues`, records `github_issue`, then, when the app has a `slack_channel` row and no `slack_post`, sends `chat.postMessage` `{app}: <{issue url}|{title}>` (`&<>` escaped) with the workspace token, records `slack_post` and sets `Filed`. Slack `ok: false` or a non-2xx is a `Slack` failure with the same backoff; the next attempt reuses the filed issue. A GitHub non-2xx, network error, invalid key, missing secret or an app without an installation writes a `GitHub` `failure` row (`"{status} {first 500 chars}"`, `KeyInvalid …`, `NotBootstrapped …`, `NoInstallation …`) and moves `next_attempt_at` by 1, 5, 30, 120, 720 minutes; the sixth failed attempt sets `Failed`. A D1 error propagates and the lease expiry hands the row to cron. The cron trigger (`* * * * *`) delivers up to 10 due rows, oldest first. Retry sets `Pending`, attempts 0 and runs `deliver` in the background. Smoke checks that the removed GitHub App and Slack app routes 404, that `/api/github/app` and `/api/github/installations` answer 503 `NotBootstrapped` until the secrets exist and 200 after, and the `NoInstallation` path until the GitHub App is installed on `thepennystack`; then it points `bugstack-smoke` at that installation, files and closes a real issue with `gh`.

## Slack

The instance Slack app installs into any number of workspaces through OAuth. The Slack page's Add to Slack calls `GET /api/slack/install`, which keeps a state in `slack_oauth_state` (128 random bits in hex, valid 15 minutes, single use) and answers 302 to `https://slack.com/oauth/v2/authorize` with `client_id`, `scope=chat:write`, `state` and `redirect_uri` `{origin}/api/slack/oauth/callback`. The callback sits behind Access like every `/api/*` route. It consumes the state (400 `InvalidState` when unknown, used or expired), posts the code form-encoded to `oauth.v2.access` with the instance client id and secret, upserts the `slack_workspace` row by `team.id` with `team.name` and the bot `access_token`, and answers 303 to `/slack?installed={team name}`. A Slack refusal answers 400 `SlackRefused` with its `error` string; a network failure is 502 `SlackFailed`.

Run `/invite @bugstack` in each channel an app posts to; a channel without the bot records `not_in_channel`. The app page picks a workspace by team name. Smoke runs the Slack happy path only when a workspace exists, the GitHub App is installed on the smoke repository owner and `BUGSTACK_SMOKE_SLACK_CHANNEL` names a channel with the bot; `BUGSTACK_SMOKE_SLACK_OUTSIDE` (default `general`) names one without it.

## Infra

`infra/` owns the D1 database, the policies `bugstack-admin`, `bugstack-automation` and `bugstack-public`, the service token, and the applications `bugstack-admin` (both hosts) and `bugstack-reports` (`<host>/v1`, bypass). stallion's state owns the Zero Trust organization and the PIN provider. After an apply, encrypt the state and `cf-env` into dotfiles with `dotfiles-key encrypt bugstack-tfstate` and `bugstack-cf-env`.

## Devbox

`cargo install worker-build` needs OpenSSL headers the devbox lacks: unpack `libssl-dev` with `apt-get download` and `dpkg-deb -x`, then set `OPENSSL_STATIC=1`, `OPENSSL_LIB_DIR` and `OPENSSL_INCLUDE_DIR`.
