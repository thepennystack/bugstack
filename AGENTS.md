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
| `npm run smoke [-- <sha>]`           | Check `/v1/health`, Access, `/api/me`, the 415 rule and the admin shell on both hosts                     |

## Admin API

Every `/api/*` request verifies the Access JWT (`Cf-Access-Jwt-Assertion`, else the `CF_Authorization` cookie) in `crates/server/src/auth.rs`, then admits only `ADMIN_EMAIL` or the service token whose `common_name` is `ADMIN_CLIENT_ID`; anything else is 401 `Unauthorized`. POST and PUT, and DELETE with a body, need `content-type: application/json`, else 415; an empty body reads as `{}`. Empty `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` disable the check for `wrangler dev`. Version preview URLs (`<version>-bugstack.matthijs-f49.workers.dev`) sit outside Access, so the Worker check is their only gate; smoke sends a forged JWT there.

The admin app keeps its response types by hand in `apps/admin/src/api.ts`. A 401 renders the signed-out notice; any other failure renders a notice with a prefilled issue link.

## Infra

`infra/` owns the D1 database, the policies `bugstack-admin`, `bugstack-automation` and `bugstack-public`, the service token, and the applications `bugstack-admin` (both hosts) and `bugstack-reports` (`<host>/v1`, bypass). stallion's state owns the Zero Trust organization and the PIN provider. After an apply, encrypt the state and `cf-env` into dotfiles with `dotfiles-key encrypt bugstack-tfstate` and `bugstack-cf-env`.

## Devbox

`cargo install worker-build` needs OpenSSL headers the devbox lacks: unpack `libssl-dev` with `apt-get download` and `dpkg-deb -x`, then set `OPENSSL_STATIC=1`, `OPENSSL_LIB_DIR` and `OPENSSL_INCLUDE_DIR`.
