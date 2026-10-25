#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

cargo_bin="${CARGO_HOME:-$HOME/.cargo}/bin"
PATH="$cargo_bin:$PATH"
export PATH

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs |
    sh -s -- -y --profile minimal --default-toolchain none --no-modify-path
fi

rustup toolchain install

if ! command -v worker-build >/dev/null 2>&1; then
  cargo install --locked worker-build@^0.8
fi

cd crates/server
exec worker-build --release
