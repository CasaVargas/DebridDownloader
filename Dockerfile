# syntax=docker/dockerfile:1
#
# DebridDownloader headless server: the download engine + HTTP API, serving the browser UI.
#
#   docker build -t debriddownloader .
#   docker run -d -p 8777:8777 -v dd-config:/config -v ~/Downloads:/downloads \
#     -e DEBRIDDOWNLOADER_SECRET_SERVER_AUTH_TOKEN=change-me debriddownloader
#
# /config  -> data dir: settings.json, downloads.json, secrets.json (provider + server tokens)
# /downloads -> default download folder (seeded into settings.json on first start)
# PUID/PGID  -> the user the server runs as and files are written as (default 1000:1000)
# See "Docker (headless server)" in README.md.

# ── 1. Web bundle (dist-web/) ──────────────────────────────────────
FROM node:22-bookworm-slim AS web
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig.json tsconfig.node.json vite.config.ts ./
COPY public ./public
COPY src ./src
RUN npm run build:web

# ── 2. Headless binary (no Tauri, no webview) ─────────────────────
FROM rust:1-slim-bookworm AS server
# libdbus: the keyring crate's Secret Service backend links it; libssl: reqwest's native TLS.
RUN apt-get update \
 && apt-get install -y --no-install-recommends pkg-config libdbus-1-dev libssl-dev \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src/src-tauri
COPY src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/build.rs ./
COPY src-tauri/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/src/src-tauri/target \
    cargo build --release --locked --no-default-features --features headless \
      --bin debriddownloader-headless \
 && cp target/release/debriddownloader-headless /usr/local/bin/debriddownloader-headless

# ── 3. Runtime: slim Debian, no GTK/webkit ────────────────────────
FROM debian:bookworm-slim AS runtime
# setpriv (util-linux, already in the base image) drops root in the entrypoint.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libdbus-1-3 libssl3 \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /config /downloads /app

COPY --from=server /usr/local/bin/debriddownloader-headless /usr/local/bin/debriddownloader-headless
COPY --from=web /src/dist-web /app/web
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh

LABEL org.opencontainers.image.title="DebridDownloader" \
      org.opencontainers.image.description="Headless DebridDownloader: the download engine and HTTP API, serving the browser UI" \
      org.opencontainers.image.source="https://github.com/CasaVargas/DebridDownloader" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

# The entrypoint starts as root, then runs the server as PUID:PGID.
ENV DEBRIDDOWNLOADER_BIND=0.0.0.0 \
    DEBRIDDOWNLOADER_PORT=8777 \
    DEBRIDDOWNLOADER_DATA_DIR=/config \
    DEBRIDDOWNLOADER_WEB_DIR=/app/web \
    DEBRIDDOWNLOADER_DOWNLOAD_DIR=/downloads \
    HOME=/config \
    PUID=1000 \
    PGID=1000

VOLUME ["/config", "/downloads"]
EXPOSE 8777
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
