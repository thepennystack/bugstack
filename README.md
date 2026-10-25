# bugstack

Signed bug reports in, GitHub issues out. App backends POST a report signed with HMAC-SHA256; bugstack files it as an issue in the app's repository and, when configured, posts a link to Slack.

bugstack is one Rust Cloudflare Worker with a D1 database and a Preact admin app behind Cloudflare Access. The report endpoint under `/v1` is public; everything else needs Access.

Live at https://bugstack.kattebak.fyi.

## Layout

| Path            | Holds                                  |
| --------------- | -------------------------------------- |
| `crates/server` | The Worker                             |
| `apps/admin`    | The admin app, served as static assets |
| `infra`         | OpenTofu for D1 and Access             |
| `migrations`    | D1 migrations                          |
| `npm-scripts`   | Build, deploy and operations scripts   |

## Scripts

| Script                                             | Does                                       |
| -------------------------------------------------- | ------------------------------------------ |
| `npm run fix` / `lint` / `lint:rust` / `typecheck` | Format, lint and typecheck                 |
| `npm run build` / `build:worker`                   | Build the admin app / the Worker           |
| `npm run deploy`                                   | Apply D1 migrations and deploy the Worker  |
| `npm run infra:plan` / `infra:apply`               | Plan or apply the infrastructure           |
| `npm run access:env`                               | Write the automation service token locally |
| `npm run secret -- <NAME>`                         | Set a Worker secret from stdin             |
| `npm run smoke`                                    | Check the live Worker on both hosts        |

## Send a report

POST a JSON object with a `title` to `/v1/apps/{appId}/reports` with three headers:

- `X-Bugstack-Client`: the client id
- `X-Bugstack-Timestamp`: Unix seconds, within 300 s of now
- `X-Bugstack-Signature`: lower-case hex `HMAC-SHA256(secret, "{timestamp}.{raw body}")`

To attach screenshots, declare them in the report as `images: [{contentType, size}]`, at most 10. The 202 answer carries one `uploadUrl` per image; hand them to the browser, which PUTs each image's bytes with that `content-type` within 15 minutes. The issue is filed at once and updated as each image arrives.

`npm run report` signs and sends one; `--image <path>` declares a screenshot and uploads it after the report.

## Setup

Workers Builds is connected to the repo and deploys `main`. GitHub holds no Cloudflare token. On a fresh account, four one-time steps:

1. Connect Workers Builds: under the Worker's Settings, Builds, set root `/`, build `npm run build && npm run build:worker` and deploy `npm run deploy`, turn non-production builds off, and give the build token D1 Edit.
2. Run `npm run bootstrap` once and follow the two pages: it creates the GitHub App and the Slack app and stores their credentials as Worker secrets. The admin GitHub and Slack pages only install them.
3. Open the admin GitHub page, click Install, and pick the accounts and repositories bugstack files into. On each app, pick the installation and repository.
4. Open the admin Slack page, click Add to Slack and approve the workspace. Run `/invite @bugstack` in each channel.

## Health

`GET /v1/health` answers `{"commit": "<sha>"}` with the `x-bugstack-commit` header.

## License

MIT
