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

Every `/api/*` request verifies the Access JWT (`Cf-Access-Jwt-Assertion`, else the `CF_Authorization` cookie) in `crates/server/src/auth.rs`; a missing or bad token is 401 `Unauthorized`. The caller's identity is the lower-cased Access email, else the service token's `common_name` (its client id, `….access`). The Worker then loads that identity's `member` rows; the database alone decides access, and an identity with no rows can only call `/api/me` and `POST /api/orgs`. POST and PUT, and DELETE with a body, need `content-type: application/json`, else 415; an empty body reads as `{}`. Empty `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` disable the check for `wrangler dev`, with the identity `local`. `preview_urls` is off in `wrangler.jsonc`: version preview hostnames sit outside Access, and smoke checks they no longer reach the Worker.

An `org` owns apps, GitHub installations and Slack workspaces; `member` joins an identity to an org as `Owner` or `Member`. Adding a member row is the invite: the owner tells the invitee the address, and the row counts from their first sign-in. Migration `0008_orgs.sql` seeds org `ischen` (`aqy1hvijv0b22fgnhowiewso6`) with Owners `matthijs@ischen.nl` and the automation service token, and attaches every earlier app and workspace to it. A recreated service token needs a migration for its member row.

Org scoping lives in the path. `...` below is `/api/orgs/{orgId}`: a caller outside that org is 403 `NotAMember`, an id that belongs to another org is 404, and an Owner-only route answers a `Member` 403 `NotAnOwner`.

| Route                                                                                                  | Rule                                                                                                   |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `GET /api/me`                                                                                          | `{identity, orgs: [{orgId, name, role}]}`, newest membership first                                     |
| `POST /api/orgs` `{name}`                                                                              | 1 to 80 characters; 201 `{orgId, name, role}`, the caller is `Owner`                                   |
| `GET /api/github/setup?installation_id&setup_action&state`                                             | GitHub's setup URL; see GitHub and Slack apps                                                          |
| `GET /api/slack/oauth/callback?code&state`                                                             | see Slack                                                                                              |
| `GET .../members`                                                                                      | `[{memberId, identity, role, createdAt}]`                                                              |
| `POST .../members` `{email, role}`                                                                     | Owner; lower-cases the email; 201, or 409 `AlreadyMember`                                              |
| `DELETE .../members/{memberId}`                                                                        | Owner, or the caller's own row; 204, or 409 `LastOwner` for the last Owner                             |
| `POST .../github/install`                                                                              | 201 `{url}`                                                                                            |
| `GET .../github/installations`, `GET .../github/installations/{id}/repos`                              | the org's own installations `[{installationId, account}]` and their repositories                       |
| `DELETE .../github/installations/{id}`                                                                 | 204, or 409 `InUse` while an app files through it                                                      |
| `GET`/`POST .../apps`, `GET`/`PUT`/`DELETE .../apps/{appId}`                                           | see below                                                                                              |
| `POST .../apps/{appId}/clients`, `POST .../clients/{clientId}/revoke`, `DELETE .../clients/{clientId}` | see below                                                                                              |
| `GET .../apps/{appId}/reports`, `POST .../reports/{reportId}/retry`                                    | see below                                                                                              |
| `GET .../slack/install`                                                                                | 302 to Slack; see Slack                                                                                |
| `GET .../slack/workspaces`, `DELETE .../slack/workspaces/{workspaceId}`                                | `[{workspaceId, teamId, teamName, createdAt}]`; delete is 204, or 409 `InUse` while an app posts to it |
| `PUT .../apps/{appId}/slack` `{workspaceId, channel}`, `DELETE .../apps/{appId}/slack`                 | 204; a workspace outside the org is 404                                                                |

Routes live in `crates/server/src/routes.rs` (apps, clients, reports and the org dispatch), `org_routes.rs` (me, orgs, members), `github_routes.rs` and `slack_routes.rs`; D1 queries in `store.rs`, `org_store.rs` and `slack_store.rs`, GitHub App calls in `github.rs`, Slack calls in `slack.rs`, the instance secrets in `fixtures.rs`.

`DELETE .../apps/{appId}` is 204 and removes the app with its clients, reports, images, issue and Slack records and failures in one D1 batch, then its R2 objects (a failed R2 delete is logged); filed GitHub issues stay. `POST .../apps/{appId}/clients` returns the secret once; `DELETE .../clients/{clientId}` is 204 for a `Revoked` client, else 409 `NotRevoked`; its reports keep the id and list the client as `deleted client`. `GET .../apps/{appId}/reports` returns the newest 100 reports. `POST .../reports/{reportId}/retry` resets a `Failed` report and delivers it; any other status is 409 `NotFailed`.

An app carries `installationId`, 0 until one is picked; app create and put accept only 0 or one of the org's installations, else 400 `Invalid`. It also carries `counts: {clients, pending, filed, failed}`: its active clients and its reports by status. The API never returns a bot token or a secret.

Bad input is 400 `Invalid`, an unknown id 404 `NotFound`. A GitHub key that does not import is 500 `KeyInvalid`. A missing instance secret is 503 `NotBootstrapped`, naming the secret. `migrations/` holds the schema. Smoke runs as the automation identity in org `ischen`, reuses the oldest app named `bugstack-smoke` and its client `agent`, deletes any younger duplicates, and deletes its revoked clients at the end; seed only through the API.

The admin app keeps its response types by hand in `apps/admin/src/api.ts`, which reads `/api/me` once and prefixes every call with the org. Pages live under `/orgs/{orgId}/...` (Apps, GitHub, Slack, Members); an org the caller is not in renders the `NotAMember` notice linking `/`. `/` redirects to the first org in `/api/me`, or to `/orgs/new` (a name and a button) for an identity without orgs. The nav shows the current org's name, and a dropdown of the caller's orgs plus "Create another" when there is more than one; switching reloads the page. Members lists identity, role and joined date; Owners get Remove and an invite form, everyone gets Leave on their own row. A 401 renders the signed-out notice; 409 `AlreadyMember`, 409 `LastOwner` and 403 `NotAnOwner` render the refusal; any other failure renders a notice with a prefilled issue link.

## GitHub and Slack apps

One GitHub App and one Slack app serve the whole instance. `npm run bootstrap` creates both and stores five Worker secrets: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_PRIVATE_KEY` (the PKCS#1 PEM GitHub hands out; `github.rs` wraps it as PKCS#8 when it signs the app JWT), `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`. Rotating a key means rerunning bootstrap. Any route that needs a missing secret answers 503 `NotBootstrapped`, and the admin pages show a notice to run `npm run bootstrap`.

A GitHub installation binds to the org that started it. The GitHub page's install button calls `POST .../github/install`, which keeps a `github_install_state` row (128 random bits in hex, the org and the caller, valid 15 minutes, single use) and answers `https://github.com/apps/{slug}/installations/new?state=…`; the browser goes there. GitHub returns to the app's setup URL, `GET /api/github/setup`, which consumes the state (400 `InvalidState` when unknown, used or expired), requires the caller to be a member of its org, checks the id with `GET /app/installations/{id}` signed with the app JWT (a GitHub 404 is 400 `UnknownInstallation`), stores a `github_installation` row, and answers 303 to `/orgs/{orgId}/github?installed={account}`. An installation already bound to another org is 409 `InstallationClaimed`; the same org rebinds. The app form picks one of the org's installations by account, which sets `installationId`.

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

`deliver.rs` claims a due `Pending` row (attempts plus one, a 5 minute lease), mints an installation token with the instance GitHub App key, opens the issue with `POST /repos/{repo}/issues`, records `github_issue`, then, when the app has a `slack_channel` row and no `slack_post`, sends `chat.postMessage` `{app}: <{issue url}|{title}>` (`&<>` escaped) with the workspace token, records `slack_post` and sets `Filed`. Slack `ok: false` or a non-2xx is a `Slack` failure with the same backoff; the next attempt reuses the filed issue. A GitHub non-2xx, network error, invalid key, missing secret or an app without an installation writes a `GitHub` `failure` row (`"{status} {first 500 chars}"`, `KeyInvalid …`, `NotBootstrapped …`, `NoInstallation …`) and moves `next_attempt_at` by 1, 5, 30, 120, 720 minutes; the sixth failed attempt sets `Failed`. A D1 error propagates and the lease expiry hands the row to cron. The cron trigger (`* * * * *`) delivers up to 10 due rows, oldest first. Retry sets `Pending`, attempts 0 and runs `deliver` in the background. Smoke checks that the removed and unscoped routes 404, that `POST .../github/install` answers 503 `NotBootstrapped` until the secrets exist and 201 after, a forged setup state, org isolation through `bugstack-smoke-other-org`, the member invite and `LastOwner`, and the `NoInstallation` path until org `ischen` holds an installation on `thepennystack`; then it points `bugstack-smoke` at that installation, files and closes a real issue with `gh`.

## Slack

The instance Slack app installs into any number of workspaces through OAuth; each workspace belongs to one org. The Slack page's Add to Slack calls `GET .../slack/install`, which keeps a state in `slack_oauth_state` (128 random bits in hex, the org, valid 15 minutes, single use) and answers 302 to `https://slack.com/oauth/v2/authorize` with `client_id`, `scope=chat:write`, `state` and `redirect_uri` `{origin}/api/slack/oauth/callback`. The callback sits behind Access like every `/api/*` route. It consumes the state (400 `InvalidState` when unknown, used or expired), requires the caller to be a member of its org, posts the code form-encoded to `oauth.v2.access` with the instance client id and secret, upserts the `slack_workspace` row by `team.id` with `team.name` and the bot `access_token`, and answers 303 to `/orgs/{orgId}/slack?installed={team name}`. A team already bound to another org is 409 `WorkspaceClaimed`. A Slack refusal answers 400 `SlackRefused` with its `error` string; a network failure is 502 `SlackFailed`.

Run `/invite @bugstack` in each channel an app posts to; a channel without the bot records `not_in_channel`. The app page picks a workspace by team name. Smoke runs the Slack happy path only when a workspace exists, the GitHub App is installed on the smoke repository owner and `BUGSTACK_SMOKE_SLACK_CHANNEL` names a channel with the bot; `BUGSTACK_SMOKE_SLACK_OUTSIDE` (default `general`) names one without it.

## Infra

`infra/` owns the D1 database, the policies `bugstack-admin`, `bugstack-automation` and `bugstack-public`, the service token, and the applications `bugstack-admin` (both hosts) and `bugstack-reports` (`<host>/v1`, bypass). stallion's state owns the Zero Trust organization and the PIN provider.

Access: the `bugstack-admin` policy includes everyone and the application allows only the PIN provider, so anyone with a verified email can sign in and create an org; an Owner invites others by email, and the `member` rows alone decide what each identity sees. Each signed-in email takes a Zero Trust seat. After an apply, encrypt the state and `cf-env` into dotfiles with `dotfiles-key encrypt bugstack-tfstate` and `bugstack-cf-env`.

## Devbox

`cargo install worker-build` needs OpenSSL headers the devbox lacks: unpack `libssl-dev` with `apt-get download` and `dpkg-deb -x`, then set `OPENSSL_STATIC=1`, `OPENSSL_LIB_DIR` and `OPENSSL_INCLUDE_DIR`.
