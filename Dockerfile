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
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates libdbus-1-3 libssl3 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1000 debrid \
 && useradd --system --uid 1000 --gid debrid --home-dir /config --shell /usr/sbin/nologin debrid \
 && mkdir -p /config /downloads /app \
 && chown debrid:debrid /config /downloads

COPY --from=server /usr/local/bin/debriddownloader-headless /usr/local/bin/debriddownloader-headless
COPY --from=web /src/dist-web /app/web

# On first start (no settings.json in /config yet), make /downloads the download folder.
# An existing settings.json is never touched.
COPY <<'EOF' /usr/local/bin/docker-entrypoint.sh
#!/bin/sh
set -e
data_dir="${DEBRIDDOWNLOADER_DATA_DIR:-/config}"
if [ ! -e "$data_dir/settings.json" ]; then
  mkdir -p "$data_dir"
  cat > "$data_dir/settings.json" <<JSON
{
  "app_settings": {
    "download_folder": "${DEBRIDDOWNLOADER_DOWNLOAD_DIR:-/downloads}",
    "max_concurrent_downloads": 3,
    "create_torrent_subfolders": true,
    "theme": "dark"
  }
}
JSON
fi
exec /usr/local/bin/debriddownloader-headless "$@"
EOF
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh

ENV DEBRIDDOWNLOADER_BIND=0.0.0.0 \
    DEBRIDDOWNLOADER_PORT=8777 \
    DEBRIDDOWNLOADER_DATA_DIR=/config \
    DEBRIDDOWNLOADER_WEB_DIR=/app/web \
    DEBRIDDOWNLOADER_DOWNLOAD_DIR=/downloads \
    HOME=/config

USER debrid:debrid
VOLUME ["/config", "/downloads"]
EXPOSE 8777
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
