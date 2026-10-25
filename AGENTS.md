# bugstack

bugstack takes signed bug reports from app backends and files each as a GitHub issue, with an optional Slack post. One Rust Cloudflare Worker in `crates/server`, built with `worker-build` for `wasm32-unknown-unknown`, serves `/v1/*` (public), `/api/*` (admin) and the Preact admin app in `apps/admin`. D1 is the only store.

## Rules

- Rust and TypeScript only. No Python.
- Commit to `main` in small conventional commits. No CI workflow; no tests except the HMAC check.
- No code comments. Fail fast, return early, no `any`.
- Run `npm run fix`, `lint`, `lint:rust` and `typecheck` before every push.
- Scripts read `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from `~/.config/bugstack/cf-env`. Never read or print that file or the tofu state.

## Scripts

| Script                               | Does                                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run fix`                        | Biome and `cargo fmt` rewrite files                                                                                                                |
| `npm run lint` / `lint:rust`         | Biome check / `cargo fmt --check` and `clippy -D warnings`                                                                                         |
| `npm run typecheck`                  | `tsc` over `apps/*`                                                                                                                                |
| `npm run build` / `build:worker`     | Vite build of `apps/admin` / wasm bundle in `crates/server/build`                                                                                  |
| `npm run deploy`                     | `wrangler d1 migrations apply DB --remote`, then `wrangler deploy` with the vars from `infra/access.json`; sources `cf-env` outside Workers Builds |
| `npm run infra:plan` / `infra:apply` | OpenTofu in `infra/`, state at `~/.config/bugstack/terraform.tfstate`; apply rewrites `infra/access.json`                                          |
| `npm run access:env`                 | Write the service token to `~/.config/bugstack/access-env` (mode 600)                                                                              |
| `npm run access:lookup`              | Print the one-time PIN provider id and team domain owned by stallion's state                                                                       |
| `npm run secret -- <NAME>`           | Pipe stdin to `wrangler secret put`                                                                                                                |
| `npm run smoke [-- <sha>]`           | Check both hosts: `/v1/health` serves the commit without Access, `/` redirects without a token and serves the admin page with it                   |

## Infra

`infra/` owns the D1 database, the policies `bugstack-admin`, `bugstack-automation` and `bugstack-public`, the service token, and the applications `bugstack-admin` (both hosts) and `bugstack-reports` (`<host>/v1`, bypass). stallion's state owns the Zero Trust organization and the PIN provider. After an apply, encrypt the state and `cf-env` into dotfiles with `dotfiles-key encrypt bugstack-tfstate` and `bugstack-cf-env`.

## Commit header

`crates/server/build.rs` bakes `WORKERS_CI_COMMIT_SHA`, else `git rev-parse HEAD`, into the Worker, which sets `x-bugstack-commit` on every response it handles. Assets are served before the Worker, so only `/v1/*` and `/api/*` carry it.

## Devbox

The devbox has no `libssl-dev` or `pkg-config`, so `cargo install worker-build` fails in `openssl-sys`. Unpack `libssl-dev` with `apt-get download` and `dpkg-deb -x`, then install with `OPENSSL_STATIC=1`, `OPENSSL_LIB_DIR` and `OPENSSL_INCLUDE_DIR` pointing into it.
