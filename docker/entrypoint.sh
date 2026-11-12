#!/bin/sh
# The image's entrypoint. As root: make /config and /downloads writable by PUID:PGID, seed
# settings.json on first start, then run the server as that user. Started with --user, it
# skips the ownership step and runs as the user Docker chose.
set -eu

log() { echo "docker-entrypoint: $*" >&2; }

data_dir="${DEBRIDDOWNLOADER_DATA_DIR:-/config}"
download_dir="${DEBRIDDOWNLOADER_DOWNLOAD_DIR:-/downloads}"
settings="$data_dir/settings.json"

# On first start (no settings.json yet), make the download dir the download folder.
# An existing settings.json is never touched. Prints "seeded" when it wrote the file.
seed_settings() {
  [ ! -e "$settings" ] || return 0
  mkdir -p "$data_dir"
  cat > "$settings" <<JSON
{
  "app_settings": {
    "download_folder": "$download_dir",
    "max_concurrent_downloads": 3,
    "create_torrent_subfolders": true,
    "theme": "dark"
  }
}
JSON
  echo seeded
}

if [ "$(id -u)" != 0 ]; then
  seed_settings >/dev/null || log "can't write $settings; make $data_dir writable by $(id -u):$(id -g)"
  exec /usr/local/bin/debriddownloader-headless "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
case "$PUID$PGID" in
  *[!0-9]*|'') log "PUID and PGID must be numbers (got '$PUID', '$PGID')"; exit 1 ;;
esac

# Only the top level, and only when it's wrong: never a recursive chown of a user's share.
for dir in "$data_dir" "$download_dir"; do
  mkdir -p "$dir"
  if [ "$(stat -c %u:%g "$dir")" != "$PUID:$PGID" ]; then
    # NFS root_squash or CIFS can refuse; say so instead of crash-looping.
    chown "$PUID:$PGID" "$dir" || log "warning: can't chown $dir; make it writable by $PUID:$PGID"
  fi
done

if [ "$(seed_settings)" = seeded ]; then
  chown "$PUID:$PGID" "$settings"
fi

exec setpriv --reuid "$PUID" --regid "$PGID" --clear-groups \
  /usr/local/bin/debriddownloader-headless "$@"
