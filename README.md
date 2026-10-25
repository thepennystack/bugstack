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

## Health

`GET /v1/health` answers `{"commit": "<sha>"}` with the `x-bugstack-commit` header.

## License

MIT
